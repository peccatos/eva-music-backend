import assert from "node:assert/strict";
import { fetchTracks, fetchTrackAudioUrl } from "./api.js";

const cases = [];

function test(name, fn) {
  cases.push({ name, fn });
}

function mockFetchOnce(payload, ok = true) {
  globalThis.fetch = async () => ({
    ok,
    status: ok ? 200 : 500,
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
    json: async () => payload,
  });
}

function mockFetchTracker() {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({}),
    };
  };

  return {
    get called() {
      return called;
    },
  };
}

function cleanup() {
  delete globalThis.fetch;
}

function hasRequiredMessage(error, token) {
  return String(error?.message || "")
    .replace(/\bis\b\s*/g, "")
    .includes(token);
}

test("fetchTracks() returns normalized array for array payload", async () => {
  mockFetchOnce([
    {
      id: "track-1",
      title: "Song A",
      artist: "Artist A",
      artworkUrl: "https://example.com/a.jpg",
    },
  ]);

  const tracks = await fetchTracks("user-1");

  assert.deepEqual(tracks, [
    {
      id: "track-1",
      title: "Song A",
      artist: "Artist A",
      artworkUrl: "https://example.com/a.jpg",
      storeUrl: "",
    },
  ]);
});

test("fetchTracks() returns normalized array for { tracks: [] } payload", async () => {
  mockFetchOnce({
    tracks: [
      {
        track_id: "track-2",
        name: "Song B",
        author: "Artist B",
        cover_url: "https://example.com/b.jpg",
      },
    ],
  });

  const tracks = await fetchTracks("user-1");

  assert.deepEqual(tracks, [
    {
      id: "track-2",
      title: "Song B",
      artist: "Artist B",
      artworkUrl: "https://example.com/b.jpg",
      storeUrl: "",
    },
  ]);
});

test("fetchTracks() supports creator and artwork fallback fields", async () => {
  mockFetchOnce([
    {
      track_id: "track-3",
      name: "Song C",
      creator: "Artist C",
      artwork_url: "https://example.com/c.jpg",
    },
  ]);

  const tracks = await fetchTracks("user-1");

  assert.deepEqual(tracks, [
    {
      id: "track-3",
      title: "Song C",
      artist: "Artist C",
      artworkUrl: "https://example.com/c.jpg",
      storeUrl: "",
    },
  ]);
});

test("fetchTracks() throws on invalid payload", async () => {
  mockFetchOnce({ unexpected: true });

  await assert.rejects(
    () => fetchTracks("user-1"),
    /Invalid backend response from \/tracks\/me/
  );
});

test("fetchTracks() throws when userId is empty string", async () => {
  const tracker = mockFetchTracker();

  await assert.rejects(
    () => fetchTracks(""),
    (error) => hasRequiredMessage(error, "userId required")
  );
  assert.equal(tracker.called, false);
});

test("fetchTracks() throws when userId is undefined", async () => {
  const tracker = mockFetchTracker();

  await assert.rejects(
    () => fetchTracks(undefined),
    (error) => hasRequiredMessage(error, "userId required")
  );
  assert.equal(tracker.called, false);
});

test("fetchTracks() throws when userId is whitespace string", async () => {
  const tracker = mockFetchTracker();

  await assert.rejects(
    () => fetchTracks("   "),
    (error) => hasRequiredMessage(error, "userId required")
  );
  assert.equal(tracker.called, false);
});

test("fetchTrackAudioUrl() accepts file_url", async () => {
  mockFetchOnce({ file_url: "https://example.com/file.mp3" });

  assert.equal(await fetchTrackAudioUrl("track-1", "user-1"), "https://example.com/file.mp3");
});

test("fetchTrackAudioUrl() omits user_id query param", async () => {
  let seenUrl = "";
  globalThis.fetch = async (input) => {
    seenUrl = String(input);
    return {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({ file_url: "https://example.com/file.mp3" }),
    };
  };

  await fetchTrackAudioUrl("track-1", "user-1");

  const url = new URL(seenUrl);
  assert.equal(url.pathname, "/tracks/audio");
  assert.equal(url.searchParams.get("track_id"), "track-1");
  assert.equal(url.searchParams.has("user_id"), false);
});

test("fetchTrackAudioUrl() accepts audio_url", async () => {
  mockFetchOnce({ audio_url: "https://example.com/audio.mp3" });

  assert.equal(await fetchTrackAudioUrl("track-1", "user-1"), "https://example.com/audio.mp3");
});

test("fetchTrackAudioUrl() accepts url", async () => {
  mockFetchOnce({ url: "https://example.com/url.mp3" });

  assert.equal(await fetchTrackAudioUrl("track-1", "user-1"), "https://example.com/url.mp3");
});

test("fetchTrackAudioUrl() throws on empty or invalid payload", async () => {
  mockFetchOnce({});

  await assert.rejects(
    () => fetchTrackAudioUrl("track-1", "user-1"),
    /Invalid backend response from \/tracks\/audio/
  );
});

test("fetchTrackAudioUrl() throws when trackId is empty string", async () => {
  const tracker = mockFetchTracker();

  await assert.rejects(
    () => fetchTrackAudioUrl("", "user-1"),
    (error) => hasRequiredMessage(error, "trackId required")
  );
  assert.equal(tracker.called, false);
});

test("fetchTrackAudioUrl() throws when trackId is undefined", async () => {
  const tracker = mockFetchTracker();

  await assert.rejects(
    () => fetchTrackAudioUrl(undefined, "user-1"),
    (error) => hasRequiredMessage(error, "trackId required")
  );
  assert.equal(tracker.called, false);
});

test("fetchTrackAudioUrl() throws when trackId is whitespace string", async () => {
  const tracker = mockFetchTracker();

  await assert.rejects(
    () => fetchTrackAudioUrl("   ", "user-1"),
    (error) => hasRequiredMessage(error, "trackId required")
  );
  assert.equal(tracker.called, false);
});

let failures = 0;

for (const { name, fn } of cases) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  } finally {
    cleanup();
  }
}

if (failures > 0) {
  process.exitCode = 1;
  console.error(`${failures} test(s) failed`);
} else {
  console.log(`${cases.length} test(s) passed`);
}
