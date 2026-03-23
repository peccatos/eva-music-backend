import { fetchTracks, fetchTrackAudioUrl } from "./api.js";

const USER_ID_KEY = "eva_music_user_id";
const telegram = window.Telegram?.WebApp ?? null;
const telegramUserId = telegram?.initDataUnsafe?.user?.id?.toString() ?? "";

const dom = {
  playBtn: document.getElementById("playBtn"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  progress: document.getElementById("progress"),
  currentTime: document.getElementById("currentTime"),
  duration: document.getElementById("duration"),
  trackTitle: document.getElementById("trackTitle"),
  trackArtist: document.getElementById("trackArtist"),
  line1: document.getElementById("line1"),
  line2: document.getElementById("line2"),
  line2Part1: document.getElementById("line2Part1"),
  line2Part2: document.getElementById("line2Part2"),
  line3: document.getElementById("line3"),
  primaryAction: document.getElementById("primaryAction"),
  secondaryAction: document.getElementById("secondaryAction"),
  saveBtn: document.getElementById("saveBtn"),
  trackList: document.getElementById("trackList"),
  telegramDebug: document.getElementById("telegramDebug"),
  userIdInput: document.getElementById("userIdInput"),
  saveUserIdBtn: document.getElementById("saveUserIdBtn"),
};

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
  shuffled: false,
  repeat: false,
  savedTracks: [],
  lastAudioResolveTrackId: null,
  lastResolvedAutoplay: false,
};

const audio = new Audio();
audio.preload = "metadata";

