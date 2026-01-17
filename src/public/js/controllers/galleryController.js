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

    // Filter by Favorites (Include Starred items in this view)
    if (isFavoritesOnly) {
      displayImages = displayImages.filter((img) => {
        const filename = img.split("/").pop();
        return (
          favs.includes(filename) ||
          state.currentCard?.starredImage === filename
        );
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
      const isStarred = state.currentCard?.starredImage === filename;
      const isArchived = archived.includes(filename);
      addImageToGallery(imgUrl, false, isFav, isArchived, isStarred);
    });
  } catch (e) {
    dom.gallery.innerHTML = `<div class="error-state">Error loading images: ${e.message}</div>`;
  }
}

export function addImageToGallery(
  imgUrl,
  prepend = false,
  isFav = false,
  isArchived = false,
  isStarred = false,
) {
  const div = document.createElement("div");
  div.className = "gallery-item";
  const img = document.createElement("img");
  img.src = "/" + imgUrl;
  img.loading = "lazy";
  img.draggable = true;

  // Add drag start handler for reference passing
  img.ondragstart = (e) => {
    e.dataTransfer.effectAllowed = "copy";
    // Construct reference data
    const filename = imgUrl.split("/").pop();
    const refData = {
      projectId: state.currentProject?.id,
      cardId: state.currentCard?.id,
      filename: filename,
      url: imgUrl, // Pass URL for preview
    };
    e.dataTransfer.setData(
      "application/x-art-cards-reference",
      JSON.stringify(refData),
    );
  };

  div.onclick = () => openImageDetails(imgUrl);

  // Favorite Icon
  const favIcon = document.createElement("div");
  favIcon.className = `gallery-fav-icon ${isFav ? "active" : ""}`;
  // Use filled heart if favorite, outline if not
  favIcon.innerHTML = `<span class="material-icons">${
    isFav ? "favorite" : "favorite_border"
  }</span>`;
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
  archiveIcon.innerHTML = isArchiveView
    ? '<span class="material-icons">restore_from_trash</span>'
    : '<span class="material-icons">delete_outline</span>';
  archiveIcon.title = isArchiveView ? "Restore Image" : "Archive Image";
  archiveIcon.onclick = (e) => {
    e.stopPropagation();
    toggleImageArchive(imgUrl);
  };

  // Star Icon
  const starIcon = document.createElement("div");
  starIcon.className = `gallery-star-icon ${isStarred ? "active" : ""}`;
  starIcon.innerHTML = `<span class="material-icons">${
    isStarred ? "star" : "star_border"
  }</span>`;
  starIcon.title = isStarred ? "Unstar (makes favorite)" : "Star this image";
  starIcon.onclick = (e) => {
    e.stopPropagation();
    toggleImageStar(imgUrl);
  };

  div.appendChild(img);
  if (isStarred) {
    div.appendChild(starIcon);
  } else {
    div.appendChild(favIcon);
  }
  div.appendChild(archiveIcon);

  if (prepend) {
    // Note: Prepend likely needs to handle favorite status check if used during generation
    currentImageList.unshift(imgUrl);
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
      filename,
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
        // Also update modal icon if it uses text content
        const modalIcon = dom.imgModal.favBtn.querySelector(".material-icons");
        if (modalIcon) {
          modalIcon.textContent = data.isFavorite
            ? "favorite"
            : "favorite_border";
        }
      }

      if (isFavoritesOnly && !data.isFavorite) {
        loadImagesForCard(state.currentProject.id, state.currentCard.id);
      } else {
        const items = Array.from(dom.gallery.children);
        const item = items.find((el) => {
          const img = el.querySelector("img");
          return img && img.src.endsWith(targetUrl);
        });
        if (item) {
          const icon = item.querySelector(".gallery-fav-icon");
          if (icon) {
            icon.classList.toggle("active", data.isFavorite);
            // Update the icon text as well
            const iconSpan = icon.querySelector(".material-icons");
            if (iconSpan) {
              iconSpan.textContent = data.isFavorite
                ? "favorite"
                : "favorite_border";
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("Failed to toggle favorite", e);
    createToast("Failed to toggle favorite", "error");
  }
}

export async function toggleImageStar(imgUrl = null) {
  const targetUrl = imgUrl || currentImgPath;
  if (!targetUrl || !state.currentCard || !state.currentProject) return;

  const filename = targetUrl.split("/").pop();

  try {
    const res = await api.toggleStar(
      state.currentCard.id,
      state.currentProject.id,
      filename,
    );
    if (res.ok) {
      const data = await res.json();

      // Update state
      state.currentCard.starredImage = data.starredImage;

      // Update allCards for sidebar matching
      if (state.allCards) {
        const cardInList = state.allCards.find(
          (c) => c.id === state.currentCard.id,
        );
        if (cardInList) {
          cardInList.starredImage = data.starredImage;
        }
      }

      // Update Top Bar Thumbnail
      if (dom.currentCardThumbnail) {
        if (
          state.currentCard.starredImage &&
          state.currentCard.outputSubfolder
        ) {
          const thumbUrl = `/data/projects/${state.currentProject.id}/assets/${state.currentCard.outputSubfolder}/${state.currentCard.starredImage}`;
          dom.currentCardThumbnail.src = thumbUrl;
          dom.currentCardThumbnail.classList.remove("hidden");
        } else {
          dom.currentCardThumbnail.classList.add("hidden");
          dom.currentCardThumbnail.src = "";
        }
      }

      // Signal sidebar update
      document.dispatchEvent(new CustomEvent("card-starred"));

      // If backend says it's favorite (e.g. was unstarred), ensure state reflects that
      if (data.isFavorite) {
        if (!state.currentCard.favoriteImages)
          state.currentCard.favoriteImages = [];
        if (!state.currentCard.favoriteImages.includes(filename)) {
          state.currentCard.favoriteImages.push(filename);
        }
      } else {
        // If not favorite (e.g. became starred), remove from favorites list
        if (state.currentCard.favoriteImages) {
          const idx = state.currentCard.favoriteImages.indexOf(filename);
          if (idx > -1) {
            state.currentCard.favoriteImages.splice(idx, 1);
          }
        }
      }

      console.log("Toggle Star Response:", data);

      // Refresh Gallery to update ALL stars (exclusive) and favorites
      // (Optimally we could update just the DOM elements, but loadImagesForCard is robust)
      loadImagesForCard(state.currentProject.id, state.currentCard.id);

      // If modal is open
      if (
        !dom.imgModal.self.classList.contains("hidden") &&
        currentImgPath === targetUrl
      ) {
        // Update Modal Star Icon
        updateModalStarBtn(!!data.isStarred);
        // Update Modal Favorite Icon (might have changed if unstarred)
        const showHeart = !!data.isFavorite;
        console.log("Updating Modal Heart:", showHeart);
        dom.imgModal.favBtn.classList.toggle("active", showHeart);
        const modalFavIcon =
          dom.imgModal.favBtn.querySelector(".material-icons");
        if (modalFavIcon) {
          modalFavIcon.textContent = showHeart ? "favorite" : "favorite_border";
        }
      }

      createToast(
        data.isStarred ? "Image Starred" : "Image Unstarred",
        "success",
      );
    }
  } catch (e) {
    createToast("Failed to toggle star: " + e.message, "error");
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

  // Set Star Button State
  const isStarred = state.currentCard?.starredImage === filename;
  updateModalStarBtn(isStarred);
  dom.imgModal.starBtn.onclick = () => toggleImageStar(imgUrl);

  // Archive button in modal needs to reflect state (Archive vs Restore)
  const isArchived = state.currentCard?.archivedImages?.includes(filename);
  const archIcon = dom.imgModal.archiveBtn.querySelector(".material-icons");
  if (archIcon) {
    archIcon.textContent = isArchived ? "restore_from_trash" : "delete_outline";
  }
  dom.imgModal.archiveBtn.title = isArchived
    ? "Restore Image"
    : "Archive Image";
  dom.imgModal.archiveBtn.setAttribute(
    "aria-label",
    isArchived ? "Restore Image" : "Archive Image",
  );

  // Adjust color: Red for archive, Primary/Green for restore?
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

    dom.imgModal.date.classList.remove("text-loading");
    dom.imgModal.prompt.classList.remove("text-loading");

    // Populate Extended Metadata
    dom.imgModal.model.textContent = meta.model || "Unknown";
    dom.imgModal.creator.textContent = meta.creator || "Unknown";

    let resText = "-";
    let arText = "-";

    if (meta.generationArgs) {
      if (meta.generationArgs.resolution)
        resText = meta.generationArgs.resolution;
      if (meta.generationArgs.aspectRatio)
        arText = meta.generationArgs.aspectRatio;
    }

    dom.imgModal.size.textContent = `${resText} (AR: ${arText})`;

    // Reference Images
    dom.imgModal.refImages.innerHTML = "";
    const refs = meta.generationArgs?.referenceImageFiles || [];
    const tempRefs = meta.generationArgs?.referenceImageIds || [];

    if (refs.length > 0 || tempRefs.length > 0) {
      dom.imgModal.refContainer.classList.remove("hidden");

      // 1. Historical Files
      refs.forEach((ref) => {
        if (ref.projectId && ref.cardId && ref.filename) {
          const img = document.createElement("img");
          const url = `/api/ref-image/${ref.projectId}/${ref.cardId}/${ref.filename}`;
          img.src = url;
          img.title = `Reference: ${ref.filename}`;
          img.classList.add("ref-image");
          dom.imgModal.refImages.appendChild(img);
        }
      });

      // 2. Temporary IDs
      tempRefs.forEach((id) => {
        const img = document.createElement("img");
        const url = `/api/temp-image/${id}`;
        img.src = url;
        img.title = `Temp Reference`;
        img.classList.add("ref-image");
        dom.imgModal.refImages.appendChild(img);
      });
    } else {
      dom.imgModal.refContainer.classList.add("hidden");
    }

    // Regeneration Button
    if (meta.generationArgs) {
      dom.imgModal.regenBtn.classList.remove("hidden");
      dom.imgModal.regenBtn.onclick = () =>
        openRegenerateDialog(meta.generationArgs);
    } else {
      dom.imgModal.regenBtn.classList.add("hidden");
    }
  } catch (e) {
    if (currentImgPath !== imgUrl) return;
    dom.imgModal.prompt.textContent = "Error loading metadata: " + e.message;
    dom.imgModal.name.classList.remove("text-loading");
    dom.imgModal.date.classList.remove("text-loading");
    dom.imgModal.prompt.classList.remove("text-loading");
  }
}

let activeRegenArgs = null;

function openRegenerateDialog(args) {
  activeRegenArgs = JSON.parse(JSON.stringify(args)); // Deep copy to avoid mutating orig

  dom.regenModal.prompt.value = activeRegenArgs.prompt || "";
  dom.regenModal.count.value = 1; // Default to 1 for regeneration

  // Reference Images
  dom.regenModal.refList.innerHTML = "";
  const refs = activeRegenArgs.referenceImageFiles || [];
  const tempRefs = activeRegenArgs.referenceImageIds || [];

  if (refs.length > 0 || tempRefs.length > 0) {
    dom.regenModal.refContainer.classList.remove("hidden");

    // 1. Render Historical References
    refs.forEach((ref, index) => {
      const item = document.createElement("div");
      item.className = "regen-ref-item";
      item.title = ref.filename;

      const img = document.createElement("img");
      const url = `/api/ref-image/${ref.projectId}/${ref.cardId}/${ref.filename}`;
      img.src = url;
      img.className = "regen-ref-img";
      img.loading = "lazy";

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.className = "regen-ref-checkbox";
      chk.checked = true;
      chk.dataset.type = "file";
      chk.dataset.index = index;

      item.appendChild(img);
      item.appendChild(chk);
      dom.regenModal.refList.appendChild(item);
    });

    // 2. Render Temporary References
    tempRefs.forEach((id, index) => {
      const item = document.createElement("div");
      item.className = "regen-ref-item";
      item.title = "Temporary Reference";

      const img = document.createElement("img");
      const url = `/api/temp-image/${id}`;
      img.src = url;
      img.className = "regen-ref-img";
      img.loading = "lazy";

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.className = "regen-ref-checkbox";
      chk.checked = true;
      chk.dataset.type = "id";
      chk.dataset.index = index; // Index within tempRefs array

      item.appendChild(img);
      item.appendChild(chk);
      dom.regenModal.refList.appendChild(item);
    });
  } else {
    dom.regenModal.refContainer.classList.add("hidden");
  }

  dom.regenModal.self.classList.remove("hidden");

  dom.regenModal.cancel.onclick = () => {
    dom.regenModal.self.classList.add("hidden");
  };

  dom.regenModal.confirm.onclick = async () => {
    await submitRegeneration();
  };
}

async function submitRegeneration() {
  if (!activeRegenArgs) return;

  dom.regenModal.confirm.textContent = "Starting...";
  dom.regenModal.confirm.disabled = true;

  try {
    const newPrompt = dom.regenModal.prompt.value;
    const count = parseInt(dom.regenModal.count.value) || 1;

    // Filter References
    const remainingRefs = [];
    const remainingRefIds = [];

    const checkboxes = dom.regenModal.refList.querySelectorAll(
      'input[type="checkbox"]',
    );
    checkboxes.forEach((cb) => {
      if (cb.checked) {
        const idx = parseInt(cb.dataset.index);
        const type = cb.dataset.type;

        if (type === "file") {
          if (activeRegenArgs.referenceImageFiles[idx]) {
            remainingRefs.push(activeRegenArgs.referenceImageFiles[idx]);
          }
        } else if (type === "id") {
          if (activeRegenArgs.referenceImageIds[idx]) {
            remainingRefIds.push(activeRegenArgs.referenceImageIds[idx]);
          }
        }
      }
    });

    const targetCardId = activeRegenArgs.cardId || state.currentCard?.id;
    const targetProjectId =
      activeRegenArgs.projectId || state.currentProject?.id;

    if (!targetCardId || !targetProjectId) {
      throw new Error("Cannot determine target Card/Project for regeneration.");
    }

    console.log("Regeneration Prompt:", newPrompt);

    const payload = {
      projectId: targetProjectId,
      cardId: targetCardId,
      promptOverride: newPrompt, // Backend expects promptOverride
      count: count,
      aspectRatio: activeRegenArgs.aspectRatio,
      resolution: activeRegenArgs.resolution,
      referenceImageFiles: remainingRefs,
      referenceImageIds: remainingRefIds,
    };

    dom.regenModal.self.classList.add("hidden");

    const jobs = await api.generateImages(payload);
    const res = await jobs.json();

    if (res.jobId) {
      createToast(`Regeneration started! (${count} images)`, "success");
    } else {
      createToast("Failed to start job: " + (res.error || "Unknown"), "error");
    }
  } catch (e) {
    createToast("Regeneration failed: " + e.message, "error");
  } finally {
    dom.regenModal.self.classList.add("hidden");
    dom.imgModal.self.classList.add("hidden");

    dom.regenModal.confirm.textContent = "Generate";
    dom.regenModal.confirm.innerHTML =
      'Generate <span class="material-icons" style="margin-left:5px">auto_awesome</span>';
    dom.regenModal.confirm.disabled = false;
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
        filename,
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
            const archIcon =
              dom.imgModal.archiveBtn.querySelector(".material-icons");
            if (archIcon) {
              archIcon.textContent = data.isArchived
                ? "restore_from_trash"
                : "delete_outline";
            }
            dom.imgModal.archiveBtn.title = data.isArchived
              ? "Restore Image"
              : "Archive Image";
            dom.imgModal.archiveBtn.setAttribute(
              "aria-label",
              data.isArchived ? "Restore Image" : "Archive Image",
            );

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
      executeToggle,
    );
  } else {
    await executeToggle();
  }
}

// Renamed for compatibility if needed, or export new name
export const archiveCurrentImage = () => toggleImageArchive(currentImgPath);

function updateModalStarBtn(isStarred) {
  if (dom.imgModal.starBtn) {
    dom.imgModal.starBtn.classList.toggle("active", isStarred);
    const icon = dom.imgModal.starBtn.querySelector(".material-icons");
    if (icon) {
      icon.textContent = isStarred ? "star" : "star_border";
    }
    dom.imgModal.starBtn.title = isStarred ? "Unstar" : "Star Image";
  }
}

export async function downloadCurrentGallery() {
  if (!state.currentCard || !state.currentProject) {
    createToast("No card selected", "error");
    return;
  }

  if (currentImageList.length === 0) {
    createToast("No images to download", "error");
    return;
  }

  try {
    // Extract filenames from the current image URLs
    const filenames = currentImageList.map((imgUrl) => imgUrl.split("/").pop());

    const viewType = isArchiveView
      ? "archived"
      : isFavoritesOnly
        ? "favorite"
        : "all";
    createToast(
      `Downloading ${filenames.length} ${viewType} image${
        filenames.length === 1 ? "" : "s"
      }...`,
      "info",
    );

    await api.downloadGalleryZip(
      state.currentCard.id,
      state.currentProject.id,
      filenames,
    );

    createToast("Download complete!", "success");
  } catch (e) {
    createToast(`Download failed: ${e.message}`, "error");
  }
}
