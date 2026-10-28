import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
    },
    brand: { type: String, trim: true, default: "" },
    description: { type: String, trim: true, default: "" },
    category: {
      type: String,
      required: [true, "Category is required"],
      enum: ["Grocery Items", "Fruits", "Vegetables", "Meat/Fish", "Dairy", "Bakery", "Other"],
    },
    marketPrice: {
      type: Number,
      required: [true, "Market price is required"],
      min: 0,
    },
    discountPrice: {
      type: Number,
      required: [true, "Discount price is required"],
      min: 0,
    },
    quantity: {
      type: Number,
      required: [true, "Quantity is required"],
      min: 0,
    },
    unit: {
      type: String,
      required: [true, "Unit is required"],
      enum: ["kg", "g", "ltr", "ml", "units", "packs", "pieces", "tray", "dozen", "bunch", "bottle", "box", "packet"],
    },
    stock: {
      type: Number,
      required: [true, "Stock is required"],
      min: 0,
      default: 1,
    },
    image: { type: String, default: "" },
    expiryDate: {
      type: Date,
      required: [true, "Expiry date is required"],
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    ownerName: { type: String, required: true },
    ownerType: {
      type: String,
      required: true,
      enum: ["household", "shop", "admin"],
    },
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], required: true },
    },
    barcode: { type: String, trim: true, default: "", index: true },
    city: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

productSchema.index({ location: "2dsphere" });
productSchema.index({ expiryDate: 1, isActive: 1 });
productSchema.index({ isActive: 1, expiryDate: 1, category: 1, discountPrice: 1 });
productSchema.index({ owner: 1, createdAt: -1 });

// Virtual for discount percentage
productSchema.virtual("discountPercent").get(function () {
  if (this.marketPrice === 0) return 0;
  return Math.round(((this.marketPrice - this.discountPrice) / this.marketPrice) * 100);
});

productSchema.set("toJSON", { virtuals: true });

export default mongoose.model("Product", productSchema);