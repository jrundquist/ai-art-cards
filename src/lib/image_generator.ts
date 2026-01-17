import { GoogleGenerativeAI } from "@google/generative-ai";
import mime from "mime";
import fs from "fs/promises";
import path from "path";
import { exiftool } from "exiftool-vendored";
import { logger } from "./logger";

export class ImageGenerator {
  private genAI: GoogleGenerativeAI;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async generateImageBuffer(
    prompt: string,
    options: {
      aspectRatio?: string;
      resolution?: string;
      referenceImages?: { buffer: Buffer; mimeType: string }[];
    } = {},
  ): Promise<{ buffer: Buffer; mimeType: string; modelName: string }> {
    const modelName = "gemini-3-pro-image-preview";
    const aspectRatio = options.aspectRatio || "auto";
    const imageSize = options.resolution || "1K"; // Default 1K

    const model = this.genAI.getGenerativeModel({
      model: modelName,
      // @ts-ignore
      tools: [{ googleSearch: {} }],
      generationConfig: {
        responseModalities: ["IMAGE", "TEXT"],
        imageConfig: {
          aspectRatio: aspectRatio,
          imageSize: imageSize,
        },
      } as any,
    });

    const contents = [
      {
        role: "user",
        parts: [
          ...(options.referenceImages || []).map((img) => ({
            inlineData: {
              mimeType: img.mimeType,
              data: img.buffer.toString("base64"),
            },
          })),
          { text: `${prompt}` },
        ],
      },
    ];

    logger.info(
      `[ImageGenerator] Starting generation with model: ${modelName}`,
    );
    logger.info(`[ImageGenerator] Config: AR=${aspectRatio}, Res=${imageSize}`);
    if (options.referenceImages?.length) {
      logger.info(
        `[ImageGenerator] Including ${options.referenceImages.length} reference images.`,
      );
      options.referenceImages.forEach((img, i) => {
        logger.info(
          `[ImageGenerator] Ref Image ${i + 1}: ${
            img.buffer.length
          } bytes (type: ${img.mimeType})`,
        );
      });
    }

    // Deep debug of contents structure
    logger.info(
      `[ImageGenerator] Payload Parts Count: ${contents[0].parts.length}`,
    );
    contents[0].parts.forEach((p: any, i) => {
      if (p.text)
        logger.info(
          `[ImageGenerator] Part ${i}: TEXT ("${p.text.substring(0, 50)}...")`,
        );
      if (p.inlineData)
        logger.info(
          `[ImageGenerator] Part ${i}: INLINE_DATA (mime: ${p.inlineData.mimeType}, data_len: ${p.inlineData.data.length})`,
        );
    });

    try {
      const result = await model.generateContentStream({ contents });
      let chunkCount = 0;
      for await (const chunk of result.stream) {
        chunkCount++;
        // Check Prompt Feedback (safety block on input)
        if (chunk.promptFeedback?.blockReason) {
          logger.error(
            `[ImageGenerator] Prompt blocked: ${chunk.promptFeedback.blockReason}`,
          );
          throw new Error(
            `Safety: ${chunk.promptFeedback.blockReason} (Prompt Blocked)`,
          );
        }

        if (!chunk.candidates?.[0]) continue;
        const candidate = chunk.candidates[0];

        if (candidate.finishReason === "SAFETY") {
          logger.error(
            `[ImageGenerator] Generation blocked by safety filters.`,
          );
          throw new Error("Safety: Image generation blocked by filters.");
        }

        if (candidate.finishReason && candidate.finishReason !== "STOP") {
          // Other reasons: RECITATION, OTHER
          logger.warn(
            `[ImageGenerator] Generation stopped: ${candidate.finishReason}`,
          );
          throw new Error(`Generation stopped: ${candidate.finishReason}`);
        }

        if (!candidate.content?.parts) continue;
        const parts = candidate.content.parts;
        for (const part of parts) {
          if (part.inlineData) {
            const mimeType = part.inlineData.mimeType || "image/png";
            const buffer = Buffer.from(part.inlineData.data || "", "base64");
            logger.info(
              `[ImageGenerator] Image received (mime: ${mimeType}, size: ${buffer.length} bytes)`,
            );
            return { buffer, mimeType, modelName };
          }
        }
      }
      logger.error(
        `[ImageGenerator] No images received after ${chunkCount} chunks.`,
      );
      throw new Error("No images received from API (Unknown Reason).");
    } catch (error) {
      logger.error("Gemini Generation Error:", (error as Error).message);
      throw error;
    }
  }

