# teaoh admin panel

A Vue 3 web interface for a running [teaoh](../README.md) server. It uses the
server's admin HTTP API; the pages, the security model and the full API reference
are documented in [docs/ADMIN.md](../docs/ADMIN.md).

Plain JavaScript single-file components, `vue-router` with hash history,
hand-written CSS, no component library.

## Build and run

Requires Node.js 18 or newer and npm.

```sh
cd admin-ui
npm install
npm run build      # writes admin-ui/dist
```

The server serves `admin-ui/dist` on the admin port (`[admin] ui_dir`), so the
panel and API share an origin. Open `http://127.0.0.1:8080`, then in
**Settings** leave the API base URL blank, enter the admin key and your operator
name, and click **Test connection**. On a loopback server without a key, leave
the key blank; a successful test remembers that no key is needed. The Docker
image builds the panel automatically.

## Development server

```sh
npm run dev        # http://localhost:5173 with hot reload
```

The dev server runs on another origin, so the server must allow it:

```toml
[admin]
key = "at-least-16-characters"
cors_origin = "http://localhost:5173"
```

In **Settings**, set the API base URL to `http://127.0.0.1:8080`.

## How it talks to the server

- All calls go through `request()` in `src/api.js`, which has one function per API
  endpoint. It sends `x-admin-key`, `x-admin-actor` (the operator name, recorded
  in the audit log) and a JSON `content-type` on mutations, and shows the
  server's `{ error }` message on failure.
- No requests are sent until a key is configured (or keyless mode is confirmed),
  so an empty key never counts toward the server's failed-login lockout.
- A `401` or `429` pauses background polling. After a `429`, polling resumes when
  the `Retry-After` time has passed.
- Polling never overlaps requests, pauses while the tab is hidden, and re-fetches
  when parameters change. Log and chat views tail incrementally with `afterSeq`
  and keep at most 2,000 rows. `/api/status` is polled once, in
  `src/stores/status.js`, for every view.
- The key, base URL, operator name and keyless flag are stored in the browser's
  `localStorage` (`teaoh.admin.*`). Server data is rendered as text, never as
  HTML.

## Layout

```text
src/
  api.js            request helper, endpoint functions, polling and tailing
  router.js         routes, page titles, 404
  style.css         theme variables and shared styles
  util.js           formatting helpers
  stores/           status, toasts, confirm dialog, lookup caches
  composables/      useAction, useModeration, useRouteQuery, usePageTitle, now
  components/       dialogs, pickers, banners, pagination, onboarding
  views/            one file per page; character tabs in views/character/
```
