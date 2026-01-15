import { state } from "../state.js";
import { dom, showStatus, confirmAction, updateStatusCenter } from "../ui.js";
import * as api from "../api.js";
import { loadCards } from "./cardController.js";

// -- Module State --
let currentModifiers = [];
let currentEditingIndex = -1;
let listenersAttached = false;
let isIdManuallyChanged = false;
let isRootManuallyChanged = false;
let isCreateMode = false;

// -- Helper Functions --

function updateUrl() {
  const params = new URLSearchParams();
  if (state.currentProject) params.set("project", state.currentProject.id);
  if (state.currentCard) params.set("card", state.currentCard.id);

  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.pushState({}, "", newUrl);
}

function renderModifiersList() {
  const prefixContainer = document.getElementById("prefixList");
  const suffixContainer = document.getElementById("suffixList");

  if (!prefixContainer || !suffixContainer) return;

  // Clear both
  prefixContainer.innerHTML = "";
  suffixContainer.innerHTML = "";

  const renderItem = (mod, indexInGlobal, container) => {
    const item = document.createElement("div");
    item.className = "modifier-item";
    item.draggable = true;
    item.dataset.index = indexInGlobal;

    item.innerHTML = `
            <div class="modifier-handle">
              <span class="material-icons" style="font-size: 16px;">drag_indicator</span>
            </div>
            <div class="modifier-info" style="flex:1; cursor: pointer;" title="Click to edit">
                <span class="modifier-name">${mod.name}</span>
                <span class="modifier-text">${mod.text}</span>
            </div>
            <div class="modifier-actions">
                <button class="delete-modifier-btn" data-id="${mod.id}" title="Delete">
                    <span class="material-icons" style="font-size: 16px;">close</span>
                </button>
            </div>
        `;

    // Delete Handler
    item
      .querySelector(".delete-modifier-btn")
      .addEventListener("click", (e) => {
        e.stopPropagation(); // Prevent edit modal trigger
        currentModifiers = currentModifiers.filter((m) => m.id !== mod.id);
        renderModifiersList();
      });

    // Edit Handler
    item.querySelector(".modifier-info").addEventListener("click", () => {
      openEditModifierModal(indexInGlobal);
    });

    // Drag Handlers
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", indexInGlobal);
      item.classList.add("dragging");
    });

    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      document
        .querySelectorAll(".modifier-item")
        .forEach((i) => i.classList.remove("drag-over"));
    });

    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      item.classList.add("drag-over");
    });

    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-over");
    });

    item.addEventListener("drop", (e) => {
      e.preventDefault();
      const fromIndex = parseInt(e.dataTransfer.getData("text/plain"));
      const toIndex = indexInGlobal;

      if (fromIndex !== toIndex) {
        const movedItem = currentModifiers[fromIndex];
        currentModifiers.splice(fromIndex, 1);

        let targetIndex = toIndex;
        if (fromIndex < toIndex) targetIndex--;

        currentModifiers.splice(targetIndex, 0, movedItem);
        renderModifiersList();
      }
    });

    container.appendChild(item);
  };

  if (currentModifiers.length === 0) {
    prefixContainer.innerHTML =
      '<div style="text-align: center; color: var(--text-muted); font-size: 0.8em; padding: 10px;">No prefixes</div>';
    suffixContainer.innerHTML =
      '<div style="text-align: center; color: var(--text-muted); font-size: 0.8em; padding: 10px;">No suffixes</div>';
    return;
  }

  // Split and Render
  const prefixes = currentModifiers
    .map((m, i) => ({ ...m, globalIndex: i }))
    .filter((m) => m.type === "prefix");
  const suffixes = currentModifiers
    .map((m, i) => ({ ...m, globalIndex: i }))
    .filter((m) => m.type === "suffix");

  if (prefixes.length > 0) {
    prefixes.forEach((mod) =>
      renderItem(mod, mod.globalIndex, prefixContainer)
    );
  } else {
    prefixContainer.innerHTML =
      '<div style="text-align: center; color: var(--text-muted); font-size: 0.8em; padding: 10px;">No prefixes</div>';
  }

  if (suffixes.length > 0) {
    suffixes.forEach((mod) =>
      renderItem(mod, mod.globalIndex, suffixContainer)
    );
  } else {
    suffixContainer.innerHTML =
      '<div style="text-align: center; color: var(--text-muted); font-size: 0.8em; padding: 10px;">No suffixes</div>';
  }
}

