import mongoose from "mongoose";

const donationSchema = new mongoose.Schema(
  {
    donor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    donorName: {
      type: String,
      required: true,
      trim: true,
    },
    donorPhone: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      required: [true, "Donation title is required"],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    category: {
      type: String,
      required: true,
      enum: ["Grocery Items", "Fruits", "Vegetables", "Meat/Fish", "Dairy", "Bakery", "Prepared Meals", "Other"],
    },
    quantity: {
      type: Number,
      required: [true, "Quantity is required"],
      min: [1, "Quantity must be at least 1"],
    },
    unit: {
      type: String,
      required: true,
      enum: ["kg", "g", "ltr", "ml", "units", "packs", "pieces", "tray", "dozen", "box", "packet", "meals"],
    },
    image: {
      type: String,
      default: "",
    },
    expiryDate: {
      type: Date,
      required: [true, "Expiry date / best before date is required"],
      index: true,
    },
    pickupWindow: {
      startDate: {
        type: Date,
        required: true,
      },
      endDate: {
        type: Date,
        required: true,
      },
      instructions: {
        type: String,
        trim: true,
        default: "Please bring appropriate clean storage containers or insulated food bags.",
      },
    },
    foodSafetyConfirmed: {
      type: Boolean,
      required: [true, "Donor must confirm food safety & hygiene handling"],
      default: false,
    },
    status: {
      type: String,
      enum: ["available", "requested", "approved", "completed", "cancelled"],
      default: "available",
      index: true,
    },
    claimedBy: {
      ngo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      ngoName: { type: String, default: "" },
      ngoPhone: { type: String, default: "" },
      ngoRegistrationNumber: { type: String, default: "" },
      notes: { type: String, default: "" },
      requestedAt: { type: Date, default: null },
    },
    pickupOtp: {
      type: String,
      default: null,
    },
    pickupOtpVerified: {
      type: Boolean,
      default: false,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], required: true },
    },
    city: {
      type: String,
      default: "",
    },
    state: {
      type: String,
      default: "",
    },
    street: {
      type: String,
      default: "",
    },
    impact: {
      estimatedMeals: {
        type: Number,
        default: 0,
      },
      co2SavedKg: {
        type: Number,
        default: 0,
      },
    },
  },
  { timestamps: true }
);

donationSchema.index({ location: "2dsphere" });
donationSchema.index({ status: 1, expiryDate: 1 });
donationSchema.index({ donor: 1, createdAt: -1 });

export default mongoose.model("Donation", donationSchema);
