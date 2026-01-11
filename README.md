# AICardArts

A powerful, local web and desktop application for generating and managing consistent AI artwork for card collections (Tarot, TCGs, etc.) using the Google Gemini API.

## Features

-   **Project-Based Organization**: Group your cards into projects (e.g., "Cyberpunk Deck", "Tarot V2").
-   **Consistent Style**: Define global prompt prefixes and suffixes per project to ensure style consistency across all cards.
-   **Modern AI Interface**:
    -   Sleek, dark-themed UI with glassmorphism and animations.
    -   Responsive and immersive design.
-   **Configurable Generation**:
    -   Set Defaults: Define default Aspect Ratio and Resolution for the entire project.
    -   Overrides: Override settings on a per-card basis.
    -   **Parallel Generation**: Generate 1-10 images at once with live status updates.
-   **Gallery & Archive**:
    -   View all generated images for a selected card.
    -   Click to view details (Prompt, Date).
    -   Archive unwanted images to hide them from the view.
-   **Desktop Application (Electron)**:
    -   Run as a standalone native app on macOS (and other platforms).
    -   **Auto-Updates**: Automatically checks for and creates updates via GitHub Releases.
    -   **Native Integration**: dedicated menus, dock icon, and window management.
-   **Secure & Local**:
    -   API Keys are stored locally (`data/keys.json`) and never shared.
    -   Generated images are saved securely to your local disk (`data/output/`).

## Setup & Installation

1.  **Prerequisites**:
    -   Node.js (v18 or higher recommended)
    -   Yarn or NPM

2.  **Install Dependencies**:
    ```bash
    yarn install
    ```

3.  **Start the Server**:
    ```bash
    yarn dev
    ```
    The application will run at [http://localhost:5432](http://localhost:5432).

4.  **Desktop Application**:
    This project can also be run as a standalone Desktop App (Electron).

    **To run in dev mode:**
    ```bash
    yarn electron:dev
    ```

    **To build for your OS:**
    ```bash
    yarn dist
    ```

    **To build specifically for macOS (DMG + Zip):**
    ```bash
    yarn build:mac
    ```
    The packaged app will be created in `release/`. For Mac, look in `release/mac-arm64/` (or `mac/`).
    You can send the `.zip` or `.dmg` file to your partner.

5.  **Auto-Updater**:
    The app is configured to check for updates from the GitHub repository (`jrundquist/ai-art-cards`).
    *   **Release**:
        1.  Restart your terminal with your GitHub token: `export GH_TOKEN=your_token`
        2.  Run the automation script:
            ```bash
            yarn release
            ```
        3.  Follow the prompts to select the version bump (patch, minor, major).
        4.  The script will automatically build, upload the artifacts to GitHub Releases, and push the tags.

## User Guide

### 1. API Keys
When you first load the app, click the **(+)** button next to the key selector (top right). Enter a name (e.g., "My Gemini Key") and your API key. Keys are saved locally.

### 2. Projects
-   Click **+ New Project** in the sidebar.
-   **ID**: A unique, short identifier (e.g., `forest-spirits`). Cannot be changed later.
-   **Output Dir**: Subfolder in `data/output` where images will be saved.
-   **Global Prefix/Suffix**: Text automatically appended to every prompt (e.g., "A mystical forest spirit card art, oil painting style...").

### 3. Cards
-   Select a project, then click **+ New Card**.
-   **Prompt**: Describe the specific subject (e.g., "The Queen of Leaves").
-   **Previews**: The "Preview" box shows you exactly what text will be sent to the AI.
-   **Overrides**: If this specific card needs a different Aspect Ratio (e.g., it's a landscape card), change it in the sidebar.

### 4. Generating Art
-   Select a card.
-   Enter an optional "Idea/Concept" in the text box if you want to temporarily tweak the prompt (this overrides the card info for this run).
-   Set the **Count** (1-10).
-   Click **Generate Art**.
-   Images will appear in the gallery below.

### 5. Managing Images
-   **View Details**: Click any image to see its metadata and the exact prompt used to generate it.
-   **Archive**: If an image isn't right, click "Archive" in the details modal to hide it.
-   **Search**: Use the search bar in the card list to quickly find cards by name.

## Configuration Updates
To edit a Project's settings later, select the project and click the **Settings Cog (⚙️)** next to the title. Note that Project IDs cannot be changed.

## Troubleshooting
-   **Status Bar**: Watch the toast notifications at the bottom right for errors (e.g., "Safety Block" means the AI refused the prompt).
-   **Logs**: The terminal where you ran `yarn dev` shows detailed logs of every request, including the full prompt sent to Gemini.
