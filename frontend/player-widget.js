import {
  createPlayerState,
  currentTrack,
  formatArtist,
  formatTime,
  nextTrackIndex,
  previousTrackIndex,
  reducePlayer,
  visibleTrackIndices,
} from "./player-core.js";

export function createStaticTrackSource(tracks, options = {}) {
  const debug = options.debug ?? { mode: "static-source" };
  const playableByTrackId = new Map(
    (options.playables ?? []).map((playable) => [playable.trackId, playable])
  );
  return {
    async loadTracks(userId) {
      return {
        tracks: tracks.map(({ id, title, artist }) => ({
          id,
          title,
          artist: artist ?? null,
        })),
      };
    },
    async resolvePlayable(trackId, userId) {
      const playable = playableByTrackId.get(trackId);
      if (!playable) {
        throw new Error(`Track playable is missing for ${trackId}`);
      }
      return {
        url: playable.url,
        kind: playable.kind,
      };
    },
    async getDebugInfo(state) {
      return debug;
    },
  };
}

export function createPlayerWidget(message) {
  const options = normalizeCreateWidgetMessage(message);
  const root = options.root;
  const source = options.source;
  const audio = options.audio ?? new Audio();
  const initialUserId = options.initialUserId ?? "";

  if (!root) {
    throw new Error("Player widget root is required");
  }
  if (!source || typeof source.loadTracks !== "function" || typeof source.resolvePlayable !== "function") {
    throw new Error("Player widget source must implement loadTracks and resolvePlayable");
  }

  audio.preload = "metadata";

  root.classList.add("eva-widget");
  root.innerHTML = template();

  const dom = bindDom(root);
  let state = createPlayerState({ userId: initialUserId });

  function dispatch(event) {
    state = reducePlayer(state, event);
    render();
  }

  async function renderDebug() {
    const payload = source.getDebugInfo
      ? await source.getDebugInfo({ state })
      : { mode: "widget", trackCount: state.tracks.length };
    dom.debug.textContent = JSON.stringify(payload, null, 2);
  }

  function renderEmpty() {
    dom.title.textContent = "Локальная библиотека пуста";
    dom.artist.textContent = "Подключи источник данных виджета";
    dom.line1.textContent = "";
    dom.line2Title.textContent = "";
    dom.line2Artist.textContent = "";
    dom.line3.textContent = "";
    dom.trackList.innerHTML = "";
  }

  function renderTrackSheet() {
    const track = currentTrack(state);
    const [firstIndex, secondIndex, thirdIndex] = visibleTrackIndices(state);
    const first = state.tracks[firstIndex];
    const second = state.tracks[secondIndex];
    const third = state.tracks[thirdIndex];

    dom.title.textContent = track.title;
    dom.artist.textContent = formatArtist(track.artist);
    dom.line1.textContent = first ? first.title : "";
    dom.line2Title.textContent = second ? second.title : "";
    dom.line2Artist.textContent = second ? formatArtist(second.artist) : "";
    dom.line3.textContent = third ? `${third.title} · ${formatArtist(third.artist)}` : "";
    dom.shuffle.classList.toggle("is-active", state.shuffled);
    dom.repeat.classList.toggle("is-active", state.repeat);
    dom.save.classList.toggle("is-active", state.savedTracks.includes(track.id));

    dom.line1.onclick = () => selectTrack(firstIndex, true);
    dom.line2.onclick = () => selectTrack(secondIndex, true);
    dom.line3.onclick = () => selectTrack(thirdIndex, true);
  }

  function renderTrackList() {
    dom.trackList.innerHTML = "";
    state.tracks.forEach((track, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "eva-widget__track";
      button.textContent = `${track.title} · ${formatArtist(track.artist)}`;
      button.addEventListener("click", () => selectTrack(index, true));
      if (index === state.index) {
        button.classList.add("is-active");
      }
      dom.trackList.appendChild(button);
    });
  }

  function renderPlayback() {
    const disabled = state.tracks.length < 2;
    root.classList.toggle("is-playing", state.playing);
    dom.prev.disabled = disabled;
    dom.next.disabled = disabled;
    dom.playLabel.textContent = state.playing ? "||" : ">";
  }

  function render() {
    if (!currentTrack(state)) {
      renderEmpty();
    } else {
      renderTrackSheet();
      renderTrackList();
    }
    renderPlayback();
    renderDebug().catch(console.error);
  }

  async function selectTrack(index, autoplay = false) {
    if (!state.tracks.length) return;

    const nextState = reducePlayer(state, {
      type: "track_selected",
      index,
      autoplay,
    });
    const track = nextState.tracks[nextState.index];

    try {
      const playable = await source.resolvePlayable(track.id, nextState.userId);
      audio.src = playable.url;
      audio.load();
      dom.currentTime.textContent = "0:00";
      dom.duration.textContent = "0:00";
      state = nextState;
      render();

      if (autoplay) {
        await audio.play();
        dispatch({ type: "play" });
      }
    } catch (error) {
      console.error(error);
      dispatch({ type: "pause" });
    }
  }

  async function load() {
    const response = await source.loadTracks(state.userId);
    const tracks = normalizeTracksResponse(response);
    dispatch({ type: "tracks_loaded", tracks });
    if (tracks.length > 0) {
      await selectTrack(0, false);
    }
  }

  dom.play.addEventListener("click", () => {
    if (!audio.src) return;
    if (audio.paused) {
      audio.play().then(() => dispatch({ type: "play" })).catch(() => {});
      return;
    }
    audio.pause();
    dispatch({ type: "pause" });
  });

  dom.prev.addEventListener("click", () => {
    const index = previousTrackIndex(state);
    if (index !== null) {
      selectTrack(index, true);
    }
  });

  dom.next.addEventListener("click", () => {
    const index = nextTrackIndex(state);
    if (index !== null) {
      selectTrack(index, true);
    }
  });

  dom.shuffle.addEventListener("click", () => dispatch({ type: "toggle_shuffle" }));
  dom.repeat.addEventListener("click", () => {
    dispatch({ type: "toggle_repeat" });
    audio.loop = !audio.loop;
  });
  dom.save.addEventListener("click", () => dispatch({ type: "toggle_save" }));

  dom.progress.addEventListener("input", (event) => {
    audio.currentTime = Number(event.target.value);
  });

  audio.addEventListener("loadedmetadata", () => {
    dom.duration.textContent = formatTime(audio.duration);
    dom.progress.max = String(audio.duration || 1);
  });

  audio.addEventListener("timeupdate", () => {
    dom.currentTime.textContent = formatTime(audio.currentTime);
    dom.progress.value = String(audio.currentTime);
  });

  audio.addEventListener("ended", () => {
    dispatch({ type: "pause" });
    if (!state.repeat) {
      const index = nextTrackIndex(state);
      if (index !== null) {
        selectTrack(index, true);
      }
    }
  });

  render();
  load().catch((error) => {
    console.error(error);
    dom.title.textContent = "Ошибка виджета";
    dom.artist.textContent = "Источник данных не ответил";
  });

  return {
    root,
    reload: load,
    destroy() {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      root.innerHTML = "";
      root.classList.remove("eva-widget", "is-playing");
    },
  };
}

