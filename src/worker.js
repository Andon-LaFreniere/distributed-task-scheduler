const Queue = require("bull");
require("dotenv").config();

const logger = require("./utils/logger");
const { getRedisConfig } = require("./config/redis");
const JobProcessor = require("./services/JobProcessor");

const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY) || 5;

class Worker {
  constructor() {
    this.workerId = WORKER_ID;
    this.queues = {};
    this.processor = new JobProcessor();
    this.isShuttingDown = false;

    logger.info(`Worker ${this.workerId} initializing...`);
  }

  async start() {
    try {
      // Initialize queues
      await this.initializeQueues();

      // Start health reporting
      this.startHealthReporting();

      // Setup graceful shutdown
      this.setupGracefulShutdown();

      logger.info(`Worker ${this.workerId} started successfully`, {
        concurrency: CONCURRENCY,
        queues: Object.keys(this.queues),
      });
    } catch (error) {
      logger.error(`Failed to start worker ${this.workerId}`, error);
      process.exit(1);
    }
  }

  async initializeQueues() {
    const redisConfig = getRedisConfig();

    // Define queue types and their configurations
    const queueConfigs = [
      { name: "high-priority", concurrency: Math.ceil(CONCURRENCY * 0.5) },
      { name: "normal-priority", concurrency: Math.ceil(CONCURRENCY * 0.3) },
      { name: "low-priority", concurrency: Math.ceil(CONCURRENCY * 0.2) },
      { name: "scheduled", concurrency: 2 },
      { name: "cleanup", concurrency: 1 },
    ];

    for (const config of queueConfigs) {
      const queue = new Queue(config.name, {
        redis: redisConfig,
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 2000,
          },
        },
      });

      // Setup job processing
      queue.process(config.concurrency, async (job) => {
        return await this.processJob(job, config.name);
      });

      // Setup event listeners
      this.setupQueueEventListeners(queue, config.name);

      this.queues[config.name] = queue;
    }
  }

  async processJob(job, queueName) {
    const startTime = Date.now();
    const { id, data } = job;

    logger.info(`Processing job ${id} from ${queueName}`, {
      workerId: this.workerId,
      jobId: id,
      jobType: data.type,
      queue: queueName,
    });

    try {
      // Update job progress
      await job.progress(10);

      // Process the job based on its type
      const result = await this.processor.process(data, job);

      // Update final progress
      await job.progress(100);

      const duration = Date.now() - startTime;
      logger.info(`Job ${id} completed successfully`, {
        workerId: this.workerId,
        jobId: id,
        duration,
        queue: queueName,
      });

      return result;
    } catch (error) {
      logger.error(`Job ${id} failed`, {
        workerId: this.workerId,
        jobId: id,
        error: error.message,
        queue: queueName,
      });
      throw error;
    }
  }

  setupQueueEventListeners(queue, queueName) {
    queue.on("completed", (job, result) => {
      logger.info(`Job completed in ${queueName}`, {
        jobId: job.id,
        workerId: this.workerId,
        result: typeof result === "object" ? JSON.stringify(result) : result,
      });
    });

    queue.on("failed", (job, err) => {
      logger.error(`Job failed in ${queueName}`, {
        jobId: job.id,
        workerId: this.workerId,
        error: err.message,
        attempts: job.attemptsMade,
      });
    });

    queue.on("stalled", (job) => {
      logger.warn(`Job stalled in ${queueName}`, {
        jobId: job.id,
        workerId: this.workerId,
      });
    });

    queue.on("error", (error) => {
      logger.error(`Queue error in ${queueName}`, {
        workerId: this.workerId,
        error: error.message,
      });
    });
  }

  startHealthReporting() {
    setInterval(async () => {
      if (this.isShuttingDown) return;

      try {
        const health = await this.getHealthStatus();

        // Report health to Redis
        const redis = require("./config/redis").getClient();
        await redis.setex(
          `worker:${this.workerId}:health`,
          60,
          JSON.stringify(health)
        );
      } catch (error) {
        logger.error("Failed to report health", error);
      }
    }, 30000); // Report every 30 seconds
  }

  async getHealthStatus() {
    const health = {
      workerId: this.workerId,
      timestamp: Date.now(),
      status: "healthy",
      queues: {},
    };

    for (const [name, queue] of Object.entries(this.queues)) {
      const waiting = await queue.getWaiting();
      const active = await queue.getActive();
      const completed = await queue.getCompleted();
      const failed = await queue.getFailed();

      health.queues[name] = {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
      };
    }

    return health;
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      logger.info(`${signal} received, shutting down worker ${this.workerId}`);
      this.isShuttingDown = true;

      try {
        // Close all queues
        await Promise.all(
          Object.values(this.queues).map((queue) => queue.close())
        );

        logger.info(`Worker ${this.workerId} shut down gracefully`);
        process.exit(0);
      } catch (error) {
        logger.error(`Error during shutdown of worker ${this.workerId}`, error);
        process.exit(1);
      }
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }
}

// Start worker if this file is run directly
if (require.main === module) {
  const worker = new Worker();
  worker.start().catch((error) => {
    logger.error("Failed to start worker", error);
    process.exit(1);
  });
}

module.exports = Worker;
