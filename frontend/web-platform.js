import { getLocalFallbackPlayable, getLocalFallbackTracksResponse } from "./local-library.js";

const USER_ID_KEY = "eva_music_user_id";

export function createWebPlatform(apiBase) {
  const telegram = window.Telegram?.WebApp ?? null;

  function getTelegramUserId() {
    return telegram?.initDataUnsafe?.user?.id?.toString() ?? "";
  }

  function hasRealTelegramUser() {
    return Boolean(telegram?.initDataUnsafe?.user?.id);
  }

  return {
    mode: "web",

    createAudioPlayer() {
      const audio = new Audio();
      audio.preload = "metadata";
      return audio;
    },

    getInitialUserId() {
      return getTelegramUserId() || localStorage.getItem(USER_ID_KEY) || "";
    },

    hasLockedUser() {
      return hasRealTelegramUser();
    },

    saveUserId(userId) {
      localStorage.setItem(USER_ID_KEY, userId);
    },

    async loadTracks(userId) {
      if (!userId) {
        return getLocalFallbackTracksResponse();
      }

      try {
        const response = await fetch(
          `${apiBase}/tracks/me?user_id=${encodeURIComponent(userId)}`
        );
        if (!response.ok) {
          return getLocalFallbackTracksResponse();
        }

        const tracks = (await response.json()).map((track) => ({
          id: track.id,
          title: track.title,
          artist: track.artist ?? null,
        }));

        return {
          tracks: tracks.length > 0 ? tracks : getLocalFallbackTracksResponse().tracks,
        };
      } catch {
        return getLocalFallbackTracksResponse();
      }
    },

    async resolvePlayable(trackId, userId) {
      if (trackId.startsWith("local:")) {
        return getLocalFallbackPlayable(trackId);
      }

      const params = new URLSearchParams({ track_id: trackId });
      if (userId) {
        params.set("user_id", userId);
      }

      const response = await fetch(`${apiBase}/tracks/audio?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Не удалось получить ссылку на трек");
      }

      const data = await response.json();
      return {
        url: data.file_url,
        kind: "http",
      };
    },

    async getDebugInfo(state) {
      return {
        mode: "web",
        telegramPresent: Boolean(telegram),
        initData: telegram?.initData ?? null,
        initDataUnsafe: telegram?.initDataUnsafe ?? null,
        telegramUserId: getTelegramUserId(),
        effectiveUserId: state.userId,
        hasRealTelegramUser: hasRealTelegramUser(),
      };
    },

    ready() {
      if (!telegram) return;
      telegram.ready();
      telegram.expand();
    },
  };
}
