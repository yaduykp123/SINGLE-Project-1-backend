import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/userSchema.js";
import { generateOTP, getOTPExpiry } from "../utils/generateOtp.js";
import { sendOTPEmail,  sendPasswordResetEmail  } from "../utils/sendEmail.js";
import { getClientIp, lookupLocationByIp } from "../utils/ipLocation.js";

export const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || "1d",
  });
};

export const generateRefreshToken = (id) => {
  return jwt.sign({ id }, process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
};

const setRefreshTokenCookie = (res, refreshToken) => {
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
};

// Helper to safely clean coordinates - prevents "Not found" strings
const cleanCoord = (val) => {
  if (val === null || val === undefined || val === "Not found") return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
};

// Helper to safely apply location data
const applyLocationToUser = (user, location) => {
  const city = location.city || "";
  const state = location.state || "";
  const country = location.country || "";
  const latitude = cleanCoord(location.latitude);
  const longitude = cleanCoord(location.longitude);

  user.city = city;
  user.state = state;
  user.country = country;
  user.latitude = latitude;
  user.longitude = longitude;

  // Only set location geo point if BOTH coords are valid numbers
  if (latitude !== null && longitude !== null) {
    user.location = {
      type: "Point",
      coordinates: [longitude, latitude],
    };
  }
};

//     Register new user

export const register = async (req, res) => {
  try {
    const { fullName, email, phone, password, accountType } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists) {
      if (userExists.isVerified) {
        return res.status(400).json({ message: "User already exists" });
      } else {
        // Securely update unverified user record and resend new OTP
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const otp = generateOTP();
        const otpExpiry = getOTPExpiry();

        userExists.fullName = fullName;
        userExists.phone = phone;
        userExists.password = hashedPassword;
        userExists.accountType = accountType;
        userExists.otp = otp;
        userExists.otpExpiry = otpExpiry;

        await userExists.save();

        try {
          await sendOTPEmail(email, otp, fullName);
        } catch (emailError) {
          console.error("Resending OTP failed:", emailError);
          return res.status(500).json({
            message: "Failed to send verification email. Please try again.",
          });
        }

        return res.status(200).json({
          message: "User registered. Please verify your email with OTP.",
          userId: userExists._id,
        });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const otp = generateOTP();
    const otpExpiry = getOTPExpiry();

    const user = await User.create({
      fullName,
      email,
      phone,
      password: hashedPassword,
      accountType,
      otp,
      otpExpiry,
      isVerified: false
    });

    // Auto-detect location from IP
    try {
      const clientIp = getClientIp(req);
      const location = await lookupLocationByIp(clientIp);
      
      if (location.city || location.latitude) {
        applyLocationToUser(user, location);
        await user.save();
      }
    } catch {
      // Silent catch for non-critical IP location lookup
    }

    // Send OTP email
    try {
      await sendOTPEmail(email, otp, fullName);
    } catch (emailError) {
      await User.deleteOne({ _id: user._id });
      console.error("Registration failed: OTP email could not be sent", emailError);
      return res.status(500).json({ 
        message: "Failed to send verification email. Please try again." 
      });
    }

    res.status(201).json({
      message: "User registered. Please verify your email with OTP.",
      userId: user._id,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//    Verify OTP
//    POST /api/auth/verify-otp
export const verifyOTP = async (req, res) => {
  try {
    const { userId, otp } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Handle already verified user
    if (user.isVerified) {
      const token = generateToken(user._id);
      const refreshTokenVal = generateRefreshToken(user._id);
      setRefreshTokenCookie(res, refreshTokenVal);

      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 1 * 24 * 60 * 60 * 1000,
      });

      return res.status(200).json({
        message: "Email verified successfully",
        token,
        user: {
          _id: user._id,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
          accountType: user.accountType,
            isAdmin: user.isAdmin,  
              isBlocked: user.isBlocked,
          city: user.city,
          state: user.state,
          country: user.country,
          latitude: user.latitude,
          longitude: user.longitude,
        },
      });
    }

     
    if (user.isBlocked) {
      return res.status(403).json({ message: "Your account has been blocked. Contact support." });
    }

    if (user.otp !== otp.toString()) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    if (user.otpExpiry < new Date()) {
      return res.status(400).json({ message: "OTP expired" });
    }

    user.isVerified = true;
    user.otp = undefined;
    user.otpExpiry = undefined;

    // Auto-detect location if still missing
    if (!user.city || !user.latitude) {
      try {
        const clientIp = getClientIp(req);
        const location = await lookupLocationByIp(clientIp);
        
        if (location.city || location.latitude) {
          applyLocationToUser(user, location);
        }
      } catch {
        // Silent catch
      }
    }

    await user.save();

    const token = generateToken(user._id);
    const refreshTokenVal = generateRefreshToken(user._id);
    setRefreshTokenCookie(res, refreshTokenVal);

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 1 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      message: "Email verified successfully",
      token,
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        accountType: user.accountType,
         isAdmin: user.isAdmin,
        isBlocked: user.isBlocked,
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

//    Resend OTP
//   POST /api/auth/resend-otp
export const resendOTP = async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const otp = generateOTP();
    const otpExpiry = getOTPExpiry();

    user.otp = otp;
    user.otpExpiry = otpExpiry;
    await user.save();

    await sendOTPEmail(user.email, otp, user.fullName);

    res.status(200).json({ message: "OTP resent successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//     Login user
//   POST /api/auth/login
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    if (!user.isVerified) {
      return res.status(400).json({ message: "Please verify your email first" });
    }

    if (user.isBlocked) {
      return res.status(403).json({ message: "Your account has been blocked. Contact support." });
    }

    // Auto-detect location if missing
    if (!user.city || !user.latitude) {
      try {
        const clientIp = getClientIp(req);
        const location = await lookupLocationByIp(clientIp);
        
        if (location.city || location.latitude) {
          applyLocationToUser(user, location);
          await user.save();
        }
      } catch {
        // Silent catch
      }
    }

    const token = generateToken(user._id);
    const refreshTokenVal = generateRefreshToken(user._id);
    setRefreshTokenCookie(res, refreshTokenVal);

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 1 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      token,
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        accountType: user.accountType,
        isAdmin: user.isAdmin,
        isBlocked: user.isBlocked,
        city: user.city,
        state: user.state,
        country: user.country,
        latitude: user.latitude,
        longitude: user.longitude,
        location: user.location,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//   Get current user
//   GET /api/auth/me
export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password -otp");
    res.status(200).json(
      { ...user._doc, 
        isAdmin: user.isAdmin ,
         isBlocked: user.isBlocked
     });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//   Refresh access token using HTTP-only refresh token cookie
//   POST /api/auth/refresh-token
export const refreshToken = async (req, res) => {
  try {
    const tokenFromCookie = req.cookies?.refreshToken;
    if (!tokenFromCookie) {
      return res.status(401).json({ message: "No refresh token provided" });
    }

    const decoded = jwt.verify(
      tokenFromCookie,
      process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET
    );

    const user = await User.findById(decoded.id);
    if (!user || user.isBlocked) {
      return res.status(401).json({ message: "Invalid refresh token or user blocked" });
    }

    const newAccessToken = generateToken(user._id);
    const newRefreshToken = generateRefreshToken(user._id);
    setRefreshTokenCookie(res, newRefreshToken);

    res.cookie("token", newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 1 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({ token: newAccessToken });
  } catch (error) {
    return res.status(401).json({ message: "Refresh token expired or invalid" });
  }
};

//    Logout user & clear cookies
//   POST /api/auth/logout
export const logout = async (req, res) => {
  try {
    res.cookie("token", "", {
      httpOnly: true,
      expires: new Date(0),
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });
    res.cookie("refreshToken", "", {
      httpOnly: true,
      expires: new Date(0),
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
//  Forgot / Reset Password 
 
//    Request a password reset code
//    POST /api/auth/forgot-password
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }
 
    const user = await User.findOne({ email });
 
    // Always send back the same message whether or not the account exists-
    // this stops someone from using this endpoint to discover which emails
    // are registered (a common real-world security requirement).

    const genericResponse = {
      message: "If an account exists for that email, a reset code has been sent.",
    };
 
    if (!user || user.isBlocked) {
      return res.status(200).json(genericResponse);
    }
 
    const otp = generateOTP();
    const otpExpiry = getOTPExpiry();
 
    user.resetPasswordOTP = otp;
    user.resetPasswordOTPExpiry = otpExpiry;
    await user.save();
 
    try {
      await sendPasswordResetEmail(user.email, otp, user.fullName);
    } catch (emailError) {
      console.error("Sending password reset email failed:", emailError);
      return res.status(500).json({
        message: "Failed to send reset email. Please try again.",
      });
    }
 
    res.status(200).json(genericResponse);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
 

//    Reset password using the emailed code
//    POST /api/auth/reset-password
export const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
 
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ message: "Email, code, and new password are required" });
    }
 
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }
 
    const user = await User.findOne({ email });
 
    // Same generic error whether the user doesn't exist, the code is wrong,
    // or the code expired — don't give an attacker extra information.
    const invalidResponse = { message: "Invalid or expired code" };
 
    if (!user || !user.resetPasswordOTP || !user.resetPasswordOTPExpiry) {
      return res.status(400).json(invalidResponse);
    }
 
    if (user.resetPasswordOTP !== otp.toString()) {
      return res.status(400).json(invalidResponse);
    }
 
    if (user.resetPasswordOTPExpiry < new Date()) {
      return res.status(400).json(invalidResponse);
    }
 
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.resetPasswordOTP = undefined;
    user.resetPasswordOTPExpiry = undefined;
    await user.save();
 
    res.status(200).json({ message: "Password reset successful! Please log in." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
