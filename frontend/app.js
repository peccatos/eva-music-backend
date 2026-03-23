import { createPlatform } from "./platform.js";
import { createPlayerWidget } from "./player-widget.js";

async function bootstrap() {
  const platform = await createPlatform();

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
}

bootstrap().catch((error) => {
  console.error(error);
  const root = document.querySelector(".app");
  if (root) {
    root.textContent = "Frontend bootstrap failed";
  }
});
