import { state } from "./state.js";
import { showStatus, confirmAction } from "./ui.js";
import { generateArt } from "./controllers/cardController.js";

export class ChatManager {
  constructor() {
    this.sidebar = document.getElementById("chatSidebar");
    this.toggleBtn = document.getElementById("chatToggleBtn");
    this.closeBtn = document.getElementById("closeChatBtn");
    this.newChatBtn = document.getElementById("newChatBtn");
    this.messagesContainer = document.getElementById("chatMessages");
    this.input = document.getElementById("chatInput");
    this.sendBtn = document.getElementById("sendChatBtn");
    this.sendBtn = document.getElementById("sendChatBtn");
    this.mainContent = document.querySelector(".main-content");
    this.historyList = document.getElementById("chatHistoryList");
    this.resizeHandle = document.getElementById("chatResizeHandle");

    this.currentConversationId = null;
    this.isGenerating = false;
    this.pendingContext = [];
    this.toolCallCounter = 0;
    this.activeToolCalls = new Map();

    // Resize state
    this.isResizing = false;
    this.startX = 0;
    this.startWidth = 0;

    this.init();
  }

  generateToolCallId() {
    return `tool-${Date.now()}-${this.toolCallCounter++}`;
  }

  getToolMetadata(toolName) {
    const metadata = {
      listProjects: {
        icon: "folder",
        label: "Listing Projects",
        color: "#3b82f6",
      },
      getProject: { icon: "info", label: "Getting Project", color: "#3b82f6" },
      listCards: {
        icon: "view_list",
        label: "Listing Cards",
        color: "#8b5cf6",
      },
      getCard: { icon: "style", label: "Getting Card", color: "#8b5cf6" },
      findCard: { icon: "search", label: "Finding Card", color: "#8b5cf6" },
      createCards: {
        icon: "add_circle",
        label: "Creating Cards",
        color: "#10b981",
      },
      updateCard: { icon: "edit", label: "Updating Card", color: "#f59e0b" },
      updateProject: {
        icon: "settings",
        label: "Updating Project",
        color: "#f59e0b",
      },
      generateImage: {
        icon: "auto_awesome",
        label: "Generating Image",
        color: "#ec4899",
      },
    };
    return (
      metadata[toolName] || { icon: "build", label: toolName, color: "#6b7280" }
    );
  }

  summarizeToolResult(toolName, args, result) {
    try {
      switch (toolName) {
        case "listProjects":
          return `Found ${result?.length || 0} project(s)`;
        case "getProject":
          return `Loaded project: ${result?.name || "Unknown"}`;
        case "listCards":
          return `Found ${result?.length || 0} card(s)`;
        case "getCard":
          return `Loaded card: ${result?.name || "Unknown"}`;
        case "findCard":
          if (result && result.id) {
            return `Found: ${result.name}`;
          }
          return "No match found";
        case "createCards":
          const created = result?.created || [];
          return `Created ${created.length} card(s)`;
        case "updateCard":
          return `Updated ${result?.name || "card"}`;
        case "updateProject":
          return "Updated project settings";
        case "generateImage":
          return "Started image generation";
        default:
          return "Completed";
      }
    } catch (e) {
      return "Completed";
    }
  }

  init() {
    // Event Listeners
    this.toggleBtn.addEventListener("click", () => this.toggleSidebar());
    this.closeBtn.addEventListener("click", () => this.toggleSidebar());
    this.newChatBtn.addEventListener("click", () => this.startNewChat());
    this.sendBtn.addEventListener("click", () => this.sendMessage());

    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Resize event listeners
    this.resizeHandle.addEventListener("mousedown", (e) => this.startResize(e));
    document.addEventListener("mousemove", (e) => this.doResize(e));
    document.addEventListener("mouseup", () => this.stopResize());

    // Handle project change to reset/load chat context
    // This needs to be hooked into the app's project selection logic.
    // We can expose a method `onProjectSelected(projectId)`.

    // Restore state
    const savedState = localStorage.getItem("chatPanelOpen");
    if (savedState === "true") {
      this.toggleSidebar(false); // Pass false to avoid saving again immediately if we wanted, but logic is simple enough
    }

    // Restore saved width
    const savedWidth = localStorage.getItem("chatPanelWidth");
    if (savedWidth) {
      this.sidebar.style.setProperty("--chat-width", `${savedWidth}px`);
    }
  }

