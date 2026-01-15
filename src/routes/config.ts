import { Router } from "express";
import { DataService } from "../lib/data_service";

type KeyUpdateCallback = (key: string) => void;

export function createConfigRouter(
  dataService: DataService,
  onKeyUpdate: KeyUpdateCallback
) {
  const router = Router();

  router.post("/config", async (req, res) => {
    const { apiKey, name } = req.body;
    if (apiKey) {
      if (name) {
        // Save named key
        await dataService.saveKey(name, apiKey);
      }
      onKeyUpdate(apiKey);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: "Missing apiKey" });
    }
  });

  router.get("/keys", async (req, res) => {
    const keys = await dataService.getKeys();
    res.json(keys);
  });

  return router;
}
