import mongoose from "mongoose";
import Batch from "../models/BatchSchema.js";
import Product from "../models/productSchema.js";
import InventoryTransaction from "../models/InventoryTransactionSchema.js";

/**
 * Synchronize aggregate stock and earliest valid expiry date from active batches to Product model.
 * Preserves full backward compatibility with all product queries.
 */
export const syncProductAggregateStock = async (productId, session = null) => {
  const now = new Date();

  // Find all active unexpired batches with stock
  const batches = await Batch.find({
    product: productId,
    isActive: true,
    expiryDate: { $gt: now },
  }).sort({ expiryDate: 1 });

  const totalAvailableStock = batches.reduce((sum, b) => sum + (b.availableStock || 0), 0);
  const earliestBatch = batches.find((b) => b.availableStock > 0);

  const updateFields = {
    stock: totalAvailableStock,
  };

  if (earliestBatch) {
    updateFields.expiryDate = earliestBatch.expiryDate;
  }

  // If there's 0 stock or all batches expired, mark inactive
  if (totalAvailableStock === 0) {
    updateFields.isActive = false;
  }

  const updatedProduct = await Product.findByIdAndUpdate(
    productId,
    { $set: updateFields },
    { returnDocument: "after", session }
  );

  return {
    totalStock: totalAvailableStock,
    earliestExpiry: earliestBatch ? earliestBatch.expiryDate : null,
    product: updatedProduct,
  };
};

/**
 * Create a new batch for a product and log the inventory transaction.
 */
export const createBatch = async ({
  productId,
  sellerId,
  batchNumber,
  quantity,
  expiryDate,
  costPrice = 0,
  performedBy,
  performedByName = "Seller",
}) => {
  const qty = Number(quantity);
  if (isNaN(qty) || qty <= 0) {
    throw new Error("Batch quantity must be a positive number");
  }

  const expDate = new Date(new Date(expiryDate).setUTCHours(23, 59, 59, 999));
  if (isNaN(expDate.getTime()) || expDate <= new Date()) {
    throw new Error("Batch expiry date must be a valid future date");
  }

  const product = await Product.findById(productId);
  if (!product) {
    throw new Error("Product not found");
  }

  if (product.owner.toString() !== sellerId.toString() && performedByName !== "Admin") {
    throw new Error("Not authorized to manage inventory for this product");
  }

  // Check unique batch number for this product
  const cleanBatchNumber = String(batchNumber || "").trim().toUpperCase();
  if (!cleanBatchNumber) {
    throw new Error("Batch number is required");
  }

  const existingBatch = await Batch.findOne({
    product: productId,
    batchNumber: cleanBatchNumber,
  });
  if (existingBatch) {
    throw new Error(`Batch "${cleanBatchNumber}" already exists for this product`);
  }

  const batch = await Batch.create({
    product: productId,
    seller: product.owner,
    batchNumber: cleanBatchNumber,
    initialQuantity: qty,
    availableStock: qty,
    reservedStock: 0,
    soldStock: 0,
    expiredStock: 0,
    expiryDate: expDate,
    costPrice: Number(costPrice) || 0,
    isActive: true,
  });

  // Log inventory transaction
  await InventoryTransaction.create({
    product: productId,
    productName: product.name,
    batch: batch._id,
    batchNumber: cleanBatchNumber,
    seller: product.owner,
    type: "BATCH_CREATE",
    quantityDelta: qty,
    previousAvailableStock: product.stock || 0,
    newAvailableStock: (product.stock || 0) + qty,
    reason: `Created batch ${cleanBatchNumber} with ${qty} units`,
    performedBy,
    performedByName,
  });

  // Sync aggregate stock
  await syncProductAggregateStock(productId);

  return batch;
};

/**
 * Atomic FEFO (First Expired, First Out) stock deduction.
 * Protects against race conditions, overselling, and concurrent orders.
 */
