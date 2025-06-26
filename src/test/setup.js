const { connectRedis, disconnectRedis } = require("../config/redis");

// Setup test environment
beforeAll(async () => {
  // Connect to test Redis instance
  process.env.REDIS_URL =
    process.env.REDIS_TEST_URL || "redis://localhost:6379/1";
  await connectRedis();
});

afterAll(async () => {
  // Cleanup after tests
  await disconnectRedis();
});
