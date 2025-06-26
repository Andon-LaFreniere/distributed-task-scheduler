// src/services/EmailService.js
const logger = require("../utils/logger");

class EmailService {
  constructor() {
    this.provider = process.env.EMAIL_PROVIDER || "mock";
  }

  async sendEmail({ to, subject, body, attachments }) {
    logger.info("Sending email", { to, subject });

    // Simulate email sending
    await this.delay(500);

    // Mock successful send
    const messageId = `msg_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    logger.info("Email sent successfully", { to, messageId });

    return {
      messageId,
      to,
      subject,
      sentAt: new Date().toISOString(),
    };
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = EmailService;

// ================================================
