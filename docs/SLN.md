# Server list (SLN)

teaoh can register with the Apollo Games Server List Network, which lists
servers in the Endless Online client and on the web. The server checks in
periodically; the list then connects back to the game port to confirm the server
is reachable and to read the number of players online.

## Configuration

In `config/teaoh.toml` (or with `TEAOH_SLN_*` environment variables):

```toml
[sln]
enabled = true
url = "https://apollo-games.com/SLN/sln.php/"
host = "game.example.com"      # public hostname or IP players connect to
port = 0                       # public game port; 0 = [server] port
server_name = "My server"
site = "https://example.com/"  # website; falls back to host
rate = 5                       # minutes between check-ins
zone = ""                      # leave empty unless Apollo assigned a zone
client_url = ""                # optional links, sent only when set
discord = ""
facebook = ""
twitter = ""
youtube = ""
```

- teaoh identifies itself with the software name and User-Agent `TeaOH`. The
  list requires HTTPS for software other than EOSERV, so keep the `https://` URL.
  Apollo's certificate covers `apollo-games.com`, not `www.apollo-games.com`.
- Set `port` when players reach the server on a port other than `[server] port`:
  Docker port mappings (`TEAOH_TCP_PORT`), router port forwarding, or a proxy.
- The client version reported to the list is taken from `[server] max_version`.
- The `[sln]` section can be changed with a `config` reload; the check-in timer
  restarts when it changes.

Each check-in is a `GET` of `<url>check` with the parameters `software`, `v`
(server version), `retry`, `host`, `port`, `name`, `url`, `zone`,
`clientmajorversion`, `clientminorversion`, `pusers` (players online),
`maxusers` (`[server] max_players`), `uptime` and any links that are set.

## Requirements for a listing

Both steps must succeed:

1. **Check-in (server to list).** The request must be accepted. Configuration
   mistakes are reported in the response (see the codes below).
2. **Connect-back (list to server).** The list connects to `host:port` and asks
   for the online player list, which teaoh answers before login (hidden admins
   are left out). The game port must be reachable from the internet and `host`
   must resolve to the server from outside. If it cannot connect, the check-in
   fails with `403 Bad server`.

If the server does not appear, check that:

- `host` is the public hostname or IP, not `localhost`, `127.0.0.1` or a LAN
  address;
- the advertised port is forwarded and open in the firewall;
- with a TCP proxy in front of the server, the proxy is listed in
  `[server] trusted_proxies` and sends the PROXY header (see
  [DOCKER.md](DOCKER.md#behind-a-proxy)).

## Monitoring

- The admin panel's **Dashboard** and **Server** pages show the time of the last
  check-in, its result (`ok`, `rejected` or `failed`) and the error, if any.
  **Ping now** checks in immediately (`POST /api/sln/ping`; it returns `409` while
  the SLN is disabled). Under Docker the panel needs `TEAOH_ADMIN_KEY`
  ([DOCKER.md](DOCKER.md#admin-panel)).
- The server log (category `server`) records `sln check-in ok`,
  `sln check-in rejected` with the response body, and `sln check-in failed` for
  network, DNS or timeout errors. Requests time out after 45 seconds.
- `TEAOH_SLN_DEBUG=1` logs every TCP frame in hex, which shows the list's
  connect-back. It is very noisy; use it only while debugging.

## Response codes

The list replies with tab-separated lines, each starting with a three-digit code.
A reply containing a 4xx or 5xx line is reported as `rejected`.

| Code | Meaning |
| ---- | ------- |
| `1xx` | Information (`101 Server`, `102 Admin`). |
| `2xx` | Success. |
| `302` | `Bad zone`: the `zone` is not recognised; leave it empty. |
| `401` | `Bad parameter`: a parameter is malformed, for example `site` is not a full URL. |
| `403` | `Bad server`: the list could not reach `host:port` or read the player list. |