  async saveImage(
    buffer: Buffer,
    mimeType: string,
    outputFolder: string,
    filename: string, // Base filename without version or ext
    prompt: string,
    metadata: {
      title?: string;
      project?: string;
      cardId?: string;
      generationArgs?: any;
    } = {},
  ): Promise<string> {
    logger.info(`[ImageGenerator] Saving image to: ${outputFolder}`);
    await fs.mkdir(outputFolder, { recursive: true });

    // Versioning logic
    const fileExtension = mime.getExtension(mimeType) || "png";
    let finalOutputPath = "";
    let saved = false;
    let attempts = 0;

    // Retry loop to handle race conditions with version numbers
    while (!saved && attempts < 10) {
      const nextVersion = await this.getNextVersion(
        outputFolder,
        filename,
        fileExtension,
      );
      const finalFilename = `${filename}_v${nextVersion}.${fileExtension}`;
      finalOutputPath = path.join(outputFolder, finalFilename);

      try {
        // 'wx' flag fails if file exists
        logger.info(
          `[ImageGenerator] Attempting to save version ${nextVersion}: ${finalFilename}`,
        );
        await fs.writeFile(finalOutputPath, buffer, { flag: "wx" });
        saved = true;
        logger.info(
          `[ImageGenerator] Successfully saved to: ${finalOutputPath}`,
        );
      } catch (e: any) {
        if (e.code === "EEXIST") {
          logger.warn(
            `[ImageGenerator] File exists (version ${nextVersion}), retrying...`,
          );
          attempts++;
          // Small delay to reduce contention
          await new Promise((resolve) =>
            setTimeout(resolve, 50 + Math.random() * 50),
          );
        } else {
          throw e;
        }
      }
    }

    if (!saved) {
      throw new Error(
        `Failed to save image after ${attempts} attempts due to file collisions.`,
      );
    }

    // Metadata - Fire and forget to avoid blocking the generation loop
    exiftool
      .write(
        finalOutputPath,
        {
          "XMP-dc:Title": metadata.title || "Generated Image",
          "XMP-dc:Description": prompt,
          "XMP-dc:Creator": "AI Art Cards (Gemini 3 Pro)",
          "XMP-exif:Model": metadata.generationArgs?.model || "Gemini 3 Pro",
          // Store generation args in XMP UserComment for structured retrieval
          "XMP:UserComment": metadata.generationArgs
            ? JSON.stringify(metadata.generationArgs)
            : `Project: ${metadata.project} | CardID: ${metadata.cardId}`,
          Software: "ai-art-cards",
        } as any,
        { writeArgs: ["-overwrite_original"] },
      )
      .then(() => {
        logger.info(
          `[ImageGenerator] Metadata written successfully to: ${finalOutputPath}`,
        );
      })
      .catch((e) => {
        logger.warn(`[ImageGenerator] Metadata write failed:`, e);
      });

    return finalOutputPath;
  }

  private async getNextVersion(
    dir: string,
    name: string,
    ext: string,
  ): Promise<string> {
    try {
      const files = await fs.readdir(dir);
      const versions = files
        .filter((f) => f.startsWith(name))
        .map((f) => {
          const match = f.match(/_v(\d+)\./);
          return match ? parseInt(match[1]) : 0;
        })
        .sort((a, b) => b - a);
      return ((versions[0] || 0) + 1).toString().padStart(3, "0");
    } catch {
      return "001";
    }
  }
}
