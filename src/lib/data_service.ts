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
  // Previously separate dirs, now we mainly track the root "projects" dir
  // and resolve everything relative to specific project folders.
  private legacyCardsDir: string; // for migration
  private legacyKeysFile: string; // for migration
  private dataRoot: string;

  constructor(dataRoot?: string) {
    if (dataRoot) {
      this.dataRoot = dataRoot;
      this.projectsDir = path.join(dataRoot, "projects");
      this.legacyCardsDir = path.join(dataRoot, "cards");
      this.legacyKeysFile = path.join(dataRoot, "keys.json");
    } else {
      this.dataRoot = path.join(__dirname, "../../data");
      this.projectsDir = DEFAULT_PROJECTS_DIR;
      this.legacyCardsDir = DEFAULT_CARDS_DIR;
      this.legacyKeysFile = DEFAULT_KEYS_FILE;
    }
  }

  // Helper ensure dirs
  private async ensureDirs() {
    // Only need to ensure the main projects directory exists
    await fs.mkdir(this.projectsDir, { recursive: true });
  }

  // --- Migration ---
  async migrate() {
    await this.ensureDirs();

    // Check for legacy keys file
    try {
      await fs.access(this.legacyKeysFile);
      logger.info(
        `[Migration] Legacy keys file found. It will be kept as is for now.`
      );
      // We might want to move it to dataRoot/keys.json if it's not there already,
      // but current logic uses it centrally, so it's fine.
    } catch {}

    // Check for legacy project files (json files directly in projectsDir)
    try {
      const files = await fs.readdir(this.projectsDir);
      for (const f of files) {
        if (f.endsWith(".json")) {
          const projectId = f.replace(".json", "");
          logger.info(`[Migration] Migrating project: ${projectId}`);

          const projectJsonPath = path.join(this.projectsDir, f);
          const projectData = JSON.parse(
            await fs.readFile(projectJsonPath, "utf-8")
          );

          // 1. Create new project folder
          const newProjectDir = path.join(this.projectsDir, projectId);
          await fs.mkdir(newProjectDir, { recursive: true });

          // 2. Move project.json
          await fs.rename(
            projectJsonPath,
            path.join(newProjectDir, "project.json")
          );

          // 3. Move Cards
          const legacyProjectCardDir = path.join(
            this.legacyCardsDir,
            projectId
          );
          const newCardsDir = path.join(newProjectDir, "cards");
          try {
            await fs.access(legacyProjectCardDir);
            await fs.rename(legacyProjectCardDir, newCardsDir);
            logger.info(`[Migration] Moved cards for ${projectId}`);
          } catch {
            // No cards or already moved
          }

          // 4. Move Conversations
          const legacyConvDir = path.join(
            this.dataRoot,
            "conversations",
            projectId
          );
          const newConvDir = path.join(newProjectDir, "conversations");
          try {
            await fs.access(legacyConvDir);
            await fs.rename(legacyConvDir, newConvDir);
            logger.info(`[Migration] Moved conversations for ${projectId}`);
          } catch {
            // No convs
          }

          // Cleanup legacy conversations parent dir if empty
          try {
            await fs.rmdir(path.join(this.dataRoot, "conversations"));
          } catch {}

          // 5. Move Assets (Output)
          // Project likely has an outputRoot.
          // OLD: data/output/{outputRoot}
          // NEW: data/projects/{projectId}/assets
          // If outputRoot was defined, we try to move it.
          if (projectData.outputRoot) {
            const oldOutputPath = path.join(
              this.dataRoot,
              "output",
              projectData.outputRoot
            );
            const newAssetsPath = path.join(newProjectDir, "assets");

            try {
              await fs.access(oldOutputPath);
              await fs.rename(oldOutputPath, newAssetsPath);
              logger.info(
                `[Migration] Moved assets from ${oldOutputPath} to ${newAssetsPath}`
              );
            } catch (e) {
              logger.warn(
                `[Migration] Could not move assets for ${projectId}:`,
                e
              );
            }

            // Cleanup legacy output parent dir if empty
            // (Only if we moved the last one, hard to know, so skip for now)
          }

          logger.info(`[Migration] Project ${projectId} migration complete.`);
        }
      }
    } catch (e) {
      logger.error("[Migration] Error during migration scan:", e);
    }
  }

  // --- Projects ---
  async getProjects(): Promise<Project[]> {
    await this.ensureDirs();
    try {
      const entries = await fs.readdir(this.projectsDir, {
        withFileTypes: true,
      });
      const projects: Project[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Look for project.json inside
          try {
            const pPath = path.join(
              this.projectsDir,
              entry.name,
              "project.json"
            );
            const data = JSON.parse(await fs.readFile(pPath, "utf-8"));
            projects.push(data);
          } catch {
            // Not a project dir or unreadable
          }
        }
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
    const projectDir = path.join(this.projectsDir, project.id);
    await fs.mkdir(projectDir, { recursive: true });

    await fs.writeFile(
      path.join(projectDir, "project.json"),
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
      // New Path: data/projects/{projectId}/cards
      const projectCardDir = path.join(this.projectsDir, projectId, "cards");

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
    // New Path: data/projects/{projectId}/cards
    const projectCardDir = path.join(this.projectsDir, card.projectId, "cards");
    await fs.mkdir(projectCardDir, { recursive: true });

    await fs.writeFile(
      path.join(projectCardDir, `${card.id}.json`),
      JSON.stringify(card, null, 2)
    );
  }

  async getProject(id: string): Promise<Project | null> {
    try {
      const data = await fs.readFile(
        path.join(this.projectsDir, id, "project.json"),
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
      const data = await fs.readFile(this.legacyKeysFile, "utf-8"); // Keeping central keys for now
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  async saveKey(name: string, key: string): Promise<void> {
    logger.info(`[DataService] Saving API key: ${name}`);
    await this.ensureDirs();
    // Keys file might need its own dir if we removed legacyCardsDir
    await fs.mkdir(path.dirname(this.legacyKeysFile), { recursive: true });

    const keys = await this.getKeys();
    // Check if exists, update or push
    const existing = keys.find((k) => k.name === name);
    if (existing) {
      existing.key = key;
    } else {
      keys.push({ name, key });
    }
    await fs.writeFile(this.legacyKeysFile, JSON.stringify(keys, null, 2));
  }

  // --- Deletion ---
  async deleteProject(id: string): Promise<void> {
    logger.info(`[DataService] Deleting project: ${id}`);
    // Simply delete the project folder
    await fs.rm(path.join(this.projectsDir, id), {
      recursive: true,
      force: true,
    });
  }

  async deleteCard(projectId: string, cardId: string): Promise<void> {
    logger.info(
      `[DataService] Deleting card: ${cardId} in project: ${projectId}`
    );
    await fs.rm(
      path.join(this.projectsDir, projectId, "cards", `${cardId}.json`),
      {
        force: true,
      }
    );
  }

  // --- Temp Image Cache ---
  async saveTempImage(
    buffer: Buffer,
    mimeType: string,
    projectId?: string
  ): Promise<{ id: string; path: string }> {
    let cacheDir: string;

    if (projectId) {
      cacheDir = path.join(this.projectsDir, projectId, "cache");
    } else {
      // Fallback global cache
      cacheDir = path.join(this.dataRoot, "cache");
    }

    await fs.mkdir(cacheDir, { recursive: true });

    const id =
      Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const ext = mimeType.split("/")[1] || "bin";
    const filename = `${id}.${ext}`;
    const filePath = path.join(cacheDir, filename);

    await fs.writeFile(filePath, buffer);
    return { id, path: filePath };
  }

  async getTempImage(id: string, projectId?: string): Promise<Buffer | null> {
    // Try project cache first if projectId provided
    if (projectId) {
      const pCache = path.join(this.projectsDir, projectId, "cache");
      try {
        const files = await fs.readdir(pCache);
        const file = files.find((f) => f.startsWith(`${id}.`));
        if (file) return fs.readFile(path.join(pCache, file));
      } catch {}
    }

    // Try global cache
    const cacheDir = path.join(this.dataRoot, "cache");
    try {
      const files = await fs.readdir(cacheDir);
      const file = files.find((f) => f.startsWith(`${id}.`));
      if (file) return fs.readFile(path.join(cacheDir, file));
    } catch {
      return null;
    }

    // Also try to find it in ANY project cache?
    // Might be expensive. For now, assume if projectId not passed, check global.
    // Ideally we always pass projectId.

    return null;
  }

  async deleteTempImage(id: string, projectId?: string): Promise<void> {
    if (projectId) {
      const pCache = path.join(this.projectsDir, projectId, "cache");
      await this.deleteFromDir(pCache, id);
    }
    // Also try global
    const cacheDir = path.join(this.dataRoot, "cache");
    await this.deleteFromDir(cacheDir, id);
  }

  private async deleteFromDir(dir: string, id: string) {
    try {
      const files = await fs.readdir(dir);
      const file = files.find((f) => f.startsWith(`${id}.`));
      if (file) {
        await fs.unlink(path.join(dir, file));
        logger.info(`[DataService] Deleted temp image: ${file} from ${dir}`);
      }
    } catch (e) {
      // ignore
    }
  }

  // --- Images ---
  async listCardImages(
    projectId: string,
    cardId: string,
    includeArchived = false
  ): Promise<{
    images: {
      path: string;
      filename: string;
      time: Date;
      isFavorite: boolean;
      isArchived: boolean;
    }[];
    count: number;
  }> {
    try {
      const cards = await this.getCards(projectId);
      const card = cards.find((c) => c.id === cardId);
      if (!card) return { images: [], count: 0 };

      const subfolder = card.outputSubfolder || "default";
      const assetsDir = path.join(
        this.projectsDir,
        projectId,
        "assets",
        subfolder
      );

      try {
        await fs.access(assetsDir);
      } catch {
        return { images: [], count: 0 };
      }

      const files = await fs.readdir(assetsDir);
      const images = [];

      for (const file of files) {
        if (!/\.(png|jpg|jpeg|webp)$/i.test(file)) continue;

        const isArchived = card.archivedImages?.includes(file) || false;
        if (!includeArchived && isArchived) continue;

        const isFavorite = card.favoriteImages?.includes(file) || false;
        const stats = await fs.stat(path.join(assetsDir, file));

        images.push({
          // Relative path for frontend/client serving "data/projects/..."
          path: path.join(
            "data",
            "projects",
            projectId,
            "assets",
            subfolder,
            file
          ),
          filename: file,
          time: stats.birthtime,
          isFavorite,
          isArchived,
        });
      }

      // Sort by newest first
      images.sort((a, b) => b.time.getTime() - a.time.getTime());

      return { images, count: images.length };
    } catch (e) {
      logger.error(`[DataService] Error listing images for card ${cardId}:`, e);
      return { images: [], count: 0 };
    }
  }
}