function openEditModifierModal(index) {
  const mod = currentModifiers[index];
  if (!mod) return;

  currentEditingIndex = index;

  const modal = document.getElementById("editModifierModal");
  const nameInput = document.getElementById("editModName");
  const contentInput = document.getElementById("editModContent");

  if (nameInput) nameInput.value = mod.name;
  if (contentInput) contentInput.value = mod.text;

  if (modal) modal.classList.remove("hidden");
  if (contentInput) contentInput.focus();
}

function saveEditedModifier() {
  if (currentEditingIndex < 0 || currentEditingIndex >= currentModifiers.length)
    return;

  const contentInput = document.getElementById("editModContent");
  const newText = contentInput.value.trim();

  if (!newText) return showStatus("Modifier text cannot be empty", "error");

  currentModifiers[currentEditingIndex].text = newText;
  renderModifiersList();

  document.getElementById("editModifierModal").classList.add("hidden");
  currentEditingIndex = -1;
}

// -- Initialization --

function attachAutoFillListeners() {
  console.log("ProjectController: Attaching auto-fill listeners");
  if (listenersAttached) {
    console.log("ProjectController: Listeners already attached, skipping.");
    return;
  }

  const nameInput = document.getElementById("newProjectName");
  const rootInput = document.getElementById("newProjectRoot");

  if (nameInput) {
    console.log("ProjectController: nameInput found, adding listener");
    nameInput.addEventListener("input", (e) => {
      console.log(
        "ProjectController: Name input event. isCreateMode:",
        isCreateMode
      );
      if (!isCreateMode) return;

      const nameVal = e.target.value;

      const idInput = document.getElementById("newProjectId");
      const idDisplay = document.getElementById("newProjectIdDisplay");

      if (!isIdManuallyChanged) {
        const safeId = nameVal
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, "")
          .trim()
          .replace(/\s+/g, "-");

        if (idInput) idInput.value = safeId;
        if (idDisplay) idDisplay.textContent = safeId;
      }

      const rootIn = document.getElementById("newProjectRoot");
      if (!isRootManuallyChanged && rootIn) {
        const safeRoot = nameVal
          .toLowerCase()
          .replace(/[^a-z0-9\s_-]/g, "")
          .trim()
          .replace(/\s+/g, "_");
        rootIn.value = safeRoot;
      }
    });
  } else {
    console.error("ProjectController: Name input not found during init");
  }

  if (rootInput) {
    rootInput.addEventListener("input", () => {
      isRootManuallyChanged = true;
    });
  }

  // Modifiers
  const addPrefixBtn = document.getElementById("addPrefixBtn");
  const addSuffixBtn = document.getElementById("addSuffixBtn");
  const newModName = document.getElementById("newModName");
  const newModText = document.getElementById("newModText");

  const addModifier = (type) => {
    const name = newModName.value.trim();
    const text = newModText.value.trim();

    if (!name || !text) return showStatus("Name and Text required", "error");

    const id =
      Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    currentModifiers.push({ id, name, text, type });
    renderModifiersList();

    newModName.value = "";
    newModText.value = "";
    newModName.focus();
  };

  if (addPrefixBtn)
    addPrefixBtn.addEventListener("click", () => addModifier("prefix"));
  if (addSuffixBtn)
    addSuffixBtn.addEventListener("click", () => addModifier("suffix"));

  // Edit Modals
  const saveEditBtn = document.getElementById("saveEditModBtn");
  const cancelEditBtn = document.getElementById("cancelEditModBtn");
  if (saveEditBtn) saveEditBtn.addEventListener("click", saveEditedModifier);
  if (cancelEditBtn)
    cancelEditBtn.addEventListener("click", () => {
      document.getElementById("editModifierModal").classList.add("hidden");
    });

  // Help Modal
  const helpIcon = document.querySelector(".help-icon");
  if (helpIcon) {
    helpIcon.addEventListener("click", (e) => {
      e.stopPropagation();
      const modal = document.getElementById("modifierHelpModal");
      if (modal) modal.classList.remove("hidden");
    });
  }

  listenersAttached = true;
  console.log("ProjectController: Listeners attached successfully");
}

