import fs from "fs";
import path from "path";
import archiver from "archiver";
import StreamZip from "node-stream-zip";
import { logger } from "./logger";

export interface ImportResult {
  success: boolean;
  message: string;
  projectId?: string;
  projectName?: string;
}

/**
 * Exports a project directory to a zip file (e.g. .artproj).
 * Uses 'archiver' for efficient streaming.
 */
export async function exportProject(
  projectPath: string,
  destinationPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.info(`Exporting project from ${projectPath} to ${destinationPath}`);

    const output = fs.createWriteStream(destinationPath);
    const archive = archiver("zip", {
      zlib: { level: 9 }, // Sets the compression level.
    });

    output.on("close", function () {
      logger.info(
        `Project export completed. Total bytes: ${archive.pointer()}`,
      );
      resolve();
    });

    archive.on("warning", function (err) {
      if (err.code === "ENOENT") {
        logger.warn("Archiver warning:", err);
      } else {
        reject(err);
      }
    });

    archive.on("error", function (err) {
      reject(err);
    });

    archive.pipe(output);

    // Append files from projectPath, putting them at the root of the zip
    archive.directory(projectPath, false);

    archive.finalize();
  });
}

/**
 * Imports a project zip file into the projects root directory.
 * Uses 'node-stream-zip' to handle large files and stream extraction.
 * Merges files: always overwrites if the zip version is newer (or just overwrites based on user pref).
 * User requested: "merging if the project already exists (always taking the newest version of each file)."
 */
export async function importProject(
  zipPath: string,
  projectsRoot: string,
): Promise<ImportResult> {
  try {
    logger.info(`Importing project from ${zipPath} into ${projectsRoot}`);

    const zip = new StreamZip.async({ file: zipPath });

    // Validate project structure and find project.json
    const entries = await zip.entries();
    const entryValues = Object.values(entries);

    if (entryValues.length === 0) {
      await zip.close();
      return { success: false, message: "The project file is empty." };
    }

    let projectJsonEntry = entryValues.find(
      (entry) =>
        entry.name === "project.json" || entry.name.endsWith("/project.json"),
    );

    if (!projectJsonEntry) {
      await zip.close();
      return {
        success: false,
        message: "Invalid project file: project.json not found.",
      };
    }

    // Read project.json
    const projectJsonBuffer = await zip.entryData(projectJsonEntry.name);
    const projectJsonContent = projectJsonBuffer.toString("utf8");
    let projectData;
    try {
      projectData = JSON.parse(projectJsonContent);
    } catch (e) {
      await zip.close();
      return {
        success: false,
        message: "Invalid project file: project.json is corrupted.",
      };
    }

    const projectId = projectData.id;
    // We want to extract to `projectsRoot/<projectId>`.
    const targetProjectDir = path.join(projectsRoot, projectId);

    if (!fs.existsSync(targetProjectDir)) {
      logger.info(`Creating new project directory: ${targetProjectDir}`);
      fs.mkdirSync(targetProjectDir, { recursive: true });
    }

    // Determine root folder inside zip (if any)
    const projectJsonDir = path.dirname(projectJsonEntry.name);

    // Iterate and extract/merge
    for (const entry of entryValues) {
      if (entry.isDirectory) {
        continue;
      }

      let relativePathInProject = entry.name;
      // Strip the potential root folder from the entry name if it exists in the zip
      if (projectJsonDir !== ".") {
        if (entry.name.startsWith(projectJsonDir + "/")) {
          relativePathInProject = entry.name.substring(
            projectJsonDir.length + 1,
          );
        } else {
          // Entry is outside the project structure we identified. Skip.
          continue;
        }
      }

      const targetFilePath = path.join(targetProjectDir, relativePathInProject);
      const targetDir = path.dirname(targetFilePath);

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      let shouldOverwrite = true;

      if (fs.existsSync(targetFilePath)) {
        const stats = fs.statSync(targetFilePath);
        const diskTime = stats.mtime;
        // zip entry time is usually reliable
        const zipTime = new Date(entry.time);

        if (zipTime < diskTime) {
          logger.info(`Skipping older file in zip: ${relativePathInProject}`);
          shouldOverwrite = false;
        }
      }

      if (shouldOverwrite) {
        // Extract specific entry
        await zip.extract(entry.name, targetFilePath);

        // Restore timestamp
        const time = new Date(entry.time);
        try {
          fs.utimesSync(targetFilePath, time, time);
        } catch (e) {
          logger.warn(`Failed to set timestamp for ${targetFilePath}`, e);
        }
      }
    }

    await zip.close();

    return {
      success: true,
      message: "Project imported successfully.",
      projectId: projectId,
      projectName: projectData.name,
    };
  } catch (err: any) {
    logger.error("Error importing project:", err);
    return {
      success: false,
      message: err.message || "Unknown error during import",
    };
  }
}
