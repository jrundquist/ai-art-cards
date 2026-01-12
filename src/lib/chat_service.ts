import { GoogleGenerativeAI, Content, Part } from "@google/generative-ai";
import { DataService, Card, Project } from "./data_service";
import { ImageGenerator } from "./image_generator";
import { logger } from "./logger";
import { SYSTEM_INSTRUCTION } from "./system_instruction";
import path from "path";
import fs from "fs/promises";

export interface ChatMessage {
  role: "user" | "model";
  parts: Part[];
}

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  history: ChatMessage[];
  lastUpdated: number;
}

export class ChatService {
  private genAI: GoogleGenerativeAI | null = null;
  private dataService: DataService;
  private conversationsDir: string;

  constructor(apiKey: string | undefined, dataService: DataService) {
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
    this.dataService = dataService;
    this.conversationsDir = path.join(process.cwd(), "data", "conversations");
  }

  // Allow setting the specific conversations directory (called from server)
  setConversationsDir(dir: string) {
    this.conversationsDir = dir;
  }

  private async ensureDir(projectId: string) {
    const dir = path.join(this.conversationsDir, projectId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  // --- Tools Definitions ---

  private getTools() {
    return [
      {
        functionDeclarations: [
          {
            name: "listProjects",
            description:
              "List all available projects. Returns IDs, names, and descriptions/intent.",
          },
          {
            name: "getProject",
            description:
              "Get details of a specific project, including its global settings and description/intent.",
            parameters: {
              type: "OBJECT",
              properties: {
                projectId: { type: "STRING" },
              },
              required: ["projectId"],
            },
          },
          {
            name: "listCards",
            description:
              "List all cards in the current project. Returns only summary info (IDs and names). Use getCard for full details like prompts.",
            parameters: {
              type: "OBJECT",
              properties: {
                projectId: {
                  type: "STRING",
                  description: "The ID of the project.",
                },
              },
              required: ["projectId"],
            },
          },
          {
            name: "getCard",
            description:
              "Get the full details of a specific card, including its full prompt and specific settings.",
            parameters: {
              type: "OBJECT",
              properties: {
                projectId: { type: "STRING" },
                cardId: { type: "STRING" },
              },
              required: ["projectId", "cardId"],
            },
          },
          {
            name: "findCard",
            description:
              "Find a card by name (fuzzy match). Returns ID and Name. Use this to get the ID when you only have the name.",
            parameters: {
              type: "OBJECT",
              properties: {
                query: {
                  type: "STRING",
                  description: "The name or part of the name to search for.",
                },
                projectId: {
                  type: "STRING",
                  description: "Optional project ID to limit search.",
                },
              },
              required: ["query"],
            },
          },
          {
            name: "createCards",
            description: "Create one or more new cards in the project.",
            parameters: {
              type: "OBJECT",
              properties: {
                projectId: { type: "STRING" },
                cards: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      name: { type: "STRING" },
                      prompt: { type: "STRING" },
                      aspectRatio: { type: "STRING" },
                      resolution: { type: "STRING" },
                    },
                    required: ["name", "prompt"],
                  },
                },
              },
              required: ["projectId", "cards"],
            },
          },
          {
            name: "updateCard",
            description: "Update an existing card.",
            parameters: {
              type: "OBJECT",
              properties: {
                projectId: { type: "STRING" },
                cardId: { type: "STRING" },
                updates: {
                  type: "OBJECT",
                  properties: {
                    name: { type: "STRING" },
                    prompt: { type: "STRING" },
                    aspectRatio: { type: "STRING" },
                    resolution: { type: "STRING" },
                  },
                },
              },
              required: ["projectId", "cardId", "updates"],
            },
          },
          {
            name: "updateProject",
            description:
              "Update project-level settings like global prefix, suffix, and description.",
            parameters: {
              type: "OBJECT",
              properties: {
                projectId: { type: "STRING" },
                updates: {
                  type: "OBJECT",
                  properties: {
                    name: { type: "STRING" },
                    description: { type: "STRING" },
                    globalPrefix: { type: "STRING" },
                    globalSuffix: { type: "STRING" },
                    defaultAspectRatio: { type: "STRING" },
                    defaultResolution: { type: "STRING" },
                  },
                },
              },
              required: ["projectId", "updates"],
            },
          },
          {
            name: "generateImage",
            description: "Trigger image generation for a card.",
            parameters: {
              type: "OBJECT",
              properties: {
                projectId: { type: "STRING" },
                cardId: { type: "STRING" },
                promptOverride: {
                  type: "STRING",
                  description: "Optional prompt override",
                },
                count: {
                  type: "INTEGER",
                  description: "Number of images to generate (default: 1)",
                },
              },
              required: ["projectId", "cardId"],
            },
          },
        ],
      },
    ];
  }

  // --- streaming chat ---

  async sendMessageStream(
    projectId: string,
    conversationId: string,
    message: string,
    activeCardId: string | null,
    res: any // Express Response
  ) {
    // 1. Load History
    logger.info(
      `[ChatService] Sending message stream for conv: ${conversationId} in project: ${projectId}`
    );
    const conversation = await this.loadConversation(projectId, conversationId);
    if (!conversation) {
      logger.warn(`[ChatService] Conversation not found: ${conversationId}`);
      throw new Error("Conversation not found");
    }

    if (!this.genAI) {
      throw new Error("API Key not set. Cannot generate response.");
    }

    // 2. Load Global & Card Context
    const project = await this.dataService.getProject(projectId);
    let contextStr = `\n\n---
CURRENT STATE:
`;

    if (project) {
      contextStr += `Active Project: "${project.name}" (Internal ID: ${
        project.id
      })
Project Description: ${project.description || "No description."}\n`;
    }

    if (project && activeCardId) {
      const cards = await this.dataService.getCards(projectId);
      const card = cards.find((c) => c.id === activeCardId);
      if (card) {
        contextStr += `Active Card: "${card.name}" (Internal ID: ${card.id})
Card Prompt: ${card.prompt || "Empty"}\n`;
      }
    }

    // 3. Initialize Model with Tools
    const model = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp",
      systemInstruction: SYSTEM_INSTRUCTION + contextStr,
      tools: this.getTools() as any,
    });

    const chat = model.startChat({
      history: conversation.history.map((m) => ({
        role: m.role,
        parts: m.parts,
      })),
    });

    // 3. Send Message and Stream
    try {
      let currentMessage: string | any[] = message;
      let finished = false;

      while (!finished) {
        const result = await chat.sendMessageStream(currentMessage);
        const toolCalls: any[] = [];

        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) {
            res.write(
              `data: ${JSON.stringify({ type: "text", content: text })}\n\n`
            );
          }

          // Check for function calls
          const calls = chunk.functionCalls();
          if (calls && calls.length > 0) {
            toolCalls.push(...calls);
            res.write(
              `data: ${JSON.stringify({
                type: "tool_call",
                content: calls,
              })}\n\n`
            );
          }
        }

        if (toolCalls.length > 0) {
          const toolResponses = [];
          for (const call of toolCalls) {
            logger.info(`[ChatService] Tool Call: ${call.name}`);
            const toolResult = await this.executeTool(call.name, call.args);
            toolResponses.push({
              functionResponse: {
                name: call.name,
                response: { result: toolResult }, // Wrap in object for Protobuf Struct compatibility
              },
            });
            logger.info(
              `[ChatService] Tool result for ${call.name} ready to send.`
            );
            res.write(
              `data: ${JSON.stringify({
                type: "tool_result",
                name: call.name,
                result: toolResult,
              })}\n\n`
            );
          }
          // Feed tool responses back to model in next turn
          currentMessage = toolResponses;
        } else {
          finished = true;
        }
      }

      // Update history in conversation object
      const newHistory = await chat.getHistory();
      // Map SDK history to our interface if needed, or just save parts
      conversation.history = newHistory.map((h) => ({
        role: h.role as "user" | "model",
        parts: h.parts as Part[],
      }));
      conversation.lastUpdated = Date.now();

      // Auto-title if new and has content
      if (
        conversation.title === "New Conversation" &&
        conversation.history.length >= 2
      ) {
        const newTitle = await this.generateTitle(conversation.history);
        if (newTitle) {
          conversation.title = newTitle;
          // Send title update event
          res.write(
            `data: ${JSON.stringify({ type: "title", content: newTitle })}\n\n`
          );
        }
      }

      await this.saveConversation(conversation);

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (e: any) {
      logger.error("[ChatService] Error:", e);
      res.write(
        `data: ${JSON.stringify({ type: "error", content: e.message })}\n\n`
      );
      res.end();
    }
  }

  private async executeTool(name: string, args: any): Promise<any> {
    try {
      logger.info(`[ChatService] Executing tool: ${name}`);
      const startTime = Date.now();
      let result;

      switch (name) {
        case "listProjects":
          const projs = await this.dataService.getProjects();
          result = projs.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
          }));
          break;
        case "getProject":
          result = (await this.dataService.getProject(args.projectId)) || {
            error: "Project not found",
          };
          break;
        case "listCards":
          const cardsInProj = await this.dataService.getCards(args.projectId);
          result = cardsInProj.map((c) => ({ id: c.id, name: c.name }));
          break;
        case "getCard": // Get cards
          const cards = await this.dataService.getCards(args.projectId);
          result = cards.find((c) => c.id === args.cardId) || {
            error: "Not found",
          };
          break;
        case "findCard":
          const query = args.query.toLowerCase();
          let projectsToSearch = [];
          if (args.projectId) {
            projectsToSearch.push({ id: args.projectId });
          } else {
            projectsToSearch = await this.dataService.getProjects();
          }

          const found = [];
          for (const p of projectsToSearch) {
            const cards = await this.dataService.getCards(p.id);
            const matches = cards.filter((c) =>
              c.name.toLowerCase().includes(query)
            );
            found.push(
              ...matches.map((c) => ({
                id: c.id,
                name: c.name,
                projectId: c.projectId,
              }))
            );
          }
          result = found;
          break;
        case "createCards":
          const projects = await this.dataService.getProjects();
          const project = projects.find((p) => p.id === args.projectId);
          // If project not found, we might want to error,
          // or just fallback to hardcoded defaults "2:3" and "2K".

          const newCards = [];
          for (const cardData of args.cards) {
            const id =
              Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
            const newCard: Card = {
              id,
              projectId: args.projectId,
              name: cardData.name,
              prompt: cardData.prompt,
              outputSubfolder: cardData.name.replace(/[^a-z0-9]/gi, "_"),
              aspectRatio:
                cardData.aspectRatio || project?.defaultAspectRatio || "2:3",
              resolution:
                cardData.resolution || project?.defaultResolution || "2K",
            };
            await this.dataService.saveCard(newCard);
            newCards.push(newCard);
          }
          result = { created: newCards };
          break;
        case "updateCard":
          const allCards = await this.dataService.getCards(args.projectId);
          const card = allCards.find((c) => c.id === args.cardId);
          if (!card) {
            result = { error: "Card not found" };
          } else {
            Object.assign(card, args.updates);
            await this.dataService.saveCard(card);
            result = { updated: card };
          }
          break;
        case "updateProject":
          const projectToUpdate = await this.dataService.getProject(
            args.projectId
          );
          if (!projectToUpdate) {
            result = { error: "Project not found" };
          } else {
            Object.assign(projectToUpdate, args.updates);
            await this.dataService.saveProject(projectToUpdate);
            result = { updated: projectToUpdate };
          }
          break;
        case "generateImage":
          const pId = args.projectId;
          const cId = args.cardId;
          const proj = await this.dataService.getProject(pId);
          const c = (await this.dataService.getCards(pId)).find(
            (x) => x.id === cId
          );

          if (!proj || !c) {
            result = { error: "Project or Card not found" };
          } else {
            // Changed: We now return a signal to the client to trigger generation.
            // This allows the frontend to show progress bars, toasts, etc.
            logger.info("[ChatService] Delegating generation to client");
            result = {
              success: true,
              clientAction: "generateImage",
              projectId: pId,
              cardId: cId,
              promptOverride: args.promptOverride,
              count: args.count || 1,
            };
          }
          break;
        default:
          result = { error: "Unknown tool" };
      }

      const duration = Date.now() - startTime;
      logger.info(
        `[ChatService] Tool ${name} executed in ${duration}ms. Result keys: ${Object.keys(
          result || {}
        ).join(", ")}`
      );
      return result;
    } catch (e: any) {
      logger.error(`[ChatService] Error executing tool ${name}:`, e);
      return { error: e.message };
    }
  }

  private async generateTitle(history: ChatMessage[]): Promise<string | null> {
    if (!this.genAI) return null;
    try {
      // Use a lightweight model or same model for titling
      const model = this.genAI.getGenerativeModel({
        model: "gemini-2.0-flash-exp",
      });

      // Construct a simple prompt
      // We only need the first few messages usually
      const context = history
        .slice(0, 4)
        .map((m) => `${m.role}: ${m.parts.map((p) => p.text).join(" ")}`)
        .join("\n");
      const prompt = `Based on the following conversation, generate a short, concise, and descriptive title (max 6 words). Do not use quotes or prefixes. Just the title.\n\n${context}`;

      const result = await model.generateContent(prompt);
      const title = result.response
        .text()
        .trim()
        .replace(/^["']|["']$/g, "");
      return title;
    } catch (e) {
      logger.error("[ChatService] Failed to generate title:", e);
      return null;
    }
  }

  // --- Persistence ---

  async listConversations(projectId: string): Promise<Conversation[]> {
    try {
      const dir = await this.ensureDir(projectId);
      const files = await fs.readdir(dir);
      const convs: Conversation[] = [];
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const data = JSON.parse(await fs.readFile(path.join(dir, f), "utf-8"));
        convs.push(data);
      }
      return convs.sort((a, b) => b.lastUpdated - a.lastUpdated);
    } catch {
      return [];
    }
  }

  async loadConversation(
    projectId: string,
    conversationId: string
  ): Promise<Conversation | null> {
    try {
      const dir = await this.ensureDir(projectId);
      const filepath = path.join(dir, `${conversationId}.json`);
      // If new conversation
      try {
        await fs.access(filepath);
      } catch {
        // Create new
        return {
          id: conversationId,
          projectId,
          title: "New Conversation",
          history: [],
          lastUpdated: Date.now(),
        };
      }
      return JSON.parse(await fs.readFile(filepath, "utf-8"));
    } catch {
      return null;
    }
  }

  async saveConversation(conversation: Conversation) {
    const dir = await this.ensureDir(conversation.projectId);
    await fs.writeFile(
      path.join(dir, `${conversation.id}.json`),
      JSON.stringify(conversation, null, 2)
    );
  }

  async deleteConversation(conversationId: string): Promise<boolean> {
    logger.info(
      `[ChatService] Attempting to delete conversation: ${conversationId}`
    );
    try {
      const projects = await this.dataService.getProjects();
      for (const p of projects) {
        const dir = await this.ensureDir(p.id);
        const filepath = path.join(dir, `${conversationId}.json`);
        try {
          await fs.unlink(filepath);
          logger.info(
            `[ChatService] Deleted conversation ${conversationId} from project ${p.id}`
          );
          return true;
        } catch (e: any) {
          // Only ignore ENOENT (file not found)
          if (e.code !== "ENOENT") {
            logger.error(`[ChatService] Error deleting file ${filepath}:`, e);
          }
        }
      }
      logger.warn(
        `[ChatService] Conversation ${conversationId} not found in any project`
      );
      return false;
    } catch (e) {
      logger.error("[ChatService] Error in deleteConversation:", e);
      return false;
    }
  }
}
