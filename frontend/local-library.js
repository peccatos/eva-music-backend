export const LOCAL_FALLBACK_TRACKS = [
  {
    id: "local:deftones-change",
    title: "Change (In the House of Flies)",
    artist: "Deftones",
  },
];

export function getLocalFallbackTracksResponse() {
  return {
    tracks: LOCAL_FALLBACK_TRACKS.map((track) => ({ ...track })),
  };
}

export function getLocalFallbackPlayable(trackId) {
  const track = LOCAL_FALLBACK_TRACKS.find((item) => item.id === trackId);
  if (!track) {
    throw new Error(`Local fallback track not found: ${trackId}`);
  }

  return {
    url: "/11%20Deftones%20-%20Change%20(In%20the%20House%20of%20Flies).mp3",
    kind: "asset",
  };
}
