import Donation from "../models/DonationSchema.js";
import Notification from "../models/NotificationSchema.js";
import { getIo } from "../utils/socket.js";

// Helper to calculate environmental and social impact
const calculateImpact = (quantity, unit) => {
  const qty = Number(quantity) || 1;
  let estimatedMeals = 0;
  let co2SavedKg = 0;

  switch (unit) {
    case "kg":
      estimatedMeals = Math.round(qty * 2.5); // ~400g per meal
      co2SavedKg = Math.round(qty * 2.5 * 10) / 10; // ~2.5kg CO2e per kg food saved
      break;
    case "g":
      estimatedMeals = Math.round((qty / 400) * 10) / 10;
      co2SavedKg = Math.round((qty / 1000) * 2.5 * 10) / 10;
      break;
    case "ltr":
    case "ml":
      const ltrs = unit === "ltr" ? qty : qty / 1000;
      estimatedMeals = Math.round(ltrs * 2);
      co2SavedKg = Math.round(ltrs * 1.8 * 10) / 10;
      break;
    case "meals":
      estimatedMeals = Math.round(qty);
      co2SavedKg = Math.round(qty * 1.0 * 10) / 10;
      break;
    case "packs":
    case "box":
    case "packet":
    case "units":
    case "pieces":
    default:
      estimatedMeals = Math.max(1, Math.round(qty * 1.5));
      co2SavedKg = Math.round(qty * 1.2 * 10) / 10;
      break;
  }

  return { estimatedMeals, co2SavedKg };
};

