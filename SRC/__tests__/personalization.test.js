import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../models/userSchema.js";
import Product from "../models/productSchema.js";
import jwt from "jsonwebtoken";

let mongoServer;
let userToken;
let userId;
let productId;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  const user = await User.create({
    fullName: "Priya Sharma",
    email: "priya@example.com",
    phone: "9876543222",
    password: "hashedpassword",
    accountType: "household",
    isVerified: true,
  });
  userId = user._id;
  userToken = jwt.sign({ id: userId }, process.env.JWT_SECRET || "testsecret");

  const product = await Product.create({
    name: "Organic Whole Wheat Bread",
    category: "Bakery",
    marketPrice: 50,
    discountPrice: 35,
    quantity: 1,
    unit: "packs",
    stock: 12,
    expiryDate: new Date(Date.now() + 3 * 86400000),
    owner: userId,
    ownerName: "Priya Sharma",
    ownerType: "household",
    location: { type: "Point", coordinates: [0, 0] },
  });
  productId = product._id;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe("Personalization & Customer Experience", () => {
  let createdAddressId;

  describe("Saved Delivery Addresses", () => {
    it("should allow a user to add a saved address", async () => {
      const res = await request(app)
        .post("/api/users/addresses")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          label: "Home",
          name: "Priya Sharma",
          phone: "9876543222",
          email: "priya@example.com",
          street: "Flat 402, Green Valley Apts",
          city: "Pune",
          state: "Maharashtra",
          pincode: "411001",
          isDefault: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.addresses.length).toBe(1);
      expect(res.body.addresses[0].isDefault).toBe(true);
      expect(res.body.addresses[0].street).toBe("Flat 402, Green Valley Apts");

      createdAddressId = res.body.addresses[0]._id;
    });

    it("should retrieve saved addresses", async () => {
      const res = await request(app)
        .get("/api/users/addresses")
        .set("Authorization", `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.addresses.length).toBe(1);
    });

    it("should update a saved address", async () => {
      const res = await request(app)
        .put(`/api/users/addresses/${createdAddressId}`)
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          street: "Flat 502, Green Valley Apts (Updated)",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const updated = res.body.addresses.find((a) => a._id === createdAddressId);
      expect(updated.street).toBe("Flat 502, Green Valley Apts (Updated)");
    });
  });

  describe("Wishlist Operations", () => {
    it("should toggle a product into wishlist", async () => {
      const res = await request(app)
        .post(`/api/users/wishlist/${productId}`)
        .set("Authorization", `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.isWishlisted).toBe(true);
    });

    it("should retrieve active wishlisted products", async () => {
      const res = await request(app)
        .get("/api/users/wishlist")
        .set("Authorization", `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.wishlist.length).toBe(1);
      expect(res.body.wishlist[0].name).toBe("Organic Whole Wheat Bread");
    });

    it("should toggle product out of wishlist", async () => {
      const res = await request(app)
        .post(`/api/users/wishlist/${productId}`)
        .set("Authorization", `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.isWishlisted).toBe(false);
    });
  });

  describe("Notification Preferences", () => {
    it("should get default notification preferences", async () => {
      const res = await request(app)
        .get("/api/users/preferences")
        .set("Authorization", `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.preferences.priceDropAlerts).toBe(true);
    });

    it("should update notification preferences", async () => {
      const res = await request(app)
        .put("/api/users/preferences")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          priceDropAlerts: false,
          donationAlerts: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.preferences.priceDropAlerts).toBe(false);
      expect(res.body.preferences.donationAlerts).toBe(true);
    });
  });
});
