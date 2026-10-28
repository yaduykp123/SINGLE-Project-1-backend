import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import cartRoutes from "./routes/cartRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import offerRoutes from './routes/offerRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import inventoryRoutes from './routes/inventoryRoutes.js';
import donationRoutes from './routes/donationRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import errorMiddleware from "./middlewares/errorMiddleware.js";

const app = express();

// Secure CORS configuration: Explicit allowlist with credentials
const allowedOrigins = [
  process.env.CLIENT_URL,
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://3.110.41.155:5173",
  "http://3.110.41.155:5000",
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, or server-to-server)
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        /^http:\/\/localhost(:\d+)?$/.test(origin) ||
        /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) ||
        process.env.NODE_ENV === "test"
      ) {
        return callback(null, true);
      }
      return callback(new Error(`CORS origin "${origin}" not allowed by ExpireOff security policy.`));
    },
    credentials: true,
  })
);

app.use(cookieParser());
app.use(express.json({ type: ["application/json", "application/vnd.api+json"] }));
app.use(express.urlencoded({ extended: true }));

// Primary API Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);
app.use('/api/offers', offerRoutes);
app.use('/api/notifications', notificationRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/donations", donationRoutes);
app.use("/api/analytics", analyticsRoutes);

// Health Check Endpoint
app.get("/api/health", (req, res) => {
  const isDbConnected = mongoose.connection.readyState === 1;
  res.status(isDbConnected ? 200 : 503).json({
    status: isDbConnected ? "ok" : "degraded",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: {
      connected: isDbConnected,
      state: ["disconnected", "connected", "connecting", "disconnecting"][mongoose.connection.readyState] || "unknown",
    },
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || "development",
  });
});

app.get("/", (req, res) => {
  res.send("expireOff API is running...");
});

// Use robust global error middleware
app.use(errorMiddleware);

export default app;