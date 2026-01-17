import { state } from "./state.js";
import { dom, showStatus, toggleSidebar } from "./ui.js";
import * as api from "./api.js";
import * as projectCtrl from "./controllers/projectController.js";
import * as cardCtrl from "./controllers/cardController.js";
import * as galleryCtrl from "./controllers/galleryController.js";
import { bracketController } from "./controllers/bracketController.js";

import { ChatManager } from "./chat.js";
import { statusService } from "./statusService.js";
import * as theme from "./theme.js";

// Key Management Logic
async function loadKeys() {
  const keys = await api.fetchKeys();
  dom.inputs.keySelect.innerHTML =
    '<option value="">Select API Key...</option>';
  keys.forEach((k) => {
    const opt = document.createElement("option");
    opt.value = k.key;
    opt.textContent = k.name;
    dom.inputs.keySelect.appendChild(opt);
  });

  // Highlight if no keys
  if (keys.length === 0) {
    dom.btns.addKeyToggle.classList.add("pulse-highlight");
  } else {
    dom.btns.addKeyToggle.classList.remove("pulse-highlight");
  }

  updateKeyHighlight();

  const lastName = localStorage.getItem("lastApiKeyName");
  if (lastName) {
    const option = Array.from(dom.inputs.keySelect.options).find(
      (o) => o.text === lastName,
    );
    if (option) {
      dom.inputs.keySelect.value = option.value;
      await api.saveConfig({ apiKey: option.value });
      updateKeyHighlight();
    }
  }
}

function updateKeyHighlight() {
  const hasKeys = dom.inputs.keySelect.options.length > 1;
  const isSelected = dom.inputs.keySelect.value !== "";
  const wrapper = document.getElementById("keySelectWrapper");

  if (wrapper) {
    if (hasKeys && !isSelected) {
      wrapper.classList.add("pulse-highlight");
    } else {
      wrapper.classList.remove("pulse-highlight");
    }
  }
}

// Global instance
const chatManager = new ChatManager();

