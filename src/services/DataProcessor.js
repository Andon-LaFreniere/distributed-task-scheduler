// src/services/DataProcessor.js
const logger = require("../utils/logger");

class DataProcessor {
  async process(data, operation, options = {}) {
    logger.info(`Processing data with operation: ${operation}`);

    // Simulate processing delay
    await this.delay(1000);

    const operations = {
      transform: this.transformData,
      filter: this.filterData,
      aggregate: this.aggregateData,
      validate: this.validateData,
      normalize: this.normalizeData,
    };

    if (!operations[operation]) {
      throw new Error(`Unknown operation: ${operation}`);
    }

    const result = await operations[operation].call(this, data, options);

    return {
      recordsProcessed: Array.isArray(data) ? data.length : 1,
      output: result,
      operation,
    };
  }

  async transformData(data, options) {
    // Mock data transformation
    if (Array.isArray(data)) {
      return data.map((item) => ({ ...item, transformed: true }));
    }
    return { ...data, transformed: true };
  }

  async filterData(data, options) {
    const { criteria = {} } = options;
    if (Array.isArray(data)) {
      return data.filter((item) => this.matchesCriteria(item, criteria));
    }
    return this.matchesCriteria(data, criteria) ? data : null;
  }

  async aggregateData(data, options) {
    if (!Array.isArray(data)) {
      return { count: 1, sum: data.value || 0 };
    }

    return {
      count: data.length,
      sum: data.reduce((sum, item) => sum + (item.value || 0), 0),
      avg:
        data.length > 0
          ? data.reduce((sum, item) => sum + (item.value || 0), 0) / data.length
          : 0,
    };
  }

  async validateData(data, options) {
    const { schema = {} } = options;

    // Mock validation
    const errors = [];
    if (Array.isArray(data)) {
      data.forEach((item, index) => {
        if (schema.required && !item.id) {
          errors.push(`Item ${index}: missing required field 'id'`);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  async normalizeData(data, options) {
    // Mock normalization
    if (Array.isArray(data)) {
      return data.map((item) => this.normalizeItem(item));
    }
    return this.normalizeItem(data);
  }

  normalizeItem(item) {
    const normalized = {};
    for (const [key, value] of Object.entries(item)) {
      normalized[key.toLowerCase()] =
        typeof value === "string" ? value.trim() : value;
    }
    return normalized;
  }

  matchesCriteria(item, criteria) {
    for (const [key, value] of Object.entries(criteria)) {
      if (item[key] !== value) {
        return false;
      }
    }
    return true;
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = DataProcessor;

// ================================================
