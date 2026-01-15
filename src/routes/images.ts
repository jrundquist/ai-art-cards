import { Router } from "express";
import { DataService } from "../lib/data_service";
import path from "path";
import fs from "fs/promises";
import { exiftool } from "exiftool-vendored";
import { logger } from "../lib/logger";

export function createImagesRouter(
  dataService: DataService,
  resolvedDataRoot: string
) {
  const router = Router();

  // Helper: Resolve Reference Image URL
  router.get("/ref-image/:projectId/:cardId/:filename", async (req, res) => {
    const { projectId, cardId, filename } = req.params;
    try {
      const cards = await dataService.getCards(projectId);
      const card = cards.find((c) => c.id === cardId);

      if (!card) {
        return res.status(404).json({ error: "Card not found" });
      }

      const subfolder = card.outputSubfolder || "default";
      // Construct the static path served by /data
      // Path format: /data/projects/{projectId}/assets/{subfolder}/{filename}
      const staticUrl = `/data/projects/${projectId}/assets/${subfolder}/${filename}`;

      res.redirect(staticUrl);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Image Metadata
  router.get("/image-metadata", async (req, res) => {
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

  router.get("/projects/:projectId/cards/:cardId/images", async (req, res) => {
    const { projectId, cardId } = req.params;
    try {
      const project = await dataService.getProject(projectId);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const cards = await dataService.getCards(projectId);
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

  return router;
}