async function init() {
  // --- Sidebar Resizing Logic ---
  const sidebar = document.getElementById("sidebar");
  const resizeHandle = document.getElementById("sidebarResizeHandle");
  const storedSidebarWidth = localStorage.getItem("sidebarWidth");

  if (storedSidebarWidth) {
    sidebar.style.width = storedSidebarWidth;
    sidebar.style.flex = "none"; // Ensure flex doesn't override
  }

  if (resizeHandle) {
    let isResizing = false;

    resizeHandle.addEventListener("mousedown", (e) => {
      isResizing = true;
      resizeHandle.classList.add("active");
      document.body.style.cursor = "col-resize";
      e.preventDefault(); // Prevent text selection
    });

    document.addEventListener("mousemove", (e) => {
      if (!isResizing) return;

      // Calculate new width
      let newWidth = e.clientX;

      // Constraints
      if (newWidth < 200) newWidth = 200;
      if (newWidth > 500) newWidth = 500;

      sidebar.style.width = `${newWidth}px`;
      sidebar.style.flex = "none";
    });

    document.addEventListener("mouseup", () => {
      if (isResizing) {
        isResizing = false;
        resizeHandle.classList.remove("active");
        document.body.style.cursor = "";
        localStorage.setItem("sidebarWidth", sidebar.style.width);
      }
    });
  }
  // ------------------------------

  // Load initial data
  await loadKeys();
  await projectCtrl.loadProjects();
  // Initial Context if project loaded
  if (state.currentProject) {
    chatManager.onProjectSelected(state.currentProject.id);
  } else {
    // Global mode: still load conversations
    chatManager.loadConversationList();
    toggleSidebar(false);
  }
  dom.projectSelect.addEventListener("change", async () => {
    projectCtrl.onProjectSelect(true);
    // Update Chat Context
    if (state.currentProject) {
      chatManager.onProjectSelected(state.currentProject.id);
    }
  });

  // Listen for data refresh from chat
  document.addEventListener("cards-updated", async () => {
    if (state.currentProject) {
      const currentCardId = state.currentCard ? state.currentCard.id : null;
      // Reload cards
      await projectCtrl.onProjectSelect(false);

      // Re-select current card to update UI with fresh data if it still exists
      if (currentCardId) {
        const updatedCard = state.allCards.find((c) => c.id === currentCardId);
        if (updatedCard) {
          cardCtrl.selectCard(updatedCard, false);
        }
      }
    }
  });

  document.addEventListener("projects-updated", async () => {
    console.log("Main: projects-updated event received");
    const currentPid = state.currentProject ? state.currentProject.id : null;
    await projectCtrl.loadProjects();

    if (currentPid) {
      // Persist current card across project reload
      const currentCardId = state.currentCard ? state.currentCard.id : null;
      dom.projectSelect.value = currentPid;
      await projectCtrl.onProjectSelect(false);

      if (currentCardId) {
        const card = state.allCards?.find((c) => c.id === currentCardId);
        if (card) {
          cardCtrl.selectCard(card, false);
        }
      }
    }
  });

  document.addEventListener("card-starred", () => {
    cardCtrl.filterCards();
  });

  // Initialize Status Service for SSE notifications
  statusService.connect();

  // Listen for generation completion to refresh gallery
  document.addEventListener("generation-completed", async (e) => {
    const { cardId } = e.detail;

    // Refresh gallery if this is the current card
    if (state.currentCard && state.currentCard.id === cardId) {
      await galleryCtrl.loadImagesForCard(state.currentProject.id, cardId);
    }

    // Status bar is now handled by statusService based on active jobs
  });

  // Listen for Chat Image Navigation
  document.addEventListener("request-view-image", async (e) => {
    console.log("[Main] Received request-view-image event:", e.detail);
    const { projectId, cardId, filename } = e.detail;

    // Check state matching
    const currentProjectId = state.currentProject
      ? state.currentProject.id
      : "null";
    const currentCardId = state.currentCard ? state.currentCard.id : "null";

    console.log(
      `[Main] Validation: Project(${currentProjectId} vs ${projectId}), Card(${currentCardId} vs ${cardId})`,
    );

    if (
      state.currentProject &&
      state.currentProject.id === projectId &&
      state.currentCard &&
      state.currentCard.id === cardId
    ) {
      // Construct the URL.
      // Cards store images in a subfolder defined by card.outputSubfolder or card.name (sanitized).
      // Ideally, we should use the card's data to get this.
      const subfolder =
        state.currentCard.outputSubfolder ||
        state.currentCard.name.replace(/\s+/g, "_");
      const imgUrl = `data/projects/${projectId}/assets/${subfolder}/${filename}`;

      console.log("[Main] Opening image details for:", imgUrl);

      try {
        galleryCtrl.openImageDetails(imgUrl);
      } catch (err) {
        console.error("[Main] Error in galleryCtrl.openImageDetails:", err);
      }
    } else {
      console.warn("[Main] Event logic skipped due to state mismatch.");
    }
  });

  // Electron Navigation Integration
  if (window.electronAPI && window.electronAPI.onNavigateToCard) {
    window.electronAPI.onNavigateToCard(async (projectId, cardId) => {
      if (!state.currentProject || state.currentProject.id !== projectId) {
        dom.projectSelect.value = projectId;
        await projectCtrl.onProjectSelect(false);
      }

      const card = state.allCards?.find((c) => c.id === cardId);
      if (card) {
        cardCtrl.selectCard(card, true);
      }
    });
  }

  // Help & OOB
  if (dom.btns.help) {
    dom.btns.help.addEventListener("click", () => {
      dom.helpModal.self.classList.remove("hidden");
    });
  }
  if (dom.helpModal.close) {
    dom.helpModal.close.addEventListener("click", () => {
      dom.helpModal.self.classList.add("hidden");
    });
  }
  if (dom.helpModal.self) {
    dom.helpModal.self.addEventListener("click", (e) => {
      if (e.target === dom.helpModal.self) {
        dom.helpModal.self.classList.add("hidden");
      }
    });
  }

  // OOB Check: If no projects, show help
  if (state.projects.length === 0) {
    dom.helpModal.self.classList.remove("hidden");
  }

  // Electron Open Folder Integration
  if (window.electronAPI && dom.openFolderBtn) {
    dom.openFolderBtn.classList.remove("hidden");
    dom.openFolderBtn.addEventListener("click", async () => {
      try {
        let path = undefined;
        if (state.currentProject) {
          const pRoot = state.currentProject.outputRoot || "default";
          path = `output/${pRoot}`;
        }
        await window.electronAPI.openDataFolder(path);
      } catch (e) {
        showStatus("Failed to open folder", "error");
      }
    });
  }

  // Key Modal Interactions
  dom.btns.addKeyToggle.addEventListener("click", () => {
    dom.keyModal.self.classList.remove("hidden");
    dom.keyModal.name.focus();
  });

  dom.keyModal.cancel.addEventListener("click", () => {
    dom.keyModal.self.classList.add("hidden");
  });

  // Close on backdrop click
  dom.keyModal.self.addEventListener("click", (e) => {
    if (e.target === dom.keyModal.self) {
      dom.keyModal.self.classList.add("hidden");
    }
  });

  // Save Key Logic
  dom.keyModal.save.addEventListener("click", async () => {
    const name = dom.keyModal.name.value.trim();
    const key = dom.keyModal.value.value.trim();
    if (key && name) {
      await api.saveConfig({ apiKey: key, name });
      dom.keyModal.self.classList.add("hidden");
      dom.keyModal.name.value = "";
      dom.keyModal.value.value = "";
      await loadKeys();
      dom.inputs.keySelect.value = key; // Select the new key

      // Refresh chat list if project is active
      if (state.currentProject) {
        chatManager.onProjectSelected(state.currentProject.id);
      }

      showStatus("API Key Saved", "success");
    } else {
      showStatus("Please enter both Name and Key", "error");
    }
  });

  dom.inputs.keySelect.addEventListener("change", async () => {
    const key = dom.inputs.keySelect.value;
    if (key) {
      const name =
        dom.inputs.keySelect.options[dom.inputs.keySelect.selectedIndex].text;
      localStorage.setItem("lastApiKeyName", name);
      await api.saveConfig({ apiKey: key });
    }
    updateKeyHighlight();
  });

  if (window.electronAPI && dom.btns.openCardFolder) {
    dom.btns.openCardFolder.classList.remove("hidden");
    dom.btns.openCardFolder.addEventListener("click", async () => {
      if (!state.currentProject || !state.currentCard) return;
      const pRoot = state.currentProject.outputRoot || "default";
      const cSub = state.currentCard.outputSubfolder || "default";
      const relPath = `output/${pRoot}/${cSub}`;

      try {
        await window.electronAPI.openDataFolder(relPath);
      } catch (e) {
        showStatus("Failed to open folder", "error");
      }
    });
  }

  dom.newCardBtn.addEventListener("click", cardCtrl.createNewCard);
  if (dom.newCardBtnSmall) {
    dom.newCardBtnSmall.addEventListener("click", cardCtrl.createNewCard);
  }
  if (dom.btns.newCardHeader) {
    dom.btns.newCardHeader.addEventListener("click", cardCtrl.createNewCard);
  }
  dom.btns.saveCard.addEventListener("click", () => cardCtrl.saveCurrentCard());
  dom.btns.generate.addEventListener("click", cardCtrl.generateArt);
  dom.inputs.prompt.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      dom.btns.generate.click();
    }
  });
  dom.searchInput.addEventListener("input", cardCtrl.filterCards);

  // Project Modals
  dom.newProjectBtn.addEventListener("click", () =>
    projectCtrl.openProjectModal(null),
  );
  dom.btns.projectSelectionCreate.addEventListener("click", () =>
    projectCtrl.openProjectModal(null),
  );
  dom.editProjectBtn.addEventListener("click", () => {
    if (state.currentProject)
      projectCtrl.openProjectModal(state.currentProject);
  });

  dom.modal.cancel.addEventListener("click", () =>
    dom.modal.self.classList.add("hidden"),
  );
  dom.modal.save.addEventListener("click", projectCtrl.saveProjectConfig);
  dom.modal.delete.addEventListener("click", projectCtrl.deleteCurrentProject); // NEW

  // Export Project
  const exportBtn = document.getElementById("exportProjectBtn");
  if (exportBtn) {
    exportBtn.addEventListener("click", async () => {
      if (!state.currentProject) return;

      if (!window.electronAPI || !window.electronAPI.exportProject) {
        showStatus("Export not supported in this environment", "error");
        return;
      }

      const pRoot = state.currentProject.outputRoot || state.currentProject.id;
      // We need absolute path. The backend expects absolute path?
      // Wait, the backend has `exportProject(projectPath, ...)`.
      // The frontend doesn't know the absolute path easily unless we tell it.
      // Actually `export-project` handler in `electron.ts` takes `projectPath`.
      // But the frontend only knows relative paths usually or we handle it in backend.

      // OPTION: Pass `state.currentProject.id` to backend, and let backend figure out the path.
      // In `electron.ts`, I implemented: `ipcMain.handle("export-project", async (event, projectPath: string, defaultName: string) => { ... })`
      // So it expects a path.
      // But `projectPath` coming from frontend might be tricky.
      // Let's change `electron.ts` to accept `projectId` instead or have frontend send path if known.
      // Frontend doesn't know absolute path.
      // `projects` in `state` might have it if we put it there?
      // `projectCtrl.loadProjects` fetches from API.

      // Let's assume we need to change backend to take ID and resolve path.
      // OR, we assume `projectPath` is just the ID?
      // In `electron.ts`: `await exportProject(projectPath, result.filePath);` which calls `archive.directory(projectPath, ...)`
      // So `projectPath` MUST be absolute or relative to CWD.

      // REVISION: I should update `electron.ts` to resolved path from ID.
      // For now, I'll send the ID as the path, and fix `electron.ts`.

      // actually, let's look at `electron.ts` again. I can fix it there easily.
      // "projectPath" param name suggests path.
      // I'll send the ID.

      const projectId = state.currentProject.id;
      const projectName = state.currentProject.name || "project";
      const filename = `${projectName.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.artproj`;

      showStatus("Exporting project...", "info");
      try {
        const result = await window.electronAPI.exportProject(
          projectId,
          filename,
        );
        if (result && result.success) {
          showStatus("Project exported successfully", "success");
        } else if (result && !result.canceled) {
          showStatus(
            "Export failed: " + (result.message || "Unknown error"),
            "error",
          );
        }
      } catch (e) {
        console.error("Export error:", e);
        showStatus("Export failed", "error");
      }
    });
  }

  // Export Deck
  const exportDeckBtn = document.getElementById("exportDeckBtn");
  if (exportDeckBtn) {
    exportDeckBtn.addEventListener("click", () => {
      if (!state.currentProject) return;
      const url = `/api/projects/${state.currentProject.id}/export-deck`;
      window.location.href = url;
    });
  }

  // Image Modal
  dom.imgModal.closeBtn.addEventListener("click", () =>
    dom.imgModal.self.classList.add("hidden"),
  );
  dom.imgModal.closeX.addEventListener("click", () =>
    dom.imgModal.self.classList.add("hidden"),
  );
  dom.imgModal.archiveBtn.addEventListener(
    "click",
    galleryCtrl.archiveCurrentImage,
  );

  const closeOnBackdrop = (e, modalDiv) => {
    if (e.target === modalDiv) modalDiv.classList.add("hidden");
  };
  dom.modal.self.addEventListener("click", (e) =>
    closeOnBackdrop(e, dom.modal.self),
  );
  dom.imgModal.self.addEventListener("click", (e) =>
    closeOnBackdrop(e, dom.imgModal.self),
  );

  // Editable Title Logic
  const startTitleEdit = () => {
    if (!state.currentCard) return;
    const h1 = dom.currentCardTitle;
    const input = dom.inputs.titleInput;
    const btn = dom.btns.editTitle;

    input.value = state.currentCard.name;
    h1.classList.add("hidden");
    btn.classList.add("hidden");
    input.classList.remove("hidden");
    input.focus();
    input.select();
  };

  const saveTitleEdit = async () => {
    if (!state.currentCard) return;
    const h1 = dom.currentCardTitle;
    const input = dom.inputs.titleInput;
    const btn = dom.btns.editTitle;
    const newName = input.value.trim();

    if (newName && newName !== state.currentCard.name) {
      dom.inputs.name.value = newName; // Sync with sidebar form
      await cardCtrl.saveCurrentCard(true); // Save silently
      showStatus("Title updated", "success");
    }

    // Reset UI
    dom.currentCardTitle.textContent = dom.inputs.name.value;
    input.classList.add("hidden");
    h1.classList.remove("hidden");
    btn.classList.remove("hidden");
  };

  dom.btns.editTitle.addEventListener("click", startTitleEdit);
  dom.currentCardTitle.addEventListener("click", startTitleEdit);

  if (dom.currentCardThumbnail) {
    dom.currentCardThumbnail.style.cursor = "pointer";
    dom.currentCardThumbnail.addEventListener("click", () => {
      if (
        state.currentCard &&
        state.currentCard.starredImage &&
        state.currentCard.outputSubfolder
      ) {
        const imgUrl = `data/projects/${state.currentProject.id}/assets/${state.currentCard.outputSubfolder}/${state.currentCard.starredImage}`;
        galleryCtrl.openImageDetails(imgUrl);
      }
    });
  }

  dom.inputs.titleInput.addEventListener("blur", saveTitleEdit);
  dom.inputs.titleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.target.blur(); // Trigger blur to save
    }
    if (e.key === "Escape") {
      // Cancel edit
      const h1 = dom.currentCardTitle;
      const input = dom.inputs.titleInput;
      const btn = dom.btns.editTitle;

      input.classList.add("hidden");
      h1.classList.remove("hidden");
      btn.classList.remove("hidden");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      // Priority: Regeneration or Bracket Modal (Topmost)
      if (!dom.regenModal.self.classList.contains("hidden")) {
        dom.regenModal.self.classList.add("hidden");
        return;
      }
      if (!dom.bracketModal.self.classList.contains("hidden")) {
        bracketController.closeModal();
        return;
      }

      // Default: Close other modals
      dom.imgModal.self.classList.add("hidden");
      dom.modal.self.classList.add("hidden");
      dom.helpModal.self.classList.add("hidden");
      dom.keyModal.self.classList.add("hidden");
    }

    // Help Shortcut
    if (
      (e.key === "?" || e.key === "/") &&
      !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)
    ) {
      e.preventDefault();
      dom.helpModal.self.classList.remove("hidden");
    }

    // Gallery Navigation
    if (
      !dom.imgModal.self.classList.contains("hidden") &&
      dom.regenModal.self.classList.contains("hidden")
    ) {
      if (
        e.key === "ArrowRight" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowUp"
      ) {
        e.preventDefault(); // Stop page scroll
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          galleryCtrl.navigateGallery("next");
        } else {
          galleryCtrl.navigateGallery("prev");
        }
      }
      if (e.key === "f" || e.key === "F") {
        galleryCtrl.toggleImageFavorite();
      }
    }
  });

  // Favorites Filter
  dom.btns.favFilter.addEventListener("click", () => {
    galleryCtrl.toggleFilterFavorites();
  });

  dom.btns.downloadGallery.addEventListener("click", () => {
    galleryCtrl.downloadCurrentGallery();
  });

  // Bracket Mode Integration
  if (dom.btns.startBracket) {
    dom.btns.startBracket.addEventListener("click", async () => {
      // Get current images from gallery controller state (or fetch fresh)
      // bracketController.start expects an array of image URLs (paths)
      // We can grab them from the rendered gallery or use the filtered list if accessible.
      // Ideally galleryController exposes currentImageList or we fetch fresh.

      // Let's rely on api fetch for consistency or expose it.
      // GalleryCtrl has `loadImagesForCard`.
      // Let's import api inside here or use existing
      if (!state.currentProject || !state.currentCard) return;

      try {
        const images = await api.fetchCardImages(
          state.currentProject.id,
          state.currentCard.id,
          true,
        );
        if (images && images.length > 0) {
          bracketController.start(images);
        } else {
          showStatus("No images to compare", "error");
        }
      } catch (e) {
        showStatus("Failed to load images for bracket", "error");
      }
    });
  }

  // Bracket Modal Interactions
  if (dom.bracketModal.quitBtn) {
    dom.bracketModal.quitBtn.addEventListener("click", () => {
      bracketController.closeModal();
    });
  }

  if (dom.bracketModal.closeX) {
    dom.bracketModal.closeX.addEventListener("click", () => {
      bracketController.closeModal();
    });
  }

  if (dom.bracketModal.leftContainer) {
    dom.bracketModal.leftContainer.addEventListener("click", () => {
      bracketController.vote(0);
    });
  }

  if (dom.bracketModal.rightContainer) {
    dom.bracketModal.rightContainer.addEventListener("click", () => {
      bracketController.vote(1);
    });
  }

  // Global Link Interceptor for External Links
  document.addEventListener("click", (event) => {
    const target = event.target.closest("a");
    if (target && target.href) {
      const url = target.href;
      // Check for data-external attribute
      if (target.hasAttribute("data-external") && window.electronAPI) {
        event.preventDefault();
        window.electronAPI.openExternal(url);
      } else if (
        target.hasAttribute("data-open-in-folder") &&
        window.electronAPI
      ) {
        event.preventDefault();
        const path = target.getAttribute("data-open-in-folder");
        window.electronAPI.showItemInFolder(path);
      }
    }
  });

  window.addEventListener("popstate", () => restoreStateFromUrl());

  await restoreStateFromUrl();
}

