import User from "../models/userSchema.js";
import Product from "../models/productSchema.js";

// Update user location
// PUT /api/users/location
export const updateLocation = async (req, res) => {
  try {
    const { city, state, country, latitude, longitude } = req.body;

    const latNum = Number(latitude);
    const lngNum = Number(longitude);
    const validCoords =
      latitude !== null &&
      latitude !== undefined &&
      longitude !== null &&
      longitude !== undefined &&
      !isNaN(latNum) &&
      !isNaN(lngNum) &&
      (latNum !== 0 || lngNum !== 0);

    const updateFields = {};
    if (city !== undefined) updateFields.city = city;
    if (state !== undefined) updateFields.state = state;
    if (country !== undefined) updateFields.country = country;
    if (latitude !== undefined) updateFields.latitude = latitude;
    if (longitude !== undefined) updateFields.longitude = longitude;

    if (validCoords) {
      updateFields.location = {
        type: "Point",
        coordinates: [lngNum, latNum],
      };
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updateFields,
      { returnDocument: "after" }
    ).select("-password -otp");

    res.status(200).json({ message: "Location updated", user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get user profile
// GET /api/users/profile
export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password -otp");
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==================== SAVED ADDRESSES ====================

// GET /api/users/addresses
export const getSavedAddresses = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("savedAddresses");
    res.status(200).json({
      success: true,
      addresses: user?.savedAddresses || [],
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/users/addresses
export const addSavedAddress = async (req, res) => {
  try {
    const { label, name, phone, email, street, city, state, pincode, isDefault } = req.body;

    if (!name || !phone || !street || !city || !pincode) {
      return res.status(400).json({ success: false, message: "Missing required address fields" });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // If marked as default or first address, make it default
    const shouldBeDefault = Boolean(isDefault) || (user.savedAddresses.length === 0);

    if (shouldBeDefault) {
      user.savedAddresses.forEach((addr) => {
        addr.isDefault = false;
      });
    }

    user.savedAddresses.push({
      label: label || "Home",
      name: name.trim(),
      phone: String(phone).trim(),
      email: (email || user.email).trim(),
      street: street.trim(),
      city: city.trim(),
      state: (state || "").trim(),
      pincode: String(pincode).trim(),
      isDefault: shouldBeDefault,
    });

    await user.save();
    res.status(201).json({
      success: true,
      message: "Address saved successfully",
      addresses: user.savedAddresses,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/users/addresses/:addressId
export const updateSavedAddress = async (req, res) => {
  try {
    const { addressId } = req.params;
    const { label, name, phone, email, street, city, state, pincode, isDefault } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const addr = user.savedAddresses.id(addressId);
    if (!addr) return res.status(404).json({ success: false, message: "Address not found" });

    if (isDefault) {
      user.savedAddresses.forEach((a) => {
        a.isDefault = false;
      });
      addr.isDefault = true;
    }

    if (label) addr.label = label;
    if (name) addr.name = name.trim();
    if (phone) addr.phone = String(phone).trim();
    if (email) addr.email = email.trim();
    if (street) addr.street = street.trim();
    if (city) addr.city = city.trim();
    if (state !== undefined) addr.state = state.trim();
    if (pincode) addr.pincode = String(pincode).trim();

    await user.save();
    res.status(200).json({
      success: true,
      message: "Address updated successfully",
      addresses: user.savedAddresses,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/users/addresses/:addressId
export const deleteSavedAddress = async (req, res) => {
  try {
    const { addressId } = req.params;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    user.savedAddresses.pull(addressId);

    // If deleted address was default and other addresses exist, make first one default
    if (user.savedAddresses.length > 0 && !user.savedAddresses.some((a) => a.isDefault)) {
      user.savedAddresses[0].isDefault = true;
    }

    await user.save();
    res.status(200).json({
      success: true,
      message: "Address deleted successfully",
      addresses: user.savedAddresses,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== WISHLIST ====================

// GET /api/users/wishlist
export const getWishlist = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: "wishlist",
      match: { isActive: true },
      populate: { path: "owner", select: "fullName city" },
    });

    const activeWishlist = (user?.wishlist || []).filter(Boolean);
    res.status(200).json({
      success: true,
      wishlist: activeWishlist,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/users/wishlist/:productId
export const toggleWishlist = async (req, res) => {
  try {
    const { productId } = req.params;
    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    const user = await User.findById(req.user._id);
    const existingIndex = user.wishlist.findIndex(
      (id) => id.toString() === productId.toString()
    );

    let isAdded = false;
    if (existingIndex > -1) {
      user.wishlist.splice(existingIndex, 1);
      isAdded = false;
    } else {
      user.wishlist.push(productId);
      isAdded = true;
    }

    await user.save();
    res.status(200).json({
      success: true,
      isWishlisted: isAdded,
      message: isAdded ? "Added to wishlist" : "Removed from wishlist",
      wishlist: user.wishlist,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== NOTIFICATION PREFERENCES ====================

// GET /api/users/preferences
export const getNotificationPreferences = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("notificationPreferences");
    res.status(200).json({
      success: true,
      preferences: user?.notificationPreferences || {
        orderUpdates: true,
        expiryAlerts: true,
        priceDropAlerts: true,
        donationAlerts: true,
        emailNotifications: true,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/users/preferences
export const updateNotificationPreferences = async (req, res) => {
  try {
    const updates = req.body;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    user.notificationPreferences = {
      ...user.notificationPreferences?.toObject(),
      ...updates,
    };

    await user.save();
    res.status(200).json({
      success: true,
      message: "Notification preferences updated",
      preferences: user.notificationPreferences,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};