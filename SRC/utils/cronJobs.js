import cron from "node-cron";
import Product from "../models/productSchema.js";
import Offer from "../models/OfferSchema.js";
import User from "../models/userSchema.js";
import Notification from "../models/NotificationSchema.js";
import { sendExpiryReminder } from "./sendEmail.js";
import { sendEmail } from "../config/nodemailer.js";
import { getIo } from "./socket.js";

export const startCronJobs = () => {
  // -------------------------------------------------------------
  // Cron Job 1: Daily Product Expiry Reminders (Runs daily at 9:00 AM)
  // -------------------------------------------------------------
  cron.schedule("0 9 * * *", async () => {
    console.log("CRON: Running daily product expiry check...");
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

    try {
      const expiringProducts = await Product.find({
        expiryDate: { $gte: tomorrow, $lt: dayAfterTomorrow },
        isActive: true,
      }).populate("owner", "email fullName");

      const ownerMap = {};
      expiringProducts.forEach((product) => {
        if (!product.owner) return;
        const ownerId = product.owner._id.toString();
        if (!ownerMap[ownerId]) {
          ownerMap[ownerId] = {
            email: product.owner.email,
            name: product.owner.fullName,
            products: [],
          };
        }
        ownerMap[ownerId].products.push(product);
      });

      for (const ownerId in ownerMap) {
        const { email, name, products } = ownerMap[ownerId];
        try {
          await sendExpiryReminder(email, products, name);
        } catch (err) {
          console.error(`Failed to send reminder to ${email}:`, err.message);
        }
      }
      console.log(`CRON: Sent expiry reminders to ${Object.keys(ownerMap).length} users.`);
    } catch (error) {
      console.error("CRON ERROR (Products):", error);
    }
  });

  // -------------------------------------------------------------
  // Cron Job 2: Expiring Offers Alert for Nearby Users (Runs daily at 10:00 AM)
  // -------------------------------------------------------------
  cron.schedule("0 10 * * *", async () => {
    console.log("CRON: Checking active offers expiring in 24 hours...");
    const now = new Date();
    const next24Hours = new Date(Date.now() + 24 * 60 * 60 * 1000);
    try {
      const closingOffers = await Offer.find({
        expiresAt: { $gt: now, $lte: next24Hours },
        isActive: true,
      }).populate("shopOwner", "fullName city location");

      let io = null;
      try {
        io = getIo();
      } catch (e) {
        console.warn("Socket.io not initialized for offer cron");
      }

      for (const offer of closingOffers) {
        try {
          const targetUsers = await User.find({
            accountType: "household",
            city: new RegExp(offer.shopOwner.city || "", "i"),
          }).limit(50);

          for (const user of targetUsers) {
            try {
              const messageText = `⏳ Hurry! Offer "${offer.title}" (${offer.discountPercentage}% OFF) ends in less than 24 hours!`;

              const notification = await Notification.create({
                user: user._id,
                message: messageText,
                type: "offer",
                link: "/offers",
              });

              if (io) {
                io.to(user._id.toString()).emit("new_notification", notification);
              }
            } catch (innerErr) {
              console.error("Notification creation failed:", innerErr.message);
            }
          }
        } catch (offerErr) {
          console.error(`Failed processing offer ${offer._id}:`, offerErr.message);
        }
      }
      console.log(`CRON: Processed ${closingOffers.length} expiring offers.`);
    } catch (error) {
      console.error("CRON ERROR (Offers):", error);
    }
  });

  // -------------------------------------------------------------
  // Cron Job 3: Auto-Deactivate Expired Offers & Products (Runs hourly)
  // -------------------------------------------------------------
  cron.schedule("0 * * * *", async () => {
    try {
      const now = new Date();
      await Offer.updateMany({ expiresAt: { $lte: now }, isActive: true }, { isActive: false });
      await Product.updateMany({ expiryDate: { $lte: now }, isActive: true }, { isActive: false });
      console.log("CRON: Auto-deactivated expired offers and products.");
    } catch (err) {
      console.error("CRON ERROR (Auto Deactivate Expired):", err.message);
    }
  });

  console.log("Cron jobs scheduled: Expiry Alerts (9:00 AM), Offer Reminders (10:00 AM), & Hourly Expired Deactivation");
};