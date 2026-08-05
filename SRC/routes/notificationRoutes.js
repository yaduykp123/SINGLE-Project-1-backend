import express from "express";
import {
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearAllNotifications,
} from "../controllers/notificationController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Fetch all notifications for the authenticated user
router.get("/", protect, getUserNotifications);

// Mark single notification as read
router.put("/:id/read", protect, markAsRead);

// Mark all notifications as read
router.put("/read-all", protect, markAllAsRead);

// Clear all notifications
router.delete("/clear", protect, clearAllNotifications);

// Delete single notification
router.delete("/:id", protect, deleteNotification);

export default router;