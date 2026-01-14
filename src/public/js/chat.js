import { state } from "./state.js";
import { showStatus, dom } from "./ui.js";
import { generateArt, selectCard } from "./controllers/cardController.js";
import { onProjectSelect } from "./controllers/projectController.js";
import { MessageRenderer } from "./chat/MessageRenderer.js";
import { ToolCallManager } from "./chat/ToolCallManager.js";
import { ConversationService } from "./chat/ConversationService.js";
import { StreamingService } from "./chat/StreamingService.js";
import { ChatUIController } from "./chat/ChatUIController.js";

export class ChatManager {
  constructor() {
    // DOM Elements
    this.sidebar = document.getElementById("chatSidebar");
    this.toggleBtn = document.getElementById("chatToggleBtn");
    this.closeBtn = document.getElementById("closeChatBtn");
    this.newChatBtn = document.getElementById("newChatBtn");
    this.messagesContainer = document.getElementById("chatMessages");
    this.input = document.getElementById("chatInput");
    this.sendBtn = document.getElementById("sendChatBtn");
    this.mainContent = document.querySelector(".main-content");
    this.historyList = document.getElementById("chatHistoryList");
    this.resizeHandle = document.getElementById("chatResizeHandle");

    // Image Upload Elements
    this.fileInput = document.getElementById("chatFileInput");
    this.uploadBtn = document.getElementById("chatUploadBtn");
    this.previewsContainer = document.getElementById("chatImagePreviews");
    this.inputArea = document.getElementById("chatInputArea");

    // Initialize sub-modules
    this.messageRenderer = new MessageRenderer(this.messagesContainer);
    this.toolCallManager = new ToolCallManager();
    this.conversationService = new ConversationService(this.historyList);
    this.streamingService = new StreamingService();
    this.uiController = new ChatUIController(
      this.sidebar,
      this.toggleBtn,
      this.mainContent,
      this.resizeHandle
    );

    // State
    this.isGenerating = false;
    this.isGenerating = false;
    this.pendingContext = [];
    this.selectedImages = []; // Array of { file, base64, mimeType, previewUrl }
    this.selectedImageReferences = []; // Array of { projectId, cardId, filename }
    this.trackedJobs = new Map(); // jobId -> { projectId, cardId }

    this.init();
  }

  init() {
    // Event Listeners
    this.toggleBtn.addEventListener("click", () => this.toggleSidebar());
    this.closeBtn.addEventListener("click", () => this.toggleSidebar());
    this.newChatBtn.addEventListener("click", () => this.startNewChat());
    this.sendBtn.addEventListener("click", () => this.sendMessage());

    this.input.addEventListener("input", () => this.adjustInputHeight());

    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Image Upload Events
    this.uploadBtn.addEventListener("click", () => this.fileInput.click());
    this.fileInput.addEventListener("change", (e) =>
      this.handleFileSelect(e.target.files)
    );

    // Drag and Drop
    this.inputArea.addEventListener("dragover", (e) => {
      e.preventDefault();
      this.inputArea.classList.add("drag-over");
    });
    this.inputArea.addEventListener("dragleave", (e) => {
      e.preventDefault();
      this.inputArea.classList.remove("drag-over");
    });
    this.inputArea.addEventListener("drop", (e) => this.handleDrop(e));

    // Paste
    this.input.addEventListener("paste", (e) => {
      if (e.clipboardData && e.clipboardData.files.length > 0) {
        e.preventDefault();
        this.handleFileSelect(e.clipboardData.files);
      }
    });

    // Listen for suggestion clicks from MessageRenderer
    document.addEventListener("suggestion-clicked", (e) => {
      this.input.value = e.detail.text;
      this.adjustInputHeight();
      this.input.focus();
    });

    // Focus input when sidebar opens
    const originalToggle = this.uiController.toggleSidebar.bind(
      this.uiController
    );
    this.uiController.toggleSidebar = (saveState = true) => {
      const isOpen = originalToggle(saveState);
      if (isOpen) {
        this.input.focus();
      }
      return isOpen;
    };

    // Listen for generation completions
    document.addEventListener("generation-completed", (e) =>
      this.handleGenerationCompleted(e.detail)
    );
  }

