const API_BASE = "/api";

// State
let projects = [];
let currentProject = null;
let currentCard = null;

// Elements
const dom = {
  projectSelect: document.getElementById("projectSelect"),
  newProjectBtn: document.getElementById("newProjectBtn"),
  openFolderBtn: document.getElementById("openFolderBtn"),
  editProjectBtn: document.getElementById("editProjectBtn"),
  cardList: document.getElementById("cardList"),
  searchInput: document.getElementById("cardSearchInput"),
  newCardBtn: document.getElementById("newCardBtn"),
  currentCardTitle: document.getElementById("currentCardTitle"),
  editorArea: document.getElementById("editorArea"),
  inputs: {
    name: document.getElementById("cardNameInput"),
    subfolder: document.getElementById("subfolderInput"),
    cardAspectRatio: document.getElementById("cardAspectRatio"),
    cardResolution: document.getElementById("cardResolution"),
    prompt: document.getElementById("promptInput"),
    count: document.getElementById("genCount"),
    apiKey: document.getElementById("apiKeyInput"), // Keeping old element ref if needed or unused
    keySelect: document.getElementById("keySelect"),
    newKeyName: document.getElementById("newKeyName"),
    newKeyValue: document.getElementById("newKeyValue"),
  },
  preview: document.getElementById("promptPreview"),
  btns: {
    addKeyToggle: document.getElementById("addKeyToggleBtn"),
    saveNewKey: document.getElementById("saveKeyBtn"), // Reusing ID from HTML update
    saveCard: document.getElementById("saveCardBtn"),
    openCardFolder: document.getElementById("openCardFolderBtn"),
    generate: document.getElementById("generateBtn"),
  },
  forms: {
    newKey: document.getElementById("newKeyForm"),
  },
  gallery: document.getElementById("gallery"),
  modal: {
    self: document.getElementById("projectModal"),
    title: document.getElementById("projectModalTitle"),
    save: document.getElementById("saveProjectBtn"),
    cancel: document.getElementById("cancelProjectBtn"),
    id: document.getElementById("newProjectId"),
    name: document.getElementById("newProjectName"),
    root: document.getElementById("newProjectRoot"),
    prefix: document.getElementById("globalPrefix"),
    suffix: document.getElementById("globalSuffix"),
    aspectRatio: document.getElementById("newAspectRatio"),
    resolution: document.getElementById("newResolution"),
  },

  imgModal: {
    self: document.getElementById("imageModal"),
    preview: document.getElementById("imgModalPreview"),
    title: document.getElementById("imgModalTitle"),
    name: document.getElementById("imgModalName"),
    date: document.getElementById("imgModalDate"),
    prompt: document.getElementById("imgModalPrompt"),
    link: document.getElementById("imgModalLink"),
    archiveBtn: document.getElementById("imgModalArchiveBtn"),
    closeBtn: document.getElementById("imgModalCloseBtn"),
  },
  toastContainer: document.getElementById("toast-container"),
};

function createToast(msg, type = "info", duration = 5000) {
  const div = document.createElement("div");
  div.className = `toast ${type}`;
  div.textContent = msg;

  dom.toastContainer.appendChild(div);

  // Return specific API for this toast
  const toastApi = {
    update: (newMsg, newType) => {
      div.textContent = newMsg;
      if (newType) div.className = `toast ${newType}`;
    },
    remove: () => {
      div.classList.add("fade-out");
      setTimeout(() => div.remove(), 300);
    },
  };

  if (duration) {
    setTimeout(() => {
      if (div.parentNode) toastApi.remove();
    }, duration);
  }

  return toastApi;
}

// Compat wrapper
function showStatus(msg, type = "info") {
  createToast(msg, type, 5000);
}

// NanoID implementation (URL-safe, 21 chars default)
function nanoid(size = 21) {
  const urlAlphabet =
    "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (let i = 0; i < size; i++) {
    id += urlAlphabet[bytes[i] % 64];
  }
  return id;
}

