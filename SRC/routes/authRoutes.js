import express from "express";
import { register, verifyOTP, resendOTP, login, getMe, logout, refreshToken, forgotPassword, resetPassword, } from "../controllers/authController.js";
import { protect } from "../middlewares/authMiddleware.js";
import rateLimit from "express-rate-limit";

const router = express.Router();

 
const isTestEnv = process.env.NODE_ENV === "test";

// Limits login and registration attempts to protect against brute-force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTestEnv ? 1000 : 20, // 20 attempts per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many authentication attempts. Please try again after 15 minutes." },
});

// Limits OTP verification and resend requests to prevent spamming and brute-force
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: isTestEnv ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many OTP verification attempts. Please wait a few minutes before trying again." },
});

// Limits how often one IP can request a password reset code
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTestEnv ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many reset requests. Please try again later." },
});

router.post("/register", authLimiter, register);
router.post("/verify-otp", otpLimiter, verifyOTP);
router.post("/resend-otp", otpLimiter, resendOTP);
router.post("/login", authLimiter, login);
router.post("/logout", logout);
router.post("/refresh-token", refreshToken);
router.get("/me", protect, getMe);

// Forgot / reset password
router.post("/forgot-password", forgotPasswordLimiter, forgotPassword);
router.post("/reset-password", resetPassword);

export default router;