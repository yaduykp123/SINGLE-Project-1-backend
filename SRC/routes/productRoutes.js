import express from "express";
import {
  createProduct,
  getProducts,
  getProductById,
  getMyListings,
  updateProduct,
  deleteProduct,
  clearExpiredProducts,
  getReminders,
  getFeaturedDeals,
  getNearbyProducts,
  getBrands,
  getCategoriesWithCount,
  getRecommendations,
} from "../controllers/productController.js";
import { protect } from "../middlewares/authMiddleware.js";
import upload from "../middlewares/uploadMiddleware.js";

const router = express.Router();

router.post("/", protect, upload.single("image"), createProduct);
router.get("/", getProducts);
router.get("/my-listings", protect, getMyListings);
router.get("/reminders", protect, getReminders);
router.get("/featured-deals", getFeaturedDeals);
router.get("/nearby", getNearbyProducts);
router.get("/brands", getBrands);
router.get("/categories", getCategoriesWithCount);
router.get("/recommendations", getRecommendations);
router.delete("/expired/clear", protect, clearExpiredProducts);
router.get("/:id", getProductById);
router.put("/:id", protect, upload.single("image"), updateProduct);
router.delete("/:id", protect, deleteProduct);

export default router;