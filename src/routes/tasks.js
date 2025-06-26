const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Queue = require("bull");

const logger = require("../utils/logger");
const { getRedisConfig } = require("../config/redis");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

// Initialize queues
const queues = {};
const queueNames = [
  "high-priority",
  "normal-priority",
  "low-priority",
  "scheduled",
];

// Initialize queues on startup
const initializeQueues = () => {
  const redisConfig = getRedisConfig();

  queueNames.forEach((name) => {
    queues[name] = new Queue(name, {
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
  });
};

// Initialize queues
initializeQueues();

// Middleware
router.use(authMiddleware);

// Validation middleware
const validateTaskData = (req, res, next) => {
  const { type, payload } = req.body;

  if (!type) {
    return res.status(400).json({
      error: "Task type is required",
      code: "MISSING_TYPE",
    });
  }

  if (!payload) {
    return res.status(400).json({
      error: "Task payload is required",
      code: "MISSING_PAYLOAD",
    });
  }

  next();
};

// Helper function to get queue by priority
const getQueueByPriority = (priority) => {
  switch (priority?.toLowerCase()) {
    case "high":
      return queues["high-priority"];
    case "low":
      return queues["low-priority"];
    default:
      return queues["normal-priority"];
  }
};

// Create a new task
router.post("/", validateTaskData, async (req, res) => {
  try {
    const {
      type,
      payload,
      priority = "normal",
      delay = 0,
      repeat,
      options = {},
    } = req.body;

    const taskId = uuidv4();
    const queue = getQueueByPriority(priority);

    const jobOptions = {
      jobId: taskId,
      delay,
      repeat,
      ...options,
    };

    const taskData = {
      id: taskId,
      type,
      payload,
      priority,
      createdAt: new Date().toISOString(),
      createdBy: req.user?.id || "system",
    };

    const job = await queue.add(type, taskData, jobOptions);

    logger.info(`Task ${taskId} created`, {
      taskId,
      type,
      priority,
      queue: queue.name,
      delay,
      repeat: !!repeat,
    });

    res.status(201).json({
      success: true,
      task: {
        id: taskId,
        jobId: job.id,
        type,
        priority,
        status: "queued",
        queue: queue.name,
        createdAt: taskData.createdAt,
        delay,
        repeat,
      },
    });
  } catch (error) {
    logger.error("Error creating task", error);
    res.status(500).json({
      error: "Failed to create task",
      message: error.message,
    });
  }
});

// Get task status
router.get("/:taskId", async (req, res) => {
  try {
    const { taskId } = req.params;
    let job = null;
    let queueName = null;

    // Search across all queues for the job
    for (const [name, queue] of Object.entries(queues)) {
      try {
        job = await queue.getJob(taskId);
        if (job) {
          queueName = name;
          break;
        }
      } catch (error) {
        // Continue searching in other queues
      }
    }

    if (!job) {
      return res.status(404).json({
        error: "Task not found",
        taskId,
      });
    }

    const taskStatus = await job.getState();
    const progress = job.progress();

    const response = {
      id: taskId,
      jobId: job.id,
      type: job.name,
      status: taskStatus,
      progress,
      queue: queueName,
      data: job.data,
      createdAt: new Date(job.timestamp).toISOString(),
      processedAt: job.processedOn
        ? new Date(job.processedOn).toISOString()
        : null,
      finishedAt: job.finishedOn
        ? new Date(job.finishedOn).toISOString()
        : null,
      attempts: job.attemptsMade,
      failedReason: job.failedReason,
      result: job.returnvalue,
    };

    res.json({
      success: true,
      task: response,
    });
  } catch (error) {
    logger.error("Error getting task status", error);
    res.status(500).json({
      error: "Failed to get task status",
      message: error.message,
    });
  }
});

// Cancel a task
router.delete("/:taskId", async (req, res) => {
  try {
    const { taskId } = req.params;
    let job = null;
    let queueName = null;

    // Search across all queues for the job
    for (const [name, queue] of Object.entries(queues)) {
      try {
        job = await queue.getJob(taskId);
        if (job) {
          queueName = name;
          break;
        }
      } catch (error) {
        // Continue searching in other queues
      }
    }

    if (!job) {
      return res.status(404).json({
        error: "Task not found",
        taskId,
      });
    }

    const state = await job.getState();

    if (state === "completed" || state === "failed") {
      return res.status(400).json({
        error: "Cannot cancel a completed or failed task",
        taskId,
        state,
      });
    }

    await job.remove();

    logger.info(`Task ${taskId} cancelled`, {
      taskId,
      queue: queueName,
      state,
    });

    res.json({
      success: true,
      message: "Task cancelled successfully",
      taskId,
    });
  } catch (error) {
    logger.error("Error cancelling task", error);
    res.status(500).json({
      error: "Failed to cancel task",
      message: error.message,
    });
  }
});

// Retry a failed task
router.post("/:taskId/retry", async (req, res) => {
  try {
    const { taskId } = req.params;
    let job = null;
    let queueName = null;

    // Search across all queues for the job
    for (const [name, queue] of Object.entries(queues)) {
      try {
        job = await queue.getJob(taskId);
        if (job) {
          queueName = name;
          break;
        }
      } catch (error) {
        // Continue searching in other queues
      }
    }

    if (!job) {
      return res.status(404).json({
        error: "Task not found",
        taskId,
      });
    }

    const state = await job.getState();

    if (state !== "failed") {
      return res.status(400).json({
        error: "Only failed tasks can be retried",
        taskId,
        state,
      });
    }

    await job.retry();

    logger.info(`Task ${taskId} queued for retry`, {
      taskId,
      queue: queueName,
    });

    res.json({
      success: true,
      message: "Task queued for retry",
      taskId,
    });
  } catch (error) {
    logger.error("Error retrying task", error);
    res.status(500).json({
      error: "Failed to retry task",
      message: error.message,
    });
  }
});

// List tasks with filtering and pagination
router.get("/", async (req, res) => {
  try {
    const { queue, status, type, limit = 50, offset = 0 } = req.query;

    const tasks = [];
    const queuesToSearch = queue ? [queue] : Object.keys(queues);

    for (const queueName of queuesToSearch) {
      if (!queues[queueName]) continue;

      const queueInstance = queues[queueName];
      let jobs = [];

      // Get jobs based on status filter
      if (status) {
        switch (status) {
          case "waiting":
            jobs = await queueInstance.getWaiting();
            break;
          case "active":
            jobs = await queueInstance.getActive();
            break;
          case "completed":
            jobs = await queueInstance.getCompleted();
            break;
          case "failed":
            jobs = await queueInstance.getFailed();
            break;
          case "delayed":
            jobs = await queueInstance.getDelayed();
            break;
          default:
            jobs = [
              ...(await queueInstance.getWaiting()),
              ...(await queueInstance.getActive()),
              ...(await queueInstance.getCompleted()),
              ...(await queueInstance.getFailed()),
              ...(await queueInstance.getDelayed()),
            ];
        }
      } else {
        jobs = [
          ...(await queueInstance.getWaiting()),
          ...(await queueInstance.getActive()),
          ...(await queueInstance.getCompleted()),
          ...(await queueInstance.getFailed()),
          ...(await queueInstance.getDelayed()),
        ];
      }

      // Filter by type if specified
      if (type) {
        jobs = jobs.filter((job) => job.name === type);
      }

      // Convert jobs to task format
      for (const job of jobs) {
        const jobState = await job.getState();
        tasks.push({
          id: job.data?.id || job.id,
          jobId: job.id,
          type: job.name,
          status: jobState,
          progress: job.progress(),
          queue: queueName,
          createdAt: new Date(job.timestamp).toISOString(),
          processedAt: job.processedOn
            ? new Date(job.processedOn).toISOString()
            : null,
          finishedAt: job.finishedOn
            ? new Date(job.finishedOn).toISOString()
            : null,
          attempts: job.attemptsMade,
          failedReason: job.failedReason
            ? job.failedReason.substring(0, 200)
            : null,
        });
      }
    }

    // Sort by creation time (newest first)
    tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Apply pagination
    const paginatedTasks = tasks.slice(
      parseInt(offset),
      parseInt(offset) + parseInt(limit)
    );

    res.json({
      success: true,
      tasks: paginatedTasks,
      pagination: {
        total: tasks.length,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: tasks.length > parseInt(offset) + parseInt(limit),
      },
      filters: {
        queue,
        status,
        type,
      },
    });
  } catch (error) {
    logger.error("Error listing tasks", error);
    res.status(500).json({
      error: "Failed to list tasks",
      message: error.message,
    });
  }
});

// Bulk task operations
router.post("/bulk", async (req, res) => {
  try {
    const { tasks } = req.body;

    if (!Array.isArray(tasks)) {
      return res.status(400).json({
        error: "Tasks must be an array",
        code: "INVALID_TASKS_FORMAT",
      });
    }

    if (tasks.length > 100) {
      return res.status(400).json({
        error: "Maximum 100 tasks allowed per bulk request",
        code: "TOO_MANY_TASKS",
      });
    }

    const results = [];

    for (const taskData of tasks) {
      try {
        const {
          type,
          payload,
          priority = "normal",
          delay = 0,
          options = {},
        } = taskData;

        if (!type || !payload) {
          results.push({
            success: false,
            error: "Missing type or payload",
            taskData,
          });
          continue;
        }

        const taskId = uuidv4();
        const queue = getQueueByPriority(priority);

        const jobOptions = {
          jobId: taskId,
          delay,
          ...options,
        };

        const task = {
          id: taskId,
          type,
          payload,
          priority,
          createdAt: new Date().toISOString(),
          createdBy: req.user?.id || "system",
        };

        const job = await queue.add(type, task, jobOptions);

        results.push({
          success: true,
          task: {
            id: taskId,
            jobId: job.id,
            type,
            priority,
            queue: queue.name,
          },
        });
      } catch (error) {
        results.push({
          success: false,
          error: error.message,
          taskData,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;

    logger.info(`Bulk task creation completed`, {
      total: tasks.length,
      successful: successCount,
      failed: failureCount,
    });

    res.status(201).json({
      success: true,
      results,
      summary: {
        total: tasks.length,
        successful: successCount,
        failed: failureCount,
      },
    });
  } catch (error) {
    logger.error("Error in bulk task creation", error);
    res.status(500).json({
      error: "Failed to create bulk tasks",
      message: error.message,
    });
  }
});

module.exports = router;