  toggleSidebar(saveState = true) {
    this.sidebar.classList.toggle("hidden");
    this.toggleBtn.classList.toggle("hidden");
    this.mainContent.classList.toggle("chat-open");

    const isOpen = !this.sidebar.classList.contains("hidden");

    if (saveState) {
      localStorage.setItem("chatPanelOpen", isOpen);
    }

    // If opening and no conversation loaded, maybe load history or list?
    if (isOpen) {
      this.input.focus();
      if (!this.currentConversationId && state.currentProject) {
        // Load list or last conversation?
        // For now, start new or stay on welcome.
      }
    }
  }

  async onProjectSelected(projectId) {
    this.currentConversationId = null;
    this.clearMessages();
    this.loadConversationList(projectId);
  }

  clearMessages() {
    this.messagesContainer.innerHTML = "";
    const welcome = document.createElement("div");
    welcome.className = "chat-welcome";
    welcome.innerHTML = `
        <p>Hello! I can help you manage your cards and generate art. Try asking:</p>
        <ul>
            <li>"Create a card for a Cyberpunk City"</li>
            <li>"List my cards"</li>
            <li>"Generate images for the Dragon card"</li>
        </ul>
    `;
    this.messagesContainer.appendChild(welcome);

    // Add click handlers for suggestions
    welcome.querySelectorAll("li").forEach((li) => {
      li.addEventListener("click", () => {
        this.input.value = li.textContent.replace(/"/g, "");
        this.input.focus();
      });
    });
  }

  startNewChat() {
    this.currentConversationId = null;
    this.pendingContext = [];
    this.clearMessages();
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

    this.pendingContext = [];
  }

  setContext(message) {
    // Deprecated: Server now handles context injection via activeCardId
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
    this.isGenerating = true;
    this.sendBtn.disabled = true;

    // Append User Message
    this.appendMessage("user", text);

    // Prepare message payload
    let fullMessage = text;
    this.pendingContext = []; // Clear buffer if any

    // Prepare for streaming response
    const aiMessageDiv = this.createMessageDiv("model");
    const aiContentDiv = aiMessageDiv.querySelector(".message-content");
    aiContentDiv.innerHTML = '<span class="text-loading">...</span>';
    this.messagesContainer.appendChild(aiMessageDiv);
    this.scrollToBottom();

    try {
      await this.streamResponse(
        state.currentProject.id,
        this.currentConversationId,
        fullMessage, // Send modified message
        aiContentDiv
      );
    } catch (e) {
      aiContentDiv.innerHTML += `<div class="message-error">Error: ${e.message}</div>`;
    } finally {
      this.isGenerating = false;
      this.sendBtn.disabled = false;
    }
  }

  appendMessage(role, text) {
    const msgDiv = this.createMessageDiv(role);
    msgDiv.querySelector(".message-content").textContent = text; // Safe text
    this.messagesContainer.appendChild(msgDiv);
    this.scrollToBottom();
  }

  createMessageDiv(role) {
    const div = document.createElement("div");
    div.className = `message ${role}`;
    div.innerHTML = `<div class="message-content"></div>`;
    return div;
  }

  scrollToBottom() {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  async streamResponse(projectId, conversationId, message, targetElement) {
    // If conversationId is null, it's a new one. The backend handles creation if missing ID?
    // Backend expects conversationId. If we don't have one, generate one?
    // ChatService uses `loadConversation`. If missing, it uses provided ID to create new.
    // So we should generate a random ID if null.
    if (!conversationId) {
      this.currentConversationId =
        Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    const response = await fetch("/api/chat/message", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId,
        conversationId: this.currentConversationId,
        message,
        activeCardId: state.currentCard?.id || null,
      }),
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulatedMarkdown = "";
    // Remove loading indicator
    targetElement.innerHTML = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      // Parse SSE format
      // Data comes as "data: {json}\n\n"
      // Can be multiple lines per chunk
      const lines = chunk.split("\n\n");

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.substring(6);
        if (payload === "[DONE]") break;

        try {
          const data = JSON.parse(payload);

          if (data.type === "text") {
            accumulatedMarkdown += data.content;
            // Render markdown
            // Use marked.js if available
            if (window.marked) {
              targetElement.innerHTML =
                window.marked.parse(accumulatedMarkdown);
            } else {
              targetElement.innerText = accumulatedMarkdown;
            }
          } else if (data.type === "tool_call") {
            // Show tool usage with icons
            const calls = data.content;
            for (const call of calls) {
              const toolId = this.generateToolCallId();
              const metadata = this.getToolMetadata(call.name);

              const toolDiv = document.createElement("div");
              toolDiv.className = "tool-call";
              toolDiv.setAttribute("data-tool-call-id", toolId);
              toolDiv.setAttribute("data-tool-name", call.name);
              toolDiv.style.borderLeftColor = metadata.color;
              toolDiv.innerHTML = `
                <span class="material-icons" style="color: ${metadata.color}">${metadata.icon}</span>
                <span class="tool-label">${metadata.label}<span class="tool-dots">...</span></span>
              `;

              targetElement.parentNode.insertBefore(toolDiv, targetElement);
              this.activeToolCalls.set(toolId, {
                element: toolDiv,
                name: call.name,
                args: call.args,
              });
            }
          } else if (data.type === "tool_result") {
            // Find and replace the corresponding tool call
            const toolName = data.toolName;
            let toolCallEntry = null;

            // Find the most recent tool call with this name
            for (const [id, entry] of this.activeToolCalls.entries()) {
              if (entry.name === toolName) {
                toolCallEntry = { id, ...entry };
                this.activeToolCalls.delete(id);
                break;
              }
            }

            if (toolCallEntry) {
              const metadata = this.getToolMetadata(toolName);
              const summary = this.summarizeToolResult(
                toolName,
                toolCallEntry.args,
                data.result
              );

              // Update the element to show completion
              toolCallEntry.element.className = "tool-completed";
              toolCallEntry.element.innerHTML = `
                <span class="material-icons" style="color: ${metadata.color}">${metadata.icon}</span>
                <span class="tool-label">${summary}</span>
              `;
            }

            // Handle special result types
            if (data.result.clientAction === "generateImage") {
              // Trigger Frontend Generation
              generateArt({
                projectId: data.result.projectId,
                cardId: data.result.cardId,
                promptOverride: data.result.promptOverride,
                count: data.result.count || 1,
              });
            } else if (
              data.result.path ||
              data.result.created ||
              data.result.updated
            ) {
              this.triggerDataRefresh();
            }
          } else if (data.type === "error") {
            targetElement.innerHTML += `<div class="message-error">${data.content}</div>`;
          } else if (data.type === "title") {
            // Update title in UI and State
            const newTitle = data.content;
            this.currentConversationTitle = newTitle;
            // Update Header if we had one
            // Update Sidebar list if possible
            this.loadConversationList(state.currentProject.id);
          }
        } catch (e) {
          console.error("Failed to parse SSE line", line, e);
        }
      }
      this.scrollToBottom();
    }
  }

