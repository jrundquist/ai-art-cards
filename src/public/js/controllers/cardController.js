import { state } from "../state.js";
import { dom, showStatus, confirmAction, updateStatusCenter } from "../ui.js";
import * as api from "../api.js";
import { loadImagesForCard } from "./galleryController.js";

// Sort State
let currentSortMode = localStorage.getItem("cardSortMode") || "default";

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

  // Apply initial sort
  const sorted = getSortedCards(cards, currentSortMode);
  renderCardList(sorted);
  updateSortUI();

  if (cards.length === 0) {
    dom.newCardBtn.classList.add("pulse-highlight", "glow");
  } else {
    dom.newCardBtn.classList.remove("pulse-highlight", "glow");
  }

  setupSortUI();

  return cards;
}

function getSortedCards(cards, mode) {
  const sorted = [...cards];
  switch (mode) {
    case "name":
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case "count":
      return sorted.sort((a, b) => {
        const countA = a.imageCount !== undefined ? a.imageCount : 0;
        const countB = b.imageCount !== undefined ? b.imageCount : 0;
        return countB - countA;
      });
    default: // 'default' is chronological (ID based)
      return sorted; // Already sorted by ID from backend usually, or rely on array order
  }
}

function setupSortUI() {
  const sortBtn = document.getElementById("sortBtn");
  const sortMenu = document.getElementById("sortMenu");

  if (!sortBtn || !sortMenu) return;

  // Cleanup old listeners to avoid dupes (simple hack pattern)
  const newBtn = sortBtn.cloneNode(true);
  sortBtn.parentNode.replaceChild(newBtn, sortBtn);

  const newMenu = sortMenu.cloneNode(true);
  sortMenu.parentNode.replaceChild(newMenu, sortMenu);

  // Re-select
  const btn = document.getElementById("sortBtn");
  const menu = document.getElementById("sortMenu");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("hidden");
    btn.classList.toggle("active");
  });

  // Close on click outside
  document.addEventListener("click", (e) => {
    if (!btn.contains(e.target) && !menu.contains(e.target)) {
      menu.classList.add("hidden");
      btn.classList.remove("active");
    }
  });

  // Sort Options
  menu.querySelectorAll(".dropdown-item").forEach((item) => {
    item.addEventListener("click", () => {
      const mode = item.dataset.sort;
      setSortMode(mode);
      menu.classList.add("hidden");
      btn.classList.remove("active");
    });
  });

  updateSortUI();
}

function setSortMode(mode) {
  currentSortMode = mode;
  localStorage.setItem("cardSortMode", mode);

  // Re-render
  filterCards(); // This calls renderCardList with filtered+sorted cards
  updateSortUI();
}

function updateSortUI() {
  const menu = document.getElementById("sortMenu");
  if (!menu) return;

  menu.querySelectorAll(".dropdown-item").forEach((item) => {
    if (item.dataset.sort === currentSortMode) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });
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

    let thumbHtml = "";
    if (card.starredImage && card.outputSubfolder) {
      const thumbUrl = `/data/projects/${card.projectId}/assets/${card.outputSubfolder}/${card.starredImage}`;
      thumbHtml = `<img src="${thumbUrl}" class="card-item-thumb" loading="lazy">`;
    }

    div.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <div style="display: flex; align-items: center; overflow: hidden;">
                ${thumbHtml}
                <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${card.name}</span>
            </div>
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
  let filtered = state.allCards.filter((c) =>
    c.name.toLowerCase().includes(term),
  );

  // Apply Sort
  filtered = getSortedCards(filtered, currentSortMode);

  renderCardList(filtered);
}

export function selectCard(card, updateHistory = true) {
  state.currentCard = card;
  dom.editorArea.classList.remove("hidden");
  dom.currentCardTitle.textContent = card.name;

  if (card.starredImage && card.outputSubfolder) {
    const thumbUrl = `/data/projects/${card.projectId}/assets/${card.outputSubfolder}/${card.starredImage}`;
    dom.currentCardThumbnail.src = thumbUrl;
    dom.currentCardThumbnail.classList.remove("hidden");
  } else {
    dom.currentCardThumbnail.classList.add("hidden");
    dom.currentCardThumbnail.src = "";
  }

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
    new CustomEvent("card-selected", { detail: { card } }),
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

    // Need to find the fresh card object from state to ensure we have all fields
    const freshCard =
      state.allCards.find((c) => c.id === res.card.id) || res.card;
    selectCard(freshCard);
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
    },
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
      (key) => payload[key] === undefined && delete payload[key],
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