export const deductStockFEFO = async ({
  productId,
  requestedQuantity,
  orderId,
  paymentId,
  buyerId,
  buyerName,
}) => {
  const qty = Number(requestedQuantity);
  if (isNaN(qty) || qty <= 0) {
    throw new Error("Requested quantity must be positive");
  }

  const now = new Date();

  // Find product
  const product = await Product.findById(productId);
  if (!product) {
    throw new Error("Product not found");
  }

  // Ensure product has unexpired active batches
  const availableBatches = await Batch.find({
    product: productId,
    isActive: true,
    expiryDate: { $gt: now },
    availableStock: { $gt: 0 },
  }).sort({ expiryDate: 1 }); // FEFO: earliest expiry first

  const totalAvailable = availableBatches.reduce((acc, b) => acc + b.availableStock, 0);

  // If not even enough batches recorded (e.g. legacy product without batches yet),
  // we first auto-create an initial batch from existing product stock to ensure 100% smooth backward compatibility!
  if (availableBatches.length === 0 && product.stock >= qty && product.expiryDate > now) {
    const initBatchNumber = `LEGACY-${product._id.toString().slice(-6).toUpperCase()}`;
    const legacyBatch = await Batch.create({
      product: product._id,
      seller: product.owner,
      batchNumber: initBatchNumber,
      initialQuantity: product.stock,
      availableStock: product.stock,
      reservedStock: 0,
      soldStock: 0,
      expiredStock: 0,
      expiryDate: product.expiryDate,
      isActive: true,
    });
    availableBatches.push(legacyBatch);
  } else if (totalAvailable < qty) {
    throw new Error(`Insufficient stock available. Only ${totalAvailable} units available.`);
  }

  let remaining = qty;
  const allocatedBatches = [];
  const deductedSteps = [];

  for (const b of availableBatches) {
    if (remaining <= 0) break;

    const toDeduct = Math.min(remaining, b.availableStock);
    if (toDeduct <= 0) continue;

    // ATOMIC conditional update: only decrement if availableStock >= toDeduct
    const updated = await Batch.findOneAndUpdate(
      {
        _id: b._id,
        availableStock: { $gte: toDeduct },
      },
      {
        $inc: {
          availableStock: -toDeduct,
          soldStock: toDeduct,
        },
      },
      { returnDocument: "after" }
    );

    if (!updated) {
      // Race condition hit: another concurrent order took stock from this batch.
      // Re-fetch and continue to next available batch or re-attempt.
      continue;
    }

    allocatedBatches.push({
      batch: updated._id,
      batchNumber: updated.batchNumber,
      quantity: toDeduct,
      expiryDate: updated.expiryDate,
    });

    deductedSteps.push({
      batchId: updated._id,
      batchNumber: updated.batchNumber,
      deducted: toDeduct,
      remainingStock: updated.availableStock,
    });

    remaining -= toDeduct;
  }

  // If we could not fulfill all required quantity due to concurrent deductions:
  if (remaining > 0) {
    // Rollback whatever was deducted so far
    for (const step of deductedSteps) {
      await Batch.findByIdAndUpdate(step.batchId, {
        $inc: {
          availableStock: step.deducted,
          soldStock: -step.deducted,
        },
      });
    }
    throw new Error("Unable to fulfill full order quantity due to concurrent purchases. Please retry.");
  }

  // Record audit transactions for each allocated batch
  for (const step of deductedSteps) {
    await InventoryTransaction.create({
      product: product._id,
      productName: product.name,
      batch: step.batchId,
      batchNumber: step.batchNumber,
      seller: product.owner,
      type: "ORDER_PURCHASE",
      quantityDelta: -step.deducted,
      previousAvailableStock: step.remainingStock + step.deducted,
      newAvailableStock: step.remainingStock,
      referenceId: orderId || paymentId,
      reason: `Order purchase by ${buyerName || "buyer"}`,
      performedBy: buyerId || product.owner,
      performedByName: buyerName || "Buyer",
    });
  }

  // Synchronize product aggregate stock
  await syncProductAggregateStock(productId);

  return {
    allocatedBatches,
    totalDeducted: qty,
  };
};

/**
 * Safe stock restoration on order cancellation or failure.
 */
export const restoreOrderStock = async ({
  order,
  performedBy,
  performedByName = "System",
  reason = "Order cancelled",
}) => {
  if (!order) return;
  if (!order.allocatedBatches || order.allocatedBatches.length === 0) {
    // If order has no batch allocations (e.g. older legacy order), restore directly to product
    const product = await Product.findById(order.product);
    if (product) {
      product.stock += order.quantity;
      if (product.expiryDate > new Date()) {
        product.isActive = true;
      }
      await product.save();
    }
    return;
  }

  const now = new Date();

  for (const item of order.allocatedBatches) {
    const batch = await Batch.findById(item.batch);
    if (!batch) continue;

    const isExpired = new Date(batch.expiryDate) <= now;

    if (isExpired) {
      // If batch expired while order was in transit/pending, move to expiredStock
      batch.expiredStock += item.quantity;
      batch.soldStock = Math.max(0, batch.soldStock - item.quantity);
      await batch.save();

      await InventoryTransaction.create({
        product: order.product,
        productName: order.productName,
        batch: batch._id,
        batchNumber: batch.batchNumber,
        seller: order.seller,
        type: "EXPIRED_DISCARD",
        quantityDelta: 0,
        previousAvailableStock: batch.availableStock,
        newAvailableStock: batch.availableStock,
        referenceId: order.orderId || order._id.toString(),
        reason: `Restored cancelled order item expired on ${batch.expiryDate.toISOString().split("T")[0]}`,
        performedBy,
        performedByName,
      });
    } else {
      // Restore to availableStock
      const prevStock = batch.availableStock;
      batch.availableStock += item.quantity;
      batch.soldStock = Math.max(0, batch.soldStock - item.quantity);
      batch.isActive = true;
      await batch.save();

      await InventoryTransaction.create({
        product: order.product,
        productName: order.productName,
        batch: batch._id,
        batchNumber: batch.batchNumber,
        seller: order.seller,
        type: "ORDER_CANCEL_RESTORE",
        quantityDelta: item.quantity,
        previousAvailableStock: prevStock,
        newAvailableStock: batch.availableStock,
        referenceId: order.orderId || order._id.toString(),
        reason,
        performedBy,
        performedByName,
      });
    }
  }

  // Synchronize aggregate product stock
  if (order.product) {
    await syncProductAggregateStock(order.product);
  }
  if (order.isCombo && Array.isArray(order.combo?.items)) {
    for (const itm of order.combo.items) {
      if (itm.product && (!order.product || itm.product.toString() !== order.product.toString())) {
        await syncProductAggregateStock(itm.product);
      }
    }
  }
};