// Init
async function init() {
  await loadProjects();
  dom.projectSelect.addEventListener("change", onProjectSelect);

  await loadKeys();

  // Check if running in Electron and enable Open Folder button
  if (window.electronAPI && dom.openFolderBtn) {
    dom.openFolderBtn.classList.remove("hidden");
    dom.openFolderBtn.addEventListener("click", async () => {
      try {
        await window.electronAPI.openDataFolder();
      } catch (e) {
        showStatus("Failed to open folder", "error");
      }
    });
  }

  dom.btns.addKeyToggle.addEventListener("click", () => {
    dom.forms.newKey.classList.toggle("hidden");
  });

  dom.btns.saveNewKey.addEventListener("click", async () => {
    const name = dom.inputs.newKeyName.value;
    const key = dom.inputs.newKeyValue.value;
    if (key && name) {
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key, name }),
      });
      dom.forms.newKey.classList.add("hidden");
      dom.inputs.newKeyName.value = "";
      dom.inputs.newKeyValue.value = "";
      await loadKeys();
      // Auto select
      dom.inputs.keySelect.value = key;
      showStatus("API Key Saved", "success");
    }
  });

  dom.inputs.keySelect.addEventListener("change", async () => {
    const key = dom.inputs.keySelect.value;
    if (key) {
      // Save to localStorage
      const name =
        dom.inputs.keySelect.options[dom.inputs.keySelect.selectedIndex].text;
      localStorage.setItem("lastApiKeyName", name);

      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      });
    }
  });

  if (window.electronAPI && dom.btns.openCardFolder) {
    dom.btns.openCardFolder.classList.remove("hidden");
    dom.btns.openCardFolder.addEventListener("click", async () => {
      if (!currentProject || !currentCard) return;
      // Construct relative path: output / projectDir / cardDir
      // Note: server resolves logic: outputDir + (project.outputRoot||"default") + (card.outputSubfolder||"default")
      // Frontend needs to match this structure relative to data root
      // Our dataRoot in Electron is the base.
      // Wait, server logic:
      // const projectDir = (project.outputRoot || "default")
      // const cardDir = (card.outputSubfolder || "default")
      // const outputFolder = path.resolve(SAFE_OUTPUT_BASE, projectDir, cardDir);
      // Data Root contains 'output'.
      // So relative path passed to IPC should be: "output/projectId/cardId"? NO.
      // It should be: "output/" + (p.root||"default") + "/" + (c.sub||"default")
      const pRoot = currentProject.outputRoot || "default";
      const cSub = currentCard.outputSubfolder || "default";
      const relPath = `output/${pRoot}/${cSub}`;

      try {
        await window.electronAPI.openDataFolder(relPath);
      } catch (e) {
        showStatus("Failed to open folder", "error");
      }
    });
  }

  dom.newCardBtn.addEventListener("click", createNewCard);
  dom.btns.saveCard.addEventListener("click", saveCurrentCard);
  dom.btns.generate.addEventListener("click", generateArt);
  dom.inputs.prompt.addEventListener("input", updatePreview);
  dom.searchInput.addEventListener("input", filterCards);

  // Modal
  dom.newProjectBtn.addEventListener("click", () => openProjectModal(null));
  dom.editProjectBtn.addEventListener("click", () => {
    if (currentProject) openProjectModal(currentProject);
  });

  dom.modal.cancel.addEventListener("click", () =>
    dom.modal.self.classList.add("hidden")
  );
  dom.modal.save.addEventListener("click", saveProjectConfig);

  // Image Modal
  dom.imgModal.closeBtn.addEventListener("click", () =>
    dom.imgModal.self.classList.add("hidden")
  );
  dom.imgModal.archiveBtn.addEventListener("click", archiveCurrentImage);

  // Click outside to close (Backdrop)
  const closeOnBackdrop = (e, modalDiv) => {
    if (e.target === modalDiv) modalDiv.classList.add("hidden");
  };
  dom.modal.self.addEventListener("click", (e) =>
    closeOnBackdrop(e, dom.modal.self)
  );
  dom.imgModal.self.addEventListener("click", (e) =>
    closeOnBackdrop(e, dom.imgModal.self)
  );

  // Keyboard Shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      dom.imgModal.self.classList.add("hidden");
      dom.modal.self.classList.add("hidden");
    }
  });

  // Handle back/forward
  window.addEventListener("popstate", () => restoreStateFromUrl());

  // Initial Load
  await restoreStateFromUrl();
}

