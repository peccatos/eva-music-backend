# Eva player backend bundle

Внутри:

- `api.js` — единая точка подключения к backend
- `app.js` — переписанный основной плеер
- `player.js` — переписанный компактный плеер

## Что поменялось

1. Нормализованный backend-клиент живет в `api.js`.
2. `app.js` и `player.js` используют только ESM-импорты и не знают о сетевом транспорте напрямую.
3. `web-platform.js` использует `api.js` для backend-запросов и `local-library.js` для локального fallback.
4. `platform.js` хранит локальный `API_BASE` только для сборки платформенного адаптера в dev-режиме.

## Как подключить в HTML

```html
<script type="module" src="./app.js"></script>
```

или для второго плеера:

```html
<script type="module" src="./player.js"></script>
```

## Откуда берётся userId

Приоритет такой:

1. `Telegram.WebApp.initDataUnsafe.user.id`
2. `localStorage.getItem("eva_music_user_id")`

Если запускаешь не из Telegram, заранее положи `userId` в localStorage:

```js
localStorage.setItem("eva_music_user_id", "123456789");
```

## Ожидаемые backend endpoints

### `GET /tracks/me?user_id=...`

Ожидается массив треков или объект `{ "tracks": [] }`. Все схемы нормализуются только в `api.js`.

Поддерживаемые поля:

- `id` или `track_id`
- `title` или `name`
- `artist`, `author`, `creator`
- `artworkUrl`, `artwork_url`, `cover_url`

После нормализации UI получает только такой контракт:

- `id`
- `title`
- `artist`
- `artworkUrl`

```json
[
  {
    "id": "track_1",
    "title": "Song A",
    "artist": "Artist A",
    "artworkUrl": "https://...",
    "storeUrl": "https://..."
  }
]
```

### `GET /tracks/audio?track_id=...`

Ожидается объект. Поддерживаются поля:

- `file_url`
- `audio_url`
- `url`

Для этого endpoint `user_id` больше не отправляется, так как backend использует только `track_id`.

После нормализации `fetchTrackAudioUrl()` всегда возвращает непустую строку.

```json
{
  "file_url": "https://..."
}
```

## Поведение при ошибке backend

- Если `/tracks/me` вернул битую схему, `fetchTracks()` бросает явную ошибку с читаемым сообщением.
- Если `/tracks/audio` вернул битую схему или пустой URL, `fetchTrackAudioUrl()` бросает явную ошибку.
- `app.js` и `player.js` показывают пользовательский текст ошибки и не продолжают инициализацию через невалидные данные.
- `web-platform.js` не парсит backend-ответы сам и опирается на `api.js` для нормализации.

## API contract tests

Запуск:

```bash
npm test
```

Тесты проверяют только `api.js`, без браузера и без реальных запросов в backend. Они подтверждают:

- нормализацию ответа `/tracks/me`;
- поддержку fallback-полей;
- явные ошибки на битый ответ `/tracks/me`;
- поддержку `file_url`, `audio_url` и `url` для `/tracks/audio`;
- явные ошибки на битый ответ `/tracks/audio`.

## Player state machine

`app.js` и `player.js` держат состояние через один объект и обновляют его только через явные события.

### Состояния

- `idle`
- `loading_tracks`
- `ready`
- `resolving_audio`
- `playing`
- `paused`
- `error`

### Основные события

- `INIT`
- `TRACKS_LOAD_STARTED`
- `TRACKS_LOAD_SUCCEEDED`
- `TRACKS_LOAD_FAILED`
- `TRACK_SELECTED`
- `AUDIO_RESOLVE_STARTED`
- `AUDIO_RESOLVE_SUCCEEDED`
- `AUDIO_RESOLVE_FAILED`
- `PLAY_REQUESTED`
- `PAUSE_REQUESTED`
- `AUDIO_STARTED`
- `AUDIO_PAUSED`
- `AUDIO_ENDED`
- `RESET_ERROR`

### Правила

- Все переходы проходят через один reducer-like `transition()`.
- Рендер читает только `state`, а не разрозненные флаги.
- Асинхронные ответы проверяются по `requestToken`; устаревшие ответы игнорируются.
- `error` всегда содержит человекочитаемое `errorMessage`.
- UI и текст контролов всегда отражают текущий `state.status`.
