import User from "../models/userSchema.js"; // Renamed typo schema file

const buildLocationPayload = (user) => ({
  city: user.city || "",
  state: user.state || "",
  country: user.country || "",
  latitude: user.latitude ?? null,
  longitude: user.longitude ?? null,
});

const applyLocationDataToUser = (user, { city, state, country, latitude, longitude }) => {
  if (city !== undefined) user.city = city;
  if (state !== undefined) user.state = state;
  if (country !== undefined) user.country = country;
  if (latitude !== undefined) user.latitude = latitude;
  if (longitude !== undefined) user.longitude = longitude;

  if (longitude !== undefined && latitude !== undefined) {
    user.location = {
      type: "Point",
      coordinates: [Number(longitude), Number(latitude)],
    };
  }
};

// 1. Save location (Authenticated)
export const saveLocation = async (req, res, next) => {
  try {
    const { city, state, country, latitude, longitude } = req.body;
    const userId = req.user._id; // Retrieved securely from protect middleware

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    applyLocationDataToUser(user, { city, state, country, latitude, longitude });

    await user.save();

    res.status(200).json({
      success: true,
      message: "Location Saved",
      location: buildLocationPayload(user),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// 2. Fetch location for the current logged-in user
export const getLocation = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Location fetched",
      location: buildLocationPayload(user),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// 3. Update location coordinates (Authenticated)
export const updateLocation = async (req, res, next) => {
  try {
    const { city, state, country, latitude, longitude } = req.body;
    const userId = req.user._id;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    applyLocationDataToUser(user, { city, state, country, latitude, longitude });

    await user.save();

    res.status(200).json({
      success: true,
      message: "Location updated",
      location: buildLocationPayload(user),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
