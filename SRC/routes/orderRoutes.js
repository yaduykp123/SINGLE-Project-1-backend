import express from "express";
import {
  createRazorpayOrder,
  verifyPayment,
  getMyOrders,
  getReceivedOrders,
  getOrderById,
  updateOrderStatus,
  clearMyOrders,
  deleteOrder,
  handleRazorpayWebhook,
} from "../controllers/orderController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Webhook endpoint (verified via HMAC signature)
router.post("/webhook", handleRazorpayWebhook);

router.post("/create-order", protect, createRazorpayOrder);
router.post("/verify-payment", protect, verifyPayment);
router.get("/my-orders", protect, getMyOrders);
router.get("/received", protect, getReceivedOrders);
router.get("/:id", protect, getOrderById);
router.put("/:id/status", protect, updateOrderStatus);
router.delete("/clear", protect, clearMyOrders);
router.delete("/:id", protect, deleteOrder);

export default router;