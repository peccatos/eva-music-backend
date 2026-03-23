import { fetchTracks, fetchTrackAudioUrl } from "./api.js";

const USER_ID_KEY = "eva_music_user_id";

const telegram = window.Telegram?.WebApp ?? null;
const telegramUserId = telegram?.initDataUnsafe?.user?.id?.toString() ?? "";

const state = {
  tracks: [],
  index: 0,
  shuffled: false,
  repeat: false,
  savedTracks: [],
  playing: false,
  userId: telegramUserId || localStorage.getItem(USER_ID_KEY) || "",
};

const audio = new Audio();
audio.preload = "metadata";

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

function currentTrack() {
  return state.tracks[state.index] || null;
}

function visibleTrackIndices() {
  const total = state.tracks.length;
  if (total === 0) return [];
  return [0, 1, 2].map((offset) => (state.index + offset) % total);
}

function syncPlayingState() {
  document.body.classList.toggle("is-playing", state.playing);

  if (dom.playBtn) {
    dom.playBtn.classList.toggle("is-playing", state.playing);
    dom.playBtn.setAttribute("aria-label", state.playing ? "Пауза" : "Воспроизвести");
    const icon = dom.playBtn.querySelector("span");
    if (icon) icon.textContent = state.playing ? "||" : ">";
  }
}

function syncButtons() {
  const disabled = state.tracks.length < 2;

  if (dom.prevBtn) {
    dom.prevBtn.disabled = disabled;
    dom.prevBtn.style.opacity = disabled ? "0.45" : "1";
  }

  if (dom.nextBtn) {
    dom.nextBtn.disabled = disabled;
    dom.nextBtn.style.opacity = disabled ? "0.45" : "1";
  }
}

function renderTrackList() {
  if (!dom.trackList) return;

  dom.trackList.innerHTML = "";
  state.tracks.forEach((track, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "library__item";
    button.textContent = `${track.title} · ${formatArtist(track.artist)}`;
    if (index === state.index) button.classList.add("is-active");
    button.addEventListener("click", () => {
      loadTrack(index, true).catch(handleLoadError);
    });
    dom.trackList.appendChild(button);
  });
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
    },
    null,
    2
  );
}

function setEmptyState() {
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
  syncButtons();
  syncPlayingState();
  renderUserId();
  renderDebug();
}

function render() {
  const track = currentTrack();

  if (!track) {
    setEmptyState();
    return;
  }

  const [firstIndex, secondIndex, thirdIndex] = visibleTrackIndices();
  const first = state.tracks[firstIndex];
  const second = state.tracks[secondIndex];
  const third = state.tracks[thirdIndex];

  if (dom.trackTitle) dom.trackTitle.textContent = track.title;
  if (dom.trackArtist) dom.trackArtist.textContent = formatArtist(track.artist);
  if (dom.line1) dom.line1.textContent = first ? first.title : "";
  if (dom.line2Part1) dom.line2Part1.textContent = second ? second.title : "";
  if (dom.line2Part2) dom.line2Part2.textContent = second ? formatArtist(second.artist) : "";
  if (dom.line3) dom.line3.textContent = third ? `${third.title} · ${formatArtist(third.artist)}` : "";
  if (dom.primaryAction) dom.primaryAction.classList.toggle("is-active", state.shuffled);
  if (dom.secondaryAction) dom.secondaryAction.classList.toggle("is-active", state.repeat);
  if (dom.saveBtn) dom.saveBtn.classList.toggle("is-active", state.savedTracks.includes(track.id));

  syncButtons();
  renderTrackList();
  syncPlayingState();
  renderUserId();
  renderDebug();

  if (dom.line1) dom.line1.onclick = () => loadTrack(firstIndex, true).catch(handleLoadError);
  if (dom.line2) dom.line2.onclick = () => loadTrack(secondIndex, true).catch(handleLoadError);
  if (dom.line3) dom.line3.onclick = () => loadTrack(thirdIndex, true).catch(handleLoadError);
}

function handleLoadError(error) {
  console.error(error);
  state.playing = false;
  syncPlayingState();
  if (dom.trackTitle) dom.trackTitle.textContent = "Ошибка загрузки";
  if (dom.trackArtist) {
    dom.trackArtist.textContent = error?.message || "Проверь backend и Telegram token";
  }
  if (dom.line1) dom.line1.textContent = "";
  if (dom.line2Part1) dom.line2Part1.textContent = "";
  if (dom.line2Part2) dom.line2Part2.textContent = "";
  if (dom.line3) dom.line3.textContent = "";
  if (dom.trackList) dom.trackList.innerHTML = "";
}

async function resolveTrackUrl(trackId) {
  return fetchTrackAudioUrl(trackId, state.userId);
}

async function loadTrack(index, autoplay = false) {
  if (state.tracks.length === 0) return;

  state.index = (index + state.tracks.length) % state.tracks.length;
  const track = currentTrack();

  if (!track?.id) {
    throw new Error("Invalid normalized track: missing id");
  }

  const fileUrl = await resolveTrackUrl(track.id);
  if (!String(fileUrl).trim()) {
    throw new Error("Invalid audio URL returned by backend");
  }
  audio.src = fileUrl;
  audio.load();
  if (dom.currentTime) dom.currentTime.textContent = "0:00";
  if (dom.duration) dom.duration.textContent = "0:00";
  state.playing = false;
  render();

  if (autoplay) {
    await audio.play();
    state.playing = true;
    syncPlayingState();
  }
}

function playNextTrack() {
  if (state.tracks.length === 0) return;

  if (state.shuffled && state.tracks.length > 1) {
    let next = state.index;
    while (next === state.index) {
      next = Math.floor(Math.random() * state.tracks.length);
    }
    loadTrack(next, true).catch(handleLoadError);
    return;
  }

  loadTrack(state.index + 1, true).catch(handleLoadError);
}

function playPreviousTrack() {
  if (state.tracks.length === 0) return;
  loadTrack(state.index - 1, true).catch(handleLoadError);
}

function togglePlay() {
  if (!audio.src) return;

  if (audio.paused) {
    audio.play().catch(handleLoadError);
    state.playing = true;
  } else {
    audio.pause();
    state.playing = false;
  }

  syncPlayingState();
}

function toggleShuffle() {
  state.shuffled = !state.shuffled;
  render();
}

function toggleRepeat() {
  state.repeat = !state.repeat;
  audio.loop = state.repeat;
  render();
}

function toggleSave() {
  const track = currentTrack();
  if (!track) return;

  const exists = state.savedTracks.includes(track.id);
  state.savedTracks = exists
    ? state.savedTracks.filter((item) => item !== track.id)
    : [...state.savedTracks, track.id];

  render();
}

function saveUserId() {
  if (hasRealTelegramUser()) return;

  const value = (dom.userIdInput?.value || "").trim();
  if (!value) return;

  state.userId = value;
  localStorage.setItem(USER_ID_KEY, value);
  loadTracks().catch(handleLoadError);
}

async function loadTracks() {
  if (!state.userId) {
    state.tracks = [];
    state.index = 0;
    render();
    return;
  }

  try {
    state.tracks = await fetchTracks(state.userId);
    state.index = 0;
    render();

    if (state.tracks.length > 0) {
      await loadTrack(0, false);
    }
  } catch (error) {
    state.tracks = [];
    state.index = 0;
    throw error;
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

audio.addEventListener("ended", () => {
  state.playing = false;
  syncPlayingState();
  if (!state.repeat) {
    playNextTrack();
  }
});

if (telegram) {
  telegram.ready();
  telegram.expand();
}

render();
renderDebug();
loadTracks().catch(handleLoadError);
