// Status Service - SSE Client for Generation Status Updates
import { createToast, updateStatusBar } from "./ui.js";

class StatusService {
  constructor() {
    this.eventSource = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 500;
    this.activeToasts = new Map(); // jobId -> toast object
    this.activeJobs = new Map(); // jobId -> job object
    this.isConnected = false;
    this.offlineToast = null;
  }

  connect() {
    if (this.eventSource) {
      return; // Already connected
    }

    console.log("[StatusService] Connecting to SSE endpoint...");
    this.eventSource = new EventSource("/api/status/stream");

    this.eventSource.onopen = () => {
      console.log("[StatusService] Connected to status stream");
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.reconnectDelay = 500;

      // Clear offline toast if it exists
      if (this.offlineToast) {
        this.offlineToast.remove();
        this.offlineToast = null;
        createToast("Connected to server", "success", 2000);
      }
    };

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "initial") {
          // Restore active jobs on reconnect
          console.log("[StatusService] Received initial jobs:", data.jobs);
          data.jobs.forEach((job) => this.handleJobUpdate(job));
        } else {
          // Regular job update
          this.handleJobUpdate(data);
        }
      } catch (e) {
        console.error("[StatusService] Error parsing SSE message:", e);
      }
    };

    this.eventSource.onerror = (error) => {
      console.error("[StatusService] SSE error:", error);
      this.isConnected = false;
      this.eventSource.close();
      this.eventSource = null;

      // Show sticky offline toast if not already showing
      if (!this.offlineToast) {
        this.offlineToast = createToast(
          "Connection lost. You are offline.",
          "error",
          0,
          "wifi_off",
        );
      }

      // Attempt to reconnect indefinitely with constant delay
      this.reconnectAttempts++;
      const delay = this.reconnectDelay; // Constant 500ms delay
      console.log(
        `[StatusService] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`,
      );
      setTimeout(() => this.connect(), delay);
    };
  }

  updateStatusBarFromJobs() {
    const activeCount = this.activeJobs.size;

    if (activeCount === 0) {
      updateStatusBar("Ready");
    } else {
      // Calculate total images being generated
      let totalImages = 0;
      for (const job of this.activeJobs.values()) {
        totalImages += job.total;
      }
      const imageWord = totalImages === 1 ? "image" : "images";
      updateStatusBar(`Generating ${totalImages} ${imageWord}...`);
    }
  }

  handleJobUpdate(job) {
    console.log("[StatusService] Job update:", job);

    const { id, cardName, status, current, total, error } = job;

    // Track active jobs
    if (status === "generating") {
      this.activeJobs.set(id, job);
    } else {
      this.activeJobs.delete(id);
    }

    // Update status bar based on active jobs
    this.updateStatusBarFromJobs();

    // Get or create toast for this job
    let toast = this.activeToasts.get(id);

    if (status === "generating") {
      if (!toast) {
        // Create new toast
        const message = `Generating "${cardName}" ${current}/${total}...`;
        toast = createToast(message, "ai-generating", 0, "auto_awesome"); // Infinite duration
        this.activeToasts.set(id, toast);
      } else {
        // Update existing toast
        const message = `Generating "${cardName}" ${current}/${total}...`;
        toast.update(message, "ai-generating");
      }
    } else if (status === "completed") {
      if (toast) {
        toast.update(
          `Success: "${cardName}" (${total} image${total > 1 ? "s" : ""})`,
          "success",
        );
        setTimeout(() => {
          toast.remove();
          this.activeToasts.delete(id);
        }, 4000);
      } else {
        // Job completed but we didn't have a toast (maybe reconnected after completion)
        // Show brief success message
        createToast(
          `Success: "${cardName}" (${total} image${total > 1 ? "s" : ""})`,
          "success",
          4000,
        );
      }

      // Dispatch event for gallery refresh
      document.dispatchEvent(
        new CustomEvent("generation-completed", {
          detail: {
            jobId: id,
            projectId: job.projectId,
            cardId: job.cardId,
            results: job.results,
          },
        }),
      );

      // Electron notification
      if (window.electronAPI && window.electronAPI.showNotification) {
        window.electronAPI.showNotification(
          "Images Generated",
          `"${cardName}" - ${total} image${total > 1 ? "s" : ""} completed`,
          job.projectId,
          job.cardId,
        );
      }
    } else if (status === "error") {
      if (toast) {
        toast.update(`Error: ${error || "Generation failed"}`, "error");
        setTimeout(() => {
          toast.remove();
          this.activeToasts.delete(id);
        }, 8000);
      } else {
        // Show error even if we didn't have a toast
        createToast(`Error generating "${cardName}": ${error}`, "error", 8000);
      }
    }
  }

  disconnect() {
    if (this.eventSource) {
      console.log("[StatusService] Disconnecting from status stream");
      this.eventSource.close();
      this.eventSource = null;
      this.isConnected = false;
      if (this.offlineToast) {
        this.offlineToast.remove();
        this.offlineToast = null;
      }
    }
  }
}

// Export singleton instance
export const statusService = new StatusService();
