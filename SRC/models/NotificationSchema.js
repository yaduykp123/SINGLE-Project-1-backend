import mongoose from "mongoose";

// Schema defining live & system notifications sent to users
const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // The recipient user
      required: true,
    },
    title: {
      type: String,
      trim: true,
      default: "",
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
      enum: ["offer", "order", "system", "expiry", "OFFER", "ORDER", "SYSTEM", "EXPIRY"],
      lowercase: true,
      default: "system",
    },  
    entityType: {
      type: String,
      enum: ["order", "offer", "product", "system", ""],
      default: "",
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    link: {
      type: String,
      default: "", // Optional page route link to navigate when clicked
    },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, isRead: 1 });

export default mongoose.model("Notification", notificationSchema);