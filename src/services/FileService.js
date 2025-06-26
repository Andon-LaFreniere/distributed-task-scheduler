// src/services/FileService.js
const logger = require("../utils/logger");
const path = require("path");
const fs = require("fs").promises;

class FileService {
  constructor() {
    this.reportsDir = process.env.REPORTS_DIR || "./reports";
    this.tempDir = process.env.TEMP_DIR || "./temp";
  }

  async saveReport(reportId, content) {
    try {
      // Ensure reports directory exists
      await this.ensureDirectory(this.reportsDir);

      const filename = `${reportId}.json`;
      const filePath = path.join(this.reportsDir, filename);

      await fs.writeFile(filePath, content, "utf8");

      logger.info(`Report saved: ${filePath}`);
      return filePath;
    } catch (error) {
      logger.error("Error saving report", error);
      throw error;
    }
  }

  async cleanupFiles({ directory, pattern, maxAge }) {
    try {
      // Simulate file cleanup
      await this.delay(1000);

      const deletedFiles = Math.floor(Math.random() * 10);
      const spaceSaved = deletedFiles * 1024 * 1024; // MB

      logger.info(
        `Cleanup completed: ${deletedFiles} files deleted, ${spaceSaved} bytes saved`
      );

      return {
        deletedFiles,
        spaceSaved,
      };
    } catch (error) {
      logger.error("Error during cleanup", error);
      throw error;
    }
  }

  async createBackup({ source, destination, compression }) {
    try {
      // Simulate backup creation
      await this.delay(2000);

      const backupPath = `${destination}/backup_${Date.now()}.${
        compression === "gzip" ? "tar.gz" : "zip"
      }`;
      const size = Math.floor(Math.random() * 1000000000); // Random size in bytes

      logger.info(`Backup created: ${backupPath} (${size} bytes)`);

      return {
        path: backupPath,
        size,
      };
    } catch (error) {
      logger.error("Error creating backup", error);
      throw error;
    }
  }

  async ensureDirectory(dirPath) {
    try {
      await fs.access(dirPath);
    } catch (error) {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = FileService;
