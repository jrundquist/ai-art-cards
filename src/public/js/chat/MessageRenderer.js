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
   * Append a message to the container (plain text)
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
   * Append a message with markdown rendering
   * @param {string} role - 'user' or 'model'
   * @param {string} markdown - Message markdown content
   */
  appendMessageWithMarkdown(role, markdown) {
    const msgDiv = this.createMessageDiv(role);
    msgDiv.querySelector(".message-content").innerHTML =
      this.renderMarkdown(markdown);
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
   * Append images to the container
   * @param {string} role - 'user' or 'model'
   * @param {Array} images - Array of { mimeType, data } objects (data is base64)
   */
  appendImages(role, images) {
    const msgDiv = this.createMessageDiv(role);
    const contentCheck = msgDiv.querySelector(".message-content");

    const grid = document.createElement("div");
    grid.className = "chat-images-grid";

    images.forEach((img) => {
      const imgEl = document.createElement("img");
      imgEl.src = `data:${img.mimeType};base64,${img.data}`;
      imgEl.className = "chat-message-image";

      // Simple lightbox or full view on click
      imgEl.onclick = () => {
        const modal = document.getElementById("imageModal");
        const modalImg = document.getElementById("imgModalPreview");
        if (modal && modalImg) {
          modalImg.src = imgEl.src;
          // Hide irrelevant fields in modal if re-using existing one
          document.getElementById("imgModalTitle").textContent =
            "Image Preview";
          document.getElementById("imgModalPrompt").textContent = "";
          modal.classList.remove("hidden");
        }
      };

      grid.appendChild(imgEl);
    });

    contentCheck.appendChild(grid);
    this.messagesContainer.appendChild(msgDiv);
    this.scrollToBottom();
  }

  /**
   * Append reference images to the container
   * @param {string} role - 'user' or 'model'
   * @param {Array} references - Array of { filename, url, ... } objects
   */
  appendReferences(role, references) {
    if (!references || references.length === 0) return;

    const msgDiv = this.createMessageDiv(role);
    const contentCheck = msgDiv.querySelector(".message-content");

    const grid = document.createElement("div");
    grid.className = "chat-images-grid references-grid";

    references.forEach((ref) => {
      // Container
      const refItem = document.createElement("div");
      refItem.className = "reference-preview-item";

      if (ref.url) {
        refItem.innerHTML = `
           <div class="reference-badge"><span class="material-icons">link</span></div>
           <img src="/${ref.url}" alt="${ref.filename}" class="chat-message-image"/>
        `;
        // Click to view?
        refItem.onclick = () => {
          const modal = document.getElementById("imageModal");
          const modalImg = document.getElementById("imgModalPreview");
          if (modal && modalImg) {
            modalImg.src = "/" + ref.url;
            document.getElementById("imgModalTitle").textContent =
              "Reference Preview";
            document.getElementById("imgModalPrompt").textContent =
              ref.filename;
            modal.classList.remove("hidden");
          }
        };
      } else {
        refItem.innerHTML = `
           <div class="reference-placeholder">
              <span class="material-icons">link</span>
              <span class="ref-name">${ref.filename}</span>
           </div>
        `;
      }
      grid.appendChild(refItem);
    });

    contentCheck.appendChild(grid);
    this.messagesContainer.appendChild(msgDiv);
    this.scrollToBottom();
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
