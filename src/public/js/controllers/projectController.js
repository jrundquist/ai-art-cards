import { state } from "../state.js";
import { dom, showStatus } from "../ui.js";
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
}

export async function onProjectSelect(updateHistory = true) {
  const pid = dom.projectSelect.value;
  if (!pid) {
    state.currentProject = null;
    state.currentCard = null;
    dom.cardList.innerHTML = "";
    dom.editorArea.classList.add("hidden");
    if (updateHistory) updateUrl();
    if (dom.openFolderBtn) dom.openFolderBtn.title = "Open Data Folder";
    return;
  }

  state.currentProject = state.projects.find((p) => p.id === pid);
  if (dom.openFolderBtn) dom.openFolderBtn.title = "Open Project Folder";

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

export function openProjectModal(project) {
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
