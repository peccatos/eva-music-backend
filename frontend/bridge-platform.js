export function createBridgePlatform(options) {
  const bridge = options.bridge;
  const mode = options.mode;
  const lockedUser = options.lockedUser ?? true;
  const initialUserId = options.initialUserId ?? "";
  const saveUserId = options.saveUserId ?? (() => undefined);
  const ready = options.ready ?? (() => undefined);
  const normalizePlayable = options.normalizePlayable ?? ((value) => ({
    url: value,
    kind: "asset",
  }));

  return {
    mode,

    createAudioPlayer() {
      const audio = new Audio();
      audio.preload = "metadata";
      return audio;
    },

    getInitialUserId() {
      return initialUserId;
    },

    hasLockedUser() {
      return lockedUser;
    },

    saveUserId,

    async loadTracks(userId) {
      return bridge.invoke("library.list_tracks", { userId });
    },

    async resolvePlayable(trackId, userId) {
      const response = await bridge.invoke("library.resolve_track_url", { trackId, userId });
      return normalizePlayable(response);
    },

    async getDebugInfo(state) {
      const response = await bridge.invoke("app.get_debug_info", {
        state,
      });
      return response.info;
    },

    ready,
  };
}
