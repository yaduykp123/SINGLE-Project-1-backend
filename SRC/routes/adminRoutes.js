// SRC/routes/adminRoutes.js
import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { adminOnly } from "../middlewares/adminMiddleware.js";
import User from "../models/userSchema.js";
import Product from "../models/productSchema.js";
import Order from "../models/OrderSchema.js";
import { registerAdmin } from "../controllers/adminController.js";

const router = express.Router();

// Secret admin registration (public)
router.post("/register-admin", registerAdmin);

// All routes below: protect + adminOnly
router.use(protect, adminOnly);

// Get all users
router.get("/users", async (req, res) => {
  try {
    const users = await User.find().select("-password -otp").sort({ createdAt: -1 });
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

//  Block user
router.put("/users/:id/block", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    
    // Prevent blocking other admins
    if (user.isAdmin) {
      return res.status(403).json({ message: "Cannot block admin users" });
    }

    user.isBlocked = true;
    await user.save();

    res.status(200).json({ message: "User blocked successfully", user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Unblock user
router.put("/users/:id/unblock", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.isBlocked = false;
    await user.save();

    res.status(200).json({ message: "User unblocked successfully", user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

//  Delete user
router.delete("/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    
    if (user.isAdmin) {
      return res.status(403).json({ message: "Cannot delete admin users" });
    }

    await User.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all products
router.get("/products", async (req, res) => {
  try {
    const products = await Product.find().populate("owner", "fullName email").sort({ createdAt: -1 });
    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all orders
router.get("/orders", async (req, res) => {
  try {
    const orders = await Order.find()
      .populate("buyer", "fullName email")
      .populate("seller", "fullName email")
      .populate("product", "name image")
      .sort({ createdAt: -1 });
    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete any product (moderation)
router.delete("/products/:id", async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Product deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update order status (for disputes)
router.put("/orders/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
    res.status(200).json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;