function normalizeTracksResponse(response) {
  if (Array.isArray(response)) {
    return response;
  }

  if (response && Array.isArray(response.tracks)) {
    return response.tracks;
  }

  return [];
}

function normalizeCreateWidgetMessage(message) {
  if (message?.type === "CreatePlayerWidget") {
    return {
      ...message.payload,
      source: message.source,
      audio: message.audio,
    };
  }

  return message;
}

function bindDom(root) {
  return {
    play: root.querySelector("[data-role='play']"),
    playLabel: root.querySelector("[data-role='play-label']"),
    prev: root.querySelector("[data-role='prev']"),
    next: root.querySelector("[data-role='next']"),
    progress: root.querySelector("[data-role='progress']"),
    currentTime: root.querySelector("[data-role='current-time']"),
    duration: root.querySelector("[data-role='duration']"),
    title: root.querySelector("[data-role='title']"),
    artist: root.querySelector("[data-role='artist']"),
    line1: root.querySelector("[data-role='line1']"),
    line2: root.querySelector("[data-role='line2']"),
    line2Title: root.querySelector("[data-role='line2-title']"),
    line2Artist: root.querySelector("[data-role='line2-artist']"),
    line3: root.querySelector("[data-role='line3']"),
    shuffle: root.querySelector("[data-role='shuffle']"),
    repeat: root.querySelector("[data-role='repeat']"),
    save: root.querySelector("[data-role='save']"),
    trackList: root.querySelector("[data-role='tracks']"),
    debug: root.querySelector("[data-role='debug']"),
  };
}

function template() {
  return `
    <section class="eva-widget__hero">
      <div class="eva-widget__label">
        <h1 class="eva-widget__title" data-role="title"></h1>
        <p class="eva-widget__artist" data-role="artist"></p>
      </div>
      <div class="eva-widget__art">
        <button class="eva-widget__play" type="button" data-role="play">
          <span data-role="play-label">></span>
        </button>
        <div class="eva-widget__nav">
          <button type="button" data-role="prev">‹‹</button>
          <button type="button" data-role="next">››</button>
        </div>
      </div>
    </section>

    <section class="eva-widget__progress">
      <span data-role="current-time">0:00</span>
      <input data-role="progress" type="range" min="0" max="1" step="0.001" value="0" />
      <span data-role="duration">0:00</span>
    </section>

    <section class="eva-widget__sheet">
      <div class="eva-widget__group">
        <button type="button" class="eva-widget__line" data-role="line1"></button>
        <button type="button" class="eva-widget__line" data-role="line2">
          <span data-role="line2-title"></span><br />
          <span data-role="line2-artist"></span>
        </button>
        <button type="button" class="eva-widget__line eva-widget__line--ghost" data-role="line3"></button>
      </div>

      <div class="eva-widget__actions">
        <button type="button" class="eva-widget__icon" data-role="shuffle">Shuffle</button>
        <button type="button" class="eva-widget__icon" data-role="repeat">Repeat</button>
        <button type="button" class="eva-widget__icon" data-role="save">Save</button>
      </div>

      <section class="eva-widget__library">
        <div class="eva-widget__library-title">Tracks</div>
        <div class="eva-widget__tracks" data-role="tracks"></div>
      </section>
    </section>

    <pre class="eva-widget__debug" data-role="debug"></pre>
  `;
}
