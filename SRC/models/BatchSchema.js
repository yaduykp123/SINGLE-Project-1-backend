import mongoose from "mongoose";

const batchSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product reference is required"],
      index: true,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Seller reference is required"],
      index: true,
    },
    batchNumber: {
      type: String,
      required: [true, "Batch number is required"],
      trim: true,
    },
    barcode: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    initialQuantity: {
      type: Number,
      required: [true, "Initial quantity is required"],
      min: [0, "Initial quantity cannot be negative"],
    },
    availableStock: {
      type: Number,
      required: [true, "Available stock is required"],
      min: [0, "Available stock cannot be negative"],
      default: 0,
    },
    reservedStock: {
      type: Number,
      min: [0, "Reserved stock cannot be negative"],
      default: 0,
    },
    soldStock: {
      type: Number,
      min: [0, "Sold stock cannot be negative"],
      default: 0,
    },
    expiredStock: {
      type: Number,
      min: [0, "Expired stock cannot be negative"],
      default: 0,
    },
    expiryDate: {
      type: Date,
      required: [true, "Expiry date is required"],
      index: true,
    },
    costPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    appliedDiscountPercent: {
      type: Number,
      min: 0,
      max: 99,
      default: 0,
    },
    suggestedDiscountPercent: {
      type: Number,
      min: 0,
      max: 99,
      default: 0,
    },
    suggestedPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    discountStatus: {
      type: String,
      enum: ["none", "suggested", "approved", "rejected"],
      default: "none",
    },
    alertsSent: {
      sevenDays: { type: Boolean, default: false },
      threeDays: { type: Boolean, default: false },
      oneDay: { type: Boolean, default: false },
      expired: { type: Boolean, default: false },
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

// Compound index for unique batch per product
batchSchema.index({ product: 1, batchNumber: 1 }, { unique: true });
// Index for FEFO allocation: active batches with available stock ordered by earliest expiry date
batchSchema.index({ product: 1, isActive: 1, expiryDate: 1, availableStock: 1 });
// Index for seller queries
batchSchema.index({ seller: 1, isActive: 1, expiryDate: 1 });

export default mongoose.model("Batch", batchSchema);
