import { Router } from "express";
import { DataService, Card } from "../lib/data_service";
import path from "path";
import fs from "fs/promises";
import { logger } from "../lib/logger";
import archiver from "archiver";

export function createCardsRouter(
  dataService: DataService,
  resolvedDataRoot: string,
) {
  const router = Router();

  router.post("/cards", async (req, res) => {
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

  // Get Cards (Enriched with counts)
  router.get("/projects/:projectId/cards", async (req, res) => {
    try {
      const cards = await dataService.getCards(req.params.projectId);

      // Enrich with counts
      const enriched = await Promise.all(
        cards.map(async (c) => {
          try {
            // Construct asset path: data/projects/{projectId}/assets/{subfolder}
            const outDir = path.join(
              resolvedDataRoot,
              "projects",
              req.params.projectId,
              "assets",
              c.outputSubfolder || "default",
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
        }),
      );

      res.json(enriched);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/projects/:projectId/cards/:cardId", async (req, res) => {
    const { projectId, cardId } = req.params;
    try {
      const project = await dataService.getProject(projectId);
      const cards = await dataService.getCards(projectId);
      const card = cards.find((c) => c.id === cardId);

      if (!card) return res.status(404).json({ error: "Card not found" });

      // Delete Metadata
      await dataService.deleteCard(projectId, cardId);

      // Delete Output Files
      // Path: data/projects/{projectId}/assets/{cardSubfolder}
      if (card.outputSubfolder) {
        const outPath = path.join(
          resolvedDataRoot,
          "projects",
          projectId,
          "assets",
          card.outputSubfolder,
        );
        logger.info(
          `[Server] Attempting to delete card output directory: ${outPath}`,
        );
        // Security check
        if (
          outPath.startsWith(path.join(resolvedDataRoot, "projects", projectId))
        ) {
          await fs.rm(outPath, { recursive: true, force: true });
          logger.info(`[Server] Card output directory deleted.`);
        } else {
          logger.warn(
            `[Server] Card output directory outside project dir, skipping deletion: ${outPath}`,
          );
        }
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Delete Image (Permanent)
  router.delete(
    "/projects/:projectId/cards/:cardId/images/:filename",
    async (req, res) => {
      const { projectId, cardId, filename } = req.params;

      try {
        const cards = await dataService.getCards(projectId);
        const card = cards.find((c) => c.id === cardId);
        if (!card) return res.status(404).json({ error: "Card not found" });

        // Security check for filename
        if (filename.includes("/") || filename.includes("\\")) {
          return res.status(400).json({ error: "Invalid filename" });
        }

        // 1. Delete the file from filesystem
        if (card.outputSubfolder) {
          const filePath = path.join(
            resolvedDataRoot,
            "projects",
            projectId,
            "assets",
            card.outputSubfolder,
            filename,
          );

          // Security Check: verify path is inside project assets
          const expectedRoot = path.join(
            resolvedDataRoot,
            "projects",
            projectId,
            "assets",
          );
          if (!filePath.startsWith(expectedRoot)) {
            return res.status(403).json({ error: "Access denied" });
          }

          try {
            await fs.unlink(filePath);
            logger.info(`[Server] Deleted image file: ${filePath}`);
          } catch (err: any) {
            if (err.code === "ENOENT") {
              logger.warn(
                `[Server] Image file not found to delete: ${filePath}`,
              );
              // Continue to clean up metadata even if file is gone
            } else {
              throw err;
            }
          }
        }

        // 2. Clean up metadata
        let modified = false;

        // Remove from archivedImages
        if (card.archivedImages && card.archivedImages.includes(filename)) {
          card.archivedImages = card.archivedImages.filter(
            (f) => f !== filename,
          );
          modified = true;
        }

        // Remove from favoriteImages
        if (card.favoriteImages && card.favoriteImages.includes(filename)) {
          card.favoriteImages = card.favoriteImages.filter(
            (f) => f !== filename,
          );
          modified = true;
        }

        // Remove from starredImage
        if (card.starredImage === filename) {
          card.starredImage = undefined;
          modified = true;
        }

        // Remove from referenceImageFiles (optional, but good practice if it was a ref)
        // Note: references are stored as objects { filename: ... }
        // We probably shouldn't break history for other generations, but if the source is gone...
        // Let's leave references alone for now as they are historical records of what was used.
        // But if we wanted to be strict:
        /*
      if (card.generationArgs?.referenceImageFiles) {
         // ... custom logic ...
      }
      */

        if (modified) {
          await dataService.saveCard(card);
        }

        res.json({ success: true });
      } catch (e: any) {
        logger.error(`[Server] Error deleting image: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },
  );

  // Archive Image (Deprecated/Restored for backward compatibility if needed, but we are removing UI access)
  router.post("/cards/:cardId/archive", async (req, res) => {
    const { cardId } = req.params;
    const { projectId, filename } = req.body;

    try {
      const cards = await dataService.getCards(projectId);
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

      await dataService.saveCard(card);
      res.json({ success: true, isArchived });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Toggle Favorite
  router.post("/cards/:cardId/favorite", async (req, res) => {
    const { cardId } = req.params;
    const { projectId, filename } = req.body;

    try {
      const cards = await dataService.getCards(projectId);
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

      await dataService.saveCard(card);
      res.json({ success: true, isFavorite });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Toggle Star
  router.post("/cards/:cardId/star", async (req, res) => {
    const { cardId } = req.params;
    const { projectId, filename } = req.body;

    try {
      const cards = await dataService.getCards(projectId);
      const card = cards.find((c) => c.id === cardId);
      if (!card) return res.status(404).json({ error: "Card not found" });

      if (!card.favoriteImages) card.favoriteImages = [];

      let isStarred = false;
      let isFavorite = card.favoriteImages.includes(filename);

      if (card.starredImage === filename) {
        // Unstar -> Favorite
        card.starredImage = undefined;
        isStarred = false;

        // Ensure it is a favorite
        if (!isFavorite) {
          card.favoriteImages.push(filename);
          isFavorite = true;
        }
      } else {
        // Handle OLD star if exists (it gets unstarred, so it should become favorite)
        if (card.starredImage) {
          if (!card.favoriteImages.includes(card.starredImage)) {
            card.favoriteImages.push(card.starredImage);
          }
        }

        // Star the new one
        card.starredImage = filename;
        isStarred = true;

        // Remove new star from favorites (enforce either-or)
        const idx = card.favoriteImages.indexOf(filename);
        if (idx > -1) {
          card.favoriteImages.splice(idx, 1);
          isFavorite = false;
        }
      }

      await dataService.saveCard(card);
      res.json({
        success: true,
        isStarred,
        isFavorite,
        starredImage: card.starredImage,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Download Gallery Images as Zip
  router.post("/cards/:cardId/download-zip", async (req, res) => {
    const { cardId } = req.params;
    const { projectId, filenames } = req.body;

    try {
      const project = await dataService.getProject(projectId);
      const cards = await dataService.getCards(projectId);
      const card = cards.find((c) => c.id === cardId);

      if (!project || !card) {
        return res.status(404).json({ error: "Project or Card not found" });
      }

      // Output subfolder
      const cardSubfolder = card.outputSubfolder || "default";
      const assetsDir = path.join(
        resolvedDataRoot,
        "projects",
        projectId,
        "assets",
        cardSubfolder,
      );

      // Create archive
      const archive = archiver("zip", {
        zlib: { level: 9 }, // Sets the compression level.
      });

      res.attachment(`${card.name.replace(/[^a-z0-9]/gi, "_")}_images.zip`);

      archive.on("error", (err) => {
        logger.error("[Server] Zip Error:", err);
        res.status(500).send({ error: err.message });
      });

      archive.pipe(res);

      if (Array.isArray(filenames)) {
        for (const filename of filenames) {
          const filePath = path.join(assetsDir, filename);
          // Check exist
          try {
            await fs.access(filePath);
            archive.file(filePath, { name: filename });
          } catch {
            logger.warn(`[Server] Skip zip file not found: ${filePath}`);
          }
        }
      }

      await archive.finalize();
    } catch (e: any) {
      logger.error("[Server] Zip gen error:", e);
      // If header sent, we can't send json error, but logging helps
      if (!res.headersSent) {
        res.status(500).json({ error: e.message });
      }
    }
  });

  return router;
}
