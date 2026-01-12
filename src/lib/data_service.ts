import fs from "fs/promises";
import path from "path";
import { logger } from "./logger";

export interface Card {
  id: string;
  projectId: string;
  name: string;
  prompt: string;
  outputSubfolder: string;
  aspectRatio?: string;
  resolution?: string;
  archivedImages?: string[];
  favoriteImages?: string[];
}

export interface Project {
  id: string;
  name: string;
  description: string;
  globalPrefix: string;
  globalSuffix: string;
  outputRoot: string;
  /** Sequentially increasing counter for card IDs */
  nextCardIndex?: number;
  defaultAspectRatio: string;
  defaultResolution?: string;
  cards?: Card[];
}

export interface StoredKey {
  name: string;
  key: string;
}

// Default paths relative to __dirname for dev/backward compatibility
const DEFAULT_PROJECTS_DIR = path.join(__dirname, "../../data/projects");
const DEFAULT_CARDS_DIR = path.join(__dirname, "../../data/cards");
const DEFAULT_KEYS_FILE = path.join(__dirname, "../../data/keys.json");

export class DataService {
  private projectsDir: string;
  private cardsDir: string;
  private keysFile: string;

  constructor(dataRoot?: string) {
    if (dataRoot) {
      this.projectsDir = path.join(dataRoot, "projects");
      this.cardsDir = path.join(dataRoot, "cards");
      this.keysFile = path.join(dataRoot, "keys.json");
    } else {
      this.projectsDir = DEFAULT_PROJECTS_DIR;
      this.cardsDir = DEFAULT_CARDS_DIR;
      this.keysFile = DEFAULT_KEYS_FILE;
    }
    this.ensureDirs();
  }

  // Helper ensure dirs
  private async ensureDirs() {
    logger.info(
      `[DataService] Ensuring directories exist: ${this.projectsDir}, ${this.cardsDir}`
    );
    await fs.mkdir(this.projectsDir, { recursive: true });
    await fs.mkdir(this.cardsDir, { recursive: true });
  }

