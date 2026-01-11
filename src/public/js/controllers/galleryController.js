import { state } from "../state.js";
import { dom, createToast, confirmAction } from "../ui.js";
import * as api from "../api.js";

let currentImageList = [];

let isFavoritesOnly = false;
let isArchiveView = false; // "Trash" view

export function toggleFilterFavorites() {
  if (isArchiveView) {
    // If in archive view, maybe just toggle off archive view first?
    // Or allow filtering favorites IN archive view?
    // Let's allow simple mutual exclusion for clarity first, or independent.
    // User probably wants to see favorites in normal view.
    toggleFilterArchive(); // Turn off archive view
  }

  isFavoritesOnly = !isFavoritesOnly;
  updateFilterButtons();

  if (state.currentProject && state.currentCard) {
    loadImagesForCard(state.currentProject.id, state.currentCard.id);
  }
}

export function toggleFilterArchive() {
  if (isFavoritesOnly) {
    // disable favorites filter when switching to archive?
    // Or keep it? Let's keep it simple: Archive view is a different mode.
    isFavoritesOnly = false;
  }

  isArchiveView = !isArchiveView;
  updateFilterButtons();

  if (state.currentProject && state.currentCard) {
    loadImagesForCard(state.currentProject.id, state.currentCard.id);
  }
}

function updateFilterButtons() {
  const favBtn = dom.btns.favFilter;
  const archBtn = dom.btns.archiveFilter; // We need to add this to main/ui

  if (favBtn) {
    favBtn.classList.toggle("active", isFavoritesOnly);
    favBtn.setAttribute("aria-pressed", isFavoritesOnly);
  }

  if (archBtn) {
    archBtn.classList.toggle("active", isArchiveView);
    archBtn.setAttribute("aria-pressed", isArchiveView);
    // Maybe change icon color to red when active?
    archBtn.style.color = isArchiveView ? "#ef4444" : "";
  }
}

export async function loadImagesForCard(projectId, cardId) {
  dom.gallery.innerHTML = '<div class="gallery-loader">Loading...</div>';
  try {
    // Always fetch ALL images so we can filter client-side
    // This makes switching views instant and we don't need to re-fetch to see "Trash"
    const images = await api.fetchCardImages(projectId, cardId, true);

    const favs = state.currentCard?.favoriteImages || [];
    const archived = state.currentCard?.archivedImages || [];

    dom.gallery.innerHTML = "";

    if (!Array.isArray(images)) {
      if (images && images.error) throw new Error(images.error);
      dom.gallery.innerHTML = '<div class="empty-state">No images yet</div>';
      return;
    }

    let displayImages = images;

    // Filter by Archive Status
    if (isArchiveView) {
      // Show ONLY archived
      displayImages = displayImages.filter((img) => {
        const filename = img.split("/").pop();
        return archived.includes(filename);
      });
    } else {
      // Show ONLY non-archived (default)
      displayImages = displayImages.filter((img) => {
        const filename = img.split("/").pop();
        return !archived.includes(filename);
      });
    }

    // Filter by Favorites
    if (isFavoritesOnly) {
      displayImages = displayImages.filter((img) => {
        const filename = img.split("/").pop();
        return favs.includes(filename);
      });
    }

    if (displayImages.length === 0) {
      dom.gallery.innerHTML = isArchiveView
        ? '<div class="empty-state">Trash is empty</div>'
        : '<div class="empty-state">No images found</div>';
      currentImageList = [];
      return;
    }

    currentImageList = [...displayImages];

    displayImages.forEach((imgUrl) => {
      const filename = imgUrl.split("/").pop();
      const isFav = favs.includes(filename);
      const isArchived = archived.includes(filename);
      addImageToGallery(imgUrl, false, isFav, isArchived);
    });
  } catch (e) {
    dom.gallery.innerHTML = `<div class="error-state">Error loading images: ${e.message}</div>`;
  }
}

