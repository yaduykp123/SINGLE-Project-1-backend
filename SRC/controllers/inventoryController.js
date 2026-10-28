import Batch from "../models/BatchSchema.js";
import Product from "../models/productSchema.js";
import InventoryTransaction from "../models/InventoryTransactionSchema.js";
import {
  createBatch,
  adjustBatchStock,
  syncProductAggregateStock,
  deleteBatchById,
  clearAllExpiredBatchesService,
} from "../services/inventoryService.js";
import {
  getSuggestionsForSeller,
  applyBatchDiscount,
} from "../services/discountSuggestionService.js";
import { processBatchExpiryChecks } from "../services/batchExpiryService.js";

// 1. GET INVENTORY DASHBOARD SUMMARY
export const getInventorySummary = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const now = new Date();
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const query = req.user.isAdmin ? {} : { seller: sellerId };

    const batches = await Batch.find(query).populate("product", "name category marketPrice discountPrice unit");

    let totalAvailableStock = 0;
    let expiredStockTotal = 0;
    let approachingExpiryCount = 0;
    let lowStockCount = 0;

    for (const b of batches) {
      const isExp = new Date(b.expiryDate) <= now;
      if (isExp) {
        expiredStockTotal += (b.expiredStock || 0) + (b.availableStock || 0);
      } else {
        totalAvailableStock += (b.availableStock || 0);
        if (new Date(b.expiryDate) <= sevenDaysFromNow && b.availableStock > 0) {
          approachingExpiryCount++;
        }
        if (b.availableStock > 0 && b.availableStock <= 5) {
          lowStockCount++;
        }
      }
    }

    const suggestions = await getSuggestionsForSeller(sellerId);

    res.status(200).json({
      success: true,
      summary: {
        totalAvailableStock,
        expiredStockTotal,
        approachingExpiryCount,
        lowStockCount,
        pendingSuggestionsCount: suggestions.length,
        totalBatches: batches.length,
      },
      suggestions: suggestions.slice(0, 5), // top 5
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. GET BATCHES (WITH FILTERING & PAGINATION)
export const getBatches = async (req, res) => {
  try {
    const { productId, status = "all", search = "", page = 1, limit = 20 } = req.query;
    const query = req.user.isAdmin ? {} : { seller: req.user._id };

    if (productId) {
      query.product = productId;
    }

    const now = new Date();
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    if (status === "active") {
      query.isActive = true;
      query.availableStock = { $gt: 0 };
      query.expiryDate = { $gt: now };
    } else if (status === "expiring_soon") {
      query.isActive = true;
      query.availableStock = { $gt: 0 };
      query.expiryDate = { $gt: now, $lte: sevenDaysFromNow };
    } else if (status === "expired") {
      query.$or = [{ expiryDate: { $lte: now } }, { expiredStock: { $gt: 0 } }];
    } else if (status === "out_of_stock") {
      query.availableStock = 0;
      query.expiryDate = { $gt: now };
    }

    if (search) {
      query.batchNumber = { $regex: search, $options: "i" };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Batch.countDocuments(query);
    const batches = await Batch.find(query)
      .populate("product", "name category marketPrice discountPrice unit image")
      .sort({ expiryDate: 1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.status(200).json({
      success: true,
      batches,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. CREATE BATCH
export const addBatch = async (req, res) => {
  try {
    const { productId, batchNumber, quantity, expiryDate, costPrice } = req.body;

    const batch = await createBatch({
      productId,
      sellerId: req.user._id,
      batchNumber,
      quantity,
      expiryDate,
      costPrice,
      performedBy: req.user._id,
      performedByName: req.user.fullName,
    });

    res.status(201).json({
      success: true,
      message: `Batch "${batch.batchNumber}" created successfully`,
      batch,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// 4. ADJUST BATCH STOCK
export const adjustStock = async (req, res) => {
  try {
    const { batchId } = req.params;
    const { newStock, reason } = req.body;

    const batch = await adjustBatchStock({
      batchId,
      sellerId: req.user._id,
      newStock,
      reason,
      performedBy: req.user._id,
      performedByName: req.user.fullName,
    });

    res.status(200).json({
      success: true,
      message: "Batch stock adjusted successfully",
      batch,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// 5. GET INVENTORY TRANSACTION AUDIT HISTORY
export const getInventoryTransactions = async (req, res) => {
  try {
    const { productId, batchId, page = 1, limit = 30 } = req.query;
    const query = req.user.isAdmin ? {} : { seller: req.user._id };

    if (productId) query.product = productId;
    if (batchId) query.batch = batchId;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await InventoryTransaction.countDocuments(query);
    const transactions = await InventoryTransaction.find(query)
      .populate("product", "name")
      .populate("batch", "batchNumber")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.status(200).json({
      success: true,
      transactions,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 6. GET SMART DISCOUNT SUGGESTIONS
export const getDiscountSuggestions = async (req, res) => {
  try {
    const suggestions = await getSuggestionsForSeller(req.user._id);
    res.status(200).json({
      success: true,
      count: suggestions.length,
      suggestions,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 7. APPLY / APPROVE DISCOUNT SUGGESTION
export const approveDiscount = async (req, res) => {
  try {
    const { batchId, discountPercent, sellingPrice } = req.body;

    const result = await applyBatchDiscount({
      batchId,
      sellerId: req.user._id,
      discountPercent,
      sellingPrice,
      performedByName: req.user.fullName,
    });

    res.status(200).json({
      success: true,
      message: "Discount applied successfully to batch and product",
      result,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// 8. TRIGGER EXPIRY CHECK (Safe, idempotent)
export const triggerExpiryCheck = async (req, res) => {
  try {
    const summary = await processBatchExpiryChecks();
    res.status(200).json({
      success: true,
      message: "Expiry check completed successfully",
      summary,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 9. BARCODE-ASSISTED INVENTORY LOOKUP
export const lookupBarcode = async (req, res) => {
  try {
    const barcode = String(req.params.barcode || "").trim();
    if (!barcode) {
      return res.status(400).json({ success: false, message: "Barcode parameter is required" });
    }

    // 1. Search local product catalogue
    const localProduct = await Product.findOne({ barcode });
    if (localProduct) {
      return res.status(200).json({
        success: true,
        source: "local",
        product: {
          name: localProduct.name,
          brand: localProduct.brand,
          category: localProduct.category,
          unit: localProduct.unit,
          marketPrice: localProduct.marketPrice,
          image: localProduct.image,
          barcode,
        },
      });
    }

    // 2. Query Open Food Facts external catalogue
    try {
      const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`, {
        headers: { "User-Agent": "ExpireOff-FoodWasteMarketplace/1.0" },
        signal: AbortSignal.timeout(4000),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.status === 1 && data.product) {
          const p = data.product;
          const rawName = p.product_name || p.product_name_en || p.generic_name || "";
          if (rawName) {
            const rawCat = (p.categories || "").toLowerCase();
            let category = "Grocery Items";
            if (rawCat.includes("fruit")) category = "Fruits";
            else if (rawCat.includes("vegetable")) category = "Vegetables";
            else if (rawCat.includes("dairy") || rawCat.includes("milk") || rawCat.includes("cheese") || rawCat.includes("yogurt")) category = "Dairy";
            else if (rawCat.includes("bakery") || rawCat.includes("bread") || rawCat.includes("pastry")) category = "Bakery";
            else if (rawCat.includes("meat") || rawCat.includes("fish") || rawCat.includes("poultry") || rawCat.includes("seafood")) category = "Meat/Fish";

            return res.status(200).json({
              success: true,
              source: "catalogue",
              product: {
                name: rawName,
                brand: p.brands || "",
                category,
                unit: p.quantity?.toLowerCase().includes("kg") ? "kg" : p.quantity?.toLowerCase().includes("g") ? "g" : "packs",
                image: p.image_url || p.image_front_url || "",
                barcode,
              },
            });
          }
        }
      }
    } catch {
      // External API network timeout or failure
    }

    // Do not invent product details when lookup fails
    return res.status(200).json({
      success: false,
      found: false,
      message: "No product details found for this barcode. Please enter product information manually.",
      barcode,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 10. DELETE INDIVIDUAL BATCH
export const deleteBatch = async (req, res) => {
  try {
    const { batchId } = req.params;
    const result = await deleteBatchById({
      batchId,
      sellerId: req.user._id,
      isAdmin: req.user.isAdmin,
      performedBy: req.user._id,
      performedByName: req.user.fullName,
    });
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// 11. CLEAR ALL EXPIRED BATCHES IN BULK
export const clearExpiredBatches = async (req, res) => {
  try {
    const result = await clearAllExpiredBatchesService({
      sellerId: req.user._id,
      isAdmin: req.user.isAdmin,
      performedBy: req.user._id,
      performedByName: req.user.fullName,
    });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

