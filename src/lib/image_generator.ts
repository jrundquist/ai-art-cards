import { GoogleGenerativeAI } from "@google/generative-ai";
import mime from "mime";
import fs from "fs/promises";
import path from "path";
import { exiftool } from "exiftool-vendored";

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
    } = {}
  ): Promise<{ buffer: Buffer; mimeType: string }> {
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
        parts: [{ text: `Aspect Ratio: ${aspectRatio}\n\n${prompt}` }],
      },
    ];

    try {
      const result = await model.generateContentStream({ contents });
      for await (const chunk of result.stream) {
        // Check Prompt Feedback (safety block on input)
        if (chunk.promptFeedback?.blockReason) {
          throw new Error(
            `Safety: ${chunk.promptFeedback.blockReason} (Prompt Blocked)`
          );
        }

        if (!chunk.candidates?.[0]) continue;
        const candidate = chunk.candidates[0];

        if (candidate.finishReason === "SAFETY") {
          throw new Error("Safety: Image generation blocked by filters.");
        }

        if (candidate.finishReason && candidate.finishReason !== "STOP") {
          // Other reasons: RECITATION, OTHER
          throw new Error(`Generation stopped: ${candidate.finishReason}`);
        }

        if (!candidate.content?.parts) continue;
        const parts = candidate.content.parts;
        for (const part of parts) {
          if (part.inlineData) {
            const mimeType = part.inlineData.mimeType || "image/png";
            const buffer = Buffer.from(part.inlineData.data || "", "base64");
            return { buffer, mimeType };
          }
        }
      }
      throw new Error("No images received from API (Unknown Reason).");
    } catch (error) {
      console.error("Gemini Generation Error:", (error as Error).message);
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
    } = {}
  ): Promise<string> {
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
        fileExtension
      );
      const finalFilename = `${filename}_v${nextVersion}.${fileExtension}`;
      finalOutputPath = path.join(outputFolder, finalFilename);

      try {
        // 'wx' flag fails if file exists
        await fs.writeFile(finalOutputPath, buffer, { flag: "wx" });
        saved = true;
      } catch (e: any) {
        if (e.code === "EEXIST") {
          attempts++;
          // Small delay to reduce contention
          await new Promise((resolve) =>
            setTimeout(resolve, 50 + Math.random() * 50)
          );
        } else {
          throw e;
        }
      }
    }

    if (!saved) {
      throw new Error(
        `Failed to save image after ${attempts} attempts due to file collisions.`
      );
    }

    // Metadata
    try {
      await exiftool.write(
        finalOutputPath,
        {
          Title: metadata.title || filename,
          Description: prompt,
          UserComment: `Project: ${metadata.project} | CardID: ${metadata.cardId}`,
          Software: "ai-art-cards",
        },
        { writeArgs: ["-overwrite_original"] }
      );
    } catch (e) {
      console.warn("Metadata warning:", e);
    }

    return finalOutputPath;
  }

  private async getNextVersion(
    dir: string,
    name: string,
    ext: string
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
