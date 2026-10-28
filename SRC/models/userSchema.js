import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  fullName:{
    type:String,
    required:true
  },

  email:{
    type:String,
    required:true,
    unique:true
  },

  phone:{
    type:String,
    required:true
  },

  password:{
    type:String,
    required:true
  },

  accountType:{
    type:String,
    enum:["household","shop","admin"],
    required:true
  },

  //  Admin field
  isAdmin: { type: Boolean, default: false },

  isBlocked: { type: Boolean, default: false },

  city: {
    type: String,
    default: ""
  },
  state: {
    type: String,
    default: ""
  },
  country: {
    type: String,
    default: ""
  },
  latitude: {
    type: Number,
    default: null
  },
  longitude: {
    type: Number,
    default: null
  },
  location: {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point"
    },
    coordinates: {
      type: [Number],
      default: [0, 0]
    }
  },

  isVerified:{
    type:Boolean,
    default:false
  },

  otp:{
    type:String
  },

  otpExpiry:{
    type:Date
  },
  // so a pending email-verification code and a password-reset code never collide.
  resetPasswordOTP: {
    type: String
  },
 
  resetPasswordOTPExpiry: {
    type: Date
  },

  // Saved Delivery Addresses
  savedAddresses: [
    {
      label: {
        type: String,
        enum: ["Home", "Work", "Other"],
        default: "Home",
      },
      name: { type: String, required: true },
      phone: { type: String, required: true },
      email: { type: String, required: true },
      street: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true },
      isDefault: { type: Boolean, default: false },
    },
  ],

  // Customer Wishlist
  wishlist: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
    },
  ],

  // Notification Preferences
  notificationPreferences: {
    orderUpdates: { type: Boolean, default: true },
    expiryAlerts: { type: Boolean, default: true },
    priceDropAlerts: { type: Boolean, default: true },
    donationAlerts: { type: Boolean, default: true },
    emailNotifications: { type: Boolean, default: true },
  },

},{timestamps:true});

// Create Geo Index
userSchema.index({
    location: "2dsphere"
});

export default mongoose.model("User",userSchema);