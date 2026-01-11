import { state } from "./state.js";
import { showStatus, confirmAction } from "./ui.js";

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

    this.currentConversationId = null;
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

    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Handle project change to reset/load chat context
    // This needs to be hooked into the app's project selection logic.
    // We can expose a method `onProjectSelected(projectId)`.

    // Restore state
    const savedState = localStorage.getItem("chatPanelOpen");
    if (savedState === "true") {
      this.toggleSidebar(false); // Pass false to avoid saving again immediately if we wanted, but logic is simple enough
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
    this.pendingContext.push(message);
    // Keep only last 3 context updates to avoid staleness/bloat?
    // Or just append all. Let's keep reasonable limit
    if (this.pendingContext.length > 3) {
      this.pendingContext.shift();
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
    this.isGenerating = true;
    this.sendBtn.disabled = true;

    // Append User Message
    this.appendMessage("user", text);

    // Prepare message payload including buffered context
    let fullMessage = text;
    if (this.pendingContext && this.pendingContext.length > 0) {
      const contextStr = this.pendingContext
        .map((c) => `[System Context: ${c}]`)
        .join("\n");
      fullMessage = `${contextStr}\n\n${text}`;
      this.pendingContext = []; // Clear buffer
    }

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
            // Show tool usage
            const calls = data.content;
            for (const call of calls) {
              const toolDiv = document.createElement("div");
              toolDiv.className = "tool-call";
              toolDiv.textContent = `Using tool: ${call.name}(${JSON.stringify(
                call.args
              )}) ...`;
              targetElement.parentNode.insertBefore(toolDiv, targetElement);
            }
          } else if (data.type === "tool_result") {
            const toolDiv = document.createElement("div");
            toolDiv.className = "tool-result";
            // If result has image path, show it?
            let displayResult = JSON.stringify(data.result);
            if (data.result.path) {
              displayResult = `Image Generated: ${data.result.path}`;
              // Maybe emit an event to refresh cards?
              // If we detect "created" or "updated" or "image generated", reload cards.
              this.triggerDataRefresh();
            } else if (data.result.created) {
              displayResult = `Created ${data.result.created.length} cards.`;
              this.triggerDataRefresh();
            } else if (data.result.updated) {
              displayResult = `Updated card.`;
              this.triggerDataRefresh();
            }

            toolDiv.textContent = `Result: ${displayResult}`;
            targetElement.parentNode.insertBefore(toolDiv, targetElement);
          } else if (data.type === "error") {
            targetElement.innerHTML += `<div class="message-error">${data.content}</div>`;
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
        // Optimize: just toggle class
        Array.from(this.historyList.children).forEach((child) =>
          child.classList.remove("active")
        );
        // We'd need ID on element to find it easily, but re-render is cheap enough or just rely on next list refresh
        // Let's refresh list just to be sure title is updated if changed (future proof)
        this.loadConversationList(state.currentProject.id);

        this.messagesContainer.innerHTML = "";

        // Render history
        data.history.forEach((msg) => {
          // Check for hidden system context messages
          let content = "";
          let role = msg.role;

          if (msg.parts && msg.parts.length > 0) {
            // If it's a string
            if (typeof msg.parts[0] === "string") {
              content = msg.parts[0];
            } else if (msg.parts[0].text) {
              content = msg.parts[0].text;
            }
          }

          // If user message starts with [System Context: ...], clean it for display
          // Actually, we modified the message sent to backend. So history has the full text.
          // We should hide the context part.
          if (role === "user") {
            // Regex to strip [System Context: ...] blocks at start
            // e.g. [System Context: ...]\n\nActual message
            // Careful not to strip user typed stuff if they type that, but unlikely.
            const contextRegex = /^(\[System Context: .*?\]\n)+/s;
            // Or simplified split by double newline if we enforced that structure
            const parts = content.split("\n\n");
            // If first part looks like context, remove it.
            // Since there can be multiple lines of context:
            content = content
              .replace(/\[System Context: .*?\]\n\n?/g, "")
              .trim();
          }

          if (content) {
            this.appendMessage(role, content);
          }

          // Note: History currently doesn't store tool calls/results in a way we can easily re-render perfectly
          // without more complex parsing if they aren't in standard parts.
          // Gemini API history is mainly parts: [{text: ...}].
          // Our chat UI renders tool calls dynamically.
          // Ideally we should persist tool calls/results in our JSON history to replay them.
          // For now, we only restore text. Tools won't show in history reload (Current Limitation).
        });
      }
    } catch (e) {
      console.error("Failed to load conversation", e);
      showStatus("Failed to load chat", "error");
    }
  }

  async deleteConversation(conversationId) {
    if (!confirm("Delete this conversation?")) return;

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
      }
    } catch (e) {
      showStatus("Failed to delete chat", "error");
    }
  }

  triggerDataRefresh() {
    // Reload cards in main view
    // We can dispatch a custom event
    const event = new CustomEvent("cards-updated");
    document.dispatchEvent(event);
  }
}
