import mongoose from "mongoose";
import User from "../models/userSchema.js";

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MDB_URL);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    await User.syncIndexes();
    console.log("Database indexes synchronized.");
  } catch (error) {
    console.error(`MongoDB Connection error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;