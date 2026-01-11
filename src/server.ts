import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs/promises";
import { DataService, Project, Card } from "./lib/data_service";
import { ImageGenerator } from "./lib/image_generator";
import { exiftool } from "exiftool-vendored";

dotenv.config();

import fsSync from "fs";

// Wrapper to create App with config
export function createApp(dataRoot?: string) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Data Path Setup
  // If dataRoot is provided, use it. Otherwise default to repo structure.
  const resolvedDataRoot = dataRoot
    ? path.resolve(dataRoot)
    : path.join(process.cwd(), "data");

  const projectsDir = path.join(resolvedDataRoot, "projects");
  const cardsDir = path.join(resolvedDataRoot, "cards");
  const outputDir = path.join(resolvedDataRoot, "output");

  console.log(`Initializing DataService with root: ${resolvedDataRoot}`);
  const dataService = new DataService(resolvedDataRoot);
  // Renamed for clarity in the new endpoint
  const projectService = dataService;
  const cardService = dataService;

  // Config API Key (Naive in-memory for now, or use ENV)
  let API_KEY = process.env.GEMINI_API_KEY || "";

  // Serve Static Frontend
  // In dev (ts-node), __dirname is src/. In built (node), it's dist/.
  // We need to find where 'public' actually lives.
  const possiblePaths = [
    path.join(__dirname, "public"),
    path.join(__dirname, "../src/public"),
    path.join(process.cwd(), "src", "public"),
  ];

  let publicDir = possiblePaths.find((p) => fsSync.existsSync(p));
  if (!publicDir) {
    console.error(
      "CRITICAL: Could not find 'public' directory. Checked:",
      possiblePaths
    );
    publicDir = path.join(__dirname, "public"); // Fallback to avoid crash
  }

  console.log(`Serving static files from: ${publicDir}`);

  app.use(express.static(publicDir));

  // Serve static data (images, jsons)
  // Serve /data from the resolved data root
  app.use("/data", express.static(resolvedDataRoot));

  // Helper: Secure Path Resolution
  function resolveSecurePath(segments: string[]): string | null {
    // Relative to outputDir
    const root = outputDir;
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
      res.json({ success: true });
    } else {
      res.status(400).json({ error: "Missing apiKey" });
    }
  });

  app.get("/api/keys", async (req, res) => {
    const keys = await dataService.getKeys();
    res.json(keys);
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

      // Delete Metadata
      await dataService.deleteProject(id);

      // Delete Output Files
      if (p.outputRoot) {
        const outPath = path.join(outputDir, p.outputRoot);
        // Security check: ensure it is within outputDir
        if (outPath.startsWith(outputDir) && outPath !== outputDir) {
          await fs.rm(outPath, { recursive: true, force: true });
        }
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Cards

  app.post("/api/cards", async (req, res) => {
    const card: Card = req.body;
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
      if (project && project.outputRoot && card.outputSubfolder) {
        const outPath = path.join(
          outputDir,
          project.outputRoot,
          card.outputSubfolder
        );
        // Security check
        if (outPath.startsWith(outputDir) && outPath !== outputDir) {
          await fs.rm(outPath, { recursive: true, force: true });
        }
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Generate
  app.post("/api/generate", async (req, res) => {
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
    const promptToUse =
      promptOverride !== undefined ? promptOverride : card.prompt;
    const fullPrompt = `${project.globalPrefix} ${promptToUse} ${project.globalSuffix}`;

    console.log("------------------------------------------------");
    console.log("Generating Art for Card:", card.name);
    console.log("Full Prompt:", fullPrompt);
    console.log("------------------------------------------------");

    // Resolve output folder - SECURE
    // Use outputDir from closure
    const SAFE_OUTPUT_BASE = outputDir;

    // Clean relative paths to prevent directory traversal
    const projectDir = (project.outputRoot || "default").replace(
      /^(\.\.(\/|\\|$))+/,
      ""
    );
    const cardDir = (card.outputSubfolder || "default").replace(
      /^(\.\.(\/|\\|$))+/,
      ""
    );

    const outputFolder = path.resolve(SAFE_OUTPUT_BASE, projectDir, cardDir);

    // Security Check
    if (!outputFolder.startsWith(SAFE_OUTPUT_BASE)) {
      res.status(403).json({
        error: "Security Error: Output path must be within data/output",
      });
      return;
    }

    const results = [];

    try {
      const num = count || 1;
      const aspectRatio =
        arOverride || card.aspectRatio || project.defaultAspectRatio || "2:3";
      let resolution =
        resOverride || card.resolution || project.defaultResolution || "2K";

      if (!aspectRatio) resolution = "2K";

      console.log(`Config: AR=${aspectRatio}, Res=${resolution}`);

      for (let i = 0; i < num; i++) {
        const { buffer, mimeType } = await generator.generateImageBuffer(
          fullPrompt,
          {
            aspectRatio,
            resolution,
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
        // Currently frontend expects path relative to CWD roughly?
        // The frontend receives a string.
        // In the old code: path.relative(process.cwd(), savedPath)
        // If we serve /data -> resolvedDataRoot
        // Then we should return paths compatible with that.
        // e.g. "data/output/foo/bar.png"

        const relToRoot = path.relative(resolvedDataRoot, savedPath);
        // We serve resolvedDataRoot at /data
        const webPath = path.join("data", relToRoot);
        results.push(webPath);
      }
      res.json({ success: true, images: results });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
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
            const outDir = path.resolve(
              outputDir,
              project?.outputRoot || "default",
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

  app.get("/api/projects/:projectId/cards/:cardId/images", async (req, res) => {
    const { projectId, cardId } = req.params;
    try {
      const project = await projectService.getProject(projectId);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const cards = await cardService.getCards(projectId);
      const card = cards.find((c) => c.id === cardId);
      if (!card) return res.status(404).json({ error: "Card not found" });

      const subfolder = card.outputSubfolder || "default";
      const securePath = resolveSecurePath([
        project.outputRoot || "default",
        subfolder,
      ]);
      if (!securePath) return res.status(403).json({ error: "Access denied" });

      // Check if dir exists
      try {
        await fs.access(securePath);
      } catch {
        return res.json([]); // No directory, so no images. return empty.
      }

      const files = await fs.readdir(securePath);
      const images = files
        .filter((f: string) => /\.(png|jpg|jpeg|webp)$/i.test(f))
        .filter((f) => !(card.archivedImages || []).includes(f))
        .sort((a: string, b: string) =>
          b.localeCompare(a, undefined, { numeric: true })
        )
        .map((f: string) => {
          // We serve resolvedDataRoot at /data
          // securePath is <dataRoot>/output/...
          // We want "data/output/..."
          const rel = path.relative(resolvedDataRoot, path.join(securePath, f));
          return path.join("data", rel);
        });

      res.json(images);
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
      const SAFE_OUTPUT_BASE = outputDir;
      // relativePath comes from frontend as "data/output/..."
      // We need to resolve it relative to... CWD? No, relative to data root?
      // Frontend sends what we gave it: "data/output/..."
      // But we are mapping "/data" -> resolvedDataRoot
      // So if path starts with "data/", strip it?

      let filePathOnDisk = "";
      if (relativePath.startsWith("data/")) {
        const stripped = relativePath.substring(5); // remove 'data/'
        filePathOnDisk = path.join(resolvedDataRoot, stripped);
      } else {
        // Fallback or error?
        filePathOnDisk = path.resolve(process.cwd(), relativePath);
      }

      const fullPath = path.resolve(filePathOnDisk);

      if (!fullPath.startsWith(SAFE_OUTPUT_BASE)) {
        // Strict check: must be in output
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
      console.error("Metadata error:", e);
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
      if (!card.archivedImages.includes(filename)) {
        card.archivedImages.push(filename);
        await cardService.saveCard(card);
      }
      res.json({ success: true });
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

  return app;
}

// Start
// Export for Electron
export async function startServer(port: number = 5432, dataRoot?: string) {
  const app = createApp(dataRoot);
  return new Promise<void>((resolve) => {
    app.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
      resolve();
    });
  });
}

// Auto-start if run directly
if (require.main === module) {
  startServer(5432);
}
