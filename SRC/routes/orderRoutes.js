import express from "express";
import {
  createRazorpayOrder,
  verifyPayment,
  getMyOrders,
  getReceivedOrders,
  updateOrderStatus,
  clearMyOrders,
  deleteOrder,
} from "../controllers/orderController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.post("/create-order", protect, createRazorpayOrder);
router.post("/verify-payment", protect, verifyPayment);
router.get("/my-orders", protect, getMyOrders);
router.get("/received", protect, getReceivedOrders);
router.put("/:id/status", protect, updateOrderStatus);
router.delete("/clear", protect, clearMyOrders);
router.delete("/:id", protect, deleteOrder);

export default router;