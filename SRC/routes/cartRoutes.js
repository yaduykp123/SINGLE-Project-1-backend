import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { addToCart, getCart, updateCartItem, removeFromCart, clearCart,} from "../controllers/cartController.js";

const router = express.Router();

router.post("/", protect, addToCart);
router.get("/", protect, getCart);
router.put("/:itemId", protect, updateCartItem);
router.delete("/:itemId", protect, removeFromCart);
router.delete("/", protect, clearCart);

export default router;