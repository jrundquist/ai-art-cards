/**
 * ChatUIController - Manages chat panel UI state and interactions
 */
export class ChatUIController {
  constructor(sidebar, toggleBtn, mainContent, resizeHandle) {
    this.sidebar = sidebar;
    this.toggleBtn = toggleBtn;
    this.mainContent = mainContent;
    this.resizeHandle = resizeHandle;

    this.isResizing = false;
    this.startX = 0;
    this.startWidth = 0;

    this.initResizeHandlers();
    this.restoreState();
  }

  /**
   * Initialize resize event handlers
   */
  initResizeHandlers() {
    this.resizeHandle.addEventListener("mousedown", (e) => this.startResize(e));
    document.addEventListener("mousemove", (e) => this.doResize(e));
    document.addEventListener("mouseup", () => this.stopResize());
  }

  /**
   * Toggle sidebar open/close
   * @param {boolean} saveState - Whether to persist state to localStorage
   */
  toggleSidebar(saveState = true) {
    this.sidebar.classList.toggle("hidden");
    this.toggleBtn.classList.toggle("hidden");
    this.mainContent.classList.toggle("chat-open");

    const isOpen = !this.sidebar.classList.contains("hidden");

    if (saveState) {
      localStorage.setItem("chatPanelOpen", isOpen);
    }

    return isOpen;
  }

  /**
   * Check if sidebar is currently open
   * @returns {boolean}
   */
  isOpen() {
    return !this.sidebar.classList.contains("hidden");
  }

  /**
   * Start resize operation
   * @param {MouseEvent} e
   */
  startResize(e) {
    this.isResizing = true;
    this.startX = e.clientX;
    this.startWidth = this.sidebar.offsetWidth;
    this.resizeHandle.classList.add("resizing");
    this.sidebar.classList.add("resizing");
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  }

  /**
   * Handle resize dragging
   * @param {MouseEvent} e
   */
  doResize(e) {
    if (!this.isResizing) return;

    // Calculate new width (dragging left increases width)
    const delta = this.startX - e.clientX;
    const newWidth = this.startWidth + delta;

    // Apply constraints
    const minWidth = 280;
    const maxWidth = 600;
    const constrainedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

    // Apply the new width
    this.sidebar.style.setProperty("--chat-width", `${constrainedWidth}px`);
  }

  /**
   * Stop resize operation
   */
  stopResize() {
    if (!this.isResizing) return;

    this.isResizing = false;
    this.resizeHandle.classList.remove("resizing");
    this.sidebar.classList.remove("resizing");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";

    // Save the width to localStorage
    const currentWidth = this.sidebar.offsetWidth;
    localStorage.setItem("chatPanelWidth", currentWidth);
  }

  /**
   * Restore UI state from localStorage
   */
  restoreState() {
    // Restore open/closed state
    const savedState = localStorage.getItem("chatPanelOpen");
    if (savedState === "true") {
      this.toggleSidebar(false);
    }

    // Restore saved width
    const savedWidth = localStorage.getItem("chatPanelWidth");
    if (savedWidth) {
      this.sidebar.style.setProperty("--chat-width", `${savedWidth}px`);
    }
  }

  /**
   * Get the sidebar element
   * @returns {HTMLElement}
   */
  getSidebar() {
    return this.sidebar;
  }
}
