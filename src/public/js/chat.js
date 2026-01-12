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

            if (data.result.clientAction === "generateImage") {
              displayResult = "Starting Image Generation...";
              // Trigger Frontend Generation
              generateArt({
                projectId: data.result.projectId,
                cardId: data.result.cardId,
                promptOverride: data.result.promptOverride,
                count: data.result.count || 1,
              });
            } else if (data.result.path) {
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
                  // Render Tool Call
                  const call = part.functionCall;
                  const div = document.createElement("div");
                  div.className = "tool-call";
                  div.textContent = `Using tool: ${call.name}(${JSON.stringify(
                    call.args
                  )}) ...`;
                  this.messagesContainer.appendChild(div);
                } else if (part.functionResponse) {
                  // Render Tool Response
                  const response = part.functionResponse;
                  const result = response.response.result || response.response;

                  let displayResult = JSON.stringify(result);

                  if (result && typeof result === "object") {
                    if (result.clientAction === "generateImage") {
                      displayResult = "Starting Image Generation...";
                    } else if (result.path) {
                      displayResult = `Image Generated: ${result.path}`;
                    } else if (result.created) {
                      displayResult = `Created ${result.created.length} cards.`;
                    } else if (result.updated) {
                      displayResult = `Updated card.`;
                    }
                  }

                  const div = document.createElement("div");
                  div.className = "tool-result";
                  div.textContent = `Result: ${displayResult}`;
                  this.messagesContainer.appendChild(div);
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
}
