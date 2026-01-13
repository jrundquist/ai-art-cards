import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs/promises";
import { DataService, Project, Card } from "./lib/data_service";
import { ImageGenerator } from "./lib/image_generator";
import { ChatService } from "./lib/chat_service";
import { exiftool } from "exiftool-vendored";
import archiver from "archiver";
import fsSync from "fs";
import { logger, configureLogger } from "./lib/logger";

// Wrapper to create App with config
export function createApp(dataRoot?: string) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // Data Path Setup
  // If dataRoot is provided, use it. Otherwise default to repo structure.
  const resolvedDataRoot = dataRoot
    ? path.resolve(dataRoot)
    : path.join(process.cwd(), "data");

  // Legacy paths for reference, but we mainly use dataService now
  const outputDirLegacy = path.join(resolvedDataRoot, "output");

  logger.info(`Initializing DataService with root: ${resolvedDataRoot}`);
  const dataService = new DataService(resolvedDataRoot);
  // Renamed for clarity in the new endpoint
  const projectService = dataService;
  const cardService = dataService;

  // Perform one-time migration check
  // (Async, but we don't await blocking server start - or maybe we should?)
  // Better to look messy for a second than block completely, or await?
  // Let's await it to ensure consistency before requests come in.
  // Converting createApp to async would be a breaking change for index.ts/main.
  // So we'll fire and forget, but log heavily.
  dataService.migrate().then(() => {
    logger.info("[Server] Data migration check complete.");
  });

  // Config API Key (Naive in-memory for now, or use ENV)
  let API_KEY = process.env.GEMINI_API_KEY || "";

  // Chat Service Definition (Moved up for access)
  let chatService: ChatService | null = null;
  const initChatService = () => {
    // Always init, even if no key (for history access)
    // Re-create instance to update key if changed
    chatService = new ChatService(API_KEY, dataService);
    // Update to set data root
    chatService.setDataRoot(resolvedDataRoot);
    chatService.setGetActiveJobs(() => Array.from(activeJobs.values()));
  };
  initChatService();

  // Generation Status Tracking for SSE
  interface GenerationJob {
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
  }

  const activeJobs = new Map<string, GenerationJob>();
  const sseClients = new Set<express.Response>();

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

  // Serve Static Frontend
  // In dev (ts-node), __dirname is src/. In built (node), it's dist/.
  // We need to find where 'public' actually lives.
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
    // Fallback to avoid crash (though it will error 404s)
  } else {
    logger.info(`Serving static files from: ${publicDir}`);
    app.use(express.static(publicDir));
  }

  // Serve static data (images, jsons)
  // Serve /data from the resolved data root
  // This allows accessing `data/projects/{id}/assets/...`
  app.use("/data", express.static(resolvedDataRoot));

  // Helper: Secure Path Resolution
  // Now resolves into project assets: data/projects/{projectId}/assets/...
  function resolveProjectAssetsPath(
    projectId: string,
    segments: string[]
  ): string | null {
    const root = path.join(resolvedDataRoot, "projects", projectId, "assets");
    const target = path.resolve(root, ...segments);
    if (!target.startsWith(root)) return null;
    return target;
  }

  // --- API ---

  app.post("/api/config", async (req, res) => {
    const { apiKey, name } = req.body;
    if (apiKey) {
      if (name) {
        // Save named key
        await dataService.saveKey(name, apiKey);
      }
      API_KEY = apiKey;
      // Re-init chat service to pick up new key
      initChatService();
      res.json({ success: true });
    } else {
      res.status(400).json({ error: "Missing apiKey" });
    }
  });

  app.get("/api/keys", async (req, res) => {
    const keys = await dataService.getKeys();
    res.json(keys);
  });

  // SSE endpoint for status updates
  app.get("/api/status/stream", (req, res) => {
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
      (job) => job.status === "generating"
    );
    if (activeJobsArray.length > 0) {
      res.write(
        `data: ${JSON.stringify({
          type: "initial",
          jobs: activeJobsArray,
        })}\n\n`
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
        `[SSE] Client disconnected. Total clients: ${sseClients.size}`
      );
    });
  });

  // Projects
  app.get("/api/projects", async (req, res) => {
    res.json(await dataService.getProjects());
  });

  app.post("/api/projects", async (req, res) => {
    const project: Project = req.body;
    await dataService.saveProject(project);
    res.json({ success: true, project });
  });

  app.delete("/api/projects/:id", async (req, res) => {
    const { id } = req.params;
    try {
      const p = await dataService.getProject(id);
      if (!p) return res.status(404).json({ error: "Project not found" });

      // Delete Metadata & All Files (DataService handles the whole folder now)
      await dataService.deleteProject(id);

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Cards

  app.post("/api/cards", async (req, res) => {
    const card: Card = req.body;
    // Auto-generate ID if missing
    if (!card.id) {
      try {
        card.id = await dataService.generateCardId(card.projectId);
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    }
    await dataService.saveCard(card);
    res.json({ success: true, card });
  });

  app.delete("/api/projects/:projectId/cards/:cardId", async (req, res) => {
    const { projectId, cardId } = req.params;
    try {
      const project = await projectService.getProject(projectId);
      const cards = await cardService.getCards(projectId);
      const card = cards.find((c) => c.id === cardId);

      if (!card) return res.status(404).json({ error: "Card not found" });

      // Delete Metadata
      await dataService.deleteCard(projectId, cardId);

      // Delete Output Files
      // New Path: data/projects/{projectId}/assets/{cardSubfolder}
      if (card.outputSubfolder) {
        const outPath = path.join(
          resolvedDataRoot,
          "projects",
          projectId,
          "assets",
          card.outputSubfolder
        );
        logger.info(
          `[Server] Attempting to delete card output directory: ${outPath}`
        );
        // Security check
        if (
          outPath.startsWith(path.join(resolvedDataRoot, "projects", projectId))
        ) {
          await fs.rm(outPath, { recursive: true, force: true });
          logger.info(`[Server] Card output directory deleted.`);
        } else {
          logger.warn(
            `[Server] Card output directory outside project dir, skipping deletion: ${outPath}`
          );
        }
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Generate
  app.post("/api/generate", async (req, res) => {
    logger.info(
      `[Server] POST /api/generate body: ${JSON.stringify(req.body)}`
    );
    const {
      cardId,
      projectId,
      count,
      promptOverride,
      arOverride,
      resOverride,
    } = req.body;

    if (!API_KEY) {
      res.status(401).json({ error: "API Key not set" });
      return;
    }

    const project = await dataService.getProject(projectId);
    const cards = await dataService.getCards(projectId);
    const card = cards.find((c) => c.id === cardId);

    if (!project || !card) {
      res.status(404).json({ error: "Project or Card not found" });
      return;
    }

    const generator = new ImageGenerator(API_KEY);
    // Use override if provided, else use saved card prompt
    let fullPrompt = "";
    if (promptOverride !== undefined) {
      fullPrompt = promptOverride;
    } else {
      fullPrompt = `${project.globalPrefix} ${card.prompt} ${project.globalSuffix}`;
    }

    logger.info("------------------------------------------------");
    logger.info(
      `[Server] Generating Art for Card: ${card.name} (ID: ${card.id})`
    );
    logger.info(`[Server] Project: ${project.name} (ID: ${project.id})`);
    logger.info(`[Server] Full Prompt: ${fullPrompt}`);
    // Resolve reference images if any
    const referenceImageIds: string[] = req.body.referenceImageIds || [];
    const referenceImageFiles: any[] = req.body.referenceImageFiles || [];
    const referenceImages: { buffer: Buffer; mimeType: string }[] = [];

    // 1. Resolve temporary IDs
    if (referenceImageIds.length > 0) {
      logger.info(
        `[Server] Using temporary reference images: ${referenceImageIds.join(
          ", "
        )}`
      );
      for (const id of referenceImageIds) {
        const buf = await dataService.getTempImage(id, projectId);
        if (buf) {
          // Temp images are usually PNGs or JPEGs, we'll assume PNG for now or try to detect
          // For simplicity, we'll use a generic image/png if we don't know
          referenceImages.push({ buffer: buf, mimeType: "image/png" });
        }
      }
    }

    // 2. Resolve historical files
    if (referenceImageFiles.length > 0) {
      logger.info(
        `[Server] Resolving ${referenceImageFiles.length} historical reference files...`
      );
      for (const refFile of referenceImageFiles) {
        try {
          const {
            projectId: refProjectId,
            cardId: refCardId,
            filename: refFilename,
          } = refFile;

          logger.info(
            `[Server] Attempting to resolve: project=${refProjectId}, card=${refCardId}, file=${refFilename}`
          );

          const refCards = await dataService.getCards(refProjectId);
          const refCard = refCards.find((c) => c.id === refCardId);

          if (refCard) {
            const refSubfolder = refCard.outputSubfolder || "default";
            const filePath = path.join(
              resolvedDataRoot,
              "projects",
              refProjectId,
              "assets",
              refSubfolder,
              refFilename
            );

            logger.info(`[Server] Final resolved path: ${filePath}`);
            const buf = await fs.readFile(filePath);

            // Determine mime type from extension
            const ext = path.extname(refFilename).toLowerCase();
            const mimeType =
              ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";

            referenceImages.push({ buffer: buf, mimeType });
            logger.info(
              `[Server] Found and loaded reference image: ${refFilename} (${buf.length} bytes, type=${mimeType})`
            );
          } else {
            logger.warn(
              `[Server] Failed to find card for reference: ${refCardId} in project ${refProjectId}`
            );
          }
        } catch (e: any) {
          logger.warn(
            `[Server] Failed to resolve reference file ${refFile.filename}: ${e.message}`
          );
        }
      }
    }
    logger.info("------------------------------------------------");

    // Resolve output folder - SECURE
    // NEW: data/projects/{projectId}/assets/{cardSubfolder}
    const cardSubfolder = (card.outputSubfolder || "default").replace(
      /^(\.\.(\/|\\|$))+/,
      ""
    );

    const outputFolder = path.join(
      resolvedDataRoot,
      "projects",
      projectId,
      "assets",
      cardSubfolder
    );

    // Security check
    if (
      !outputFolder.startsWith(
        path.join(resolvedDataRoot, "projects", projectId)
      )
    ) {
      res.status(403).json({ error: "Security Error: Invalid output path" });
      return;
    }

    const results = [];

    // Create generation job
    const jobId = `job_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const num = count || 1;
    const job: GenerationJob = {
      id: jobId,
      projectId,
      cardId,
      cardName: card.name,
      status: "generating",
      current: 0,
      total: num,
      startedAt: Date.now(),
      results: [],
    };

    activeJobs.set(jobId, job);
    broadcastStatus(job);
    logger.info(
      `[Status] Started job ${jobId} for ${card.name} (${num} images)`
    );

    // Start generation asynchronously
    (async () => {
      try {
        const aspectRatio =
          arOverride || card.aspectRatio || project.defaultAspectRatio || "2:3";
        let resolution =
          resOverride || card.resolution || project.defaultResolution || "2K";

        if (!aspectRatio) resolution = "2K";

        logger.info(`Config: AR=${aspectRatio}, Res=${resolution}`);

        for (let i = 0; i < num; i++) {
          const { buffer, mimeType } = await generator.generateImageBuffer(
            fullPrompt,
            {
              aspectRatio,
              resolution,
              referenceImages,
            }
          );

          const savedPath = await generator.saveImage(
            buffer,
            mimeType,
            outputFolder,
            card.id,
            fullPrompt,
            {
              title: card.name,
              project: project.name,
              cardId: card.id,
            }
          );

          // Return relative path for frontend
          // Front end expects "data/..."
          // savedPath is .../data/projects/123/assets/sub/img.png
          // relToRoot is projects/123/assets/sub/img.png
          const relToRoot = path.relative(resolvedDataRoot, savedPath);
          const webPath = path.join("data", relToRoot);
          results.push(webPath);
          job.results?.push(webPath);

          // Update job progress
          job.current = i + 1;
          broadcastStatus(job);
          logger.info(
            `[Status] Job ${jobId} progress: ${job.current}/${job.total}`
          );
        }

        // Mark job as completed
        job.status = "completed";
        job.completedAt = Date.now();
        broadcastStatus(job);
        logger.info(`[Status] Job ${jobId} completed successfully`);
      } catch (e: any) {
        logger.error(`[Status] Job ${jobId} failed:`, e);
        job.status = "error";
        job.error = e.message;
        job.completedAt = Date.now();
        broadcastStatus(job);
      }
    })();

    // Respond immediately with job ID
    res.json({ success: true, jobId, message: "Generation started" });
  });

  // Get Cards
  app.get("/api/projects/:projectId/cards", async (req, res) => {
    try {
      const cards = await cardService.getCards(req.params.projectId);
      const project = await projectService.getProject(req.params.projectId);

      // Enrich with counts
      const enriched = await Promise.all(
        cards.map(async (c) => {
          try {
            // New path: data/projects/{projectId}/assets/{subfolder}
            const outDir = path.join(
              resolvedDataRoot,
              "projects",
              req.params.projectId,
              "assets",
              c.outputSubfolder || "default"
            );

            // Check if dir exists
            await fs.access(outDir);
            const files = await fs.readdir(outDir);
            const archived = new Set(c.archivedImages || []);
            const count = files
              .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
              .filter((f) => !archived.has(f)).length;
            return { ...c, imageCount: count };
          } catch (e) {
            return { ...c, imageCount: 0 };
          }
        })
      );

      res.json(enriched);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get Project Preview Images (recent images across all cards)
  app.get("/api/projects/:projectId/previews", async (req, res) => {
    const { projectId } = req.params;
    try {
      const project = await projectService.getProject(projectId);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const cards = await cardService.getCards(projectId);
      const allImages: { path: string; time: Date }[] = [];

      // Collect images from all cards
      for (const card of cards) {
        // New path: data/projects/{projectId}/assets/{subfolder}
        const outDir = path.join(
          resolvedDataRoot,
          "projects",
          projectId,
          "assets",
          card.outputSubfolder || "default"
        );

        try {
          await fs.access(outDir);
          const files = await fs.readdir(outDir);
          const archived = new Set(card.archivedImages || []);

          for (const file of files) {
            if (/\.(png|jpg|jpeg|webp)$/i.test(file) && !archived.has(file)) {
              const fullPath = path.join(outDir, file);
              const stats = await fs.stat(fullPath);
              const rel = path.relative(resolvedDataRoot, fullPath);
              allImages.push({
                path: path.join("data", rel),
                time: stats.birthtime,
              });
            }
          }
        } catch {
          // Skip cards with no output directory
          continue;
        }
      }

      // Sort by newest first and limit to 6
      allImages.sort((a, b) => b.time.getTime() - a.time.getTime());
      const previews = allImages.slice(0, 6).map((img) => img.path);

      res.json(previews);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/projects/:projectId/cards/:cardId/images", async (req, res) => {
    const { projectId, cardId } = req.params;
    try {
      const project = await projectService.getProject(projectId);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const cards = await cardService.getCards(projectId);
      const card = cards.find((c) => c.id === cardId);
      if (!card) return res.status(404).json({ error: "Card not found" });

      const includeArchived = req.query.includeArchived === "true";
      const { images } = await dataService.listCardImages(
        projectId,
        cardId,
        includeArchived
      );

      // Frontend expects array of string paths
      const paths = images.map((img) => img.path);

      res.json(paths);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Image Metadata
  app.get("/api/image-metadata", async (req, res) => {
    const { path: relativePath } = req.query;
    if (!relativePath || typeof relativePath !== "string")
      return res.status(400).json({ error: "Path required" });

    try {
      // relativePath comes from frontend as "data/projects/123/assets/..."

      let filePathOnDisk = "";
      if (relativePath.startsWith("data/")) {
        const stripped = relativePath.substring(5); // remove 'data/'
        filePathOnDisk = path.join(resolvedDataRoot, stripped);
      } else {
        filePathOnDisk = path.resolve(process.cwd(), relativePath);
      }

      const fullPath = path.resolve(filePathOnDisk);

      // Security Check: must be within resolvedDataRoot (simplest check now)
      if (!fullPath.startsWith(resolvedDataRoot)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const stats = await fs.stat(fullPath);
      const tags = await exiftool.read(fullPath);

      res.json({
        filename: path.basename(fullPath),
        created: stats.birthtime,
        prompt: tags.Description || tags.ImageDescription || "No prompt found",
      });
    } catch (e: any) {
      logger.error("Metadata error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Archive Image
  app.post("/api/cards/:cardId/archive", async (req, res) => {
    const { cardId } = req.params;
    const { projectId, filename } = req.body;

    try {
      const cards = await cardService.getCards(projectId);
      const card = cards.find((c) => c.id === cardId);
      if (!card) return res.status(404).json({ error: "Card not found" });

      if (!card.archivedImages) card.archivedImages = [];
      let isArchived = false;

      if (card.archivedImages.includes(filename)) {
        // Unarchive
        card.archivedImages = card.archivedImages.filter((f) => f !== filename);
        isArchived = false;
      } else {
        // Archive
        card.archivedImages.push(filename);
        isArchived = true;
      }

      await cardService.saveCard(card);
      res.json({ success: true, isArchived });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Toggle Favorite
  app.post("/api/cards/:cardId/favorite", async (req, res) => {
    const { cardId } = req.params;
    const { projectId, filename } = req.body;

    try {
      const cards = await cardService.getCards(projectId);
      const card = cards.find((c) => c.id === cardId);
      if (!card) return res.status(404).json({ error: "Card not found" });

      if (!card.favoriteImages) card.favoriteImages = [];

      let isFavorite = false;
      const idx = card.favoriteImages.indexOf(filename);
      if (idx === -1) {
        card.favoriteImages.push(filename);
        isFavorite = true;
      } else {
        card.favoriteImages.splice(idx, 1);
        isFavorite = false;
      }

      await cardService.saveCard(card);
      res.json({ success: true, isFavorite });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Download Gallery Images as Zip
  app.post("/api/cards/:cardId/download-zip", async (req, res) => {
    const { cardId } = req.params;
    const { projectId, filenames } = req.body;

    try {
      const project = await projectService.getProject(projectId);
      const cards = await cardService.getCards(projectId);
      const card = cards.find((c) => c.id === cardId);

      if (!project || !card) {
        return res.status(404).json({ error: "Project or Card not found" });
      }

      // New Path
      const cardDir = path.join(
        resolvedDataRoot,
        "projects",
        projectId,
        "assets",
        card.outputSubfolder || "default"
      );

      // Security check
      if (
        !cardDir.startsWith(path.join(resolvedDataRoot, "projects", projectId))
      ) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Verify directory exists
      try {
        await fs.access(cardDir);
      } catch {
        return res.status(404).json({ error: "No images found for this card" });
      }

      // Set response headers for zip download
      const zipName = `${card.name.replace(/[^a-z0-9]/gi, "_")}_${
        new Date().toISOString().split("T")[0]
      }.zip`;
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

      // Create archiver instance
      const archive = archiver("zip", {
        zlib: { level: 9 }, // Compression level
      });

      // Pipe archive to response
      archive.pipe(res);

      logger.info(
        `[Server] Starting ZIP download for card: ${card.name} (${filenames.length} files)`
      );

      // Create a folder name from the card name
      const folderName = card.name.replace(/[^a-z0-9]/gi, "_");

      // Add each specified file to the archive
      for (const filename of filenames) {
        const filePath = path.join(cardDir, filename);
        // Security check: ensure file is within cardDir
        if (!filePath.startsWith(cardDir)) {
          logger.warn(
            `[Server] Skipping file outside card directory: ${filename}`
          );
          continue;
        }

        try {
          await fs.access(filePath);
          // Place images in a folder named after the card
          logger.info(`[Server] Adding file to ZIP: ${filename}`);
          archive.file(filePath, { name: `${folderName}/${filename}` });
        } catch {
          logger.warn(`[Server] File not found, skipping: ${filename}`);
        }
      }

      // Finalize the archive
      await archive.finalize();
      logger.info(`[Server] ZIP download finalized: ${zipName}`);
    } catch (e: any) {
      logger.error("Zip download error:", e);
      if (!res.headersSent) {
        res.status(500).json({ error: e.message });
      }
    }
  });

  // --- Chat ---

  // --- Chat ---

  // chatService init moved to top of function

  app.post("/api/chat/message", async (req, res) => {
    if (!chatService) {
      initChatService();
    }
    // Deep check for generation capability
    if (!API_KEY) {
      return res.status(401).json({ error: "API Key not set" });
    }

    const { projectId, conversationId, message, activeCardId, images, parts } =
      req.body;

    // Set headers for SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
      if (!chatService) throw new Error("Chat service not initialized");
      await chatService.sendMessageStream(
        projectId,
        conversationId,
        message,
        activeCardId || null,
        images || [], // Pass images if present
        res,
        parts || []
      );
    } catch (e: any) {
      logger.error("[Chat API] Error processing message:", e);
      if (!res.headersSent) {
        res.status(500).json({ error: e.message });
      } else {
        // If headers sent (streaming started), we need to write error event
        res.write(
          `data: ${JSON.stringify({ type: "error", content: e.message })}\n\n`
        );
        res.end();
      }
    }
  });

  app.get("/api/projects/:projectId/conversations", async (req, res) => {
    if (!chatService) {
      if (API_KEY) initChatService();
      // Attempt to init, but if failed just continue?
      // List conversations only needs FS access which ChatService has if instantiated.
      // If no API key, we cant instantiate ChatService easily because it expects one.
      // But listConversations doesn't use it.
      // For now, require API Key or fix ChatService to be optional-key.
      if (!chatService)
        return res.status(401).json({ error: "API Key not set" });
    }
    const { projectId } = req.params;
    const convs = await chatService?.listConversations(projectId);
    res.json(convs);
  });

  app.get(
    "/api/projects/:projectId/conversations/:conversationId",
    async (req, res) => {
      if (!chatService) {
        if (API_KEY) initChatService();
        if (!chatService)
          return res.status(401).json({ error: "API Key not set" });
      }
      const { projectId, conversationId } = req.params;
      const conv = await chatService?.loadConversation(
        projectId,
        conversationId
      );
      if (!conv)
        return res.status(404).json({ error: "Conversation not found" });
      res.json(conv);
    }
  );

  app.delete("/api/conversations/:conversationId", async (req, res) => {
    if (!chatService) {
      if (API_KEY) initChatService();
      if (!chatService)
        return res.status(401).json({ error: "API Key not set" });
    }

    try {
      const { conversationId } = req.params;
      // Delete the conversation by ID via ChatService.

      const success = await chatService?.deleteConversation(conversationId);
      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Conversation not found" });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

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
