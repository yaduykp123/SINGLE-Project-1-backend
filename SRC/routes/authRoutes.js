import express from "express";
import { register, verifyOTP, resendOTP, login, getMe, logout, refreshToken, forgotPassword, resetPassword, } from "../controllers/authController.js";
import { protect } from "../middlewares/authMiddleware.js";
import rateLimit from "express-rate-limit";

const router = express.Router();

 
// NEW: limits how often one IP can request a reset code, so this endpoint
// can't be used to spam an inbox or brute-force-probe registered emails.
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many reset requests. Please try again later." },
});


router.post("/register", register);
router.post("/verify-otp", verifyOTP);
router.post("/resend-otp", resendOTP);
router.post("/login", login);
router.post("/logout", logout);
router.post("/refresh-token", refreshToken);
router.get("/me", protect, getMe);


// NEW: forgot / reset password
router.post("/forgot-password", forgotPasswordLimiter, forgotPassword);
router.post("/reset-password", resetPassword);

export default router;