import { confirmAction, showStatus } from "../ui.js";

/**
 * ConversationService - Handles conversation CRUD operations and history
 */
export class ConversationService {
  constructor(historyListElement) {
    this.historyList = historyListElement;
    this.currentConversationId = null;
  }

  /**
   * Load conversation list for a project
   * @param {string} projectId
   * @returns {Promise<Array>}
   */
  async loadConversationList(projectId) {
    if (!projectId) return [];

    try {
      const res = await fetch(`/api/projects/${projectId}/conversations`);
      if (res.ok) {
        const conversations = await res.json();
        // Sort by lastModified desc
        conversations.sort(
          (a, b) => new Date(b.lastModified) - new Date(a.lastModified)
        );
        return conversations;
      }
    } catch (e) {
      console.error("Failed to load conversations", e);
    }
    return [];
  }

  /**
   * Render conversation list in the sidebar
   * @param {Array} conversations
   * @param {Function} onLoadCallback - Called when conversation is clicked
   * @param {Function} onDeleteCallback - Called when delete is clicked
   */
  renderConversationList(conversations, onLoadCallback, onDeleteCallback) {
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
        onLoadCallback(conv.id);
      });

      // Delete click
      const deleteBtn = div.querySelector(".chat-item-delete");
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        onDeleteCallback(conv.id);
      });

      this.historyList.appendChild(div);
    });
  }

  /**
   * Load a single conversation by ID
   * @param {string} projectId
   * @param {string} conversationId
   * @returns {Promise<object|null>}
   */
  async loadConversation(projectId, conversationId) {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${conversationId}`
      );
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.error("Failed to load conversation", e);
      showStatus("Failed to load chat", "error");
    }
    return null;
  }

  /**
   * Delete a conversation
   * @param {string} conversationId
   * @returns {Promise<boolean>} Success status
   */
  async deleteConversation(conversationId) {
    return new Promise((resolve) => {
      confirmAction(
        "Delete Conversation?",
        "Are you sure you want to delete this conversation? This cannot be undone.",
        async () => {
          try {
            const res = await fetch(`/api/conversations/${conversationId}`, {
              method: "DELETE",
            });
            if (res.ok) {
              resolve(true);
            } else {
              showStatus("Failed to delete chat", "error");
              resolve(false);
            }
          } catch (e) {
            showStatus("Failed to delete chat", "error");
            resolve(false);
          }
        },
        () => {
          resolve(false);
        }
      );
    });
  }

  /**
   * Set the currently active conversation
   * @param {string} conversationId
   */
  setActiveConversation(conversationId) {
    this.currentConversationId = conversationId;
    // Update UI to reflect active state
    Array.from(this.historyList.children).forEach((child) => {
      child.classList.remove("active");
      if (child.dataset.conversationId === conversationId) {
        child.classList.add("active");
      }
    });
  }

  /**
   * Get the current conversation ID
   * @returns {string|null}
   */
  getCurrentConversationId() {
    return this.currentConversationId;
  }

  /**
   * Clear the current conversation
   */
  clearCurrentConversation() {
    this.currentConversationId = null;
  }
}
