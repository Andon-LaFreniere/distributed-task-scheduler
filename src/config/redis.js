const redis = require("redis");
const logger = require("../utils/logger");

let redisClient = null;

const getRedisConfig = () => {
  const config = {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT) || 6379,
    retryDelayOnFailover: 100,
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
    lazyConnect: true,
  };

  if (process.env.REDIS_PASSWORD) {
    config.password = process.env.REDIS_PASSWORD;
  }

  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }

  return config;
};

const connectRedis = async () => {
  try {
    const config = getRedisConfig();

    redisClient = redis.createClient(
      typeof config === "string" ? { url: config } : config
    );

    redisClient.on("error", (err) => {
      logger.error("Redis Client Error", err);
    });

    redisClient.on("connect", () => {
      logger.info("Redis client connected");
    });

    redisClient.on("ready", () => {
      logger.info("Redis client ready");
    });

    redisClient.on("end", () => {
      logger.warn("Redis client connection ended");
    });

    redisClient.on("reconnecting", (delay, attempt) => {
      logger.info(
        `Redis client reconnecting (attempt ${attempt}, delay ${delay}ms)`
      );
    });

    await redisClient.connect();

    // Test connection
    await redisClient.ping();
    logger.info("Redis connection established successfully");

    return redisClient;
  } catch (error) {
    logger.error("Failed to connect to Redis", error);
    throw error;
  }
};

const getClient = () => {
  if (!redisClient || !redisClient.isOpen) {
    throw new Error("Redis client not connected. Call connectRedis() first.");
  }
  return redisClient;
};

const disconnectRedis = async () => {
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
    logger.info("Redis connection closed");
  }
};

module.exports = {
  connectRedis,
  getClient,
  disconnectRedis,
  getRedisConfig,
};
