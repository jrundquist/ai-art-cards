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

  updateStatusCenter(card.name);

  if (updateHistory) updateUrl();

  loadImagesForCard(state.currentProject.id, card.id);

  // Dispatch event for other components (e.g., Chat)
  document.dispatchEvent(
    new CustomEvent("card-selected", { detail: { card } })
  );
}

export async function createNewCard() {
  if (!state.currentProject)
    return showStatus("Select a project first", "error");

  const cardId = `card_${nanoid(10)}`;
  const newCard = {
    id: cardId,
    projectId: state.currentProject.id,
    name: "New Card",
    prompt: "",
    outputSubfolder: cardId, // Use card ID as unique folder name
  };

  // Auto-save the new card immediately with defaults to prevent "Card not found" errors
  await api.saveCard(newCard);
  await loadCards(state.currentProject.id); // Refresh list to show the new card

  selectCard(newCard);
}

export async function saveCurrentCard(silent = false) {
  if (!state.currentCard) return;

  state.currentCard.name = dom.inputs.name.value;
  state.currentCard.outputSubfolder = dom.inputs.subfolder.value;
  state.currentCard.aspectRatio = dom.inputs.cardAspectRatio.value;
  state.currentCard.resolution = dom.inputs.cardResolution.value;
  state.currentCard.prompt = dom.inputs.prompt.value;

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
    const payload = {
      cardId: targetCardId,
      projectId: targetProjectId,
      count: count,
      promptOverride: overrides?.promptOverride || dom.inputs.prompt.value,
      arOverride: overrides?.arOverride || dom.inputs.cardAspectRatio.value,
      resOverride: overrides?.resOverride || dom.inputs.cardResolution.value,
    };

    const data = await api.generateImages(payload);
    const resJson = await data.json();

    if (resJson.error) {
      showStatus(`Error: ${resJson.error}`, "error");
      return;
    }

    // Server will handle notifications and status bar via SSE
    console.log(`[Generate] Started job ${resJson.jobId} for ${count} images`);
  } catch (e) {
    showStatus(`Error: ${e.message}`, "error");
  }
}
