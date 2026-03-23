export const initialPlayerState = Object.freeze({
  tracks: [],
  index: 0,
  shuffled: false,
  repeat: false,
  savedTracks: [],
  playing: false,
  userId: "",
});

export function createPlayerState(overrides = {}) {
  return {
    ...initialPlayerState,
    ...overrides,
    tracks: Array.isArray(overrides.tracks) ? [...overrides.tracks] : [],
    savedTracks: Array.isArray(overrides.savedTracks) ? [...overrides.savedTracks] : [],
  };
}

export function currentTrack(state) {
  return state.tracks[state.index] || null;
}

export function visibleTrackIndices(state) {
  const total = state.tracks.length;
  if (total === 0) return [];
  return [0, 1, 2].map((offset) => (state.index + offset) % total);
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

export function formatArtist(artist) {
  const value = String(artist || "").trim();
  return value || "Исполнитель не указан";
}

export function reducePlayer(state, event) {
  switch (event.type) {
    case "tracks_loaded":
      return {
        ...state,
        tracks: Array.isArray(event.tracks) ? [...event.tracks] : [],
        index: 0,
        playing: false,
      };

    case "track_selected": {
      if (state.tracks.length === 0) return state;
      const index = normalizeIndex(event.index, state.tracks.length);
      return {
        ...state,
        index,
        playing: Boolean(event.autoplay),
      };
    }

    case "toggle_play":
      if (!state.tracks.length) return state;
      return {
        ...state,
        playing: !state.playing,
      };

    case "play":
      return {
        ...state,
        playing: true,
      };

    case "pause":
      return {
        ...state,
        playing: false,
      };

    case "toggle_shuffle":
      return {
        ...state,
        shuffled: !state.shuffled,
      };

    case "toggle_repeat":
      return {
        ...state,
        repeat: !state.repeat,
      };

    case "toggle_save": {
      const track = currentTrack(state);
      if (!track) return state;
      const exists = state.savedTracks.includes(track.id);
      return {
        ...state,
        savedTracks: exists
          ? state.savedTracks.filter((item) => item !== track.id)
          : [...state.savedTracks, track.id],
      };
    }

    case "user_id_set":
      return {
        ...state,
        userId: String(event.userId || "").trim(),
      };

    default:
      return state;
  }
}

export function nextTrackIndex(state) {
  const total = state.tracks.length;
  if (total === 0) return null;
  if (!state.shuffled || total === 1) {
    return normalizeIndex(state.index + 1, total);
  }
  return nextDeterministicShuffleIndex(state);
}

export function previousTrackIndex(state) {
  const total = state.tracks.length;
  if (total === 0) return null;
  return normalizeIndex(state.index - 1, total);
}

function normalizeIndex(index, total) {
  return ((index % total) + total) % total;
}

function nextDeterministicShuffleIndex(state) {
  const order = state.tracks
    .map((track, index) => ({
      index,
      key: `${track.id || ""}:${track.title || ""}:${track.artist || ""}`.toLowerCase(),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));

  const currentPosition = order.findIndex((entry) => entry.index === state.index);
  if (currentPosition === -1) {
    return normalizeIndex(state.index + 1, state.tracks.length);
  }

  return order[(currentPosition + 1) % order.length].index;
}