export function addImageToGallery(
  imgUrl,
  prepend = false,
  isFav = false,
  isArchived = false
) {
  const div = document.createElement("div");
  div.className = "gallery-item";
  const img = document.createElement("img");
  img.src = "/" + imgUrl;
  img.loading = "lazy";

  div.onclick = () => openImageDetails(imgUrl);

  // Favorite Icon
  const favIcon = document.createElement("div");
  favIcon.className = `gallery-fav-icon ${isFav ? "active" : ""}`;
  favIcon.innerHTML = "♥";
  favIcon.title = "Toggle Favorite";
  favIcon.onclick = (e) => {
    e.stopPropagation();
    toggleImageFavorite(imgUrl);
  };

  // Archive Icon
  const archiveIcon = document.createElement("div");
  archiveIcon.className = `gallery-archive-icon`;
  // Icon depends on view? Or always trash can?
  // If in archive view, maybe "Restore" icon (undo arrow)?
  // For now, let's use Trash for both, but maybe different color/tooltip
  archiveIcon.innerHTML = isArchiveView ? "♻️" : "🗑️";
  archiveIcon.title = isArchiveView ? "Restore Image" : "Archive Image";
  archiveIcon.onclick = (e) => {
    e.stopPropagation();
    toggleImageArchive(imgUrl);
  };

  div.appendChild(img);
  div.appendChild(favIcon);
  div.appendChild(archiveIcon);

  if (prepend) {
    // Note: Prepend likely needs to handle favorite status check if used during generation
    if (prepend) currentImageList.unshift(imgUrl);
    else currentImageList.push(imgUrl);
    dom.gallery.prepend(div);
  } else {
    dom.gallery.appendChild(div);
  }
}

let currentImgPath = null;

export function navigateGallery(direction) {
  if (!currentImgPath || currentImageList.length === 0) return;

  const currentIndex = currentImageList.indexOf(currentImgPath);
  if (currentIndex === -1) return;

  let newIndex;
  if (direction === "next") {
    newIndex = (currentIndex + 1) % currentImageList.length;
  } else {
    newIndex =
      (currentIndex - 1 + currentImageList.length) % currentImageList.length;
  }

  openImageDetails(currentImageList[newIndex]);
}

export async function toggleImageFavorite(imgUrl = null) {
  const targetUrl = imgUrl || currentImgPath;
  if (!targetUrl || !state.currentCard || !state.currentProject) return;

  const filename = targetUrl.split("/").pop();

  try {
    const res = await api.toggleFavorite(
      state.currentCard.id,
      state.currentProject.id,
      filename
    );
    if (res.ok) {
      const data = await res.json();
      if (state.currentCard.favoriteImages === undefined)
        state.currentCard.favoriteImages = [];

      if (data.isFavorite) {
        if (!state.currentCard.favoriteImages.includes(filename)) {
          state.currentCard.favoriteImages.push(filename);
        }
      } else {
        const idx = state.currentCard.favoriteImages.indexOf(filename);
        if (idx > -1) state.currentCard.favoriteImages.splice(idx, 1);
      }

      if (
        currentImgPath === targetUrl &&
        !dom.imgModal.self.classList.contains("hidden")
      ) {
        dom.imgModal.favBtn.classList.toggle("active", data.isFavorite);
      }

      if (isFavoritesOnly && !data.isFavorite) {
        loadImagesForCard(state.currentProject.id, state.currentCard.id);
      } else {
        const items = Array.from(dom.gallery.children);
        const item = items.find((el) =>
          el.querySelector("img").src.endsWith(targetUrl)
        );
        if (item) {
          const icon = item.querySelector(".gallery-fav-icon");
          if (icon) icon.classList.toggle("active", data.isFavorite);
        }
      }
    }
  } catch (e) {
    createToast("Failed to toggle favorite", "error");
  }
}

