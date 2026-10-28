import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import jwt from "jsonwebtoken";
import app from "../app.js";
import Product from "../models/productSchema.js";
import Batch from "../models/BatchSchema.js";
import Order from "../models/OrderSchema.js";
import User from "../models/userSchema.js";
import InventoryTransaction from "../models/InventoryTransactionSchema.js";
import {
  deductStockFEFO,
  restoreOrderStock,
  syncProductAggregateStock,
  createBatch,
} from "../services/inventoryService.js";
import {
  calculateDiscountSuggestion,
  getSuggestionsForSeller,
  applyBatchDiscount,
} from "../services/discountSuggestionService.js";
import { processBatchExpiryChecks } from "../services/batchExpiryService.js";

let mongoServer;
let sellerId, buyerId, otherSellerId;
let sellerToken, buyerToken, otherSellerToken;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  const seller = await User.create({
    fullName: "Test Seller",
    email: "seller@expireoff.test",
    phone: "9876543210",
    password: "hashedpassword",
    accountType: "shop",
    isVerified: true,
  });
  sellerId = seller._id;
  sellerToken = jwt.sign({ id: sellerId }, process.env.JWT_SECRET || "testsecret");

  const otherSeller = await User.create({
    fullName: "Other Seller",
    email: "other@expireoff.test",
    phone: "9876543212",
    password: "hashedpassword",
    accountType: "shop",
    isVerified: true,
  });
  otherSellerId = otherSeller._id;
  otherSellerToken = jwt.sign({ id: otherSellerId }, process.env.JWT_SECRET || "testsecret");

  const buyer = await User.create({
    fullName: "Test Buyer",
    email: "buyer@expireoff.test",
    phone: "9876543211",
    password: "hashedpassword",
    accountType: "household",
    isVerified: true,
  });
  buyerId = buyer._id;
  buyerToken = jwt.sign({ id: buyerId }, process.env.JWT_SECRET || "testsecret");
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe("Smart Expiry & Inventory Management System Tests", () => {
  let testProduct;

  beforeEach(async () => {
    testProduct = await Product.create({
      name: "Organic Milk 1L",
      brand: "Farm Fresh",
      category: "Dairy",
      marketPrice: 60,
      discountPrice: 45,
      quantity: 1,
      unit: "ltr",
      stock: 0,
      expiryDate: new Date(Date.now() + 10 * 86400000),
      owner: sellerId,
      ownerName: "Test Seller",
      ownerType: "shop",
      location: { type: "Point", coordinates: [77.209, 28.6139] },
      city: "Delhi",
      isActive: true,
    });
  });

  afterEach(async () => {
    await Product.deleteMany({});
    await Batch.deleteMany({});
    await Order.deleteMany({});
    await InventoryTransaction.deleteMany({});
  });

  // 1. Creating multiple batches for one product
  it("Scenario 1: should create multiple batches for one product and sync aggregate stock", async () => {
    const batch1 = await createBatch({
      productId: testProduct._id,
      sellerId,
      batchNumber: "BATCH-MILK-001",
      quantity: 10,
      expiryDate: new Date(Date.now() + 3 * 86400000), // expires in 3 days
      performedBy: sellerId,
    });

    const batch2 = await createBatch({
      productId: testProduct._id,
      sellerId,
      batchNumber: "BATCH-MILK-002",
      quantity: 15,
      expiryDate: new Date(Date.now() + 7 * 86400000), // expires in 7 days
      performedBy: sellerId,
    });

    expect(batch1.batchNumber).toBe("BATCH-MILK-001");
    expect(batch2.batchNumber).toBe("BATCH-MILK-002");

    // Product aggregate stock should be 10 + 15 = 25
    const syncRes = await syncProductAggregateStock(testProduct._id);
    expect(syncRes.totalStock).toBe(25);

    const updatedProduct = await Product.findById(testProduct._id);
    expect(updatedProduct.stock).toBe(25);
    // Product expiryDate should match earliest batch (batch1)
    expect(new Date(updatedProduct.expiryDate).getTime()).toBe(new Date(batch1.expiryDate).getTime());
  });

  // 2. Purchasing from the earliest-expiring valid batch (FEFO)
  it("Scenario 2: should allocate and deduct stock following FEFO order", async () => {
    // Create batch expiring in 2 days (earliest) with 5 units
    const batchEarly = await Batch.create({
      product: testProduct._id,
      seller: sellerId,
      batchNumber: "FEFO-EARLY",
      initialQuantity: 5,
      availableStock: 5,
      soldStock: 0,
      expiryDate: new Date(Date.now() + 2 * 86400000),
      isActive: true,
    });

    // Create batch expiring in 6 days (later) with 10 units
    const batchLater = await Batch.create({
      product: testProduct._id,
      seller: sellerId,
      batchNumber: "FEFO-LATER",
      initialQuantity: 10,
      availableStock: 10,
      soldStock: 0,
      expiryDate: new Date(Date.now() + 6 * 86400000),
      isActive: true,
    });

    await syncProductAggregateStock(testProduct._id);

    // Request 8 units -> should take 5 from FEFO-EARLY and 3 from FEFO-LATER
    const result = await deductStockFEFO({
      productId: testProduct._id,
      requestedQuantity: 8,
      orderId: "ORD-FEFO-TEST",
      paymentId: "PAY-FEFO-TEST",
      buyerId,
      buyerName: "Test Buyer",
    });

    expect(result.allocatedBatches.length).toBe(2);
    expect(result.allocatedBatches[0].batchNumber).toBe("FEFO-EARLY");
    expect(result.allocatedBatches[0].quantity).toBe(5);
    expect(result.allocatedBatches[1].batchNumber).toBe("FEFO-LATER");
    expect(result.allocatedBatches[1].quantity).toBe(3);

    // Verify batch balances in database
    const freshEarly = await Batch.findById(batchEarly._id);
    const freshLater = await Batch.findById(batchLater._id);
    expect(freshEarly.availableStock).toBe(0);
    expect(freshEarly.soldStock).toBe(5);
    expect(freshLater.availableStock).toBe(7);
    expect(freshLater.soldStock).toBe(3);

    // Verify aggregate product stock
    const freshProduct = await Product.findById(testProduct._id);
    expect(freshProduct.stock).toBe(7);
  });

  // 3. Hiding expired products from customer listings
  it("Scenario 3: should exclude expired and out-of-stock products from customer listings", async () => {
    // Expired product
    await Product.create({
      name: "Expired Bread",
      category: "Grocery Items",
      marketPrice: 40,
      discountPrice: 20,
      quantity: 1,
      unit: "packs",
      stock: 5,
      expiryDate: new Date(Date.now() - 86400000), // Expired yesterday
      owner: sellerId,
      ownerName: "Test Seller",
      ownerType: "shop",
      location: { type: "Point", coordinates: [77.209, 28.6139] },
      isActive: true,
    });

    // Out-of-stock product
    await Product.create({
      name: "Out of Stock Rice",
      category: "Grocery Items",
      marketPrice: 100,
      discountPrice: 80,
      quantity: 1,
      unit: "kg",
      stock: 0, // 0 stock
      expiryDate: new Date(Date.now() + 30 * 86400000),
      owner: sellerId,
      ownerName: "Test Seller",
      ownerType: "shop",
      location: { type: "Point", coordinates: [77.209, 28.6139] },
      isActive: true,
    });

    // Active in-stock product
    testProduct.stock = 10;
    await testProduct.save();

    const res = await request(app).get("/api/products");
    expect(res.status).toBe(200);

    const names = res.body.map((p) => p.name);
    expect(names).toContain("Organic Milk 1L");
    expect(names).not.toContain("Expired Bread");
    expect(names).not.toContain("Out of Stock Rice");
  });

  // 4. Rejecting expired inventory during checkout
  it("Scenario 4: should reject checkout if product is expired", async () => {
    const expiredProduct = await Product.create({
      name: "Expired Curd",
      category: "Dairy",
      marketPrice: 50,
      discountPrice: 30,
      quantity: 1,
      unit: "packs",
      stock: 10,
      expiryDate: new Date(Date.now() - 10000), // Expired
      owner: sellerId,
      ownerName: "Test Seller",
      ownerType: "shop",
      location: { type: "Point", coordinates: [77.209, 28.6139] },
      isActive: false,
    });

    const res = await request(app)
      .post("/api/orders/verify-payment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        razorpay_order_id: "order_exp_123",
        razorpay_payment_id: "pay_exp_123",
        razorpay_signature: "dummy_sig",
        productId: expiredProduct._id,
        quantity: 1,
        shippingAddress: {
          name: "Buyer",
          phone: "9876543210",
          email: "buyer@expireoff.test",
          street: "123 Street",
          city: "Delhi",
          state: "Delhi",
          pincode: "110001",
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/i);
  });

  // 5. Preventing overselling during concurrent orders
  it("Scenario 5: should prevent overselling when requested quantity exceeds available stock", async () => {
    await Batch.create({
      product: testProduct._id,
      seller: sellerId,
      batchNumber: "CONCURRENT-BATCH",
      initialQuantity: 5,
      availableStock: 5,
      soldStock: 0,
      expiryDate: new Date(Date.now() + 5 * 86400000),
      isActive: true,
    });
    await syncProductAggregateStock(testProduct._id);

    // Order 1: 4 units -> Success
    const res1 = await deductStockFEFO({
      productId: testProduct._id,
      requestedQuantity: 4,
      orderId: "ORD-C1",
      paymentId: "PAY-C1",
      buyerId,
      buyerName: "Buyer 1",
    });
    expect(res1.totalDeducted).toBe(4);

    // Order 2: 3 units -> Should fail since only 1 unit remains
    await expect(
      deductStockFEFO({
        productId: testProduct._id,
        requestedQuantity: 3,
        orderId: "ORD-C2",
        paymentId: "PAY-C2",
        buyerId,
        buyerName: "Buyer 2",
      })
    ).rejects.toThrow(/Insufficient stock/);

    const freshProduct = await Product.findById(testProduct._id);
    expect(freshProduct.stock).toBe(1);
  });

  // 6. Handling duplicate order requests and payment webhooks (idempotency)
  it("Scenario 6: should be idempotent and not deduct stock more than once for duplicate payment verification", async () => {
    await Batch.create({
      product: testProduct._id,
      seller: sellerId,
      batchNumber: "IDEMPOTENT-BATCH",
      initialQuantity: 10,
      availableStock: 10,
      soldStock: 0,
      expiryDate: new Date(Date.now() + 5 * 86400000),
      isActive: true,
    });
    await syncProductAggregateStock(testProduct._id);

    const payload = {
      razorpay_order_id: "order_idempotent_1",
      razorpay_payment_id: "pay_idempotent_1",
      razorpay_signature: "dummy_sig",
      productId: testProduct._id.toString(),
      quantity: 2,
      shippingAddress: {
        name: "Buyer",
        phone: "9876543210",
        email: "buyer@expireoff.test",
        street: "123 Street",
        city: "Delhi",
        state: "Delhi",
        pincode: "110001",
      },
    };

    // First payment verification call
    const res1 = await request(app)
      .post("/api/orders/verify-payment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send(payload);

    expect(res1.status).toBe(201);
    expect(res1.body.order).toBeDefined();

    const productAfterFirst = await Product.findById(testProduct._id);
    expect(productAfterFirst.stock).toBe(8);

    // Duplicate call with same paymentId (e.g. repeated webhook or network retry)
    const res2 = await request(app)
      .post("/api/orders/verify-payment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send(payload);

    expect(res2.status).toBe(200);
    expect(res2.body.message).toMatch(/already verified/i);

    // Stock must remain 8, NOT deducted again to 6!
    const productAfterSecond = await Product.findById(testProduct._id);
    expect(productAfterSecond.stock).toBe(8);

    // Only 1 order record in DB
    const orderCount = await Order.countDocuments({ paymentId: "pay_idempotent_1" });
    expect(orderCount).toBe(1);
  });

  // 7. Restoring inventory after cancellations
  it("Scenario 7: should safely restore batch stock when an order is cancelled", async () => {
    const batch = await Batch.create({
      product: testProduct._id,
      seller: sellerId,
      batchNumber: "RESTORE-BATCH",
      initialQuantity: 10,
      availableStock: 10,
      soldStock: 0,
      expiryDate: new Date(Date.now() + 4 * 86400000),
      isActive: true,
    });
    await syncProductAggregateStock(testProduct._id);

    // Place an order for 3 units
    const order = await Order.create({
      product: testProduct._id,
      productName: testProduct.name,
      quantity: 3,
      unitPrice: 45,
      totalAmount: 135,
      buyer: buyerId,
      buyerName: "Test Buyer",
      buyerEmail: "buyer@expireoff.test",
      buyerPhone: "9876543210",
      shippingAddress: {
        name: "Buyer",
        phone: "9876543210",
        email: "buyer@expireoff.test",
        street: "123 Street",
        city: "Delhi",
        state: "Delhi",
        pincode: "110001",
      },
      seller: sellerId,
      sellerName: "Test Seller",
      paymentId: "pay_restore_test",
      orderId: "order_restore_test",
      allocatedBatches: [
        {
          batch: batch._id,
          batchNumber: batch.batchNumber,
          quantity: 3,
          expiryDate: batch.expiryDate,
        },
      ],
      stockDeducted: true,
      status: "pending",
    });

    batch.availableStock = 7;
    batch.soldStock = 3;
    await batch.save();
    await syncProductAggregateStock(testProduct._id);

    // Cancel order via status update endpoint
    const res = await request(app)
      .put(`/api/orders/${order._id}/status`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");

    // Stock should be restored to 10
    const freshBatch = await Batch.findById(batch._id);
    expect(freshBatch.availableStock).toBe(10);
    expect(freshBatch.soldStock).toBe(0);

    const freshProduct = await Product.findById(testProduct._id);
    expect(freshProduct.stock).toBe(10);

    // Verify audit log
    const restoreTx = await InventoryTransaction.findOne({
      type: "ORDER_CANCEL_RESTORE",
      batch: batch._id,
    });
    expect(restoreTx).toBeDefined();
    expect(restoreTx.quantityDelta).toBe(3);
  });

  // 8. Sending expiry alerts without duplicates
  it("Scenario 8: should process multi-horizon expiry alerts without duplicate triggers", async () => {
    // Batch with 2 days left -> triggers 3-day alert
    const batch3d = await Batch.create({
      product: testProduct._id,
      seller: sellerId,
      batchNumber: "ALERT-3D",
      initialQuantity: 10,
      availableStock: 10,
      soldStock: 0,
      expiryDate: new Date(Date.now() + 2 * 86400000),
      isActive: true,
    });

    // Run first check
    const summary1 = await processBatchExpiryChecks();
    expect(summary1.threeDayAlerts).toBe(1);

    const updatedBatch3d = await Batch.findById(batch3d._id);
    expect(updatedBatch3d.alertsSent.threeDays).toBe(true);

    // Run second check immediately -> should not re-trigger duplicate alert!
    const summary2 = await processBatchExpiryChecks();
    expect(summary2.threeDayAlerts).toBe(0);
  });

  // 9. Generating and approving discount suggestions
  it("Scenario 9: should calculate intelligent discount suggestions based on remaining shelf life and approve", async () => {
    const batchClose = await Batch.create({
      product: testProduct._id,
      seller: sellerId,
      batchNumber: "DISC-BATCH",
      initialQuantity: 10,
      availableStock: 10,
      soldStock: 0,
      costPrice: 20,
      expiryDate: new Date(Date.now() + 2 * 86400000), // 2 days left (critical)
      isActive: true,
    });

    const suggestion = calculateDiscountSuggestion(batchClose, testProduct);
    expect(suggestion.canSell).toBe(true);
    // Baseline 35% + 5% Dairy modifier = 40%
    expect(suggestion.suggestedDiscountPercent).toBe(40);
    // 60 marketPrice with 40% off = 36
    expect(suggestion.suggestedPrice).toBe(36);

    // Approve the suggestion via service
    const approval = await applyBatchDiscount({
      batchId: batchClose._id,
      sellerId,
      discountPercent: suggestion.suggestedDiscountPercent,
      sellingPrice: suggestion.suggestedPrice,
    });

    expect(approval.batch.discountStatus).toBe("approved");
    expect(approval.batch.appliedDiscountPercent).toBe(40);
    expect(approval.product.discountPrice).toBe(36);
  });

  // 10. Enforcing seller-level access control
  it("Scenario 10: should prevent sellers from modifying another seller's inventory batches", async () => {
    const batch = await Batch.create({
      product: testProduct._id,
      seller: sellerId,
      batchNumber: "SELLER-1-BATCH",
      initialQuantity: 10,
      availableStock: 10,
      soldStock: 0,
      expiryDate: new Date(Date.now() + 5 * 86400000),
      isActive: true,
    });

    // Other seller attempts to adjust stock
    const res = await request(app)
      .put(`/api/inventory/batches/${batch._id}/adjust`)
      .set("Authorization", `Bearer ${otherSellerToken}`)
      .send({ newStock: 0, reason: "Unauthorized hack" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not authorized/i);
  });

  // 11. Inventory summary endpoint
  it("Scenario 11: should return comprehensive inventory summary for seller dashboard", async () => {
    await Batch.create({
      product: testProduct._id,
      seller: sellerId,
      batchNumber: "SUMMARY-BATCH",
      initialQuantity: 12,
      availableStock: 12,
      soldStock: 0,
      expiryDate: new Date(Date.now() + 4 * 86400000),
      isActive: true,
    });

    const res = await request(app)
      .get("/api/inventory/summary")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary.totalAvailableStock).toBe(12);
    expect(res.body.summary.approachingExpiryCount).toBe(1);
  });

  // 12. Batch listing and transaction audit endpoints
  it("Scenario 12: should return filtered batches and audit transactions", async () => {
    const batch = await createBatch({
      productId: testProduct._id,
      sellerId,
      batchNumber: "AUDIT-BATCH-1",
      quantity: 8,
      expiryDate: new Date(Date.now() + 5 * 86400000),
      performedBy: sellerId,
    });

    const batchesRes = await request(app)
      .get("/api/inventory/batches")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(batchesRes.status).toBe(200);
    expect(batchesRes.body.batches.length).toBe(1);
    expect(batchesRes.body.batches[0].batchNumber).toBe("AUDIT-BATCH-1");

    const txRes = await request(app)
      .get("/api/inventory/transactions")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(txRes.status).toBe(200);
    expect(txRes.body.transactions.length).toBeGreaterThanOrEqual(1);
    expect(txRes.body.transactions[0].type).toBe("BATCH_CREATE");
  });

  // 13. Delete individual batch
  it("Scenario 13: should delete an individual batch and synchronize product stock", async () => {
    const batch = await createBatch({
      productId: testProduct._id,
      sellerId,
      batchNumber: "DELETE-SINGLE-BATCH",
      quantity: 15,
      expiryDate: new Date(Date.now() + 6 * 86400000),
      performedBy: sellerId,
    });

    const res = await request(app)
      .delete(`/api/inventory/batches/${batch._id}`)
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const checkBatch = await Batch.findById(batch._id);
    expect(checkBatch).toBeNull();
  });

  // 14. Bulk clear expired batches
  it("Scenario 14: should clear all expired batches in bulk and sync product inventory", async () => {
    // Create an expired batch
    await Batch.create({
      product: testProduct._id,
      seller: sellerId,
      batchNumber: "EXPIRED-BULK-BATCH-1",
      initialQuantity: 10,
      availableStock: 10,
      expiredStock: 10,
      expiryDate: new Date(Date.now() - 2 * 86400000), // expired 2 days ago
      isActive: false,
    });

    const res = await request(app)
      .delete("/api/inventory/batches/expired/clear")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBeGreaterThanOrEqual(1);

    const expiredCheck = await Batch.find({
      seller: sellerId,
      batchNumber: "EXPIRED-BULK-BATCH-1",
    });
    expect(expiredCheck.length).toBe(0);
  });

  // 15. Bulk clear expired products
  it("Scenario 15: should clear all expired products in bulk", async () => {
    const expiredProduct = await Product.create({
      name: "Expired Milk",
      description: "Organic milk past best-before",
      category: "Dairy",
      marketPrice: 60,
      discountPrice: 30,
      quantity: 1,
      unit: "packs",
      stock: 5,
      expiryDate: new Date(Date.now() - 3 * 86400000), // expired
      owner: sellerId,
      ownerName: "Test Seller",
      ownerType: "shop",
      location: { type: "Point", coordinates: [77.209, 28.6139] },
      city: "Delhi",
      isActive: false,
    });

    const res = await request(app)
      .delete("/api/products/expired/clear")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBeGreaterThanOrEqual(1);

    const prodCheck = await Product.findById(expiredProduct._id);
    expect(prodCheck).toBeNull();
  });
});
