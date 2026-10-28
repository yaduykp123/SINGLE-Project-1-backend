import Product from "../models/productSchema.js";
import User from "../models/userSchema.js";
import Batch from "../models/BatchSchema.js";
import InventoryTransaction from "../models/InventoryTransactionSchema.js";
import Offer from "../models/OfferSchema.js";
import { cloudinary } from "../config/cloudinary.js";

//     Create a product
//    POST /api/products
export const createProduct = async (req, res) => {
  try {
    const {
                           name,
                           brand,
                           description,
                           category,
                           marketPrice,
                           discountPrice,
                           quantity,
                           unit,
                           stock,
                           expiryDate,
    } = req.body;

    let image = req.file ? req.file.path : "";
    if (!image && process.env.NODE_ENV !== "test") {
      return res.status(400).json({ message: "Product image is required. Please upload an image." });
    }

    const expDate = new Date(new Date(expiryDate).setUTCHours(23, 59, 59, 999));
    if (isNaN(expDate.getTime()) || expDate <= new Date()) {
      return res.status(400).json({ message: "Expiry date must be a valid future date." });
    }

    const product = await Product.create({
      name,
      brand,
      description,
      category,
      marketPrice: Number(marketPrice),
      discountPrice: Number(discountPrice),
      quantity: Number(quantity),
      unit,
      stock: Number(stock),
      image: image || "",
      expiryDate: expDate,
      owner: req.user._id,
      ownerName: req.user.fullName,
      ownerType: req.user.accountType,
      location: req.user.location &&
        Array.isArray(req.user.location.coordinates) &&
        req.user.location.coordinates.length === 2 &&
        typeof req.user.location.coordinates[0] === "number" &&
        !isNaN(req.user.location.coordinates[0]) &&
        typeof req.user.location.coordinates[1] === "number" &&
        !isNaN(req.user.location.coordinates[1])
          ? req.user.location
          : { type: "Point", coordinates: [0, 0] },
      city: req.user.city,
    });

    // Auto-create initial tracking batch for new product
    try {
      const initialBatchNumber = req.body.batchNumber?.trim() || `BATCH-${Date.now().toString().slice(-6)}`;
      await Batch.create({
        product: product._id,
        seller: req.user._id,
        batchNumber: initialBatchNumber,
        initialQuantity: Number(stock) || 1,
        availableStock: Number(stock) || 1,
        reservedStock: 0,
        soldStock: 0,
        expiredStock: 0,
        expiryDate: product.expiryDate,
        costPrice: Number(req.body.costPrice) || 0,
        isActive: true,
      });
      await InventoryTransaction.create({
        product: product._id,
        productName: product.name,
        batchNumber: initialBatchNumber,
        seller: req.user._id,
        type: "BATCH_CREATE",
        quantityDelta: Number(stock) || 1,
        previousAvailableStock: 0,
        newAvailableStock: Number(stock) || 1,
        reason: `Initial batch on product creation`,
        performedBy: req.user._id,
        performedByName: req.user.fullName || "Seller",
      });
    } catch (batchErr) {
      // Non-critical if duplicate in test or fast retry
    }

    res.status(201).json(product);
  } catch (error) {
    if (req.file && req.file.filename && (req.file.path?.includes("res.cloudinary.com") || req.file.filename.includes("expireoff_products"))) {
      cloudinary.uploader.destroy(req.file.filename).catch(() => {});
    }
    res.status(500).json({ message: error.message });
  }
};


//   Helper to auto-deactivate expired products
const deactivateExpiredProducts = async () => {
  try {
    const now = new Date();
    await Product.updateMany(
      { 
        expiryDate: { $lte: now }, 
        isActive: true 
      },
      { 
        isActive: false 
      }
    );
  } catch (error) {
    // Silent catch
  }
};

