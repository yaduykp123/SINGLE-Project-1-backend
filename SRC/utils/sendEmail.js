import { sendEmail } from "../config/nodemailer.js";

export const sendOTPEmail = async (email, otp, name) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #10b981;">expireOff - Email Verification</h2>
      <p>Hi ${name},</p>
      <p>Your OTP for email verification is:</p>
      <div style="background: #f0fdf4; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
        <h1 style="color: #10b981; letter-spacing: 8px; margin: 0;">${otp}</h1>
      </div>
      <p>This OTP will expire in 10 minutes.</p>
      <p>If you didn't request this, please ignore this email.</p>
      <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">expireOff - Prevent Food Waste</p>
    </div>
  `;
  await sendEmail({ to: email, subject: "expireOff - Email Verification OTP", html });
};

// NEW: password reset code email
export const sendPasswordResetEmail = async (email, otp, name) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #10b981;">expireOff - Password Reset</h2>
      <p>Hi ${name},</p>
      <p>We received a request to reset your password. Use the code below to continue:</p>
      <div style="background: #f0fdf4; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
        <h1 style="color: #10b981; letter-spacing: 8px; margin: 0;">${otp}</h1>
      </div>
      <p>This code will expire in 10 minutes.</p>
      <p>If you didn't request a password reset, you can safely ignore this email — your password will not be changed.</p>
      <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">expireOff - Prevent Food Waste</p>
    </div>
  `;
  await sendEmail({ to: email, subject: "expireOff - Password Reset Code", html });
};

export const sendExpiryReminder = async (email, products, name) => {
  const productList = products
    .map(
      (p) =>
        `<li><strong>${p.name}</strong> - Expires on ${new Date(
          p.expiryDate
        ).toLocaleDateString()} (${p.quantity} ${p.unit} remaining)</li>`
    )
    .join("");

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #ef4444;">⚠️ Product Expiry Reminder</h2>
      <p>Hi ${name},</p>
      <p>The following products in your listings are expiring soon:</p>
      <ul style="line-height: 2;">${productList}</ul>
      <p style="background: #fef2f2; padding: 15px; border-radius: 8px; color: #991b1b;">
        Consider reducing the price or donating these items to prevent waste!
      </p>
      <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">expireOff - Prevent Food Waste</p>
    </div>
  `;
  await sendEmail({ to: email, subject: "expireOff - Products Expiring Soon!", html });
};

export const sendOrderConfirmation = async (email, order, name) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #10b981;">✅ Order Confirmed!</h2>
      <p>Hi ${name},</p>
      <p>Your order has been placed successfully.</p>
      <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p><strong>Order ID:</strong> ${order.orderId}</p>
        <p><strong>Product:</strong> ${order.productName}</p>
        <p><strong>Quantity:</strong> ${order.quantity}</p>
        <p><strong>Total Amount:</strong> ₹${order.totalAmount}</p>
        <p><strong>Status:</strong> ${order.status}</p>
      </div>
      <p>Thank you for using expireOff!</p>
      <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">expireOff - Prevent Food Waste</p>
    </div>
  `;
  await sendEmail({ to: email, subject: "expireOff - Order Confirmed", html });
};

export const sendSellerNotification = async (email, order, name) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #3b82f6;">📦 New Order Received!</h2>
      <p>Hi ${name},</p>
      <p>You have received a new order for your product.</p>
      <div style="background: #eff6ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p><strong>Order ID:</strong> ${order.orderId}</p>
        <p><strong>Product:</strong> ${order.productName}</p>
        <p><strong>Quantity:</strong> ${order.quantity}</p>
        <p><strong>Total Amount:</strong> ₹${order.totalAmount}</p>
        <p><strong>Buyer:</strong> ${order.buyerName}</p>
        <p><strong>Buyer Phone:</strong> ${order.buyerPhone}</p>
      </div>
      <p>Please prepare the order for delivery!</p>
      <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">expireOff - Prevent Food Waste</p>
    </div>
  `;
  await sendEmail({ to: email, subject: "expireOff - New Order Received", html });
};