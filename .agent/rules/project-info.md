# AI Art Cards - Project Info

## Overview
AI Art Cards is a local web and desktop application for managing and generating consistent AI artwork for card games (e.g., Tarot, Poker, TCGs). It uses a project-based structure where "Cards" belong to "Projects" and inherit configuration settings. It can be run as a standard Node.js web server or as a standalone Electron desktop app.

## Technology Stack
- **Runtime**: Node.js / Electron
- **Backend**: Express (TypeScript)
- **Frontend**: Vanilla JavaScript, HTML5, CSS3 (Variables-based Dark Mode)
- **Desktop Wrapper**: Electron (with `electron-builder` and `electron-updater`)
- **AI Service**: Google Gemini API (`gemini-1.5-flash` or `gemini-1.5-pro`) via `@google/generative-ai`
- **Image Processing**: `exiftool-vendored` for metadata reading
- **Persistence**: JSON files for configuration, File System for images

## Directory Structure
- `src/server.ts`: Main Express application entry point. Handles API routes.
- `src/electron.ts`: Electron main process entry point.
- `src/lib/`:
    - `image_generator.ts`: Wrapper around Gemini API. Handles safety checks, prompt enhancement (if any), and image buffer creation.
    - `data_service.ts`: CRUD operations for Projects and Cards. Manages JSON file reading/writing.
- `src/public/`: Static frontend assets.
    - `app.js`: Single-page application logic. Handles state, routing (via URL params), and API interaction.
    - `index.html`: Main UI layout.
    - `styles.css`: CSS definitions.
- `data/`:
    - `projects/*.json`: Project definitions.
    - `cards/*.json`: Card definitions.
    - `keys.json`: Named API keys (Git-ignored).
    - `output/`: **Jailed Root** for all generated images. Subfolders determined by `project.outputRoot` and `card.outputSubfolder`.
- `release/`: Output directory for Electron builds (DMG, Zip).
- `scripts/`:
    - `notarize.js`: macOS notarization script for Gatekeeper.
    - `release.sh`: Release automation script.

## Core Concepts

### Projects
- Configurable defaults: `defaultAspectRatio`, `defaultResolution`, `outputRoot`.
- Global prompt prefix/suffix applied to all cards in the project.
- IDs are immutable once created.

### Cards
- Belong to a specific `projectId`.
- Have unique IDs generated via `nanoid` (e.g., `card_1bk2p6m1oo`).
- Configurable overrides: `aspectRatio`, `resolution` (take precedence over Project defaults).
- `imageCount`: Dynamically calculated by scanning the filesystem.
- `archivedImages`: List of filenames to exclude from the gallery.

### Image Generation
- **Prompt Construction**: `Project.globalPrefix` + `Card.prompt` + `Project.globalSuffix` + `Override Input`.
- **Concurrency**: Frontend handles parallel requests for `count > 1`, showing individual Toast notifications.
- **Safety**: Code explicitly handles `finishReason: SAFETY` and other block reasons from Gemini.

## API Endpoints
- `GET /api/projects`: List all projects.
- `GET /api/projects/:id/cards`: List cards for a project (enriches with `imageCount`).
- `POST /api/generate`: Trigger image generation. Accepts `promptOverride`, `arOverride`, `resOverride`.
- `GET /api/keys` / `POST /api/config`: Manage API keys.
- `GET /api/image-metadata`: Read EXIF data (prompt, date) from a specific image file.
- `POST /api/cards/:cardId/archive`: Soft-delete an image (hide from UI).

## Development Rules
1.  **Security**: All file access must be restricted to `data/output`. Use `path.resolve` and verify `startsWith` to prevent directory traversal.
2.  **State**: Key application state (Project, Card) should be reflected in URL query parameters (`?project=...&card=...`) to support reloading and sharing.
3.  **UI**: Use Toast notifications for async feedback. Avoid blocking alerts.
