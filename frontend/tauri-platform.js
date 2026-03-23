import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { createBridgePlatform } from "./bridge-platform.js";
import { getLocalFallbackPlayable, getLocalFallbackTracksResponse } from "./local-library.js";

function createTauriBridge() {
  return {
    async invoke(command, payload = {}) {
      const commandName = command.replaceAll(".", "_");
      try {
        return await invoke(commandName, payload);
      } catch (error) {
        if (command === "library.list_tracks") {
          return getLocalFallbackTracksResponse();
        }

        if (command === "library.resolve_track_url") {
          return getLocalFallbackPlayable(payload.trackId);
        }

        if (command === "app.get_debug_info") {
          return {
            info: {
              mode: "tauri-fallback",
              libraryPath: "C:\\dev\\eva-music-backend\\music",
              invokeError: String(error),
            },
          };
        }

        throw error;
      }
    },
  };
}

export function createTauriPlatform() {
  return createBridgePlatform({
    mode: "tauri",
    bridge: createTauriBridge(),
    normalizePlayable: (value) => {
      if (value?.kind === "file") {
        return {
          ...value,
          url: convertFileSrc(value.url),
        };
      }

      return value;
    },
  });
}
