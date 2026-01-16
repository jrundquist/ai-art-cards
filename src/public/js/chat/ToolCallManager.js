/**
 * ToolCallManager - Manages tool call visualization and tracking
 */
export class ToolCallManager {
  constructor() {
    this.activeToolCalls = new Map();
    this.toolCallCounter = 0;
  }

  /**
   * Generate a unique ID for a tool call
   * @returns {string}
   */
  generateToolCallId() {
    return `tool-${Date.now()}-${this.toolCallCounter++}`;
  }

  /**
   * Get metadata (icon, label, color) for a tool
   * @param {string} toolName
   * @returns {{icon: string, label: string, color: string}}
   */
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
      addProjectModifier: {
        icon: "playlist_add",
        label: "Adding Modifier",
        color: "#10b981",
      },
      removeProjectModifier: {
        icon: "playlist_remove",
        label: "Removing Modifier",
        color: "#ef4444",
      },
      generateImage: {
        icon: "auto_awesome",
        label: "Generating Image",
        color: "#ec4899",
      },
      navigateUI: {
        icon: "visibility",
        label: "Navigating UI",
        color: "#8b5cf6",
      },
      getGeneratedImage: {
        icon: "image",
        label: "Viewing Generated Image",
        color: "#ec4899",
      },
      listCardImages: {
        icon: "photo_library",
        label: "Listing Images",
        color: "#8b5cf6",
      },
    };
    return (
      metadata[toolName] || { icon: "build", label: toolName, color: "#6b7280" }
    );
  }

  /**
   * Summarize tool result into human-readable text
   * @param {string} toolName
   * @param {object} args - Tool arguments
   * @param {object} result - Tool result
   * @returns {string}
   */
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
          if (args.updates?.promptModifiers) {
            return `Updated project modifiers (Unsafe Overwrite!)`;
          } else {
            return "Updated project settings";
          }
        case "addProjectModifier":
          return `Added '${args.modifier.type}': ${args.modifier.name}`;
        case "removeProjectModifier":
          return "Removed modifier";
        case "generateImage":
          return "Started image generation";
        case "navigateUI":
          const dest = result?.cardName
            ? `card '${result.cardName}'`
            : "project";
          if (result?.filename) return `Viewing image: ${result.filename}`;
          return `Navigated to ${dest}`;
        case "getGeneratedImage":
          const fname = result?.filename || args.filename || "image";
          return `Viewing image: ${fname}`;
        case "listCardImages":
          return `Found ${result?.count || 0} image(s)`;
        default:
          return "Completed";
      }
    } catch (e) {
      return "Completed";
    }
  }

  /**
   * Create a tool call element (in-progress state)
   * @param {string} toolName
   * @param {string} toolId - Unique ID for tracking
   * @param {object} args - Tool arguments
   * @returns {HTMLElement}
   */
  createToolCallElement(toolName, toolId, args) {
    const metadata = this.getToolMetadata(toolName);
    const toolDiv = document.createElement("div");
    toolDiv.className = "tool-call";
    toolDiv.setAttribute("data-tool-call-id", toolId);
    toolDiv.setAttribute("data-tool-name", toolName);
    toolDiv.style.borderLeftColor = metadata.color;
    toolDiv.innerHTML = `
      <span class="material-icons" style="color: ${metadata.color}">${metadata.icon}</span>
      <span class="tool-label">${metadata.label}<span class="tool-dots">...</span></span>
    `;

    // Track this tool call
    this.activeToolCalls.set(toolId, {
      element: toolDiv,
      name: toolName,
      args: args,
    });

    return toolDiv;
  }

  /**
   * Find and return a pending tool call by name (for matching with results)
   * @param {string} toolName
   * @returns {{id: string, element: HTMLElement, name: string, args: object} | null}
   */
  findPendingToolCall(toolName) {
    for (const [id, entry] of this.activeToolCalls.entries()) {
      if (entry.name === toolName) {
        this.activeToolCalls.delete(id);
        return { id, ...entry };
      }
    }
    return null;
  }

  /**
   * Update a tool call element to show completion
   * @param {HTMLElement} toolElement
   * @param {string} toolName
   * @param {object} args
   * @param {object} result
   */
  updateToolResult(toolElement, toolName, args, result) {
    // If args is empty (often the case during history updates), try to recover from attribute
    let effectiveArgs = args;
    if (!args || Object.keys(args).length === 0) {
      const storedArgs = toolElement.getAttribute("data-args");
      if (storedArgs) {
        try {
          effectiveArgs = JSON.parse(storedArgs);
        } catch (e) {
          console.error("Failed to parse stored args:", storedArgs, e.message);
        }
      }
    }

    this.renderToolCompletion(toolElement, toolName, effectiveArgs, result);
  }

  /**
   * Create a completed tool element for history rendering
   * @param {string} toolName
   * @param {object} args
   * @param {object} result
   * @returns {HTMLElement}
   */
  createCompletedToolElement(toolName, args, result) {
    const div = document.createElement("div");
    div.className = "tool-completed";
    div.setAttribute("data-tool-name", toolName);
    // Store args for later recovery during updates
    div.setAttribute("data-args", JSON.stringify(args || {}));

    this.renderToolCompletion(div, toolName, args, result);

    return div;
  }

  /**
   * Shared logic to render a completed tool state (Header + Actions + Image)
   * @param {HTMLElement} element
   * @param {string} toolName
   * @param {object} args
   * @param {object} result
   */
  renderToolCompletion(element, toolName, args, result) {
    const metadata = this.getToolMetadata(toolName);
    const summary = this.summarizeToolResult(toolName, args, result);

    element.style.borderLeftColor = metadata.color;
    element.innerHTML = `
      <span class="material-icons" style="color: ${metadata.color}">${metadata.icon}</span>
      <span class="tool-label">${summary}</span>
    `;

    this._appendRetryAction(element, toolName, args);
    this._appendResultImage(element, result);
  }

  /**
   * Append Retry/Regenerate action if applicable
   * @param {HTMLElement} container
   * @param {string} toolName
   * @param {object} args
   */
  _appendRetryAction(container, toolName, args) {
    if (toolName === "generateImage") {
      const actionsDiv = document.createElement("div");
      actionsDiv.className = "tool-call-actions";
      actionsDiv.style.marginLeft = "auto";
      actionsDiv.style.display = "flex";
      actionsDiv.style.alignItems = "center";

      const retryBtn = document.createElement("button");
      retryBtn.className = "icon-btn-sm secondary-btn-sm";
      retryBtn.title = "Generate Again (Exact Parameters)";
      retryBtn.innerHTML =
        '<span class="material-icons" style="font-size: 16px;">autorenew</span>';

      retryBtn.onclick = (e) => {
        e.stopPropagation();
        const event = new CustomEvent("retry-generation", {
          detail: { args: args },
        });
        document.dispatchEvent(event);
      };

      actionsDiv.appendChild(retryBtn);
      container.appendChild(actionsDiv);
    }
  }

  /**
   * Append Result Image if applicable
   * @param {HTMLElement} container
   * @param {object} result
   */
  _appendResultImage(container, result) {
    if (result && result.inlineData) {
      const img = document.createElement("img");
      img.src = `data:${result.inlineData.mimeType};base64,${result.inlineData.data}`;
      img.className = "tool-result-image";
      container.appendChild(img);

      // Add click handler for modal
      img.onclick = () => {
        const modal = document.getElementById("imageModal");
        const modalImg = document.getElementById("imgModalPreview");
        if (modal && modalImg) {
          modalImg.src = img.src;
          const titleEl = document.getElementById("imgModalTitle");
          if (titleEl) titleEl.textContent = "Image Detail";
          const promptEl = document.getElementById("imgModalPrompt");
          if (promptEl) promptEl.textContent = "";
          modal.classList.remove("hidden");
        }
      };
    }
  }

  /**
   * Clear all active tool call tracking
   */
  clearActiveToolCalls() {
    this.activeToolCalls.clear();
  }
}
