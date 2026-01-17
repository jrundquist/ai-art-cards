import { GoogleGenerativeAI, Part } from "@google/generative-ai";
import { DataService } from "./data_service";
import { logger } from "./logger";
import { SYSTEM_INSTRUCTION } from "./system_instruction";
import path from "path";
import fs from "fs/promises";
import { TOOL_DEFINITIONS, handleToolCall } from "../tools";

export interface ChatMessage {
  role: "user" | "model" | "function";
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
    referenceImageFiles: any[] = [],
    generatedImageFiles: string[] = [],
    useThinking: boolean = false,
  ) {
    // 1. Load History
    logger.info(
      `[ChatService] Sending message stream for conv: ${conversationId} (Thinking: ${useThinking})`,
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
      })\nProject Description: ${project.description || "No description."}\n`;
    } else {
      // Global Context: List available projects
      const projects = await this.dataService.getProjects();
      contextStr += `No active project selected. You are in Global Chat Mode.\nAvailable Projects:
${projects.map((p) => `- ${p.name} (ID: ${p.id}): ${p.description}`).join("\n")}
\n`;
    }

    if (project && activeCardId && projectId) {
      const cards = await this.dataService.getCards(projectId);
      const card = cards.find((c) => c.id === activeCardId);
      if (card) {
        contextStr += `Active Card: "${card.name}" (Internal ID: ${
          card.id
        })\nCard Prompt: ${card.prompt || "Empty"}\n`;
      }
    }

    // New: Include info on recent/active generation jobs
    const activeJobs = this.getActiveJobs().filter(
      (j) => j.projectId === projectId,
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
    // Use Gemini 3 Flash for everything as requested.
    // 'minimal' for standard chat (fast), 'high' for Thinking Mode (deep).
    const modelName = "gemini-3-flash-preview";

    const model = this.genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: this.getTools() as any,
      generationConfig: {
        thinkingConfig: {
          thinkingLevel: useThinking ? "high" : "minimal",
          includeThoughts: useThinking, // Only enable summaries for high thinking mode
        },
      } as any,
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

      let isClientDisconnected = false;
      res.on("close", () => {
        logger.info("[ChatService] Client disconnected, aborting stream.");
        // We set a flag. We can't easily abort the `model.generateContentStream`
        // unless we use an AbortSignal if the SDK supports it (Gemini Node SDK might not yet fully).
        // But we can stop processing the *stream iterator* and stop saving.
        isClientDisconnected = true;
      });

      for (const img of images) {
        const buffer = Buffer.from(img.data, "base64");
        // Pass projectId to save in project cache
        const { id } = await this.dataService.saveTempImage(
          buffer,
          img.mimeType,
          projectId,
        );
        imageIds.push(id);

        imageParts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.data,
          },
        });
      }

      // Process Generated Images (System Feedback)
      if (generatedImageFiles && generatedImageFiles.length > 0) {
        logger.info(
          `[ChatService] Processing ${generatedImageFiles.length} generated images for feedback`,
        );
        for (const relPath of generatedImageFiles) {
          try {
            // relPath is relative to the root, e.g., "data/projects/..." or just relative path?
            // The paths in job results seem to be relative to CWD usually, need to check how they are stored.
            // Assuming they are relative to CWD for now as per previous usages.
            // IMPORTANT: If they start with /, remove it.
            const cleanPath = relPath.startsWith("/")
              ? relPath.substring(1)
              : relPath;
            const fullPath = path.resolve(process.cwd(), cleanPath);

            const buffer = await fs.readFile(fullPath);
            const ext = path.extname(fullPath).toLowerCase();
            const mimeType =
              ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";

            imageParts.push({
              inlineData: {
                mimeType,
                data: buffer.toString("base64"),
              },
            });
            logger.info(`[ChatService] Attached generated result: ${relPath}`);
          } catch (e: any) {
            logger.error(
              `[ChatService] Failed to load generated image ${relPath}: ${e.message}`,
            );
          }
        }
      }

      // Inject system context about image IDs if present
      // Process Reference Images (Historical/Gallery Images)
      if (referenceImageFiles.length > 0) {
        logger.info(
          `[ChatService] Processing ${referenceImageFiles.length} reference images`,
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
                filename,
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
                `[ChatService] Attached reference image: ${filename}`,
              );
            } else {
              logger.warn(
                `[ChatService] Card not found for reference: ${cardId}`,
              );
            }
          } catch (e: any) {
            logger.error(
              `[ChatService] Failed to load reference image: ${e.message}`,
            );
          }
        }
      }

      // Inject system context about images (unify both uploaded and referenced)
      const systemParts: string[] = [];

      // We need to list ONLY what we just added to imageParts in specific order.
      // Order in imageParts:
      // 1. Uploaded Images (from `images` arg)
      // 2. Generated Images (Feedback)
      // 3. Referenced Images

      // Let's create a combined textual manifest
      let currentImageIndex = 0;

      // 1. Uploads
      if (images.length > 0) {
        images.forEach((img, idx) => {
          systemParts.push(
            `Attached Image (inlineIndex: ${currentImageIndex}): ${imageIds[idx]}`,
          );
          currentImageIndex++;
        });
      }

      // 2. Generated Images
      if (generatedImageFiles.length > 0) {
        generatedImageFiles.forEach((file) => {
          systemParts.push(
            `Attached Generated Image: ${file} (inlineIndex: ${currentImageIndex})`,
          );
          currentImageIndex++;
        });
      }

      // 3. References
      if (referenceImageFiles.length > 0) {
        referenceImageFiles.forEach((ref) => {
          // We sent the image as inlineData, so it consumes an index
          systemParts.push(
            `Referenced Image: ${JSON.stringify({
              projectId: ref.projectId,
              cardId: ref.cardId,
              filename: ref.filename,
            })} (inlineIndex: ${currentImageIndex})`,
          );
          currentImageIndex++;
        });
      }

      // Legacy formatted lines (optional, but keep briefly for backward compat or debugging?)
      // We'll replace the old "Attached Image IDs" / "Referenced Images JSON" blocks with this unified list.

      let finalMessageText = message;
      // Prepend Context for the current turn
      if (contextStr) {
        finalMessageText = `[Context]\n${contextStr}`;
      }

      // Prepend System for the current turn
      if (systemParts.length > 0) {
        finalMessageText += `\n\n[System]\n${systemParts.join("\n")}`;
      }

      // Prepend User Message for the current turn
      finalMessageText += `\n\n[User Message]\n${message}`;

      finalMessageText = finalMessageText.trim();

      let currentMessage: string | Part[] = message;

      if (parts && parts.length > 0) {
        currentMessage = parts as Part[];
      } else if (imageParts.length > 0) {
        // [MODIFIED] Images First per Best Practices
        currentMessage = [...imageParts, { text: finalMessageText }];
      } else {
        currentMessage = finalMessageText;
      }

      // [Stateless Loop Implementation]
      // Use local history accumulator to correct SDK state loss
      // Initialize with existing history so we preserve past turns
      const existingHistory = await chat.getHistory();
      const accumulatedHistory: ChatMessage[] = existingHistory.map((h) => ({
        role: h.role as "user" | "model",
        parts: h.parts,
      }));

      // 1. Add Initial User Message to accumulated history
      let initialUserParts: Part[] = [];
      if (Array.isArray(currentMessage)) {
        initialUserParts = currentMessage;
      } else {
        initialUserParts = [{ text: String(currentMessage) }];
      }
      accumulatedHistory.push({ role: "user", parts: initialUserParts });

      let pendingImages: any[] = [];
      let finished = false;

      while (!finished) {
        if (isClientDisconnected) break;

        // REMOVED: Redundant block that caused duplication of text messages.
        // The initial message is already added to accumulatedHistory before the loop.
        // Subsequent messages (tool outputs, etc.) are added to accumulatedHistory explicitly.

        const fullHistory = accumulatedHistory;

        logger.info(
          `[ChatService] Sending stateless request with history length: ${fullHistory.length}`,
        );

        // We need to map our history format to the API format if needed,
        // but accumulatedHistory should already be compliant.
        const result = await model.generateContentStream({
          contents: fullHistory as any[],
        });

        // Collect model response parts for this turn
        const currentModelParts: Part[] = [];

        const toolCalls: any[] = [];
        let accumulatedThoughtSignature: string | undefined;

        for await (const chunk of result.stream) {
          if (isClientDisconnected) break;

          // Inspect raw parts to detect "thoughts"
          const parts = chunk.candidates?.[0]?.content?.parts || [];

          for (const part of parts) {
            // Check for thought (SDK 0.21.0+ might expose this)
            // Use 'any' cast if TS complains about 'thought' property
            const isThought = (part as any).thought;

            if (isThought && part.text) {
              // Thoughts are not typically saved in standard history, but we could if we wanted.
              // For now, only send to frontend.
              res.write(
                `data: ${JSON.stringify({
                  type: "thought",
                  content: part.text,
                })}\n\n`,
              );
            } else if (part.text) {
              // Accumulate text for history
              // potentially merge adjacent text parts
              if (
                currentModelParts.length > 0 &&
                currentModelParts[currentModelParts.length - 1].text
              ) {
                currentModelParts[currentModelParts.length - 1].text +=
                  part.text;
              } else {
                currentModelParts.push({ text: part.text });
              }

              res.write(
                `data: ${JSON.stringify({
                  type: "text",
                  content: part.text,
                })}\n\n`,
              );
            }
          }

          // Check for function calls
          const calls = chunk.functionCalls();
          if (calls && calls.length > 0) {
            // [Fix Persistence] Inject references if Model forgot them
            // This ensures they are saved in history and sent to client correctly
            for (const call of calls) {
              if (call.name === "generateImage") {
                if (referenceImageFiles && referenceImageFiles.length > 0) {
                  // Check if args is missing references or empty
                  if (
                    !(call.args as any).referenceImageFiles ||
                    (call.args as any).referenceImageFiles.length === 0
                  ) {
                    (call.args as any).referenceImageFiles =
                      referenceImageFiles;
                  }
                }
              }
            }

            toolCalls.push(...calls);

            // CRITICAL: Add raw parts (not extracted calls) to history
            // The raw parts contain thoughtSignature which is required for Gemini 3
            // Filter to only include parts with functionCall
            parts.forEach((part: any) => {
              if (part.functionCall) {
                const fc = part.functionCall;
                if (
                  fc.name === "generateImage" &&
                  referenceImageFiles &&
                  referenceImageFiles.length > 0
                ) {
                  if (
                    !(fc.args as any).referenceImageFiles ||
                    (fc.args as any).referenceImageFiles.length === 0
                  ) {
                    (fc.args as any).referenceImageFiles = referenceImageFiles;
                  }
                }

                currentModelParts.push(part); // Preserve the whole part including thoughtSignature

                // Capture thoughtSignature for the response turn

                if (part.thoughtSignature && !accumulatedThoughtSignature) {
                  accumulatedThoughtSignature = part.thoughtSignature;
                }
              }
            });

            res.write(
              `data: ${JSON.stringify({
                type: "tool_call",
                content: calls,
              })}\n\n`,
            );
          }
        }

        // Add this model turn to history
        // Add this model turn to history
        if (currentModelParts.length > 0) {
          accumulatedHistory.push({ role: "model", parts: currentModelParts });
        }

        if (toolCalls.length > 0) {
          const toolResponses = [];
          const followUpParts = [];

          // CRITICAL: Use captured thoughtSignature
          const thoughtSignature = accumulatedThoughtSignature;

          for (const call of toolCalls) {
            logger.info(`[ChatService] Tool Call: ${call.name}`);
            logger.info(
              `[ChatService] Full call object:`,
              JSON.stringify(call, null, 2),
            );
            const toolResult = await this.executeTool(call.name, call.args);

            // If the tool result contains an image, we must send it as a follow-up turn
            // because mixing FunctionResponse with inlineData in one turn is prohibited.
            if (toolResult && toolResult.inlineData) {
              const { inlineData, ...otherInfo } = toolResult;
              const responseObj: any = {
                functionResponse: {
                  name: call.name,
                  response: { result: otherInfo || "Success" },
                },
              };
              // CRITICAL: Preserve thought_signature for Gemini 3 models
              if ((call as any).thought_signature) {
                responseObj.thought_signature = (call as any).thought_signature;
              }
              toolResponses.push(responseObj);
              followUpParts.push({ inlineData });
            } else {
              const responseObj: any = {
                functionResponse: {
                  name: call.name,
                  response: { result: toolResult },
                },
              };
              // CRITICAL: Preserve thought_signature for Gemini 3 models
              if ((call as any).thought_signature) {
                responseObj.thought_signature = (call as any).thought_signature;
              }
              toolResponses.push(responseObj);
            }

            logger.info(
              `[ChatService] Tool result for ${call.name} ready to send.`,
            );
            res.write(
              `data: ${JSON.stringify({
                type: "tool_result",
                toolName: call.name,
                result: toolResult,
              })}\n\n`,
            );
          }

          // Feed tool responses back to model
          currentMessage = toolResponses;

          // Add Tool Responses (User Role) to history
          // CRITICAL: Include thoughtSignature in the response turn if it was in the call
          // It must be part of the first function response part, mirroring how it was received
          const responseParts: any[] = [...toolResponses];

          if (thoughtSignature && responseParts.length > 0) {
            logger.info(
              `[ChatService] Attaching thoughtSignature INSIDE first functionResponse.response payload`,
            );

            // Try putting it inside functionResponse.response
            if (
              responseParts[0].functionResponse &&
              responseParts[0].functionResponse.response
            ) {
              // The response is a Struct (object). We can add properties to it.
              responseParts[0].functionResponse.response.thoughtSignature =
                thoughtSignature;
              // And because strict snake_case is often safer for these hidden fields:
              responseParts[0].functionResponse.response.thought_signature =
                thoughtSignature;
            }
          }
          // Use 'function' role here
          accumulatedHistory.push({ role: "function", parts: responseParts });

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

            // Add this extra user turn to history
            accumulatedHistory.push({
              role: "user",
              parts: currentMessage as Part[],
            });

            pendingImages = [];
            // Loop once more with the images as a USER turn
          } else {
            finished = true;
          }
        }
      }

      // Use our manually managed history since we bypassed the SDK state
      // This ensures we save the version with thoughtSignatures
      conversation.history = accumulatedHistory.map((item) => ({
        role: item.role as "user" | "model" | "function", // Allow function role
        parts: item.parts,
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
            `data: ${JSON.stringify({ type: "title", content: newTitle })}\n\n`,
          );
        }
      }

      await this.saveConversation(conversation);

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (e: any) {
      logger.error("[ChatService] Error:", e);
      res.write(
        `data: ${JSON.stringify({ type: "error", content: e.message })}\n\n`,
      );
      res.end();
    }
  }

  private async executeTool(name: string, args: any): Promise<any> {
    logger.info(
      `[ChatService] DEBUG: executeTool called for ${name} with args: ${JSON.stringify(
        args,
        null,
        2,
      )}`,
    );
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
            await fs.readFile(path.join(dir, f), "utf-8"),
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
      const conversation: Conversation = JSON.parse(
        await fs.readFile(filepath, "utf-8"),
      );

      // Sanitize history: Fix 'class' of function responses
      // Older versions or bugs might have saved functionResponse with role 'user'
      if (conversation.history) {
        conversation.history = conversation.history.map((msg) => {
          // check if any part is a functionResponse
          const hasFunctionResponse = msg.parts.some(
            (p: any) => p.functionResponse,
          );
          if (hasFunctionResponse && msg.role === "user") {
            logger.info(
              `[ChatService] Sanitizing message role from 'user' to 'function' for conversation ${conversationId}`,
            );
            return { ...msg, role: "function" };
          }
          return msg;
        });
      }

      return conversation;
    } catch {
      return null;
    }
  }

  async saveConversation(conversation: Conversation) {
    const dir = await this.ensureConversationsDir();
    const filepath = path.join(dir, `${conversation.id}.json`);
    const tempFilepath = `${filepath}.tmp`;

    try {
      const json = JSON.stringify(conversation, null, 2);
      logger.info(
        `[ChatService] Saving conversation ${conversation.id}, size: ${json.length} bytes`,
      );
      await fs.writeFile(tempFilepath, json);
      await fs.rename(tempFilepath, filepath);
      logger.info(`[ChatService] Saved conversation ${conversation.id}`);
    } catch (e: any) {
      logger.error(
        `[ChatService] Failed to save conversation ${conversation.id}:`,
        e,
      );
      // Try to clean up temp file
      try {
        await fs.unlink(tempFilepath);
      } catch {}
      throw e;
    }
  }

  async deleteConversation(conversationId: string): Promise<boolean> {
    logger.info(
      `[ChatService] Attempting to delete conversation: ${conversationId}`,
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
                /\[System: Attached Image IDs: ([^\]]+)\]/,
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
            `[ChatService] Found ${imageIdsToClean.size} cached images to cleanup for conversation ${conversationId}`,
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
