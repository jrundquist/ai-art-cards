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
    const innerDiv = document.createElement("div");
    innerDiv.className = "message-content";
    div.appendChild(innerDiv);
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
    // Check for Reference Images system tag or combined Attached/Review tags
    // Pattern: [System: Referenced Images ... [...]] OR [System: Attached Image IDs: ...; Referenced Images ... [...]]
    // Pattern: [User Message]\n<Actual Content>
    // We want to hide everything before [User Message]
    // But we still need to extract Reference Images if they exist in the [System] block or [Context] block.

    const userMsgDelimiter = "[User Message]\n";
    let cleanMarkdown = markdown;
    let references = [];

    // 1. Extract References (JSON)
    // We look for the marker: "Referenced Images (pass these to generateImage tool as 'referenceImageFiles'):"
    // The previous parsing logic was a bit fragile.
    // Let's try to just find the JSON array associated with the marker.
    const refMarker =
      "Referenced Images (pass these to generateImage tool as 'referenceImageFiles'):";
    if (markdown.includes(refMarker)) {
      try {
        const markerIndex = markdown.indexOf(refMarker);
        // The JSON should start after the marker.
        // It generally looks like: ... marker ... [ { ... } ] ...
        const openBracket = markdown.indexOf(
          "[",
          markerIndex + refMarker.length
        );
        if (openBracket !== -1) {
          // Let's just Regex it: `\[ {.*} \]`
          // Or stricter: `marker\s*(\[\s*\{.*?\}\s*\])`
          const jsonRegex = new RegExp(
            refMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
              "\\s*(\\[\\s*\\{.*?\\}\\s*\\])",
            "s"
          );
          const match = markdown.match(jsonRegex);
          if (match && match[1]) {
            references = JSON.parse(match[1]);
          }
        }
      } catch (e) {
        console.error("Failed to parse references:", e);
      }
    }

    // 2. Hide Context/System
    const delimiterIndex = markdown.indexOf(userMsgDelimiter);
    if (delimiterIndex !== -1) {
      // Show everything AFTER the delimiter
      cleanMarkdown = markdown.substring(
        delimiterIndex + userMsgDelimiter.length
      );
    } else {
      // Check for old [System: ...] tags and hide them if possible
      cleanMarkdown = markdown.replace(/\[System:.*?\]/g, "").trim();
    }

    const msgDiv = this.createMessageDiv(role);
    msgDiv.querySelector(".message-content").innerHTML =
      this.renderMarkdown(cleanMarkdown);

    this.messagesContainer.appendChild(msgDiv);

    // If we extracted references, append them to the SAME message div or container
    if (references.length > 0) {
      // We reuse the existing logic but we need to inject it into the *current* message bubble or right after text
      // appendReferences creates a NEW message div usually. Let's see if we can reuse the logic
      // or just call appendReferences separately.
      // Calling appendReferences separately creates a separate bubble, which is actually fine/good.
      this.appendReferences(role, references);
    }

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

      // Determine URL: use existing or fallback to API resolver
      const displayUrl =
        ref.url ||
        `/api/ref-image/${ref.projectId}/${ref.cardId}/${ref.filename}`;

      refItem.innerHTML = `
           <div class="reference-badge"><span class="material-icons">link</span></div>
           <img src="${
             displayUrl.startsWith("/") ? displayUrl : "/" + displayUrl
           }" alt="${ref.filename}" class="chat-message-image"/>
        `;

      // Click to view
      refItem.onclick = () => {
        const modal = document.getElementById("imageModal");
        const modalImg = document.getElementById("imgModalPreview");
        if (modal && modalImg) {
          modalImg.src = displayUrl.startsWith("/")
            ? displayUrl
            : "/" + displayUrl;
          document.getElementById("imgModalTitle").textContent =
            "Reference Preview";
          document.getElementById("imgModalPrompt").textContent = ref.filename;
          modal.classList.remove("hidden");
        }
      };

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
   * Append or update a thought process block
   * @param {HTMLElement} aiContentDiv - The main AI message content div (text)
   * @param {string} text - The thought text to append
   * @returns {HTMLElement} The thought content element
   */
  appendThought(aiContentDiv, text) {
    const wrapper = aiContentDiv.parentNode;
    let details = wrapper.querySelector(".thought-process");

    if (!details) {
      details = document.createElement("details");
      details.className = "thought-process";
      details.open = true;
      details.innerHTML =
        '<summary><span class="material-icons">chevron_right</span> Thinking Process</summary><div class="thought-content"></div>';
      // Insert before the text content
      wrapper.insertBefore(details, aiContentDiv);
    }

    const contentDiv = details.querySelector(".thought-content");
    contentDiv.innerHTML += this.renderMarkdown(text);
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