async function restoreStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const pid = params.get("project");
  const cid = params.get("card");

  if (pid && (!currentProject || currentProject.id !== pid)) {
    dom.projectSelect.value = pid;
    await onProjectSelect(false); // don't push state again
  }

  if (cid && currentProject && (!currentCard || currentCard.id !== cid)) {
    // finding card in loaded list not ideal if list not exposed,
    // but loadCards populates dom.cardList.
    // Better: we need access to the card data or re-fetch.
    // We can fetch cards again or search DOM?
    // Logic: we have loadCards fetching and storing in variable if we want,
    // but current impl doesn't store cards globally efficiently.
    // Let's rely on re-fetching in selectCard or finding in cached list.
    // We'll modify loadCards to return the list.
    const cards = await loadCards(pid);
    const card = cards.find((c) => c.id === cid);
    if (card) selectCard(card, false);
  }
}

function updateUrl() {
  const params = new URLSearchParams();
  if (currentProject) params.set("project", currentProject.id);
  if (currentCard) params.set("card", currentCard.id);

  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.pushState({}, "", newUrl);
}

function openProjectModal(project) {
  dom.modal.self.classList.remove("hidden");
  if (project) {
    // Edit Mode
    dom.modal.title.textContent = "Edit Project";
    dom.modal.id.value = project.id;
    dom.modal.id.disabled = true; // Cannot change ID
    dom.modal.name.value = project.name;
    dom.modal.root.value = project.outputRoot;
    dom.modal.prefix.value = project.globalPrefix;
    dom.modal.suffix.value = project.globalSuffix;
    dom.modal.aspectRatio.value = project.defaultAspectRatio || "2:3";
    dom.modal.resolution.value = project.defaultResolution || "2K";
  } else {
    // Create Mode
    dom.modal.title.textContent = "New Project";
    dom.modal.id.value = "";
    dom.modal.id.disabled = false;
    dom.modal.name.value = "";
    dom.modal.root.value = "";
    dom.modal.prefix.value = "";
    dom.modal.suffix.value = "";
    dom.modal.aspectRatio.value = "2:3";
    dom.modal.resolution.value = "2K";
  }
}

// Logic
async function loadKeys() {
  const res = await fetch("/api/keys");
  const keys = await res.json();
  dom.inputs.keySelect.innerHTML =
    '<option value="">Select API Key...</option>';
  keys.forEach((k) => {
    const opt = document.createElement("option");
    opt.value = k.key;
    opt.textContent = k.name;
    dom.inputs.keySelect.appendChild(opt);
  });

  // Restore from localStorage
  const lastName = localStorage.getItem("lastApiKeyName");
  if (lastName) {
    const option = Array.from(dom.inputs.keySelect.options).find(
      (o) => o.text === lastName
    );
    if (option) {
      dom.inputs.keySelect.value = option.value;
      // Sync with backend
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: option.value }),
      });
    }
  }
}

async function loadProjects() {
  const res = await fetch("/api/projects");
  projects = await res.json();
  dom.projectSelect.innerHTML = '<option value="">Select Project...</option>';
  projects.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    dom.projectSelect.appendChild(opt);
  });
}

async function saveProjectConfig() {
  const p = {
    id: dom.modal.id.value, // If disabled, value still accessible? Yes.
    name: dom.modal.name.value,
    outputRoot: dom.modal.root.value,
    globalPrefix: dom.modal.prefix.value,
    globalSuffix: dom.modal.suffix.value,
    description: "",
    defaultAspectRatio: dom.modal.aspectRatio.value,
    defaultResolution: dom.modal.resolution.value,
  };

  if (!p.id) return showStatus("Project ID required", "error");

  await fetch("/api/projects", {
    method: "POST", // Acts as upsert
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });

  dom.modal.self.classList.add("hidden");
  await loadProjects();
  dom.projectSelect.value = p.id;
  await onProjectSelect(); // wait for it
  showStatus(`Project ${p.id} saved`, "success");
}

