import Batch from "../models/BatchSchema.js";
import Product from "../models/productSchema.js";

// Configurable baseline threshold rules
const DEFAULT_RULES = {
  // Days thresholds and suggested discount percentages
  thresholds: [
    { minDays: 15, maxDays: Infinity, discount: 0, label: "Fresh / Normal Shelf Life" },
    { minDays: 8, maxDays: 14, discount: 10, label: "Approaching Expiry (8-14 days)" },
    { minDays: 4, maxDays: 7, discount: 20, label: "Expiring Soon (4-7 days)" },
    { minDays: 1, maxDays: 3, discount: 35, label: "Critical Expiry (1-3 days)" },
  ],
  // Category-specific discount modifiers (percentage points added or subtracted)
  categoryModifiers: {
    "Fruits": 5,      // Highly perishable
    "Vegetables": 5,  // Highly perishable
    "Dairy": 5,       // Short shelf life
    "Meat/Fish": 5,   // Highly sensitive to spoilage
    "Grocery Items": 0,
    "Other": 0,
  },
  // Minimum selling price floor (in ₹)
  absoluteMinPrice: 1,
};

/**
 * Calculate suggested discount for a single batch based on remaining shelf life and category.
 */
export const calculateDiscountSuggestion = (batch, product, config = DEFAULT_RULES) => {
  if (!batch || !product) return null;

  const now = new Date();
  const expiryDate = new Date(batch.expiryDate);
  const diffTime = expiryDate.getTime() - now.getTime();
  const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  // If expired, sales are blocked!
  if (daysRemaining <= 0) {
    return {
      batchId: batch._id,
      batchNumber: batch.batchNumber,
      daysRemaining: 0,
      isExpired: true,
      canSell: false,
      suggestedDiscountPercent: 0,
      suggestedPrice: 0,
      originalPrice: product.marketPrice,
      currentDiscountPrice: product.discountPrice,
      reason: "Product batch is expired. Sales are blocked to ensure food safety.",
    };
  }

  // Find baseline discount from thresholds
  let baseDiscount = 0;
  let ruleLabel = "Fresh";

  for (const rule of config.thresholds) {
    if (daysRemaining >= rule.minDays && daysRemaining <= rule.maxDays) {
      baseDiscount = rule.discount;
      ruleLabel = rule.label;
      break;
    }
  }

  // Apply category modifier if discount is applicable
  const categoryModifier = config.categoryModifiers[product.category] || 0;
  let finalDiscount = baseDiscount > 0 ? baseDiscount + categoryModifier : 0;
  finalDiscount = Math.min(85, Math.max(0, finalDiscount)); // Cap between 0% and 85%

  const basePrice = product.marketPrice || product.discountPrice || 100;
  const rawDiscountedPrice = Math.round(basePrice * (1 - finalDiscount / 100));

  // Minimum acceptable price: either batch costPrice or absoluteMinPrice
  const minAllowedPrice = Math.max(config.absoluteMinPrice, batch.costPrice || 1);
  const suggestedPrice = Math.max(minAllowedPrice, rawDiscountedPrice);

  return {
    batchId: batch._id,
    batchNumber: batch.batchNumber,
    productId: product._id,
    productName: product.name,
    category: product.category,
    daysRemaining,
    isExpired: false,
    canSell: true,
    suggestedDiscountPercent: finalDiscount,
    suggestedPrice,
    originalPrice: product.marketPrice,
    currentDiscountPrice: product.discountPrice,
    availableStock: batch.availableStock,
    unit: product.unit,
    reason: `${ruleLabel}${categoryModifier > 0 ? ` with +${categoryModifier}% category boost for ${product.category}` : ""}`,
  };
};

/**
 * Get all discount suggestions for a seller's active batches.
 */
export const getSuggestionsForSeller = async (sellerId) => {
  const now = new Date();

  // Find active batches that have stock and are not yet expired
  const batches = await Batch.find({
    seller: sellerId,
    isActive: true,
    availableStock: { $gt: 0 },
    expiryDate: { $gt: now },
  })
    .populate("product")
    .sort({ expiryDate: 1 });

  const suggestions = [];

  for (const batch of batches) {
    if (!batch.product) continue;
    const suggestion = calculateDiscountSuggestion(batch, batch.product);
    if (suggestion && suggestion.suggestedDiscountPercent > 0) {
      suggestions.push(suggestion);
    }
  }

  return suggestions;
};

/**
 * Apply or approve a discount suggestion for a batch and its parent product.
 */
export const applyBatchDiscount = async ({
  batchId,
  sellerId,
  discountPercent,
  sellingPrice,
  performedByName = "Seller",
}) => {
  const batch = await Batch.findById(batchId).populate("product");
  if (!batch) {
    throw new Error("Batch not found");
  }

  if (batch.seller.toString() !== sellerId.toString() && performedByName !== "Admin") {
    throw new Error("Not authorized to apply discount on this batch");
  }

  if (new Date(batch.expiryDate) <= new Date()) {
    throw new Error("Cannot apply discount to an expired batch. Expired products cannot be sold.");
  }

  const disc = Number(discountPercent);
  if (isNaN(disc) || disc < 1 || disc > 99) {
    throw new Error("Invalid discount percentage (must be between 1 and 99)");
  }

  batch.appliedDiscountPercent = disc;
  batch.discountStatus = "approved";
  await batch.save();

  // Update product discount price if approved
  if (sellingPrice && Number(sellingPrice) > 0) {
    const product = batch.product;
    product.discountPrice = Number(sellingPrice);
    await product.save();
  }

  return {
    batch,
    product: batch.product,
  };
};
