import mongoose from "mongoose";

// Schema defining live & system notifications sent to users
const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // The recipient user
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    isRead: {
      type: Boolean,
      default: false, // Starts as unread
    },
    type: {
      type: String,
      enum: ["offer", "order", "system", "expiry"],
      default: "system",
    },  
    link: {
      type: String,
      default: "", // Optional page route link to navigate when clicked
    },
  },
  { timestamps: true }
);

export default mongoose.model("Notification", notificationSchema);