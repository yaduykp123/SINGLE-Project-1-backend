import express from "express";
import { getLocation, saveLocation, updateLocation } from "../controllers/locationController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.post("/save", protect, saveLocation);
router.get("/me", protect, getLocation);
router.put("/update", protect, updateLocation);

export default router;