// -- Exports --

export async function loadProjects() {
  state.projects = await api.fetchProjects();
  dom.projectSelect.innerHTML = '<option value="">Select Project...</option>';
  state.projects.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    dom.projectSelect.appendChild(opt);
  });

  if (state.projects.length === 0) {
    dom.newProjectBtn.classList.add("pulse-highlight");
    await renderProjectSelection();
  } else {
    dom.newProjectBtn.classList.remove("pulse-highlight");
    if (!state.currentProject) {
      await renderProjectSelection();
    }
  }
}

export async function onProjectSelect(updateHistory = true) {
  const pid = dom.projectSelect.value;
  if (!pid) {
    state.currentProject = null;
    state.currentCard = null;
    dom.cardList.innerHTML = "";
    dom.editorArea.classList.add("hidden");
    updateStatusCenter("");
    await renderProjectSelection();
    if (updateHistory) updateUrl();
    if (dom.openFolderBtn) dom.openFolderBtn.title = "Open Data Folder";
    const projectNameSpan = document.getElementById("projectName");
    if (projectNameSpan) projectNameSpan.textContent = "";
    return;
  }

  dom.projectSelectionView.classList.add("hidden");
  state.currentProject = state.projects.find((p) => p.id === pid);
  if (dom.openFolderBtn) dom.openFolderBtn.title = "Open Project Folder";

  const projectNameSpan = document.getElementById("projectName");
  if (projectNameSpan) {
    projectNameSpan.textContent = `: ${state.currentProject.name}`;
  }

  const arDefaultOpt = dom.inputs.cardAspectRatio.options[0];
  const resDefaultOpt = dom.inputs.cardResolution.options[0];
  arDefaultOpt.textContent = `Default (${
    state.currentProject.defaultAspectRatio || "2:3"
  })`;
  resDefaultOpt.textContent = `Default (${
    state.currentProject.defaultResolution || "2K"
  })`;

  const cards = await loadCards(pid);
  if (updateHistory) {
    if (!state.currentCard && cards.length > 0) {
      // Lazy load to avoid circular dependency issues if any
      const { selectCard } = await import("./cardController.js");
      selectCard(cards[0], true);
    } else {
      state.currentCard = null;
      updateUrl();
    }
  }
}

export async function saveProjectConfig() {
  console.log("ProjectController: saveProjectConfig called");

  // Use explicit lookups
  const idInput = document.getElementById("newProjectId");
  const nameInput = document.getElementById("newProjectName");
  const descInput = document.getElementById("newProjectDescription");
  const rootInput = document.getElementById("newProjectRoot");
  const arInput = document.getElementById("newAspectRatio");
  const resInput = document.getElementById("newResolution");
  const modalDiv = document.getElementById("projectModal");

  const p = {
    id: idInput ? idInput.value : "",
    name: nameInput ? nameInput.value : "",
    description: descInput ? descInput.value : "",
    outputRoot: rootInput ? rootInput.value : "",
    promptModifiers: currentModifiers,
    defaultAspectRatio: arInput ? arInput.value : "2:3",
    defaultResolution: resInput ? resInput.value : "2K",
  };

  console.log("ProjectController: Saving project data:", p);

  if (!p.id) {
    console.warn(
      "ProjectController: ID missing from input. isCreateMode:",
      isCreateMode
    );
    // Fallback logic
    if (!isCreateMode && state.currentProject && state.currentProject.id) {
      p.id = state.currentProject.id;
      console.warn("Recovered Project ID from state during save.");
    } else {
      return showStatus("Project ID required. Name cannot be empty.", "error");
    }
  }

  await api.saveProject(p);
  if (modalDiv) modalDiv.classList.add("hidden");
  await loadProjects();
  dom.projectSelect.value = p.id;
  await onProjectSelect();
  showStatus(`Project ${p.id} saved`, "success");
}

