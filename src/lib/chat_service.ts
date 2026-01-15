import { GoogleGenerativeAI, Content, Part } from "@google/generative-ai";
import { DataService, Card } from "./data_service";
import { logger } from "./logger";
import { SYSTEM_INSTRUCTION } from "./system_instruction";
import path from "path";
import fs from "fs/promises";
import { TOOL_DEFINITIONS, handleToolCall } from "../tools";

export interface ChatMessage {
  role: "user" | "model";
  parts: Part[];
}

export interface Conversation {
  id: string;
  projectId?: string;
  title: string;
  history: ChatMessage[];
  lastUpdated: number;
}

export class ChatService {
  private genAI: GoogleGenerativeAI | null = null;
  private dataService: DataService;
  private dataRoot: string;
  private getActiveJobs: () => any[] = () => [];

  constructor(apiKey: string | undefined, dataService: DataService) {
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
    this.dataService = dataService;
    this.dataRoot = path.join(process.cwd(), "data");
  }

  setGetActiveJobs(getter: () => any[]) {
    this.getActiveJobs = getter;
  }

  // Allow setting the root data directory (called from server)
  setDataRoot(dir: string) {
    this.dataRoot = dir;
  }

  private async ensureConversationsDir() {
    // Global Path: data/conversations
    const dir = path.join(this.dataRoot, "conversations");
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  // --- Tools Definitions ---

  private getTools() {
    return TOOL_DEFINITIONS;
  }

  // --- streaming chat ---

  async sendMessageStream(
    projectId: string | undefined,
    conversationId: string,
    message: string,
    activeCardId: string | null,
    images: { mimeType: string; data: string }[] = [],
    res: any, // Express Response
    parts: any[] = [],
    referenceImageFiles: any[] = []
  ) {
    // 1. Load History
    logger.info(
      `[ChatService] Sending message stream for conv: ${conversationId}`
    );
    logger.info(`[ChatService] Received ${images.length} images`);

    const conversation = await this.loadConversation(conversationId);
    if (!conversation) {
      logger.warn(`[ChatService] Conversation not found: ${conversationId}`);
      throw new Error("Conversation not found");
    }

    if (!this.genAI) {
      throw new Error("API Key not set. Cannot generate response.");
    }

    // 2. Load Global & Card Context
    let project = null;
    if (projectId) {
      project = await this.dataService.getProject(projectId);
    }
    let contextStr = `\n\n---
CURRENT STATE:
`;

    if (project) {
      contextStr += `Active Project: "${project.name}" (Internal ID: ${
        project.id
      })
Project Description: ${project.description || "No description."}\n`;
    } else {
      // Global Context: List available projects
      const projects = await this.dataService.getProjects();
      contextStr += `No active project selected. You are in Global Chat Mode.
Available Projects:
${projects.map((p) => `- ${p.name} (ID: ${p.id}): ${p.description}`).join("\n")}
\n`;
    }

    if (project && activeCardId && projectId) {
      const cards = await this.dataService.getCards(projectId);
      const card = cards.find((c) => c.id === activeCardId);
      if (card) {
        contextStr += `Active Card: "${card.name}" (Internal ID: ${card.id})
Card Prompt: ${card.prompt || "Empty"}\n`;
      }
    }

    // New: Include info on recent/active generation jobs
    const activeJobs = this.getActiveJobs().filter(
      (j) => j.projectId === projectId
    );
    if (activeJobs.length > 0) {
      contextStr += `\nRecent/Active Generation Jobs for this project:\n`;
      activeJobs.forEach((job) => {
        contextStr += `- Job ${job.id}: Card "${job.cardName}" (ID: ${job.cardId}) - Status: ${job.status}`;
        if (job.status === "completed" && job.results) {
          contextStr += ` - Results: ${job.results
            .map((r: string) => path.basename(r))
            .join(", ")}`;
        } else if (job.status === "error") {
          contextStr += ` - Error: ${job.error}`;
        }
        contextStr += `\n`;
      });
      contextStr += `\nNote: You can use 'getGeneratedImage' with the filenames above to analyze specific results.\n`;
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
      // Handle images: Cache them and add to message parts
      const imageParts: Part[] = [];
      const imageIds: string[] = [];

      for (const img of images) {
        const buffer = Buffer.from(img.data, "base64");
        // Pass projectId to save in project cache
        const { id } = await this.dataService.saveTempImage(
          buffer,
          img.mimeType,
          projectId
        );
        imageIds.push(id);

        imageParts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.data,
          },
        });
      }

      // Inject system context about image IDs if present
      // Process Reference Images (Historical/Gallery Images)
      if (referenceImageFiles.length > 0) {
        logger.info(
          `[ChatService] Processing ${referenceImageFiles.length} reference images`
        );
        for (const ref of referenceImageFiles) {
          try {
            const { projectId, cardId, filename } = ref;
            // We need to find the card to get the subfolder
            const cards = await this.dataService.getCards(projectId);
            const card = cards.find((c) => c.id === cardId);

            if (card) {
              const subfolder = card.outputSubfolder || "default";
              const filePath = path.join(
                this.dataRoot,
                "projects",
                projectId,
                "assets",
                subfolder,
                filename
              );

              const buffer = await fs.readFile(filePath);
              const ext = path.extname(filename).toLowerCase();
              const mimeType =
                ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";

              imageParts.push({
                inlineData: {
                  mimeType,
                  data: buffer.toString("base64"),
                },
              });
              logger.info(
                `[ChatService] Attached reference image: ${filename}`
              );
            } else {
              logger.warn(
                `[ChatService] Card not found for reference: ${cardId}`
              );
            }
          } catch (e: any) {
            logger.error(
              `[ChatService] Failed to load reference image: ${e.message}`
            );
          }
        }
      }

