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
   * @returns {Promise<void>}
   */
  async streamResponse(
    projectId,
    conversationId,
    message,
    activeCardId,
    callbacks
  ) {
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
      }),
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
        const data = JSON.parse(payload);
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
}