function hasRealTelegramUser() {
  return Boolean(telegram?.initDataUnsafe?.user?.id);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function formatArtist(artist) {
  const value = String(artist || "").trim();
  return value ? value : "Исполнитель не указан";
}

function getCurrentTrackIndex(nextState = state) {
  if (!nextState.currentTrackId) return -1;
  return nextState.tracks.findIndex((track) => String(track.id) === String(nextState.currentTrackId));
}

function getTrackByIndex(nextState, index) {
  if (index < 0 || index >= nextState.tracks.length) return null;
  return nextState.tracks[index] || null;
}

function getNextIndex(nextState, direction) {
  if (nextState.tracks.length === 0) return -1;
  const currentIndex = getCurrentTrackIndex(nextState);
  const baseIndex = currentIndex >= 0 ? currentIndex : 0;
  return (baseIndex + direction + nextState.tracks.length) % nextState.tracks.length;
}

function transition(event, payload = {}) {
  const next = {
    ...state,
    tracks: state.tracks,
    currentTrack: state.currentTrack,
    savedTracks: state.savedTracks,
  };

  switch (event) {
    case "INIT":
      return next;
    case "TRACKS_LOAD_STARTED":
      return {
        ...next,
        status: "loading_tracks",
        errorMessage: null,
        requestToken: payload.token,
        isAudioElementPlaying: false,
      };
    case "TRACKS_LOAD_SUCCEEDED": {
      if (payload.token !== state.requestToken) return state;
      const tracks = Array.isArray(payload.tracks) ? payload.tracks : [];
      const firstTrack = tracks[0] || null;
      const currentTrackId = firstTrack?.id ? String(firstTrack.id) : null;
      return {
        ...next,
        status: tracks.length > 0 ? "ready" : "idle",
        tracks,
        currentTrackId,
        currentTrack: firstTrack,
        audioUrl: null,
        errorMessage: null,
        isAudioElementPlaying: false,
      };
    }
    case "TRACKS_LOAD_FAILED":
      if (payload.token !== state.requestToken) return state;
      return {
        ...next,
        status: "error",
        tracks: [],
        currentTrackId: null,
        currentTrack: null,
        audioUrl: null,
        errorMessage: payload.message || "Не удалось загрузить треки",
        isAudioElementPlaying: false,
      };
    case "TRACK_SELECTED": {
      const track = payload.track || null;
      if (!track) return next;
      return {
        ...next,
        status: state.tracks.length > 0 ? "ready" : "idle",
        currentTrackId: track.id ? String(track.id) : null,
        currentTrack: track,
        audioUrl: null,
        errorMessage: null,
        isAudioElementPlaying: false,
      };
    }
    case "AUDIO_RESOLVE_STARTED":
      return {
        ...next,
        status: "resolving_audio",
        currentTrackId: payload.trackId ? String(payload.trackId) : state.currentTrackId,
        currentTrack: payload.track || state.currentTrack,
        audioUrl: null,
        errorMessage: null,
        requestToken: payload.token,
        isAudioElementPlaying: false,
        lastAudioResolveTrackId: payload.trackId ? String(payload.trackId) : state.lastAudioResolveTrackId,
        lastResolvedAutoplay: Boolean(payload.autoplay),
      };
    case "AUDIO_RESOLVE_SUCCEEDED":
      if (payload.token !== state.requestToken) return state;
      return {
        ...next,
        status: payload.autoplay ? "playing" : "paused",
        currentTrackId: payload.trackId ? String(payload.trackId) : state.currentTrackId,
        currentTrack: payload.track || state.currentTrack,
        audioUrl: payload.audioUrl || null,
        errorMessage: null,
        isAudioElementPlaying: Boolean(payload.autoplay),
        lastAudioResolveTrackId: payload.trackId ? String(payload.trackId) : state.lastAudioResolveTrackId,
        lastResolvedAutoplay: Boolean(payload.autoplay),
      };
    case "AUDIO_RESOLVE_FAILED":
      if (payload.token !== state.requestToken) return state;
      return {
        ...next,
        status: "error",
        audioUrl: null,
        errorMessage: payload.message || "Не удалось получить ссылку на аудио",
        isAudioElementPlaying: false,
      };
    case "PLAY_REQUESTED":
      if (!state.currentTrackId || !state.audioUrl) return next;
      return {
        ...next,
        status: "playing",
        errorMessage: null,
      };
    case "PAUSE_REQUESTED":
      return {
        ...next,
        status: state.tracks.length > 0 ? "paused" : "idle",
        isAudioElementPlaying: false,
      };
    case "AUDIO_STARTED":
      return {
        ...next,
        status: state.currentTrackId && state.audioUrl ? "playing" : state.status,
        isAudioElementPlaying: true,
      };
    case "AUDIO_PAUSED":
      return {
        ...next,
        status: state.tracks.length > 0 ? "paused" : "idle",
        isAudioElementPlaying: false,
      };
    case "AUDIO_ENDED":
      return {
        ...next,
        status: state.tracks.length > 0 ? "paused" : "ready",
        isAudioElementPlaying: false,
      };
    case "RESET_ERROR":
      return {
        ...next,
        status: state.tracks.length > 0 ? "ready" : "idle",
        errorMessage: null,
      };
    case "TOGGLE_SHUFFLE":
      return { ...next, shuffled: !state.shuffled };
    case "TOGGLE_REPEAT":
      return { ...next, repeat: !state.repeat };
    case "TOGGLE_SAVE": {
      const trackId = state.currentTrackId;
      if (!trackId) return next;
      const exists = state.savedTracks.includes(trackId);
      return {
        ...next,
        savedTracks: exists
          ? state.savedTracks.filter((item) => item !== trackId)
          : [...state.savedTracks, trackId],
      };
    }
    case "SET_USER_ID":
      return {
        ...next,
        userId: payload.userId || "",
        errorMessage: null,
      };
    default:
      return next;
  }
}

function dispatch(event, payload = {}) {
  const previous = { ...state };
  const nextState = transition(event, payload);
  Object.assign(state, nextState);
  render();
  return { previous, nextState: state };
}

function renderUserId() {
  if (dom.userIdInput) {
    dom.userIdInput.value = state.userId;
    dom.userIdInput.disabled = hasRealTelegramUser();
  }

  if (dom.saveUserIdBtn) {
    dom.saveUserIdBtn.disabled = hasRealTelegramUser();
  }
}

function renderDebug() {
  if (!dom.telegramDebug) return;

  dom.telegramDebug.textContent = JSON.stringify(
    {
      telegramPresent: Boolean(telegram),
      initData: telegram?.initData ?? null,
      initDataUnsafe: telegram?.initDataUnsafe ?? null,
      telegramUserId,
      effectiveUserId: state.userId,
      hasRealTelegramUser: hasRealTelegramUser(),
      status: state.status,
      requestToken: state.requestToken,
    },
    null,
    2
  );
}

function setAudioPlaybackDesired(isPlaying) {
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

function syncAudioSource() {
  if (state.audioUrl && audio.src !== state.audioUrl) {
    audio.src = state.audioUrl;
    audio.load();
  }
}

function renderEmptyState() {
  if (dom.trackTitle) {
    dom.trackTitle.textContent = state.userId ? "Треков нет" : "Открой в Telegram";
  }

  if (dom.trackArtist) {
    dom.trackArtist.textContent = state.userId
      ? "Отправь аудио боту, чтобы оно появилось здесь"
      : "В Telegram Web App пользователь определяется автоматически";
  }

  if (dom.line1) dom.line1.textContent = "";
  if (dom.line2Part1) dom.line2Part1.textContent = "";
  if (dom.line2Part2) dom.line2Part2.textContent = "";
  if (dom.line3) dom.line3.textContent = "";
  if (dom.trackList) dom.trackList.innerHTML = "";
  if (dom.currentTime) dom.currentTime.textContent = "0:00";
  if (dom.duration) dom.duration.textContent = "0:00";
  if (dom.progress) dom.progress.value = "0";
  if (dom.progress) dom.progress.max = "1";
  renderUserId();
  renderDebug();
}

function render() {
  const track = state.currentTrack;
  const currentIndex = getCurrentTrackIndex();
  const first = getTrackByIndex(state, getNextIndex(state, 0));
  const second = getTrackByIndex(state, getNextIndex(state, 1));
  const third = getTrackByIndex(state, getNextIndex(state, 2));

  document.body.classList.toggle("is-playing", state.status === "playing");

  if (dom.playBtn) {
    dom.playBtn.classList.toggle("is-playing", state.status === "playing");
    dom.playBtn.setAttribute("aria-label", state.status === "playing" ? "Пауза" : "Воспроизвести");
    const icon = dom.playBtn.querySelector("span");
    if (icon) icon.textContent = state.status === "playing" ? "||" : ">";
  }

  if (dom.prevBtn) {
    const disabled = state.tracks.length < 2 || state.status === "loading_tracks" || state.status === "resolving_audio";
    dom.prevBtn.disabled = disabled;
    dom.prevBtn.style.opacity = disabled ? "0.45" : "1";
  }

  if (dom.nextBtn) {
    const disabled = state.tracks.length < 2 || state.status === "loading_tracks" || state.status === "resolving_audio";
    dom.nextBtn.disabled = disabled;
    dom.nextBtn.style.opacity = disabled ? "0.45" : "1";
  }

  if (!track) {
    renderEmptyState();
    return;
  }

  if (dom.trackTitle) dom.trackTitle.textContent = state.status === "resolving_audio" ? "Загрузка аудио..." : track.title;
  if (dom.trackArtist) dom.trackArtist.textContent = formatArtist(track.artist);
  if (dom.line1) dom.line1.textContent = first ? first.title : "";
  if (dom.line2Part1) dom.line2Part1.textContent = second ? second.title : "";
  if (dom.line2Part2) dom.line2Part2.textContent = second ? formatArtist(second.artist) : "";
  if (dom.line3) dom.line3.textContent = third ? `${third.title} · ${formatArtist(third.artist)}` : "";
  if (dom.primaryAction) dom.primaryAction.classList.toggle("is-active", state.shuffled);
  if (dom.secondaryAction) dom.secondaryAction.classList.toggle("is-active", state.repeat);
  if (dom.saveBtn) dom.saveBtn.classList.toggle("is-active", state.savedTracks.includes(track.id));
  if (dom.trackList) {
    dom.trackList.innerHTML = "";
    state.tracks.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "library__item";
      button.textContent = `${item.title} · ${formatArtist(item.artist)}`;
      if (index === currentIndex) button.classList.add("is-active");
      button.addEventListener("click", () => selectTrack(index, true));
      dom.trackList.appendChild(button);
    });
  }

  if (dom.currentTime && audio.currentTime >= 0) dom.currentTime.textContent = formatTime(audio.currentTime);
  if (dom.duration && Number.isFinite(audio.duration)) dom.duration.textContent = formatTime(audio.duration);
  if (dom.progress) {
    dom.progress.max = String(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 1);
    dom.progress.value = String(audio.currentTime || 0);
  }

  renderUserId();
  renderDebug();
  syncAudioSource();
}

