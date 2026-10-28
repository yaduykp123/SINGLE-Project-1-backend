import express from "express";
import {
  createDonation,
  getDonations,
  getDonationById,
  requestDonation,
  approveDonation,
  verifyPickup,
  cancelDonation,
  getMyDonations,
  getClaimedDonations,
  getDonationImpactStats,
} from "../controllers/donationController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Public / open discovery
router.get("/impact", getDonationImpactStats);
router.get("/", getDonations);

// Authenticated endpoints
router.post("/", protect, createDonation);
router.get("/my-donations", protect, getMyDonations);
router.get("/my-claims", protect, getClaimedDonations);
router.get("/:id", protect, getDonationById);
router.post("/:id/claim", protect, requestDonation);
router.put("/:id/approve", protect, approveDonation);
router.post("/:id/verify-pickup", protect, verifyPickup);
router.put("/:id/cancel", protect, cancelDonation);

export default router;
