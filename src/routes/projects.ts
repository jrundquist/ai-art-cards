import { Router } from "express";
import { DataService, Project } from "../lib/data_service";
import path from "path";
import fs from "fs/promises";
import archiver from "archiver";

export function createProjectsRouter(
  dataService: DataService,
  resolvedDataRoot: string,
) {
  const router = Router();

  router.get("/projects", async (req, res) => {
    res.json(await dataService.getProjects());
  });

  router.post("/projects", async (req, res) => {
    const project: Project = req.body;
    await dataService.saveProject(project);
    res.json({ success: true, project });
  });

  router.delete("/projects/:id", async (req, res) => {
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

  // Get Project Preview Images (recent images across all cards)
  router.get("/projects/:projectId/previews", async (req, res) => {
    const { projectId } = req.params;
    try {
      const project = await dataService.getProject(projectId);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const cards = await dataService.getCards(projectId);
      const allImages: { path: string; time: Date }[] = [];

      // Collect images from all cards
      for (const card of cards) {
        // Construct asset path: data/projects/{projectId}/assets/{subfolder}
        const outDir = path.join(
          resolvedDataRoot,
          "projects",
          projectId,
          "assets",
          card.outputSubfolder || "default",
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

  // Export Deck (Starred Images only)
  router.get("/projects/:id/export-deck", async (req, res) => {
    const { id } = req.params;
    try {
      const project = await dataService.getProject(id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const cards = await dataService.getCards(id);

      const zipName = (project.outputRoot || project.id) + ".zip";
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

      const archive = archiver("zip", { zlib: { level: 9 } });

      archive.on("error", (err) => {
        throw err;
      });

      archive.pipe(res);

      for (const card of cards) {
        if (card.starredImage) {
          const subfolder = card.outputSubfolder || "default";
          const imagePath = path.join(
            resolvedDataRoot,
            "projects",
            id,
            "assets",
            subfolder,
            card.starredImage,
          );

          try {
            await fs.access(imagePath);
            const ext = path.extname(card.starredImage);
            // Filename is {outputSubfolder}.{ext} as requested
            // If colliding, archiver might handle it or overwrite? Archiver appends.
            // But user requirement implies uniqueness or simple naming.
            // If outputSubfolder is empty/default, we might get collisions "default.jpg".
            // We'll trust the requirement for now: "filename ... should be the card {outputSubfolder}.{ext}"
            const nameInZip = (card.outputSubfolder || card.id) + ext;

            archive.file(imagePath, { name: nameInZip });
          } catch {
            // Skip missing files
          }
        }
      }

      await archive.finalize();
    } catch (e: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: e.message });
      }
    }
  });

  return router;
}