async function resolveAudioForCurrentTrack(autoplay = false) {
  if (!state.currentTrackId || !state.currentTrack) return;
  if (state.status === "resolving_audio") return;

  const token = state.requestToken + 1;
  dispatch("AUDIO_RESOLVE_STARTED", {
    token,
    trackId: state.currentTrackId,
    track: state.currentTrack,
    autoplay,
  });

  try {
    const audioUrl = await fetchTrackAudioUrl(state.currentTrackId);
    if (token !== state.requestToken) return;
    if (!String(audioUrl || "").trim()) {
      throw new Error("Invalid audio URL returned by backend");
    }
    dispatch("AUDIO_RESOLVE_SUCCEEDED", {
      token,
      trackId: state.currentTrackId,
      track: state.currentTrack,
      audioUrl,
      autoplay,
    });
    if (autoplay) {
      setAudioPlaybackDesired(true);
    }
  } catch (error) {
    if (token !== state.requestToken) return;
    dispatch("AUDIO_RESOLVE_FAILED", {
      token,
      message: error?.message || "Не удалось получить ссылку на аудио",
    });
  }
}

function selectTrack(index, autoplay = false) {
  if (state.tracks.length === 0) return;
  if (state.status === "loading_tracks" || state.status === "resolving_audio") return;

  const normalizedIndex = (index + state.tracks.length) % state.tracks.length;
  const track = state.tracks[normalizedIndex] || null;
  if (!track?.id) return;

  dispatch("TRACK_SELECTED", { track });
  resolveAudioForCurrentTrack(autoplay).catch(handleLoadError);
}

