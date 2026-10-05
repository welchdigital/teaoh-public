# teaoh

A server emulator for [Endless Online](https://endless-online.com), written in
TypeScript and running on Node.js.

- Works with the vanilla **v28** client and **Deep** clients, over TCP or
  WebSocket.
- Stores accounts and characters in **SQLite** (no setup needed) or
  **PostgreSQL**.
- Comes with a web **admin panel** for managing players, bans, mutes, reports,
  maps and the server itself.

> [!IMPORTANT]
> teaoh does not include any Endless Online game files. The server will not start
> until you add the maps and pub files from an Endless Online client. See
> [Game data](#game-data).

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Game data](#game-data)
- [Running with Docker Compose](#running-with-docker-compose)
- [Running with Node.js](#running-with-nodejs)
- [After the first start](#after-the-first-start)
- [Connecting a client](#connecting-a-client)
- [Opening the server to players](#opening-the-server-to-players)
- [Configuration](#configuration)
- [Customizing game content](#customizing-game-content)
- [Updating](#updating)
- [Documentation](#documentation)
- [Acknowledgements](#acknowledgements)
- [License](#license)

## Features

- **Accounts:** account creation and login, password changes, bans by account,
  IP and hardware id, and login and connection throttling. Deep clients also get
  email validation, account recovery, remember-me logins and captchas.
- **World:** maps with warps, doors, keys, spikes and quakes; NPCs with AI,
  respawns, bosses, speech and drops; melee, ranged and spell combat; PK maps and
  arenas. Ground items, NPCs and chests are kept across restarts.
- **Economy and social:** shops, banks, lockers, chests, trading, skill masters,
  inns, barbers and jukeboxes; parties, guilds, marriages, message boards and
  quests.
- **Administration:** in-game `$` admin commands and `#` player commands, a web
  admin panel with an HTTP API, timed mutes, player reports, an audit log, and
  server list (SLN) registration.

## Requirements

Pick one way to run the server:

- **Docker Compose:** [Docker](https://docs.docker.com/get-docker/) with the
  Compose plugin. Nothing else is needed: the image includes Node.js and the
  admin panel, and Compose starts a PostgreSQL database for you.
- **Node.js:** [Node.js](https://nodejs.org) 26.1.0 or newer. The server uses
  SQLite by default, so no database server is needed. The `argon2` and
  `better-sqlite3` packages install prebuilt binaries on common systems; where
  none are available, `npm` builds them, which needs a C/C++ compiler and Python.

Either way, you also need the game files from an Endless Online **v28** client.

## Game data

> [!NOTE]
> Add these files before the first start. If a required file is missing, the
> server lists what is missing and exits.

Copy these files from your Endless Online client folder into teaoh's `data/`
folder:

| From the client | Copy to | Required |
| --------------- | ------- | -------- |
| `maps/*.emf` | `data/maps/` | Yes, at least one map |
| `pub/dat001.eif` (items) | `data/pub/` | Yes |
| `pub/dtn001.enf` (NPCs) | `data/pub/` | Yes |
| `pub/dsl001.esf` (spells) | `data/pub/` | Yes |
| `pub/dat001.ecf` (classes) | `data/pub/` | Yes |

The server also reads five **server pub files**. They are not part of the client.
Each one is optional; when one is missing, a warning is logged and its feature is
turned off:

| File | Contents | Without it |
| ---- | -------- | ---------- |
| `data/pub/dtd001.edf` | NPC drops | Drops come from `data/drops.ini` |
| `data/pub/dts001.esf` | Shops and crafting | No shops or crafting |
| `data/pub/dsm001.emf` | Skill masters | No skill masters |
| `data/pub/din001.eid` | Inns | No inns; characters respawn at the `[world]` spawn point |
| `data/pub/ttd001.etf` | NPC speech | NPCs do not talk |

When everything is in place, `data/` looks like this:

```text
data/
├── maps/
│   ├── 00001.emf
│   ├── 00002.emf
│   └── ...
├── pub/
│   ├── dat001.ecf
│   ├── dat001.eif
│   ├── dsl001.esf
│   ├── dtn001.enf
│   └── (optional server pub files)
├── quests/              (optional quest scripts: 00001.eqf, ...)
├── arenas.ini           included with teaoh
├── drops.ini            included with teaoh
├── formulas.ini         included with teaoh
├── global_drops.toml    included with teaoh
└── news.txt             included with teaoh
```

- Map files are named by their five-digit map id: `00001.emf` is map 1. Other
  names, such as seasonal variants like `00005c.emf`, are skipped.
- The server pub files use the same formats as
  [REOSERV](https://reoserv.net/docs/pubs). You can also write all nine pub files
  as JSON in [pub2json](https://github.com/sorokya/pub2json) format, in the
  folders `data/pub/classes/`, `items/`, `npcs/`, `spells/`, `shops/`, `inns/`
  and `skill_masters/`, and set `generate_pub = true` under `[server]`. The
  server then builds the pub files from them at startup.
- The default start and respawn locations assume the official v28 maps and pubs:
  new characters start on map 192 with the home `Wanderer`, the jail is map 76,
  and characters whose map no longer exists are sent to map 4. If your data
  differs, change
  `[new_character]` and `[world]` in `config/teaoh.toml`.

## Running with Docker Compose

Compose runs two containers: `teaoh` (the game server and admin panel) and `db`
(PostgreSQL 18). Your `config/` and `data/` folders are mounted into the server
container, so the game data stays on your machine.

1. Copy the game data into `data/` (see [Game data](#game-data)).

2. Create a settings file from the example (on Windows, use `copy` instead of
   `cp`):

   ```sh
   cp .env.example .env
   ```

   Open `.env` and change `TEAOH_DB_PASSWORD`. To use the admin panel, also add
   a key of at least 16 random characters:

   ```sh
   TEAOH_ADMIN_KEY=replace-with-a-long-random-string
   ```

   On Linux and macOS, `openssl rand -hex 24` prints a suitable key.

3. Build and start the containers:

   ```sh
   docker compose up -d --build
   ```

4. Follow the log until it shows `tcp listener started`:

   ```sh
   docker compose logs -f teaoh
   ```

The game now accepts clients on port `8078` (TCP) and `8079` (WebSocket). The
admin panel is at <http://127.0.0.1:8080>; enter the key from `.env` when it asks.

| Task | Command |
| ---- | ------- |
| Stop the server (saves all characters and maps) | `docker compose stop` |
| Start it again | `docker compose start` |
| Apply changes made to `config/teaoh.toml` | `docker compose restart teaoh` |
| Follow the log | `docker compose logs -f teaoh` |
| Back up the database | `docker compose exec db pg_dump -U teaoh teaoh > backup.sql` |

> [!NOTE]
>
> - The database name, user and password in `.env` are applied when the database
>   is first created. Set them before the first start.
> - The server runs as user id 1000 inside the container and writes map saves to
>   `data/`. On Linux, if your user id is not 1000, make the folder writable with
>   `sudo chown -R 1000:1000 data`.
> - With Docker's default port publishing, the server sees Docker's address
>   instead of each player's IP address, so IP bans and per-IP limits treat all
>   players as one. On Linux, start with host networking instead:
>   `docker compose -f docker-compose.yml -f docker-compose.host.yml up -d --build`.
>   [docs/DOCKER.md](docs/DOCKER.md#client-ip-addresses) covers this and other
>   options.

## Running with Node.js

1. Install [Node.js](https://nodejs.org) 26.1.0 or newer.

2. Copy the game data into `data/` (see [Game data](#game-data)).

3. Install the server's packages:

   ```sh
   npm ci
   ```

4. Build the admin panel (skip this if you will not use it):

   ```sh
   cd admin-ui
   npm ci
   npm run build
   cd ..
   ```

5. Start the server:

   ```sh
   npm start
   ```

On the first start the server creates the database file `data/teaoh.db`. It then
accepts clients on port `8078` (TCP) and `8079` (WebSocket), and serves the admin
panel at <http://127.0.0.1:8080>. Press `Ctrl+C` to stop it; all characters and
maps are saved first.

The admin panel only listens on `127.0.0.1`. Without a key, anyone who can open
that address on the machine can use it. To require a key, set `key` under
`[admin]` in `config/teaoh.toml` to at least 16 random characters.

To keep the server running in the background or start it at boot, run
`npm start` in this folder from your system's service manager, such as systemd
on Linux.

### Using PostgreSQL

To use PostgreSQL instead of SQLite, create an empty database and a user that
owns it, then set the `[database]` section of `config/teaoh.toml`:

```toml
[database]
driver = "postgres"
host = "127.0.0.1"
port = 5432
name = "teaoh"
user = "teaoh"
password = "your-database-password"
```

The server creates its tables on the next start.

## After the first start

1. **Create your admin character.** The first character created on a new database
   becomes a High Game Master. Connect with a client (see
   [Connecting a client](#connecting-a-client)), create an account, and create
   your character.
2. **Turn that off.** Set `first_character_admin = false` under `[character]` in
   `config/teaoh.toml` and restart the server.
3. **Learn the commands.** Type `$commands` in game to list the admin commands you
   can use. [docs/COMMANDS.md](docs/COMMANDS.md) describes them all.

## Connecting a client

In your Endless Online client folder, open `config/setup.ini` and point the
`[CONNECTION]` section at your server:

```ini
[CONNECTION]
Host=127.0.0.1
Port=8078
```

To connect from another machine, use the server's address or hostname instead of
`127.0.0.1`. Before entering the game, the client downloads any map or pub file
that differs from the server's copy.

The server accepts client versions 0.0.28 (vanilla) to 0.3.29 (Deep clients),
set by `min_version` and `max_version` under `[server]`. Web-based clients
connect over WebSocket on port `8079`.

## Opening the server to players

- Allow incoming TCP connections on port `8078` in your firewall and router, and
  on `8079` if you want WebSocket clients.
- Never expose the admin panel's port `8080` to the internet. For remote access,
  use an SSH tunnel or a reverse proxy with HTTPS; see
  [docs/ADMIN.md](docs/ADMIN.md#security).
- To appear on the Apollo Games server list, fill in the `[sln]` section of
  `config/teaoh.toml`; see [docs/SLN.md](docs/SLN.md).
- Email validation and account recovery for Deep clients need an SMTP server; see
  `[smtp]` and `[account]` in
  [docs/CONFIGURATION.md](docs/CONFIGURATION.md#smtp).

## Configuration

All settings are in `config/teaoh.toml`. Every setting has a default, so the file
only needs the ones you change.

Any setting can also be set with an environment variable named
`TEAOH_<SECTION>_<KEY>`, for example `TEAOH_SERVER_PORT=8078`. Environment
variables take precedence over the file. With Docker Compose, add them under
`environment:` for the `teaoh` service in `docker-compose.yml`.

Many settings can be reloaded from the admin panel without a restart.
[docs/CONFIGURATION.md](docs/CONFIGURATION.md) lists every setting, its default
and whether it needs a restart. The messages the server sends to players, such as
announcements and wedding lines, are in `config/lang/en.toml`.

## Customizing game content

| To change | Edit |
| --------- | ---- |
| Items, NPCs, spells and classes | The pub files in `data/pub/`, or their JSON sources with `generate_pub` |
| Shops, skill masters, inns, NPC speech and NPC drops | The server pub files in `data/pub/` |
| Drops that any NPC can give | `data/global_drops.toml` |
| Quests | `data/quests/` (`00001.eqf`, `00002.eqf`, ... in the EOSERV quest format) |
| Arenas | `data/arenas.ini` |
| Stat and combat formulas | `data/formulas.ini` |
| News shown when entering the game | `data/news.txt` |

[docs/CONFIGURATION.md](docs/CONFIGURATION.md#data-files) describes each file's
format and how to reload it.

## Updating

> [!WARNING]
> Back up your database before updating. Database changes in a new version are
> applied automatically when it starts.

**Docker Compose:**

1. Back up the database:
   `docker compose exec db pg_dump -U teaoh teaoh > backup.sql` (use your own
   user and database name if you changed them).
2. Replace the teaoh files with the new version. Keep your `.env`, `config/` and
   `data/`.
3. Rebuild and restart: `docker compose up -d --build`.

**Node.js:**

1. Stop the server and copy `data/teaoh.db` somewhere safe.
2. Replace the teaoh files with the new version. Keep your `config/` and `data/`.
3. Run `npm ci`, rebuild the admin panel if you use it, and start the server with
   `npm start`.

## Documentation

| Document | Contents |
| -------- | -------- |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Every setting, environment variables and the data file formats |
| [docs/DOCKER.md](docs/DOCKER.md) | Docker variables, the admin panel in Docker, real client IP addresses, running without Compose |
| [docs/ADMIN.md](docs/ADMIN.md) | The admin panel, its security settings and the HTTP API |
| [docs/COMMANDS.md](docs/COMMANDS.md) | Player `#` and admin `$` commands and admin levels |
| [docs/SLN.md](docs/SLN.md) | Registering with the server list |
| [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) | Known gaps |
| [docs/REOSERV_DIFFERENCES.md](docs/REOSERV_DIFFERENCES.md) | Deliberate differences from REOSERV |

## Acknowledgements

teaoh's behaviour is checked against these servers and libraries:

- [REOSERV](https://github.com/sorokya/reoserv) by Richard Leek (MIT): the
  primary reference.
- EOSERV by Julian Smythe and its maintained fork
  [ETHEOS](https://github.com/ethanmoffat/etheos) by Ethan Moffat (zlib-style
  license): the quest and formula formats and several gameplay rules.
- [eolib](https://github.com/Cirras/eolib-ts) by Cirras (MIT): the network
  protocol and pub and map file handling.

Endless Online is a trademark of its respective owners. This project is not
affiliated with them.

## License

MIT. See [LICENSE](LICENSE).
