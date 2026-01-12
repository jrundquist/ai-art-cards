/**
 * theme.js
 * Handles theme switching (Light, Dark, System) and persistence.
 */

export const Theme = {
  SYSTEM: "system",
  LIGHT: "light",
  DARK: "dark",
};

const STORAGE_KEY = "theme-preference";

export function initTheme() {
  const savedTheme = localStorage.getItem(STORAGE_KEY) || Theme.SYSTEM;
  applyTheme(savedTheme);

  // Listen for system changes if in system mode
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (e) => {
      if (getCurrentPreference() === Theme.SYSTEM) {
        applySystemTheme();
      }
    });
}

function getCurrentPreference() {
  return localStorage.getItem(STORAGE_KEY) || Theme.SYSTEM;
}

function applySystemTheme() {
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute(
    "data-theme",
    isDark ? "dark" : "light"
  );
}

export function applyTheme(preference) {
  // Save preference
  localStorage.setItem(STORAGE_KEY, preference);

  if (preference === Theme.SYSTEM) {
    applySystemTheme();
  } else {
    document.documentElement.setAttribute("data-theme", preference);
  }

  // Dispatch event for UI updates if needed
  window.dispatchEvent(
    new CustomEvent("theme-changed", { detail: { theme: preference } })
  );
}

export function getThemePreference() {
  return getCurrentPreference();
}