async function onProjectSelect(updateHistory = true) {
  const pid = dom.projectSelect.value;
  if (!pid) {
    currentProject = null;
    currentCard = null; // Clear card state too
    dom.cardList.innerHTML = "";
    dom.editorArea.classList.add("hidden");
    if (updateHistory) updateUrl();
    return;
  }

  currentProject = projects.find((p) => p.id === pid);

  // Update default options in card overrides
  const arDefaultOpt = dom.inputs.cardAspectRatio.options[0];
  const resDefaultOpt = dom.inputs.cardResolution.options[0];

  arDefaultOpt.textContent = `Project Default (${
    currentProject.defaultAspectRatio || "2:3"
  })`;
  resDefaultOpt.textContent = `Project Default (${
    currentProject.defaultResolution || "2K"
  })`;

  await loadCards(pid);
  if (updateHistory) {
    // Clear card from URL when switching projects
    currentCard = null;
    updateUrl();
  }
}

let allCards = []; // Cache for filtering

async function loadCards(projectId) {
  const res = await fetch(`/api/projects/${projectId}/cards`);
  const cards = await res.json();
  allCards = cards; // Store for filtering
  renderCardList(cards);
  return cards;
}

function renderCardList(cards) {
  dom.cardList.innerHTML = "";
  cards.forEach((card) => {
    const div = document.createElement("div");
    div.className = "card-item";

    // Name + Count
    const count = card.imageCount !== undefined ? card.imageCount : 0;

    div.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <span>${card.name}</span>
            <span style="font-size: 0.8em; color: var(--text-muted); background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 10px;">${count}</span>
        </div>
    `;

    div.onclick = () => selectCard(card);
    dom.cardList.appendChild(div);
  });
}

function filterCards() {
  const term = dom.searchInput.value.toLowerCase();
  const filtered = allCards.filter((c) => c.name.toLowerCase().includes(term));
  renderCardList(filtered);
}

function selectCard(card, updateHistory = true) {
  currentCard = card;
  dom.editorArea.classList.remove("hidden");
  dom.currentCardTitle.textContent = card.name;

  dom.inputs.name.value = card.name;
  dom.inputs.subfolder.value = card.outputSubfolder || "";
  dom.inputs.cardAspectRatio.value = card.aspectRatio || "";
  dom.inputs.cardResolution.value = card.resolution || "";
  dom.inputs.prompt.value = card.prompt || "";

  if (updateHistory) updateUrl();

  updatePreview();
  loadImagesForCard(currentProject.id, card.id);
}

async function loadImagesForCard(projectId, cardId) {
  dom.gallery.innerHTML = '<div class="gallery-loader">Loading...</div>';
  try {
    const res = await fetch(
      `/api/projects/${projectId}/cards/${cardId}/images`
    );
    const images = await res.json();

    dom.gallery.innerHTML = "";

    if (!Array.isArray(images)) {
      if (images && images.error) {
        throw new Error(images.error);
      }
      // Fallback if it's not an array and not an explicit error?
      // Treat as empty or throw? Let's treat as empty but log.
      console.warn("Expected array of images, got:", images);
      dom.gallery.innerHTML = '<div class="empty-state">No images yet</div>';
      return;
    }

    if (images.length === 0) {
      dom.gallery.innerHTML = '<div class="empty-state">No images yet</div>';
      return;
    }

    images.forEach((imgUrl) => {
      addImageToGallery(imgUrl);
    });
  } catch (e) {
    dom.gallery.innerHTML = `<div class="error-state">Error loading images: ${e.message}</div>`;
  }
}

function addImageToGallery(imgUrl) {
  const div = document.createElement("div");
  div.className = "gallery-item";
  const img = document.createElement("img");
  img.src = "/" + imgUrl; // Ensure absolute path from root
  img.loading = "lazy";

  div.onclick = () => openImageDetails(imgUrl); // Click to open details

  div.appendChild(img);
  dom.gallery.appendChild(div);
}

let currentImgPath = null;
async function openImageDetails(imgUrl) {
  currentImgPath = imgUrl; // data/output/...

  // Show loading state in modal?
  dom.imgModal.self.classList.remove("hidden");
  dom.imgModal.preview.src = "/" + imgUrl; // Set preview immediately
  dom.imgModal.name.textContent = "Loading...";
  dom.imgModal.date.textContent = "";
  dom.imgModal.prompt.textContent = "";
  dom.imgModal.link.href = "/" + imgUrl;

  try {
    const res = await fetch(
      `/api/image-metadata?path=${encodeURIComponent(imgUrl)}`
    );
    const meta = await res.json();

    dom.imgModal.name.textContent = meta.filename;
    dom.imgModal.date.textContent = new Date(meta.created).toLocaleString();
    dom.imgModal.prompt.textContent = meta.prompt;
  } catch (e) {
    dom.imgModal.prompt.textContent = "Error loading metadata: " + e.message;
  }
}

async function archiveCurrentImage() {
  if (!currentImgPath || !currentCard || !currentProject) return;

  if (
    !confirm(
      "Are you sure you want to archive this image? It will be hidden from the gallery."
    )
  )
    return;

  try {
    // Extract filename from path
    // path is like data/output/project/card/image.png
    const filename = currentImgPath.split("/").pop();

    await fetch(`/api/cards/${currentCard.id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: currentProject.id,
        filename: filename,
      }),
    });

    // Hide modal
    dom.imgModal.self.classList.add("hidden");

    // Remove from gallery UI directly
    // Or just reload gallery
    createToast("Image archived", "success");
    loadImagesForCard(currentProject.id, currentCard.id); // Reload to reflect changes
  } catch (e) {
    createToast("Failed to archive: " + e.message, "error");
  }
}

