import { bootstrapTelegramSession, fetchTrackAudioUrl } from "./api.js";

const telegram = window.Telegram?.WebApp ?? null;

const player = document.getElementById("player");
const audio = document.getElementById("audio");
const playToggle = document.getElementById("playToggle");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const playlistBtn = document.getElementById("playlistBtn");
const trackStatus = document.getElementById("trackStatus");
const trackTitle = document.getElementById("trackTitle");
const trackArtist = document.getElementById("trackArtist");

const state = {
  status: telegram ? "loading_user_context" : "ready",
  contextMode: telegram ? "telegram" : "browser",
  contextMessage: telegram ? null : "Not in Telegram WebApp context",
  telegramUserId: "",
  initDataRaw: "",
  tracks: [],
  currentTrackId: null,
  currentTrack: null,
  audioUrl: null,
  errorMessage: null,
  requestToken: 0,
  isAudioElementPlaying: false,
};

function isValidTrack(track) {
  return Boolean(track && typeof track === "object" && String(track.id || "").trim());
}

function currentTrack() {
  return state.currentTrack;
}

function transition(event, payload = {}) {
  switch (event) {
    case "INIT":
      return { ...state };
    case "DEV_BROWSER_MODE":
      return {
        ...state,
        status: "ready",
        contextMode: "browser",
        contextMessage: payload.message || "Not in Telegram WebApp context",
        telegramUserId: "",
        initDataRaw: "",
        tracks: [],
        currentTrackId: null,
        currentTrack: null,
        audioUrl: null,
        errorMessage: null,
        isAudioElementPlaying: false,
      };
    case "BOOTSTRAP_STARTED":
      return {
        ...state,
        status: "loading_library",
        contextMode: "telegram",
        contextMessage: null,
        errorMessage: null,
        requestToken: payload.token,
        initDataRaw: payload.initDataRaw || state.initDataRaw,
        isAudioElementPlaying: false,
      };
    case "BOOTSTRAP_SUCCEEDED":
      if (payload.token !== state.requestToken) return state;
      return {
        ...state,
        status: "ready",
        contextMode: "telegram",
        contextMessage: null,
        telegramUserId: String(payload.telegramUserId || ""),
        initDataRaw: payload.initDataRaw || state.initDataRaw,
        tracks: payload.tracks || [],
        currentTrackId: payload.tracks?.[0]?.id ? String(payload.tracks[0].id) : null,
        currentTrack: payload.tracks?.[0] || null,
        audioUrl: null,
        errorMessage: null,
        isAudioElementPlaying: false,
      };
    case "BOOTSTRAP_FAILED":
      if (payload.token !== state.requestToken) return state;
      return {
        ...state,
        status: "error",
        tracks: [],
        currentTrackId: null,
        currentTrack: null,
        audioUrl: null,
        errorMessage: payload.message || "Не удалось загрузить библиотеку",
        isAudioElementPlaying: false,
      };
    case "TRACK_SELECTED":
      return {
        ...state,
        status: state.tracks.length > 0 ? "ready" : "ready",
        currentTrackId: payload.track?.id ? String(payload.track.id) : null,
        currentTrack: payload.track || null,
        audioUrl: null,
        errorMessage: null,
        isAudioElementPlaying: false,
      };
    case "AUDIO_RESOLVE_STARTED":
      return {
        ...state,
        status: "resolving_audio",
        currentTrackId: payload.trackId ? String(payload.trackId) : state.currentTrackId,
        currentTrack: payload.track || state.currentTrack,
        audioUrl: null,
        errorMessage: null,
        requestToken: payload.token,
        isAudioElementPlaying: false,
      };
    case "AUDIO_RESOLVE_SUCCEEDED":
      if (payload.token !== state.requestToken) return state;
      return {
        ...state,
        status: payload.autoplay ? "playing" : "ready",
        currentTrackId: payload.trackId ? String(payload.trackId) : state.currentTrackId,
        currentTrack: payload.track || state.currentTrack,
        audioUrl: payload.audioUrl || null,
        errorMessage: null,
        isAudioElementPlaying: Boolean(payload.autoplay),
      };
    case "AUDIO_RESOLVE_FAILED":
      if (payload.token !== state.requestToken) return state;
      return {
        ...state,
        status: "error",
        audioUrl: null,
        errorMessage: payload.message || "Не удалось получить ссылку на аудио",
        isAudioElementPlaying: false,
      };
    case "PLAY_REQUESTED":
      if (!state.currentTrackId || !state.audioUrl) return state;
      return {
        ...state,
        status: "playing",
        errorMessage: null,
      };
    case "PAUSE_REQUESTED":
      return {
        ...state,
        status: state.tracks.length > 0 ? "paused" : "ready",
        isAudioElementPlaying: false,
      };
    case "AUDIO_STARTED":
      return {
        ...state,
        status: state.currentTrackId && state.audioUrl ? "playing" : state.status,
        isAudioElementPlaying: true,
      };
    case "AUDIO_PAUSED":
      return {
        ...state,
        status: state.tracks.length > 0 ? "paused" : "ready",
        isAudioElementPlaying: false,
      };
    case "AUDIO_ENDED":
      return {
        ...state,
        status: state.tracks.length > 0 ? "ready" : "ready",
        isAudioElementPlaying: false,
      };
    case "RESET_ERROR":
      return {
        ...state,
        status: state.tracks.length > 0 ? "ready" : state.contextMode === "browser" ? "ready" : "loading_user_context",
        errorMessage: null,
      };
    default:
      return state;
  }
}

