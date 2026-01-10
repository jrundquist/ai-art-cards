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

const PROJECTS_DIR = path.join(__dirname, "../../data/projects");
const CARDS_DIR = path.join(__dirname, "../../data/cards");
const KEYS_FILE = path.join(__dirname, "../../data/keys.json");

// Helper ensure dirs
async function ensureDirs() {
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
  await fs.mkdir(CARDS_DIR, { recursive: true });
}

export class DataService {
  constructor() {
    ensureDirs();
  }

  // --- Projects ---
  async getProjects(): Promise<Project[]> {
    try {
      const files = await fs.readdir(PROJECTS_DIR);
      const projects: Project[] = [];
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const data = JSON.parse(
          await fs.readFile(path.join(PROJECTS_DIR, f), "utf-8")
        );
        projects.push(data);
      }
      return projects;
    } catch {
      return [];
    }
  }

  async saveProject(project: Project): Promise<void> {
    await ensureDirs();
    await fs.writeFile(
      path.join(PROJECTS_DIR, `${project.id}.json`),
      JSON.stringify(project, null, 2)
    );
  }

  // --- Cards ---
  async getCards(projectId: string): Promise<Card[]> {
    try {
      const projectCardDir = path.join(CARDS_DIR, projectId);
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
    await ensureDirs();
    const projectCardDir = path.join(CARDS_DIR, card.projectId);
    await fs.mkdir(projectCardDir, { recursive: true });

    await fs.writeFile(
      path.join(projectCardDir, `${card.id}.json`),
      JSON.stringify(card, null, 2)
    );
  }

  async getProject(id: string): Promise<Project | null> {
    try {
      const data = await fs.readFile(
        path.join(PROJECTS_DIR, `${id}.json`),
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
      const data = await fs.readFile(KEYS_FILE, "utf-8");
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  async saveKey(name: string, key: string): Promise<void> {
    await ensureDirs();
    const keys = await this.getKeys();
    // Check if exists, update or push
    const existing = keys.find((k) => k.name === name);
    if (existing) {
      existing.key = key;
    } else {
      keys.push({ name, key });
    }
    await fs.writeFile(KEYS_FILE, JSON.stringify(keys, null, 2));
  }
}
