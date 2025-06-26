const express = require("express");
const Queue = require("bull");
const path = require("path");
require("dotenv").config();

const logger = require("./utils/logger");
const { getRedisConfig, getClient } = require("./config/redis");

class TaskMonitor {
  constructor() {
    this.app = express();
    this.port = process.env.MONITOR_PORT || 3001;
    this.redisClient = null;
    this.queues = {};

    this.setupRoutes();
    logger.info("Task Monitor initializing...");
  }

  async start() {
    try {
      // Initialize Redis connection
      this.redisClient = getClient();

      // Initialize queue connections for monitoring
      await this.initializeQueues();

      // Start the monitoring server
      this.app.listen(this.port, () => {
        logger.info(`Task Monitor running on port ${this.port}`);
      });
    } catch (error) {
      logger.error("Failed to start Task Monitor", error);
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
        settings: {
          stalledInterval: 30 * 1000,
          maxStalledCount: 1,
        },
      });
    }
  }

  setupRoutes() {
    this.app.use(express.json());

    // Dashboard route
    this.app.get("/", (req, res) => {
      res.send(this.getDashboardHTML());
    });

    // System status
    this.app.get("/api/status", async (req, res) => {
      try {
        const status = await this.getSystemStatus();
        res.json(status);
      } catch (error) {
        logger.error("Error getting system status", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Queue statistics
    this.app.get("/api/queues", async (req, res) => {
      try {
        const stats = await this.getQueueStatistics();
        res.json(stats);
      } catch (error) {
        logger.error("Error getting queue statistics", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Worker health
    this.app.get("/api/workers", async (req, res) => {
      try {
        const workers = await this.getWorkerHealth();
        res.json(workers);
      } catch (error) {
        logger.error("Error getting worker health", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Job details
    this.app.get("/api/jobs/:queueName/:jobId", async (req, res) => {
      try {
        const { queueName, jobId } = req.params;
        const job = await this.getJobDetails(queueName, jobId);

        if (!job) {
          return res.status(404).json({ error: "Job not found" });
        }

        res.json(job);
      } catch (error) {
        logger.error("Error getting job details", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Queue management
    this.app.post("/api/queues/:queueName/pause", async (req, res) => {
      try {
        const { queueName } = req.params;
        if (!this.queues[queueName]) {
          return res.status(404).json({ error: "Queue not found" });
        }

        await this.queues[queueName].pause();
        res.json({ message: `Queue ${queueName} paused` });
      } catch (error) {
        logger.error("Error pausing queue", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    this.app.post("/api/queues/:queueName/resume", async (req, res) => {
      try {
        const { queueName } = req.params;
        if (!this.queues[queueName]) {
          return res.status(404).json({ error: "Queue not found" });
        }

        await this.queues[queueName].resume();
        res.json({ message: `Queue ${queueName} resumed` });
      } catch (error) {
        logger.error("Error resuming queue", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Job retry
    this.app.post("/api/jobs/:queueName/:jobId/retry", async (req, res) => {
      try {
        const { queueName, jobId } = req.params;
        const queue = this.queues[queueName];

        if (!queue) {
          return res.status(404).json({ error: "Queue not found" });
        }

        const job = await queue.getJob(jobId);
        if (!job) {
          return res.status(404).json({ error: "Job not found" });
        }

        await job.retry();
        res.json({ message: "Job queued for retry" });
      } catch (error) {
        logger.error("Error retrying job", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Metrics endpoint
    this.app.get("/api/metrics", async (req, res) => {
      try {
        const metrics = await this.getMetrics();
        res.json(metrics);
      } catch (error) {
        logger.error("Error getting metrics", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });
  }

  async getSystemStatus() {
    const status = {
      timestamp: new Date().toISOString(),
      redis: "disconnected",
      queues: {},
      totalJobs: 0,
      activeWorkers: 0,
    };

    try {
      // Check Redis connection
      await this.redisClient.ping();
      status.redis = "connected";
    } catch (error) {
      logger.error("Redis connection check failed", error);
    }

    // Get queue statuses
    for (const [name, queue] of Object.entries(this.queues)) {
      try {
        const [waiting, active, completed, failed, delayed] = await Promise.all(
          [
            queue.getWaiting(),
            queue.getActive(),
            queue.getCompleted(),
            queue.getFailed(),
            queue.getDelayed(),
          ]
        );

        status.queues[name] = {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          delayed: delayed.length,
          isPaused: await queue.isPaused(),
        };

        status.totalJobs +=
          waiting.length +
          active.length +
          completed.length +
          failed.length +
          delayed.length;
      } catch (error) {
        logger.error(`Error getting status for queue ${name}`, error);
        status.queues[name] = { error: "Unable to fetch status" };
      }
    }

    // Get active worker count
    try {
      const workerKeys = await this.redisClient.keys("worker:*:health");
      const now = Date.now();
      let activeCount = 0;

      for (const key of workerKeys) {
        const healthData = await this.redisClient.get(key);
        if (healthData) {
          const health = JSON.parse(healthData);
          if (now - health.timestamp < 120000) {
            // Active if reported within 2 minutes
            activeCount++;
          }
        }
      }

      status.activeWorkers = activeCount;
    } catch (error) {
      logger.error("Error getting worker count", error);
    }

    return status;
  }

  async getQueueStatistics() {
    const stats = {};

    for (const [name, queue] of Object.entries(this.queues)) {
      try {
        const [waiting, active, completed, failed, delayed] = await Promise.all(
          [
            queue.getWaiting(),
            queue.getActive(),
            queue.getCompleted(),
            queue.getFailed(),
            queue.getDelayed(),
          ]
        );

        // Calculate processing rates
        const completedJobs = completed.slice(-100); // Last 100 completed jobs
        const now = Date.now();
        const oneHourAgo = now - 60 * 60 * 1000;

        const recentCompleted = completedJobs.filter(
          (job) => job.finishedOn && job.finishedOn > oneHourAgo
        );

        stats[name] = {
          counts: {
            waiting: waiting.length,
            active: active.length,
            completed: completed.length,
            failed: failed.length,
            delayed: delayed.length,
          },
          rates: {
            completedLastHour: recentCompleted.length,
            averageProcessingTime:
              this.calculateAverageProcessingTime(recentCompleted),
          },
          health: {
            isPaused: await queue.isPaused(),
            stalledJobCount: 0, // You might want to implement stalled job detection
          },
        };
      } catch (error) {
        logger.error(`Error getting statistics for queue ${name}`, error);
        stats[name] = { error: "Unable to fetch statistics" };
      }
    }

    return stats;
  }

  calculateAverageProcessingTime(jobs) {
    if (jobs.length === 0) return 0;

    const totalTime = jobs.reduce((sum, job) => {
      if (job.processedOn && job.finishedOn) {
        return sum + (job.finishedOn - job.processedOn);
      }
      return sum;
    }, 0);

    return Math.round(totalTime / jobs.length);
  }

  async getWorkerHealth() {
    const workers = {};

    try {
      const workerKeys = await this.redisClient.keys("worker:*:health");

      for (const key of workerKeys) {
        const healthData = await this.redisClient.get(key);
        if (healthData) {
          const health = JSON.parse(healthData);
          const workerId = key.replace("worker:", "").replace(":health", "");

          workers[workerId] = {
            ...health,
            isActive: Date.now() - health.timestamp < 120000,
            lastSeen: new Date(health.timestamp).toISOString(),
          };
        }
      }
    } catch (error) {
      logger.error("Error getting worker health", error);
    }

    return workers;
  }

  async getJobDetails(queueName, jobId) {
    const queue = this.queues[queueName];
    if (!queue) return null;

    try {
      const job = await queue.getJob(jobId);
      if (!job) return null;

      return {
        id: job.id,
        name: job.name,
        data: job.data,
        opts: job.opts,
        progress: job.progress(),
        delay: job.delay,
        timestamp: job.timestamp,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason,
        stacktrace: job.stacktrace,
        returnvalue: job.returnvalue,
        finishedOn: job.finishedOn,
        processedOn: job.processedOn,
      };
    } catch (error) {
      logger.error("Error getting job details", error);
      return null;
    }
  }

  async getMetrics() {
    const metrics = {
      timestamp: Date.now(),
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
      },
      queues: {},
      workers: await this.getWorkerHealth(),
    };

    // Get detailed queue metrics
    for (const [name, queue] of Object.entries(this.queues)) {
      try {
        const stats = await queue.getJobCounts();
        metrics.queues[name] = stats;
      } catch (error) {
        logger.error(`Error getting metrics for queue ${name}`, error);
      }
    }

    return metrics;
  }

  getDashboardHTML() {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Task Scheduler Monitor</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; }
            .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
            .header { background: #2c3e50; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
            .card { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .card h3 { color: #2c3e50; margin-bottom: 15px; }
            .status { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
            .status.connected { background: #27ae60; color: white; }
            .status.disconnected { background: #e74c3c; color: white; }
            .status.active { background: #3498db; color: white; }
            .status.paused { background: #f39c12; color: white; }
            .metric { display: flex; justify-content: space-between; margin: 10px 0; }
            .metric strong { color: #2c3e50; }
            .refresh-btn { background: #3498db; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }
            .refresh-btn:hover { background: #2980b9; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            th, td { padding: 10px; text-align: left; border-bottom: 1px solid #eee; }
            th { background: #f8f9fa; font-weight: 600; }
            .loading { text-align: center; padding: 20px; color: #7f8c8d; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🚀 Distributed Task Scheduler Monitor</h1>
                <p>Real-time monitoring dashboard for job queues and workers</p>
                <button class="refresh-btn" onclick="loadData()">🔄 Refresh</button>
            </div>
            
            <div class="grid">
                <div class="card">
                    <h3>📊 System Status</h3>
                    <div id="system-status" class="loading">Loading...</div>
                </div>
                
                <div class="card">
                    <h3>📋 Queue Statistics</h3>
                    <div id="queue-stats" class="loading">Loading...</div>
                </div>
                
                <div class="card">
                    <h3>👥 Active Workers</h3>
                    <div id="worker-health" class="loading">Loading...</div>
                </div>
                
                <div class="card">
                    <h3>📈 Performance Metrics</h3>
                    <div id="metrics" class="loading">Loading...</div>
                </div>
            </div>
        </div>

        <script>
            async function loadData() {
                try {
                    const [status, queueStats, workers, metrics] = await Promise.all([
                        fetch('/api/status').then(r => r.json()),
                        fetch('/api/queues').then(r => r.json()),
                        fetch('/api/workers').then(r => r.json()),
                        fetch('/api/metrics').then(r => r.json())
                    ]);

                    updateSystemStatus(status);
                    updateQueueStats(queueStats);
                    updateWorkerHealth(workers);
                    updateMetrics(metrics);
                } catch (error) {
                    console.error('Error loading data:', error);
                }
            }

            function updateSystemStatus(status) {
                const html = \`
                    <div class="metric">
                        <span>Redis Connection:</span>
                        <span class="status \${status.redis}">\${status.redis}</span>
                    </div>
                    <div class="metric">
                        <span>Total Jobs:</span>
                        <strong>\${status.totalJobs.toLocaleString()}</strong>
                    </div>
                    <div class="metric">
                        <span>Active Workers:</span>
                        <strong>\${status.activeWorkers}</strong>
                    </div>
                    <div class="metric">
                        <span>Last Updated:</span>
                        <strong>\${new Date(status.timestamp).toLocaleTimeString()}</strong>
                    </div>
                \`;
                document.getElementById('system-status').innerHTML = html;
            }

            function updateQueueStats(stats) {
                let html = '<table><tr><th>Queue</th><th>Waiting</th><th>Active</th><th>Completed</th><th>Failed</th><th>Status</th></tr>';
                
                for (const [name, data] of Object.entries(stats)) {
                    if (data.error) {
                        html += \`<tr><td>\${name}</td><td colspan="5" style="color: #e74c3c;">Error: \${data.error}</td></tr>\`;
                    } else {
                        const status = data.health?.isPaused ? 'paused' : 'active';
                        html += \`
                            <tr>
                                <td><strong>\${name}</strong></td>
                                <td>\${data.counts.waiting}</td>
                                <td>\${data.counts.active}</td>
                                <td>\${data.counts.completed}</td>
                                <td>\${data.counts.failed}</td>
                                <td><span class="status \${status}">\${status}</span></td>
                            </tr>
                        \`;
                    }
                }
                
                html += '</table>';
                document.getElementById('queue-stats').innerHTML = html;
            }

            function updateWorkerHealth(workers) {
                if (Object.keys(workers).length === 0) {
                    document.getElementById('worker-health').innerHTML = '<p>No workers currently active</p>';
                    return;
                }

                let html = '<table><tr><th>Worker ID</th><th>Status</th><th>Last Seen</th></tr>';
                
                for (const [id, worker] of Object.entries(workers)) {
                    const status = worker.isActive ? 'active' : 'disconnected';
                    html += \`
                        <tr>
                            <td><strong>\${id}</strong></td>
                            <td><span class="status \${status}">\${status}</span></td>
                            <td>\${new Date(worker.lastSeen).toLocaleTimeString()}</td>
                        </tr>
                    \`;
                }
                
                html += '</table>';
                document.getElementById('worker-health').innerHTML = html;
            }

            function updateMetrics(metrics) {
                const uptime = Math.floor(metrics.system.uptime / 3600);
                const memory = Math.round(metrics.system.memory.rss / 1024 / 1024);
                
                const html = \`
                    <div class="metric">
                        <span>System Uptime:</span>
                        <strong>\${uptime}h</strong>
                    </div>
                    <div class="metric">
                        <span>Memory Usage:</span>
                        <strong>\${memory} MB</strong>
                    </div>
                    <div class="metric">
                        <span>Active Workers:</span>
                        <strong>\${Object.keys(metrics.workers).length}</strong>
                    </div>
                \`;
                document.getElementById('metrics').innerHTML = html;
            }

            // Auto-refresh every 30 seconds
            setInterval(loadData, 30000);
            
            // Initial load
            loadData();
        </script>
    </body>
    </html>
    `;
  }
}

// Start monitor if this file is run directly
if (require.main === module) {
  const monitor = new TaskMonitor();
  monitor.start().catch((error) => {
    logger.error("Failed to start Task Monitor", error);
    process.exit(1);
  });
}

module.exports = TaskMonitor;
