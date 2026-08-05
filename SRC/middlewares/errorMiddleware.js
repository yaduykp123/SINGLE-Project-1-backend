// Global Error Handling Middleware
// Must have exactly 4 parameters: (err, req, res, next)
const errorMiddleware = (err, req, res, next) => {

  // Log error details to server console
  console.error(`[ERROR] =>  ${req.method} ${req.originalUrl} →`, err.message);

  // Determine status code
  const statusCode = err.statusCode || err.status || 500;

  // Mongoose validation error
  if (err.name === "ValidationError") {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({
      success: false,
      message: "Validation Error",
      errors: messages
    });
  }

  // Mongoose duplicate key error (e.g. unique email)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || "Field";
    const fieldName = field.charAt(0).toUpperCase() + field.slice(1);

    return res.status(400).json({
      success: false,
      message:
        field === "firebaseUid"
          ? "Old database index found for firebaseUid. Restart the server once to remove it, then try again."
          : `${fieldName} already exists`
    });
  }

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({
      success: false,
      message: "Invalid token"
    });
  }

  if (err.name === "TokenExpiredError") {
    return res.status(401).json({
      success: false,
      message: "Token expired. Please login again."
    });
  }

  // Default server error
  return res.status(statusCode).json({
    success: false,
    message: err.message || "Internal Server Error"
  });

};

export default errorMiddleware;
