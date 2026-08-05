import mongoose from "mongoose";

const cartItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
    unitPrice: {
      type: Number,
      required: true,
    },
    totalPrice: {
      type: Number,
      required: true,
    },
  },
  { _id: true }
);

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    items: [cartItemSchema],
    totalAmount: {
      type: Number,
      default: 0,
    },
    itemCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Auto-calculate totals before saving
cartSchema.pre("save", function () {
  this.itemCount = this.items.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  this.totalAmount = this.items.reduce(
    (sum, item) => sum + item.totalPrice,
    0
  );
});

export default mongoose.model("Cart", cartSchema);