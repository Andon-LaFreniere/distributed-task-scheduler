const request = require("supertest");
const app = require("../app");

describe("Task API", () => {
  describe("POST /api/tasks", () => {
    it("should create a new task", async () => {
      const taskData = {
        type: "send-email",
        payload: {
          to: "test@example.com",
          subject: "Test",
          body: "Test message",
        },
        priority: "normal",
      };

      const response = await request(app)
        .post("/api/tasks")
        .set("X-API-Key", "test-key")
        .send(taskData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.task).toHaveProperty("id");
      expect(response.body.task.type).toBe("send-email");
    });

    it("should validate required fields", async () => {
      const response = await request(app)
        .post("/api/tasks")
        .set("X-API-Key", "test-key")
        .send({})
        .expect(400);

      expect(response.body.error).toContain("required");
    });
  });

  describe("GET /api/tasks/:taskId", () => {
    it("should return task status", async () => {
      // First create a task
      const taskData = {
        type: "process-data",
        payload: { data: [1, 2, 3] },
      };

      const createResponse = await request(app)
        .post("/api/tasks")
        .set("X-API-Key", "test-key")
        .send(taskData);

      const taskId = createResponse.body.task.id;

      // Then get its status
      const response = await request(app)
        .get(`/api/tasks/${taskId}`)
        .set("X-API-Key", "test-key")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.task.id).toBe(taskId);
    });
  });
});
