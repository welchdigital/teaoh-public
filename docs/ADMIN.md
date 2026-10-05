# Admin panel and HTTP API

teaoh includes an HTTP API for server administration and a Vue 3 web panel
([admin-ui/](../admin-ui/)) that the API serves from the same port. Everything the
panel does goes through the API, so the API can also be scripted directly.

## Enabling

The API is configured in the `[admin]` section of `config/teaoh.toml`:

```toml
[admin]
enabled = true
host = "127.0.0.1"
port = 8080
key = ""            # at least 16 characters; required unless host is loopback
cors_origin = ""    # empty = same origin only
```

| Key | Default | Meaning |
| --- | ------- | ------- |
| `enabled` | `true` | Start the API. |
| `host` | `127.0.0.1` | Bind address. |
| `port` | `8080` | HTTP port. |
| `key` | `""` | Shared secret. See [Security](#security). |
| `cors_origin` | `*` in code, `""` in the shipped config | Origins allowed to call the API from a browser. See [CORS](#cors). |
| `allowed_hosts` | `[]` | Extra `Host` header values the API answers to. See [Host checking](#host-checking). |
| `ui_dir` | `admin-ui/dist` | Directory of the built panel served at `/`. |
| `max_auth_failures` | `10` | Wrong keys from one address before a lockout. |
| `auth_lockout_seconds` | `300` | Lockout length, and the window in which failures are counted. |
| `report_cooldown` | `60` | Seconds between in-game reports from one player. |
| `mute_length` | `90` | Default `$mute` length in seconds. |

Changes to `[admin]` need a restart.

Build the panel once (the Docker image does this automatically):

```sh
cd admin-ui
npm install
npm run build        # writes admin-ui/dist
```

Open `http://127.0.0.1:8080`, go to **Settings**, enter the key and your
operator name, and click **Test connection**. If the panel has not been built,
`/` shows a page explaining how to build it; the API still works.

For panel development, `npm run dev` in `admin-ui/` starts Vite on
`http://localhost:5173`. Set the API base URL in **Settings** and add the dev
origin to `cors_origin` (for example `cors_origin = "http://localhost:5173"`); a
non-empty key is also required for cross-origin access.

## Security

The API can kick, ban, edit and delete characters, reset passwords and shut the
server down. Treat the key like a root password.

- **Key.** Set `key` to a random value of at least 16 characters, for example
  `openssl rand -hex 24`. The API refuses to start, logging an error, when `host`
  is not a loopback address and the key is empty or shorter than 16 characters.
  The game server keeps running either way. On a loopback address an empty key
  disables authentication and logs a warning at startup.
- **Bind address.** Keep `host = "127.0.0.1"`. For remote access, use an SSH
  tunnel or a reverse proxy that terminates TLS; the API itself speaks plain HTTP
  only. The Docker Compose file publishes the port on `127.0.0.1` only.
- **Lockout.** A request without a key gets `401` and is not counted. After
  `max_auth_failures` wrong keys from one address within `auth_lockout_seconds`,
  further wrong keys from that address get `429` with a `Retry-After` header until
  the lockout ends. The correct key is always accepted. The address is the TCP
  peer; behind a reverse proxy every client shares the proxy's address.
- **Actor names.** The optional `x-admin-actor` header is recorded in the audit
  log. It is not authenticated: anyone with the key can claim any name.
- **Permissions.** API requests act above High Game Master: in-game admin-level
  restrictions (for example, not acting on an equal or higher admin) do not apply.
- **Privacy.** The chat log includes whispers, and account views include email
  addresses, IP addresses and hardware ids.
- **Headers.** Responses carry `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a restrictive
  `Content-Security-Policy`, and `Cache-Control: no-store` on API responses. The
  panel never renders server data as HTML.

### Host checking

To block DNS rebinding, the API checks the `Host` header of every request and
answers `421` when it is not accepted:

- Without a key, only `localhost`, `127.0.0.1` and `[::1]` are accepted, with no
  port or the port the API listens on. An SSH tunnel must therefore use the same
  local port as the API.
- With a key and an empty `allowed_hosts`, any `Host` is accepted.
- With a key and a non-empty `allowed_hosts`, the loopback names, the bind
  address (when it is not `0.0.0.0` or `::`) and the listed entries are accepted,
  for example `allowed_hosts = ["admin.example.com", "10.0.0.2:8080"]`. An entry
  without a port matches any port.

### CORS

`cors_origin` controls which browser origins may call the API from another
origin. The panel served by the API itself is same-origin and needs no CORS.

| Value | Behaviour |
| ----- | --------- |
| `""` | No cross-origin access (recommended). |
| `"*"` | Any origin, but only when a key is set. |
| `"https://a.example, https://b.example"` | Only the listed origins (comma-separated). |

## The panel

| Page | What it offers |
| ---- | -------------- |
| Dashboard | Players online and load, uptime, memory, tick timing, database, global chat state, last save, SLN status; top online players; recent activity. |
| Server | Announcements (announce, server message, admin chat), global chat lock, earthquakes (all maps or one), save all, scheduled shutdown with message and cancel, data reloads, SLN last result and ping now. |
| Online players | Live table with filters (text, map, staff, hidden, muted, frozen, jailed) and an actions menu: message, warp, mute, unmute, freeze, unfreeze, jail, free, kick, silent kick. |
| Characters | Search online and offline characters. The detail page has Overview, Stats (edits send only changed fields), Inventory and bank (give items; remove inventory items), Spells, Quests and Moderation (warp, jail, free, freeze, mute, private message, kick, ban, revoke ban, rename, delete). |
| Accounts | Search by name, email or last IP; profile, characters, bans, login history; lock and unlock; password reset with a generator. |
| Bans | Active, inactive or all bans; create a ban by character name, account id or IP; revoke. |
| Mutes | Active, inactive or all mutes; unmute. |
| Reports | Player reports and help requests; resolve with a note, reopen. |
| Guilds | Guild list and detail (description, bank, ranks, members); disband. |
| Map viewer | Canvas map with players, NPCs (admin-spawned ones highlighted), ground items, chests with contents and respawn timers, and warps. Click a tile to spawn NPCs, drop items or remove them. Reload or evacuate the map. |
| Logs | Live tail of the server log with category, level and text filters. |
| Chat | Live tail of all chat channels. |
| Audit | Searchable audit log. |
| Settings | API base URL, key, operator name, connection test. Stored in the browser's `localStorage`. |

Destructive actions ask for confirmation. Deleting a character requires typing its
name, disbanding a guild requires typing its tag, and an immediate shutdown
requires typing `shutdown`. A banner counts down a scheduled shutdown on every
page. The panel sends no API requests until a key is configured (or a keyless
loopback server is confirmed with **Test connection**). Polling pauses on `401`
and `429`; after a `429` a banner counts down the lockout and polling resumes
when it ends.

## HTTP API reference

### Conventions

- Base path `/api`. Requests and responses are JSON with camelCase keys.
  Timestamps are ISO 8601 UTC strings.
- **Authentication:** send the key as `x-admin-key: <key>` or
  `Authorization: Bearer <key>` on every `/api` request.
- **Actor:** optional `x-admin-actor: <name>` (printable ASCII, up to 32
  characters) is recorded in the audit log; the default is `api`.
- **Bodies:** `POST`, `PATCH` and `DELETE` requests with a body must send
  `content-type: application/json` and a JSON object. A `DELETE` without a body
  needs no content type. Bodies are limited to 256 KiB.
- **Success:** mutations return `{ "ok": true, ... }` unless a resource is
  documented below.
- **Pagination:** `offset` (default 0) and `limit` (default 50, maximum 200);
  paginated lists return `{ "total": n, "items": [...] }`. Larger `limit` values
  are clamped.
- **Durations:** `durationMinutes` is an integer from 1 to 52,560,000 (100
  years), or `null` for permanent.
- **Searches:** `q` parameters match text literally; `%` and `_` have no special
  meaning.
- Character ids in paths are numeric database ids.

### Errors

Errors return `{ "error": "message" }` with one of these status codes:

| Status | Meaning |
| ------ | ------- |
| 400 | Invalid input: bad JSON, missing or out-of-range field, unknown field. |
| 401 | Missing or wrong key. |
| 403 | Forbidden by an admin-level rule (in-game callers only). |
| 404 | Unknown route, character, account, ban, report, guild, map, NPC index or item. |
| 405 | Wrong method for an existing route; the `Allow` header lists the valid ones. |
| 409 | Conflict: the character must be online (or offline) for this action; an offline edit while the account is logging in or playing; name taken; map already evacuating; the SLN is disabled; the server is shutting down. |
| 413 | Body larger than 256 KiB. |
| 415 | Mutation without a JSON content type. |
| 421 | `Host` header not accepted (see [Host checking](#host-checking)). |
| 429 | Too many wrong keys from this address; see `Retry-After`. |
| 500 | Internal error, or a reload that failed. |
| 503 | Database unavailable, or the password hashing queue is full. |

Most state-changing endpoints return `409` while the server is shutting down.

### Server

| Method and path | Body | Response |
| --------------- | ---- | -------- |
| `GET /api/status` | | Status object (below). |
| `POST /api/server/announce` | `message` (1-200 chars), `kind` = `announce` (default), `server` or `admin` | `{ ok }` |
| `POST /api/server/global` | `locked` (boolean) | `{ ok, locked }` |
| `POST /api/server/quake` | `magnitude` (1-8), `mapId` (optional; all maps when omitted) | `{ ok }`; `404` for an unknown map. |
| `POST /api/server/save` | | `{ ok, saved }`: number of characters saved. |
| `POST /api/server/shutdown` | `seconds` (0-3600), `message` (optional, up to 200 chars) | `{ ok, at }`. Replaces any scheduled shutdown. |
| `DELETE /api/server/shutdown` | | `{ ok }`; `404` if none is scheduled. |
| `POST /api/server/reload` | `target`: `maps`, `pubs`, `drops`, `quests`, `formulas`, `news`, `shops` or `config` | `{ ok, target, detail }`; `500` if the reload fails. |
| `POST /api/sln/ping` | | `{ ok, sln }`; `409` when `[sln] enabled = false`. |

`announce` sends a scrolling announcement from `Server`, `server` a server
message box to everyone, and `admin` a message to admin chat (Guardian and
above). A scheduled shutdown broadcasts countdown warnings; at zero every
character and map is saved, clients are disconnected and the process exits.
Under Docker Compose (`restart: unless-stopped`) the container then starts again.

Reload targets are described in
[CONFIGURATION.md](CONFIGURATION.md#reloading). `config` applies only sections
that are safe to change live; `detail` names any changed settings that need a
restart.

Status object:

```json
{
  "name": "teaoh", "version": "0.1.0",
  "startedAt": "2026-01-01T00:00:00.000Z", "uptimeSeconds": 123,
  "online": 5, "connections": 7, "maxPlayers": 200,
  "maps": 282, "tcpPort": 8078, "wsPort": 8079, "database": "sqlite",
  "memory": { "rss": 123456789, "heapUsed": 23456789 },
  "tick": { "rateMs": 125, "avgMs": 0.8, "maxMs": 4.2 },
  "globalChatLocked": false,
  "lastSaveAt": "2026-01-01T00:05:00.000Z",
  "shutdown": null,
  "sln": { "enabled": false, "lastPingAt": null, "lastResult": null, "lastError": null }
}
```

`shutdown`, when scheduled, is `{ "at", "secondsRemaining", "message" }`.
`sln.lastResult` is `ok`, `rejected` or `failed`.

### Online players

`GET /api/players` returns an array:

```json
{ "id": 12, "playerId": 3, "accountId": 4, "accountName": "bob", "name": "bobby",
  "level": 10, "classId": 1, "className": "Priest", "adminLevel": 0,
  "map": 5, "mapName": "Brightvale", "x": 10, "y": 12, "hp": 50, "maxHp": 60, "tp": 20, "maxTp": 20,
  "hidden": false, "muted": false, "frozen": false, "jailed": false,
  "guildTag": "ABC", "ip": "1.2.3.4", "connectedAt": "..." }
```

`id` is the character id; `playerId` is the connection id.

### Characters

These endpoints work for online and offline characters unless noted. Online
characters are changed live; offline characters are changed in the database, and
such edits return `409` while the account is logging in or playing another
character.

| Method and path | Body or query | Response |
| --------------- | ------------- | -------- |
| `GET /api/characters` | `q` (name substring), `status` = `all` (default), `online` or `offline`, `offset`, `limit` | `{ total, items }` of `{ id, name, accountId, accountName, level, classId, className, adminLevel, map, x, y, online, guildTag, createdAt }` |
| `GET /api/characters/:id` | | Character detail (below). |
| `PATCH /api/characters/:id` | Any of `level, experience, str, int, wis, agi, con, cha, statPoints, skillPoints, karma, classId, adminLevel, title, home, fiance, partner, gender, hairStyle, hairColor, skin, hp, tp` | Character detail. Validated and clamped like `$set` ([COMMANDS.md](COMMANDS.md#set-properties)); `fiance` and `partner` must name existing characters (empty clears them). Unknown fields: `400`. |
| `POST /api/characters/:id/items` | `itemId`, `amount` (>= 1) | Character detail; `409` if nothing fits. |
| `DELETE /api/characters/:id/items/:itemId` | `?amount=N` (omit for all) | Character detail. Inventory only; `404` if not held. |
| `POST /api/characters/:id/warp` | `map`, `x` and `y` (optional, together) | `{ ok }`. Map centre when coordinates are omitted; out-of-bounds coordinates: `400`. |
| `POST /api/characters/:id/jail` | | `{ ok }` |
| `POST /api/characters/:id/free` | | `{ ok }` |
| `POST /api/characters/:id/freeze` | | `{ ok }`. Online only. |
| `DELETE /api/characters/:id/freeze` | | `{ ok }`. Online only. |
| `POST /api/characters/:id/mute` | `durationMinutes`, `reason` (optional, up to 500 chars) | `{ ok }` |
| `DELETE /api/characters/:id/mute` | | `{ ok }`; `404` if not muted. |
| `POST /api/characters/:id/kick` | `silent` (optional boolean) | `{ ok }`. Online only. |
| `POST /api/characters/:id/message` | `message` (1-200 chars) | `{ ok }`. Whisper from `Server`. Online only. |
| `POST /api/characters/:id/rename` | `name` | Character detail. Offline only; `409` if taken. Partner, fiance and mute records follow the rename. |
| `DELETE /api/characters/:id` | | `{ ok }`. Offline only. Deletes the character and its items; guild leadership passes on if needed. |

Character detail:

```json
{ "id": 12, "name": "bobby", "online": true, "playerId": 3, "ip": "1.2.3.4",
  "accountId": 4, "accountName": "bob",
  "title": "", "home": "Wanderer", "partner": "", "fiance": "",
  "gender": 0, "hairStyle": 1, "hairColor": 0, "skin": 0,
  "classId": 1, "className": "Priest", "level": 10, "experience": 1234, "usage": 60,
  "adminLevel": 0,
  "location": { "map": 5, "mapName": "Brightvale", "x": 10, "y": 12, "direction": 0 },
  "hp": 50, "maxHp": 60, "tp": 20, "maxTp": 20,
  "baseStats": { "str": 1, "int": 1, "wis": 1, "agi": 1, "con": 1, "cha": 1 },
  "secondaryStats": { "minDamage": 1, "maxDamage": 2, "accuracy": 1, "evade": 1, "armor": 1 },
  "statPoints": 0, "skillPoints": 0, "karma": 1000,
  "gold": 100, "bankGold": 0, "bankLevel": 0,
  "equipment": [ { "slot": "weapon", "id": 5, "name": "Sword" } ],
  "inventory": [ { "id": 1, "name": "Gold", "amount": 100 } ],
  "bank": [ { "id": 7, "name": "Apple", "amount": 3 } ],
  "spells": [ { "id": 1, "name": "Heal", "level": 1 } ],
  "quests": [ { "id": 1, "name": "The Miller's Son", "state": "Begin", "completed": false } ],
  "guild": { "tag": "ABC", "name": "Alphabet", "rank": 1, "rankName": "Leader" },
  "moderation": { "muted": false, "mutedUntil": null, "frozen": false, "jailed": false,
                  "banned": false, "activeBanId": null } }
```

`secondaryStats` is `null` for offline characters and `guild` is `null` outside a
guild.

### Accounts

| Method and path | Body or query | Response |
| --------------- | ------------- | -------- |
| `GET /api/accounts` | `q` (name or email substring, or exact last IP), `offset`, `limit` | `{ total, items }` of `{ id, name, email, realName, createdAt, lastLoginAt, lastIp, characterCount, online, banned, locked }` |
| `GET /api/accounts/:id` | | `{ id, name, email, realName, location, computer, hdid, createdAt, lastLoginAt, lastIp, online, locked, lockReason, characters: [{ id, name, level, online }], bans: [ban], logins: [{ ip, at, event }] }` |
| `POST /api/accounts/:id/password` | `password` (`[account] min_password_length` to `max_password_length`) | `{ ok }`. Also ends remember-me sessions; `503` if hashing is busy. |
| `POST /api/accounts/:id/lock` | `reason` (optional) | `{ ok }`. Disconnects the account's players; locked accounts cannot log in. |
| `DELETE /api/accounts/:id/lock` | | `{ ok }` |

### Bans

Ban object:

```json
{ "id": 7, "accountId": 4, "accountName": "bob", "characterName": "bobby",
  "ip": "1.2.3.4", "hdid": null, "reason": "spam", "bannedBy": "admin",
  "createdAt": "...", "expiresAt": null, "active": true, "revokedAt": null, "revokedBy": null }
```

| Method and path | Body or query | Response |
| --------------- | ------------- | -------- |
| `GET /api/bans` | `active` = `true`, `false` (omit for all), `offset`, `limit` | `{ total, items }`, newest first. |
| `POST /api/bans` | `characterName`, `accountId`, `ip` (at least one), `durationMinutes`, `reason`, `banIp`, `banHdid`, `force`, `silent` | Ban object. |
| `DELETE /api/bans/:id` | | `{ ok }`; `404` if no active ban has that id. |

- A character ban also covers its account.
- `banIp: true` also bans the character's current IP (online) or the account's
  last login IP (offline). `banHdid: true` also bans the client's hardware id;
  it applies only while the character is online. Both default to `false`.
- Loopback and `trusted_proxies` addresses are skipped when derived from the
  target, and an explicit `ip` of that kind is refused with `400` unless
  `force: true` is sent.
- Matching connections are closed. Unless `silent`, a character ban is announced
  in game.

### Mutes and reports

| Method and path | Body or query | Response |
| --------------- | ------------- | -------- |
| `GET /api/mutes` | `active`, `offset`, `limit` | `{ total, items }` of `{ id, characterId, characterName, reason, mutedBy, createdAt, expiresAt, active }` |
| `GET /api/reports` | `status` = `all` (default), `open` or `resolved`; `offset`, `limit` | `{ total, items }` of `{ id, kind, reporter, reportee, message, createdAt, status, resolvedBy, resolvedAt, note }` |
| `POST /api/reports/:id/resolve` | `note` (optional, up to 1000 chars) | Report object. |
| `POST /api/reports/:id/reopen` | | Report object; clears the note and resolution. |

Report `kind` is `report` (a player report) or `request` (a help request). Mutes
are lifted with `DELETE /api/characters/:id/mute`.

### Guilds

| Method and path | Body or query | Response |
| --------------- | ------------- | -------- |
| `GET /api/guilds` | `q` (tag or name substring) | Array of `{ id, tag, name, memberCount, onlineCount, bank, createdAt }` |
| `GET /api/guilds/:tag` | | `{ id, tag, name, description, bank, createdAt, ranks: [9 names], members: [{ characterId, name, rank, rankName, level, online }] }` |
| `POST /api/guilds/:tag/disband` | | `{ ok }` |

### Maps

| Method and path | Body | Response |
| --------------- | ---- | -------- |
| `GET /api/maps` | | Array of `{ id, name, width, height, type, pk, players, npcsAlive, npcsTotal, items, evacuating }` |
| `GET /api/maps/:id` | | Map detail (below). |
| `POST /api/maps/:id/reload` | | `{ ok }`. Reloads the map file; NPCs and chests are reset. |
| `POST /api/maps/:id/evacuate` | `seconds` (optional, 0-3600; default `[evacuate] timer_seconds`) | `{ ok }`; `409` if already evacuating. |
| `POST /api/maps/:id/npcs` | `npcId`, `x`, `y`, `amount` (1-20, default 1) | `{ ok, spawned }`. Admin-spawned NPCs do not respawn. |
| `DELETE /api/maps/:id/npcs/:index` | | `{ ok }` |
| `POST /api/maps/:id/items` | `itemId`, `amount`, `x`, `y` | `{ ok }`; `409` if the map has no free item slot. |
| `DELETE /api/maps/:id/items/:index` | | `{ ok }` |

Unknown map ids return `404`. Map detail:

```json
{ "id": 5, "name": "Brightvale", "width": 40, "height": 40, "type": 0, "pk": false, "evacuating": false,
  "tileSpecs": [ { "x": 1, "y": 2, "spec": 1 } ],
  "warps": [ { "x": 1, "y": 2, "map": 6, "destX": 3, "destY": 4, "door": 0 } ],
  "players": [ { "characterId": 12, "name": "bobby", "x": 1, "y": 2, "direction": 0, "hidden": false, "adminLevel": 0 } ],
  "npcs": [ { "index": 1, "id": 3, "name": "Rat", "x": 1, "y": 2, "hp": 10, "maxHp": 10, "alive": true, "spawned": false } ],
  "items": [ { "index": 1, "id": 1, "name": "Gold", "amount": 50, "x": 3, "y": 4 } ],
  "chests": [ { "x": 1, "y": 2,
                "items": [ { "id": 1, "name": "Gold", "amount": 5 } ],
                "spawns": [ { "id": 1, "name": "Gold", "amount": 5, "spawnMinutes": 10,
                              "available": true, "secondsRemaining": 0 } ] } ] }
```

NPC `spawned` is `true` for admin-spawned NPCs.

### Game data lookups

| Method and path | Query | Response |
| --------------- | ----- | -------- |
| `GET /api/data/items` | `q`, `limit` (default 50, max 500) | `[{ id, name, type, subtype }]` |
| `GET /api/data/npcs` | `q`, `limit` | `[{ id, name, type, level, hp }]` |
| `GET /api/data/spells` | `q`, `limit` | `[{ id, name, type }]` |
| `GET /api/data/classes` | | `[{ id, name }]` |

`q` matches a case-insensitive name substring or an exact id.

### Logs, chat and audit

| Method and path | Query | Response |
| --------------- | ----- | -------- |
| `GET /api/logs` | `categories` (comma-separated), `minLevel`, `search`, `afterSeq`, `limit` (default 200, max 2000) | `{ latestSeq, events: [{ seq, time, level, cat, msg, ...fields }] }` |
| `GET /api/logs/categories` | | `{ "<category>": count }` |
| `GET /api/chat` | `channel`, `afterSeq`, `limit` (default 200, max 2000) | `{ latestSeq, events: [{ seq, time, channel, from, to, map, message }] }` |
| `GET /api/audit` | `q`, `offset`, `limit` | `{ total, items: [{ id, at, actorKind, actor, sourceIp, keyFingerprint, action, target, details }] }`, newest first. |

Log and chat events are returned in ascending `seq` order. With `afterSeq`, the
oldest `limit` events after that sequence number are returned, so a client can
tail without gaps; without it, the newest `limit` events. `level` uses pino's
numbers (20 debug, 30 info, 40 warn, 50 error, 60 fatal) and `minLevel` filters on
it. `search` matches the message, category and field values.

Chat channels are `local`, `global`, `party`, `guild`, `pm`, `admin`, `announce`
and `server`.

Logs and chat are kept in memory only (the last 20,000 log events and 5,000 chat
messages) and are lost on restart. The audit log is stored in the database.

## Audit log

Every state-changing action from the API or from an in-game `$` command writes an
audit entry with the actor kind (`api` or `ingame`), actor name, source IP,
action, target and details. API entries also carry `keyFingerprint`, the first
8 hex digits of the SHA-256 of the key used (`null` in game or without a key),
which shows which key made a change after keys are rotated. Actions:

`announce`, `global`, `quake`, `save`, `shutdown`, `cancel_shutdown`, `reload`,
`reload_failed`, `sln_ping`, `set`, `set_admin_level`, `give_item`, `remove_item`, `warp`, `warpmeto`, `jail`, `free`,
`freeze`, `unfreeze`, `mute`, `unmute`, `kick`, `skick`, `ban`, `sban`,
`ban_failed`, `unban`, `message`, `rename`, `delete_character`, `lock_account`,
`unlock_account`, `reset_password`, `resolve_report`, `reopen_report`,
`disband_guild`, `reload_map`, `evacuate`, `cancel_evacuate`, `spawn_npc`,
`remove_npc`, `drop_item`, `remove_ground_item`, `hide`, `unhide`, `captcha`,
`skillreset`.

`q` on `GET /api/audit` searches the actor, action, target and details.

## Examples

```sh
KEY=your-admin-key
curl -s -H "x-admin-key: $KEY" http://127.0.0.1:8080/api/status

curl -s -X POST -H "x-admin-key: $KEY" -H "x-admin-actor: alice" \
  -H "content-type: application/json" \
  -d '{"message":"Restarting in 5 minutes","kind":"announce"}' \
  http://127.0.0.1:8080/api/server/announce

curl -s -X POST -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
  -d '{"seconds":300,"message":"Maintenance"}' \
  http://127.0.0.1:8080/api/server/shutdown
```
