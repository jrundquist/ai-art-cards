import { Router, Response } from "express";
import { logger } from "../lib/logger";

export interface GenerationJob {
  id: string;
  projectId: string;
  cardId: string;
  cardName: string;
  status: "generating" | "completed" | "error";
  current: number;
  total: number;
  error?: string;
  startedAt: number;
  completedAt?: number;
  results?: string[]; // Array of web paths (data/...)
  aspectRatio?: string;
}

export function createStatusRouter(
  activeJobs: Map<string, GenerationJob>,
  sseClients: Set<Response>,
) {
  const router = Router();

  // SSE endpoint for status updates
  router.get("/status/stream", (req, res) => {
    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable buffering in nginx

    // Add this client to the set
    sseClients.add(res);
    logger.info(`[SSE] Client connected. Total clients: ${sseClients.size}`);

    // Send current active jobs to the new client
    // Only send jobs that are still generating (not completed/error)
    const activeJobsArray = Array.from(activeJobs.values()).filter(
      (job) => job.status === "generating",
    );
    if (activeJobsArray.length > 0) {
      res.write(
        `data: ${JSON.stringify({
          type: "initial",
          jobs: activeJobsArray,
        })}\n\n`,
      );
    }

    // Send heartbeat every 30 seconds to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, 30000);

    // Clean up on client disconnect
    req.on("close", () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
      logger.info(
        `[SSE] Client disconnected. Total clients: ${sseClients.size}`,
      );
    });
  });

  return router;
}
