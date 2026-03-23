export const API_BASE = "https://eva-player.onrender.com";

function buildUrl(path, params) {
  const url = new URL(path, API_BASE);

  if (params && typeof params === "object") {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }

  return url.toString();
}

async function requestJson(path, params) {
  const response = await fetch(buildUrl(path, params), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return response.json();
}

function requireNonEmptyString(value, fieldName) {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }

  return normalized;
}

function normalizeTrack(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const id = raw.id ?? raw.track_id ?? "";
  const title = raw.title ?? raw.name ?? "";
  const artist =
    raw.artist ??
    raw.author ??
    raw.creator ??
    raw.artist_name ??
    raw.performer ??
    "";
  const artworkUrl =
    raw.artworkUrl ??
    raw.artwork_url ??
    raw.coverUrl ??
    raw.cover_url ??
    "";
  const storeUrl =
    raw.storeUrl ??
    raw.store_url ??
    raw.appleMusicUrl ??
    raw.apple_music_url ??
    raw.url ??
    "";

  return {
    id: String(id).trim(),
    title: String(title).trim() || "Без названия",
    artist: String(artist).trim() || "Исполнитель не указан",
    artworkUrl: String(artworkUrl).trim(),
    storeUrl: String(storeUrl).trim(),
  };
}

function assertTracksResponse(data) {
  const list = Array.isArray(data) ? data : data?.tracks;

  if (!Array.isArray(list)) {
    throw new Error(
      "Invalid backend response from /tracks/me: expected an array or { tracks: [] }"
    );
  }

  return list;
}

function assertAudioResponse(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid backend response from /tracks/audio: expected an object");
  }

  const fileUrl = data.file_url ?? data.audio_url ?? data.url ?? "";
  if (!String(fileUrl).trim()) {
    throw new Error(
      "Invalid backend response from /tracks/audio: expected file_url, audio_url, or url"
    );
  }

  return String(fileUrl).trim();
}

export async function fetchTracks(userId) {
  requireNonEmptyString(userId, "userId");

  const payload = await requestJson("/tracks/me", { user_id: userId });
  const list = assertTracksResponse(payload);
  const normalized = list.map(normalizeTrack).filter(Boolean);

  if (normalized.length !== list.length) {
    throw new Error("Invalid backend response from /tracks/me: malformed track entries found");
  }

  return normalized;
}

export async function fetchTrackAudioUrl(trackId, userId) {
  requireNonEmptyString(trackId, "trackId");

  const payload = await requestJson("/tracks/audio", {
    track_id: trackId,
    user_id: userId,
  });

  return assertAudioResponse(payload);
}

export { buildUrl, normalizeTrack, assertTracksResponse, assertAudioResponse };
