import { Server } from "socket.io";

let io = null; // Holds the Socket.io server instance

export const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: "*", // Accepts requests from frontend Vite dev server (http://localhost:5173)
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  });

  io.on("connection", (socket) => {
    // Client joins a room named after their User ID
    socket.on("join_room", (userId) => {
      if (userId) {
        socket.join(userId.toString());
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