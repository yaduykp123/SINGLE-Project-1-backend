import Product from "../models/productSchema.js";
import User from "../models/userSchema.js";
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
    if (!image) {
      image = "https://via.placeholder.com/300?text=No+Image";
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
      image,
      expiryDate: new Date(new Date(expiryDate).setUTCHours(23, 59, 59, 999)),
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

    res.status(201).json(product);
  } catch (error) {
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

//     Get products near user location
//    GET /api/products
export const getProducts = async (req, res) => {
  try {

 //  Auto-deactivate expired products before fetching (run in background)
    deactivateExpiredProducts();

    const { longitude, latitude, maxDistance = 10000, category } = req.query;

    let query = { 
      isActive: true,
     //  NEW: Only show products that haven't expired yet
      expiryDate: { $gt: new Date() } 
     };

    // If coordinates provided, filter by location
    if (longitude && latitude) {
      query.location = {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(longitude), parseFloat(latitude)],
          },
          $maxDistance: parseInt(maxDistance), // in meters (default 10km)
        },
      };
    }

    if (category && category !== "All") {
      query.category = category;
    }

    let productsQuery = Product.find(query).populate("owner", "fullName accountType city");

    // Only sort by createdAt if location-based sorting ($near) is not active
    if (!query.location) {
      productsQuery = productsQuery.sort({ createdAt: -1 });
    }

    const products = await productsQuery;

    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//    Get single product
//   GET /api/products/:id
export const getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate(
      "owner",
      "fullName phone email city",
    );
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.status(200).json(product);
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
      updates.expiryDate = new Date(new Date(updates.expiryDate).setUTCHours(23, 59, 59, 999));
    }

    if (req.file) {
      // Delete old image from cloudinary
      if (product.image) {
        const publicId = product.image.split("/").pop().split(".")[0];
        await cloudinary.uploader.destroy(`expireoff_products/${publicId}`);
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

    // Delete image from cloudinary in background (non-blocking)
    if (product.image) {
      const publicId = product.image.split("/").pop().split(".")[0];
      cloudinary.uploader.destroy(`expireoff_products/${publicId}`).catch((err) =>
        console.error("Cloudinary image deletion error on product delete:", err.message)
      );
    }

    await Product.deleteOne({ _id: req.params.id });
    res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
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
