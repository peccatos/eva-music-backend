import { createLocalAppPlatform } from "./local-app-platform.js";
import { createTauriPlatform } from "./tauri-platform.js";
import { createWebPlatform } from "./web-platform.js";

const API_BASE = "http://127.0.0.1:3001";

export function createPlatform() {
  const mode = new URLSearchParams(window.location.search).get("platform");

  if (mode === "tauri" || window.__TAURI_INTERNALS__) {
    return createTauriPlatform();
  }

  if (mode === "local-app" || window.__EVA_NATIVE__) {
    return createLocalAppPlatform();
  }

  return createWebPlatform(API_BASE);
}
