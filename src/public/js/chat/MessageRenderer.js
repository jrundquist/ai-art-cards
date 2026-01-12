/**
 * MessageRenderer - Handles all message creation, rendering, and display
 */
export class MessageRenderer {
  constructor(messagesContainer) {
    this.messagesContainer = messagesContainer;
  }

  /**
   * Create a basic message div structure
   * @param {string} role - 'user' or 'model'
   * @returns {HTMLElement}
   */
  createMessageDiv(role) {
    const div = document.createElement("div");
    div.className = `message ${role}`;
    div.innerHTML = `<div class="message-content"></div>`;
    return div;
  }

  /**
   * Append a message to the container
   * @param {string} role - 'user' or 'model'
   * @param {string} text - Message text content
   */
  appendMessage(role, text) {
    const msgDiv = this.createMessageDiv(role);
    msgDiv.querySelector(".message-content").textContent = text;
    this.messagesContainer.appendChild(msgDiv);
    this.scrollToBottom();
  }

  /**
   * Render markdown content to HTML
   * @param {string} markdown - Markdown text
   * @returns {string} HTML string
   */
  renderMarkdown(markdown) {
    if (window.marked) {
      return window.marked.parse(markdown);
    }
    return markdown; // Fallback to plain text
  }

  /**
   * Display the welcome message with suggestions
   */
  showWelcomeMessage() {
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
        const event = new CustomEvent("suggestion-clicked", {
          detail: { text: li.textContent.replace(/"/g, "") },
        });
        document.dispatchEvent(event);
      });
    });
  }

  /**
   * Clear all messages from the container
   */
  clearMessages() {
    this.messagesContainer.innerHTML = "";
    this.showWelcomeMessage();
  }

  /**
   * Scroll the message container to the bottom
   */
  scrollToBottom() {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  /**
   * Create a message div for streaming (starts with loading indicator)
   * @param {string} role - 'user' or 'model'
   * @returns {HTMLElement}
   */
  createStreamingMessageDiv(role) {
    const div = this.createMessageDiv(role);
    const contentDiv = div.querySelector(".message-content");
    contentDiv.innerHTML = '<span class="text-loading">...</span>';
    this.messagesContainer.appendChild(div);
    this.scrollToBottom();
    return contentDiv;
  }

  /**
   * Update streaming content with accumulated markdown
   * @param {HTMLElement} targetElement - Content div to update
   * @param {string} accumulatedMarkdown - Current markdown content
   */
  updateStreamingContent(targetElement, accumulatedMarkdown) {
    targetElement.innerHTML = this.renderMarkdown(accumulatedMarkdown);
    this.scrollToBottom();
  }

  /**
   * Append an error message to a target element
   * @param {HTMLElement} targetElement - Element to append error to
   * @param {string} errorMessage - Error message text
   */
  appendError(targetElement, errorMessage) {
    targetElement.innerHTML += `<div class="message-error">${errorMessage}</div>`;
    this.scrollToBottom();
  }
}
