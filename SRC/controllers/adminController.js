import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/userSchema.js";
import { generateToken } from "./authController.js"

export const registerAdmin = async (req, res) => {
  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ message: "Request body is missing or empty. Please send raw JSON." });
    }
    const { fullName, email, phone, password, adminSecret } = req.body;

    // Verify admin secret key (prevents random people from creating admins)
    if (adminSecret !== process.env.ADMIN_SECRET_KEY) {
      return res.status(403).json({ message: "Invalid admin secret" });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await User.create({
      fullName,
      email,
      phone,
      password: hashedPassword,
      accountType: "admin", 
      isAdmin: true,       
      isVerified: true,    
    });

    const token = generateToken(user._id);

    res.status(201).json({
      message: "Admin registered successfully",
      token,
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        accountType: user.accountType,
        isAdmin: user.isAdmin,
        city: user.city,
        state: user.state,
        country: user.country,
        latitude: user.latitude,
        longitude: user.longitude,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};