import { state } from "../state.js";
import { dom, createToast } from "../ui.js";
import * as api from "../api.js";

let currentImageList = [];

export async function loadImagesForCard(projectId, cardId) {
  dom.gallery.innerHTML = '<div class="gallery-loader">Loading...</div>';
  try {
    const images = await api.fetchCardImages(projectId, cardId);

    dom.gallery.innerHTML = "";

    if (!Array.isArray(images)) {
      if (images && images.error) {
        throw new Error(images.error);
      }
      console.warn("Expected array of images, got:", images);
      dom.gallery.innerHTML = '<div class="empty-state">No images yet</div>';
      return;
    }

    if (images.length === 0) {
      dom.gallery.innerHTML = '<div class="empty-state">No images yet</div>';
      return;
    }

    // Store for navigation, ensuring consistent ordering
    currentImageList = [...images];

    images.forEach((imgUrl) => {
      addImageToGallery(imgUrl);
    });
  } catch (e) {
    dom.gallery.innerHTML = `<div class="error-state">Error loading images: ${e.message}</div>`;
  }
}

export function addImageToGallery(imgUrl, prepend = false) {
  const div = document.createElement("div");
  div.className = "gallery-item";
  const img = document.createElement("img");
  img.src = "/" + imgUrl; // Ensure absolute path from root
  img.loading = "lazy";

  div.onclick = () => openImageDetails(imgUrl);

  div.appendChild(img);
  if (prepend) {
    if (prepend) currentImageList.unshift(imgUrl);
    else currentImageList.push(imgUrl); // Should not happen with current usage but safe
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

export async function openImageDetails(imgUrl) {
  const isNavigating = !dom.imgModal.self.classList.contains("hidden");
  currentImgPath = imgUrl;

  dom.imgModal.self.classList.remove("hidden");
  dom.imgModal.preview.src = "/" + imgUrl;
  dom.imgModal.link.href = "/" + imgUrl;

  // Visuals: indicate loading
  dom.imgModal.name.classList.add("text-loading");
  dom.imgModal.date.classList.add("text-loading");
  dom.imgModal.prompt.classList.add("text-loading");

  if (!isNavigating) {
    // Fresh open: Clear fields to avoid showing widely incorrect data
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