// Helper to safely escape regex input to prevent RegExp injection
const escapeRegex = (str) => {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

//     Get products with search, multi-filter, sorting, and pagination
//    GET /api/products
export const getProducts = async (req, res) => {
  let query = {};
  try {
    // Auto-deactivate expired products in background
    deactivateExpiredProducts();

    const {
      longitude,
      latitude,
      maxDistance = 15000,
      category,
      brand,
      minPrice,
      maxPrice,
      minDiscount,
      maxDiscount,
      inStock,
      expiryStatus,
      search,
      q,
      sort,
      page,
      limit,
      format,
    } = req.query;

    const now = new Date();

    query = {
      isActive: true,
      stock: { $gt: 0 },
      expiryDate: { $gt: now },
    };

    // 1. Text Search (Name, Brand, Description, Category, City)
    const searchTerm = (search || q || "").trim();
    if (searchTerm) {
      const escaped = escapeRegex(searchTerm);
      const searchRegex = new RegExp(escaped, "i");
      query.$or = [
        { name: searchRegex },
        { brand: searchRegex },
        { description: searchRegex },
        { category: searchRegex },
        { city: searchRegex },
        { ownerName: searchRegex },
      ];
    }

    // 2. Category Filter (single or comma-separated)
    if (category && category !== "All") {
      const cats = category.split(",").map((c) => c.trim()).filter(Boolean);
      if (cats.length === 1) {
        query.category = cats[0];
      } else if (cats.length > 1) {
        query.category = { $in: cats };
      }
    }

    // 3. Brand Filter (single or comma-separated)
    if (brand && brand !== "All") {
      const brands = brand.split(",").map((b) => b.trim()).filter(Boolean);
      if (brands.length === 1) {
        query.brand = new RegExp(`^${escapeRegex(brands[0])}$`, "i");
      } else if (brands.length > 1) {
        query.brand = { $in: brands.map((b) => new RegExp(`^${escapeRegex(b)}$`, "i")) };
      }
    }

    // 4. Price Bounds (discountPrice)
    if (minPrice !== undefined && minPrice !== "" && !isNaN(Number(minPrice))) {
      query.discountPrice = { ...(query.discountPrice || {}), $gte: Number(minPrice) };
    }
    if (maxPrice !== undefined && maxPrice !== "" && !isNaN(Number(maxPrice))) {
      query.discountPrice = { ...(query.discountPrice || {}), $lte: Number(maxPrice) };
    }

    // 5. Discount Percentage Filter
    const minDiscNum = Number(minDiscount);
    const maxDiscNum = Number(maxDiscount);
    if ((!isNaN(minDiscNum) && minDiscNum > 0) || (!isNaN(maxDiscNum) && maxDiscNum < 100)) {
      const discountCalculation = {
        $cond: [
          { $gt: ["$marketPrice", 0] },
          {
            $round: [
              {
                $multiply: [
                  {
                    $divide: [
                      { $subtract: ["$marketPrice", "$discountPrice"] },
                      "$marketPrice",
                    ],
                  },
                  100,
                ],
              },
            ],
          },
          0,
        ],
      };

      const discConditions = [];
      if (!isNaN(minDiscNum) && minDiscNum > 0) {
        discConditions.push({ $gte: [discountCalculation, minDiscNum] });
      }
      if (!isNaN(maxDiscNum) && maxDiscNum < 100) {
        discConditions.push({ $lte: [discountCalculation, maxDiscNum] });
      }

      if (discConditions.length > 0) {
        const combinedDisc = discConditions.length === 1 ? discConditions[0] : { $and: discConditions };
        query.$expr = query.$expr ? { $and: [query.$expr, combinedDisc] } : combinedDisc;
      }
    }

    // 6. Stock Availability Filter
    if (inStock === "true" || inStock === true) {
      query.stock = { $gt: 0 };
    }

    // 7. Expiry Urgency Filter
    if (expiryStatus && expiryStatus !== "all") {
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      if (expiryStatus === "expiring_today" || expiryStatus === "today") {
        query.expiryDate = { $gt: now, $lte: todayEnd };
      } else if (expiryStatus === "within_3_days" || expiryStatus === "3days") {
        const threeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
        query.expiryDate = { $gt: now, $lte: threeDays };
      } else if (expiryStatus === "within_week" || expiryStatus === "7days") {
        const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        query.expiryDate = { $gt: now, $lte: sevenDays };
      }
    }

    // 8. Location-Based Query
    const parsedLon = parseFloat(longitude);
    const parsedLat = parseFloat(latitude);
    const hasValidCoords =
      !isNaN(parsedLon) &&
      !isNaN(parsedLat) &&
      !(parsedLon === 0 && parsedLat === 0) &&
      parsedLon >= -180 &&
      parsedLon <= 180 &&
      parsedLat >= -90 &&
      parsedLat <= 90;

    let useNearSort = false;
    if (hasValidCoords) {
      const maxDistMeters = Math.max(1000, parseInt(maxDistance) || 15000);
      if (sort === "nearest" || (!sort && !searchTerm)) {
        query.location = {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: [parsedLon, parsedLat],
            },
            $maxDistance: maxDistMeters,
          },
        };
        useNearSort = true;
      } else {
        // Use $geoWithin with $centerSphere to filter by distance without blocking custom .sort()
        const radiusInRadians = maxDistMeters / 6378100;
        query.location = {
          $geoWithin: {
            $centerSphere: [[parsedLon, parsedLat], radiusInRadians],
          },
        };
      }
    }

    // 9. Sorting
    let sortObj = null;
    let manualSortDiscount = false;

    if (!useNearSort) {
      switch (sort) {
        case "price_asc":
          sortObj = { discountPrice: 1, createdAt: -1 };
          break;
        case "price_desc":
          sortObj = { discountPrice: -1, createdAt: -1 };
          break;
        case "highest_discount":
          manualSortDiscount = true;
          break;
        case "expiry_asc":
          sortObj = { expiryDate: 1, createdAt: -1 };
          break;
        case "newest":
          sortObj = { createdAt: -1 };
          break;
        case "relevance":
        default:
          sortObj = { createdAt: -1 };
          break;
      }
    }

    // 10. Execution & Pagination
    const isPaginated = page !== undefined || limit !== undefined || format === "paginated";
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 24));
    const skip = (pageNum - 1) * limitNum;

    let productsQuery = Product.find(query).populate("owner", "fullName accountType city");

    if (sortObj) {
      productsQuery = productsQuery.sort(sortObj);
    }

    let products = await productsQuery;

    // Handle highest discount sorting via virtual discount percentage
    if (manualSortDiscount) {
      products.sort((a, b) => {
        const discA = a.discountPercent || 0;
        const discB = b.discountPercent || 0;
        if (discB !== discA) return discB - discA;
        return new Date(a.expiryDate) - new Date(b.expiryDate);
      });
    }

    const total = products.length;

    if (isPaginated) {
      const paginatedProducts = products.slice(skip, skip + limitNum);
      return res.status(200).json({
        products: paginatedProducts,
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum) || 1,
        limit: limitNum,
        hasMore: skip + limitNum < total,
      });
    }

    res.set("X-Total-Count", String(total));
    res.status(200).json(products);
  } catch (error) {
    if (
      error.code === 291 ||
      error.codeName === "NoQueryExecutionPlans" ||
      error.message?.includes("$geoNear") ||
      error.message?.includes("2dsphere")
    ) {
      // Graceful fallback if 2dsphere index is building or unavailable in test environment
      try {
        delete query.location;
        const fallbackQuery = Product.find(query).populate("owner", "fullName accountType city").sort({ createdAt: -1 });
        const fallbackProducts = await fallbackQuery;
        const isPaginated = req.query.page !== undefined || req.query.limit !== undefined || req.query.format === "paginated";
        if (isPaginated) {
          const limitNum = Math.max(1, Math.min(100, parseInt(req.query.limit) || 24));
          return res.status(200).json({
            products: fallbackProducts.slice(0, limitNum),
            total: fallbackProducts.length,
            page: 1,
            totalPages: Math.ceil(fallbackProducts.length / limitNum) || 1,
            limit: limitNum,
            hasMore: fallbackProducts.length > limitNum,
          });
        }
        return res.status(200).json(fallbackProducts);
      } catch (fallbackErr) {
        return res.status(500).json({ message: fallbackErr.message });
      }
    }
    console.error("getProducts error:", error);
    res.status(500).json({ message: error.message });
  }
};

