import express from "express";
import {
  updateLocation,
  getProfile,
  getSavedAddresses,
  addSavedAddress,
  updateSavedAddress,
  deleteSavedAddress,
  getWishlist,
  toggleWishlist,
  getNotificationPreferences,
  updateNotificationPreferences,
} from "../controllers/userController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.put("/location", protect, updateLocation);
router.get("/profile", protect, getProfile);

// Saved Delivery Addresses
router.get("/addresses", protect, getSavedAddresses);
router.post("/addresses", protect, addSavedAddress);
router.put("/addresses/:addressId", protect, updateSavedAddress);
router.delete("/addresses/:addressId", protect, deleteSavedAddress);

// Wishlist
router.get("/wishlist", protect, getWishlist);
router.post("/wishlist/:productId", protect, toggleWishlist);
router.delete("/wishlist/:productId", protect, toggleWishlist);

// Notification Preferences
router.get("/preferences", protect, getNotificationPreferences);
router.put("/preferences", protect, updateNotificationPreferences);

export default router;