function dispatch(event, payload = {}) {
  Object.assign(state, transition(event, payload));
  render();
}

function setSvgText(node, value) {
  if (node) node.textContent = value;
}

function setArtwork(url) {
  if (!player) return;

  if (url) {
    player.style.setProperty("--cover-image", `url("${url}")`);
    return;
  }

  player.style.removeProperty("--cover-image");
}

function syncAudioSource() {
  if (!audio) return;

  if (state.audioUrl) {
    if (audio.src !== state.audioUrl) {
      audio.src = state.audioUrl;
      audio.load();
    }
    return;
  }

  if (audio.hasAttribute("src")) {
    audio.removeAttribute("src");
    audio.load();
  }
}

function renderFallback(message, submessage, status) {
  setSvgText(trackTitle, message);
  setSvgText(trackArtist, submessage);
  setSvgText(trackStatus, status);
  setArtwork("");
}

function statusLabel() {
  switch (state.status) {
    case "loading_user_context":
      return "Проверка Telegram...";
    case "loading_library":
      return "Загрузка библиотеки...";
    case "resolving_audio":
      return "Загрузка аудио...";
    case "playing":
      return "Воспроизведение";
    case "paused":
      return "Пауза";
    case "error":
      return "Ошибка";
    default:
      return state.audioUrl ? "Готово" : "Готово к воспроизведению";
  }
}

function renderTrack() {
  const track = currentTrack();

  if (!track) {
    if (state.contextMode === "browser") {
      renderFallback(
        "Dev/browser mode",
        state.contextMessage || "Открой Mini App из Telegram",
        "Локальный режим"
      );
      return;
    }

    renderFallback(
      state.status === "loading_library" ? "Загрузка библиотеки..." : "Библиотека пуста",
      state.status === "loading_library"
        ? "Backend валидирует Telegram user"
        : "Треков пока нет для этого Telegram пользователя",
      state.status === "loading_library" ? "Загрузка" : "Готово"
    );
    return;
  }

  if (!isValidTrack(track) || !String(track.title || "").trim()) {
    renderFallback(
      "Некорректные данные",
      "Backend вернул трек без обязательных полей",
      "Невозможно продолжить"
    );
    return;
  }

  setSvgText(trackTitle, track.title);
  setSvgText(trackArtist, track.artist || "Исполнитель не указан");
  setSvgText(trackStatus, statusLabel());
  setArtwork(track.artworkUrl);
}

function render() {
  if (player) {
    player.classList.toggle("is-playing", state.status === "playing");
  }

  if (playToggle) {
    playToggle.setAttribute("aria-pressed", String(state.status === "playing"));
  }

  if (state.status === "error") {
    renderFallback(
      "Ошибка загрузки",
      state.errorMessage || "Проверь backend",
      "Ошибка"
    );
    syncAudioSource();
    return;
  }

  if (state.status === "loading_user_context") {
    renderFallback(
      "Проверка Telegram...",
      "Передаём initData на backend",
      "Инициализация"
    );
    syncAudioSource();
    return;
  }

  if (state.status === "loading_library") {
    renderFallback(
      "Загрузка библиотеки...",
      "Backend валидирует Telegram user",
      "Загрузка"
    );
    syncAudioSource();
    return;
  }

  renderTrack();
  syncAudioSource();
}

function setPlaybackDesired(isPlaying) {
  if (!audio) return;

  if (isPlaying) {
    const playPromise = audio.play();
    if (playPromise) {
      playPromise.catch((error) => {
        console.error(error);
        if (state.status === "playing") {
          dispatch("AUDIO_PAUSED");
        }
      });
    }
    return;
  }

  audio.pause();
}

