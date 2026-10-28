import mongoose from "mongoose";

const inventoryTransactionSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    productName: {
      type: String,
      default: "",
    },
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      default: null,
      index: true,
    },
    batchNumber: {
      type: String,
      default: "",
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "INITIAL_MIGRATION",
        "BATCH_CREATE",
        "ORDER_PURCHASE",
        "ORDER_CANCEL_RESTORE",
        "EXPIRED_DISCARD",
        "MANUAL_ADJUSTMENT",
      ],
      required: true,
      index: true,
    },
    quantityDelta: {
      type: Number,
      required: true,
    },
    previousAvailableStock: {
      type: Number,
      required: true,
    },
    newAvailableStock: {
      type: Number,
      required: true,
    },
    referenceId: {
      type: String,
      default: "", // e.g. orderId, paymentId
    },
    reason: {
      type: String,
      default: "",
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    performedByName: {
      type: String,
      default: "System",
    },
  },
  { timestamps: true }
);

inventoryTransactionSchema.index({ product: 1, createdAt: -1 });
inventoryTransactionSchema.index({ seller: 1, createdAt: -1 });
inventoryTransactionSchema.index({ referenceId: 1 });

export default mongoose.model("InventoryTransaction", inventoryTransactionSchema);
