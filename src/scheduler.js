const Queue = require("bull");
const cron = require("node-cron");
require("dotenv").config();

const logger = require("./utils/logger");
const { getRedisConfig, getClient } = require("./config/redis");

class TaskScheduler {
  constructor() {
    this.redisClient = null;
    this.queues = {};
    this.scheduledTasks = new Map();
    this.isRunning = false;

    logger.info("Task Scheduler initializing...");
  }

  async start() {
    try {
      // Initialize Redis connection
      this.redisClient = getClient();

      // Initialize queues
      await this.initializeQueues();

      // Start scheduled task processing
      this.startScheduledTaskProcessing();

      // Start cleanup routines
      this.startCleanupRoutines();

      // Setup graceful shutdown
      this.setupGracefulShutdown();

      this.isRunning = true;
      logger.info("Task Scheduler started successfully");
    } catch (error) {
      logger.error("Failed to start Task Scheduler", error);
      process.exit(1);
    }
  }

  async initializeQueues() {
    const redisConfig = getRedisConfig();

    const queueNames = [
      "high-priority",
      "normal-priority",
      "low-priority",
      "scheduled",
      "cleanup",
    ];

    for (const name of queueNames) {
      this.queues[name] = new Queue(name, {
        redis: redisConfig,
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      });
    }
  }

  startScheduledTaskProcessing() {
    // Process scheduled tasks every minute
    cron.schedule("* * * * *", async () => {
      if (!this.isRunning) return;

      try {
        await this.processScheduledTasks();
      } catch (error) {
        logger.error("Error processing scheduled tasks", error);
      }
    });

    // Process recurring tasks
    cron.schedule("0 * * * *", async () => {
      // Every hour
      if (!this.isRunning) return;

      try {
        await this.processRecurringTasks();
      } catch (error) {
        logger.error("Error processing recurring tasks", error);
      }
    });

    logger.info("Scheduled task processing started");
  }

  async processScheduledTasks() {
    const now = Date.now();

    try {
      // Get all scheduled tasks
      const scheduledTasksKey = "scheduled-tasks";
      const tasks = await this.redisClient.zrangebyscore(
        scheduledTasksKey,
        0,
        now,
        "WITHSCORES"
      );

      if (tasks.length === 0) return;

      logger.info(`Processing ${tasks.length / 2} scheduled tasks`);

      // Process tasks in pairs (task data, score)
      for (let i = 0; i < tasks.length; i += 2) {
        const taskData = JSON.parse(tasks[i]);
        const scheduledTime = parseInt(tasks[i + 1]);

        try {
          // Add task to appropriate queue
          const queue = this.getQueueForPriority(taskData.priority || "normal");
          await queue.add(taskData.type, taskData, {
            ...taskData.options,
            jobId: taskData.id,
          });

          // Remove from scheduled tasks
          await this.redisClient.zrem(scheduledTasksKey, tasks[i]);

          logger.info(
            `Scheduled task ${taskData.id} moved to ${queue.name} queue`,
            {
              taskId: taskData.id,
              scheduledTime: new Date(scheduledTime).toISOString(),
              actualTime: new Date(now).toISOString(),
            }
          );
        } catch (error) {
          logger.error(
            `Failed to process scheduled task ${taskData.id}`,
            error
          );
        }
      }
    } catch (error) {
      logger.error("Error in processScheduledTasks", error);
    }
  }

  async processRecurringTasks() {
    try {
      const recurringTasksKey = "recurring-tasks";
      const tasks = await this.redisClient.hgetall(recurringTasksKey);

      for (const [taskId, taskDataStr] of Object.entries(tasks)) {
        const taskData = JSON.parse(taskDataStr);

        if (this.shouldRunRecurringTask(taskData)) {
          // Add to appropriate queue
          const queue = this.getQueueForPriority(taskData.priority || "normal");
          await queue.add(taskData.type, {
            ...taskData,
            id: `${taskId}-${Date.now()}`,
          });

          // Update last run time
          taskData.lastRun = Date.now();
          await this.redisClient.hset(
            recurringTasksKey,
            taskId,
            JSON.stringify(taskData)
          );

          logger.info(`Recurring task ${taskId} scheduled for execution`);
        }
      }
    } catch (error) {
      logger.error("Error processing recurring tasks", error);
    }
  }