function createNewCard() {
  if (!currentProject) return showStatus("Select a project first", "error");

  const newCard = {
    id: `card_${nanoid(10)}`, // Short ID for cards
    projectId: currentProject.id,
    name: "New Card",
    prompt: "",
    outputSubfolder: "default",
  };
  selectCard(newCard);
}

async function saveCurrentCard(silent = false) {
  if (!currentCard) return;

  currentCard.name = dom.inputs.name.value;
  currentCard.outputSubfolder = dom.inputs.subfolder.value;
  currentCard.aspectRatio = dom.inputs.cardAspectRatio.value;
  currentCard.resolution = dom.inputs.cardResolution.value;
  currentCard.prompt = dom.inputs.prompt.value;

  await fetch("/api/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(currentCard),
  });

  await loadCards(currentProject.id); // Refresh list
  if (!silent) showStatus("Card Saved", "success");
}

function updatePreview() {
  if (!currentProject) return;
  const txt = `${currentProject.globalPrefix} ${dom.inputs.prompt.value} ${currentProject.globalSuffix}`;
  dom.preview.textContent = txt;
}

async function generateArt() {
  if (!currentCard) return;

  // Auto-save silently before generating
  await saveCurrentCard(true);

  const count = parseInt(dom.inputs.count.value) || 1;
  const promises = [];

  // dom.btns.generate.disabled = true; // Allow multiple clicks

  // We loop here on the client to get separate status bars
  for (let i = 0; i < count; i++) {
    const p = (async () => {
      const toast = createToast(
        `✨ Generating ${i + 1}/${count}...`,
        "ai-generating",
        0
      ); // 0 = no auto-dismiss yet

      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cardId: currentCard.id,
            projectId: currentProject.id,
            count: 1, // Single per request for granularity
            promptOverride: dom.inputs.prompt.value,
            arOverride: dom.inputs.cardAspectRatio.value,
            resOverride: dom.inputs.cardResolution.value,
          }),
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error);

        if (data.images && Array.isArray(data.images)) {
          data.images.forEach((imgUrl) => {
            const div = document.createElement("div");
            div.className = "gallery-item";
            const img = document.createElement("img");
            img.src = "/" + imgUrl;
            div.appendChild(img);
            dom.gallery.prepend(div);
          });
        }

        toast.update(`Success #${i + 1}`, "success");
        setTimeout(() => toast.remove(), 4000);
      } catch (e) {
        toast.update(`Error #${i + 1}: ${e.message}`, "error");
        setTimeout(() => toast.remove(), 8000);
      }
    })();
    promises.push(p);
  }

  // Wait for all to finish to re-enable button
  // Wait for all to finish (just for internal tracking if needed, but UI is non-blocking now)
  await Promise.all(promises);
  // dom.btns.generate.disabled = false;
  // dom.btns.generate.textContent = "Generate Art ✨";
}

init();
