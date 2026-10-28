import mongoose from "mongoose";
import Order from "../models/OrderSchema.js";
import Batch from "../models/BatchSchema.js";
import Product from "../models/productSchema.js";

// @desc    Get comprehensive seller analytics, charts, and waste reduction intelligence
// @route   GET /api/analytics/seller-dashboard
export const getSellerAnalytics = async (req, res) => {
  try {
    const sellerId = req.user.isAdmin && req.query.sellerId
      ? new mongoose.Types.ObjectId(req.query.sellerId)
      : new mongoose.Types.ObjectId(req.user._id);

    const timeRange = req.query.timeRange || "30d"; // 7d, 30d, 90d, all
    const now = new Date();

    let startDate = new Date(0); // 'all' fallback
    if (timeRange === "7d") {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (timeRange === "30d") {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (timeRange === "90d") {
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    }

    // 1. Core Sales & Order Aggregations (Completed / Non-cancelled)
    const salesAgg = await Order.aggregate([
      {
        $match: {
          seller: sellerId,
          createdAt: { $gte: startDate },
          status: { $ne: "cancelled" },
        },
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$totalAmount" },
          totalOrders: { $sum: 1 },
          totalUnitsSold: { $sum: "$quantity" },
          averageOrderValue: { $avg: "$totalAmount" },
        },
      },
    ]);

    const salesMetrics = salesAgg[0] || {
      totalRevenue: 0,
      totalOrders: 0,
      totalUnitsSold: 0,
      averageOrderValue: 0,
    };

    // 2. Daily Sales Trend (for chart rendering)
    const dailyTrend = await Order.aggregate([
      {
        $match: {
          seller: sellerId,
          createdAt: { $gte: startDate },
          status: { $ne: "cancelled" },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          revenue: { $sum: "$totalAmount" },
          orders: { $sum: 1 },
          units: { $sum: "$quantity" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // 3. Best-Performing Products
    const topProducts = await Order.aggregate([
      {
        $match: {
          seller: sellerId,
          createdAt: { $gte: startDate },
          status: { $ne: "cancelled" },
        },
      },
      {
        $group: {
          _id: "$product",
          productName: { $first: "$productName" },
          productImage: { $first: "$productImage" },
          totalUnitsSold: { $sum: "$quantity" },
          totalRevenue: { $sum: "$totalAmount" },
          orderCount: { $sum: 1 },
        },
      },
      { $sort: { totalUnitsSold: -1 } },
      { $limit: 5 },
    ]);

    // 4. Batch Inventory Health, Low-Stock, and Expiry Risk
    const batches = await Batch.find({ seller: sellerId })
      .populate("product", "name category marketPrice discountPrice unit");

    let totalAvailableStock = 0;
    let totalExpiredStock = 0;
    let totalInitialStock = 0;
    let totalSoldStock = 0;
    const lowStockList = [];
    const excessRiskList = [];
    const approachingExpiryList = [];

    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    for (const b of batches) {
      const isExpired = new Date(b.expiryDate) <= now;
      totalInitialStock += (b.initialQuantity || 0);
      totalSoldStock += (b.soldStock || 0);

      if (isExpired) {
        totalExpiredStock += (b.expiredStock || 0) + (b.availableStock || 0);
      } else {
        totalAvailableStock += (b.availableStock || 0);

        // Low stock: 1 to 5 units remaining
        if (b.availableStock > 0 && b.availableStock <= 5) {
          lowStockList.push({
            batchId: b._id,
            batchNumber: b.batchNumber,
            productName: b.product?.name || "Product",
            availableStock: b.availableStock,
            unit: b.product?.unit || "units",
            expiryDate: b.expiryDate,
          });
        }

        // Approaching expiry: within 7 days
        if (b.availableStock > 0 && new Date(b.expiryDate) <= sevenDaysFromNow) {
          const daysLeft = Math.ceil((new Date(b.expiryDate) - now) / (1000 * 60 * 60 * 24));
          approachingExpiryList.push({
            batchId: b._id,
            batchNumber: b.batchNumber,
            productName: b.product?.name || "Product",
            availableStock: b.availableStock,
            daysLeft: Math.max(0, daysLeft),
            unit: b.product?.unit || "units",
            suggestedDiscountPercent: b.suggestedDiscountPercent || 0,
            appliedDiscountPercent: b.appliedDiscountPercent || 0,
          });
        }

        // Excess stock risk: more than 15 units with 3 days or fewer left
        if (b.availableStock >= 15 && new Date(b.expiryDate) <= threeDaysFromNow) {
          excessRiskList.push({
            batchId: b._id,
            batchNumber: b.batchNumber,
            productName: b.product?.name || "Product",
            availableStock: b.availableStock,
            unit: b.product?.unit || "units",
            expiryDate: b.expiryDate,
            riskLevel: "HIGH",
          });
        }
      }
    }

    // 5. Sell-Through Rate
    const sellThroughRate = totalInitialStock > 0
      ? Math.round((totalSoldStock / totalInitialStock) * 100)
      : 0;

    // 6. Food Waste Avoided (Calculated from completed sales)
    const unitsRescued = salesMetrics.totalUnitsSold;
    const estimatedKgRescued = Math.round(unitsRescued * 0.8 * 10) / 10; // ~0.8kg avg per unit
    const estimatedCo2SavedKg = Math.round(estimatedKgRescued * 2.5 * 10) / 10; // 2.5kg CO2e per kg
    const estimatedMealsRescued = Math.round(unitsRescued * 2);

    // 7. Predictive Unsold Stock Forecasting (Daily sales run rate vs remaining shelf life)
    const past14DaysDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const pastSalesByProduct = await Order.aggregate([
      {
        $match: {
          seller: sellerId,
          createdAt: { $gte: past14DaysDate },
          status: { $ne: "cancelled" },
        },
      },
      {
        $group: {
          _id: "$product",
          unitsSold14d: { $sum: "$quantity" },
        },
      },
    ]);

    const salesRateMap = new Map();
    pastSalesByProduct.forEach((item) => {
      salesRateMap.set(item._id.toString(), item.unitsSold14d / 14); // daily run rate
    });

    const forecastedAtRisk = [];
    for (const b of batches) {
      if (b.availableStock > 0 && new Date(b.expiryDate) > now) {
        const prodId = b.product?._id ? b.product._id.toString() : b.product?.toString();
        const dailyRate = salesRateMap.get(prodId) || 0.2; // fallback minimum velocity
        const daysRemaining = Math.max(1, Math.ceil((new Date(b.expiryDate) - now) / (1000 * 60 * 60 * 24)));
        const expectedSales = Math.round(dailyRate * daysRemaining);

        if (b.availableStock > expectedSales) {
          const projectedUnsold = b.availableStock - expectedSales;
          forecastedAtRisk.push({
            batchNumber: b.batchNumber,
            productName: b.product?.name || "Product",
            availableStock: b.availableStock,
            daysRemaining,
            dailyVelocity: Math.round(dailyRate * 10) / 10,
            projectedUnsold,
            recommendedDiscount: projectedUnsold > 10 ? 40 : 25,
          });
        }
      }
    }

    res.status(200).json({
      success: true,
      timeRange,
      overview: {
        totalRevenue: salesMetrics.totalRevenue,
        totalOrders: salesMetrics.totalOrders,
        totalUnitsSold: salesMetrics.totalUnitsSold,
        averageOrderValue: Math.round(salesMetrics.averageOrderValue),
        sellThroughRate,
        totalAvailableStock,
        totalExpiredStock,
      },
      wasteAvoided: {
        unitsRescued,
        estimatedKgRescued,
        estimatedCo2SavedKg,
        estimatedMealsRescued,
      },
      dailyTrend,
      topProducts,
      inventoryHealth: {
        lowStockBatches: lowStockList.slice(0, 8),
        approachingExpiryBatches: approachingExpiryList.slice(0, 8),
        excessRiskBatches: excessRiskList.slice(0, 8),
      },
      predictiveForecast: {
        hasHistoricalData: pastSalesByProduct.length > 0,
        atRiskBatches: forecastedAtRisk.slice(0, 6),
      },
    });
  } catch (error) {
    console.error("getSellerAnalytics error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
