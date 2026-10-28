import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import Donation from "../models/DonationSchema.js";
import User from "../models/userSchema.js";
import jwt from "jsonwebtoken";

let mongoServer;
let sellerToken;
let sellerId;
let ngoToken;
let ngoId;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  const seller = await User.create({
    fullName: "Baker John",
    email: "baker@example.com",
    phone: "9876543210",
    password: "hashedpassword",
    accountType: "shop",
    isVerified: true,
    city: "Mumbai",
    location: { type: "Point", coordinates: [72.8777, 19.076] },
  });
  sellerId = seller._id;
  sellerToken = jwt.sign({ id: sellerId }, process.env.JWT_SECRET || "testsecret");

  const ngo = await User.create({
    fullName: "Robin Hood Army",
    email: "robinhood@example.com",
    phone: "9123456789",
    password: "hashedpassword",
    accountType: "household",
    isVerified: true,
    city: "Mumbai",
    location: { type: "Point", coordinates: [72.8777, 19.076] },
  });
  ngoId = ngo._id;
  ngoToken = jwt.sign({ id: ngoId }, process.env.JWT_SECRET || "testsecret");
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe("Surplus Food Donation Module", () => {
  let createdDonationId;
  let receivedPickupOtp;

  describe("POST /api/donations (Create Donation Listing)", () => {
    it("should reject donation if food safety is not confirmed", async () => {
      const res = await request(app)
        .post("/api/donations")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({
          title: "15 Loaves of Bread",
          category: "Bakery",
          quantity: 15,
          unit: "units",
          expiryDate: new Date(Date.now() + 48 * 3600 * 1000),
          foodSafetyConfirmed: false,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/food safety/i);
    });

    it("should create donation listing with calculated impact metrics", async () => {
      const res = await request(app)
        .post("/api/donations")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({
          title: "Fresh Baked Bread Loaves",
          description: "Freshly baked artisan loaves from morning batch",
          category: "Bakery",
          quantity: 20,
          unit: "kg",
          expiryDate: new Date(Date.now() + 72 * 3600 * 1000),
          pickupStartDate: new Date(),
          pickupEndDate: new Date(Date.now() + 24 * 3600 * 1000),
          pickupInstructions: "Collect from rear loading bay between 5 PM and 8 PM",
          foodSafetyConfirmed: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.donation).toBeDefined();
      expect(res.body.donation.status).toBe("available");
      expect(res.body.donation.impact.estimatedMeals).toBeGreaterThan(0);
      expect(res.body.donation.impact.co2SavedKg).toBeGreaterThan(0);

      createdDonationId = res.body.donation._id;
    });
  });

  describe("GET /api/donations (Browse Available Donations)", () => {
    it("should return available unexpired donations", async () => {
      const res = await request(app).get("/api/donations");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.donations)).toBe(true);
      expect(res.body.donations.length).toBeGreaterThan(0);
    });

    it("should filter donations by category", async () => {
      const res = await request(app)
        .get("/api/donations")
        .query({ category: "Bakery" });

      expect(res.status).toBe(200);
      expect(res.body.donations.every((d) => d.category === "Bakery")).toBe(true);
    });
  });

  describe("POST /api/donations/:id/claim (NGO Claim Request)", () => {
    it("should prevent donor from claiming their own donation", async () => {
      const res = await request(app)
        .post(`/api/donations/${createdDonationId}/claim`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ ngoName: "Baker John" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cannot claim your own/i);
    });

    it("should allow an NGO to claim an available donation and issue a pickup OTP", async () => {
      const res = await request(app)
        .post(`/api/donations/${createdDonationId}/claim`)
        .set("Authorization", `Bearer ${ngoToken}`)
        .send({
          ngoName: "Robin Hood Army NGO",
          ngoPhone: "9123456789",
          ngoRegistrationNumber: "NGO-MH-2024-8841",
          notes: "Our volunteer team will arrive at 6 PM in an insulated delivery van.",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.pickupOtp).toBeDefined();
      expect(res.body.donation.status).toBe("requested");

      receivedPickupOtp = res.body.pickupOtp;
    });
  });

  describe("PUT /api/donations/:id/approve (Donor Approves Claim)", () => {
    it("should allow donor to approve the claim request", async () => {
      const res = await request(app)
        .put(`/api/donations/${createdDonationId}/approve`)
        .set("Authorization", `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.donation.status).toBe("approved");
    });
  });

  describe("POST /api/donations/:id/verify-pickup (Physical Handoff OTP Verification)", () => {
    it("should reject invalid pickup OTP", async () => {
      const res = await request(app)
        .post(`/api/donations/${createdDonationId}/verify-pickup`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ otp: "000000" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid pickup/i);
    });

    it("should complete donation when correct OTP is verified", async () => {
      const res = await request(app)
        .post(`/api/donations/${createdDonationId}/verify-pickup`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ otp: receivedPickupOtp });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.donation.status).toBe("completed");
      expect(res.body.donation.pickupOtpVerified).toBe(true);
      expect(res.body.donation.completedAt).toBeDefined();
    });
  });

  describe("GET /api/donations/impact (Community Impact Report)", () => {
    it("should return cumulative meals rescued and CO2 diverted", async () => {
      const res = await request(app).get("/api/donations/impact");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.stats.totalCompletedDonations).toBeGreaterThan(0);
      expect(res.body.stats.totalMealsRescued).toBeGreaterThan(0);
      expect(res.body.stats.totalCo2SavedKg).toBeGreaterThan(0);
    });
  });
});
