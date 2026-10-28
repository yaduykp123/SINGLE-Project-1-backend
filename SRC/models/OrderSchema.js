import mongoose from "mongoose";

const comboItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      default: null,
    },
    name: { type: String, required: true },
    image: { type: String, default: "" },
    quantity: { type: Number, default: 1 },
    unit: { type: String, default: "units" },
    category: { type: String, default: "" },
    brand: { type: String, default: "" },
    marketPrice: { type: Number, default: 0 },
    unitPrice: { type: Number, default: 0 },
    expiryDate: { type: Date, default: null },
  },
  { _id: false }
);

const comboSnapshotSchema = new mongoose.Schema(
  {
    comboId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Offer",
      default: null,
    },
    name: { type: String, default: "" },
    image: { type: String, default: "" },
    description: { type: String, default: "" },
    discountPercentage: { type: Number, default: 0 },
    originalPrice: { type: Number, default: 0 },
    comboPrice: { type: Number, default: 0 },
    itemsCount: { type: Number, default: 0 },
    items: [comboItemSchema],
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: function () {
        return !this.isCombo;
      },
    },
    productName: { type: String, required: true },
    productImage: { type: String, default: "" },
    quantity: { type: Number, required: true, default: 1 },
    unitPrice: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    offer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Offer",
      default: null,
    },
    isCombo: {
      type: Boolean,
      default: false,
      index: true,
    },
    combo: {
      type: comboSnapshotSchema,
      default: null,
    },
    buyerName: { type: String, required: true },
    buyerEmail: { type: String, required: true },
    buyerPhone: { type: String, required: true },
    shippingAddress: {
      name: { type: String, required: true },
      phone: { type: String, required: true },
      email: { type: String, required: true },
      street: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true },
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sellerName: { type: String, required: true },
    paymentId: { type: String, required: true },
    orderId: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "confirmed", "shipped", "delivered", "cancelled"],
      default: "pending",
    },
    allocatedBatches: [
      {
        batch: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Batch",
        },
        batchNumber: { type: String, default: "" },
        quantity: { type: Number, required: true },
        expiryDate: { type: Date },
      },
    ],
    stockDeducted: {
      type: Boolean,
      default: false,
    },
    stockRestored: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

orderSchema.index({ buyer: 1, createdAt: -1 });
orderSchema.index({ seller: 1, createdAt: -1 });
orderSchema.index({ paymentId: 1 });
orderSchema.index({ isCombo: 1, buyer: 1 });

export default mongoose.model("Order", orderSchema);