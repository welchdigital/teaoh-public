# Known limitations

Gaps and restrictions in the current release. Deliberate behaviour differences
from REOSERV are listed separately in [REOSERV_DIFFERENCES.md](REOSERV_DIFFERENCES.md).

## Quests

- The quest conditions `IsGender` and `IsClass` work only inside `if`/`elseif`,
  and hidden quests have no separate UI.
- Quest progress is stored as a state index. Reordering the states of a script
  that players have started shifts their progress.

## Maps and world state

- Map saves do not restore ground item ownership and protection timers or NPC
  attacker lists. Admin-spawned NPCs are not saved.
- The `maps` reload only reloads maps that were loaded at startup; new map files
  need a restart.
- Guild tags shown on the map for online players are not refreshed after they join
  or leave a guild until they relog.

## Game data

- Endless Online maps and pub files are not included; the operator supplies them,
  and the server does not start without the client pubs and at least one map (see
  [Game data](../README.md#game-data)).
- EOSERV's `home.ini`, `shops.ini`, `skills.ini` and `speech.ini` formats are not
  supported. Homes, shops, skill masters and NPC speech come from
  the server pubs, or from JSON sources with `server.generate_pub`.

## Reloading

- Configuration reloads apply only the sections that are safe to change live.
  `[server]` (except `lang`), `[database]`, `[smtp]`, `[admin]`, `[data]`,
  `[map_saves]` and `world.tick_rate` need a restart.
- After a `pubs` reload, NPC stats update when their map is reloaded, and players
  must relog to download the new files. Run a `drops` reload as well if the item
  list changed.
- `data/arenas.ini` and `data/emails.toml` are read only at startup.

## Accounts

- Email validation and account recovery need a Deep client and a configured SMTP
  server. While email validation is on, vanilla clients cannot create accounts.
- There is no importer for EOSERV databases.

## Networking and administration

- Behind Docker's default port publishing the server sees the Docker gateway
  address for every player, which defeats IP bans and per-IP limits. Use host
  networking or a proxy ([DOCKER.md](DOCKER.md)).
- Packets over a rate limit are dropped without notice to the client.
- The admin API serves plain HTTP. Use an SSH tunnel or a TLS reverse proxy for
  remote access.
- The admin panel's log and chat views are kept in memory (the last 20,000 log
  events and 5,000 chat messages) and are cleared on restart. The audit log is
  stored in the database.
