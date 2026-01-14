import { DataService, Card } from "./data_service";
import { logger } from "./logger";
import path from "path";
import fs from "fs/promises";

// --- Tool Definitions ---

export const TOOL_DEFINITIONS = [
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
          "List cards. Returns summary info (IDs, names, and Project IDs). Useful for finding cards.",
        parameters: {
          type: "OBJECT",
          properties: {
            projectId: {
              type: "STRING",
              description:
                "Optional ID of the project. If omitted, lists cards from ALL projects.",
            },
          },
          required: [],
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
          "Find a card by name (fuzzy match). Returns ID, Name, and Project ID. Use this to find a card's location.",
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
            notifyOnCompletion: {
              type: "BOOLEAN",
              description:
                "If true, the system will notify you when the generation is complete and show you the results. Use this if you need to follow up.",
            },
            referenceImageIds: {
              type: "ARRAY",
              items: { type: "STRING" },
              description:
                "Optional list of reference image IDs (from temporary uploads) to use for generation",
            },
            referenceImageFiles: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  projectId: { type: "STRING" },
                  cardId: { type: "STRING" },
                  filename: { type: "STRING" },
                },
                required: ["projectId", "cardId", "filename"],
              },
              description:
                "Optional list of previously generated image files to use as references. You can find these in the context from recent jobs or by listing card images.",
            },
          },
          required: ["projectId", "cardId"],
        },
      },
      {
        name: "getGeneratedImage",
        description:
          "Retrieve the raw image bytes for a generated image. As a multimodal model, this allows you to actually 'perceive' and analyze its visual content, artistic style, and composition directly.",
        parameters: {
          type: "OBJECT",
          properties: {
            projectId: { type: "STRING" },
            cardId: { type: "STRING" },
            filename: {
              type: "STRING",
              description: "The filename of the image (e.g. image_v001.png)",
            },
          },
          required: ["projectId", "cardId", "filename"],
        },
      },
      {
        name: "navigateUI",
        description:
          "Control the user interface to show specific projects, cards, or derived assets (images). Use this to direct the user's attention.",
        parameters: {
          type: "OBJECT",
          properties: {
            projectId: {
              type: "STRING",
              description: "The ID of the project to switch to.",
            },
            cardId: {
              type: "STRING",
              description: "Optional ID of the card to select.",
            },
            filename: {
              type: "STRING",
              description:
                "Optional filename of an image to view (requires cardId).",
            },
          },
          required: ["projectId"],
        },
      },
      {
        name: "listCardImages",
        description:
          "List all generated images for a specific card. Use this to discover existing art before generating new images or to find filenames for navigation.",
        parameters: {
          type: "OBJECT",
          properties: {
            projectId: { type: "STRING" },
            cardId: { type: "STRING" },
            includeArchived: {
              type: "BOOLEAN",
              description: "Include archived images in the list.",
            },
          },
          required: ["projectId", "cardId"],
        },
      },
    ],
  },
];

// --- Tool Execution Logic ---

