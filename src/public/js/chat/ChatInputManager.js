import { showStatus } from "../ui.js";

export class ChatInputManager {
  constructor(uiElements, callbacks) {
    // UI Elements
    this.fileInput = uiElements.fileInput;
    this.uploadBtn = uiElements.uploadBtn;
    this.previewsContainer = uiElements.previewsContainer;
    this.inputArea = uiElements.inputArea;
    this.input = uiElements.input; // for pasting/focus
    this.sidebar = uiElements.sidebar; // Drag target

    // Callbacks / External dependencies
    this.onUpdate = callbacks.onUpdate || (() => {});

    // State
    this.selectedImages = []; // Array of { file, mimeType, data, previewUrl }
    this.selectedImageReferences = []; // Array of { projectId, cardId, filename }

    this.init();
  }

  init() {
    if (this.uploadBtn && this.fileInput) {
      this.uploadBtn.addEventListener("click", () => this.fileInput.click());
      this.fileInput.addEventListener("change", (e) =>
        this.handleFileSelect(e.target.files),
      );
    }

    if (this.sidebar) {
      this.sidebar.addEventListener("dragover", (e) => {
        e.preventDefault();
        this.sidebar.classList.add("drag-over");
      });
      this.sidebar.addEventListener("dragleave", (e) => {
        e.preventDefault();
        // Only remove if leaving the sidebar entirely, not entering a child
        if (!this.sidebar.contains(e.relatedTarget)) {
          this.sidebar.classList.remove("drag-over");
        }
      });
      this.sidebar.addEventListener("drop", (e) => this.handleDrop(e));
    }

    if (this.input) {
      this.input.addEventListener("paste", (e) => {
        if (e.clipboardData && e.clipboardData.files.length > 0) {
          e.preventDefault();
          this.handleFileSelect(e.clipboardData.files);
        }
      });
    }
  }

  getSelectedImages() {
    return this.selectedImages;
  }

  getSelectedReferences() {
    return this.selectedImageReferences;
  }

  clearSelection() {
    this.selectedImages = [];
    this.selectedImageReferences = [];
    this.updateImagePreviews();
  }

  async handleDrop(e) {
    e.preventDefault();
    if (this.sidebar) this.sidebar.classList.remove("drag-over");

    // 0. Check for internal art card reference
    const refData = e.dataTransfer.getData("application/x-art-cards-reference");
    if (refData) {
      try {
        const ref = JSON.parse(refData);
        if (ref.projectId && ref.cardId && ref.filename) {
          // Check for duplicates
          const exists = this.selectedImageReferences.some(
            (r) =>
              r.projectId === ref.projectId &&
              r.cardId === ref.cardId &&
              r.filename === ref.filename,
          );
          if (!exists) {
            this.selectedImageReferences.push(ref);
            this.updateImagePreviews();
          }
        }
      } catch (e) {
        console.error("Failed to parse dropped reference", e);
      }
      return;
    }

    // 1. Files from desktop
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      this.handleFileSelect(e.dataTransfer.files);
      return;
    }

    // 2. Images from browser/gallery
    // Try getting HTML or URL
    const html = e.dataTransfer.getData("text/html");
    const uri =
      e.dataTransfer.getData("text/uri-list") ||
      e.dataTransfer.getData("text/plain");

    if (
      uri &&
      (uri.match(/\.(jpg|jpeg|png|webp|gif)$/i) || uri.startsWith("data:image"))
    ) {
      await this.processUrl(uri);
    } else if (html) {
      // Parse HTML to find img src
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const img = doc.querySelector("img");
      if (img && img.src) {
        await this.processUrl(img.src);
      }
    }
  }

  async processUrl(url) {
    try {
      if (url.startsWith("data:")) {
        // Data URI
        const res = await fetch(url);
        const blob = await res.blob();
        const file = new File([blob], "pasted_image.png", { type: blob.type });
        await this.processFile(file);
      } else {
        // Server URL (local)
        // Ensure it's our own server to avoid CORS issues if possible, although for local app it might be fine
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch image");
        const blob = await res.blob();
        // Extract filename
        const filename =
          url.split("/").pop().split("?")[0] || "dropped_image.png";
        const file = new File([blob], filename, { type: blob.type });
        await this.processFile(file);
      }
      this.updateImagePreviews();
    } catch (e) {
      console.error("Error processing dropped image:", e);
      showStatus("Failed to process dropped image", "error");
    }
  }

  async handleFileSelect(files) {
    const validFiles = Array.from(files).filter((file) =>
      file.type.startsWith("image/"),
    );

    if (validFiles.length === 0) return;

    for (const file of validFiles) {
      // Basic limit check
      if (this.selectedImages.length >= 4) {
        showStatus("Limit 4 images", "error");
        break;
      }
      await this.processFile(file);
    }
    this.updateImagePreviews();
    this.fileInput.value = ""; // Reset
  }

  async processFile(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64Params = e.target.result.split(",");
        this.selectedImages.push({
          file,
          mimeType: file.type,
          data: base64Params[1], // Raw base64
          previewUrl: e.target.result,
        });
        resolve();
      };
      reader.readAsDataURL(file);
    });
  }

  updateImagePreviews() {
    this.previewsContainer.innerHTML = "";
    if (
      this.selectedImages.length === 0 &&
      this.selectedImageReferences.length === 0
    ) {
      this.previewsContainer.classList.add("hidden");
      return;
    }
    this.previewsContainer.classList.remove("hidden");

    // Render References first or mixed? Order doesn't matter much.
    // Let's render references first
    this.selectedImageReferences.forEach((ref, index) => {
      const div = document.createElement("div");
      div.className = "chat-preview-item reference-item";
      // We can try to guess the URL: /data/projects/{pid}/assets/{cardSub}/filename
      // But we don't strictly know the subfolder here easily without looking up the card.
      // However, we can just show a generic icon or try to fetch it if we really want.
      // For now, let's show a placeholder icon.
      // Use the URL passed from gallery drag (or fallback to placeholder if missing)
      if (ref.url) {
        div.innerHTML = `
          <div class="reference-badge"><span class="material-icons">link</span></div>
          <img src="/${ref.url}" alt="${ref.filename}" class="reference-preview-img" />
          <button class="chat-preview-remove" data-type="ref" data-index="${index}"></button>
        `;
      } else {
        div.innerHTML = `
          <div class="reference-placeholder">
             <span class="material-icons">link</span>
             <span class="ref-name">${ref.filename}</span>
          </div>
          <button class="chat-preview-remove" data-type="ref" data-index="${index}"></button>
        `;
      }
      div.querySelector("button").addEventListener("click", (e) => {
        e.stopPropagation();
        this.removeReference(index);
      });
      this.previewsContainer.appendChild(div);
    });

    this.selectedImages.forEach((img, index) => {
      const div = document.createElement("div");
      div.className = "chat-preview-item";
      div.innerHTML = `
        <img src="${img.previewUrl}" alt="Preview" />
        <button class="chat-preview-remove" data-type="img" data-index="${index}"></button>
      `;
      div.querySelector("button").addEventListener("click", (e) => {
        e.stopPropagation(); // Prevent focusing input if we clicked remove
        this.removeImage(index);
      });
      this.previewsContainer.appendChild(div);
    });
  }

  removeImage(index) {
    this.selectedImages.splice(index, 1);
    this.updateImagePreviews();
  }

  removeReference(index) {
    this.selectedImageReferences.splice(index, 1);
    this.updateImagePreviews();
  }
}
