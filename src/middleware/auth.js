// src/middleware/auth.js
const logger = require("../utils/logger");

const authMiddleware = (req, res, next) => {
  // Skip auth in development
  if (process.env.NODE_ENV === "development") {
    req.user = { id: "dev-user", role: "admin" };
    return next();
  }

  const apiKey = req.headers["x-api-key"] || req.headers["authorization"];

  if (!apiKey) {
    return res.status(401).json({
      error: "API key required",
      code: "MISSING_API_KEY",
    });
  }

  // Validate API key (in production, use proper validation)
  const validApiKey = process.env.API_KEY;
  if (apiKey !== validApiKey && apiKey !== `Bearer ${validApiKey}`) {
    logger.warn("Invalid API key attempt", {
      apiKey: apiKey.substring(0, 10) + "...",
    });
    return res.status(401).json({
      error: "Invalid API key",
      code: "INVALID_API_KEY",
    });
  }

  req.user = { id: "api-user", role: "admin" };
  next();
};

module.exports = authMiddleware;

// ================================================
