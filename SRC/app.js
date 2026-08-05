import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import cartRoutes from "./routes/cartRoutes.js";

import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import offerRoutes from './routes/offerRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';



const app = express();

app.use(
  cors({
    origin: true, // Reflects the request origin dynamically, allowing cookies
    credentials: true, // Enables cookies to be sent and received
  })
);
app.use(cookieParser());
app.use(express.json({ type: ["application/json", "application/vnd.api+json"] }));
app.use(express.urlencoded({ extended: true }));



app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);
// Add to your middleware stack
app.use('/api/offers', offerRoutes);
app.use('/api/notifications', notificationRoutes);
app.use("/api/cart", cartRoutes);


app.get("/", (req, res) => {
  res.send("expireOff API is running...");
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server Error:", err.stack || err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

export default app; // Trigger restart