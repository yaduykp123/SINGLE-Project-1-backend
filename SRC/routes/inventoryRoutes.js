import express from "express";
import {
  getInventorySummary,
  getBatches,
  addBatch,
  adjustStock,
  getInventoryTransactions,
  getDiscountSuggestions,
  approveDiscount,
  triggerExpiryCheck,
  lookupBarcode,
  deleteBatch,
  clearExpiredBatches,
} from "../controllers/inventoryController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/summary", protect, getInventorySummary);
router.get("/batches", protect, getBatches);
router.post("/batches", protect, addBatch);
router.put("/batches/:batchId/adjust", protect, adjustStock);
router.delete("/batches/expired/clear", protect, clearExpiredBatches);
router.delete("/batches/:batchId", protect, deleteBatch);
router.get("/transactions", protect, getInventoryTransactions);
router.get("/discount-suggestions", protect, getDiscountSuggestions);
router.post("/apply-discount", protect, approveDiscount);
router.post("/run-expiry-check", protect, triggerExpiryCheck);
router.get("/barcode/:barcode", protect, lookupBarcode);

export default router;
