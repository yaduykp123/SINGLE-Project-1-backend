import Batch from "../models/BatchSchema.js";
import Product from "../models/productSchema.js";
import Notification from "../models/NotificationSchema.js";
import InventoryTransaction from "../models/InventoryTransactionSchema.js";
import transporter from "../config/nodemailer.js";
import { getIo } from "../utils/socket.js";
import { syncProductAggregateStock } from "./inventoryService.js";

/**
 * Run automated expiry checks for all batches across the system.
 * Sends multi-horizon alerts (7d, 3d, 1d) with duplicate prevention,
 * and auto-deactivates expired batch stock into expiredStock with audit logs.
 */
export const processBatchExpiryChecks = async () => {
  const now = new Date();
  const summary = {
    checkedBatches: 0,
    expiredBatches: 0,
    sevenDayAlerts: 0,
    threeDayAlerts: 0,
    oneDayAlerts: 0,
  };

  // Find all batches that have stock or are active
  const batches = await Batch.find({
    $or: [{ availableStock: { $gt: 0 } }, { isActive: true }],
  })
    .populate("product")
    .populate("seller", "fullName email");

  summary.checkedBatches = batches.length;

  let io = null;
  try {
    io = getIo();
  } catch (err) {
    // Socket not initialized (e.g. in test env)
  }

  for (const batch of batches) {
    if (!batch.product || !batch.seller) continue;

    const expiryDate = new Date(batch.expiryDate);
    const diffTime = expiryDate.getTime() - now.getTime();
    const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // 1. EXPIRED CASE: <= 0 days remaining
    if (daysRemaining <= 0) {
      if (batch.availableStock > 0 || batch.isActive) {
        const discardedQty = batch.availableStock;
        batch.expiredStock = (batch.expiredStock || 0) + discardedQty;
        batch.availableStock = 0;
        batch.isActive = false;

        if (discardedQty > 0) {
          await InventoryTransaction.create({
            product: batch.product._id,
            productName: batch.product.name,
            batch: batch._id,
            batchNumber: batch.batchNumber,
            seller: batch.seller._id,
            type: "EXPIRED_DISCARD",
            quantityDelta: -discardedQty,
            previousAvailableStock: discardedQty,
            newAvailableStock: 0,
            reason: `Batch expired on ${expiryDate.toISOString().split("T")[0]}. Automatically moved to expiredStock.`,
            performedBy: batch.seller._id,
            performedByName: "Expiry Cron Job",
          });
        }

        // Sync aggregate product stock so expired products disappear from buyer listings immediately
        await syncProductAggregateStock(batch.product._id);
        summary.expiredBatches++;
      }

      // Notify seller once about batch expiration
      if (!batch.alertsSent?.expired) {
        const message = `🚨 EXPIRED: Batch "${batch.batchNumber}" of "${batch.product.name}" expired on ${expiryDate.toLocaleDateString()}. Sales have been blocked.`;
        try {
          const notification = await Notification.create({
            user: batch.seller._id,
            message,
            type: "expiry",
            link: "/dashboard",
          });
          if (io) io.to(batch.seller._id.toString()).emit("new_notification", notification);
        } catch (e) {
          console.error("Failed to create expired notification:", e.message);
        }

        batch.alertsSent = { ...batch.alertsSent, expired: true };
        await batch.save();
      }
      continue;
    }

    // 2. CRITICAL ALERT: 1 Day Remaining
    if (daysRemaining <= 1 && !batch.alertsSent?.oneDay) {
      const message = `⏰ URGENT (1 DAY LEFT): Batch "${batch.batchNumber}" of "${batch.product.name}" expires tomorrow (${batch.availableStock} ${batch.product.unit || "units"} remaining)! Action: Offer deep clearance discount.`;
      await sendAlert({
        batch,
        subject: `⏰ ExpireOff Urgent: 1 Day Left for "${batch.product.name}" (Batch ${batch.batchNumber})`,
        message,
        daysRemaining: 1,
        io,
      });

      batch.alertsSent = { ...batch.alertsSent, oneDay: true, threeDays: true, sevenDays: true };
      await batch.save();
      summary.oneDayAlerts++;
      continue;
    }

    // 3. WARNING ALERT: 2 - 3 Days Remaining
    if (daysRemaining <= 3 && daysRemaining > 1 && !batch.alertsSent?.threeDays) {
      const message = `⚠️ ATTENTION (3 DAYS LEFT): Batch "${batch.batchNumber}" of "${batch.product.name}" expires in ${daysRemaining} days (${batch.availableStock} units remaining). Action: Review smart discount suggestions.`;
      await sendAlert({
        batch,
        subject: `⚠️ ExpireOff Alert: 3 Days Left for "${batch.product.name}" (Batch ${batch.batchNumber})`,
        message,
        daysRemaining,
        io,
      });

      batch.alertsSent = { ...batch.alertsSent, threeDays: true, sevenDays: true };
      await batch.save();
      summary.threeDayAlerts++;
      continue;
    }

    // 4. NOTICE ALERT: 4 - 7 Days Remaining
    if (daysRemaining <= 7 && daysRemaining > 3 && !batch.alertsSent?.sevenDays) {
      const message = `ℹ️ NOTICE (7 DAYS LEFT): Batch "${batch.batchNumber}" of "${batch.product.name}" expires in ${daysRemaining} days (${batch.availableStock} units remaining). Plan your inventory reduction.`;
      await sendAlert({
        batch,
        subject: `ℹ️ ExpireOff Notice: 7 Days Left for "${batch.product.name}" (Batch ${batch.batchNumber})`,
        message,
        daysRemaining,
        io,
      });

      batch.alertsSent = { ...batch.alertsSent, sevenDays: true };
      await batch.save();
      summary.sevenDayAlerts++;
    }
  }

  return summary;
};

