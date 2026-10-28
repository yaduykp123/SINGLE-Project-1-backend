import express from "express";
import { getSellerAnalytics } from "../controllers/analyticsController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/seller-dashboard", protect, getSellerAnalytics);

export default router;
