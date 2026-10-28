import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import Order from "../models/OrderSchema.js";
import Product from "../models/productSchema.js";
import Offer from "../models/OfferSchema.js";
import Notification from "../models/NotificationSchema.js";
import User from "../models/userSchema.js";
import jwt from "jsonwebtoken";

let mongoServer;
let buyerToken;
let sellerToken;
let buyerUser;
let sellerUser;
let activeProduct;
let expiredProduct;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  buyerUser = await User.create({
    fullName: "Rohan Buyer",
    email: "rohan@example.com",
    phone: "9876543210",
    password: "hashedpassword123",
    accountType: "household",
    isVerified: true,
  });
  buyerToken = jwt.sign({ id: buyerUser._id }, process.env.JWT_SECRET || "testsecret");

  sellerUser = await User.create({
    fullName: "Sharma Grocery",
    email: "sharma@example.com",
    phone: "9876543211",
    password: "hashedpassword123",
    accountType: "shop",
    isVerified: true,
    city: "Mumbai",
  });
  sellerToken = jwt.sign({ id: sellerUser._id }, process.env.JWT_SECRET || "testsecret");

  activeProduct = await Product.create({
    name: "Organic Honey",
    category: "Grocery Items",
    marketPrice: 200,
    discountPrice: 150,
    quantity: 1,
    unit: "bottle",
    stock: 20,
    expiryDate: new Date(Date.now() + 7 * 86400000),
    owner: sellerUser._id,
    ownerName: sellerUser.fullName,
    ownerType: "shop",
    location: { type: "Point", coordinates: [72.8777, 19.076] },
    city: "Mumbai",
    isActive: true,
  });

  expiredProduct = await Product.create({
    name: "Expired Milk",
    category: "Dairy",
    marketPrice: 50,
    discountPrice: 25,
    quantity: 1,
    unit: "packet",
    stock: 10,
    expiryDate: new Date(Date.now() - 86400000), // yesterday
    owner: sellerUser._id,
    ownerName: sellerUser.fullName,
    ownerType: "shop",
    location: { type: "Point", coordinates: [72.8777, 19.076] },
    city: "Mumbai",
    isActive: true,
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe("Real-Time Order, Notification, & Expiry Handling", () => {
  let createdOrderId;

  describe("Order Verification & Notification Routing (Tests A, B, D)", () => {
    it("should reject order placement for expired product (Expiry Guard - Test G)", async () => {
      const res = await request(app)
        .post("/api/orders/verify-payment")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          razorpay_order_id: "order_mock_exp",
          razorpay_payment_id: "pay_mock_exp",
          razorpay_signature: "sig_mock",
          productId: expiredProduct._id,
          quantity: 1,
          shippingAddress: {
            name: "Rohan Buyer",
            phone: "9876543210",
            email: "rohan@example.com",
            street: "42 Marine Drive",
            city: "Mumbai",
            state: "Maharashtra",
            pincode: "400020",
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/expired/i);
    });

    it("should successfully place order and create seller notification with deep link and entity references", async () => {
      const res = await request(app)
        .post("/api/orders/verify-payment")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          razorpay_order_id: "order_mock_valid_1",
          razorpay_payment_id: "pay_mock_valid_1",
          razorpay_signature: "sig_mock",
          productId: activeProduct._id,
          quantity: 2,
          shippingAddress: {
            name: "Rohan Buyer",
            phone: "9876543210",
            email: "rohan@example.com",
            street: "42 Marine Drive",
            city: "Mumbai",
            state: "Maharashtra",
            pincode: "400020",
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.order).toBeDefined();
      expect(res.body.order.productName).toBe("Organic Honey");
      createdOrderId = res.body.order._id;

      // Verify that seller received notification with entity references
      const sellerNotification = await Notification.findOne({
        user: sellerUser._id,
        entityId: createdOrderId,
      });

      expect(sellerNotification).toBeDefined();
      expect(sellerNotification.type).toBe("order");
      expect(sellerNotification.entityType).toBe("order");
      expect(sellerNotification.link).toBe(`/orders?orderId=${createdOrderId}`);
    });
  });

  describe("Seller Status Transition & Buyer Live Notification (Test C)", () => {
    it("should allow seller to confirm order and create status notification for buyer", async () => {
      const res = await request(app)
        .put(`/api/orders/${createdOrderId}/status`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ status: "confirmed" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("confirmed");

      // Verify buyer received status notification with deep link
      const buyerNotification = await Notification.findOne({
        user: buyerUser._id,
        entityId: createdOrderId,
      });

      expect(buyerNotification).toBeDefined();
      expect(buyerNotification.link).toBe(`/orders?orderId=${createdOrderId}`);
      expect(buyerNotification.message).toContain("Confirmed");
    });
  });

  describe("Offer Deactivation & Deletion (Test F)", () => {
    it("should create and safely deactivate an offer", async () => {
      const offer = await Offer.create({
        title: "Weekend Fruit Sale",
        description: "Fresh fruits discounted",
        discountPercentage: 25,
        category: "Fruits",
        shopOwner: sellerUser._id,
        products: [activeProduct._id],
        expiresAt: new Date(Date.now() + 86400000),
        isActive: true,
      });

      const res = await request(app)
        .delete(`/api/offers/${offer._id}`)
        .set("Authorization", `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updatedOffer = await Offer.findById(offer._id);
      expect(updatedOffer.isActive).toBe(false);
    });
  });

  describe("Notification Query Performance & Read Status (Test E)", () => {
    it("should mark notifications as read and return correct unread count", async () => {
      const notifsRes = await request(app)
        .get("/api/notifications")
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(notifsRes.status).toBe(200);
      expect(notifsRes.body.success).toBe(true);
      expect(notifsRes.body.notifications.length).toBeGreaterThanOrEqual(1);

      // Mark all as read
      const markRes = await request(app)
        .put("/api/notifications/read-all")
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(markRes.status).toBe(200);

      const refreshed = await request(app)
        .get("/api/notifications")
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(refreshed.body.unreadCount).toBe(0);
    });
  });
});