export async function openImageDetails(imgUrl) {
  const isNavigating = !dom.imgModal.self.classList.contains("hidden");
  currentImgPath = imgUrl;

  dom.imgModal.self.classList.remove("hidden");
  dom.imgModal.preview.src = "/" + imgUrl;
  dom.imgModal.link.href = "/" + imgUrl;
  const relativePath = imgUrl.startsWith("data/")
    ? imgUrl.substring(5)
    : imgUrl;
  dom.imgModal.link.setAttribute("data-open-in-folder", relativePath);

  // Set Favorite Button State
  const filename = imgUrl.split("/").pop();
  const isFav = state.currentCard?.favoriteImages?.includes(filename);
  dom.imgModal.favBtn.classList.toggle("active", !!isFav);
  // Remove event listeners to avoid dupes? Better to assign onclick directly
  dom.imgModal.favBtn.onclick = () => toggleImageFavorite(imgUrl);

  // Archive button in modal needs to reflect state (Archive vs Restore)
  const isArchived = state.currentCard?.archivedImages?.includes(filename);
  dom.imgModal.archiveBtn.textContent = isArchived ? "Restore" : "Archive";
  // Maybe change color? Red for archive, Green for restore?
  dom.imgModal.archiveBtn.style.borderColor = isArchived
    ? "var(--primary)"
    : "#ef4444";
  dom.imgModal.archiveBtn.style.color = isArchived
    ? "var(--primary)"
    : "#ef4444";

  dom.imgModal.archiveBtn.onclick = () => toggleImageArchive(imgUrl);

  // Visuals: indicate loading
  dom.imgModal.name.classList.add("text-loading");
  dom.imgModal.date.classList.add("text-loading");
  dom.imgModal.prompt.classList.add("text-loading");

  if (!isNavigating) {
    // Fresh open: Clear fields
    dom.imgModal.name.textContent = "Loading...";
    dom.imgModal.date.textContent = "";
    dom.imgModal.prompt.textContent = "";
  }

  try {
    const meta = await api.fetchImageMetadata(imgUrl);

    // Race condition check: if the user navigated away while we were fetching
    if (currentImgPath !== imgUrl) return;

    dom.imgModal.name.textContent = meta.filename;
    dom.imgModal.date.textContent = new Date(meta.created).toLocaleString();
    dom.imgModal.prompt.textContent = meta.prompt;

    // Remove loading class
    dom.imgModal.name.classList.remove("text-loading");
    dom.imgModal.date.classList.remove("text-loading");
    dom.imgModal.prompt.classList.remove("text-loading");
  } catch (e) {
    if (currentImgPath !== imgUrl) return;
    dom.imgModal.prompt.textContent = "Error loading metadata: " + e.message;
    dom.imgModal.name.classList.remove("text-loading");
    dom.imgModal.date.classList.remove("text-loading");
    dom.imgModal.prompt.classList.remove("text-loading");
  }
}

export async function toggleImageArchive(imgUrl = null) {
  const targetUrl = imgUrl || currentImgPath;
  if (!targetUrl || !state.currentCard || !state.currentProject) return;

  const filename = targetUrl.split("/").pop();
  const isCurrentlyArchived =
    state.currentCard?.archivedImages?.includes(filename);

  // Confirm only when archiving? Restoring is probably safe.
  const executeToggle = async () => {
    try {
      const res = await api.archiveImage(
        state.currentCard.id,
        state.currentProject.id,
        filename
      );

      // Backend returns { success: true, isArchived: boolean }
      const data = await res.json();
      if (data.success) {
        if (!state.currentCard.archivedImages)
          state.currentCard.archivedImages = [];

        if (data.isArchived) {
          if (!state.currentCard.archivedImages.includes(filename))
            state.currentCard.archivedImages.push(filename);
          createToast("Image archived", "success");
        } else {
          const idx = state.currentCard.archivedImages.indexOf(filename);
          if (idx > -1) state.currentCard.archivedImages.splice(idx, 1);
          createToast("Image restored", "success");
        }

        // If modal is open, verify if we should close it or update it
        if (
          !dom.imgModal.self.classList.contains("hidden") &&
          currentImgPath === targetUrl
        ) {
          // If we archived it, and we are not in archive view, we should probably close modal?
          // Or just let user keep looking at it?
          // Usually if it disappears from gallery, we might want to close modal.
          if (isArchiveView !== data.isArchived) {
            // If view mode matches state (e.g. ArchiveView + IsArchived), keep it.
            // If ArchiveView + !IsArchived (Restored), close it?
            // Let's just update the button for now.
            dom.imgModal.archiveBtn.textContent = data.isArchived
              ? "Restore"
              : "Archive";
            dom.imgModal.archiveBtn.style.borderColor = data.isArchived
              ? "var(--primary)"
              : "#ef4444";
            dom.imgModal.archiveBtn.style.color = data.isArchived
              ? "var(--primary)"
              : "#ef4444";
          }
        }

        // Refresh gallery to update list
        loadImagesForCard(state.currentProject.id, state.currentCard.id);
      }
    } catch (e) {
      createToast("Failed to toggle archive: " + e.message, "error");
    }
  };

  if (!isCurrentlyArchived) {
    confirmAction(
      "Archive Image?",
      "Are you sure you want to archive this image?",
      executeToggle
    );
  } else {
    await executeToggle();
  }
}

// Renamed for compatibility if needed, or export new name
export const archiveCurrentImage = () => toggleImageArchive(currentImgPath);
