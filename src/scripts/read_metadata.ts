import { exiftool } from "exiftool-vendored";
import path from "path";
import fs from "fs";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: yarn metadata <path_to_image>");
    process.exit(1);
  }

  const imagePath = args[0];
  const absolutePath = path.resolve(imagePath);

  if (!fs.existsSync(absolutePath)) {
    console.error(`Error: File not found at ${absolutePath}`);
    process.exit(1);
  }

  console.log(`Reading metadata for: ${absolutePath}`);
  console.log("----------------------------------------");

  try {
    const tags: any = await exiftool.read(absolutePath);

    // Filter out binary data or overly verbose fields if needed,
    // but for now, let's show everything relevant.
    // Specially highlight our custom XMP:UserComment

    if (tags["XMP:UserComment"]) {
      console.log("\n[AI Art Cards Generation Data]:");
      try {
        const data = JSON.parse(tags["XMP:UserComment"] as string);
        console.log(JSON.stringify(data, null, 2));
      } catch (e) {
        console.log("Raw XMP:UserComment:", tags["XMP:UserComment"]);
      }
    }

    console.log("\n[All Metadata]:");
    // Remove binary data to keep output clean-ish
    const cleanTags: any = {};
    for (const [key, value] of Object.entries(tags)) {
      if (
        key === "ThumbnailImage" ||
        key === "PreviewImage" ||
        key.includes("Binary")
      ) {
        cleanTags[key] = "[Binary Data Omitted]";
      } else {
        cleanTags[key] = value;
      }
    }
    console.log(cleanTags);
  } catch (err) {
    console.error("Error reading metadata:", err);
  } finally {
    await exiftool.end();
  }
}

main();
