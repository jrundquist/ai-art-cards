import { state } from "./state.js";
import { showStatus, dom } from "./ui.js";
import { generateArt, selectCard } from "./controllers/cardController.js";
import { onProjectSelect } from "./controllers/projectController.js";
import { MessageRenderer } from "./chat/MessageRenderer.js";
import { ToolCallManager } from "./chat/ToolCallManager.js";
import { ConversationService } from "./chat/ConversationService.js";
import { StreamingService } from "./chat/StreamingService.js";
import { ChatUIController } from "./chat/ChatUIController.js";
import { ChatInputManager } from "./chat/ChatInputManager.js";

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

    // History Modal
    this.historyBtn = document.getElementById("chatHistoryBtn");
    this.historyModal = document.getElementById("chatHistoryModal");
    this.historyCloseBtn = document.getElementById("chatHistoryCloseX");

    // Thinking Mode Toggle
    this.thinkingToggleBtn = document.getElementById("thinkingToggleBtn");
    console.log("[ChatManager] Found Thinking Btn:", this.thinkingToggleBtn);

    // Default to true if not set, otherwise load from storage
    const storedThinking = localStorage.getItem("useThinking");
    this.useThinking =
      storedThinking === null ? true : storedThinking === "true";

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
      this.resizeHandle,
    );

    this.inputManager = new ChatInputManager(
      {
        fileInput: this.fileInput,
        uploadBtn: this.uploadBtn,
        previewsContainer: this.previewsContainer,
        inputArea: this.inputArea,
        input: this.input,
        sidebar: this.sidebar, // Add sidebar for drag/drop target
      },
      {},
    );

    // State
    this.isGenerating = false;
    this.pendingContext = [];
    // selectedImages and references managed by ChatInputManager
    this.trackedJobs = new Map(); // jobId -> { projectId, cardId }

    this.init();

    // Set initial UI state for Thinking Mode
    this.updateThinkingButtonUI();
  }

  init() {
    // Event Listeners
    // Use delegation for robustness
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("#thinkingToggleBtn");
      if (btn) {
        console.log("Thinking Btn Clicked (Delegated)!");
        e.preventDefault();
        e.stopPropagation();
        this.toggleThinkingMode();
      }
    });

    this.toggleBtn.addEventListener("click", () => this.toggleSidebar());
    this.closeBtn.addEventListener("click", () => this.toggleSidebar());
    this.newChatBtn.addEventListener("click", () => this.startNewChat());
    this.sendBtn.addEventListener("click", () => this.sendMessage());

    // History Modal Listeners
    if (this.historyBtn) {
      this.historyBtn.addEventListener("click", () => this.openHistoryModal());
    }
    if (this.historyCloseBtn) {
      this.historyCloseBtn.addEventListener("click", () =>
        this.closeHistoryModal(),
      );
    }
    // Close on click outside
    if (this.historyModal) {
      this.historyModal.addEventListener("click", (e) => {
        if (e.target === this.historyModal) {
          this.closeHistoryModal();
        }
      });
    }

    this.input.addEventListener("input", () => this.adjustInputHeight());

    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        // If generating, Enter could potentially stop? Or just do nothing?
        // Standard chat UX: Enter sends. If generating, maybe ignore or queue.
        // Let's keep it simple: only send if not generating.
        if (!this.isGenerating) {
          this.sendMessage();
        }
      }
    });

    // Image Upload, Drag & Drop, and Paste are now handled by ChatInputManager

    // Listen for suggestion clicks from MessageRenderer
    document.addEventListener("suggestion-clicked", (e) => {
      this.input.value = e.detail.text;
      this.adjustInputHeight();
      this.input.focus();
    });

    // Focus input when sidebar opens
    const originalToggle = this.uiController.toggleSidebar.bind(
      this.uiController,
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
      this.handleGenerationCompleted(e.detail),
    );

    // Listen for generation retry (Generate Again)
    document.addEventListener("retry-generation", (e) => {
      this.handleRetryGeneration(e.detail.args);
    });
  }

  toggleSidebar() {
    this.uiController.toggleSidebar();
  }

  toggleThinkingMode() {
    console.log(
      "[ChatManager] toggleThinkingMode called. Current:",
      this.useThinking,
    );
    this.useThinking = !this.useThinking;
    localStorage.setItem("useThinking", this.useThinking);
    this.updateThinkingButtonUI();
    console.log("[ChatManager] Thinking Mode:", this.useThinking);
  }

  openHistoryModal() {
    this.historyModal.classList.remove("hidden");
    // Refresh list when opening
    this.loadConversationList(
      state.currentProject ? state.currentProject.id : null,
    );
  }

  closeHistoryModal() {
    this.historyModal.classList.add("hidden");
  }

  updateThinkingButtonUI() {
    // Always re-fetch the button in case the DOM was updated/replaced
    const btn = document.getElementById("thinkingToggleBtn");

    if (btn) {
      if (this.useThinking) {
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
        btn.title = "Thinking Mode (On) - High reasoning";
      } else {
        btn.classList.remove("active");
        btn.setAttribute("aria-pressed", "false");
        btn.title = "Thinking Mode (Off) - Fast speed";
      }
    }
  }

  collapseThoughts() {
    if (this.currentThoughtContent) {
      const details = this.currentThoughtContent.closest("details");
      if (details) {
        details.open = false;
      }
      this.currentThoughtContent = null;
    }
  }

  updateSendButtonState() {
    const icon = this.sendBtn.querySelector(".material-icons");
    if (this.isGenerating) {
      icon.textContent = "stop_circle"; // or 'stop'
      this.sendBtn.title = "Stop Generation";
      this.sendBtn.classList.add("btn-stop"); // Optional styling hook
      this.sendBtn.disabled = false; // Make sure it's clickable
    } else {
      icon.textContent = "send";
      this.sendBtn.title = "Send Message";
      this.sendBtn.classList.remove("btn-stop");
      this.sendBtn.disabled = false;
    }
  }

  adjustInputHeight() {
    this.input.style.height = "auto";
    this.input.style.height = this.input.scrollHeight + "px";
  }

  // --- Image Handling ---

  // --- Image Handling delegated to ChatInputManager ---

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
    // Always refresh list
    this.loadConversationList(
      state.currentProject ? state.currentProject.id : null,
    );
  }

  async sendMessage() {
    if (this.isGenerating) {
      // Stop Button Logic
      this.streamingService.abort();
      // UI reset will happen in finally block or manual reset here if needed
      // but 'abort' throws AbortError which is caught in streamingService
      // We need to manually update UI here because streamingService swallows the AbortError (mostly)
      // or re-throws.
      this.messageRenderer.appendMessage("system", "Response stopped by user.");
      this.isGenerating = false;
      this.updateSendButtonState();
      return;
    }

    const text = this.input.value.trim();
    if (!text) return;

    this.input.value = "";
    this.adjustInputHeight();
    this.adjustInputHeight();
    this.isGenerating = true;
    this.updateSendButtonState();

    const selectedImages = this.inputManager.getSelectedImages();
    const selectedReferences = this.inputManager.getSelectedReferences();

    // Unified render for User Message
    this.messageRenderer.renderUnifiedMessage(
      "user",
      text,
      selectedImages.map((img) => ({
        mimeType: img.mimeType,
        data: img.data,
      })),
      selectedReferences,
    );

    // Capture images for sending
    const imagesToSend = selectedImages.map((img) => ({
      mimeType: img.mimeType,
      data: img.data,
    }));

    // Capture references
    const referencesToSend = [...selectedReferences];

    // Clear images & references
    this.inputManager.clearSelection();

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
    let accumulatedMarkdown = "";

    try {
      await this.streamingService.streamResponse(
        state.currentProject ? state.currentProject.id : null,
        this.conversationService.getCurrentConversationId(),
        text,
        state.currentCard?.id || null,
        imagesToSend,
        {
          onText: (content) => {
            // Auto-collapse thoughts if we start receiving text
            this.collapseThoughts();

            const tag = "[System]\nOK";
            accumulatedMarkdown += content;
            const trimmed = accumulatedMarkdown.trim();

            if (trimmed.startsWith(tag)) {
              currentAiDiv.parentNode.classList.add("hidden");
              hasHiddenTag = true;
            } else if (hasHiddenTag && !content.includes("[System]")) {
              // We hid a tag and now got new non-tag text
              // Create a fresh div for the follow-up
              currentAiDiv =
                this.messageRenderer.createStreamingMessageDiv("model");
              hasHiddenTag = false;
              accumulatedMarkdown = content;
            }

            this.messageRenderer.updateStreamingContent(
              currentAiDiv,
              accumulatedMarkdown,
            );
          },
          onThought: (content) => {
            this.currentThoughtContent = this.messageRenderer.appendThought(
              currentAiDiv,
              content,
            );
          },
          onToolCall: (calls) => {
            this.collapseThoughts();

            // 1. Finalize or Remove pending bubble
            const wrapper = currentAiDiv.parentNode;
            const hasThoughts = wrapper.querySelector(".thought-process");
            // Check if text is just specific loading indicators or empty
            const textContent = currentAiDiv.innerText.trim();
            const hasText =
              textContent !== "..." &&
              textContent !== "" &&
              !textContent.includes("...");

            if (!hasThoughts && !hasText) {
              // Empty pending bubble? Remove it to avoid gaps
              wrapper.remove();
            } else {
              // Finalize it: clear loading text if it's just dots
              if (currentAiDiv.innerHTML.includes('class="text-loading"')) {
                currentAiDiv.innerHTML = "";
              }
            }

            // 2. Append Tools (as root siblings)
            for (const call of calls) {
              // FIX: Inject references if model forgot them (Live Robustness)
              if (
                call.name === "generateImage" &&
                referencesToSend.length > 0
              ) {
                if (
                  !call.args.referenceImageFiles ||
                  call.args.referenceImageFiles.length === 0
                ) {
                  call.args = {
                    ...call.args,
                    referenceImageFiles: [...referencesToSend],
                  };
                }
              }

              const toolId = this.toolCallManager.generateToolCallId();
              const toolElement = this.toolCallManager.createToolCallElement(
                call.name,
                toolId,
                call.args,
              );
              this.messagesContainer.appendChild(toolElement);
            }
            this.messageRenderer.scrollToBottom();

            // 3. Create fresh bubble for subsequent streaming
            currentAiDiv =
              this.messageRenderer.createStreamingMessageDiv("model");
          },
          onToolResult: (toolName, result) => {
            const toolCallEntry =
              this.toolCallManager.findPendingToolCall(toolName);
            if (toolCallEntry) {
              this.toolCallManager.updateToolResult(
                toolCallEntry.element,
                toolName,
                toolCallEntry.args,
                result,
              );
              this.messageRenderer.scrollToBottom();
            }
          },
          onError: (error) => {
            this.messageRenderer.appendError(aiContentDiv, `Error: ${error}`);
          },
          onTitle: (title) => {
            // Refresh conversation list to show updated title
            // Pass current project ID if active, otherwise null
            this.loadConversationList(
              state.currentProject ? state.currentProject.id : null,
            );
          },
          onSpecialAction: async (action) => {
            if (action.clientAction === "generateImage") {
              const actionClone = JSON.parse(JSON.stringify(action));

              // Inject references if model forgot them (Execution Robustness)
              if (referencesToSend.length > 0) {
                if (
                  !actionClone.referenceImageFiles ||
                  actionClone.referenceImageFiles.length === 0
                ) {
                  actionClone.referenceImageFiles = [...referencesToSend];
                }
              }

              const jobId = await generateArt(actionClone);

              if (jobId && action.notifyOnCompletion) {
                this.trackedJobs.set(jobId, {
                  projectId: action.projectId,
                  cardId: action.cardId,
                });
              }
            } else if (action.clientAction === "navigateUI") {
              this.handleNavigateUI(action);
            } else if (action.clientAction === "refreshProject") {
              document.dispatchEvent(new CustomEvent("projects-updated"));
            } else if (action.path || action.created || action.updated) {
              this.triggerDataRefresh();
            }
          },
        },
        [], // parts
        referencesToSend,
        [], // generatedImageFiles
        this.useThinking,
      );
    } catch (e) {
      this.messageRenderer.appendError(aiContentDiv, e.message);
    } finally {
      // Check if we were aborted (isGenerating might have been set to false by stop click)
      // If we are still "generating" here, it means we finished naturally (or error).
      if (this.isGenerating) {
        this.isGenerating = false;
        this.updateSendButtonState();
      }
      this.sendBtn.disabled = false; // Ensure enabled in any case

      // If no markdown was accumulated and we have a placeholder, remove it
      if (
        !accumulatedMarkdown ||
        (accumulatedMarkdown.trim() === "" &&
          currentAiDiv &&
          currentAiDiv.parentNode)
      ) {
        // Double check it's still just the loading indicator or empty
        if (
          currentAiDiv.innerHTML.includes('class="text-loading"') ||
          currentAiDiv.textContent.trim() === ""
        ) {
          currentAiDiv.parentNode.remove();
        }
      }
    }
  }

  async loadConversationList(projectId) {
    const conversations =
      await this.conversationService.loadConversationList(projectId);
    this.conversationService.renderConversationList(
      conversations,
      (convId) => this.loadConversation(convId),
      (convId) => this.deleteConversation(convId),
    );
    return conversations;
  }

  async loadConversation(conversationId) {
    if (this.isGenerating) return;

    const data =
      await this.conversationService.loadConversation(conversationId);

    if (!data) return;

    sessionStorage.setItem("lastConversationId", conversationId);
    this.conversationService.setActiveConversation(conversationId);
    this.pendingContext = [];
    this.toolCallManager.clearActiveToolCalls();

    // Re-render list to update active state
    // Re-render list to update active state
    this.loadConversationList();
    this.closeHistoryModal(); // Close modal on selection

    this.messagesContainer.innerHTML = "";

    // Helper to extract references from text
    const extractReferences = (text) => {
      const refTagMarker =
        "Referenced Images (pass these to generateImage tool as 'referenceImageFiles'):";

      if (!text || !text.includes(refTagMarker)) return [];

      try {
        const markerIndex = text.indexOf(refTagMarker);
        const jsonStartIndex = markerIndex + refTagMarker.length;
        // Search for the closing bracket of the array
        const openBracketIndex = text.indexOf("[", jsonStartIndex);
        if (openBracketIndex === -1) return [];

        // Simple brace counting or just look for the last ]] as per heuristic?
        // Let's use the JSON.parse approach on the substring if we can guess the end.
        // The previous logic used lastIndexOf("]]").
        const endIndex = text.lastIndexOf("]]");

        if (endIndex > openBracketIndex) {
          const jsonStr = text.substring(openBracketIndex, endIndex + 1);
          const refs = JSON.parse(jsonStr);
          return Array.isArray(refs) ? refs : [];
        }
      } catch (e) {
        // ignore
      }
      return [];
    };

    // Render history
    data.history.forEach((msg) => {
      const role = msg.role;
      let currentReferences = []; // References found in this message turn

      // Skip rendering system-only turns, BUT start showing messages with Reference Metadata
      const shouldHide = msg.parts.some((part) => {
        const text = part.text || (typeof part === "string" ? part : "");
        // If it sends purely [System]\nOK (e.g. for image vision), hide it.
        if (text.trim().startsWith("[System]\nOK")) return true;

        // If it starts with [System: and is NOT a reference context appended to a user message, hide it.
        // We assume valid user messages might contain [System: Referenced Images...] at the end.
        if (
          text.trim().startsWith("[System:") &&
          !text.includes("Referenced Images") &&
          !text.includes("Generation Job") // Show generation feedback
        ) {
          return true;
        }
        return false;
      });
      if (shouldHide) return;

      // --- UNIFIED RENDERING LOGIC FOR USER ---
      if (role === "user") {
        const { accumulatedText, validInlineImages, references } =
          this._parseUserMessage(msg);

        // 4. Render
        this.messageRenderer.renderUnifiedMessage(
          role,
          accumulatedText,
          validInlineImages,
          references,
        );
        return; // Done for this message
      }

      // --- EXISTING STREAMING/SPLIT LOGIC FOR MODEL ---
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
                accumulatedText,
              );
              accumulatedText = "";
            }

            // Render non-text part (tool call/response/image)
            if (part.functionCall) {
              const call = part.functionCall;

              // FIX: Inject references from context if missing in args (History Restoration)
              if (
                call.name === "generateImage" &&
                currentReferences.length > 0
              ) {
                if (
                  !call.args.referenceImageFiles ||
                  call.args.referenceImageFiles.length === 0
                ) {
                  // Clone args to avoid mutating the original history object in memory if that matters (though reloading refreshes it)
                  call.args = {
                    ...call.args,
                    referenceImageFiles: [...currentReferences],
                  };
                }
              }

              const toolElement =
                this.toolCallManager.createCompletedToolElement(
                  call.name,
                  call.args || {},
                  {}, // Will be updated by functionResponse
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
                    el.getAttribute("data-pending-result") === "true",
                );

              if (pendingDiv) {
                pendingDiv.removeAttribute("data-pending-result");
                this.toolCallManager.updateToolResult(
                  pendingDiv,
                  toolName,
                  {}, // ToolCallManager will recover args from data-args
                  result,
                );
              } else {
                console.warn(
                  "[ChatManager] history loop: Pending tool div NOT found for response:",
                  toolName,
                );
              }
            } else if (part.inlineData) {
              // Render inline image for model (unlikely but possible)
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
    const deleted =
      await this.conversationService.deleteConversation(conversationId);
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

  async handleNavigateUI(action) {
    const { projectId, cardId, filename } = action;

    try {
      // 1. Switch project if needed
      if (state.currentProject?.id !== projectId) {
        dom.projectSelect.value = projectId;
        await onProjectSelect(true);
      }

      // 2. Select Card if provided
      if (cardId) {
        // state.allCards should be populated after onProjectSelect -> loadCards
        // state.allCards should be populated after onProjectSelect -> loadCards
        const card = state.allCards?.find((c) => c.id === cardId);
        if (card) {
          selectCard(card, true);

          // 3. Open Image if provided
          // 3. Open Image if provided
          if (filename) {
            console.log(
              `[ChatManager] Dispatching view request for ${filename}`,
            );
            setTimeout(() => {
              const event = new CustomEvent("request-view-image", {
                detail: { projectId, cardId, filename },
              });
              document.dispatchEvent(event);
            }, 200);
          }
        } else {
          console.warn(
            `[ChatManager] Card ${cardId} not found in project ${projectId}`,
          );
          showStatus("Card not found", "error");
        }
      }
    } catch (e) {
      console.error("[ChatManager] Error navigating UI:", e);
      showStatus("Error navigating UI", "error");
    }
  }

  /**
   * Helper to parse user messages for new explicitly indexed format
   * @param {Object} msg - The message object from history
   * @returns {Object} { accumulatedText, validInlineImages, references }
   */
  _parseUserMessage(msg) {
    let accumulatedText = "";
    let inlineImages = [];
    let explicitReferences = [];
    let explicitUploadsIndices = new Set();

    // 1. Collect all inlineData
    msg.parts.forEach((part) => {
      if (part.inlineData) {
        inlineImages.push(part.inlineData);
      }
    });

    // 2. Parse Text for System Manifest
    msg.parts.forEach((part) => {
      const t = part.text || (typeof part === "string" ? part : "");
      if (t) {
        accumulatedText += t;

        // Pattern: Referenced Image: {json} (inlineIndex: N)
        const refRegex = /Referenced Image: (\{.*?\}) \(inlineIndex: (\d+)\)/g;
        let match;
        while ((match = refRegex.exec(t)) !== null) {
          try {
            const refData = JSON.parse(match[1]);
            explicitReferences.push(refData);
          } catch (e) {
            console.error("Bad Ref JSON", e);
          }
        }

        // Pattern: Attached Image (inlineIndex: N) or Attached Generated Image: ... (inlineIndex: N)
        const attachRegex =
          /Attached (?:Generated )?Image.*\(inlineIndex: (\d+)\)/g;
        let attachMatch;
        while ((attachMatch = attachRegex.exec(t)) !== null) {
          const idx = parseInt(attachMatch[1], 10);
          explicitUploadsIndices.add(idx);
        }
      }
    });

    // 3. Resolve Uploads
    let validInlineImages = [];
    if (explicitUploadsIndices.size > 0) {
      Array.from(explicitUploadsIndices)
        .sort((a, b) => a - b)
        .forEach((idx) => {
          if (inlineImages[idx]) validInlineImages.push(inlineImages[idx]);
        });
    }

    return {
      accumulatedText,
      validInlineImages,
      references: explicitReferences,
    };
  }

  async handleRetryGeneration(args) {
    if (this.isGenerating) {
      showStatus("Already generating...", "warning");
      return;
    }

    try {
      console.log("[ChatManager] Handle Retry Generation. Args:", args);
      if (args && args.referenceImageFiles) {
        console.log(
          "[ChatManager] Reference Files in args:",
          args.referenceImageFiles,
        );
      } else {
        console.warn("[ChatManager] No referenceImageFiles in args!");
      }

      this.isGenerating = true;
      this.updateSendButtonState();

      // We use the exact args from the previous tool call
      // Ensure we have 'notifyOnCompletion' if needed by backend, though args usually has it
      if (args.notifyOnCompletion === undefined) {
        args.notifyOnCompletion = true;
      }

      // Feedback in chat
      this.messageRenderer.appendMessage(
        "system",
        `🔄 Retrying generation with same parameters...`,
      );

      const jobId = await generateArt(args);

      if (jobId) {
        this.trackedJobs.set(jobId, {
          projectId: args.projectId,
          cardId: args.cardId,
        });
      }
    } catch (e) {
      console.error("[ChatManager] Retry failed:", e);
      this.messageRenderer.appendMessage(
        "system",
        `Error retrying generation: ${e.message}`,
      );
      this.isGenerating = false;
      this.updateSendButtonState();
    }
    // Note: isGenerating stays true until 'generation-completed' or error,
    // but generateArt is async and returns quickly with jobId.
    // We should probably rely on the completion event to clear isGenerating
    // OR just treat this start as the "generating" phase.
    // Actually, since generateArt is fire-and-forget (job started), we can reset isGenerating
    // unless we want to block chat during generation.
    // The current flow blocks chat during 'streaming'; here we are job-based.
    // Let's reset isGenerating so user can chat while job runs.
    this.isGenerating = false;
    this.updateSendButtonState();
  }

  async handleGenerationCompleted(detail) {
    const { jobId, results } = detail;
    const tracked = this.trackedJobs.get(jobId);
    if (!tracked) return;

    this.trackedJobs.delete(jobId);
    console.log(
      `[ChatManager] Tracked job ${jobId} completed. Sending feedback.`,
    );

    try {
      // Prepare multi-modal feedback turn
      // Pass filenames to server to handle file reading and attachment.
      // The server ensures images are inserted before the text part.

      const parts = [
        {
          text: `[System: Generation Job ${jobId} completed successfully. ${
            results?.length || 0
          } images generated. Filenames: ${results
            ?.map((r) => r.split("/").pop())
            .join(", ")}]`,
        },
      ];

      // Send the feedback turn with generated files reference
      await this.sendSystemTurn(parts, results);
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

  async sendSystemTurn(parts, generatedImageFiles = []) {
    // FIX: Define referencesToSend for compatibility with streamResponse
    const referencesToSend = [];

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
            const tag = "[System]\nOK";
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
              accumulatedMarkdown,
            );
          },
          onToolCall: (calls) => {
            // ... same tool call logic as sendMessage ...
            for (const call of calls) {
              const toolId = this.toolCallManager.generateToolCallId();
              const toolElement = this.toolCallManager.createToolCallElement(
                call.name,
                toolId,
                call.args,
              );
              this.messagesContainer.insertBefore(
                toolElement,
                currentAiDiv.parentNode,
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
                result,
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
            } else if (action.clientAction === "navigateUI") {
              this.handleNavigateUI(action); // Reuse handler
            } else if (action.clientAction === "refreshProject") {
              document.dispatchEvent(new CustomEvent("projects-updated"));
            } else if (action.path || action.created || action.updated) {
              this.triggerDataRefresh();
            }
          },
        },
        parts, // PASS THE PARTS HERE
        referencesToSend, // PASS REFERENCES HERE
        generatedImageFiles, // PASS GENERATED FILES HERE
        false, // useThinking (System turns usually don't need thinking)
      );
    } catch (e) {
      this.messageRenderer.appendError(currentAiDiv, e.message);
    } finally {
      this.isGenerating = false;
      this.sendBtn.disabled = false;
    }
  }
}
