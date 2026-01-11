import fs from "fs/promises";
import path from "path";

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
    await this.ensureDirs();
    await fs.writeFile(
      path.join(this.projectsDir, `${project.id}.json`),
      JSON.stringify(project, null, 2)
    );
  }

  // --- Cards ---
  async getCards(projectId: string): Promise<Card[]> {
    try {
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
      return cards;
    } catch {
      return [];
    }
  }

  async saveCard(card: Card): Promise<void> {
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
    await fs.rm(path.join(this.cardsDir, projectId, `${cardId}.json`), {
      force: true,
    });
  }
}
