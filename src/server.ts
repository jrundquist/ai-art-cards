import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fsSync from "fs";
import { DataService } from "./lib/data_service";
import { ChatService } from "./lib/chat_service";
import { logger, configureLogger } from "./lib/logger";

// Route modules
import { createConfigRouter } from "./routes/config";
import { createProjectsRouter } from "./routes/projects";
import { createCardsRouter } from "./routes/cards";
import { createStatusRouter, GenerationJob } from "./routes/status";
import { createImagesRouter } from "./routes/images";
import { createGenerationRouter } from "./routes/generation";
import { createChatRouter } from "./routes/chat";

// Wrapper to create App with config
export function createApp(dataRoot?: string) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // Data Path Setup
  const resolvedDataRoot = dataRoot
    ? path.resolve(dataRoot)
    : path.join(process.cwd(), "data");

  logger.info(`Initializing DataService with root: ${resolvedDataRoot}`);
  const dataService = new DataService(resolvedDataRoot);

  // Perform one-time migration check
  dataService.migrate().then(() => {
    logger.info("[Server] Data migration check complete.");
  });

  // Config API Key
  let API_KEY = process.env.GEMINI_API_KEY || "";

  // Chat Service Definition
  let chatService: ChatService | null = null;
  const activeJobs = new Map<string, GenerationJob>();
  const sseClients = new Set<express.Response>();

  const initChatService = () => {
    // Always init, even if no key (for history access)
    // Re-create instance to update key if changed
    chatService = new ChatService(API_KEY, dataService);
    // Update to set data root
    chatService.setDataRoot(resolvedDataRoot);
    // Needed for listing active jobs in chat or checks
    chatService.setGetActiveJobs(() => Array.from(activeJobs.values()));
  };
  initChatService();

  // Callbacks and Accessors for Routers
  const getApiKey = () => API_KEY;
  const setApiKey = (key: string) => {
    API_KEY = key;
    initChatService(); // Re-init chat service with new key
  };
  const getChatService = () => chatService;

  // Broadcast status update to all SSE clients
  const broadcastStatus = (job: GenerationJob) => {
    const message = `data: ${JSON.stringify(job)}\n\n`;
    sseClients.forEach((client) => {
      try {
        client.write(message);
      } catch (e) {
        logger.error("Error broadcasting to SSE client:", e);
      }
    });
  };

  // Cleanup old completed jobs (run periodically)
  const CLEANUP_INTERVAL = 60000; // 1 minute
  const JOB_RETENTION_TIME = 300000; // 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [jobId, job] of activeJobs.entries()) {
      if (job.completedAt && now - job.completedAt > JOB_RETENTION_TIME) {
        activeJobs.delete(jobId);
        logger.info(`[Status] Cleaned up old job: ${jobId}`);
      }
    }
  }, CLEANUP_INTERVAL);

  // --- Mount Routers ---
  app.use("/api", createConfigRouter(dataService, setApiKey));
  app.use("/api", createProjectsRouter(dataService, resolvedDataRoot));
  app.use("/api", createCardsRouter(dataService, resolvedDataRoot));
  app.use("/api", createStatusRouter(activeJobs, sseClients));
  app.use("/api", createImagesRouter(dataService, resolvedDataRoot));
  app.use(
    "/api",
    createGenerationRouter(
      dataService,
      activeJobs,
      broadcastStatus,
      getApiKey,
      resolvedDataRoot
    )
  );
  app.use("/api", createChatRouter(getChatService, initChatService, getApiKey));

  // Serve Static Frontend
  const possiblePaths = [
    path.join(__dirname, "public"),
    path.join(__dirname, "../src/public"),
    path.join(process.cwd(), "src", "public"),
  ];

  const publicDir = possiblePaths.find((p) => fsSync.existsSync(p));
  if (!publicDir) {
    logger.error(
      "CRITICAL: Could not find 'public' directory. Checked:",
      possiblePaths
    );
  } else {
    logger.info(`Serving static files from: ${publicDir}`);
    app.use(express.static(publicDir));
  }

  // Serve static data (images, jsons)
  app.use("/data", express.static(resolvedDataRoot));

  return app;
}

// Start
// Export for Electron
export async function startServer(
  port: number = 5432,
  dataRoot?: string,
  logPath?: string
) {
  if (logPath) {
    configureLogger(logPath);
  }
  const app = createApp(dataRoot);
  return new Promise<void>((resolve) => {
    app.listen(port, (err) => {
      if (err) {
        logger.error(`Failed to start server: ${err}`);
        process.exit(1);
      }
      logger.info(`Server running at http://localhost:${port}`);
      resolve();
    });
  });
}

// Auto-start if run directly
if (require.main === module) {
  const args = process.argv.slice(2);
  let port = 5432;
  let logPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--log-path" && args[i + 1]) {
      logPath = args[i + 1];
      i++;
    }
  }

  dotenv.config();
  startServer(port, undefined, logPath);
}
