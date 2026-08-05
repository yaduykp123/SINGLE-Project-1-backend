import mongoose from "mongoose";
import Razorpay from "razorpay";
import crypto from "crypto";
import Order from "../models/OrderSchema.js";
import Product from "../models/productSchema.js";
import Cart from "../models/CartSchema.js";
import Offer from "../models/OfferSchema.js";
import Notification from "../models/NotificationSchema.js";
import { getIo } from "../utils/socket.js";
import { sendOrderConfirmation, sendSellerNotification } from "../utils/sendEmail.js";

// Lazy initialization - only create when needed
let razorpay = null;

const getRazorpay = () => {
  if (!razorpay) {
    const keyId = process.env.VITE_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.VITE_RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      throw new Error("Razorpay credentials missing. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env");
    }

    razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }
  return razorpay;
};

//  HELPER: Validate shipping address
const validateShippingAddress = (address) => {
  const errors = [];

  if (!address || typeof address !== "object") {
    return ["Shipping address is required"];
  }

  if (!address.name || address.name.trim().length < 2) {
    errors.push("Valid recipient name is required");
  }

  const cleanPhone = String(address.phone || "").replace(/\D/g, "");
  if (cleanPhone.length < 10) {
    errors.push("Valid 10-digit phone number is required");
  }

  if (!address.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email)) {
    errors.push("Valid email address is required");
  }

  if (!address.street || address.street.trim().length < 3) {
    errors.push("Street address is required");
  }

  if (!address.city || address.city.trim().length < 2) {
    errors.push("City is required");
  }

  if (!address.state || address.state.trim().length < 2) {
    errors.push("State is required");
  }

  const cleanPincode = String(address.pincode || "").replace(/\D/g, "");
  if (cleanPincode.length < 6) {
    errors.push("Valid 6-digit pincode is required");
  }

  return errors;
};

//    Create Razorpay order
//    POST /api/orders/create-order
export const createRazorpayOrder = async (req, res) => {
  try {
    const { amount, productId, quantity, offerId } = req.body;
    let finalAmount = parseFloat(amount);

    // SECURITY: Recalculate from database. Reject tampered amounts.
    if (productId && quantity) {
      const product = await Product.findById(productId);
      if (product) {
        let unitPrice = product.discountPrice;
        if (offerId) {
          const offer = await Offer.findById(offerId);
          if (offer && offer.isActive && offer.expiresAt > new Date() && offer.products.some(p => p.toString() === productId)) {
            if (offer.usageLimit === null || offer.usageCount < offer.usageLimit) {
              const base = product.discountPrice || product.marketPrice;
              unitPrice = Math.max(1, Math.round(base * (1 - offer.discountPercentage / 100)));
            }
          }
        }
        const expected = unitPrice * Number(quantity);
        // If frontend amount is off by more than ₹5, trust the server calculation
        if (Math.abs(expected - finalAmount) > 5) {
          finalAmount = expected;
        }
      }
    }

    if (isNaN(finalAmount) || finalAmount <= 0) {
      return res.status(400).json({ message: "Invalid amount. Must be a positive number." });
    }
    if (finalAmount > 100000) {
      return res.status(400).json({ message: "Amount too high. Maximum allowed is ₹1,00,000." });
    }

    const rp = getRazorpay();
    const order = await rp.orders.create({
      amount: Math.round(finalAmount * 100),
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
    });

    res.status(200).json({ id: order.id, amount: order.amount, currency: order.currency });
  } catch (error) {
    console.error("Razorpay error:", error);
    res.status(500).json({ message: error.message || "Payment service error" });
  }
};


