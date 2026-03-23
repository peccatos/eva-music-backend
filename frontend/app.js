import { createPlatform } from "./platform.js";
import { createPlayerWidget } from "./player-widget.js";

const platform = createPlatform();

createPlayerWidget({
  root: document.querySelector(".app"),
  source: {
    loadTracks(userId) {
      return platform.loadTracks(userId);
    },
    resolvePlayable(trackId, userId) {
      return platform.resolvePlayable(trackId, userId);
    },
    getDebugInfo(payload) {
      return platform.getDebugInfo(payload.state);
    },
  },
  audio: platform.createAudioPlayer(),
  initialUserId: platform.getInitialUserId(),
});

platform.ready();
