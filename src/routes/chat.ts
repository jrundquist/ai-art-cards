import { Router } from "express";
import { ChatService } from "../lib/chat_service";
import { logger } from "../lib/logger";

type ChatServiceProvider = () => ChatService | null;
type InitChatServiceFn = () => void;

export function createChatRouter(
  getChatService: ChatServiceProvider,
  initChatService: InitChatServiceFn,
  getApiKey: () => string
) {
  const router = Router();

  router.post("/chat/message", async (req, res) => {
    let chatService = getChatService();
    if (!chatService) {
      initChatService();
      chatService = getChatService();
    }
    // Deep check for generation capability
    const API_KEY = getApiKey();
    if (!API_KEY) {
      return res.status(401).json({ error: "API Key not set" });
    }

    const { projectId, conversationId, message, activeCardId, images, parts } =
      req.body;

    // Set headers for SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
      if (!chatService) throw new Error("Chat service not initialized");
      await chatService.sendMessageStream(
        projectId,
        conversationId,
        message,
        activeCardId || null,
        images || [], // Pass images if present
        res,
        parts || [],
        req.body.referenceImageFiles || [],
        req.body.generatedImageFiles || [] // New: generated results to attach
      );
    } catch (e: any) {
      logger.error("[Chat API] Error processing message:", e);
      if (!res.headersSent) {
        res.status(500).json({ error: e.message });
      } else {
        // If headers sent (streaming started), we need to write error event
        res.write(
          `data: ${JSON.stringify({ type: "error", content: e.message })}\n\n`
        );
        res.end();
      }
    }
  });

  router.get("/conversations", async (req, res) => {
    let chatService = getChatService();
    if (!chatService) {
      const API_KEY = getApiKey();
      if (API_KEY) {
        initChatService();
        chatService = getChatService();
      }
      if (!chatService)
        return res.status(401).json({ error: "API Key not set" });
    }
    const convs = await chatService?.listConversations();
    res.json(convs);
  });

  router.get("/conversations/:conversationId", async (req, res) => {
    let chatService = getChatService();
    if (!chatService) {
      const API_KEY = getApiKey();
      if (API_KEY) {
        initChatService();
        chatService = getChatService();
      }
      if (!chatService)
        return res.status(401).json({ error: "API Key not set" });
    }
    const { conversationId } = req.params;
    // We pass undefined for projectId as we are loading by ID from global storage
    const conv = await chatService?.loadConversation(conversationId);
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    res.json(conv);
  });

  router.delete("/conversations/:conversationId", async (req, res) => {
    let chatService = getChatService();
    if (!chatService) {
      const API_KEY = getApiKey();
      if (API_KEY) {
        initChatService();
        chatService = getChatService();
      }
      if (!chatService)
        return res.status(401).json({ error: "API Key not set" });
    }

    try {
      const { conversationId } = req.params;
      const success = await chatService?.deleteConversation(conversationId);
      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Conversation not found" });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