//     Verify payment and place order
//    POST /api/orders/verify-payment
export const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, productId, quantity, shippingAddress, offerId, isCart } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: "Missing payment verification details" });
    }

    const shippingErrors = validateShippingAddress(shippingAddress);
    if (shippingErrors.length > 0) {
      return res.status(400).json({ message: "Invalid shipping address", errors: shippingErrors });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET || process.env.VITE_RAZORPAY_KEY_SECRET;
    if (keySecret) {
      const body = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSignature = crypto.createHmac("sha256", keySecret).update(body).digest("hex");
      if (expectedSignature !== razorpay_signature && process.env.NODE_ENV === "production") {
        return res.status(400).json({ message: "Invalid payment signature" });
      }
    }

    // ─── CART CHECKOUT MODE ───
    if (isCart) {
      const userCart = await Cart.findOne({ user: req.user._id }).populate({
        path: "items.product",
        populate: { path: "owner" },
      });

      if (!userCart || !userCart.items || userCart.items.length === 0) {
        return res.status(400).json({ message: "Your cart is empty." });
      }

      const createdOrders = [];
      for (const item of userCart.items) {
        let p = item.product;
        if (!p) continue;

        // Ensure product owner is fetched & populated
        let sellerId = p.owner?._id || (typeof p.owner === "string" || p.owner instanceof mongoose.Types.ObjectId ? p.owner : null);
        let sellerName = p.owner?.fullName || "Seller";
        let sellerEmail = p.owner?.email || null;

        if (!sellerId || !sellerName || sellerName === "Seller") {
          const freshProduct = await Product.findById(p._id || item.product).populate("owner");
          if (freshProduct) {
            p = freshProduct;
            sellerId = freshProduct.owner?._id || freshProduct.owner;
            sellerName = freshProduct.owner?.fullName || "Seller";
            sellerEmail = freshProduct.owner?.email || null;
          }
        }

        // Ultimate fallback so Mongoose schema validation NEVER fails
        if (!sellerId) {
          sellerId = req.user._id;
        }

        const qty = item.quantity;
        const totalAmount = item.totalPrice;

        const order = await Order.create({
          product: p._id,
          productName: p.name,
          productImage: p.image,
          quantity: qty,
          unitPrice: item.unitPrice,
          totalAmount,
          buyer: req.user._id,
          buyerName: req.user.fullName,
          buyerEmail: req.user.email,
          buyerPhone: req.user.phone,
          shippingAddress,
          seller: sellerId,
          sellerName,
          paymentId: razorpay_payment_id,
          orderId: razorpay_order_id,
        });

        p.stock = Math.max(0, p.stock - qty);
        if (p.stock === 0) p.isActive = false;
        await p.save();

        createdOrders.push(order);

        if (sellerEmail) {
          Promise.allSettled([
            sendOrderConfirmation(req.user.email, order, req.user.fullName),
            sendSellerNotification(sellerEmail, order, sellerName),
          ]).catch(() => {});
        }

        // Real-time Notification & Socket event for Seller
        try {
          const sellerNotification = await Notification.create({
            user: sellerId,
            type: "ORDER",
            title: "New Order Received!",
            message: `${req.user.fullName} ordered ${qty}x "${p.name}" (₹${totalAmount})`,
            link: "/orders",
          });
          const io = getIo();
          if (io) {
            const sellerIdStr = (sellerId?._id || sellerId).toString();
            const buyerIdStr = req.user._id.toString();
            const payload = { order, sellerId: sellerIdStr, buyerId: buyerIdStr };

            io.to(sellerIdStr).emit("new_notification", sellerNotification);
            io.emit("order_created", payload);
          }
        } catch {
          // Non-critical socket/notification fallback
        }
      }

      // Clear user cart after successful order creation
      userCart.items = [];
      userCart.totalAmount = 0;
      userCart.itemCount = 0;
      await userCart.save();

      return res.status(201).json({ message: "Cart orders placed successfully", order: createdOrders[0], orders: createdOrders });
    }

    const qty = Number(quantity);
    if (isNaN(qty) || qty < 1 || qty > 10000) {
      return res.status(400).json({ message: "Invalid quantity" });
    }

    const product = await Product.findById(productId).populate("owner");
    if (!product) return res.status(404).json({ message: "Product not found" });

    const now = new Date();
    if (new Date(product.expiryDate) <= now) {
      return res.status(400).json({ message: "Sorry, this product has expired and is no longer available for purchase." });
    }

    if (product.stock < qty) {
      return res.status(400).json({ message: "Insufficient stock" });
    }

    // Determine real unit price (with offer logic)
    let unitPrice = product.discountPrice;
    let appliedOffer = null;

    const sellerId = product.owner?._id || product.owner || req.user._id;
    const sellerName = product.owner?.fullName || "Seller";
    const sellerEmail = product.owner?.email || null;

    if (offerId) {
      const offer = await Offer.findById(offerId);
      if (offer && offer.isActive && offer.expiresAt > new Date()) {
        const productInOffer = offer.products.some(p => (p._id ? p._id.toString() : p.toString()) === productId);
        if (productInOffer && (offer.usageLimit === null || offer.usageCount < offer.usageLimit)) {
          const base = product.discountPrice || product.marketPrice;
          unitPrice = Math.max(1, Math.round(base * (1 - offer.discountPercentage / 100)));
          appliedOffer = offer._id;
          if (offer.usageLimit !== null) {
            offer.usageCount += 1;
            await offer.save();
          }
        }
      }
    }

    const totalAmount = unitPrice * qty;

    const order = await Order.create({
      product: productId,
      productName: product.name,
      productImage: product.image,
      quantity: qty,
      unitPrice,
      totalAmount,
      buyer: req.user._id,
      buyerName: req.user.fullName,
      buyerEmail: req.user.email,
      buyerPhone: req.user.phone,
      shippingAddress,
      seller: sellerId,
      sellerName,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      offer: appliedOffer,
    });

    product.stock = Math.max(0, product.stock - qty);
    if (product.stock === 0) product.isActive = false;
    await product.save();

    // Non-blocking background email dispatch (0ms delay for API response)
    if (sellerEmail) {
      Promise.allSettled([
        sendOrderConfirmation(req.user.email, order, req.user.fullName),
        sendSellerNotification(sellerEmail, order, sellerName),
      ]).catch(() => {});
    }

    // Real-time Notification & Socket event for Seller
    try {
      const sellerNotification = await Notification.create({
        user: sellerId,
        type: "ORDER",
        title: "New Order Received!",
        message: `${req.user.fullName} ordered ${qty}x "${product.name}" (₹${totalAmount})`,
        link: "/orders",
      });
      const io = getIo();
      if (io) {
        const sellerIdStr = (sellerId?._id || sellerId).toString();
        const buyerIdStr = req.user._id.toString();
        const payload = { order, sellerId: sellerIdStr, buyerId: buyerIdStr };

        io.to(sellerIdStr).emit("new_notification", sellerNotification);
        io.emit("order_created", payload);
      }
    } catch {
      // Non-critical socket/notification fallback
    }

        // ─── REMOVE PURCHASED ITEM FROM CART ───
    try {
      await Cart.findOneAndUpdate(
        { user: req.user._id },
        { $pull: { items: { product: productId } } }
      );
    } catch (cartErr) {
      console.error("Failed to clear cart item after order:", cartErr.message);
      // Non-critical: don't fail the order if cart cleanup fails
    }
    

    res.status(201).json({ message: "Order placed", order });
  } catch (error) {
    console.error("Verification error:", error);
    res.status(500).json({ message: error.message });
  }
};


