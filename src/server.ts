import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs/promises";
import { DataService, Project, Card } from "./lib/data_service";
import { ImageGenerator } from "./lib/image_generator";
import { exiftool } from "exiftool-vendored";

dotenv.config();

const app = express();
const PORT = 5432;

app.use(cors());
app.use(express.json());

const dataService = new DataService();
// Renamed for clarity in the new endpoint
const projectService = dataService;
const cardService = dataService;

// Config API Key (Naive in-memory for now, or use ENV)
let API_KEY = process.env.GEMINI_API_KEY || "";

// Serve Static Frontend
// In dev (ts-node), __dirname is src/. In built (node), it's dist/.
// We need to find where 'public' actually lives.
import fsSync from "fs";

// Path resolution strategy:
// 1. dist/public (If copied during build)
// 2. ../src/public (ASAR structure: dist/server.js -> ../src/public)
// 3. process.cwd()/src/public (Dev mode fallback)

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
// For data, strictly use process.cwd() in dev, but in prod we might need userData.
// For now, let's assume relative to CWD works for 'local' app usage.
app.use("/data", express.static(path.join(process.cwd(), "data")));

// Helper: Secure Path Resolution
function resolveSecurePath(segments: string[]): string | null {
  const root = path.resolve(__dirname, "../data/output");
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
  // Mask keys for security in UI list if preferred, but for local tool maybe show them
  // showing them for now
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

// Cards

app.post("/api/cards", async (req, res) => {
  const card: Card = req.body;
  await dataService.saveCard(card);
  res.json({ success: true, card });
});

// Generate
app.post("/api/generate", async (req, res) => {
  const { cardId, projectId, count, promptOverride, arOverride, resOverride } =
    req.body;

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
  const SAFE_OUTPUT_BASE = path.resolve(process.cwd(), "data/output");

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

  // Security Check: Ensure the resolved path is still within the safe base directory
  if (!outputFolder.startsWith(SAFE_OUTPUT_BASE)) {
    res.status(403).json({
      error: "Security Error: Output path must be within data/output",
    });
    return;
  }

  const results = [];

  try {
    const num = count || 1;
    // Hierarchy: API Override > Card > Project > Default
    const aspectRatio =
      arOverride || card.aspectRatio || project.defaultAspectRatio || "2:3";
    let resolution =
      resOverride || card.resolution || project.defaultResolution || "2K";

    // Safety check against empty strings if UI sends ""
    if (!aspectRatio) resolution = "2K"; // Fallback if logic above failed somehow, but || covers it

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
      const relativePath = path.relative(process.cwd(), savedPath);
      results.push(relativePath);
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
            process.cwd(),
            "data/output",
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

    // Resolve path securely
    // Path structure: data/output/<projectOutputRoot>/<cardOutputSubfolder>
    const subfolder = card.outputSubfolder || "default";
    // We need to resolve relative to data/output.
    // project.outputRoot is already declared as relative to data/output in the walkthrough/UI prompt.
    // Let's ensure compliance.

    const securePath = resolveSecurePath([project.outputRoot, subfolder]);
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
      // Sort by modification time desc? Or name desc (versions)?
      // Let's sort by name desc (v005, v004...)
      .sort((a: string, b: string) =>
        b.localeCompare(a, undefined, { numeric: true })
      )
      .map((f: string) => {
        // Construct the accessible URL path
        // served at /data/...
        // The securePath is absolute. We need relative to "data" folder.
        // securePath is <...>/ai-art-cards/data/output/tarot/folder
        // We want /data/output/tarot/folder/file.png

        // Easier: construct form known parts if we trust them, but let's be robust.
        // We know we are serving `../data` at `/data`.
        // So we need path relative to `../data`.
        const dataRoot = path.resolve(__dirname, "../data");
        const relative = path.relative(dataRoot, path.join(securePath, f));
        return `data/${relative}`;
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
    const SAFE_OUTPUT_BASE = path.resolve(process.cwd(), "data/output");
    const fullPath = path.resolve(process.cwd(), relativePath);

    if (!fullPath.startsWith(SAFE_OUTPUT_BASE)) {
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

// Start
// Export for Electron
export async function startServer() {
  return new Promise<void>((resolve) => {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
      resolve();
    });
  });
}

// Auto-start if run directly
if (require.main === module) {
  startServer();
}
