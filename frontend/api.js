const LOCAL_API_BASE = "http://localhost:3001";
const TELEGRAM_INIT_DATA_HEADER = "X-Telegram-Init-Data";

export function resolveApiBase(locationLike = globalThis.location) {
  const origin = String(locationLike?.origin ?? "").trim();

  if (origin.startsWith("http://") || origin.startsWith("https://")) {
    return origin;
  }

  return LOCAL_API_BASE;
}

export const API_BASE = resolveApiBase();

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

async function requestJson(path, { method = "GET", params, headers, body } = {}) {
  const finalHeaders = {
    Accept: "application/json",
    ...(headers || {}),
  };

  let requestBody;
  if (body !== undefined && body !== null) {
    finalHeaders["Content-Type"] = "application/json";
    requestBody = typeof body === "string" ? body : JSON.stringify(body);
  }

  const response = await fetch(buildUrl(path, params), {
    method,
    headers: finalHeaders,
    body: requestBody,
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

function assertBootstrapResponse(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid backend response from /auth/telegram: expected an object");
  }

  const telegramUserId = data.telegram_user_id ?? data.telegramUserId ?? "";
  const tracks = Array.isArray(data.tracks)
    ? data.tracks
    : Array.isArray(data.library)
      ? data.library
      : null;

  if (!String(telegramUserId).trim()) {
    throw new Error("Invalid backend response from /auth/telegram: missing telegram_user_id");
  }

  if (!Array.isArray(tracks)) {
    throw new Error("Invalid backend response from /auth/telegram: expected tracks array");
  }

  return {
    telegramUserId: String(telegramUserId).trim(),
    tracks,
  };
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

function normalizeTrackArray(list, endpointName) {
  const normalized = list.map(normalizeTrack).filter(Boolean);

  if (normalized.length !== list.length) {
    throw new Error(`Invalid backend response from ${endpointName}: malformed track entries found`);
  }

  return normalized;
}

function normalizeBootstrapResponse(data) {
  const { telegramUserId, tracks } = assertBootstrapResponse(data);

  return {
    telegramUserId,
    tracks: normalizeTrackArray(tracks, "/auth/telegram"),
  };
}

export async function bootstrapTelegramSession(initDataRaw) {
  const normalizedInitData = requireNonEmptyString(initDataRaw, "initDataRaw");

  const payload = await requestJson("/auth/telegram", {
    method: "POST",
    body: {
      init_data: normalizedInitData,
    },
  });

  return normalizeBootstrapResponse(payload);
}

export async function fetchTracks(userId, authContext = {}) {
  const initDataRaw =
    typeof authContext === "object" && authContext
      ? String(authContext.initDataRaw ?? "").trim()
      : "";

  let payload;
  if (initDataRaw) {
    payload = await requestJson("/tracks/me", {
      headers: {
        [TELEGRAM_INIT_DATA_HEADER]: initDataRaw,
      },
    });
  } else {
    requireNonEmptyString(userId, "userId");
    payload = await requestJson("/tracks/me", {
      params: {
        user_id: userId,
      },
    });
  }

  const list = assertTracksResponse(payload);
  return normalizeTrackArray(list, "/tracks/me");
}

export async function fetchTrackAudioUrl(trackId, authContext = {}) {
  requireNonEmptyString(trackId, "trackId");

  const initDataRaw =
    typeof authContext === "object" && authContext
      ? String(authContext.initDataRaw ?? "").trim()
      : "";

  const payload = await requestJson("/tracks/audio", {
    params: {
      track_id: trackId,
    },
    headers: initDataRaw
      ? {
          [TELEGRAM_INIT_DATA_HEADER]: initDataRaw,
        }
      : undefined,
  });

  return assertAudioResponse(payload);
}

export {
  buildUrl,
  normalizeTrack,
  assertTracksResponse,
  assertBootstrapResponse,
  assertAudioResponse,
};