// @desc    Get my orders (as buyer)
export const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ buyer: req.user._id })
      .populate("product", "name image location")
      .populate("seller", "fullName phone latitude longitude location")
      .sort({ createdAt: -1 });
    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get received orders (as seller)
export const getReceivedOrders = async (req, res) => {
  try {
    const orders = await Order.find({ seller: req.user._id })
      .populate("product", "name image location")
      .populate("buyer", "fullName phone latitude longitude location")
      .sort({ createdAt: -1 });
    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update order status
export const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;

    // 👇 Validate status
    const validStatuses = ["pending", "confirmed", "shipped", "delivered", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid order status" });
    }

    // Allow seller, buyer, or admin to update/cancel order status
    const query = req.user.isAdmin
      ? { _id: req.params.id }
      : { _id: req.params.id, $or: [{ seller: req.user._id }, { buyer: req.user._id }] };

    const order = await Order.findOne(query);
    if (!order) return res.status(404).json({ message: "Order not found" });

    order.status = status;
    await order.save();

    // Emit the order update independently, so notification failures never block
    // the buyer's live delivery tracking.
    const buyerIdStr = order.buyer.toString();
    const sellerIdStr = order.seller.toString();
    const updatePayload = { orderId: order._id.toString(), status, order };

    try {
      const io = getIo();
      io.to(buyerIdStr).emit("order_updated", updatePayload);
      io.to(sellerIdStr).emit("order_updated", updatePayload);
    } catch (socketError) {
      console.error("Unable to emit live order update:", socketError.message);
    }

    try {
      const isSellerUpdating = req.user._id.toString() === sellerIdStr;
      const recipientId = isSellerUpdating ? buyerIdStr : sellerIdStr;
      const formattedStatus = status.charAt(0).toUpperCase() + status.slice(1);
      const messageText = isSellerUpdating
        ? `Your order for "${order.productName}" has been ${formattedStatus}!`
        : `Order for "${order.productName}" status changed to ${formattedStatus} by buyer.`;

      const notification = await Notification.create({
        user: recipientId,
        type: "order",
        message: messageText,
        link: "/orders",
      });

      getIo().to(recipientId).emit("new_notification", notification);
    } catch (notificationError) {
      console.error("Unable to create order notification:", notificationError.message);
    }

    res.status(200).json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Clear order history for buyer
export const clearMyOrders = async (req, res) => {
  try {
    const { mode } = req.query; // 'all' or 'cancelled'
    const query = { buyer: req.user._id };
    if (mode !== "all") {
      query.status = "cancelled";
    }
    await Order.deleteMany(query);
    res.status(200).json({ message: "Cancelled orders cleared successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete single order by ID
export const deleteOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const query = req.user.isAdmin
      ? { _id: id }
      : { _id: id, $or: [{ buyer: req.user._id }, { seller: req.user._id }] };

    const order = await Order.findOne(query);
    if (!order) return res.status(404).json({ message: "Order not found" });

    await Order.findByIdAndDelete(id);
    res.status(200).json({ message: "Order deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
