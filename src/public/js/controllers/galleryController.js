import { state } from "../state.js";
import { dom, createToast } from "../ui.js";
import * as api from "../api.js";

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
    dom.gallery.prepend(div);
  } else {
    dom.gallery.appendChild(div);
  }
}

let currentImgPath = null;

export async function openImageDetails(imgUrl) {
  currentImgPath = imgUrl;

  dom.imgModal.self.classList.remove("hidden");
  dom.imgModal.preview.src = "/" + imgUrl;
  dom.imgModal.name.textContent = "Loading...";
  dom.imgModal.date.textContent = "";
  dom.imgModal.prompt.textContent = "";
  dom.imgModal.link.href = "/" + imgUrl;

  try {
    const meta = await api.fetchImageMetadata(imgUrl);

    dom.imgModal.name.textContent = meta.filename;
    dom.imgModal.date.textContent = new Date(meta.created).toLocaleString();
    dom.imgModal.prompt.textContent = meta.prompt;
  } catch (e) {
    dom.imgModal.prompt.textContent = "Error loading metadata: " + e.message;
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
