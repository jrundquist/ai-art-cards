import { state } from "../state.js";
import { dom, showStatus, confirmAction, updateStatusCenter } from "../ui.js";
import * as api from "../api.js";
import { loadCards } from "./cardController.js";

function updateUrl() {
  const params = new URLSearchParams();
  if (state.currentProject) params.set("project", state.currentProject.id);
  if (state.currentCard) params.set("card", state.currentCard.id);

  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.pushState({}, "", newUrl);
}

export async function loadProjects() {
  state.projects = await api.fetchProjects();
  dom.projectSelect.innerHTML = '<option value="">Select Project...</option>';
  state.projects.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    dom.projectSelect.appendChild(opt);
  });

  // Show/hide project selection view
  if (state.projects.length === 0) {
    dom.newProjectBtn.classList.add("pulse-highlight");
    // Show selection view with pulse-highlight button
    await renderProjectSelection();
  } else {
    dom.newProjectBtn.classList.remove("pulse-highlight");
    // If no project is selected, show the selection view
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

    // Show project selection view
    await renderProjectSelection();

    if (updateHistory) updateUrl();
    if (dom.openFolderBtn) dom.openFolderBtn.title = "Open Data Folder";

    // Clear App Title Project Name
    const projectNameSpan = document.getElementById("projectName");
    if (projectNameSpan) projectNameSpan.textContent = "";

    return;
  }

  // Hide project selection view when a project is selected
  dom.projectSelectionView.classList.add("hidden");

  state.currentProject = state.projects.find((p) => p.id === pid);
  if (dom.openFolderBtn) dom.openFolderBtn.title = "Open Project Folder";

  // Update App Title
  const projectNameSpan = document.getElementById("projectName");
  if (projectNameSpan) {
    projectNameSpan.textContent = `: ${state.currentProject.name}`;
  }

  // Update default options in card overrides
  const arDefaultOpt = dom.inputs.cardAspectRatio.options[0];
  const resDefaultOpt = dom.inputs.cardResolution.options[0];

  arDefaultOpt.textContent = `Project Default (${
    state.currentProject.defaultAspectRatio || "2:3"
  })`;
  resDefaultOpt.textContent = `Project Default (${
    state.currentProject.defaultResolution || "2K"
  })`;

  await loadCards(pid);
  if (updateHistory) {
    state.currentCard = null;
    updateUrl();
  }
}

export async function saveProjectConfig() {
  const p = {
    id: dom.modal.id.value,
    name: dom.modal.name.value,
    outputRoot: dom.modal.root.value,
    globalPrefix: dom.modal.prefix.value,
    globalSuffix: dom.modal.suffix.value,
    description: "",
    defaultAspectRatio: dom.modal.aspectRatio.value,
    defaultResolution: dom.modal.resolution.value,
  };

  if (!p.id) return showStatus("Project ID required", "error");

  await api.saveProject(p);

  dom.modal.self.classList.add("hidden");
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
      dom.modal.self.classList.add("hidden");
      await loadProjects(); // Reload list
      await onProjectSelect(); // Clear view
    }
  );
}

export function openProjectModal(project) {
  dom.modal.self.classList.remove("hidden");
  if (project) {
    // Edit Mode
    dom.modal.title.textContent = "Edit Project";
    dom.modal.id.value = project.id;
    dom.modal.idDisplay.textContent = project.id;
    // ID is hidden input, no disabled property needed
    dom.modal.name.value = project.name;
    dom.modal.root.value = project.outputRoot;
    dom.modal.prefix.value = project.globalPrefix;
    dom.modal.suffix.value = project.globalSuffix;
    dom.modal.aspectRatio.value = project.defaultAspectRatio || "2:3";
    dom.modal.resolution.value = project.defaultResolution || "2K";

    dom.modal.delete.style.display = "block"; // Show delete button

    isCreateMode = false;
  } else {
    // Create Mode
    dom.modal.title.textContent = "New Project";
    dom.modal.id.value = "";
    dom.modal.idDisplay.textContent = " ";
    // ID is hidden input now, no disabled property to set

    dom.modal.name.value = "";
    dom.modal.root.value = "";
    dom.modal.prefix.value = "";
    dom.modal.suffix.value = "";
    dom.modal.aspectRatio.value = "2:3";
    dom.modal.resolution.value = "2K";

    dom.modal.delete.style.display = "none"; // Hide delete button

    // Reset flags for new project
    isIdManuallyChanged = false;
    isRootManuallyChanged = false;
    isCreateMode = true;
  }
}

// Auto-fill Logic
let listenersAttached = false;
let isIdManuallyChanged = false;
let isRootManuallyChanged = false;
let isCreateMode = false;

function attachAutoFillListeners() {
  if (listenersAttached) return;

  dom.modal.name.addEventListener("input", () => {
    if (!isCreateMode) return;

    const nameVal = dom.modal.name.value;

    if (!isIdManuallyChanged) {
      // Safe ID: lowercase, remove special chars, spaces to hyphens
      const safeId = nameVal
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-");
      dom.modal.id.value = safeId;
      dom.modal.idDisplay.textContent = safeId;
    }

    if (!isRootManuallyChanged) {
      // Safe Folder: remove special chars, spaces to underscores
      const safeRoot = nameVal
        .toLowerCase()
        .replace(/[^a-z0-9\s_-]/g, "")
        .trim()
        .replace(/\s+/g, "_");
      dom.modal.root.value = safeRoot;
    }
  });

  // ID is no longer manually editable, so we don't need a listener for it

  dom.modal.root.addEventListener("input", () => {
    isRootManuallyChanged = true;
  });

  listenersAttached = true;
}

// Attach listeners once at module load time (or when first used)
// Since this module is imported by main.js, we can just run this:
attachAutoFillListeners();

// Project Selection UI
export async function renderProjectSelection() {
  dom.projectSelectionView.classList.remove("hidden");
  dom.projectGridContainer.innerHTML = "";

  // Apply pulse-highlight to create button if no projects
  if (state.projects.length === 0) {
    dom.btns.projectSelectionCreate.classList.add("pulse-highlight");
  } else {
    dom.btns.projectSelectionCreate.classList.remove("pulse-highlight");
  }

  // Render each project card
  for (const project of state.projects) {
    const card = document.createElement("div");
    card.className = "project-card";

    const title = document.createElement("h3");
    title.textContent = project.name;

    const previewGrid = document.createElement("div");
    previewGrid.className = "project-preview-grid";

    // Fetch preview images
    try {
      const previews = await api.fetchProjectPreviews(project.id);

      if (previews.length === 0) {
        const empty = document.createElement("div");
        empty.className = "project-preview-empty";
        empty.textContent = "No images yet";
        previewGrid.appendChild(empty);
      } else {
        // Show up to 6 preview images
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
      empty.textContent = "No images yet";
      previewGrid.appendChild(empty);
    }

    card.appendChild(title);
    card.appendChild(previewGrid);

    // Click handler to select project
    card.addEventListener("click", async () => {
      dom.projectSelect.value = project.id;
      await onProjectSelect();
    });

    dom.projectGridContainer.appendChild(card);
  }
}
