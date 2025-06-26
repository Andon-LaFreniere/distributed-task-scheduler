const logger = require("../utils/logger");
const EmailService = require("./EmailService");
const DataProcessor = require("./DataProcessor");
const FileService = require("./FileService");

class JobProcessor {
  constructor() {
    this.emailService = new EmailService();
    this.dataProcessor = new DataProcessor();
    this.fileService = new FileService();

    // Register job types
    this.jobTypes = {
      "send-email": this.processSendEmail.bind(this),
      "process-data": this.processData.bind(this),
      "generate-report": this.processGenerateReport.bind(this),
      "cleanup-files": this.processCleanupFiles.bind(this),
      "backup-data": this.processBackupData.bind(this),
      "sync-database": this.processSyncDatabase.bind(this),
      "image-processing": this.processImageProcessing.bind(this),
      "webhook-notification": this.processWebhookNotification.bind(this),
      "scheduled-task": this.processScheduledTask.bind(this),
      "batch-operation": this.processBatchOperation.bind(this),
    };
  }

  async process(jobData, job) {
    const { type, payload } = jobData;

    if (!this.jobTypes[type]) {
      throw new Error(`Unknown job type: ${type}`);
    }

    const startTime = Date.now();

    try {
      logger.info(`Processing job ${job.id} of type ${type}`, {
        jobId: job.id,
        type,
        payload: this.sanitizePayload(payload),
      });

      const result = await this.jobTypes[type](payload, job);

      const duration = Date.now() - startTime;
      logger.info(`Job ${job.id} completed successfully`, {
        jobId: job.id,
        type,
        duration,
        result: typeof result === "object" ? JSON.stringify(result) : result,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Job ${job.id} failed`, {
        jobId: job.id,
        type,
        duration,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  sanitizePayload(payload) {
    // Remove sensitive data from logs
    const sanitized = { ...payload };
    const sensitiveFields = ["password", "token", "apiKey", "secret"];

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = "[REDACTED]";
      }
    }

    return sanitized;
  }

  async processSendEmail(payload, job) {
    const { to, subject, body, attachments } = payload;

    await job.progress(20);

    // Validate email parameters
    if (!to || !subject || !body) {
      throw new Error("Missing required email parameters");
    }

    await job.progress(40);

    // Send email
    const result = await this.emailService.sendEmail({
      to,
      subject,
      body,
      attachments,
    });

    await job.progress(80);

    return {
      success: true,
      messageId: result.messageId,
      sentAt: new Date().toISOString(),
    };
  }

  async processData(payload, job) {
    const { data, operation, options } = payload;

    await job.progress(10);

    if (!data || !operation) {
      throw new Error("Missing required data processing parameters");
    }

    await job.progress(30);

    const result = await this.dataProcessor.process(data, operation, options);

    await job.progress(90);

    return {
      success: true,
      operation,
      recordsProcessed: result.recordsProcessed,
      output: result.output,
      processedAt: new Date().toISOString(),
    };
  }

  async processGenerateReport(payload, job) {
    const { reportType, parameters, format } = payload;

    await job.progress(5);

    if (!reportType) {
      throw new Error("Report type is required");
    }

    await job.progress(20);

    // Generate report data
    const reportData = await this.generateReportData(reportType, parameters);

    await job.progress(60);

    // Format report
    const formattedReport = await this.formatReport(
      reportData,
      format || "json"
    );

    await job.progress(80);

    // Save report
    const reportId = `report_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const filePath = await this.fileService.saveReport(
      reportId,
      formattedReport
    );

    return {
      success: true,
      reportId,
      filePath,
      format,
      generatedAt: new Date().toISOString(),
    };
  }

  async processCleanupFiles(payload, job) {
    const { directory, pattern, maxAge } = payload;

    await job.progress(10);

    const result = await this.fileService.cleanupFiles({
      directory,
      pattern,
      maxAge,
    });

    await job.progress(90);

    return {
      success: true,
      filesDeleted: result.deletedFiles,
      spaceSaved: result.spaceSaved,
      cleanedAt: new Date().toISOString(),
    };
  }

  async processBackupData(payload, job) {
    const { source, destination, compression } = payload;

    await job.progress(5);

    if (!source || !destination) {
      throw new Error("Source and destination are required for backup");
    }

    const backupResult = await this.fileService.createBackup({
      source,
      destination,
      compression: compression || "gzip",
    });

    await job.progress(95);

    return {
      success: true,
      backupPath: backupResult.path,
      size: backupResult.size,
      compression,
      backedUpAt: new Date().toISOString(),
    };
  }

  async processSyncDatabase(payload, job) {
    const { sourceDb, targetDb, tables, mode } = payload;

    await job.progress(10);

    // Simulate database sync
    const syncResult = await this.simulateDatabaseSync(
      sourceDb,
      targetDb,
      tables,
      mode
    );

    await job.progress(90);

    return {
      success: true,
      mode,
      tablesSynced: syncResult.tablesSynced,
      recordsSynced: syncResult.recordsSynced,
      syncedAt: new Date().toISOString(),
    };
  }

  async processImageProcessing(payload, job) {
    const { imagePath, operations, outputPath } = payload;

    await job.progress(10);

    if (!imagePath || !operations) {
      throw new Error("Image path and operations are required");
    }

    const result = await this.processImage(imagePath, operations, outputPath);

    await job.progress(90);

    return {
      success: true,
      originalPath: imagePath,
      processedPath: result.outputPath,
      operations,
      processedAt: new Date().toISOString(),
    };
  }

  async processWebhookNotification(payload, job) {
    const { url, method, headers, body, retries } = payload;

    await job.progress(20);

    if (!url) {
      throw new Error("Webhook URL is required");
    }

    const result = await this.sendWebhook({
      url,
      method: method || "POST",
      headers,
      body,
      retries: retries || 3,
    });

    await job.progress(80);

    return {
      success: true,
      url,
      statusCode: result.statusCode,
      response: result.response,
      sentAt: new Date().toISOString(),
    };
  }

  async processScheduledTask(payload, job) {
    const { taskName, parameters } = payload;

    await job.progress(10);

    // Execute scheduled task based on taskName
    const result = await this.executeScheduledTask(taskName, parameters);

    await job.progress(90);

    return {
      success: true,
      taskName,
      result,
      executedAt: new Date().toISOString(),
    };
  }

  async processBatchOperation(payload, job) {
    const { operation, items, batchSize } = payload;

    await job.progress(5);

    if (!operation || !items || !Array.isArray(items)) {
      throw new Error("Operation and items array are required");
    }

    const results = [];
    const totalItems = items.length;
    const chunkSize = batchSize || 10;

    for (let i = 0; i < totalItems; i += chunkSize) {
      const batch = items.slice(i, i + chunkSize);
      const batchResults = await this.processBatch(operation, batch);
      results.push(...batchResults);

      const progress = Math.min(95, ((i + chunkSize) / totalItems) * 90 + 5);
      await job.progress(progress);
    }

    return {
      success: true,
      operation,
      totalItems,
      processedItems: results.length,
      results,
      processedAt: new Date().toISOString(),
    };
  }

  // Helper methods for job processing

  async generateReportData(reportType, parameters) {
    // Simulate report data generation
    await this.delay(1000);

    const sampleData = {
      "sales-report": {
        totalSales: Math.floor(Math.random() * 100000),
        transactions: Math.floor(Math.random() * 1000),
        period: parameters?.period || "monthly",
      },
      "user-activity": {
        activeUsers: Math.floor(Math.random() * 5000),
        newUsers: Math.floor(Math.random() * 500),
        period: parameters?.period || "daily",
      },
      "system-health": {
        uptime: "99.9%",
        responseTime: "150ms",
        errorRate: "0.1%",
      },
    };

    return (
      sampleData[reportType] || { message: "Custom report data", parameters }
    );
  }

  async formatReport(data, format) {
    await this.delay(500);

    switch (format.toLowerCase()) {
      case "json":
        return JSON.stringify(data, null, 2);
      case "csv":
        return this.convertToCSV(data);
      case "html":
        return this.convertToHTML(data);
      default:
        return JSON.stringify(data, null, 2);
    }
  }

  convertToCSV(data) {
    if (typeof data !== "object") return data.toString();

    const headers = Object.keys(data);
    const values = Object.values(data);

    return `${headers.join(",")}\n${values.join(",")}`;
  }

  convertToHTML(data) {
    if (typeof data !== "object") return `<p>${data}</p>`;

    let html = '<table border="1"><tr>';

    // Headers
    for (const key of Object.keys(data)) {
      html += `<th>${key}</th>`;
    }
    html += "</tr><tr>";

    // Values
    for (const value of Object.values(data)) {
      html += `<td>${value}</td>`;
    }
    html += "</tr></table>";

    return html;
  }

  async simulateDatabaseSync(sourceDb, targetDb, tables, mode) {
    // Simulate database synchronization
    await this.delay(2000);

    const tablesSynced = tables || ["users", "orders", "products"];
    const recordsSynced = Math.floor(Math.random() * 10000);

    return {
      tablesSynced,
      recordsSynced,
    };
  }

  async processImage(imagePath, operations, outputPath) {
    // Simulate image processing
    await this.delay(1500);

    const processedPath =
      outputPath || imagePath.replace(/(\.[^.]+)$/, "_processed$1");

    return {
      outputPath: processedPath,
      size: { width: 800, height: 600 },
      format: "jpeg",
    };
  }

  async sendWebhook({ url, method, headers, body, retries }) {
    let attempt = 0;
    let lastError;

    while (attempt <= retries) {
      try {
        // Simulate webhook sending
        await this.delay(500);

        // Simulate success/failure
        if (Math.random() < 0.9) {
          // 90% success rate
          return {
            statusCode: 200,
            response: { success: true, timestamp: Date.now() },
          };
        } else {
          throw new Error("Webhook delivery failed");
        }
      } catch (error) {
        lastError = error;
        attempt++;

        if (attempt <= retries) {
          await this.delay(1000 * attempt); // Exponential backoff
        }
      }
    }

    throw lastError;
  }

  async executeScheduledTask(taskName, parameters) {
    // Simulate scheduled task execution
    await this.delay(1000);

    const tasks = {
      "data-cleanup": () => ({ cleaned: Math.floor(Math.random() * 100) }),
      "cache-refresh": () => ({
        refreshed: true,
        keys: Math.floor(Math.random() * 50),
      }),
      "health-check": () => ({ status: "healthy", checks: 5 }),
      "log-rotation": () => ({
        rotated: true,
        files: Math.floor(Math.random() * 10),
      }),
    };

    const taskFunction = tasks[taskName];
    if (!taskFunction) {
      throw new Error(`Unknown scheduled task: ${taskName}`);
    }

    return taskFunction();
  }

  async processBatch(operation, items) {
    // Simulate batch processing
    await this.delay(200);

    return items.map((item, index) => ({
      item,
      result: `${operation}_result_${index}`,
      success: Math.random() < 0.95, // 95% success rate
    }));
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = JobProcessor;
