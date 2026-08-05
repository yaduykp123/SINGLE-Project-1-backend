import http from "http";
import app from './app.js';
import connectDB from "./config/database.js";
import { startCronJobs } from "./utils/cronJobs.js";
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
    console.log('Server running at Port', PORT);
});