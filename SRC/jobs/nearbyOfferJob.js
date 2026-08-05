import cron from "node-cron";
import Offer from "../models/OfferSchema.js";
import User from "../models/userSchema.js";
import { sendEmail } from "../config/nodemailer.js";

// Haversine distance in km
const getDistanceKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export const startNearbyOfferDigest = () => {
  cron.schedule("0 10 * * *", async () => {
    console.log("Running Daily Offer Digest...");

    try {
      const activeOffers = await Offer.find({
        expiresAt: { $gt: new Date() },
        isActive: true,
      }).populate("shopOwner");

      if (activeOffers.length === 0) return;

      const buyers = await User.find({ accountType: "household" });

      for (const buyer of buyers) {
        if (!buyer.location?.coordinates || buyer.location.coordinates.every((c) => c === 0)) {
          continue;
        }

        const [buyerLon, buyerLat] = buyer.location.coordinates;

        const nearbyOffers = activeOffers.filter((offer) => {
          const [offerLon, offerLat] = offer.location?.coordinates || [0, 0];
          if (offerLon === 0 && offerLat === 0) return false;
          const dist = getDistanceKm(buyerLat, buyerLon, offerLat, offerLon);
          return dist <= 15; // 15 km radius
        });

        if (nearbyOffers.length > 0) {
          try {
            await sendEmail({
              to: buyer.email,
              subject: "Your Daily Local Offers!",
              html: `
                <h2>You have ${nearbyOffers.length} active offers near you today!</h2>
                <ul>
                  ${nearbyOffers
                    .map(
                      (o) =>
                        `<li><strong>${o.title}</strong> — ${o.discountPercentage}% OFF at ${o.shopOwner.fullName}</li>`
                    )
                    .join("")}
                </ul>
                <a href="http://localhost:5173/offers">View Offers</a>
              `,
            });
          } catch (err) {
            console.error(`Failed to send digest to ${buyer.email}:`, err.message);
          }
        }
      }
    } catch (error) {
      console.error("Cron Job Error (Offer Digest):", error);
    }
  });
};