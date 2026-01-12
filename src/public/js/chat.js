import { state } from "./state.js";
import { showStatus } from "./ui.js";
import { generateArt } from "./controllers/cardController.js";
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
    this.pendingContext = [];

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
  }

  toggleSidebar() {
    this.uiController.toggleSidebar();
  }

  adjustInputHeight() {
    this.input.style.height = "auto";
    this.input.style.height = this.input.scrollHeight + "px";
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

    // Append User Message
    this.messageRenderer.appendMessage("user", text);

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

    try {
      let accumulatedMarkdown = "";

      await this.streamingService.streamResponse(
        state.currentProject.id,
        this.conversationService.getCurrentConversationId(),
        text,
        state.currentCard?.id || null,
        {
          onText: (content) => {
            accumulatedMarkdown += content;
            this.messageRenderer.updateStreamingContent(
              aiContentDiv,
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
          onSpecialAction: (action) => {
            if (action.clientAction === "generateImage") {
              generateArt({
                projectId: action.projectId,
                cardId: action.cardId,
                promptOverride: action.promptOverride,
                count: action.count || 1,
              });
            } else if (action.path || action.created || action.updated) {
              this.triggerDataRefresh();
            }
          },
        }
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

            // Render non-text part (tool call/response)
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
}
