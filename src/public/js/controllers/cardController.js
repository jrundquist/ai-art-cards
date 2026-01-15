import { state } from "../state.js";
import {
  dom,
  showStatus,
  createToast,
  confirmAction,
  updateStatusBar,
  updateStatusCenter,
} from "../ui.js";
import * as api from "../api.js";
import { nanoid } from "../utils.js";
import { loadImagesForCard, addImageToGallery } from "./galleryController.js";

function updateUrl() {
  const params = new URLSearchParams();
  if (state.currentProject) params.set("project", state.currentProject.id);
  if (state.currentCard) params.set("card", state.currentCard.id);

  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.pushState({}, "", newUrl);
}

export async function loadCards(projectId) {
  const cards = await api.fetchCards(projectId);
  state.allCards = cards;
  renderCardList(cards);

  if (cards.length === 0) {
    dom.newCardBtn.classList.add("pulse-highlight", "glow");
  } else {
    dom.newCardBtn.classList.remove("pulse-highlight", "glow");
  }
  return cards;
}

export function renderCardList(cards) {
  dom.cardList.innerHTML = "";
  cards.forEach((card) => {
    const div = document.createElement("div");
    div.className = "card-item";
    if (state.currentCard && state.currentCard.id === card.id) {
      div.classList.add("active");
    }
    div.dataset.id = card.id;

    const count = card.imageCount !== undefined ? card.imageCount : 0;

    div.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <span>${card.name}</span>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 0.8em; color: var(--text-muted); background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 10px;">${count}</span>
              <button class="delete-card-icon" title="Delete Card" style="background: none; border: none; cursor: pointer; color: #64748b; font-size: 1.1em; padding: 0; line-height: 1; display: none;"><span class="material-icons" style="font-size: 16px;">delete_outline</span></button>
            </div>
        </div>
    `;

    // Show delete button on hover (via JS for simplicity, or CSS could work if structure allows)
    // Actually, let's use CSS for hover effect if possible, but JS for the click handler is must.
    div.onmouseenter = () => {
      const btn = div.querySelector(".delete-card-icon");
      if (btn) btn.style.display = "block";
    };
    div.onmouseleave = () => {
      const btn = div.querySelector(".delete-card-icon");
      if (btn) btn.style.display = "none";
    };

    div.onclick = (e) => {
      // Check if delete button or its icon was clicked
      if (
        e.target.classList.contains("delete-card-icon") ||
        e.target.closest(".delete-card-icon")
      ) {
        e.stopPropagation();
        deleteCard(card);
        return;
      }
      selectCard(card);
    };
    dom.cardList.appendChild(div);
  });
}

export function filterCards() {
  const term = dom.searchInput.value.toLowerCase();
  const filtered = state.allCards.filter((c) =>
    c.name.toLowerCase().includes(term)
  );
  renderCardList(filtered);
}

export function selectCard(card, updateHistory = true) {
  state.currentCard = card;
  dom.editorArea.classList.remove("hidden");
  dom.currentCardTitle.textContent = card.name;

  dom.inputs.name.value = card.name;
  dom.inputs.subfolder.value = card.outputSubfolder || "";
  dom.inputs.cardAspectRatio.value = card.aspectRatio || "";
  dom.inputs.cardResolution.value = card.resolution || "";
  dom.inputs.prompt.value = card.prompt || "";

  // Render Modifier Toggles
  const modifierRow = document.getElementById("modifierToggleRow");
  const modifierContainer = document.getElementById("modifierToggles");

  if (modifierRow && modifierContainer) {
    if (
      state.currentProject &&
      state.currentProject.promptModifiers &&
      state.currentProject.promptModifiers.length > 0
    ) {
      modifierRow.style.display = "flex";
      modifierContainer.innerHTML = "";

      const disabled = new Set(card.inactiveModifiers || []);

      state.currentProject.promptModifiers.forEach((mod) => {
        const label = document.createElement("label");
        label.className = "modifier-toggle-label";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.id = mod.id;
        checkbox.checked = !disabled.has(mod.id); // Checked if NOT disabled

        const span = document.createElement("span");
        span.textContent = `${mod.name}`;

        label.appendChild(checkbox);
        label.appendChild(span);
        modifierContainer.appendChild(label);
      });
    } else {
      modifierRow.style.display = "none";
      modifierContainer.innerHTML = "";
    }
  }

  updateStatusCenter(card.name);

  if (updateHistory) updateUrl();

  loadImagesForCard(state.currentProject.id, card.id);

  // Update .active class on DOM
  const cardItems = dom.cardList.querySelectorAll(".card-item");
  cardItems.forEach((item) => {
    if (item.dataset.id === card.id) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  // Dispatch event for other components (e.g., Chat)
  document.dispatchEvent(
    new CustomEvent("card-selected", { detail: { card } })
  );
}

export async function createNewCard() {
  if (!state.currentProject)
    return showStatus("Select a project first", "error");

  // ID will be generated by server
  const newCard = {
    projectId: state.currentProject.id,
    name: "New Card",
    prompt: "",
    inactiveModifiers: [],
    // outputSubfolder will be set/defaulted if needed, or we can leave it empty
    // and let user or server set it?
    // Server logic doesn't default subfolder unless we added that?
    // Wait, I didn't add default subfolder logic in server for new cards.
    // I should probably set a temporary one or update server to handle it.
    // The previous code used ID for subfolder.
    // Since I don't have ID yet, I can't check it here.
    // Let's defer outputSubfolder or use a placeholder that gets updated?
    // Actually, best to let server handle it or update it after creation?
    // BUT, server `saveCard` implementation just saves what acts.
    // If I send no outputSubfolder, it might rely on default behavior.

    // DECISION: I'll let the server generate the ID, return the card, and THEN
    // if outputSubfolder is missing, I might want to update it to match ID?
    // Or just set it to "pending" and update it when I get ID?
    // Actually, `DataService` creates ID.
    // I can modify server.ts to also default outputSubfolder if missing to the ID?
    // FOR NOW: I will just send empty subfolder and rely on the fact that
    // subsequent edits will fix it, OR I'll handle it in the response.
    // Actually, looking at `DataService.saveCard`, it just writes JSON.
    // If `outputSubfolder` is undefined, it stays undefined.
    // `generate` uses `card.outputSubfolder || "default"`.
    // So it's safe to be empty initially.
  };

  // Auto-save the new card immediately
  const res = await api.saveCard(newCard);

  if (res.success && res.card) {
    // If we want subfolder to match ID (standard convention in this app),
    // we could update it now.
    if (!res.card.outputSubfolder) {
      res.card.outputSubfolder = res.card.id;
      await api.saveCard(res.card);
    }

    await loadCards(state.currentProject.id); // Refresh list
    selectCard(res.card);
  } else {
    showStatus("Failed to create card: " + (res.error || "Unknown"), "error");
  }
}

export async function saveCurrentCard(silent = false) {
  if (!state.currentCard) return;

  state.currentCard.name = dom.inputs.name.value;
  state.currentCard.outputSubfolder = dom.inputs.subfolder.value;
  state.currentCard.aspectRatio = dom.inputs.cardAspectRatio.value;
  state.currentCard.resolution = dom.inputs.cardResolution.value;
  state.currentCard.prompt = dom.inputs.prompt.value;

  // Save active/inactive state
  const modifierContainer = document.getElementById("modifierToggles");
  if (modifierContainer) {
    const inactive = [];
    modifierContainer
      .querySelectorAll("input[type='checkbox']")
      .forEach((cb) => {
        if (!cb.checked) {
          inactive.push(cb.dataset.id);
        }
      });
    state.currentCard.inactiveModifiers = inactive;
  }

  await api.saveCard(state.currentCard);

  await loadCards(state.currentProject.id); // Refresh list
  if (!silent) showStatus("Card Saved", "success");
}

export async function deleteCurrentCard() {
  deleteCard(state.currentCard);
}

export async function deleteCard(card) {
  if (!card) return;

  confirmAction(
    "Delete Card?",
    `Delete "${card.name}" and all its images?`,
    async () => {
      await api.deleteCard(state.currentProject.id, card.id);
      showStatus("Card deleted", "success");

      if (state.currentCard && state.currentCard.id === card.id) {
        state.currentCard = null;
        dom.editorArea.classList.add("hidden");
      }

      await loadCards(state.currentProject.id);
    }
  );
}

export async function generateArt(overrides = null) {
  // If overrides provided, use them. Otherwise check state.currentCard.
  const targetCardId = overrides?.cardId || state.currentCard?.id;
  const targetProjectId = overrides?.projectId || state.currentProject?.id;

  if (!targetCardId || !targetProjectId) return;

  // If we are generating for the current card, try to save first
  if (state.currentCard && state.currentCard.id === targetCardId) {
    await saveCurrentCard(true);
  }

  const count = overrides?.count || parseInt(dom.inputs.count.value) || 1;

  try {
    // Simplified override merging: preserve base payload but allow overrides to win
    const payload = {
      cardId: targetCardId,
      projectId: targetProjectId,
      count: count,
      ...overrides, // Direct merge
    };

    // Explicitly clean up any undefined values if merge caused them (though fetch handles this mostly, cleaner to be sure)
    Object.keys(payload).forEach(
      (key) => payload[key] === undefined && delete payload[key]
    );

    const data = await api.generateImages(payload);
    const resJson = await data.json();

    if (resJson.error) {
      showStatus(`Error: ${resJson.error}`, "error");
      return null;
    }

    // Server will handle notifications and status bar via SSE
    console.log(`[Generate] Started job ${resJson.jobId} for ${count} images`);
    return resJson.jobId;
  } catch (e) {
    showStatus(`Error: ${e.message}`, "error");
    return null;
  }
}
