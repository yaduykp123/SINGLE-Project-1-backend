import "dotenv/config";
import mongoose from "mongoose";
import Product from "../SRC/models/productSchema.js";
import Batch from "../SRC/models/BatchSchema.js";
import InventoryTransaction from "../SRC/models/InventoryTransactionSchema.js";

const migrate = async () => {
  const mongoUri = process.env.MDB_URL || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/expireoff";
  console.log(`[MIGRATION] Connecting to MongoDB: ${mongoUri}...`);

  await mongoose.connect(mongoUri);
  console.log("[MIGRATION] Connected successfully.");

  const now = new Date();
  const products = await Product.find({});
  console.log(`[MIGRATION] Found ${products.length} products to check for batches.`);

  let createdCount = 0;
  let skippedCount = 0;

  for (const product of products) {
    const existingBatches = await Batch.find({ product: product._id });
    if (existingBatches.length > 0) {
      skippedCount++;
      continue;
    }

    const isExpired = new Date(product.expiryDate) <= now;
    const initialQty = Number(product.stock) || 1;
    const available = isExpired ? 0 : initialQty;
    const expired = isExpired ? initialQty : 0;
    const batchNumber = `BATCH-INIT-${product._id.toString().slice(-6).toUpperCase()}`;

    const batch = await Batch.create({
      product: product._id,
      seller: product.owner,
      batchNumber,
      initialQuantity: initialQty,
      availableStock: available,
      reservedStock: 0,
      soldStock: 0,
      expiredStock: expired,
      expiryDate: product.expiryDate,
      costPrice: product.discountPrice ? Math.round(product.discountPrice * 0.7) : 0,
      isActive: product.isActive && !isExpired && available > 0,
    });

    await InventoryTransaction.create({
      product: product._id,
      productName: product.name,
      batch: batch._id,
      batchNumber,
      seller: product.owner,
      type: "INITIAL_MIGRATION",
      quantityDelta: initialQty,
      previousAvailableStock: 0,
      newAvailableStock: available,
      reason: "Initial migration from legacy product schema into batch inventory system",
      performedBy: product.owner,
      performedByName: "Migration Script",
    });

    createdCount++;
  }

  console.log(`[MIGRATION COMPLETE] Created initial batches for ${createdCount} products. Skipped ${skippedCount} products that already had batches.`);
  await mongoose.disconnect();
};

migrate().catch((err) => {
  console.error("[MIGRATION FAILED]", err);
  process.exit(1);
});
