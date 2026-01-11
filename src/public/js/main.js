import { state } from "./state.js";
import { dom, showStatus } from "./ui.js";
import * as api from "./api.js";
import * as projectCtrl from "./controllers/projectController.js";
import * as cardCtrl from "./controllers/cardController.js";
import * as galleryCtrl from "./controllers/galleryController.js";

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

  const lastName = localStorage.getItem("lastApiKeyName");
  if (lastName) {
    const option = Array.from(dom.inputs.keySelect.options).find(
      (o) => o.text === lastName
    );
    if (option) {
      dom.inputs.keySelect.value = option.value;
      await api.saveConfig({ apiKey: option.value });
    }
  }
}

async function init() {
  await projectCtrl.loadProjects();
  dom.projectSelect.addEventListener("change", () =>
    projectCtrl.onProjectSelect(true)
  );

  await loadKeys();

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

  dom.btns.addKeyToggle.addEventListener("click", () => {
    dom.forms.newKey.classList.toggle("hidden");
  });

  dom.btns.saveNewKey.addEventListener("click", async () => {
    const name = dom.inputs.newKeyName.value;
    const key = dom.inputs.newKeyValue.value;
    if (key && name) {
      await api.saveConfig({ apiKey: key, name });
      dom.forms.newKey.classList.add("hidden");
      dom.inputs.newKeyName.value = "";
      dom.inputs.newKeyValue.value = "";
      await loadKeys();
      dom.inputs.keySelect.value = key;
      showStatus("API Key Saved", "success");
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
  dom.btns.saveCard.addEventListener("click", () => cardCtrl.saveCurrentCard());
  dom.btns.generate.addEventListener("click", cardCtrl.generateArt);
  dom.searchInput.addEventListener("input", cardCtrl.filterCards);

  // Project Modals
  dom.newProjectBtn.addEventListener("click", () =>
    projectCtrl.openProjectModal(null)
  );
  dom.editProjectBtn.addEventListener("click", () => {
    if (state.currentProject)
      projectCtrl.openProjectModal(state.currentProject);
  });

  dom.modal.cancel.addEventListener("click", () =>
    dom.modal.self.classList.add("hidden")
  );
  dom.modal.save.addEventListener("click", projectCtrl.saveProjectConfig);

  // Image Modal
  dom.imgModal.closeBtn.addEventListener("click", () =>
    dom.imgModal.self.classList.add("hidden")
  );
  dom.imgModal.archiveBtn.addEventListener(
    "click",
    galleryCtrl.archiveCurrentImage
  );

  const closeOnBackdrop = (e, modalDiv) => {
    if (e.target === modalDiv) modalDiv.classList.add("hidden");
  };
  dom.modal.self.addEventListener("click", (e) =>
    closeOnBackdrop(e, dom.modal.self)
  );
  dom.imgModal.self.addEventListener("click", (e) =>
    closeOnBackdrop(e, dom.imgModal.self)
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      dom.imgModal.self.classList.add("hidden");
      dom.modal.self.classList.add("hidden");
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

init();