export async function deleteCurrentProject() {
  const p = state.currentProject;
  if (!p) return;

  confirmAction(
    "Delete Project?",
    `Are you sure you want to delete "${p.name}"? This will delete all cards and the entire output folder "${p.outputRoot}". This cannot be undone.`,
    async () => {
      await api.deleteProject(p.id);
      showStatus(`Project "${p.name}" deleted.`, "success");
      state.currentProject = null;
      document.getElementById("projectModal").classList.add("hidden");
      await loadProjects();
      await onProjectSelect();
    }
  );
}

export function openProjectModal(project) {
  console.log(
    "ProjectController: openProjectModal called. Project:",
    project ? project.id : "NULL (New Project)"
  );
  const modalDiv = document.getElementById("projectModal");
  if (modalDiv) modalDiv.classList.remove("hidden");

  // Explicit lookups
  const idInput = document.getElementById("newProjectId");
  const idDisplay = document.getElementById("newProjectIdDisplay");
  const nameInput = document.getElementById("newProjectName");
  const descInput = document.getElementById("newProjectDescription");
  const rootInput = document.getElementById("newProjectRoot");
  const arInput = document.getElementById("newAspectRatio");
  const resInput = document.getElementById("newResolution");
  const deleteBtn = document.getElementById("deleteProjectBtn");
  const title = document.getElementById("projectModalTitle");

  // Clear previous state
  currentModifiers = [];

  if (project) {
    // Edit Mode
    console.log("ProjectController: Setting Edit Mode");
    isCreateMode = false;

    if (title) title.textContent = "Edit Project";
    if (idInput) idInput.value = project.id;
    if (idDisplay) idDisplay.textContent = project.id;
    if (nameInput) nameInput.value = project.name;
    if (descInput) descInput.value = project.description || "";
    if (rootInput) rootInput.value = project.outputRoot;

    if (project.promptModifiers) {
      currentModifiers = [...project.promptModifiers];
    }

    if (arInput) arInput.value = project.defaultAspectRatio || "2:3";
    if (resInput) resInput.value = project.defaultResolution || "2K";
    if (deleteBtn) deleteBtn.style.display = "block";
  } else {
    // Create Mode
    console.log("ProjectController: Setting Create Mode");
    isCreateMode = true;
    isIdManuallyChanged = false;
    isRootManuallyChanged = false;

    if (title) title.textContent = "New Project";
    if (idInput) idInput.value = "";
    if (idDisplay) idDisplay.textContent = "";
    if (nameInput) nameInput.value = "";
    if (descInput) descInput.value = "";
    if (rootInput) rootInput.value = "";

    if (arInput) arInput.value = "2:3";
    if (resInput) resInput.value = "2K";
    if (deleteBtn) deleteBtn.style.display = "none";
  }

  renderModifiersList();
}

export async function renderProjectSelection() {
  dom.projectSelectionView.classList.remove("hidden");
  dom.projectGridContainer.innerHTML = "";

  if (state.projects.length === 0) {
    dom.btns.projectSelectionCreate.classList.add("pulse-highlight");
  } else {
    dom.btns.projectSelectionCreate.classList.remove("pulse-highlight");
  }

  for (const project of state.projects) {
    const card = document.createElement("div");
    card.className = "project-card";

    const title = document.createElement("h3");
    title.textContent = project.name;

    const previewGrid = document.createElement("div");
    previewGrid.className = "project-preview-grid";

    try {
      const previews = await api.fetchProjectPreviews(project.id);
      if (previews.length === 0) {
        const empty = document.createElement("div");
        empty.className = "project-preview-empty";
        empty.textContent = "No images yet";
        previewGrid.appendChild(empty);
      } else {
        previews.slice(0, 6).forEach((imgPath) => {
          const img = document.createElement("img");
          img.src = imgPath;
          img.className = "project-preview-img";
          img.alt = "Preview";
          previewGrid.appendChild(img);
        });
      }
    } catch (e) {
      const empty = document.createElement("div");
      empty.className = "project-preview-empty";
      empty.textContent = "No images";
      previewGrid.appendChild(empty);
    }

    card.appendChild(title);
    card.appendChild(previewGrid);

    card.addEventListener("click", async () => {
      dom.projectSelect.value = project.id;
      await onProjectSelect();
    });

    dom.projectGridContainer.appendChild(card);
  }
}

// Initialize listeners immediately when module loads
attachAutoFillListeners();
