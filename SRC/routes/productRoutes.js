import express from "express";
import { createProduct, getProducts, getProductById, getMyListings, updateProduct, deleteProduct, getReminders,} from "../controllers/productController.js";
import { protect } from "../middlewares/authMiddleware.js";
import upload from "../middlewares/uploadMiddleware.js";

const router = express.Router();

router.post("/", protect, upload.single("image"), createProduct);
router.get("/", getProducts);
router.get("/my-listings", protect, getMyListings);
router.get("/reminders", protect, getReminders);
router.get("/:id", getProductById);
router.put("/:id", protect, upload.single("image"), updateProduct);
router.delete("/:id", protect, deleteProduct);

export default router;