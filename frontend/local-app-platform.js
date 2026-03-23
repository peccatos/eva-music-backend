import { createBridgePlatform } from "./bridge-platform.js";
import { getLocalFallbackPlayable, getLocalFallbackTracksResponse, LOCAL_FALLBACK_TRACKS } from "./local-library.js";

const ROOT_LIBRARY_PATH = "C:\\dev\\eva-music-backend\\music";

function createNativeBridge() {
  const native = window.__EVA_NATIVE__ ?? null;

  if (native && typeof native.invoke === "function") {
    return native;
  }

  return {
    async invoke(command, payload = {}) {
      switch (command) {
        case "app.get_debug_info":
          return {
            info: {
              mode: "local-fallback",
              libraryPath: ROOT_LIBRARY_PATH,
              requestedState: payload.state,
              hasNativeBridge: false,
            },
          };

        case "library.list_tracks":
          return getLocalFallbackTracksResponse();

        case "library.resolve_track_url": {
          const track = LOCAL_FALLBACK_TRACKS.find((item) => item.id === payload.trackId);
          if (!track) {
            throw new Error("Local track not found");
          }
          return getLocalFallbackPlayable(payload.trackId);
        }

        default:
          throw new Error(`Unsupported local command: ${command}`);
      }
    },
  };
}

export function createLocalAppPlatform() {
  return createBridgePlatform({
    mode: "local-app",
    bridge: createNativeBridge(),
  });
}