      // Inject system context about images (unify both uploaded and referenced)
      const systemParts: string[] = [];
      if (imageIds.length > 0) {
        systemParts.push(`Attached Image IDs: ${imageIds.join(", ")}`);
      }
      if (referenceImageFiles.length > 0) {
        // Simplify the object for the LLM to reduce token usage and confusion
        const simpleRefs = referenceImageFiles.map((r) => ({
          projectId: r.projectId,
          cardId: r.cardId,
          filename: r.filename,
        }));
        systemParts.push(
          `Referenced Images (pass these to generateImage tool as 'referenceImageFiles'): ${JSON.stringify(
            simpleRefs
          )}`
        );
      }

      let finalMessageText = message;
      if (systemParts.length > 0) {
        finalMessageText += `\n\n[System: ${systemParts.join("; ")}]`;
      }

      let currentMessage: string | Part[] = message;

      if (parts && parts.length > 0) {
        currentMessage = parts as Part[];
      } else if (imageParts.length > 0) {
        currentMessage = [{ text: finalMessageText }, ...imageParts];
      } else {
        currentMessage = finalMessageText;
      }

      let pendingImages: any[] = [];
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
          const followUpParts = [];

          for (const call of toolCalls) {
            logger.info(`[ChatService] Tool Call: ${call.name}`);
            const toolResult = await this.executeTool(call.name, call.args);

            // If the tool result contains an image, we must send it as a follow-up turn
            // because mixing FunctionResponse with inlineData in one turn is prohibited.
            if (toolResult && toolResult.inlineData) {
              const { inlineData, ...otherInfo } = toolResult;
              toolResponses.push({
                functionResponse: {
                  name: call.name,
                  response: { result: otherInfo || "Success" },
                },
              });
              followUpParts.push({ inlineData });
            } else {
              toolResponses.push({
                functionResponse: {
                  name: call.name,
                  response: { result: toolResult },
                },
              });
            }

            logger.info(
              `[ChatService] Tool result for ${call.name} ready to send.`
            );
            res.write(
              `data: ${JSON.stringify({
                type: "tool_result",
                toolName: call.name,
                result: toolResult,
              })}\n\n`
            );
          }

          // Feed tool responses back to model
          currentMessage = toolResponses;

          // If we have images for follow-up, we don't finish yet.
          if (followUpParts.length > 0) {
            pendingImages = followUpParts;
          }
        } else {
          // No more tool calls. Check if we have pending images from the previous turn.
          if (pendingImages.length > 0) {
            // Tag this injected turn so the frontend can hide it from history if desired
            currentMessage = [
              { text: "[System: getGeneratedImage Result]" },
              ...pendingImages,
            ];
            pendingImages = [];
            // Loop once more with the images as a USER turn
          } else {
            finished = true;
          }
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
    return handleToolCall(name, args, this.dataService, this.dataRoot);
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

  async listConversations(): Promise<Conversation[]> {
    try {
      const dir = await this.ensureConversationsDir();
      const files = await fs.readdir(dir);
      const convs: Conversation[] = [];
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        try {
          const data = JSON.parse(
            await fs.readFile(path.join(dir, f), "utf-8")
          );
          convs.push(data);
        } catch (err) {
          logger.error(`[ChatService] Failed to parse conversation ${f}:`, err);
        }
      }

      const sorted = convs.sort((a, b) => b.lastUpdated - a.lastUpdated);
      logger.info(`[ChatService] Listing ${sorted.length} conversations`);
      return sorted;
    } catch (e) {
      logger.error("[ChatService] Error listing conversations:", e);
      return [];
    }
  }

  async loadConversation(conversationId: string): Promise<Conversation | null> {
    try {
      const dir = await this.ensureConversationsDir();
      const filepath = path.join(dir, `${conversationId}.json`);
      // If new conversation
      try {
        await fs.access(filepath);
      } catch {
        // Create new
        return {
          id: conversationId,
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
    const dir = await this.ensureConversationsDir();
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
      const dir = await this.ensureConversationsDir();
      const filepath = path.join(dir, `${conversationId}.json`);

      try {
        // Read first to find images
        const data = await fs.readFile(filepath, "utf-8");
        const conversation: Conversation = JSON.parse(data);

        // Find Reference Image IDs
        const imageIdsToClean = new Set<string>();
        conversation.history.forEach((msg) => {
          msg.parts.forEach((part) => {
            if (
              part.text &&
              part.text.includes("[System: Attached Image IDs:")
            ) {
              const match = part.text.match(
                /\[System: Attached Image IDs: ([^\]]+)\]/
              );
              if (match && match[1]) {
                match[1].split(",").forEach((id) => {
                  const cleanId = id.trim();
                  if (cleanId) imageIdsToClean.add(cleanId);
                });
              }
            }
          });
        });

        if (imageIdsToClean.size > 0) {
          logger.info(
            `[ChatService] Found ${imageIdsToClean.size} cached images to cleanup for conversation ${conversationId}`
          );
          for (const id of imageIdsToClean) {
            await this.dataService.deleteTempImage(id);
          }
        }

        await fs.unlink(filepath);
        logger.info(`[ChatService] Deleted conversation ${conversationId}`);
        return true;
      } catch (e: any) {
        if (e.code !== "ENOENT") {
          logger.error(`[ChatService] Error deleting file ${filepath}:`, e);
        }
        return false;
      }
    } catch (e) {
      logger.error("[ChatService] Error in deleteConversation:", e);
      return false;
    }
  }
}
