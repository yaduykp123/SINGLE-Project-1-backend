import Offer from "../models/OfferSchema.js";
import User from "../models/userSchema.js";
import Product from "../models/productSchema.js";
import Notification from "../models/NotificationSchema.js";
import { getIo } from "../utils/socket.js";
import { sendEmail } from "../config/nodemailer.js";

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Haversine helper
const getDistanceKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
};

// 1. CREATE OFFER
export const createOffer = asyncHandler( async (req, res) => {
  const { title, description, discountPercentage, expiresAt, city, category, productIds, usageLimit, minOrderValue } = req.body;
  const shopOwner = req.user;

  if (shopOwner.accountType !== "shop") {
    return res.status(403).json({ success: false, message: "Only registered Shop accounts can post promotional offers." });
  }

  if (!Array.isArray(productIds) || productIds.length === 0) {
    return res.status(400).json({ success: false, message: "Please select at least one product for this offer." });
  }

  const products = await Product.find({
    _id: { $in: productIds },
    owner: shopOwner._id,
    isActive: true,
    expiryDate: { $gt: new Date() },
  });

  if (products.length !== productIds.length) {
    return res.status(400).json({ success: false, message: "One or more selected products are invalid, expired, or do not belong to your shop." });
  }

  // Validate offer math: final price must be >= ₹1
  for (const p of products) {
    const base = p.discountPrice || p.marketPrice;
    const final = Math.round(base * (1 - Number(discountPercentage) / 100));
    if (final < 1) {
      return res.status(400).json({ success: false, message: `Offer would make "${p.name}" price invalid (₹${final}). Reduce the discount percentage.` });
    }
  }

  let finalExpiry;
  if (expiresAt) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(expiresAt.trim())) {
      const [y, m, d] = expiresAt.trim().split("-").map(Number);
      finalExpiry = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
    } else {
      finalExpiry = new Date(expiresAt);
    }
  } else {
    finalExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }

  if (isNaN(finalExpiry.getTime()) || finalExpiry <= new Date()) {
    return res.status(400).json({ success: false, message: "Invalid or past expiry date." });
  }

  let coordinates = [0, 0];
  if (shopOwner.location?.coordinates?.length === 2 && (shopOwner.location.coordinates[0] !== 0 || shopOwner.location.coordinates[1] !== 0)) {
    coordinates = shopOwner.location.coordinates;
  } else if (shopOwner.longitude && shopOwner.latitude) {
    coordinates = [Number(shopOwner.longitude), Number(shopOwner.latitude)];
  }

  const newOffer = await Offer.create({
    title,
    description,
    discountPercentage: Number(discountPercentage),
    category: category || "All",
    shopOwner: shopOwner._id,
    products: products.map((p) => p._id),
    location: { type: "Point", coordinates },
    city: city || shopOwner.city || "",
    expiresAt: finalExpiry,
    usageLimit: usageLimit ? Number(usageLimit) : null,
    minOrderValue: minOrderValue ? Number(minOrderValue) : 0,
  });

  const populatedOffer = await Offer.findById(newOffer._id)
    .populate("shopOwner", "fullName email city phone")
    .populate("products", "name image discountPrice marketPrice");

  // Notify nearby buyers
  let nearbyUsers = [];
  if (coordinates[0] !== 0 || coordinates[1] !== 0) {
    nearbyUsers = await User.find({
      _id: { $ne: shopOwner._id },
      accountType: "household",
      location: { $near: { $geometry: { type: "Point", coordinates }, $maxDistance: 15000 } },
    }).limit(100);
  }

  if (nearbyUsers.length === 0 && shopOwner.city) {
    nearbyUsers = await User.find({
      _id: { $ne: shopOwner._id },
      accountType: "household",
      city: new RegExp(shopOwner.city, "i"),
    }).limit(100);
  }

  if (nearbyUsers.length === 0) {
    nearbyUsers = await User.find({
      _id: { $ne: shopOwner._id },
      accountType: "household",
    }).limit(100);
  }

  let io;
  try { io = getIo(); } catch { io = null; }

  const notificationResults = { sent: 0, failed: 0 };
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

  // Send response immediately for 0ms lag
  res.status(201).json({
    success: true,
    message: "Offer posted successfully!",
    offer: populatedOffer,
  });

  // Broadcast new_offer event to all active clients in real-time
  if (io) io.emit("new_offer", populatedOffer);

  // Asynchronously notify nearby users & send emails in background
  (async () => {
    for (const targetUser of nearbyUsers) {
      try {
        const messageText = `🔥 ${title} — ${discountPercentage}% OFF at ${shopOwner.fullName}!`;
        const notification = await Notification.create({
          user: targetUser._id,
          message: messageText,
          type: "offer",
          link: `/offers`,
        });
        if (io) io.to(targetUser._id.toString()).emit("new_notification", notification);

        if (targetUser.email) {
          sendEmail({
            to: targetUser.email,
            subject: `🔥 New Offer Near You: ${title}`,
            html: `
              <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #10b981; border-radius: 12px;">
                <h2 style="color: #10b981;">🔥 ${discountPercentage}% OFF - New Offer Near You!</h2>
                <h3>${title}</h3>
                <p>${description}</p>
                <p><strong>Store:</strong> ${shopOwner.fullName}</p>
                <p><strong>Location:</strong> ${shopOwner.city || "Nearby"}</p>
                <a href="${frontendUrl}/offers" style="display:inline-block;background:#10b981;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;">View Offer</a>
              </div>
            `,
          }).catch(e => console.error("Email send error:", e.message));
        }
      } catch (err) {
        console.error(`Failed to notify user ${targetUser._id}:`, err.message);
      }
    }
  })();
});

