const API_BASE = "https://eva-player.onrender.com";
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
  dom.playBtn.classList.toggle("is-playing", state.playing);
  dom.playBtn.setAttribute("aria-label", state.playing ? "Пауза" : "Воспроизвести");
  dom.playBtn.querySelector("span").textContent = state.playing ? "||" : ">";
}

function syncButtons() {
  const disabled = state.tracks.length < 2;
  dom.prevBtn.disabled = disabled;
  dom.nextBtn.disabled = disabled;
  dom.prevBtn.style.opacity = disabled ? "0.45" : "1";
  dom.nextBtn.style.opacity = disabled ? "0.45" : "1";
}

function renderTrackList() {
  dom.trackList.innerHTML = "";
  state.tracks.forEach((track, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "library__item";
    button.textContent = `${track.title} · ${formatArtist(track.artist)}`;
    if (index === state.index) button.classList.add("is-active");
    button.addEventListener("click", () => loadTrack(index, true));
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

function render() {
  const track = currentTrack();
  if (!track) {
    dom.trackTitle.textContent = state.userId ? "Треков нет" : "Открой в Telegram";
    dom.trackArtist.textContent = state.userId
      ? "Отправь аудио боту, чтобы оно появилось здесь"
      : "В Telegram Web App пользователь определяется автоматически";
    dom.line1.textContent = "";
    dom.line2Part1.textContent = "";
    dom.line2Part2.textContent = "";
    dom.line3.textContent = "";
    dom.trackList.innerHTML = "";
    syncButtons();
    syncPlayingState();
    renderUserId();
    renderDebug();
    return;
  }

  const [firstIndex, secondIndex, thirdIndex] = visibleTrackIndices();
  const first = state.tracks[firstIndex];
  const second = state.tracks[secondIndex];
  const third = state.tracks[thirdIndex];

  dom.trackTitle.textContent = track.title;
  dom.trackArtist.textContent = formatArtist(track.artist);
  dom.line1.textContent = first ? first.title : "";
  dom.line2Part1.textContent = second ? second.title : "";
  dom.line2Part2.textContent = second ? formatArtist(second.artist) : "";
  dom.line3.textContent = third ? `${third.title} · ${formatArtist(third.artist)}` : "";
  dom.primaryAction.classList.toggle("is-active", state.shuffled);
  dom.secondaryAction.classList.toggle("is-active", state.repeat);
  dom.saveBtn.classList.toggle("is-active", state.savedTracks.includes(track.id));
  syncButtons();
  renderTrackList();
  syncPlayingState();
  renderUserId();
  renderDebug();

  dom.line1.onclick = () => loadTrack(firstIndex, true);
  dom.line2.onclick = () => loadTrack(secondIndex, true);
  dom.line3.onclick = () => loadTrack(thirdIndex, true);
}

async function resolveTrackUrl(trackId) {
  const params = new URLSearchParams({ track_id: trackId });

  if (state.userId) {
    params.set("user_id", state.userId);
  }

  const response = await fetch(`${API_BASE}/tracks/audio?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Не удалось получить ссылку на трек");
  }
  const data = await response.json();
  return data.file_url;
}

async function loadTrack(index, autoplay = false) {
  if (state.tracks.length === 0) return;
  state.index = (index + state.tracks.length) % state.tracks.length;
  const track = currentTrack();

  try {
    const fileUrl = await resolveTrackUrl(track.id);
    audio.src = fileUrl;
    audio.load();
    dom.currentTime.textContent = "0:00";
    dom.duration.textContent = "0:00";
    state.playing = false;
    render();
    if (autoplay) {
      await audio.play();
      state.playing = true;
      syncPlayingState();
    }
  } catch (error) {
    console.error(error);
    state.playing = false;
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
    loadTrack(next, true);
    return;
  }

  loadTrack(state.index + 1, true);
}

function playPreviousTrack() {
  if (state.tracks.length === 0) return;
  loadTrack(state.index - 1, true);
}

function togglePlay() {
  if (!audio.src) return;
  if (audio.paused) {
    audio.play().catch(() => {});
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
  loadTracks().catch((error) => {
    console.error(error);
    dom.trackTitle.textContent = "Ошибка загрузки";
    dom.trackArtist.textContent = "Проверь backend и Telegram token";
  });
}

async function loadTracks() {
  if (!state.userId) {
    state.tracks = [];
    state.index = 0;
    render();
    return;
  }

  const response = await fetch(
    `${API_BASE}/tracks/me?user_id=${encodeURIComponent(state.userId)}`
  );
  if (!response.ok) {
    throw new Error("Не удалось загрузить треки");
  }

  state.tracks = await response.json();
  state.index = 0;
  render();

  if (state.tracks.length > 0) {
    await loadTrack(0, false);
  }
}

dom.playBtn.addEventListener("click", togglePlay);
dom.prevBtn.addEventListener("click", playPreviousTrack);
dom.nextBtn.addEventListener("click", playNextTrack);
dom.primaryAction.addEventListener("click", toggleShuffle);
dom.secondaryAction.addEventListener("click", toggleRepeat);
dom.saveBtn.addEventListener("click", toggleSave);
if (dom.saveUserIdBtn) dom.saveUserIdBtn.addEventListener("click", saveUserId);
if (dom.userIdInput) {
  dom.userIdInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") saveUserId();
  });
}

audio.addEventListener("loadedmetadata", () => {
  dom.duration.textContent = formatTime(audio.duration);
  dom.progress.max = String(audio.duration || 1);
});

audio.addEventListener("timeupdate", () => {
  dom.currentTime.textContent = formatTime(audio.currentTime);
  dom.progress.value = String(audio.currentTime);
});

dom.progress.addEventListener("input", (event) => {
  audio.currentTime = Number(event.target.value);
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
loadTracks().catch((error) => {
  console.error(error);
  dom.trackTitle.textContent = "Ошибка загрузки";
  dom.trackArtist.textContent = "Проверь backend и Telegram token";
});