  async loadConversationList(projectId) {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/conversations`);
      if (res.ok) {
        const conversations = await res.json();
        // Sort by lastModified desc
        conversations.sort(
          (a, b) => new Date(b.lastModified) - new Date(a.lastModified)
        );
        this.renderConversationList(conversations);
      }
    } catch (e) {
      console.error("Failed to load conversations", e);
    }
  }

  renderConversationList(conversations) {
    this.historyList.innerHTML = "";
    if (conversations.length === 0) {
      this.historyList.style.display = "none";
      return;
    }
    this.historyList.style.display = "block";

    conversations.forEach((conv) => {
      const div = document.createElement("div");
      div.className = "chat-history-item";
      if (this.currentConversationId === conv.id) {
        div.classList.add("active");
      }

      // Format date
      const date = new Date(conv.lastModified).toLocaleDateString();
      const title = conv.title || `Chat ${date}`;

      div.innerHTML = `
        <span class="chat-item-title" title="${title}">${title}</span>
        <button class="chat-item-delete" title="Delete Chat"><span class="material-icons">delete_outline</span></button>
      `;

      // Load click
      div.addEventListener("click", (e) => {
        if (e.target.closest(".chat-item-delete")) return;
        this.loadConversation(conv.id);
      });

      // Delete click
      const deleteBtn = div.querySelector(".chat-item-delete");
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.deleteConversation(conv.id);
      });

      this.historyList.appendChild(div);
    });
  }

  async loadConversation(conversationId) {
    if (this.isGenerating) return;

    try {
      const res = await fetch(
        `/api/projects/${state.currentProject.id}/conversations/${conversationId}`
      );
      if (res.ok) {
        const data = await res.json();
        this.currentConversationId = conversationId;
        this.pendingContext = []; // Clear pending on load?

        // Re-render list to update active state
        Array.from(this.historyList.children).forEach((child) =>
          child.classList.remove("active")
        );
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
                  this.appendMessage(
                    role,
                    this.cleanContent(role, accumulatedText)
                  );
                  accumulatedText = "";
                }

                // Render non-text part (tool call/response)
                if (part.functionCall) {
                  // Render Tool Call - we'll look for the corresponding response
                  // and combine them if possible
                  const call = part.functionCall;
                  const metadata = this.getToolMetadata(call.name);

                  const div = document.createElement("div");
                  div.className = "tool-completed";
                  div.setAttribute("data-tool-name", call.name);
                  div.setAttribute("data-pending-result", "true");
                  div.style.borderLeftColor = metadata.color;
                  div.innerHTML = `
                    <span class="material-icons" style="color: ${metadata.color}">${metadata.icon}</span>
                    <span class="tool-label">${metadata.label}</span>
                  `;
                  this.messagesContainer.appendChild(div);
                } else if (part.functionResponse) {
                  // Update the pending tool call with the result
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
                    const metadata = this.getToolMetadata(toolName);
                    const summary = this.summarizeToolResult(
                      toolName,
                      {},
                      result
                    );

                    pendingDiv.removeAttribute("data-pending-result");
                    pendingDiv.innerHTML = `
                      <span class="material-icons" style="color: ${metadata.color}">${metadata.icon}</span>
                      <span class="tool-label">${summary}</span>
                    `;
                  }
                }
              }
            });

            // Render remaining text
            if (accumulatedText) {
              this.appendMessage(
                role,
                this.cleanContent(role, accumulatedText)
              );
            }
          }
        });

        // Scroll to bottom
        this.scrollToBottom();
      }
    } catch (e) {
      console.error("Failed to load conversation", e);
      showStatus("Failed to load chat", "error");
    }
  }

  cleanContent(role, content) {
    return content;
  }

  async deleteConversation(conversationId) {
    confirmAction(
      "Delete Conversation?",
      "Are you sure you want to delete this conversation? This cannot be undone.",
      async () => {
        try {
          const res = await fetch(`/api/conversations/${conversationId}`, {
            method: "DELETE",
          });
          if (res.ok) {
            if (this.currentConversationId === conversationId) {
              this.startNewChat();
            } else {
              this.loadConversationList(state.currentProject.id);
            }
          } else {
            showStatus("Failed to delete chat", "error");
          }
        } catch (e) {
          showStatus("Failed to delete chat", "error");
        }
      }
    );
  }

  triggerDataRefresh() {
    // Reload cards in main view
    // We can dispatch a custom event
    const event = new CustomEvent("cards-updated");
    document.dispatchEvent(event);
  }

  startResize(e) {
    this.isResizing = true;
    this.startX = e.clientX;
    this.startWidth = this.sidebar.offsetWidth;
    this.resizeHandle.classList.add("resizing");
    this.sidebar.classList.add("resizing");
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  }

  doResize(e) {
    if (!this.isResizing) return;

    // Calculate new width (dragging left increases width)
    const delta = this.startX - e.clientX;
    const newWidth = this.startWidth + delta;

    // Apply constraints
    const minWidth = 280;
    const maxWidth = 600;
    const constrainedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

    // Apply the new width
    this.sidebar.style.setProperty("--chat-width", `${constrainedWidth}px`);
  }

  stopResize() {
    if (!this.isResizing) return;

    this.isResizing = false;
    this.resizeHandle.classList.remove("resizing");
    this.sidebar.classList.remove("resizing");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";

    // Save the width to localStorage
    const currentWidth = this.sidebar.offsetWidth;
    localStorage.setItem("chatPanelWidth", currentWidth);
  }
}
