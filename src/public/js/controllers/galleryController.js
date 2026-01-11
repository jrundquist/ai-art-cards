import { state } from "../state.js";
import { dom, createToast } from "../ui.js";
import * as api from "../api.js";

let currentImageList = [];

let isFavoritesOnly = false;

export function toggleFilterFavorites() {
  isFavoritesOnly = !isFavoritesOnly;
  const btn = dom.btns.favFilter;
  btn.classList.toggle("active", isFavoritesOnly);
  btn.setAttribute("aria-pressed", isFavoritesOnly);

  if (state.currentProject && state.currentCard) {
    loadImagesForCard(state.currentProject.id, state.currentCard.id);
  }
}

export async function loadImagesForCard(projectId, cardId) {
  dom.gallery.innerHTML = '<div class="gallery-loader">Loading...</div>';
  try {
    const images = await api.fetchCardImages(projectId, cardId);

    // We need to ensure state.currentCard is up to date with favorites
    // fetchCards in cardController updates state.allCards,
    // but let's trust state.currentCard for now or we might need to refresh it.
    // Ideally we'd refresh the card here, but let's assume valid state for speed.
    const favs = state.currentCard?.favoriteImages || [];

    dom.gallery.innerHTML = "";

    if (!Array.isArray(images)) {
      if (images && images.error) throw new Error(images.error);
      dom.gallery.innerHTML = '<div class="empty-state">No images yet</div>';
      return;
    }

    let displayImages = images;
    if (isFavoritesOnly) {
      displayImages = images.filter((img) => {
        const filename = img.split("/").pop();
        return favs.includes(filename);
      });
    }

    if (displayImages.length === 0) {
      dom.gallery.innerHTML = '<div class="empty-state">No images found</div>';
      currentImageList = []; // Clear nav list
      return;
    }

    // Store for navigation, ensuring consistent ordering
    currentImageList = [...displayImages];

    displayImages.forEach((imgUrl) => {
      const filename = imgUrl.split("/").pop();
      const isFav = favs.includes(filename);
      addImageToGallery(imgUrl, false, isFav);
    });
  } catch (e) {
    dom.gallery.innerHTML = `<div class="error-state">Error loading images: ${e.message}</div>`;
  }
}

export function addImageToGallery(imgUrl, prepend = false, isFav = false) {
  const div = document.createElement("div");
  div.className = "gallery-item";
  const img = document.createElement("img");
  img.src = "/" + imgUrl; // Ensure absolute path from root
  img.loading = "lazy";

  div.onclick = () => openImageDetails(imgUrl);

  const favIcon = document.createElement("div");
  favIcon.className = `gallery-fav-icon ${isFav ? "active" : ""}`;
  favIcon.innerHTML = "♥";
  favIcon.title = "Toggle Favorite";
  favIcon.onclick = (e) => {
    e.stopPropagation();
    toggleImageFavorite(imgUrl);
  };

  div.appendChild(img);
  div.appendChild(favIcon);

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

      // Update UI
      if (
        currentImgPath === targetUrl &&
        !dom.imgModal.self.classList.contains("hidden")
      ) {
        dom.imgModal.favBtn.classList.toggle("active", data.isFavorite);
      }

      // Refresh gallery to show status / filter
      // Ideally we just toggle the icon class if not filtering
      if (isFavoritesOnly && !data.isFavorite) {
        // Remove from view if filtered
        loadImagesForCard(state.currentProject.id, state.currentCard.id);
      } else {
        // Find grid item and update
        // This is tricky without IDs, but we re-render or find by src
        // Re-rendering is safest but slow. Let's try to find it.
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

  // Set Favorite Button State
  const filename = imgUrl.split("/").pop();
  const isFav = state.currentCard?.favoriteImages?.includes(filename);
  dom.imgModal.favBtn.classList.toggle("active", !!isFav);
  // Remove event listeners to avoid dupes? Better to assign onclick directly
  dom.imgModal.favBtn.onclick = () => toggleImageFavorite(imgUrl);

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

export async function archiveCurrentImage() {
  if (!currentImgPath || !state.currentCard || !state.currentProject) return;

  if (
    !confirm(
      "Are you sure you want to archive this image? It will be hidden from the gallery."
    )
  )
    return;

  try {
    const filename = currentImgPath.split("/").pop();

    await api.archiveImage(
      state.currentCard.id,
      state.currentProject.id,
      filename
    );

    dom.imgModal.self.classList.add("hidden");

    createToast("Image archived", "success");
    loadImagesForCard(state.currentProject.id, state.currentCard.id);
  } catch (e) {
    createToast("Failed to archive: " + e.message, "error");
  }
}
