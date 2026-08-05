import express from "express";
import { updateLocation, getProfile } from "../controllers/userController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.put("/location", protect, updateLocation);
router.get("/profile", protect, getProfile);

export default router;