async function restoreStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const pid = params.get("project");
  const cid = params.get("card");

  if (pid && (!state.currentProject || state.currentProject.id !== pid)) {
    dom.projectSelect.value = pid;
    await projectCtrl.onProjectSelect(false);

    // Update Chat Context for URL load
    if (state.currentProject) {
      chatManager.onProjectSelected(state.currentProject.id);
    }
  } else if (!pid && state.currentProject) {
    // No project in URL but we have one selected - clear it
    dom.projectSelect.value = "";
    await projectCtrl.onProjectSelect(false);
  }

  if (
    cid &&
    state.currentProject &&
    (!state.currentCard || state.currentCard.id !== cid)
  ) {
    // We need to find the card in the loaded list
    // The previous implementation in app.js had a comment about this not being efficient
    // relying on loadCards having populated 'allCards' or similar.
    // loadCards updates state.allCards
    if (!state.allCards || state.allCards.length === 0) {
      // Just in case loadCards hasn't finished or failed?
      // onProjectSelect awaits loadCards so we should be good.
    }
    const card = state.allCards.find((c) => c.id === cid);
    if (card) cardCtrl.selectCard(card, false);
  }
}

// Theme Initialization
theme.initTheme();

const themeSelect = document.getElementById("themeSelect");
if (themeSelect) {
  themeSelect.value = theme.getThemePreference();
  themeSelect.addEventListener("change", (e) => {
    theme.applyTheme(e.target.value);
  });
}

// Global Error Handler
window.onerror = function (message, source, lineno, colno, error) {
  console.error("Global Error:", message, error);
  // Use showStatus to display the error to the user
  showStatus(`Uncaught Error: ${message}`, "error");
  return false; // Let default handler run as well
};

// Global Promise Rejection Handler
window.onunhandledrejection = function (event) {
  console.error("Unhandled Rejection:", event.reason);
  showStatus(`Unhandled Promise Rejection: ${event.reason}`, "error");
};

init();
