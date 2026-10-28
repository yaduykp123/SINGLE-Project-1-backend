import http from "http";
import mongoose from "mongoose";
import app from './app.js';
import connectDB from "./config/database.js";
import { startCronJobs, stopCronJobs } from "./utils/cronJobs.js";
import { initSocket } from "./utils/socket.js";

await connectDB();
startCronJobs();

// Global error handlers
process.on("unhandledRejection", (reason, promise) => {
  console.error("CRITICAL: Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("CRITICAL: Uncaught Exception thrown:", error);
});

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// Initialize Socket.io with our server
const io = initSocket(server);

app.set("io", io);

server.listen(PORT, () => {
  console.log(`Server running at Port ${PORT}`);
});

// Graceful Shutdown handler
const gracefulShutdown = (signal) => {
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);
  stopCronJobs();

  server.close(async () => {
    console.log("HTTP server closed.");
    try {
      if (io) {
        io.close();
        console.log("Socket.IO closed.");
      }
      await mongoose.connection.close(false);
      console.log("MongoDB connection closed.");
      process.exit(0);
    } catch (err) {
      console.error("Error during graceful shutdown:", err);
      process.exit(1);
    }
  });

  // Force shutdown after 10s timeout
  setTimeout(() => {
    console.error("Graceful shutdown timed out. Forcing process exit.");
    process.exit(1);
  }, 10000).unref();
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));