function playNextTrack() {
  if (state.tracks.length === 0) return;
  if (state.shuffled && state.tracks.length > 1) {
    let next = getCurrentTrackIndex();
    while (next === getCurrentTrackIndex()) {
      next = Math.floor(Math.random() * state.tracks.length);
    }
    selectTrack(next, true);
    return;
  }

  selectTrack(getNextIndex(state, 1), true);
}

function playPreviousTrack() {
  if (state.tracks.length === 0) return;
  selectTrack(getNextIndex(state, -1), true);
}

function togglePlay() {
  if (state.status === "error") {
    dispatch("RESET_ERROR");
    return;
  }

  if (!state.currentTrackId) return;

  if (state.status === "playing" || state.isAudioElementPlaying) {
    dispatch("PAUSE_REQUESTED");
    setAudioPlaybackDesired(false);
    return;
  }

  dispatch("PLAY_REQUESTED");
  if (!state.audioUrl) {
    resolveAudioForCurrentTrack(true).catch(handleLoadError);
    return;
  }

  setAudioPlaybackDesired(true);
}

function toggleShuffle() {
  dispatch("TOGGLE_SHUFFLE");
}

function toggleRepeat() {
  dispatch("TOGGLE_REPEAT");
  audio.loop = state.repeat;
}

function toggleSave() {
  dispatch("TOGGLE_SAVE");
}

function saveUserId() {
  if (hasRealTelegramUser()) return;
  const value = (dom.userIdInput?.value || "").trim();
  if (!value) return;
  localStorage.setItem(USER_ID_KEY, value);
  dispatch("SET_USER_ID", { userId: value });
  loadTracks().catch(handleLoadError);
}

function handleLoadError(error) {
  console.error(error);
  dispatch("TRACKS_LOAD_FAILED", {
    token: state.requestToken,
    message: error?.message || "Проверь backend и Telegram token",
  });
}

async function loadTracks() {
  if (!state.userId) {
    dispatch("TRACKS_LOAD_SUCCEEDED", { token: state.requestToken + 1, tracks: [] });
    return;
  }

  const token = state.requestToken + 1;
  dispatch("TRACKS_LOAD_STARTED", { token });

  try {
    const tracks = await fetchTracks(state.userId);
    if (token !== state.requestToken) return;
    dispatch("TRACKS_LOAD_SUCCEEDED", { token, tracks });
    if (tracks.length > 0) {
      await resolveAudioForCurrentTrack(false);
    }
  } catch (error) {
    if (token !== state.requestToken) return;
    dispatch("TRACKS_LOAD_FAILED", {
      token,
      message: error?.message || "Не удалось загрузить треки",
    });
  }
}

if (dom.playBtn) dom.playBtn.addEventListener("click", togglePlay);
if (dom.prevBtn) dom.prevBtn.addEventListener("click", playPreviousTrack);
if (dom.nextBtn) dom.nextBtn.addEventListener("click", playNextTrack);
if (dom.primaryAction) dom.primaryAction.addEventListener("click", toggleShuffle);
if (dom.secondaryAction) dom.secondaryAction.addEventListener("click", toggleRepeat);
if (dom.saveBtn) dom.saveBtn.addEventListener("click", toggleSave);
if (dom.saveUserIdBtn) dom.saveUserIdBtn.addEventListener("click", saveUserId);
if (dom.userIdInput) {
  dom.userIdInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") saveUserId();
  });
}

if (dom.progress) {
  dom.progress.addEventListener("input", (event) => {
    audio.currentTime = Number(event.target.value);
  });
}

audio.addEventListener("loadedmetadata", () => {
  if (dom.duration) dom.duration.textContent = formatTime(audio.duration);
  if (dom.progress) dom.progress.max = String(audio.duration || 1);
});

audio.addEventListener("timeupdate", () => {
  if (dom.currentTime) dom.currentTime.textContent = formatTime(audio.currentTime);
  if (dom.progress) dom.progress.value = String(audio.currentTime);
});

audio.addEventListener("play", () => {
  dispatch("AUDIO_STARTED");
});

audio.addEventListener("pause", () => {
  dispatch("AUDIO_PAUSED");
});

audio.addEventListener("ended", () => {
  dispatch("AUDIO_ENDED");
  if (!state.repeat) {
    playNextTrack();
  }
});

if (telegram) {
  telegram.ready();
  telegram.expand();
}

dispatch("INIT");
audio.loop = state.repeat;
loadTracks().catch(handleLoadError);
