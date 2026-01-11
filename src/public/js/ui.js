// UI Helpers and DOM Elements

export const dom = {
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
    apiKey: document.getElementById("apiKeyInput"),
    keySelect: document.getElementById("keySelect"),
    newKeyName: document.getElementById("newKeyName"),
    newKeyValue: document.getElementById("newKeyValue"),
  },
  // preview: document.getElementById("promptPreview"), // Removed
  btns: {
    addKeyToggle: document.getElementById("addKeyToggleBtn"),
    saveNewKey: document.getElementById("saveKeyBtn"),
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
    closeX: document.getElementById("imgModalCloseX"),
  },
  toastContainer: document.getElementById("toast-container"),
};

export function createToast(msg, type = "info", duration = 5000) {
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
export function showStatus(msg, type = "info") {
  createToast(msg, type, 5000);
}