function resolveCurrentTrack(autoplay = false) {
  const track = currentTrack();
  if (!isValidTrack(track)) {
    return Promise.reject(new Error("Invalid normalized track: missing id"));
  }

  if (state.status === "resolving_audio") return Promise.resolve();

  const token = state.requestToken + 1;
  dispatch("AUDIO_RESOLVE_STARTED", {
    token,
    trackId: track.id,
    track,
    autoplay,
  });

  return fetchTrackAudioUrl(track.id, { initDataRaw: state.initDataRaw })
    .then((audioUrl) => {
      if (token !== state.requestToken) return;
      if (!String(audioUrl || "").trim()) {
        throw new Error("Invalid audio URL returned by backend");
      }

      dispatch("AUDIO_RESOLVE_SUCCEEDED", {
        token,
        trackId: track.id,
        track,
        audioUrl,
        autoplay,
      });

      if (autoplay) {
        setPlaybackDesired(true);
      }
    })
    .catch((error) => {
      if (token !== state.requestToken) return;
      dispatch("AUDIO_RESOLVE_FAILED", {
        token,
        message: error?.message || "Не удалось получить ссылку на аудио",
      });
    });
}

function stepTrack(direction) {
  if (state.tracks.length === 0) return;

  const currentIndex = state.tracks.findIndex(
    (track) => String(track.id) === String(state.currentTrackId)
  );
  const baseIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (baseIndex + direction + state.tracks.length) % state.tracks.length;
  const nextTrack = state.tracks[nextIndex] || null;
  if (!nextTrack?.id) return;

  dispatch("TRACK_SELECTED", { track: nextTrack });
  resolveCurrentTrack(true);
}

function playOrPause() {
  if (state.status === "error") {
    return;
  }

  if (
    state.status === "loading_user_context" ||
    state.status === "loading_library" ||
    state.status === "resolving_audio"
  ) {
    return;
  }

  if (!currentTrack()) {
    return;
  }

  if (!state.audioUrl) {
    resolveCurrentTrack(true);
    return;
  }

  if (state.status === "playing" || state.isAudioElementPlaying) {
    dispatch("PAUSE_REQUESTED");
    setPlaybackDesired(false);
    return;
  }

  dispatch("PLAY_REQUESTED");
  setPlaybackDesired(true);
}

function openTrackLink() {
  const track = currentTrack();
  if (!track?.storeUrl) return;
  window.open(track.storeUrl, "_blank", "noopener,noreferrer");
}

async function initPlayer() {
  dispatch("INIT");

  if (!telegram) {
    console.error("Not in Telegram WebApp context");
    dispatch("DEV_BROWSER_MODE", { message: "Not in Telegram WebApp context" });
    return;
  }

  telegram.ready();
  telegram.expand();

  const initDataRaw = String(telegram.initData ?? "").trim();
  if (!initDataRaw) {
    const token = state.requestToken + 1;
    dispatch("BOOTSTRAP_STARTED", { token, initDataRaw });
    dispatch("BOOTSTRAP_FAILED", {
      token,
      message: "Telegram initData is empty",
    });
    return;
  }

  const token = state.requestToken + 1;
  dispatch("BOOTSTRAP_STARTED", { token, initDataRaw });

  try {
    const session = await bootstrapTelegramSession(initDataRaw);
    if (token !== state.requestToken) return;

    dispatch("BOOTSTRAP_SUCCEEDED", {
      token,
      telegramUserId: session.telegramUserId,
      tracks: session.tracks,
      initDataRaw,
    });
  } catch (error) {
    if (token !== state.requestToken) return;
    dispatch("BOOTSTRAP_FAILED", {
      token,
      message: error?.message || "Не удалось загрузить библиотеку",
    });
  }
}

if (playToggle) playToggle.addEventListener("click", playOrPause);
if (prevBtn) prevBtn.addEventListener("click", () => stepTrack(-1));
if (nextBtn) nextBtn.addEventListener("click", () => stepTrack(1));
if (playlistBtn) playlistBtn.addEventListener("click", openTrackLink);

if (audio) {
  audio.addEventListener("ended", () => {
    dispatch("AUDIO_ENDED");
  });

  audio.addEventListener("pause", () => {
    if (!state.isAudioElementPlaying && state.status !== "playing") return;
    dispatch("AUDIO_PAUSED");
  });

  audio.addEventListener("play", () => {
    if (!state.audioUrl) return;
    dispatch("AUDIO_STARTED");
  });
}

dispatch("INIT");
initPlayer().catch((error) => {
  console.error(error);
  dispatch("BOOTSTRAP_FAILED", {
    token: state.requestToken,
    message: error?.message || "Не удалось загрузить библиотеку",
  });
});