  // --- Projects ---
  async getProjects(): Promise<Project[]> {
    try {
      const files = await fs.readdir(this.projectsDir);
      const projects: Project[] = [];
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const data = JSON.parse(
          await fs.readFile(path.join(this.projectsDir, f), "utf-8")
        );
        projects.push(data);
      }
      return projects;
    } catch {
      return [];
    }
  }

  async saveProject(project: Project): Promise<void> {
    logger.info(
      `[DataService] Saving project: ${project.id} (${project.name})`
    );
    await this.ensureDirs();
    await fs.writeFile(
      path.join(this.projectsDir, `${project.id}.json`),
      JSON.stringify(project, null, 2)
    );
  }

  // --- Cards ---

  /**
   * Generates a new sequential ID for a card in the given project.
   * Format: NNNN_card_RANDOM
   */
  async generateCardId(projectId: string): Promise<string> {
    const project = await this.getProject(projectId);
    if (!project) throw new Error("Project not found");

    const index = project.nextCardIndex || 1;
    project.nextCardIndex = index + 1;
    await this.saveProject(project);

    // Random suffix to ensure global uniqueness even if index resets somehow (though it shouldn't)
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const prefix = String(index).padStart(4, "0");

    return `${prefix}_card_${randomSuffix}`;
  }

  async getCards(projectId: string): Promise<Card[]> {
    try {
      logger.info(`[DataService] Loading cards for project: ${projectId}`);
      const projectCardDir = path.join(this.cardsDir, projectId);
      try {
        await fs.access(projectCardDir);
      } catch {
        return [];
      }

      const files = await fs.readdir(projectCardDir);
      const cards: Card[] = [];
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const data = JSON.parse(
          await fs.readFile(path.join(projectCardDir, f), "utf-8")
        );
        cards.push(data);
      }

      // Sort cards by ID (alphabetical), which will now be chronological due to prefix
      return cards.sort((a, b) => a.id.localeCompare(b.id));
    } catch {
      return [];
    }
  }

  async saveCard(card: Card): Promise<void> {
    logger.info(
      `[DataService] Saving card: ${card.id} in project: ${card.projectId}`
    );
    await this.ensureDirs();
    const projectCardDir = path.join(this.cardsDir, card.projectId);
    await fs.mkdir(projectCardDir, { recursive: true });

    await fs.writeFile(
      path.join(projectCardDir, `${card.id}.json`),
      JSON.stringify(card, null, 2)
    );
  }

  async getProject(id: string): Promise<Project | null> {
    try {
      const data = await fs.readFile(
        path.join(this.projectsDir, `${id}.json`),
        "utf-8"
      );
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  // --- Keys ---
  async getKeys(): Promise<StoredKey[]> {
    try {
      const data = await fs.readFile(this.keysFile, "utf-8");
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  async saveKey(name: string, key: string): Promise<void> {
    logger.info(`[DataService] Saving API key: ${name}`);
    await this.ensureDirs();
    const keys = await this.getKeys();
    // Check if exists, update or push
    const existing = keys.find((k) => k.name === name);
    if (existing) {
      existing.key = key;
    } else {
      keys.push({ name, key });
    }
    await fs.writeFile(this.keysFile, JSON.stringify(keys, null, 2));
  }

  // --- Deletion ---
  async deleteProject(id: string): Promise<void> {
    logger.info(`[DataService] Deleting project: ${id}`);
    // 1. Delete project json
    await fs.rm(path.join(this.projectsDir, `${id}.json`), { force: true });
    // 2. Delete cards dir for project
    await fs.rm(path.join(this.cardsDir, id), { recursive: true, force: true });
    // 3. User must handle output dir deletion manually?
    // DataService only manages the metadata files technically, but it's convenient to do it here.
    // However, DataService doesn't know "resolvedDataRoot" easily unless we passed it.
    // We did pass dataRoot in constructor.
    // And we have this.projectsDir = dataRoot/projects.
    // So output should be dataRoot/output.
    // But let's check if output structure is standard.
    // Project has outputRoot.
  }

  async deleteCard(projectId: string, cardId: string): Promise<void> {
    logger.info(
      `[DataService] Deleting card: ${cardId} in project: ${projectId}`
    );
    await fs.rm(path.join(this.cardsDir, projectId, `${cardId}.json`), {
      force: true,
    });
  }

  // --- Temp Image Cache ---
  async saveTempImage(
    buffer: Buffer,
    mimeType: string
  ): Promise<{ id: string; path: string }> {
    const cacheDir = path.join(this.projectsDir, "../cache"); // data/cache
    await fs.mkdir(cacheDir, { recursive: true });

    const id =
      Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const ext = mimeType.split("/")[1] || "bin";
    const filename = `${id}.${ext}`;
    const filePath = path.join(cacheDir, filename);

    await fs.writeFile(filePath, buffer);
    return { id, path: filePath };
  }

  async getTempImage(id: string): Promise<Buffer | null> {
    const cacheDir = path.join(this.projectsDir, "../cache");
    const files = await fs.readdir(cacheDir);
    const file = files.find((f) => f.startsWith(`${id}.`));
    if (!file) return null;
    return fs.readFile(path.join(cacheDir, file));
  }

  async deleteTempImage(id: string): Promise<void> {
    const cacheDir = path.join(this.projectsDir, "../cache");
    try {
      const files = await fs.readdir(cacheDir);
      const file = files.find((f) => f.startsWith(`${id}.`));
      if (file) {
        await fs.unlink(path.join(cacheDir, file));
        logger.info(`[DataService] Deleted temp image: ${file}`);
      }
    } catch (e) {
      logger.warn(`[DataService] Failed to delete temp image ${id}:`, e);
    }
  }
}
