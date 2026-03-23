# Eva player frontend bundle

`player.html` + `player.js` are the Telegram Mini App production entrypoint.
`app.js` remains a browser/dev fallback.

## Production flow

1. Telegram opens the Mini App and exposes `Telegram.WebApp.initData`.
2. `player.js` sends raw `initData` to the backend with `POST /auth/telegram`.
3. The backend validates the signature server-side and resolves `telegram_user_id`.
4. The backend returns the authenticated user library.
5. `player.js` renders a short loading state, then the library.

`initDataRaw` stays in memory for the session only. `localStorage` is not the production identity source.

## Dev / browser mode

If the page is opened outside Telegram, `player.js` shows an explicit browser mode message instead of trying to infer identity.

`app.js` can still be used for local/manual testing and keeps the legacy `userId` fallback behavior.

## API contract

### `POST /auth/telegram`

Request:

```json
{
  "init_data": "raw Telegram initData string"
}
```

Response:

```json
{
  "telegram_user_id": 1124976403,
  "tracks": [
    {
      "id": "track_1",
      "title": "Song A",
      "artist": null,
      "artworkUrl": null
    }
  ]
}
```

### `GET /tracks/me`

For compatibility, the endpoint still accepts `?user_id=...`.
If the request includes `X-Telegram-Init-Data`, the backend validates it and resolves the user from Telegram instead.

### `GET /tracks/audio`

For compatibility, the endpoint still accepts `?track_id=...`.
If the request includes `X-Telegram-Init-Data`, the backend validates it and only serves audio for the authenticated user.

## Tests

```bash
npm test
```

The tests cover:

- Telegram bootstrap request handling;
- `initData` transport to the backend;
- audio URL resolution with the Telegram auth header;
- legacy `userId` compatibility paths.
