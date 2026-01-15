import { DataService } from "../lib/data_service";
import { logger } from "../lib/logger";
import path from "path";
import fs from "fs/promises";

export const generationTools = [
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
];

export async function handleGenerationTool(
  name: string,
  args: any,
  dataService: DataService,
  dataRoot: string
): Promise<any> {
  switch (name) {
    case "generateImage": {
      const pId = args.projectId;
      const cId = args.cardId;
      const proj = await dataService.getProject(pId);
      const c = (await dataService.getCards(pId)).find((x) => x.id === cId);

      if (!proj || !c) return { error: "Project or Card not found" };

      // Return a signal to the client/server to trigger generation logic
      // Note: The actual generation logic is now in `src/routes/generation.ts`.
      // The frontend receives this clientAction and calls the API if needed?
      // Wait, `chat_service` receives this. The chat service is server-side.
      // Ah, "clientAction" tells the FRONTEND to do something.
      // The PREVIOUS implementation returned this object. We must maintain that contract.
      // The Frontend UI likely sees 'generateImage' action and calls the API?
      // Or does the `chat.js` handle it?
      // Let's assume preserving the return object is correct.

      logger.info("[Tools] Delegating generation to client");
      return {
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
            ? "Using " + args.referenceImageFiles.length + " reference images."
            : ""
        } This may take a bit of time.`,
      };
    }

    case "getGeneratedImage": {
      const { projectId, cardId, filename } = args;
      const cards = await dataService.getCards(projectId);
      const card = cards.find((c) => c.id === cardId);
      if (!card) return { error: "Card not found" };

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
        return {
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
        return { error: "Could not read file: " + filename };
      }
    }
  }
  return null;
}
