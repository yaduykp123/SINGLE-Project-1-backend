import User from "../models/userSchema.js";

//    Update user location
//   PUT /api/users/location
export const updateLocation = async (req, res) => {
  try {
    const { city, state, country, latitude, longitude } = req.body;

    const latNum = Number(latitude);
    const lngNum = Number(longitude);
    const validCoords =
      latitude !== null &&
      latitude !== undefined &&
      longitude !== null &&
      longitude !== undefined &&
      !isNaN(latNum) &&
      !isNaN(lngNum);

    const updateFields = {};
    if (city !== undefined) updateFields.city = city;
    if (state !== undefined) updateFields.state = state;
    if (country !== undefined) updateFields.country = country;
    if (latitude !== undefined) updateFields.latitude = latitude;
    if (longitude !== undefined) updateFields.longitude = longitude;

    if (validCoords) {
      updateFields.location = {
        type: "Point",
        coordinates: [lngNum, latNum],
      };
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updateFields,
      { new: true }
    ).select("-password -otp");

    res.status(200).json({ message: "Location updated", user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//     Get user profile
//   GET /api/users/profile
export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password -otp");
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};