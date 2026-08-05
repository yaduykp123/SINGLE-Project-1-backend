import mongoose from "mongoose";

const offerSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, "Offer title is required"], trim: true, maxlength: 120 },
    description: { type: String, required: [true, "Offer description is required"], maxlength: 500 },
    discountPercentage: { type: Number, required: true, min: 1, max: 99 },
    category: { type: String, default: "All", enum: ["All", "Grocery Items", "Fruits", "Vegetables", "Meat/Fish", "Dairy", "Other"] },
    shopOwner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    products: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true }],
    appliesToAllProducts: { type: Boolean, default: false },
    location: { type: { type: String, enum: ["Point"], default: "Point" }, coordinates: { type: [Number], default: [0, 0] } },
    city: { type: String, default: "", trim: true },
    expiresAt: { type: Date, required: true, index: true },
    isActive: { type: Boolean, default: true },
    usageLimit: { type: Number, default: null },   // null = unlimited
    usageCount: { type: Number, default: 0 },
    minOrderValue: { type: Number, default: 0 },
  },
  { timestamps: true }
);

offerSchema.index({ location: "2dsphere" });
offerSchema.index({ expiresAt: 1, isActive: 1 });
offerSchema.index({ shopOwner: 1, isActive: 1 });

export default mongoose.model("Offer", offerSchema);