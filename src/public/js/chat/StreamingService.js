/**
 * StreamingService - Handles SSE streaming and event processing
 */
export class StreamingService {
  /**
   * Stream a chat response from the server
   * @param {string} projectId
   * @param {string} conversationId
   * @param {string} message
   * @param {string|null} activeCardId
   * @param {object} callbacks - Event handlers
   * @param {Function} callbacks.onText - (content: string) => void
   * @param {Function} callbacks.onToolCall - (calls: Array) => void
   * @param {Function} callbacks.onToolResult - (toolName: string, result: object) => void
   * @param {Function} callbacks.onError - (error: string) => void
   * @param {Function} callbacks.onTitle - (title: string) => void
   * @param {Function} callbacks.onSpecialAction - (action: object) => void
   * @param {Array} images
   * @param {object} callbacks - Event handlers
   * @param {Array} parts - Optional multi-modal parts
   * @returns {Promise<void>}
   */
  async streamResponse(
    projectId,
    conversationId,
    message,
    activeCardId,
    images = [],
    callbacks,
    parts = [],
    referenceImageFiles = [],
    generatedImageFiles = [],
    useThinking = false
  ) {
    this.abortController = new AbortController();

    try {
      const response = await fetch("/api/chat/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          conversationId,
          message,
          activeCardId,
          images,
          parts,
          referenceImageFiles: referenceImageFiles || [],
          generatedImageFiles: generatedImageFiles || [],
          useThinking,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        await this.parseSSEChunk(chunk, callbacks);
      }
    } catch (error) {
      if (error.name === "AbortError") {
        console.log("Stream aborted by user");
        if (callbacks.onError) {
          // We might want to treating abort as a special case or just log it
          // For now, let's not call onError so we don't show a red error box for a purposeful action
          // unless we want a "Stopped" message.
          // Actually, let's allow the caller to handle the UI state update for abort.
        }
      } else {
        throw error;
      }
    } finally {
      this.abortController = null;
    }
  }

  abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Parse SSE chunk and dispatch to appropriate handlers
   * @param {string} chunk - Raw SSE chunk
   * @param {object} callbacks - Event handlers
   * @returns {Promise<void>}
   */
  async parseSSEChunk(chunk, callbacks) {
    // Parse SSE format: "data: {json}\n\n"
    const lines = chunk.split("\n\n");

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.substring(6);
      if (payload === "[DONE]") break;

      try {
        const rawData = JSON.parse(payload);
        // Deep clone to prevent any listener from mutating shared state
        const data = JSON.parse(JSON.stringify(rawData));
        await this.handleEvent(data, callbacks);
      } catch (e) {
        console.error("Failed to parse SSE line", line, e);
      }
    }
  }

  /**
   * Handle a parsed SSE event
   * @param {object} data - Parsed event data
   * @param {object} callbacks - Event handlers
   * @returns {Promise<void>}
   */
  async handleEvent(data, callbacks) {
    switch (data.type) {
      case "text":
        this.handleTextEvent(data, callbacks);
        break;
      case "tool_call":
        this.handleToolCallEvent(data, callbacks);
        break;
      case "tool_result":
        this.handleToolResultEvent(data, callbacks);
        break;
      case "error":
        this.handleErrorEvent(data, callbacks);
        break;
      case "title":
        this.handleTitleEvent(data, callbacks);
        break;
      case "thought":
        this.handleThoughtEvent(data, callbacks);
        break;
    }
  }

  /**
   * Handle text event
   * @param {object} data
   * @param {object} callbacks
   */
  handleTextEvent(data, callbacks) {
    if (callbacks.onText) {
      callbacks.onText(data.content);
    }
  }

  /**
   * Handle tool call event
   * @param {object} data
   * @param {object} callbacks
   */
  handleToolCallEvent(data, callbacks) {
    if (callbacks.onToolCall) {
      callbacks.onToolCall(data.content);
    }
  }

  /**
   * Handle tool result event
   * @param {object} data
   * @param {object} callbacks
   */
  handleToolResultEvent(data, callbacks) {
    if (callbacks.onToolResult) {
      callbacks.onToolResult(data.toolName, data.result);
    }

    // Handle special actions
    if (
      data.result.clientAction ||
      data.result.path ||
      data.result.created ||
      data.result.updated
    ) {
      if (callbacks.onSpecialAction) {
        callbacks.onSpecialAction(data.result);
      }
    }
  }

  /**
   * Handle error event
   * @param {object} data
   * @param {object} callbacks
   */
  handleErrorEvent(data, callbacks) {
    if (callbacks.onError) {
      callbacks.onError(data.content);
    }
  }

  /**
   * Handle title update event
   * @param {object} data
   * @param {object} callbacks
   */
  handleTitleEvent(data, callbacks) {
    if (callbacks.onTitle) {
      callbacks.onTitle(data.content);
    }
  }

  /**
   * Handle thought event
   * @param {object} data
   * @param {object} callbacks
   */
  handleThoughtEvent(data, callbacks) {
    if (callbacks.onThought) {
      callbacks.onThought(data.content);
    }
  }
}
