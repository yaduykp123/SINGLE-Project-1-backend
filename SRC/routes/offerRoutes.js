import express from "express";
import {
  createOffer,
  getActiveOffers,
  getOfferById,
  deleteOffer,
  getMyOffers,
} from "../controllers/offerController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", getActiveOffers);
router.get("/my-offers", protect, getMyOffers);
router.get("/:id", getOfferById);
router.post("/create", protect, createOffer);
router.delete("/:id", protect, deleteOffer);

export default router;