  shouldRunRecurringTask(taskData) {
    const now = Date.now();
    const lastRun = taskData.lastRun || 0;
    const interval = taskData.interval; // in milliseconds

    return now - lastRun >= interval;
  }

  getQueueForPriority(priority) {
    switch (priority.toLowerCase()) {
      case "high":
        return this.queues["high-priority"];
      case "low":
        return this.queues["low-priority"];
      default:
        return this.queues["normal-priority"];
    }
  }

  async scheduleTask(taskData, scheduledTime) {
    try {
      const scheduledTasksKey = "scheduled-tasks";

      await this.redisClient.zadd(
        scheduledTasksKey,
        scheduledTime,
        JSON.stringify(taskData)
      );

      logger.info(
        `Task ${taskData.id} scheduled for ${new Date(
          scheduledTime
        ).toISOString()}`
      );
    } catch (error) {
      logger.error("Error scheduling task", error);
      throw error;
    }
  }

  async addRecurringTask(taskId, taskData) {
    try {
      const recurringTasksKey = "recurring-tasks";

      await this.redisClient.hset(
        recurringTasksKey,
        taskId,
        JSON.stringify({
          ...taskData,
          lastRun: 0,
        })
      );

      logger.info(
        `Recurring task ${taskId} added with interval ${taskData.interval}ms`
      );
    } catch (error) {
      logger.error("Error adding recurring task", error);
      throw error;
    }
  }

  startCleanupRoutines() {
    // Clean up completed jobs every 5 minutes
    cron.schedule("*/5 * * * *", async () => {
      if (!this.isRunning) return;

      try {
        await this.cleanupCompletedJobs();
      } catch (error) {
        logger.error("Error in cleanup routine", error);
      }
    });

    // Clean up stale worker health records every hour
    cron.schedule("0 * * * *", async () => {
      if (!this.isRunning) return;

      try {
        await this.cleanupStaleWorkers();
      } catch (error) {
        logger.error("Error cleaning up stale workers", error);
      }
    });

    logger.info("Cleanup routines started");
  }

  async cleanupCompletedJobs() {
    try {
      let totalCleaned = 0;

      for (const [name, queue] of Object.entries(this.queues)) {
        const completed = await queue.getCompleted();
        const failed = await queue.getFailed();

        // Keep only recent completed jobs (last 100)
        if (completed.length > 100) {
          const toRemove = completed.slice(0, completed.length - 100);
          await Promise.all(toRemove.map((job) => job.remove()));
          totalCleaned += toRemove.length;
        }

        // Keep only recent failed jobs (last 50)
        if (failed.length > 50) {
          const toRemove = failed.slice(0, failed.length - 50);
          await Promise.all(toRemove.map((job) => job.remove()));
          totalCleaned += toRemove.length;
        }
      }

      if (totalCleaned > 0) {
        logger.info(`Cleaned up ${totalCleaned} old jobs`);
      }
    } catch (error) {
      logger.error("Error in cleanupCompletedJobs", error);
    }
  }

  async cleanupStaleWorkers() {
    try {
      const pattern = "worker:*:health";
      const keys = await this.redisClient.keys(pattern);
      let cleaned = 0;

      for (const key of keys) {
        const healthData = await this.redisClient.get(key);
        if (healthData) {
          const health = JSON.parse(healthData);
          const age = Date.now() - health.timestamp;

          // Remove workers that haven't reported in 5 minutes
          if (age > 300000) {
            await this.redisClient.del(key);
            cleaned++;
            logger.warn(`Removed stale worker health record: ${key}`);
          }
        }
      }

      if (cleaned > 0) {
        logger.info(`Cleaned up ${cleaned} stale worker records`);
      }
    } catch (error) {
      logger.error("Error in cleanupStaleWorkers", error);
    }
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      logger.info(`${signal} received, shutting down Task Scheduler`);
      this.isRunning = false;

      try {
        // Close all queues
        await Promise.all(
          Object.values(this.queues).map((queue) => queue.close())
        );

        logger.info("Task Scheduler shut down gracefully");
        process.exit(0);
      } catch (error) {
        logger.error("Error during Task Scheduler shutdown", error);
        process.exit(1);
      }
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }
}

// Start scheduler if this file is run directly
if (require.main === module) {
  const scheduler = new TaskScheduler();
  scheduler.start().catch((error) => {
    logger.error("Failed to start Task Scheduler", error);
    process.exit(1);
  });
}

module.exports = TaskScheduler;
