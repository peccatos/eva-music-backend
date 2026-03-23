import { fetchTracks, fetchTrackAudioUrl } from "./api.js";

const USER_ID_KEY = "eva_music_user_id";
const telegram = window.Telegram?.WebApp ?? null;
const telegramUserId = telegram?.initDataUnsafe?.user?.id?.toString() ?? "";

const state = {
  isPlaying: false,
  userId: telegramUserId || localStorage.getItem(USER_ID_KEY) || "",
  tracks: [],
  trackIndex: 0,
};

const player = document.getElementById("player");
const audio = document.getElementById("audio");
const playToggle = document.getElementById("playToggle");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const playlistBtn = document.getElementById("playlistBtn");
const trackStatus = document.getElementById("trackStatus");
const trackTitle = document.getElementById("trackTitle");
const trackArtist = document.getElementById("trackArtist");

function currentTrack() {
  return state.tracks[state.trackIndex] || null;
}

function isValidTrack(track) {
  return Boolean(track && typeof track === "object" && String(track.id || "").trim());
}

function setSvgText(node, value) {
  if (node) node.textContent = value;
}

function setArtwork(url) {
  if (!player || !url) return;
  player.style.setProperty("--cover-image", `url("${url}")`);
}

function setPlaying(nextValue) {
  state.isPlaying = nextValue;

  if (player) {
    player.classList.toggle("is-playing", state.isPlaying);
  }

  if (playToggle) {
    playToggle.setAttribute("aria-pressed", String(state.isPlaying));
  }
}

function setStatus(title, artist, status) {
  setSvgText(trackTitle, title);
  setSvgText(trackArtist, artist);
  setSvgText(trackStatus, status);
}

function renderTrack() {
  const track = currentTrack();

  if (!track) {
    const message = state.userId ? "Треков нет" : "Нет userId";
    const submessage = state.userId
      ? "Backend вернул пустой список"
      : "Сохрани eva_music_user_id в localStorage или открой из Telegram";
    setStatus(message, submessage, "Ожидание данных");
    audio.removeAttribute("src");
    audio.load();
    return;
  }

  if (!isValidTrack(track) || !String(track.title || "").trim()) {
    setStatus(
      "Некорректные данные",
      "Backend вернул трек без обязательных полей",
      "Невозможно продолжить"
    );
    audio.removeAttribute("src");
    audio.load();
    return;
  }

  setStatus(track.title, track.artist || "Исполнитель не указан", track.status || "Готово к воспроизведению");
  setArtwork(track.artworkUrl);
}

async function loadCurrentTrack(autoplay = false) {
  const track = currentTrack();
  if (!isValidTrack(track)) {
    throw new Error("Invalid normalized track: missing id");
  }

  setStatus(track.title, track.artist || "Исполнитель не указан", "Загрузка аудио...");

  const fileUrl = await fetchTrackAudioUrl(track.id, state.userId);
  if (!String(fileUrl || "").trim()) {
    throw new Error("Invalid audio URL returned by backend");
  }

  track.previewUrl = fileUrl;
  track.status = autoplay ? "Воспроизведение" : "Готово к воспроизведению";

  audio.src = fileUrl;
  audio.load();
  renderTrack();

  if (autoplay) {
    const playPromise = audio.play();
    setPlaying(true);
    if (playPromise) {
      await playPromise;
    }
  } else {
    setPlaying(false);
  }
}

function restartTrack() {
  audio.currentTime = 0;

  if (state.isPlaying) {
    const playPromise = audio.play();
    if (playPromise) {
      playPromise.catch(() => {
        setPlaying(false);
      });
    }
  }
}

function openTrackLink() {
  const track = currentTrack();
  if (!track?.storeUrl) return;
  window.open(track.storeUrl, "_blank", "noopener,noreferrer");
}

function stepTrack(direction) {
  if (state.tracks.length <= 1) {
    restartTrack();
    return;
  }

  state.trackIndex = (state.trackIndex + direction + state.tracks.length) % state.tracks.length;
  loadCurrentTrack(true).catch(handleError);
}

function playOrPause() {
  if (!audio.src) return;

  if (state.isPlaying) {
    audio.pause();
    setPlaying(false);
    return;
  }

  const playPromise = audio.play();
  setPlaying(true);

  if (playPromise) {
    playPromise.catch(() => {
      setPlaying(false);
    });
  }
}

async function initPlayer() {
  if (!state.userId) {
    renderTrack();
    return;
  }

  try {
    setStatus("Загрузка", "Подключаем backend", "Инициализация...");
    state.tracks = await fetchTracks(state.userId);

    if (state.tracks.some((track) => !isValidTrack(track))) {
      throw new Error("Invalid normalized track: missing id");
    }

    state.trackIndex = 0;
    renderTrack();

    if (state.tracks.length > 0) {
      await loadCurrentTrack(false);
    }
  } catch (error) {
    state.tracks = [];
    state.trackIndex = 0;
    renderTrack();
    throw error;
  }
}

function handleError(error) {
  console.error(error);
  setPlaying(false);
  setStatus("Ошибка загрузки", error?.message || "Проверь backend", "Ошибка");
}

if (playToggle) playToggle.addEventListener("click", playOrPause);
if (prevBtn) prevBtn.addEventListener("click", () => stepTrack(-1));
if (nextBtn) nextBtn.addEventListener("click", () => stepTrack(1));
if (playlistBtn) playlistBtn.addEventListener("click", openTrackLink);

audio.addEventListener("ended", () => {
  setPlaying(false);
});

audio.addEventListener("pause", () => {
  if (audio.currentTime !== 0) {
    setPlaying(false);
  }
});

audio.addEventListener("play", () => {
  setPlaying(true);
});

if (telegram) {
  telegram.ready();
  telegram.expand();
}

initPlayer().catch(handleError);