const sendAlert = async ({ batch, subject, message, daysRemaining, io }) => {
  try {
    const notification = await Notification.create({
      user: batch.seller._id,
      message,
      type: "expiry",
      link: "/dashboard",
    });

    if (io) {
      io.to(batch.seller._id.toString()).emit("new_notification", notification);
    }

    if (batch.seller.email && process.env.EMAIL_USER && transporter) {
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: batch.seller.email,
        subject,
        html: `
          <div style="font-family: Arial, sans-serif; background-color: #07110b; color: white; padding: 25px; border-radius: 12px; max-width: 500px; margin: 0 auto; border: 1px solid #1a2e1f;">
            <h2 style="color: ${daysRemaining <= 1 ? "#ef4444" : "#eab308"}; margin-bottom: 5px;">Smart Expiry Alert</h2>
            <p style="color: #a3a3a3; font-size: 14px;">Your inventory batch is approaching its expiry date.</p>
            
            <div style="background-color: rgba(255,255,255,0.03); border: 1px solid #1a2e1f; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <strong style="font-size: 18px; color: #ffffff;">${batch.product.name}</strong><br/>
              <span style="color: #a3a3a3; font-size: 14px;">Batch Number: <strong>${batch.batchNumber}</strong></span><br/>
              <span style="color: #a3a3a3; font-size: 14px;">Remaining Stock: <strong>${batch.availableStock} ${batch.product.unit || "units"}</strong></span><br/>
              <span style="color: #fca5a5; font-size: 14px; font-weight: bold;">Expires: ${new Date(batch.expiryDate).toLocaleDateString()} (${daysRemaining} ${daysRemaining === 1 ? "day" : "days"} left)</span>
            </div>

            <p>Log in to your ExpireOff dashboard to review intelligent discount suggestions and prevent food waste!</p>
            <hr style="border: 0; border-top: 1px solid #1a2e1f; margin: 20px 0;"/>
            <p style="font-size: 11px; color: #6b7280; text-align: center;">Sent automatically by ExpireOff Smart Inventory</p>
          </div>
        `,
      };
      transporter.sendMail(mailOptions).catch((err) => {
        console.error("Nodemailer failed in batch alert:", err.message);
      });
    }
  } catch (error) {
    console.error("Error dispatching batch alert:", error.message);
  }
};
