import Cart from "../models/CartSchema.js";
import Product from "../models/productSchema.js";

// Helper to recalc totals manually if needed
const recalcCart = (cart) => {
  cart.itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  cart.totalAmount = cart.items.reduce((sum, item) => sum + item.totalPrice, 0);
};

// @desc    Add item to cart
// @route   POST /api/cart
export const addToCart = async (req, res) => {
  try {
    const { productId, quantity = 1 } = req.body;
    const userId = req.user._id;

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (!product.isActive || product.stock < 1) {
      return res.status(400).json({ message: "Product is out of stock" });
    }
    if (new Date(product.expiryDate) <= new Date()) {
      return res.status(400).json({ message: "Product has expired and cannot be added to cart" });
    }

    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
      cart = new Cart({ user: userId, items: [] });
    }

    const existingItem = cart.items.find(
      (item) => item.product.toString() === productId,
    );

    const qtyToAdd = Math.max(1, Number(quantity));
    const unitPrice = product.discountPrice || product.marketPrice;

    if (existingItem) {
      const newQty = existingItem.quantity + qtyToAdd;
      if (newQty > product.stock) {
        return res
          .status(400)
          .json({ message: `Only ${product.stock} units available` });
      }
      existingItem.quantity = newQty;
      existingItem.totalPrice = newQty * unitPrice;
    } else {
      if (qtyToAdd > product.stock) {
        return res
          .status(400)
          .json({ message: `Only ${product.stock} units available` });
      }
      cart.items.push({
        product: productId,
        quantity: qtyToAdd,
        unitPrice,
        totalPrice: qtyToAdd * unitPrice,
      });
    }

    await cart.save();
    await cart.populate({
      path: "items.product",
      select: "name image stock discountPrice marketPrice expiryDate ownerName city",
    });

    res.status(200).json({ message: "Added to cart", cart });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// @desc    Get user cart
// @route   GET /api/cart
export const getCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id }).populate(
      "items.product",
      "name image stock discountPrice marketPrice expiryDate ownerName city"
    );

    if (!cart) {
      return res.status(200).json({
        cart: { items: [], totalAmount: 0, itemCount: 0 },
      });
    }

    // Filter out items where product was deleted/removed
    const validItems = cart.items.filter((item) => item.product !== null);
    if (validItems.length !== cart.items.length) {
      cart.items = validItems;
      await cart.save();
    }

    res.status(200).json({ cart });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update cart item quantity (increase / decrease / set)
// @route   PUT /api/cart/:itemId
export const updateCartItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { action, quantity } = req.body;
    const userId = req.user._id;

    const cart = await Cart.findOne({ user: userId });
    if (!cart) return res.status(404).json({ message: "Cart not found" });

    const item = cart.items.id(itemId);
    if (!item)
      return res.status(404).json({ message: "Item not found in cart" });

    const product = await Product.findById(item.product);
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (new Date(product.expiryDate) <= new Date()) {
      return res.status(400).json({ message: "Product has expired and cannot be updated" });
    }

    if (action === "increase") {
      if (item.quantity + 1 > product.stock) {
        return res
          .status(400)
          .json({ message: `Only ${product.stock} available` });
      }
      item.quantity += 1;
      item.totalPrice = item.quantity * item.unitPrice;
    } else if (action === "decrease") {
      if (item.quantity > 1) {
        item.quantity -= 1;
        item.totalPrice = item.quantity * item.unitPrice;
      }
    } else if (action === "set") {
      const newQty = Number(quantity);
      if (newQty <= 0) {
        cart.items.pull(itemId);
      } else {
        if (newQty > product.stock) {
          return res
            .status(400)
            .json({ message: `Only ${product.stock} available` });
        }
        item.quantity = newQty;
        item.totalPrice = item.quantity * item.unitPrice;
      }
    }

    recalcCart(cart);
    await cart.save();

    await cart.populate(
      "items.product",
      "name image stock discountPrice marketPrice expiryDate ownerName city"
    );

    res.status(200).json({ message: "Cart updated", cart });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Remove item from cart
// @route   DELETE /api/cart/:itemId
export const removeFromCart = async (req, res) => {
  try {
    const { itemId } = req.params;
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) return res.status(404).json({ message: "Cart not found" });

    cart.items.pull(itemId);
    recalcCart(cart);
    await cart.save();

    await cart.populate(
      "items.product",
      "name image stock discountPrice marketPrice expiryDate ownerName city"
    );

    res.status(200).json({ message: "Item removed", cart });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Clear entire cart
// @route   DELETE /api/cart
export const clearCart = async (req, res) => {
  try {
    const cart = await Cart.findOneAndUpdate(
      { user: req.user._id },
      { items: [], totalAmount: 0, itemCount: 0 },
      { new: true },
    );
    res.status(200).json({ message: "Cart cleared", cart });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
