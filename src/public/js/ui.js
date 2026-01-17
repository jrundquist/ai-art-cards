// UI Helpers and DOM Elements

export const dom = {
  projectSelect: document.getElementById("projectSelect"),
  newProjectBtn: document.getElementById("newProjectBtn"),
  openFolderBtn: document.getElementById("openFolderBtn"),
  editProjectBtn: document.getElementById("editProjectBtn"),
  cardList: document.getElementById("cardList"),
  searchInput: document.getElementById("cardSearchInput"),
  newCardBtn: document.getElementById("newCardBtn"),
  newCardBtnSmall: document.getElementById("newCardBtnSmall"),
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
    titleInput: document.getElementById("cardTitleInput"),
  },
  // preview: document.getElementById("promptPreview"), // Removed
  btns: {
    help: document.getElementById("helpBtn"),
    editTitle: document.getElementById("editTitleBtn"),
    addKeyToggle: document.getElementById("addKeyToggleBtn"),
    saveNewKey: document.getElementById("saveKeyBtn"),
    saveCard: document.getElementById("saveCardBtn"),
    openCardFolder: document.getElementById("openCardFolderBtn"),
    generate: document.getElementById("generateBtn"),
    favFilter: document.getElementById("galleryFilterFavorites"),
    archiveFilter: document.getElementById("galleryFilterArchive"),
    downloadGallery: document.getElementById("galleryDownloadBtn"),
    projectSelectionCreate: document.getElementById(
      "projectSelectionCreateBtn"
    ),
    newCardHeader: document.getElementById("newCardHeaderBtn"),
  },
  forms: {
    // newKey: document.getElementById("newKeyForm"), // Removed
  },
  gallery: document.getElementById("gallery"),
  modal: {
    self: document.getElementById("projectModal"),
    title: document.getElementById("projectModalTitle"),
    save: document.getElementById("saveProjectBtn"),
    delete: document.getElementById("deleteProjectBtn"),
    cancel: document.getElementById("cancelProjectBtn"),
    id: document.getElementById("newProjectId"),
    idDisplay: document.getElementById("newProjectIdDisplay"),
    name: document.getElementById("newProjectName"),
    description: document.getElementById("newProjectDescription"),
    root: document.getElementById("newProjectRoot"),
    prefix: document.getElementById("globalPrefix"),
    suffix: document.getElementById("globalSuffix"),
    aspectRatio: document.getElementById("newAspectRatio"),
    resolution: document.getElementById("newResolution"),
  },
  keyModal: {
    self: document.getElementById("keyModal"),
    save: document.getElementById("saveKeyBtn"),
    cancel: document.getElementById("cancelKeyBtn"),
    name: document.getElementById("newKeyName"),
    value: document.getElementById("newKeyValue"),
  },
  confirmModal: {
    self: document.getElementById("confirmModal"),
    title: document.getElementById("confirmModalTitle"),
    message: document.getElementById("confirmModalMessage"),
    confirm: document.getElementById("confirmBtn"),
    cancel: document.getElementById("cancelConfirmBtn"),
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
    favBtn: document.getElementById("imgModalFavoriteBtn"),
    // New Fields
    regenBtn: document.getElementById("imgModalRegenBtn"),
    model: document.getElementById("imgModalModel"),
    size: document.getElementById("imgModalSize"),
    creator: document.getElementById("imgModalCreator"),
    refContainer: document.getElementById("imgModalRefContainer"),
    refImages: document.getElementById("imgModalRefImages"),
  },
  regenModal: {
    self: document.getElementById("regenerationModal"),
    title: document.getElementById("regenModalTitle"),
    prompt: document.getElementById("regenPrompt"),
    count: document.getElementById("regenCount"),
    refContainer: document.getElementById("regenRefsContainer"),
    refList: document.getElementById("regenRefList"),
    cancel: document.getElementById("cancelRegenBtn"),
    confirm: document.getElementById("confirmRegenBtn"),
  },
  helpModal: {
    self: document.getElementById("helpModal"),
    close: document.getElementById("closeHelpBtn"),
  },
  statusBar: {
    self: document.getElementById("statusBar"),
    message: document.getElementById("statusMessage"),
    center: document.getElementById("statusCenter"),
  },
  projectSelectionView: document.getElementById("projectSelectionView"),
  projectGridContainer: document.getElementById("projectGridContainer"),
  toastContainer: document.getElementById("toast-container"),
  sidebarSearchWrapper: document.querySelector(".sidebar-search-wrapper"),
};

export function toggleSidebar(enabled) {
  if (dom.sidebarSearchWrapper) {
    if (enabled) {
      dom.sidebarSearchWrapper.classList.remove("disabled-area");
    } else {
      dom.sidebarSearchWrapper.classList.add("disabled-area");
    }
  }

  if (dom.newCardBtn) {
    dom.newCardBtn.disabled = !enabled;
    if (enabled) {
      dom.newCardBtn.classList.remove("disabled-btn");
    } else {
      dom.newCardBtn.classList.add("disabled-btn");
    }
  }

  if (dom.newCardBtnSmall) {
    dom.newCardBtnSmall.disabled = !enabled;
    if (enabled) {
      dom.newCardBtnSmall.classList.remove("disabled-btn");
    } else {
      dom.newCardBtnSmall.classList.add("disabled-btn");
    }
  }
}

export function createToast(msg, type = "info", duration = 5000, icon = null) {
  const div = document.createElement("div");
  div.className = `toast ${type}`;

  if (icon) {
    div.innerHTML = `<span class="material-icons" style="margin-right: 8px; font-size: 1.2em; vertical-align: middle;">${icon}</span><span style="vertical-align: middle;">${msg}</span>`;
  } else {
    div.textContent = msg;
  }

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

export function confirmAction(title, message, onConfirm) {
  dom.confirmModal.title.textContent = title;
  dom.confirmModal.message.textContent = message;
  dom.confirmModal.self.classList.remove("hidden");

  const cleanup = () => {
    window.removeEventListener("keydown", handleKeydown);
    dom.confirmModal.self.classList.add("hidden");
    dom.confirmModal.confirm.onclick = null;
    dom.confirmModal.confirm.innerText = "Confirm"; // Reset in case it was loading
    dom.confirmModal.cancel.onclick = null;
  };

  const handleKeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      dom.confirmModal.confirm.click();
    } else if (e.key === "Escape") {
      e.preventDefault();
      dom.confirmModal.cancel.click();
    }
  };

  window.addEventListener("keydown", handleKeydown);

  dom.confirmModal.confirm.onclick = async () => {
    // maybe show loading state?
    dom.confirmModal.confirm.innerText = "Processing...";
    await onConfirm();
    cleanup();
  };

  dom.confirmModal.cancel.onclick = () => {
    cleanup();
  };
}

export function updateStatusBar(msg) {
  if (dom.statusBar.message) {
    dom.statusBar.message.textContent = msg;
  }
}

export function updateStatusCenter(msg) {
  if (dom.statusBar.center) {
    dom.statusBar.center.textContent = msg;
  }
}