/**
 * Manually adjust stock for a batch (e.g. damaged goods, inventory count adjustment).
 */
export const adjustBatchStock = async ({
  batchId,
  sellerId,
  newStock,
  reason,
  performedBy,
  performedByName = "Seller",
}) => {
  const stockNum = Number(newStock);
  if (isNaN(stockNum) || stockNum < 0) {
    throw new Error("Adjusted stock cannot be negative");
  }

  const batch = await Batch.findById(batchId).populate("product");
  if (!batch) {
    throw new Error("Batch not found");
  }

  if (batch.seller.toString() !== sellerId.toString() && performedByName !== "Admin") {
    throw new Error("Not authorized to adjust this batch");
  }

  const prevStock = batch.availableStock;
  const delta = stockNum - prevStock;

  batch.availableStock = stockNum;
  if (stockNum === 0 && new Date(batch.expiryDate) <= new Date()) {
    batch.isActive = false;
  }
  await batch.save();

  await InventoryTransaction.create({
    product: batch.product._id,
    productName: batch.product.name,
    batch: batch._id,
    batchNumber: batch.batchNumber,
    seller: batch.seller,
    type: "MANUAL_ADJUSTMENT",
    quantityDelta: delta,
    previousAvailableStock: prevStock,
    newAvailableStock: stockNum,
    reason: reason || "Manual inventory adjustment",
    performedBy,
    performedByName,
  });

  await syncProductAggregateStock(batch.product._id);

  return batch;
};

/**
 * Delete or discard an individual batch and synchronize aggregate product stock.
 */
export const deleteBatchById = async ({
  batchId,
  sellerId,
  isAdmin = false,
  performedBy,
  performedByName = "Seller",
}) => {
  const query = { _id: batchId };
  if (!isAdmin) query.seller = sellerId;

  const batch = await Batch.findOne(query).populate("product");
  if (!batch) {
    throw new Error("Batch not found or not authorized to delete");
  }

  const productId = batch.product?._id || batch.product;

  if (productId) {
    try {
      await InventoryTransaction.create({
        product: productId,
        productName: batch.product?.name || "Product",
        batch: batch._id,
        batchNumber: batch.batchNumber,
        seller: batch.seller,
        type: "EXPIRED_DISCARD",
        quantityDelta: -(batch.availableStock || 0),
        previousAvailableStock: batch.availableStock || 0,
        newAvailableStock: 0,
        reason: "Batch deleted / removed by seller",
        performedBy,
        performedByName,
      });
    } catch (txErr) {
      console.warn("Inventory transaction logging warning on batch delete:", txErr.message);
    }
  }

  await Batch.deleteOne({ _id: batchId });

  if (productId) {
    await syncProductAggregateStock(productId);
  }

  return { success: true, message: `Batch "${batch.batchNumber}" removed successfully` };
};

/**
 * Clear all expired batches in bulk for a seller and synchronize product stock.
 */
export const clearAllExpiredBatchesService = async ({
  sellerId,
  isAdmin = false,
  performedBy,
  performedByName = "Seller",
}) => {
  const now = new Date();
  const query = {
    $or: [{ expiryDate: { $lte: now } }, { expiredStock: { $gt: 0 } }],
  };
  if (!isAdmin) query.seller = sellerId;

  const expiredBatches = await Batch.find(query).populate("product");
  if (expiredBatches.length === 0) {
    return { success: true, count: 0, message: "No expired batches found to remove" };
  }

  const affectedProductIds = new Set();

  for (const b of expiredBatches) {
    const pId = b.product?._id || b.product;
    if (pId) affectedProductIds.add(pId.toString());

    await InventoryTransaction.create({
      product: pId,
      productName: b.product?.name || "Product",
      batch: b._id,
      batchNumber: b.batchNumber,
      seller: b.seller,
      type: "EXPIRED_DISCARD",
      quantityDelta: -(b.availableStock || 0),
      previousAvailableStock: b.availableStock || 0,
      newAvailableStock: 0,
      reason: "Bulk purge of expired batches",
      performedBy,
      performedByName,
    });
  }

  const batchIds = expiredBatches.map((b) => b._id);
  await Batch.deleteMany({ _id: { $in: batchIds } });

  for (const pId of affectedProductIds) {
    await syncProductAggregateStock(pId);
  }

  return {
    success: true,
    count: expiredBatches.length,
    message: `Successfully removed ${expiredBatches.length} expired batch(es)`,
  };
};
