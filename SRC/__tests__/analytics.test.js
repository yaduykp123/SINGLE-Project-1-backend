import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import Order from "../models/OrderSchema.js";
import Batch from "../models/BatchSchema.js";
import Product from "../models/productSchema.js";
import User from "../models/userSchema.js";
import jwt from "jsonwebtoken";

let mongoServer;
let sellerToken;
let sellerId;
let buyerId;
let productId;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  const seller = await User.create({
    fullName: "Supermart Store",
    email: "supermart@example.com",
    phone: "9876543200",
    password: "hashedpassword",
    accountType: "shop",
    isVerified: true,
  });
  sellerId = seller._id;
  sellerToken = jwt.sign({ id: sellerId }, process.env.JWT_SECRET || "testsecret");

  const buyer = await User.create({
    fullName: "Alice Buyer",
    email: "alice@example.com",
    phone: "9876543201",
    password: "hashedpassword",
    accountType: "household",
    isVerified: true,
  });
  buyerId = buyer._id;

  const product = await Product.create({
    name: "Fresh Whole Milk",
    category: "Dairy",
    marketPrice: 60,
    discountPrice: 45,
    quantity: 1,
    unit: "ltr",
    stock: 25,
    expiryDate: new Date(Date.now() + 4 * 86400000),
    owner: sellerId,
    ownerName: "Supermart Store",
    ownerType: "shop",
    location: { type: "Point", coordinates: [0, 0] },
  });
  productId = product._id;

  // Create Batch
  await Batch.create({
    product: productId,
    seller: sellerId,
    batchNumber: "MILK-BATCH-01",
    initialQuantity: 30,
    availableStock: 3, // Low stock <= 5
    reservedStock: 0,
    soldStock: 27,
    expiredStock: 0,
    expiryDate: new Date(Date.now() + 3 * 86400000), // Approaching expiry
    isActive: true,
  });

  // Create Non-cancelled Order
  await Order.create({
    product: productId,
    productName: "Fresh Whole Milk",
    quantity: 2,
    unitPrice: 45,
    totalAmount: 90,
    buyer: buyerId,
    buyerName: "Alice Buyer",
    buyerEmail: "alice@example.com",
    buyerPhone: "9876543201",
    shippingAddress: {
      name: "Alice",
      phone: "9876543201",
      email: "alice@example.com",
      street: "123 Main St",
      city: "Mumbai",
      state: "MH",
      pincode: "400001",
    },
    seller: sellerId,
    sellerName: "Supermart Store",
    paymentId: "pay_test_analytics_01",
    orderId: "order_test_analytics_01",
    status: "delivered",
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe("Seller Analytics Engine", () => {
  it("should return comprehensive analytics overview and waste avoided stats", async () => {
    const res = await request(app)
      .get("/api/analytics/seller-dashboard")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.overview.totalRevenue).toBe(90);
    expect(res.body.overview.totalOrders).toBe(1);
    expect(res.body.overview.totalUnitsSold).toBe(2);
    expect(res.body.overview.averageOrderValue).toBe(90);
    expect(res.body.wasteAvoided.unitsRescued).toBe(2);
    expect(res.body.wasteAvoided.estimatedKgRescued).toBeGreaterThan(0);
    expect(res.body.wasteAvoided.estimatedCo2SavedKg).toBeGreaterThan(0);
    expect(res.body.wasteAvoided.estimatedMealsRescued).toBeGreaterThan(0);
  });

  it("should return daily trend and top products", async () => {
    const res = await request(app)
      .get("/api/analytics/seller-dashboard")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.dailyTrend)).toBe(true);
    expect(res.body.dailyTrend.length).toBe(1);
    expect(res.body.dailyTrend[0].revenue).toBe(90);

    expect(Array.isArray(res.body.topProducts)).toBe(true);
    expect(res.body.topProducts.length).toBe(1);
    expect(res.body.topProducts[0].productName).toBe("Fresh Whole Milk");
  });

  it("should identify low stock and approaching expiry batches", async () => {
    const res = await request(app)
      .get("/api/analytics/seller-dashboard")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.inventoryHealth.lowStockBatches.length).toBeGreaterThan(0);
    expect(res.body.inventoryHealth.approachingExpiryBatches.length).toBeGreaterThan(0);
    expect(res.body.inventoryHealth.lowStockBatches[0].batchNumber).toBe("MILK-BATCH-01");
  });

  it("should support timeRange query parameters (7d, 30d, 90d, all)", async () => {
    const res = await request(app)
      .get("/api/analytics/seller-dashboard?timeRange=7d")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.timeRange).toBe("7d");
  });
});
