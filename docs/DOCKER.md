# Docker

The repository ships a `Dockerfile` (Node 26, with the admin panel built in) and
Compose files for running teaoh with PostgreSQL 18.

## Quick start

Endless Online maps and pub files are not part of the repository or the image.
Put them in `./data` on the host first (see
[Game data](../README.md#game-data)).

```sh
cp .env.example .env    # optional; every variable has a default
docker compose up -d --build
docker compose logs -f teaoh
```

Compose starts two services:

- `teaoh`: the game server. `config/` is mounted read-only and `./data` read-write
  from the host, so map and pub changes need no rebuild. The `./data` mount must
  contain the game data: without the client pubs or maps the server logs the
  missing files and exits with status 1, and the restart policy keeps retrying
  until they are in place.
- `db`: PostgreSQL 18 with its data in the `db_data` volume. The server waits for
  it to be healthy and runs migrations on startup.

## Variables

Set these in `.env` next to `docker-compose.yml` or in the shell:

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `TEAOH_TCP_PORT` | `8078` | Host port for game clients (TCP). |
| `TEAOH_WS_PORT` | `8079` | Host port for WebSocket clients. |
| `TEAOH_ADMIN_PORT` | `8080` | Host port for the admin panel, bound to `127.0.0.1` only. |
| `TEAOH_ADMIN_KEY` | unset | Admin API key, at least 16 characters. |
| `TEAOH_DB_NAME` | `teaoh` | PostgreSQL database. |
| `TEAOH_DB_USER` | `teaoh` | PostgreSQL user. |
| `TEAOH_DB_PASSWORD` | `teaoh` | PostgreSQL password. |
| `TEAOH_DB_PORT` | `5432` | Host port for PostgreSQL, bound to `127.0.0.1` only. |

The PostgreSQL name, user and password are applied when the `db_data` volume is
first created. To change them later, change them in PostgreSQL as well, or remove
the volume (which deletes the database).

Any server setting can also be passed as `TEAOH_<SECTION>_<KEY>` in the
`environment:` block of the `teaoh` service; environment variables override
`config/teaoh.toml` (see [CONFIGURATION.md](CONFIGURATION.md)).

## Admin panel

Inside the container the admin API binds to all interfaces so the published port
can reach it. On a non-loopback address the API only starts with a key of at
least 16 characters, so set one:

```sh
echo "TEAOH_ADMIN_KEY=$(openssl rand -hex 24)" >> .env
docker compose up -d
```

Without a key the log shows `admin API not started: [admin] key is empty ...`
and the game runs normally. The key can instead be set as `[admin] key` in
`config/teaoh.toml`; `TEAOH_ADMIN_KEY` takes precedence when set.

The panel is published on `127.0.0.1:${TEAOH_ADMIN_PORT}` only. To reach it from
another machine, use an SSH tunnel:

```sh
ssh -L 8080:127.0.0.1:8080 user@server    # right-hand port: TEAOH_ADMIN_PORT
# then open http://127.0.0.1:8080
```

or a reverse proxy with TLS in front of it. Do not publish it on a public
interface over plain HTTP. See [ADMIN.md](ADMIN.md).

## Operating

- `docker compose stop` (or `down`) sends SIGTERM; the server saves every
  character and map before exiting.
- A shutdown started from the admin panel exits the process, and the
  `unless-stopped` restart policy starts it again: a panel shutdown acts as a
  restart. Use `docker compose stop` to keep it stopped.
- `docker compose up -d --build` after pulling updates rebuilds the image;
  database migrations run automatically.
- Logs are JSON lines (`NODE_ENV=production`); `docker compose logs teaoh`
  shows them.
- PostgreSQL is published on `127.0.0.1:${TEAOH_DB_PORT}` for backups and local
  tools, for example
  `docker compose exec db pg_dump -U teaoh teaoh > backup.sql`.

## Server list

Inside the container the game listens on 8078. If players reach it on a
different host port (`TEAOH_TCP_PORT`, or router port forwarding), set
`[sln] port` to the public port so the server list connects to the right place.
See [SLN.md](SLN.md).

## Without Compose

The image runs on its own with SQLite:

```sh
docker build -t teaoh .
docker run -d --name teaoh \
  -p 8078:8078 -p 8079:8079 -p 127.0.0.1:8080:8080 \
  -v "$PWD/data:/app/data" -v "$PWD/config:/app/config:ro" \
  -e TEAOH_ADMIN_HOST=0.0.0.0 -e TEAOH_ADMIN_KEY="$(openssl rand -hex 24)" \
  teaoh
```

The container runs as the `node` user (uid 1000); the mounted `data/` directory
must be writable by it. Maps and pub files are not part of the image; the mounted
`data/` must contain them.

## Client IP addresses

With Docker's default port publishing, connections pass through Docker's NAT or
userland proxy, and the server sees the bridge gateway (for example
`172.18.0.1`) as every player's address. IP bans, per-IP connection limits and
login throttles then apply to all players at once. Use one of the following.

### Host networking (Linux)

```sh
docker compose -f docker-compose.yml -f docker-compose.host.yml up -d --build
```

The server shares the host's network stack and sees real client addresses. The
override drops the port mappings; the server binds `TEAOH_TCP_PORT` and
`TEAOH_WS_PORT` directly, the admin API binds `127.0.0.1:${TEAOH_ADMIN_PORT}`, and
PostgreSQL is reached at `127.0.0.1:${TEAOH_DB_PORT}`. Host networking has no
effect on Docker Desktop for macOS or Windows.

### Disable the userland proxy

With `"userland-proxy": false` in `/etc/docker/daemon.json` (then restart
Docker), published ports use iptables DNAT, which keeps the client's source
address for external connections. This setting affects every container on the
host.

### Behind a proxy

When a TCP load balancer or reverse proxy sits in front of the server, let it
pass the client address and tell teaoh to trust it:

```toml
[server]
trust_proxy = true
trusted_proxies = ["10.0.0.5"]    # the proxy's address as seen by teaoh
```

- **TCP (game clients):** the proxy must send a PROXY protocol v1 header, for
  example HAProxy `send-proxy` or nginx `stream` with `proxy_protocol on`.
  Connections from a trusted address without the header are closed.
- **WebSocket:** an HTTP proxy must set `X-Forwarded-For` or `X-Real-IP`. teaoh
  uses the last `X-Forwarded-For` entry, the one added by your proxy.

Connections from addresses not in `trusted_proxies` are treated as direct
clients, so players cannot spoof their address by sending these headers
themselves. Inside Docker the proxy's address is usually its container or bridge
address, not `127.0.0.1`.

The vanilla and Deep clients use raw TCP, so for them only host networking, the
DNAT setting or the PROXY protocol preserve the address.