  toggleSidebar() {
    this.uiController.toggleSidebar();
  }

  adjustInputHeight() {
    this.input.style.height = "auto";
    this.input.style.height = this.input.scrollHeight + "px";
  }

  // --- Image Handling ---

  async handleDrop(e) {
    e.preventDefault();
    this.inputArea.classList.remove("drag-over");

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
              r.filename === ref.filename
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
      file.type.startsWith("image/")
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

  async onProjectSelected(projectId) {
    this.conversationService.clearCurrentConversation();
    this.messageRenderer.clearMessages();
    const conversations = await this.loadConversationList(projectId);

    // Restore last conversation if it exists in the current project
    const lastConvId = sessionStorage.getItem("lastConversationId");
    if (
      lastConvId &&
      conversations &&
      conversations.some((c) => c.id === lastConvId)
    ) {
      await this.loadConversation(lastConvId);
    }
  }

  startNewChat() {
    sessionStorage.removeItem("lastConversationId");
    this.conversationService.clearCurrentConversation();
    this.pendingContext = [];
    this.messageRenderer.clearMessages();
    this.toolCallManager.clearActiveToolCalls();

    // Refresh list to remove active state
    if (state.currentProject) {
      this.loadConversationList(state.currentProject.id);
    }
  }

  async sendMessage() {
    if (this.isGenerating) return;

    const text = this.input.value.trim();
    if (!text) return;

    if (!state.currentProject) {
      showStatus("Please select a project first", "error");
      return;
    }

    this.input.value = "";
    this.adjustInputHeight();
    this.isGenerating = true;
    this.sendBtn.disabled = true;

    // Append User Message with images if any
    if (this.selectedImages.length > 0) {
      this.messageRenderer.appendImages(
        "user",
        this.selectedImages.map((img) => ({
          mimeType: img.mimeType,
          data: img.data,
        }))
      );
    }
    this.messageRenderer.appendMessage("user", text);

    // Capture images for sending
    // Capture images for sending
    const imagesToSend = this.selectedImages.map((img) => ({
      mimeType: img.mimeType,
      data: img.data,
    }));

    // Capture references
    const referencesToSend = [...this.selectedImageReferences];

    if (this.selectedImageReferences.length > 0) {
      this.messageRenderer.appendReferences(
        "user",
        this.selectedImageReferences
      );
    }

    // Clear images & references
    this.selectedImages = [];
    this.selectedImageReferences = [];
    this.updateImagePreviews();

    // Generate conversation ID if needed
    if (!this.conversationService.getCurrentConversationId()) {
      const newId =
        Date.now().toString(36) + Math.random().toString(36).substr(2);
      sessionStorage.setItem("lastConversationId", newId);
      this.conversationService.setActiveConversation(newId);
    }

    // Prepare for streaming response
    const aiContentDiv =
      this.messageRenderer.createStreamingMessageDiv("model");
    let currentAiDiv = aiContentDiv;
    let hasHiddenTag = false;

    try {
      let accumulatedMarkdown = "";

      await this.streamingService.streamResponse(
        state.currentProject.id,
        this.conversationService.getCurrentConversationId(),
        text,
        state.currentCard?.id || null,
        imagesToSend,
        {
          onText: (content) => {
            const tag = "[System: OK]";
            accumulatedMarkdown += content;
            const trimmed = accumulatedMarkdown.trim();

            if (trimmed === tag) {
              currentAiDiv.parentNode.classList.add("hidden");
              hasHiddenTag = true;
            } else if (hasHiddenTag && !content.includes("[System:")) {
              // We hid a tag and now got new non-tag text
              // Create a fresh div for the follow-up
              currentAiDiv =
                this.messageRenderer.createStreamingMessageDiv("model");
              hasHiddenTag = false;
              accumulatedMarkdown = content;
            }

            this.messageRenderer.updateStreamingContent(
              currentAiDiv,
              accumulatedMarkdown
            );
          },
          onToolCall: (calls) => {
            for (const call of calls) {
              const toolId = this.toolCallManager.generateToolCallId();
              const toolElement = this.toolCallManager.createToolCallElement(
                call.name,
                toolId,
                call.args
              );
              // Insert before the text response
              this.messagesContainer.insertBefore(
                toolElement,
                aiContentDiv.parentNode
              );
              this.messageRenderer.scrollToBottom();
            }
          },
          onToolResult: (toolName, result) => {
            const toolCallEntry =
              this.toolCallManager.findPendingToolCall(toolName);
            if (toolCallEntry) {
              this.toolCallManager.updateToolResult(
                toolCallEntry.element,
                toolName,
                toolCallEntry.args,
                result
              );
              this.messageRenderer.scrollToBottom();
            }
          },
          onError: (error) => {
            this.messageRenderer.appendError(aiContentDiv, `Error: ${error}`);
          },
          onTitle: (title) => {
            // Refresh conversation list to show updated title
            this.loadConversationList(state.currentProject.id);
          },
          onSpecialAction: async (action) => {
            if (action.clientAction === "generateImage") {
              const actionClone = JSON.parse(JSON.stringify(action));
              const jobId = await generateArt(actionClone);

              if (jobId && action.notifyOnCompletion) {
                this.trackedJobs.set(jobId, {
                  projectId: action.projectId,
                  cardId: action.cardId,
                });
              }
            } else if (action.clientAction === "showUserCard") {
              this.handleShowUserCard(action);
            } else if (action.path || action.created || action.updated) {
              this.triggerDataRefresh();
            }
          },
        },
        [], // parts
        referencesToSend
      );
    } catch (e) {
      this.messageRenderer.appendError(aiContentDiv, e.message);
    } finally {
      this.isGenerating = false;
      this.sendBtn.disabled = false;
    }
  }

  async loadConversationList(projectId) {
    const conversations = await this.conversationService.loadConversationList(
      projectId
    );
    this.conversationService.renderConversationList(
      conversations,
      (convId) => this.loadConversation(convId),
      (convId) => this.deleteConversation(convId)
    );
    return conversations;
  }

  async loadConversation(conversationId) {
    if (this.isGenerating) return;

    const data = await this.conversationService.loadConversation(
      state.currentProject.id,
      conversationId
    );

    if (!data) return;

    sessionStorage.setItem("lastConversationId", conversationId);
    this.conversationService.setActiveConversation(conversationId);
    this.pendingContext = [];
    this.toolCallManager.clearActiveToolCalls();

    // Re-render list to update active state
    this.loadConversationList(state.currentProject.id);

    this.messagesContainer.innerHTML = "";

    // Render history
    data.history.forEach((msg) => {
      const role = msg.role;

      // Skip rendering system-only turns, BUT start showing messages with Reference Metadata
      const shouldHide = msg.parts.some((part) => {
        const text = part.text || (typeof part === "string" ? part : "");
        // If it sends purely [System: OK] (e.g. for image vision), hide it.
        if (text.trim() === "[System: OK]") return true;

        // If it starts with [System: and is NOT a reference context appended to a user message, hide it.
        // We assume valid user messages might contain [System: Referenced Images...] at the end.
        if (
          text.trim().startsWith("[System:") &&
          !text.includes("Referenced Images")
        ) {
          return true;
        }
        return false;
      });
      if (shouldHide) return;

      if (msg.parts && msg.parts.length > 0) {
        let accumulatedText = "";

        msg.parts.forEach((part) => {
          // Extract text content if present
          let textContent = null;
          if (typeof part === "string") textContent = part;
          else if (part.text) textContent = part.text;

          if (textContent !== null) {
            accumulatedText += textContent;
          } else {
            // If we have accumulated text, render it first
            if (accumulatedText) {
              this.messageRenderer.appendMessageWithMarkdown(
                role,
                accumulatedText
              );
              accumulatedText = "";
            }

            // Render non-text part (tool call/response/image)
            if (part.functionCall) {
              const call = part.functionCall;
              const toolElement =
                this.toolCallManager.createCompletedToolElement(
                  call.name,
                  call.args || {},
                  {} // Will be updated by functionResponse
                );
              toolElement.setAttribute("data-pending-result", "true");
              this.messagesContainer.appendChild(toolElement);
            } else if (part.functionResponse) {
              const response = part.functionResponse;
              const toolName = response.name;
              const result = response.response.result || response.response;

              // Find the pending tool call div
              const pendingDiv = Array.from(this.messagesContainer.children)
                .reverse()
                .find(
                  (el) =>
                    el.getAttribute("data-tool-name") === toolName &&
                    el.getAttribute("data-pending-result") === "true"
                );

              if (pendingDiv) {
                pendingDiv.removeAttribute("data-pending-result");
                this.toolCallManager.updateToolResult(
                  pendingDiv,
                  toolName,
                  {},
                  result
                );
              }
            } else if (part.inlineData) {
              // Render accumulated text first
              if (accumulatedText) {
                this.messageRenderer.appendMessageWithMarkdown(
                  role,
                  accumulatedText
                );
                accumulatedText = "";
              }
              // Render image
              this.messageRenderer.appendImages(role, [part.inlineData]);
            }
          }
        });

        // Render remaining text
        if (accumulatedText) {
          this.messageRenderer.appendMessageWithMarkdown(role, accumulatedText);
        }
      }
    });

    this.messageRenderer.scrollToBottom();
  }

  async deleteConversation(conversationId) {
    const deleted = await this.conversationService.deleteConversation(
      conversationId
    );
    if (deleted) {
      if (
        this.conversationService.getCurrentConversationId() === conversationId
      ) {
        this.startNewChat();
      } else {
        this.loadConversationList(state.currentProject.id);
      }
    }
  }

  triggerDataRefresh() {
    // Reload cards in main view
    const event = new CustomEvent("cards-updated");
    document.dispatchEvent(event);
  }

  async handleShowUserCard(action) {
    const { projectId, cardId } = action;

    try {
      // 1. Switch project if needed
      if (state.currentProject?.id !== projectId) {
        dom.projectSelect.value = projectId;
        await onProjectSelect(true);
      }

      // 2. Find the card
      // state.allCards should be populated after onProjectSelect -> loadCards
      const card = state.allCards.find((c) => c.id === cardId);
      if (card) {
        selectCard(card, true);
      } else {
        console.warn(
          `[ChatManager] Card ${cardId} not found in project ${projectId}`
        );
        showStatus("Card not found", "error");
      }
    } catch (e) {
      console.error("[ChatManager] Error showing card:", e);
      showStatus("Error switching card", "error");
    }
  }

  async handleGenerationCompleted(detail) {
    const { jobId, results } = detail;
    const tracked = this.trackedJobs.get(jobId);
    if (!tracked) return;

    this.trackedJobs.delete(jobId);
    console.log(
      `[ChatManager] Tracked job ${jobId} completed. Sending feedback.`
    );

    try {
      // Prepare multi-modal feedback turn
      const parts = [
        {
          text: `[System: Generation Job ${jobId} completed successfully. ${
            results?.length || 0
          } images generated. Filenames: ${results
            ?.map((r) => r.split("/").pop())
            .join(", ")}]`,
        },
      ];

      // Fetch and attach images as inlineData
      if (results && results.length > 0) {
        for (const relPath of results) {
          try {
            const base64Data = await this.urlToBase64(relPath);
            const ext = relPath.split(".").pop().toLowerCase();
            const mimeType =
              ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";

            parts.push({
              inlineData: {
                mimeType,
                data: base64Data,
              },
            });
          } catch (err) {
            console.warn(
              `[ChatManager] Failed to fetch image for LLM feedback: ${relPath}`,
              err
            );
          }
        }
      }

      // Send the feedback turn
      await this.sendSystemTurn(parts);
    } catch (e) {
      console.error("[ChatManager] Error sending generation feedback:", e);
    }
  }

  async urlToBase64(url) {
    // Ensure URL starts with / if it's relative
    const fetchUrl = url.startsWith("/") ? url : `/${url}`;
    const response = await fetch(fetchUrl);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result.split(",")[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async sendSystemTurn(parts) {
    if (this.isGenerating) {
      // If already generating, we might want to queue or wait?
      // For now, let's just proceed as it's a priority "turn"
    }

    this.isGenerating = true;
    this.sendBtn.disabled = true;

    // Use current conversation ID
    const conversationId = this.conversationService.getCurrentConversationId();
    if (!conversationId) return;

    // We don't append a "User" message to the UI for system turns,
    // but the backend will record it in history as a turn.
    // However, the current backend implementation expects sendMessageStream(projectId, conversationId, message, ...)
    // where 'message' is a string or Part[].

    const aiContentDiv =
      this.messageRenderer.createStreamingMessageDiv("model");
    let currentAiDiv = aiContentDiv;
    let hasHiddenTag = false;

    try {
      let accumulatedMarkdown = "";

      await this.streamingService.streamResponse(
        state.currentProject.id,
        conversationId,
        "", // Message as string is empty, we'll use 'images' parameter or modify streamingService
        state.currentCard?.id || null,
        [], // We'll pass the parts in the message body
        {
          onText: (content) => {
            const tag = "[System: OK]";
            accumulatedMarkdown += content;
            const trimmed = accumulatedMarkdown.trim();

            if (trimmed === tag) {
              currentAiDiv.parentNode.classList.add("hidden");
              hasHiddenTag = true;
            } else if (hasHiddenTag && !content.includes("[System:")) {
              // We hid a tag and now got new non-tag text
              // Create a fresh div for the follow-up
              currentAiDiv =
                this.messageRenderer.createStreamingMessageDiv("model");
              hasHiddenTag = false;
              accumulatedMarkdown = content;
            }

            this.messageRenderer.updateStreamingContent(
              currentAiDiv,
              accumulatedMarkdown
            );
          },
          onToolCall: (calls) => {
            // ... same tool call logic as sendMessage ...
            for (const call of calls) {
              const toolId = this.toolCallManager.generateToolCallId();
              const toolElement = this.toolCallManager.createToolCallElement(
                call.name,
                toolId,
                call.args
              );
              this.messagesContainer.insertBefore(
                toolElement,
                currentAiDiv.parentNode
              );
              this.messageRenderer.scrollToBottom();
            }
          },
          onToolResult: (toolName, result) => {
            const toolCallEntry =
              this.toolCallManager.findPendingToolCall(toolName);
            if (toolCallEntry) {
              this.toolCallManager.updateToolResult(
                toolCallEntry.element,
                toolName,
                toolCallEntry.args,
                result
              );
              this.messageRenderer.scrollToBottom();
            }
          },
          onError: (error) => {
            this.messageRenderer.appendError(currentAiDiv, `Error: ${error}`);
          },
          onTitle: () => this.loadConversationList(state.currentProject.id),
          onSpecialAction: (action) => {
            // Reuse special action logic (simplified here)
            if (action.clientAction === "generateImage") {
              // Deep clone to prevent reference issues or accidental mutation
              const actionClone = JSON.parse(JSON.stringify(action));
              generateArt(actionClone);
            } else if (action.path || action.created || action.updated) {
              this.triggerDataRefresh();
            }
          },
        },
        parts, // PASS THE PARTS HERE
        referencesToSend // PASS REFERENCES HERE
      );
    } catch (e) {
      this.messageRenderer.appendError(currentAiDiv, e.message);
    } finally {
      this.isGenerating = false;
      this.sendBtn.disabled = false;
    }
  }
}