// 1. Create a surplus food donation listing
export const createDonation = async (req, res) => {
  try {
    const {
      title,
      description,
      category,
      quantity,
      unit,
      image,
      expiryDate,
      pickupStartDate,
      pickupEndDate,
      pickupInstructions,
      foodSafetyConfirmed,
      street,
    } = req.body;

    if (!foodSafetyConfirmed) {
      return res.status(400).json({
        success: false,
        message: "You must confirm that the food has been handled in accordance with hygiene and food safety standards.",
      });
    }

    const expDate = new Date(expiryDate);
    const now = new Date();
    if (isNaN(expDate.getTime()) || expDate <= now) {
      return res.status(400).json({
        success: false,
        message: "Expiry date must be a valid future date.",
      });
    }

    const startPickup = new Date(pickupStartDate || now);
    const endPickup = new Date(pickupEndDate || expDate);
    if (endPickup <= startPickup) {
      return res.status(400).json({
        success: false,
        message: "Pickup end time must be after pickup start time.",
      });
    }

    const impact = calculateImpact(quantity, unit);

    const userLoc = req.user.location?.coordinates?.length === 2
      ? req.user.location
      : { type: "Point", coordinates: [0, 0] };

    const donation = await Donation.create({
      donor: req.user._id,
      donorName: req.user.fullName,
      donorPhone: req.user.phone,
      title: title.trim(),
      description: (description || "").trim(),
      category,
      quantity: Number(quantity),
      unit,
      image: image || "",
      expiryDate: expDate,
      pickupWindow: {
        startDate: startPickup,
        endDate: endPickup,
        instructions: (pickupInstructions || "Bring clean containers.").trim(),
      },
      foodSafetyConfirmed: true,
      status: "available",
      location: userLoc,
      city: req.user.city || "",
      state: req.user.state || "",
      street: street || req.user.street || "",
      impact,
    });

    try {
      const io = getIo();
      if (io) {
        io.emit("new_donation_available", donation);
      }
    } catch {
      // Non-critical socket broadcast
    }

    res.status(201).json({
      success: true,
      message: "Surplus food donation listed successfully. Thank you for reducing food waste!",
      donation,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. Browse active donation listings
export const getDonations = async (req, res) => {
  try {
    const {
      category,
      status = "available",
      city,
      page = 1,
      limit = 20,
    } = req.query;

    const query = {};
    if (status && status !== "all") {
      query.status = status;
    }

    if (category && category !== "All") {
      query.category = category;
    }

    if (city) {
      query.city = new RegExp(city.trim(), "i");
    }

    // Never show expired uncollected donations in available listings
    if (status === "available") {
      query.expiryDate = { $gt: new Date() };
    }

    const skip = (Math.max(1, parseInt(page)) - 1) * Math.min(100, parseInt(limit));
    const total = await Donation.countDocuments(query);
    const donations = await Donation.find(query)
      .populate("donor", "fullName email city phone accountType")
      .populate("claimedBy.ngo", "fullName email phone")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.status(200).json({
      success: true,
      donations,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)) || 1,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. Get single donation details
export const getDonationById = async (req, res) => {
  try {
    const donation = await Donation.findById(req.params.id)
      .populate("donor", "fullName email city phone")
      .populate("claimedBy.ngo", "fullName email phone");

    if (!donation) {
      return res.status(404).json({ success: false, message: "Donation listing not found" });
    }

    res.status(200).json({ success: true, donation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. Request / claim a donation listing (by NGO or Community Volunteer)
export const requestDonation = async (req, res) => {
  try {
    const { id } = req.params;
    const { ngoName, ngoPhone, ngoRegistrationNumber, notes } = req.body;

    const donation = await Donation.findById(id);
    if (!donation) {
      return res.status(404).json({ success: false, message: "Donation listing not found" });
    }

    if (donation.status !== "available") {
      return res.status(400).json({
        success: false,
        message: `Donation is currently ${donation.status} and cannot be claimed.`,
      });
    }

    if (new Date(donation.expiryDate) <= new Date()) {
      return res.status(400).json({
        success: false,
        message: "This donation has reached its expiry date and cannot be claimed.",
      });
    }

    if (donation.donor.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "You cannot claim your own donation listing.",
      });
    }

    // Generate 6-digit pickup verification OTP
    const pickupOtp = Math.floor(100000 + Math.random() * 900000).toString();

    donation.status = "requested";
    donation.claimedBy = {
      ngo: req.user._id,
      ngoName: (ngoName || req.user.fullName).trim(),
      ngoPhone: (ngoPhone || req.user.phone).trim(),
      ngoRegistrationNumber: (ngoRegistrationNumber || "").trim(),
      notes: (notes || "").trim(),
      requestedAt: new Date(),
    };
    donation.pickupOtp = pickupOtp;
    await donation.save();

    // Send real-time notification to donor
    try {
      const donorNotification = await Notification.create({
        user: donation.donor,
        type: "system",
        message: `🤝 Donation Claim Request: "${donation.claimedBy.ngoName}" requested to collect "${donation.title}".`,
        link: "/dashboard",
      });

      const io = getIo();
      if (io) {
        io.to(donation.donor.toString()).emit("new_notification", donorNotification);
        io.to(donation.donor.toString()).emit("donation_requested", { donation });
      }
    } catch {
      // Non-critical notification fallback
    }

    res.status(200).json({
      success: true,
      message: "Donation claim requested successfully. Please coordinate with the donor for collection.",
      pickupOtp, // NGO receives pickup OTP to provide at collection
      donation,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 5. Donor approves claim request
export const approveDonation = async (req, res) => {
  try {
    const { id } = req.params;
    const donation = await Donation.findOne({ _id: id, donor: req.user._id });

    if (!donation) {
      return res.status(404).json({ success: false, message: "Donation listing not found or unauthorized" });
    }

    if (donation.status !== "requested") {
      return res.status(400).json({
        success: false,
        message: `Cannot approve donation with status "${donation.status}".`,
      });
    }

    if (new Date(donation.expiryDate) <= new Date()) {
      return res.status(400).json({
        success: false,
        message: "This donation has reached its expiry date and cannot be approved.",
      });
    }

    donation.status = "approved";
    await donation.save();

    // Notify NGO
    try {
      if (donation.claimedBy?.ngo) {
        const ngoNotification = await Notification.create({
          user: donation.claimedBy.ngo,
          type: "system",
          message: `✅ Donation Approved: Your claim for "${donation.title}" was approved by ${req.user.fullName}!`,
          link: "/dashboard",
        });

        const io = getIo();
        if (io) {
          io.to(donation.claimedBy.ngo.toString()).emit("new_notification", ngoNotification);
          io.to(donation.claimedBy.ngo.toString()).emit("donation_approved", { donation });
        }
      }
    } catch {
      // Non-critical
    }

    res.status(200).json({
      success: true,
      message: "Donation claim approved. Awaiting pickup collection.",
      donation,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 6. Verify collection handoff via Pickup OTP
export const verifyPickup = async (req, res) => {
  try {
    const { id } = req.params;
    const { otp } = req.body;

    const donation = await Donation.findOne({ _id: id, donor: req.user._id });
    if (!donation) {
      return res.status(404).json({ success: false, message: "Donation listing not found or unauthorized" });
    }

    if (donation.status !== "approved" && donation.status !== "requested") {
      return res.status(400).json({
        success: false,
        message: `Cannot verify pickup for donation with status "${donation.status}".`,
      });
    }

    if (new Date(donation.expiryDate) <= new Date()) {
      return res.status(400).json({
        success: false,
        message: "This donation has reached its expiry date. Under food safety standards, expired food cannot be collected.",
      });
    }

    if (!donation.pickupOtp || String(donation.pickupOtp).trim() !== String(otp).trim()) {
      return res.status(400).json({
        success: false,
        message: "Invalid pickup verification OTP. Please verify with the collection volunteer.",
      });
    }

    donation.status = "completed";
    donation.pickupOtpVerified = true;
    donation.completedAt = new Date();
    await donation.save();

    // Notify NGO of completed handoff
    try {
      if (donation.claimedBy?.ngo) {
        const ngoNotification = await Notification.create({
          user: donation.claimedBy.ngo,
          type: "system",
          message: `🎉 Pickup Confirmed: "${donation.title}" has been successfully collected! Estimated ${donation.impact?.estimatedMeals || 0} meals rescued.`,
          link: "/dashboard",
        });

        const io = getIo();
        if (io) {
          io.to(donation.claimedBy.ngo.toString()).emit("new_notification", ngoNotification);
          io.to(donation.claimedBy.ngo.toString()).emit("donation_completed", { donation });
        }
      }
    } catch {
      // Non-critical
    }

    res.status(200).json({
      success: true,
      message: `Pickup verified successfully! You rescued ${donation.quantity} ${donation.unit} of food (${donation.impact?.estimatedMeals || 0} meals).`,
      donation,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 7. Cancel donation (by donor or NGO)
export const cancelDonation = async (req, res) => {
  try {
    const { id } = req.params;
    const donation = await Donation.findById(id);

    if (!donation) {
      return res.status(404).json({ success: false, message: "Donation not found" });
    }

    const isDonor = donation.donor.toString() === req.user._id.toString();
    const isNgo = donation.claimedBy?.ngo?.toString() === req.user._id.toString();

    if (!isDonor && !isNgo && !req.user.isAdmin) {
      return res.status(403).json({ success: false, message: "Not authorized to cancel this donation" });
    }

    if (donation.status === "completed") {
      return res.status(400).json({ success: false, message: "Cannot cancel a completed donation" });
    }

    if (isDonor) {
      donation.status = "cancelled";
    } else if (isNgo) {
      // NGO cancels claim: return to available
      donation.status = "available";
      donation.claimedBy = { ngo: null, ngoName: "", ngoPhone: "", ngoRegistrationNumber: "", notes: "", requestedAt: null };
      donation.pickupOtp = null;
    }

    await donation.save();
    res.status(200).json({ success: true, message: "Donation status updated", donation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 8. Get my donations (as donor)
export const getMyDonations = async (req, res) => {
  try {
    const donations = await Donation.find({ donor: req.user._id })
      .populate("claimedBy.ngo", "fullName email phone")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, donations });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 9. Get donations claimed by NGO
export const getClaimedDonations = async (req, res) => {
  try {
    const donations = await Donation.find({ "claimedBy.ngo": req.user._id })
      .populate("donor", "fullName email phone city street")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, donations });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 10. Donation community impact statistics
export const getDonationImpactStats = async (req, res) => {
  try {
    const completedStats = await Donation.aggregate([
      { $match: { status: "completed" } },
      {
        $group: {
          _id: null,
          totalDonations: { $sum: 1 },
          totalMealsRescued: { $sum: "$impact.estimatedMeals" },
          totalCo2SavedKg: { $sum: "$impact.co2SavedKg" },
        },
      },
    ]);

    const categoryBreakdown = await Donation.aggregate([
      { $match: { status: "completed" } },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
          totalMeals: { $sum: "$impact.estimatedMeals" },
        },
      },
      { $sort: { totalMeals: -1 } },
    ]);

    const stats = completedStats[0] || {
      totalDonations: 0,
      totalMealsRescued: 0,
      totalCo2SavedKg: 0,
    };

    res.status(200).json({
      success: true,
      stats: {
        totalCompletedDonations: stats.totalDonations,
        totalMealsRescued: stats.totalMealsRescued,
        totalCo2SavedKg: Math.round(stats.totalCo2SavedKg * 10) / 10,
        categoryBreakdown,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
