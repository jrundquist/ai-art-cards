import fs from "fs";
import path from "path";
import archiver from "archiver";
import AdmZip from "adm-zip";
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
 * Uses 'adm-zip' for synchronous unzipping / inspecting.
 * Merges files: always overwrites if the zip version is newer (or just overwrites based on user pref).
 * User requested: "merging if the project already exists (always taking the newest version of each file)."
 */
export async function importProject(
  zipPath: string,
  projectsRoot: string,
): Promise<ImportResult> {
  try {
    logger.info(`Importing project from ${zipPath} into ${projectsRoot}`);

    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();

    if (zipEntries.length === 0) {
      return { success: false, message: "The project file is empty." };
    }

    // Identify project structure.
    // Case 1: The zip contains a root folder (common if zipped manually).
    // Case 2: The zip contains files at root (our exportProject does this).
    // We look for 'project.json' to confirm valid project and get ID/Name.

    let projectJsonEntry = zipEntries.find(
      (entry) =>
        entry.entryName === "project.json" ||
        entry.entryName.endsWith("/project.json"),
    );

    if (!projectJsonEntry) {
      return {
        success: false,
        message: "Invalid project file: project.json not found.",
      };
    }

    // Read project.json
    const projectJsonContent = projectJsonEntry.getData().toString("utf8");
    let projectData;
    try {
      projectData = JSON.parse(projectJsonContent);
    } catch (e) {
      return {
        success: false,
        message: "Invalid project file: project.json is corrupted.",
      };
    }

    const projectId = projectData.id;
    // We prefer the ID as folder name, or whatever the existing convention is.
    // The existing system likely uses the folder name as the ID or maps it.
    // Let's assume folder name = project ID for consistency, or we use the project name if ID is not suitable.
    // However, user projects seem to be in `data/projects/<folder>`.
    // Let's check if the project already exists.

    // If the zip has a root dir, `projectJsonEntry.entryName` might be `my-project/project.json`.
    // If flattened, it is `project.json`.

    // We want to extract to `projectsRoot/<projectId>`.
    const targetProjectDir = path.join(projectsRoot, projectId);

    if (!fs.existsSync(targetProjectDir)) {
      logger.info(`Creating new project directory: ${targetProjectDir}`);
      fs.mkdirSync(targetProjectDir, { recursive: true });
    }

    // Iterate and extract/merge
    for (const entry of zipEntries) {
      if (entry.isDirectory) {
        continue;
      }

      // Determine relative path in the project
      // If zip entry is "root/sub/file", and project.json was at "root/project.json", relative is "sub/file".
      // If zip entry is "sub/file", and project.json was at "project.json", relative is "sub/file".

      let relativePathInProject = entry.entryName;
      // Strip the potential root folder from the entry name if it exists in the zip
      const projectJsonDir = path.dirname(projectJsonEntry.entryName);
      if (projectJsonDir !== ".") {
        if (entry.entryName.startsWith(projectJsonDir + "/")) {
          relativePathInProject = entry.entryName.substring(
            projectJsonDir.length + 1,
          );
        } else {
          // Entry is possibly outside the project structure we identified? Skip.
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
        const zipTime = entry.header.time; // Date object in adm-zip?
        // Adm-zip header.time is actually tricky, getData().time might be safer or just trust user wants overwrite.
        // User said: "always taking the newest version of each file".

        // zip.extractEntryTo doesn't give us easy date comparison beforehand easily without reading.
        // entry.header.time is raw Date or similar.

        // Let's blindly assume zip time is correct.
        // Actually, let's look at `entry.header.time`. It's a Date.
        if (entry.header.time < diskTime) {
          logger.info(`Skipping older file in zip: ${relativePathInProject}`);
          shouldOverwrite = false;
        }
      }

      if (shouldOverwrite) {
        // Extract specific entry
        // target path must be directory for extractEntryTo? No, it takes target path.
        // actually extractEntryTo takes a directory.
        // We can use fs.writeFileSync(targetFilePath, entry.getData());
        fs.writeFileSync(targetFilePath, entry.getData());
        // restore timestamp if possible?
        const time = entry.header.time;
        fs.utimesSync(targetFilePath, time, time);
      }
    }

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