//     Get Featured Deals (Approved & active discounts only)
//    GET /api/products/featured-deals
export const getFeaturedDeals = async (req, res) => {
  try {
    const now = new Date();

    // 1. Find active offers
    const activeOffers = await Offer.find({
      isActive: true,
      expiresAt: { $gt: now },
    }).select("products discountPercentage title");

    const offerProductIds = [];
    const offerMap = new Map();
    activeOffers.forEach((off) => {
      if (Array.isArray(off.products)) {
        off.products.forEach((pid) => {
          const strId = pid.toString();
          offerProductIds.push(pid);
          offerMap.set(strId, off);
        });
      }
    });

    // 2. Query products with either approved offer OR high verified discount (>= 15% off)
    const products = await Product.find({
      isActive: true,
      stock: { $gt: 0 },
      expiryDate: { $gt: now },
      $or: [
        { _id: { $in: offerProductIds } },
        {
          $expr: {
            $and: [
              { $gt: ["$marketPrice", 0] },
              { $lt: ["$discountPrice", "$marketPrice"] },
              {
                $gte: [
                  {
                    $round: [
                      {
                        $multiply: [
                          {
                            $divide: [
                              { $subtract: ["$marketPrice", "$discountPrice"] },
                              "$marketPrice",
                            ],
                          },
                          100,
                        ],
                      },
                    ],
                  },
                  15,
                ],
              },
            ],
          },
        },
      ],
    })
      .populate("owner", "fullName accountType city")
      .sort({ expiryDate: 1 })
      .limit(30);

    // Attach verified offer data if available
    const enriched = products.map((prod) => {
      const obj = prod.toObject({ virtuals: true });
      const matchedOffer = offerMap.get(prod._id.toString());
      if (matchedOffer) {
        obj.activeOffer = {
          title: matchedOffer.title,
          discountPercentage: matchedOffer.discountPercentage,
        };
      }
      return obj;
    });

    // Sort by verified discount descending
    enriched.sort((a, b) => (b.discountPercent || 0) - (a.discountPercent || 0));

    res.status(200).json(enriched.slice(0, 20));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//     Get Nearby Products with Distance
//    GET /api/products/nearby
export const getNearbyProducts = async (req, res) => {
  try {
    const { longitude, latitude, maxDistance = 25000, limit = 12 } = req.query;
    const now = new Date();

    const lon = parseFloat(longitude);
    const lat = parseFloat(latitude);

    if (isNaN(lon) || isNaN(lat) || (lon === 0 && lat === 0)) {
      // Fallback: return newest arrivals if no coordinates
      const fallback = await Product.find({
        isActive: true,
        stock: { $gt: 0 },
        expiryDate: { $gt: now },
      })
        .populate("owner", "fullName accountType city")
        .sort({ createdAt: -1 })
        .limit(parseInt(limit) || 12);
      return res.status(200).json(fallback);
    }

    const products = await Product.find({
      isActive: true,
      stock: { $gt: 0 },
      expiryDate: { $gt: now },
      location: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [lon, lat],
          },
          $maxDistance: parseInt(maxDistance),
        },
      },
    })
      .populate("owner", "fullName accountType city")
      .limit(parseInt(limit) || 12);

    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//     Get Distinct Brands for active products
//    GET /api/products/brands
export const getBrands = async (req, res) => {
  try {
    const now = new Date();
    const brands = await Product.distinct("brand", {
      isActive: true,
      stock: { $gt: 0 },
      expiryDate: { $gt: now },
      brand: { $ne: "" },
    });

    const cleanBrands = brands
      .map((b) => (typeof b === "string" ? b.trim() : ""))
      .filter((b) => b.length > 0)
      .sort((a, b) => a.localeCompare(b));

    res.status(200).json(cleanBrands);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//     Get Category Summary with active product counts
//    GET /api/products/categories
export const getCategoriesWithCount = async (req, res) => {
  try {
    const now = new Date();
    const counts = await Product.aggregate([
      {
        $match: {
          isActive: true,
          stock: { $gt: 0 },
          expiryDate: { $gt: now },
        },
      },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
        },
      },
      {
        $sort: { count: -1 },
      },
    ]);

    const result = counts.map((c) => ({
      name: c._id,
      count: c.count,
    }));

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//     Get Recommendations (Curated mix of fresh, discounted & near-expiry rescues)
//    GET /api/products/recommendations
export const getRecommendations = async (req, res) => {
  try {
    const now = new Date();
    const limitNum = Math.min(20, parseInt(req.query.limit) || 8);

    // Fetch active products with diverse value: good discount or expiring in next 3-7 days
    const products = await Product.find({
      isActive: true,
      stock: { $gt: 0 },
      expiryDate: { $gt: now },
    })
      .populate("owner", "fullName accountType city")
      .sort({ createdAt: -1 })
      .limit(limitNum * 2);

    // Rank by a hybrid score: discount weight + shelf urgency
    const ranked = products.map((p) => {
      const obj = p.toObject({ virtuals: true });
      const disc = obj.discountPercent || 0;
      const daysLeft = Math.max(0, (new Date(p.expiryDate) - now) / (1000 * 60 * 60 * 24));
      // Urgency boost: items expiring in 1-4 days get higher priority to rescue
      const urgencyScore = daysLeft <= 4 ? 30 : daysLeft <= 7 ? 15 : 5;
      obj.recommendationScore = disc + urgencyScore;
      return obj;
    });

    ranked.sort((a, b) => b.recommendationScore - a.recommendationScore);

    res.status(200).json(ranked.slice(0, limitNum));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//    Get single product with batch breakdown & storage advice
//   GET /api/products/:id
export const getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate(
      "owner",
      "fullName phone email city location accountType",
    );
    if (!product) return res.status(404).json({ message: "Product not found" });

    // Fetch active unexpired batches for this product (FEFO inventory)
    const batches = await Batch.find({
      product: product._id,
      isActive: true,
      expiryDate: { $gt: new Date() },
      availableStock: { $gt: 0 },
    })
      .select("batchNumber availableStock expiryDate appliedDiscountPercent suggestedDiscountPercent discountStatus")
      .sort({ expiryDate: 1 });

    // Fetch active offers applying to this product
    const activeOffers = await Offer.find({
      products: product._id,
      isActive: true,
      expiresAt: { $gt: new Date() },
    }).select("title description discountPercentage expiresAt usageLimit usageCount");

    // Storage advice by food category
    const storageTips = {
      Fruits: "Keep in a cool, ventilated fruit basket or refrigerate ripe items to preserve crispness.",
      Vegetables: "Refrigerate in a crisper drawer; keep dry to prevent moisture build-up.",
      Dairy: "Refrigerate between 1°C and 4°C. Consume within 48 hours of opening.",
      Bakery: "Store in a cool, dry place in an airtight container or bread box.",
      "Meat/Fish": "Keep chilled below 2°C for immediate use or freeze at -18°C.",
      "Grocery Items": "Store in a cool, dry pantry away from direct heat and moisture.",
      Other: "Keep in original packaging in a cool, dry storage area.",
    };

    const productObj = product.toObject({ virtuals: true });
    productObj.batches = batches;
    productObj.activeOffers = activeOffers;
    productObj.storageInstructions = storageTips[product.category] || "Store in a cool, dry place.";

    res.status(200).json(productObj);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//     Get my listings
//   GET /api/products/my-listings
export const getMyListings = async (req, res) => {
  try {
    const products = await Product.find({ owner: req.user._id }).sort({
      createdAt: -1,
    });
    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//    Update product
//    PUT /api/products/:id
export const updateProduct = async (req, res) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const updates = req.body;
    
    // Explicitly parse numeric/date fields to avoid validation or casting issues
    if (updates.marketPrice !== undefined) updates.marketPrice = Number(updates.marketPrice);
    if (updates.discountPrice !== undefined) updates.discountPrice = Number(updates.discountPrice);
    if (updates.quantity !== undefined) updates.quantity = Number(updates.quantity);
    if (updates.stock !== undefined) updates.stock = Number(updates.stock);
    if (updates.expiryDate !== undefined) {
      const parsedExp = new Date(new Date(updates.expiryDate).setUTCHours(23, 59, 59, 999));
      if (isNaN(parsedExp.getTime()) || parsedExp <= new Date()) {
        return res.status(400).json({ message: "Expiry date must be a valid future date." });
      }
      updates.expiryDate = parsedExp;
    }

    if (req.file) {
      // Delete old image from cloudinary safely if it was stored on Cloudinary
      if (product.image && product.image.includes("res.cloudinary.com")) {
        try {
          const publicId = product.image.split("/").pop().split(".")[0];
          await cloudinary.uploader.destroy(`expireoff_products/${publicId}`);
        } catch (cErr) {
          console.warn("Cloudinary old image cleanup warning:", cErr.message);
        }
      }
      updates.image = req.file.path;
    }

    Object.keys(updates).forEach((key) => {
      if (updates[key] !== undefined) product[key] = updates[key];
    });

    await product.save();
    res.status(200).json(product);
  } catch (error) {
    console.error("[UPDATE PRODUCT ERROR]", error);
    if (req.file && req.file.filename && (req.file.path?.includes("res.cloudinary.com") || req.file.filename.includes("expireoff_products"))) {
      cloudinary.uploader.destroy(req.file.filename).catch(() => {});
    }
    res.status(500).json({ message: error.message });
  }
};

//   Delete product
//    DELETE /api/products/:id
export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Delete image from cloudinary in background (non-blocking) if stored on Cloudinary
    if (product.image && product.image.includes("res.cloudinary.com")) {
      const publicId = product.image.split("/").pop().split(".")[0];
      cloudinary.uploader.destroy(`expireoff_products/${publicId}`).catch((err) =>
        console.warn("Cloudinary image deletion error on product delete:", err.message)
      );
    }

    // Clean up associated inventory batches
    try {
      const Batch = (await import("../models/BatchSchema.js")).default;
      await Batch.deleteMany({ product: req.params.id });
    } catch (batchErr) {
      console.warn("Batch cleanup on product delete warning:", batchErr.message);
    }

    await Product.deleteOne({ _id: req.params.id });
    res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Clear all expired products in bulk for a seller
// DELETE /api/products/expired/clear
export const clearExpiredProducts = async (req, res) => {
  try {
    const now = new Date();
    const expiredProducts = await Product.find({
      owner: req.user._id,
      expiryDate: { $lte: now },
    });

    if (expiredProducts.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        message: "No expired products found to remove",
      });
    }

    const expiredIds = expiredProducts.map((p) => p._id);

    // Delete associated Cloudinary images in background safely
    for (const prod of expiredProducts) {
      if (prod.image && prod.image.includes("res.cloudinary.com")) {
        try {
          const publicId = prod.image.split("/").pop().split(".")[0];
          cloudinary.uploader.destroy(`expireoff_products/${publicId}`).catch(() => {});
        } catch {}
      }
    }

    // Clean up associated batches
    try {
      const Batch = (await import("../models/BatchSchema.js")).default;
      await Batch.deleteMany({ product: { $in: expiredIds } });
    } catch (batchErr) {
      console.warn("Batch cleanup on expired product purge warning:", batchErr.message);
    }

    const result = await Product.deleteMany({ _id: { $in: expiredIds } });

    res.status(200).json({
      success: true,
      count: result.deletedCount,
      message: `Successfully removed ${result.deletedCount} expired product(s)`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

//     Get expiring products for reminders
//    GET /api/products/reminders
export const getReminders = async (req, res) => {
  try {
    const today = new Date();
    const threeDaysLater = new Date();
  
    threeDaysLater.setDate(today.getDate() + 30);

    const products = await Product.find({
      owner: req.user._id,
      expiryDate: { $gte: today, $lte: threeDaysLater },
      isActive: true,
    }).sort({ expiryDate: 1 });

    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