export async function handleToolCall(
  name: string,
  args: any,
  dataService: DataService,
  dataRoot: string
): Promise<any> {
  try {
    logger.info(`[Tools] Executing tool: ${name}`);
    const startTime = Date.now();
    let result;

    switch (name) {
      case "listProjects":
        const projs = await dataService.getProjects();
        result = projs.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
        }));
        break;
      case "getProject":
        result = (await dataService.getProject(args.projectId)) || {
          error: "Project not found",
        };
        break;
      case "listCards":
        let projectsToList = [];
        if (args.projectId) {
          projectsToList.push({ id: args.projectId });
        } else {
          projectsToList = await dataService.getProjects();
        }

        const allCardsList = [];
        for (const p of projectsToList) {
          try {
            const cards = await dataService.getCards(p.id);
            allCardsList.push(
              ...cards.map((c) => ({
                id: c.id,
                name: c.name,
                projectId: c.projectId,
              }))
            );
          } catch {}
        }
        result = allCardsList;
        break;
      case "getCard": // Get cards
        const cards = await dataService.getCards(args.projectId);
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
          projectsToSearch = await dataService.getProjects();
        }

        const found = [];
        for (const p of projectsToSearch) {
          const projectCards = await dataService.getCards(p.id);
          const matches = projectCards.filter((c) =>
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
        const projects = await dataService.getProjects();
        const project = projects.find((p) => p.id === args.projectId);
        // If project not found, we might want to error,
        // or just fallback to hardcoded defaults "2:3" and "2K".

        const newCards = [];
        for (const cardData of args.cards) {
          const id = await dataService.generateCardId(args.projectId);
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
          await dataService.saveCard(newCard);
          newCards.push(newCard);
        }
        result = { created: newCards };
        break;
      case "updateCard":
        const allCards = await dataService.getCards(args.projectId);
        const card = allCards.find((c) => c.id === args.cardId);
        if (!card) {
          result = { error: "Card not found" };
        } else {
          Object.assign(card, args.updates);
          await dataService.saveCard(card);
          result = { updated: card };
        }
        break;
      case "updateProject":
        const projectToUpdate = await dataService.getProject(args.projectId);
        if (!projectToUpdate) {
          result = { error: "Project not found" };
        } else {
          Object.assign(projectToUpdate, args.updates);
          await dataService.saveProject(projectToUpdate);
          result = { updated: projectToUpdate };
        }
        break;
      case "generateImage":
        const pId = args.projectId;
        const cId = args.cardId;
        const proj = await dataService.getProject(pId);
        const c = (await dataService.getCards(pId)).find((x) => x.id === cId);

        if (!proj || !c) {
          result = { error: "Project or Card not found" };
        } else {
          // Changed: We now return a signal to the client to trigger generation.
          // This allows the frontend to show progress bars, toasts, etc.
          logger.info("[Tools] Delegating generation to client");
          result = {
            success: true,
            clientAction: "generateImage",
            projectId: pId,
            cardId: cId,
            promptOverride: args.promptOverride,
            count: args.count || 1,
            notifyOnCompletion: args.notifyOnCompletion || false,
            referenceImageIds: args.referenceImageIds,
            referenceImageFiles: args.referenceImageFiles,
            message: `Image generation started for: ${
              args.promptOverride || "default prompt"
            }. ${
              args.referenceImageFiles
                ? "Using " +
                  args.referenceImageFiles.length +
                  " reference images."
                : ""
            } This may take a bit of time.`,
          };
        }
        break;
      case "getGeneratedImage": {
        const { projectId, cardId, filename } = args;
        const cards = await dataService.getCards(projectId);
        const card = cards.find((c) => c.id === cardId);
        if (!card) {
          result = { error: "Card not found" };
          break;
        }

        const cardSubfolder = card.outputSubfolder || "default";
        const filePath = path.join(
          dataRoot,
          "projects",
          projectId,
          "assets",
          cardSubfolder,
          filename
        );

        try {
          const buffer = await fs.readFile(filePath);
          const ext = path.extname(filename).toLowerCase();
          const mimeType =
            ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
          result = {
            success: true,
            filename,
            message:
              "Image retrieved. The raw pixels are being infra-injected. Please acknowledge with: '[System: OK]'",
            inlineData: {
              mimeType,
              data: buffer.toString("base64"),
            },
          };
        } catch (e) {
          result = { error: "Could not read file: " + filename };
        }
        break;
      }
      case "navigateUI": {
        const cards = await dataService.getCards(args.projectId);
        const selectedCard = args.cardId
          ? cards.find((c) => c.id === args.cardId)
          : null;
        result = {
          success: true,
          clientAction: "navigateUI",
          projectId: args.projectId,
          cardId: args.cardId,
          cardName: selectedCard?.name,
          filename: args.filename, // Pass through for frontend
        };
        break;
      }
      case "listCardImages": {
        const { projectId, cardId, includeArchived } = args;
        const { images, count } = await dataService.listCardImages(
          projectId,
          cardId,
          includeArchived
        );

        result = {
          count,
          // Map to simpler format for LLM consumption
          images: images.map((img) => ({
            filename: img.filename,
            time: img.time.toISOString(),
            isFavorite: img.isFavorite,
            isArchived: img.isArchived,
          })),
        };
        break;
      }
      default:
        result = { error: "Unknown tool" };
    }

    const duration = Date.now() - startTime;
    logger.info(
      `[Tools] Tool ${name} executed in ${duration}ms. Result keys: ${Object.keys(
        result || {}
      ).join(", ")}`
    );
    return result;
  } catch (e: any) {
    logger.error(`[Tools] Error executing tool ${name}:`, e);
    return { error: e.message };
  }
}
