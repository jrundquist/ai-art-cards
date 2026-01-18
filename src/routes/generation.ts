import { Router } from "express";
import { DataService } from "../lib/data_service";
import { ImageGenerator } from "../lib/image_generator";
import { GenerationJob } from "./status";
import { logger } from "../lib/logger";
import path from "path";
import fs from "fs/promises";

// Need a way to get the current API key dynamically since it changes
type ApiKeyProvider = () => string;
type BroadcastStatusFn = (job: GenerationJob) => void;

export function createGenerationRouter(
  dataService: DataService,
  activeJobs: Map<string, GenerationJob>,
  broadcastStatus: BroadcastStatusFn,
  getApiKey: ApiKeyProvider,
  resolvedDataRoot: string,
) {
  const router = Router();

  router.post("/generate", async (req, res) => {
    logger.info(
      `[Server] POST /api/generate body: ${JSON.stringify(req.body)}`,
    );
    const {
      cardId,
      projectId,
      count,
      promptOverride,
      arOverride,
      resOverride,
    } = req.body;

    const API_KEY = getApiKey();
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
      // 1. Add Active Project Prefixes
      const parts: string[] = [];
      const modifiers = project.promptModifiers || [];
      const disabled = new Set(card.inactiveModifiers || []);

      const activePrefixes = modifiers
        .filter((m) => m.type === "prefix" && !disabled.has(m.id))
        .map((m) => m.text);
      if (activePrefixes.length > 0) parts.push(...activePrefixes);

      // 2. Card Prompt
      if (card.prompt) parts.push(card.prompt);

      // 3. Add Active Project Suffixes
      const activeSuffixes = modifiers
        .filter((m) => m.type === "suffix" && !disabled.has(m.id))
        .map((m) => m.text);
      if (activeSuffixes.length > 0) parts.push(...activeSuffixes);

      // Join with newlines
      fullPrompt = parts.join("\n\n");
    }

    logger.info("------------------------------------------------");
    logger.info(
      `[Server] Generating Art for Card: ${card.name} (ID: ${card.id})`,
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
          ", ",
        )}`,
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
        `[Server] Resolving ${referenceImageFiles.length} historical reference files...`,
      );
      for (const refFile of referenceImageFiles) {
        try {
          const {
            projectId: refProjectId,
            cardId: refCardId,
            filename: refFilename,
          } = refFile;

          logger.info(
            `[Server] Attempting to resolve: project=${refProjectId}, card=${refCardId}, file=${refFilename}`,
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
              refFilename,
            );

            logger.info(`[Server] Final resolved path: ${filePath}`);
            const buf = await fs.readFile(filePath);

            // Determine mime type from extension
            const ext = path.extname(refFilename).toLowerCase();
            const mimeType =
              ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";

            referenceImages.push({ buffer: buf, mimeType });
            logger.info(
              `[Server] Found and loaded reference image: ${refFilename} (${buf.length} bytes, type=${mimeType})`,
            );
          } else {
            logger.warn(
              `[Server] Failed to find card for reference: ${refCardId} in project ${refProjectId}`,
            );
          }
        } catch (e: any) {
          logger.warn(
            `[Server] Failed to resolve reference file ${refFile.filename}: ${e.message}`,
          );
        }
      }
    }
    logger.info("------------------------------------------------");

    // Resolve output folder - SECURE
    // Path: data/projects/{projectId}/assets/{cardSubfolder}
    const cardSubfolder = (card.outputSubfolder || "default").replace(
      /^(\.\.(\/|\\|$))+/,
      "",
    );

    const outputFolder = path.join(
      resolvedDataRoot,
      "projects",
      projectId,
      "assets",
      cardSubfolder,
    );

    // Security check
    if (
      !outputFolder.startsWith(
        path.join(resolvedDataRoot, "projects", projectId),
      )
    ) {
      res.status(403).json({ error: "Security Error: Invalid output path" });
      return;
    }

    const results: string[] = []; // Explicitly specificy type to avoid `never[]` inference issues

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
      `[Status] Started job ${jobId} for ${card.name} (${num} images)`,
    );

    // Start generation asynchronously
    (async () => {
      try {
        const aspectRatio =
          arOverride || card.aspectRatio || project.defaultAspectRatio || "2:3";
        let resolution =
          resOverride || card.resolution || project.defaultResolution || "2K";

        if (!aspectRatio) resolution = "2K";

        // Update job with aspectRatio so frontend can display correct placeholder shape
        job.aspectRatio = aspectRatio;
        broadcastStatus(job);

        logger.info(`Config: AR=${aspectRatio}, Res=${resolution}`);

        for (let i = 0; i < num; i++) {
          const { buffer, mimeType, modelName } =
            await generator.generateImageBuffer(fullPrompt, {
              aspectRatio,
              resolution,
              referenceImages,
            });

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
              generationArgs: {
                prompt: fullPrompt,
                aspectRatio,
                resolution,
                referenceImageIds,
                referenceImageFiles,
                model: modelName,
              },
            },
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
            `[Status] Job ${jobId} progress: ${job.current}/${job.total}`,
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

  return router;
}