// 2. GET ACTIVE OFFERS (location-aware + enriched pricing)
export const getActiveOffers = asyncHandler(async (req, res) => {
  const now = new Date();

  // Auto-deactivate any expired offers in the database
  await Offer.updateMany({ expiresAt: { $lte: now }, isActive: true }, { isActive: false });

  const { lat, lng, maxDistance = 15000 } = req.query;

  let query = { expiresAt: { $gt: now }, isActive: true };

  if (lat && lng) {
    query.location = {
      $near: {
        $geometry: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
        $maxDistance: parseInt(maxDistance),
      },
    };
  }

  const offers = await Offer.find(query)
    .populate("shopOwner", "fullName email phone city")
    .populate("products", "name image discountPrice marketPrice stock category expiryDate")
    .sort({ createdAt: -1 });

  const enrichedOffers = offers.map((offer) => {
    const o = offer.toObject();
    o.products = o.products.map((p) => {
      const base = p.discountPrice || p.marketPrice;
      const offerPrice = Math.max(1, Math.round(base * (1 - o.discountPercentage / 100)));
      return { ...p, offerPrice, basePrice: base };
    });

    if (lat && lng && o.location?.coordinates) {
      const [oLng, oLat] = o.location.coordinates;
      o.distanceKm = getDistanceKm(parseFloat(lat), parseFloat(lng), oLat, oLng);
    }
    o.isFullyRedeemed = o.usageLimit !== null && o.usageCount >= o.usageLimit;
    return o;
  });

  res.status(200).json({ success: true, count: enrichedOffers.length, offers: enrichedOffers });
});

// 3. GET SINGLE OFFER
export const getOfferById = asyncHandler(async (req, res) => {
  const offer = await Offer.findById(req.params.id)
    .populate("shopOwner", "fullName email phone city")
    .populate("products", "name image discountPrice marketPrice stock category expiryDate");

  if (!offer) return res.status(404).json({ success: false, message: "Offer not found" });

  const o = offer.toObject();
  o.products = o.products.map((p) => {
    const base = p.discountPrice || p.marketPrice;
    const offerPrice = Math.max(1, Math.round(base * (1 - o.discountPercentage / 100)));
    return { ...p, offerPrice, basePrice: base };
  });

  res.status(200).json({ success: true, offer: o });
});

// 4. DELETE OFFER
export const deleteOffer = asyncHandler(async (req, res) => {
  const offer = await Offer.findById(req.params.id);
  if (!offer) return res.status(404).json({ success: false, message: "Offer not found" });

  if (offer.shopOwner.toString() !== req.user._id.toString() && !req.user.isAdmin) {
    return res.status(403).json({ success: false, message: "Not authorized to delete this offer" });
  }

  await Offer.findByIdAndUpdate(req.params.id, { isActive: false });
  res.status(200).json({ success: true, message: "Offer deleted successfully" });
});

// 5. GET MY OFFERS
export const getMyOffers = asyncHandler(async (req, res) => {
  const now = new Date();
  await Offer.updateMany({ expiresAt: { $lte: now }, isActive: true }, { isActive: false });

  const offers = await Offer.find({ shopOwner: req.user._id, expiresAt: { $gt: now }, isActive: true })
    .populate("products", "name image stock isActive")
    .sort({ createdAt: -1 });

  res.status(200).json({ success: true, offers });
});