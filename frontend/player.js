import { fetchTracks, fetchTrackAudioUrl } from "./api.js";

const USER_ID_KEY = "eva_music_user_id";
const telegram = window.Telegram?.WebApp ?? null;
const telegramUserId = telegram?.initDataUnsafe?.user?.id?.toString() ?? "";

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
  status: "idle",
  userId: telegramUserId || localStorage.getItem(USER_ID_KEY) || "",
  tracks: [],
  currentTrackId: null,
  currentTrack: null,
  audioUrl: null,
  errorMessage: null,
  requestToken: 0,
  isAudioElementPlaying: false,
};

function currentTrack() {
  return state.currentTrack;
}

function isValidTrack(track) {
  return Boolean(track && typeof track === "object" && String(track.id || "").trim());
}

function transition(event, payload = {}) {
  switch (event) {
    case "INIT":
      return { ...state };
    case "TRACKS_LOAD_STARTED":
      return {
        ...state,
        status: "loading_tracks",
        errorMessage: null,
        requestToken: payload.token,
        isAudioElementPlaying: false,
      };
    case "TRACKS_LOAD_SUCCEEDED":
      if (payload.token !== state.requestToken) return state;
      return {
        ...state,
        status: payload.tracks.length > 0 ? "ready" : "idle",
        tracks: payload.tracks,
        currentTrackId: payload.tracks[0]?.id ? String(payload.tracks[0].id) : null,
        currentTrack: payload.tracks[0] || null,
        audioUrl: null,
        errorMessage: null,
        isAudioElementPlaying: false,
      };
    case "TRACKS_LOAD_FAILED":
      if (payload.token !== state.requestToken) return state;
      return {
        ...state,
        status: "error",
        tracks: [],
        currentTrackId: null,
        currentTrack: null,
        audioUrl: null,
        errorMessage: payload.message || "Не удалось загрузить треки",
        isAudioElementPlaying: false,
      };
    case "TRACK_SELECTED":
      return {
        ...state,
        status: state.tracks.length > 0 ? "ready" : "idle",
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
        status: payload.autoplay ? "playing" : "paused",
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
        status: state.tracks.length > 0 ? "paused" : "idle",
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
        status: state.tracks.length > 0 ? "paused" : "idle",
        isAudioElementPlaying: false,
      };
    case "AUDIO_ENDED":
      return {
        ...state,
        status: state.tracks.length > 0 ? "paused" : "ready",
        isAudioElementPlaying: false,
      };
    case "RESET_ERROR":
      return {
        ...state,
        status: state.tracks.length > 0 ? "ready" : "idle",
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
  if (!player || !url) return;
  player.style.setProperty("--cover-image", `url("${url}")`);
}

function syncAudioSource() {
  if (state.audioUrl && audio && audio.src !== state.audioUrl) {
    audio.src = state.audioUrl;
    audio.load();
  }
}

function renderFallback(message, submessage, status) {
  setSvgText(trackTitle, message);
  setSvgText(trackArtist, submessage);
  setSvgText(trackStatus, status);
  if (audio) {
    audio.removeAttribute("src");
    audio.load();
  }
}

function renderTrack() {
  const track = currentTrack();

  if (!track) {
    renderFallback(
      state.userId ? "Треков нет" : "Нет userId",
      state.userId ? "Backend вернул пустой список" : "Сохрани eva_music_user_id в localStorage или открой из Telegram",
      "Ожидание данных"
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
  setSvgText(trackStatus, state.status === "resolving_audio" ? "Загрузка аудио..." : track.status || "Готово к воспроизведению");
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

  return fetchTrackAudioUrl(track.id)
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
  if (state.tracks.length <= 1) {
    if (state.isAudioElementPlaying) {
      audio.currentTime = 0;
      setPlaybackDesired(true);
    }
    return;
  }

  const nextIndex = (state.tracks.findIndex((track) => String(track.id) === String(state.currentTrackId)) + direction + state.tracks.length) % state.tracks.length;
  const nextTrack = state.tracks[nextIndex] || null;
  if (!nextTrack?.id) return;

  dispatch("TRACK_SELECTED", { track: nextTrack });
  resolveCurrentTrack(true);
}

function playOrPause() {
  if (state.status === "error") {
    dispatch("RESET_ERROR");
    return;
  }

  if (!audio.src) {
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
  if (!state.userId) {
    dispatch("INIT");
    return;
  }

  const token = state.requestToken + 1;
  dispatch("TRACKS_LOAD_STARTED", { token });

  try {
    const tracks = await fetchTracks(state.userId);
    if (token !== state.requestToken) return;
    if (tracks.some((track) => !isValidTrack(track))) {
      throw new Error("Invalid normalized track: missing id");
    }

    dispatch("TRACKS_LOAD_SUCCEEDED", { token, tracks });
    if (tracks.length > 0) {
      await resolveCurrentTrack(false);
    }
  } catch (error) {
    if (token !== state.requestToken) return;
    dispatch("TRACKS_LOAD_FAILED", {
      token,
      message: error?.message || "Проверь backend",
    });
  }
}

function handleError(error) {
  console.error(error);
  dispatch("AUDIO_RESOLVE_FAILED", {
    token: state.requestToken,
    message: error?.message || "Проверь backend",
  });
}

if (playToggle) playToggle.addEventListener("click", playOrPause);
if (prevBtn) prevBtn.addEventListener("click", () => stepTrack(-1));
if (nextBtn) nextBtn.addEventListener("click", () => stepTrack(1));
if (playlistBtn) playlistBtn.addEventListener("click", openTrackLink);

audio.addEventListener("ended", () => {
  dispatch("AUDIO_ENDED");
});

audio.addEventListener("pause", () => {
  dispatch("AUDIO_PAUSED");
});

audio.addEventListener("play", () => {
  dispatch("AUDIO_STARTED");
});

if (telegram) {
  telegram.ready();
  telegram.expand();
}

dispatch("INIT");
initPlayer().catch(handleError);
