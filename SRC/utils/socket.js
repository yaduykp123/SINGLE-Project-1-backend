import { Server } from "socket.io";
import jwt from "jsonwebtoken";

let io = null; // Holds the Socket.io server instance

export const initSocket = (server) => {
  const allowedOrigins = [
    process.env.CLIENT_URL,
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://3.110.41.155:5173",
    "http://3.110.41.155:5000",
  ].filter(Boolean);

  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (
          allowedOrigins.includes(origin) ||
          /^http:\/\/localhost(:\d+)?$/.test(origin) ||
          /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) ||
          process.env.NODE_ENV === "test"
        ) {
          return callback(null, true);
        }
        return callback(new Error("CORS origin not allowed for Socket.IO"));
      },
      methods: ["GET", "POST", "PUT", "DELETE"],
      credentials: true,
    },
  });

  // Socket authentication middleware
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace("Bearer ", "") ||
      socket.handshake.query?.token;

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = decoded;
      } catch (err) {
        // Invalid token; proceed as unauthenticated client
        socket.user = null;
      }
    }
    next();
  });

  io.on("connection", (socket) => {
    // Automatically join the authenticated user's private room upon connection
    if (socket.user) {
      const authUserId = (socket.user.id || socket.user._id)?.toString();
      if (authUserId) {
        socket.join(authUserId);
      }
    }

    // Client requests to join a private room
    socket.on("join_room", (targetUserId) => {
      if (!targetUserId) return;

      const targetIdStr = targetUserId.toString();

      // If client is authenticated, enforce that they can only join their own room (or admin)
      if (socket.user) {
        const authUserId = (socket.user.id || socket.user._id)?.toString();
        if (authUserId === targetIdStr || socket.user.isAdmin) {
          socket.join(targetIdStr);
        }
      } else {
        // Unauthenticated client joining in development or legacy fallback
        socket.join(targetIdStr);
      }
    });

    socket.on("disconnect", () => {});
  });

  return io;
};

// Helper function to grab Socket.io instance from any controller or cron job
export const getIo = () => {
  if (!io) {
    throw new Error("Socket.io has not been initialized!");
  }
  return io;
};