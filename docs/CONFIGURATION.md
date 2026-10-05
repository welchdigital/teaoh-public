# Configuration

## How configuration is loaded

Settings are resolved in three layers; each overrides the one before:

1. Defaults built into the server (`defaultConfig()` in `src/config.ts`).
2. The TOML file `config/teaoh.toml`, or the file named by `TEAOH_CONFIG`. A
   missing file is not an error; defaults apply.
3. Environment variables named `TEAOH_<SECTION>_<KEY>` in upper case, using the
   snake_case section and key names from this page:
   `TEAOH_SERVER_PORT=8078`, `TEAOH_NEW_CHARACTER_SPAWN_MAP=192`,
   `TEAOH_AUTO_PICKUP_ENABLED=true`, `TEAOH_MAP_SAVES_DIR=/srv/saves`.

Value rules:

- Booleans accept `true`, `false`, `1` and `0` in environment variables.
- Arrays and tables are TOML arrays in the file and JSON in environment
  variables, for example
  `TEAOH_ITEMS_PROTECTED_ITEMS='[1,2]'` or
  `TEAOH_LIMITS_PACKET_RATE_LIMITS='[{"family":"Walk","action":"*","limit":250}]'`.
- An array you set **replaces** the default array entirely; entries are not merged.
  Every key of a table entry is required, except `burst` in `packet_rate_limits`.
- Values outside a key's range (the "Range" column below) are clamped, in most
  cases with a warning in the log. A malformed value (text where a number is expected,
  invalid TOML, an unknown `database.driver`, an unknown packet family) stops
  startup with an error.
- Unknown sections and keys are ignored with a warning.

The shipped `config/teaoh.toml` sets the commonly changed keys. Any key on this
page can be added to it.

## Reloading

`POST /api/server/reload` (the **Server** page in the admin panel) reloads parts of
the running server. `$remap` reloads the admin's current map in game.

| Target | Reloads |
| ------ | ------- |
| `config` | `config/teaoh.toml`, environment overrides and the language file. Applies the sections `items`, `map`, `evacuate`, `auto_pickup`, `account`, `character`, `new_character`, `world`, `jail`, `npcs`, `combat`, `guild`, `board`, `barber`, `marriage`, `jukebox`, `sln`, `limits`, `bank`, `chest`, `log` and `server.lang`. |
| `maps` | Every map already loaded, from `data/maps/`. NPCs and chests on each map are reset. New map files are not picked up. |
| `pubs` | The client and server pub files. Online characters' stats are recalculated; players must relog to download new pub files. If one of the four client pubs is missing or unreadable the reload fails and the loaded pubs stay in use. |
| `shops` | Only the server pubs for shops, skill masters, inns and NPC speech. |
| `drops` | NPC drop tables and `global_drops.toml`. Run it after `pubs` if the item list changed. |
| `quests` | Quest scripts. |
| `formulas` | `formulas.ini`; online characters' stats are recalculated. |
| `news` | `news.txt` (it is also re-read automatically when the file changes). |

These need a restart: the `server` section (except `lang`), `database`, `smtp`,
`admin`, `data`, `map_saves`, and `world.tick_rate`. The reload result names any
changed settings that need one. `arenas.ini` and `emails.toml` are read only at
startup.

## Units

A tick is `world.tick_rate` milliseconds (125 ms by default, 8 ticks per second).
Keys measured in ticks, and map timers listed in seconds (drop protection, doors,
warp suction, ghosting, evacuation, jukebox, weddings, NPC respawns), run on the
tick clock and scale if `tick_rate` changes. Connection timeouts, login windows,
email PIN lifetimes, usage and chest spawn times use wall-clock time.

## Sections

### `[server]`

Environment: `TEAOH_SERVER_<KEY>`. Restart required (except `lang`).

| Key | Default | Range | Meaning |
| --- | ------- | ----- | ------- |
| `host` | `"0.0.0.0"` | | Bind address for the TCP and WebSocket listeners. |
| `port` | `8078` | 0-65535 | Game port (TCP). |
| `websocket_enabled` | `true` | | Also serve the game over WebSocket. |
| `websocket_port` | `8079` | 0-65535 | WebSocket port. Plain HTTP requests get `426`. |
| `max_connections` | `300` | 1-65535 | Maximum open connections, including ones still handshaking. |
| `max_connections_per_ip` | `3` | 0-65535 | Simultaneous connections per IP; 0 = unlimited. Applies to loopback too. |
| `max_players` | `200` | 1-64000 | Maximum logged-in accounts; further logins get "server busy". Also reported to the server list. |
| `max_login_attempts` | `3` | 1-1000 | Wrong passwords per connection before it is closed. |
| `ping_rate` | `60` | 5-3600 | Seconds between keep-alive pings; a client that has not answered the previous ping is dropped. |
| `enforce_sequence` | `true` | | Close connections that send a wrong packet sequence number. |
| `min_version`, `max_version` | `"0.0.28"`, `"0.3.29"` | | Accepted client versions. Vanilla v28 reports `0.0.28`; Deep clients report a minor version above 0. |
| `trust_proxy` | `false` | | Take the client address from a proxy when the connection comes from an address in `trusted_proxies`. See below. |
| `trusted_proxies` | `["127.0.0.0/8", "::1"]` | | Addresses or CIDR ranges of trusted proxies. Invalid entries are dropped with a warning. |
| `ip_reconnect_limit` | `10` | >= 0 | Minimum seconds between connections from one IP; 0 disables. Loopback is exempt. |
| `hangup_delay` | `10` | >= 1 | Seconds a new connection has to send its first packet (or PROXY header, or finish the WebSocket upgrade). |
| `accept_timeout` | `30` | 0-3600 | Seconds to complete the connection handshake; 0 disables. |
| `login_timeout` | `600` | 0-86400 | Seconds from connecting to entering the game (login and character selection included); 0 disables. |
| `save_rate` | `5` | >= 0 | Minutes between saves of all online characters and map state; 0 disables periodic saves (logout and shutdown still save). |
| `lang` | `"en"` | 1-32 of `A-Z a-z 0-9 - _` | Language file `lang/<lang>.toml`, next to the config file. Invalid names fall back to `en`. |
| `generate_pub` | `false` | | Rebuild all nine pub files in `data/pub/` from the JSON folders there at startup and on the `pubs`, `shops` and `drops` reloads. See [pub/](#pub). |

**Proxies.** With `trust_proxy = true`, a TCP connection from a trusted address
must begin with a PROXY protocol v1 header (`TCP4` or `TCP6`) or it is closed; the
header's source address becomes the client IP. A WebSocket connection from a
trusted address takes the client IP from the last `X-Forwarded-For` entry, or
from `X-Real-IP`, and is refused if neither is present. Connections from other
addresses are treated as direct. See [DOCKER.md](DOCKER.md#behind-a-proxy).

### `[database]`

Environment: `TEAOH_DATABASE_<KEY>`. Restart required.

| Key | Default | Meaning |
| --- | ------- | ------- |
| `driver` | `"sqlite"` | `sqlite` or `postgres`. Anything else stops startup. |
| `sqlite_path` | `"data/teaoh.db"` | SQLite file, relative to the working directory. Created if missing. |
| `host` | `"127.0.0.1"` | PostgreSQL host. |
| `port` | `5432` | PostgreSQL port. |
| `name` | `"teaoh"` | PostgreSQL database. |
| `user` | `"teaoh"` | PostgreSQL user. |
| `password` | `"teaoh"` | PostgreSQL password. |

Migrations run on startup for both drivers.

### `[account]`

Environment: `TEAOH_ACCOUNT_<KEY>`.

| Key | Default | Range | Meaning |
| --- | ------- | ----- | ------- |
| `delay_time` | `10` | 0-600 | Seconds between account creations per connection and per IP (loopback exempt); also sent to Deep clients. 0 disables. |
| `email_validation` | `false` | | Require an emailed PIN to create an account. Only active when `[smtp]` is configured; while active, vanilla clients cannot create accounts. |
| `recovery` | `false` | | Password recovery by emailed PIN (Deep clients). Needs `[smtp]`. |
| `max_characters` | `3` | | Characters per account. |
| `recovery_show_email` | `true` | | Show the address the recovery email was sent to. |
| `recovery_mask_email` | `true` | | Partly mask that address. |
| `email_pin_ttl` | `10` | | Minutes a PIN stays valid. |
| `email_pin_attempts` | `3` | | Wrong entries before a PIN is discarded. |
| `max_emails_per_account` | `3` | | Emails per hour per email address (validation) or account (recovery); 0 = unlimited. |
| `max_emails_per_ip` | `5` | | Emails per hour per client IP; 0 = unlimited. |
| `max_accounts_per_connection` | `2` | 0-1000 | Accounts one connection may create; 0 = unlimited. |
| `max_accounts_per_ip` | `10` | 0-1000000 | Accounts one IP may create per `account_create_window` (loopback exempt); 0 = unlimited. |
| `account_create_window` | `3600` | 1-604800 | Seconds, sliding window for `max_accounts_per_ip`. |
| `min_password_length` | `6` | 1-128 | Minimum password length. |
| `max_password_length` | `64` | min-128 | Maximum password length. |
| `max_login_failures_per_account` | `10` | 0-1000000 | Failed logins per account within `login_failure_window` before logins are refused; 0 disables. |
| `max_login_failures_per_ip` | `30` | 0-1000000 | Failed logins per IP within the window (loopback exempt); 0 disables. |
| `login_failure_window` | `900` | 1-604800 | Seconds, sliding window for the login failure limits. |
| `password_hash_concurrency` | `2` | 1-64 | Password hashes (argon2) computed at once. |
| `password_hash_queue` | `32` | 0-10000 | Hash requests allowed to wait; beyond that the client is told the server is busy. |

### `[smtp]`

Environment: `TEAOH_SMTP_<KEY>`. Restart required. Email features stay off unless
both `host` and `from_address` are set.

| Key | Default | Meaning |
| --- | ------- | ------- |
| `from_name` | `""` | Sender name. |
| `from_address` | `""` | Sender address. |
| `host` | `""` | SMTP server. |
| `port` | `587` | SMTP port. |
| `username` | `""` | SMTP user; empty = no authentication. |
| `password` | `""` | SMTP password. |
| `secure` | `false` | `true` for TLS from the start (usually port 465); `false` uses STARTTLS when offered. |

Email text can be customised in [`data/emails.toml`](#emailstoml).

### `[character]`

Environment: `TEAOH_CHARACTER_<KEY>`.

| Key | Default | Range | Meaning |
| --- | ------- | ----- | ------- |
| `max_skin` | `3` | 0-252 | Highest skin value at creation, at the barber and for `$set`. |
| `max_hair_style` | `20` | 0-252 | Highest hair style. |
| `max_hair_color` | `9` | 0-252 | Highest hair colour. |
| `min_name_length` | `4` | 1 to max | Minimum character name length. Names use letters a-z only. |
| `max_name_length` | `12` | up to 16 | Maximum character name length. |
| `first_character_admin` | `true` | | The first character created on an empty database becomes a High Game Master. Disable after creating your admin. |
| `max_title_length` | `32` | 0-32 | Maximum title length. |

### `[new_character]`

Environment: `TEAOH_NEW_CHARACTER_<KEY>`.

| Key | Default | Range | Meaning |
| --- | ------- | ----- | ------- |
| `spawn_map` | `192` | | Map where new characters start. |
| `spawn_x`, `spawn_y` | `6`, `6` | | Starting coordinates. |
| `spawn_direction` | `0` | 0-3 | Facing: 0 down, 1 left, 2 up, 3 right. |
| `home` | `"Wanderer"` | | Starting home: the name of an inn in `din001.eid`. Death respawns at the home inn's location, or at `world.spawn_*` when the home matches no inn. |

### `[world]`

Environment: `TEAOH_WORLD_<KEY>`. `tick_rate` needs a restart.

| Key | Default | Range | Meaning |
| --- | ------- | ----- | ------- |
| `tick_rate` | `125` | 10-1000 | Milliseconds per tick. |
| `jail_map`, `jail_x`, `jail_y` | `76`, `5`, `4` | | Jail location (`$jail`, evacuation). Trading and dropping items are blocked on the jail map. |
| `rescue_map`, `rescue_x`, `rescue_y` | `4`, `24`, `24` | | Fallback when a character's map or a warp target does not exist. |
| `spawn_map`, `spawn_x`, `spawn_y` | `192`, `7`, `6` | | Respawn point for characters whose home is not an inn. |
| `exp_multiplier` | `1` | | Multiplier for NPC-kill and quest experience. |
| `stat_points_per_level` | `3` | | Stat points per level. |
| `skill_points_per_level` | `4` | | Skill points per level. |
| `recover_rate` | `720` | | Ticks between player HP/TP regeneration (sitting regenerates faster). |
| `npc_recover_rate` | `840` | | Ticks between NPC HP regeneration. |
| `drop_distance` | `2` | | Maximum distance in tiles for dropping and picking up items. |
| `drop_protect_player` | `5` | | Seconds only the dropper can pick up a dropped item. |
| `drop_protect_npc` | `30` | | Seconds only the killer can pick up an NPC drop. |
| `global_pk` | `false` | | Allow player combat on every map (arenas excepted), not only PK maps. |
| `chest_spawn_on_boot` | `true` | | Chest spawns start filled. When `false` they fill after their spawn time, counted from startup. |
| `chest_spawn_rate` | `480` | >= 1 | Ticks between chest refill checks. |
| `spike_rate` | `12` | | Ticks between timed-spike damage. |
| `spike_damage` | `0.2` | | Fraction of max HP a spike deals. |
| `drain_rate` | `125` | | Ticks between HP/TP drain on drain maps. |
| `drain_hp_damage`, `drain_tp_damage` | `0.1`, `0.1` | | Fraction of max HP/TP drained per pass. |
| `warp_suck_rate` | `15` | | Seconds a player idles next to a warp before being pulled through. |
| `ghost_rate` | `5` | | Seconds a player must stand still before walking onto an occupied tile. |
| `quake_rate` | `40` | | Ticks between quake checks on Quake maps. |
| `quakes` | 4 entries | | Quake timing for map effects Quake1-Quake4 (see below). |
| `usage_rate` | `60` | >= 1 | Seconds of play per point of the character's usage counter (minutes played by default). |
| `info_reveals_drops` | `true` | | Let Deep clients look up NPC drop tables. |
| `walk_interval` | `360` | >= 0 | Milliseconds of server time needed per step; 0 disables the check. |
| `walk_burst` | `3` | >= 1 | Steps that can be taken back to back before `walk_interval` applies. |

`quakes` is an array of four tables, one per quake type. Each quake waits a
random number of checks between `min_ticks` and `max_ticks` (each check is
`quake_rate` ticks apart), then shakes the map with a strength between
`min_strength` and `max_strength`:

```toml
[[world.quakes]]
min_ticks = 4
max_ticks = 12
min_strength = 0
max_strength = 1
# ...three more entries for Quake2, Quake3 and Quake4
```

Defaults: Quake1 4-12 / 0-1, Quake2 6-12 / 0-2, Quake3 2-10 / 3-5, Quake4 1-4 / 6-8.

### `[jail]`

Environment: `TEAOH_JAIL_<KEY>`.

| Key | Default | Meaning |
| --- | ------- | ------- |
| `free_map`, `free_x`, `free_y` | `76`, `9`, `11` | Where `$free` sends a player. |

### `[npcs]`

Environment: `TEAOH_NPCS_<KEY>`.

| Key | Default | Meaning |
| --- | ------- | ------- |
| `act_rate` | `5` | Ticks between NPC AI passes. |
| `chase_distance` | `10` | Tiles within which an NPC chases its target. |
| `bored_timer` | `240` | Ticks without being hit before an NPC forgets its attacker. |
| `instant_spawn` | `false` | Spawn every NPC at startup instead of after its spawn time. The shipped `teaoh.toml` sets `true`. |
| `freeze_on_empty_map` | `true` | Skip NPC AI on maps with no players. |
| `speeds` | `[5, 5, 10, 15, 30, 60, 120]` | Ticks between moves for map spawn speed types 0-6. Type 7 NPCs are stationary. |
| `talk_rate` | `300` | Ticks between NPC speech chances (speech comes from `ttd001.etf`). |

### `[combat]`

Environment: `TEAOH_COMBAT_<KEY>`.

| Key | Default | Meaning |
| --- | ------- | ------- |
| `weapon_ranges` | 4 entries | Ranged weapons: `weapon` (item id), `range` (tiles in a straight line), `arrows` (needs arrows equipped). Other weapons have range 1. |
| `enforce_weight` | `true` | Block attacks while over the weight limit. |
| `use_class_formulas` | `false` | `true`: damage, accuracy, evade and armor come from the `class.N.*` formulas in `formulas.ini`. `false`: they scale from the base stats. |
| `base_min_damage` | `1` | Flat minimum damage added. |
| `base_max_damage` | `2` | Flat maximum damage added. |
| `base_damage_at_zero` | `false` | `true`: add base damage only when the computed damage is 0. |
| `cast_time_slack` | `200` | Milliseconds of tolerance on spell cast times. |

Default `weapon_ranges`:

```toml
[[combat.weapon_ranges]]
weapon = 297
range = 5
arrows = true
# also 316 (5, arrows), 457 (5, arrows) and 365 (10, no arrows)
```

### `[guild]`

Environment: `TEAOH_GUILD_<KEY>`.

| Key | Default | Range | Meaning |
| --- | ------- | ----- | ------- |
| `min_players` | `10` | | Founders needed to create a guild, including the leader. |
| `create_cost` | `50000` | | Gold to create a guild. |
| `recruit_cost` | `1000` | | Gold taken from the guild bank per recruit. |
| `min_deposit` | `1000` | | Minimum guild bank deposit. |
| `bank_max_gold` | `2000000000` | | Guild bank limit. |
| `min_tag_length`, `max_tag_length` | `2`, `3` | | Tag length. |
| `max_name_length` | `24` | | Guild name length. |
| `max_description_length` | `240` | | Description length. |
| `max_rank_length` | `16` | | Rank name length. |
| `default_leader_rank_name` | `"Leader"` | | Rank 1 name for new guilds. |
| `default_recruiter_rank_name` | `"Recruiter"` | | Rank 2 name. |
| `default_new_member_rank_name` | `"New Member"` | | Rank 9 name. |
| `recruit_rank` | `1` | 1-9 | Ranks 1 to N may recruit. The default allows only the leader. |
| `announce` | `true` | | Announce joins, leaves, kicks and disbands in guild chat. |

### `[board]`

Environment: `TEAOH_BOARD_<KEY>`.

| Key | Default | Range | Meaning |
| --- | ------- | ----- | ------- |
| `max_posts` | `20` | 1-252 | Posts kept per board. |
| `max_user_posts` | `6` | >= 1 | Posts one character may have on a board. |
| `max_recent_posts` | `2` | >= 1 | Posts one character may make per board within `recent_post_time`. |
| `recent_post_time` | `30` | >= 0 | Minutes. |
| `max_subject_length` | `32` | 1-64 | Longer subjects are cut. |
| `max_post_length` | `2048` | 1-2048 | Longer posts are cut. |
| `date_posts` | `true` | | Show post age next to subjects. |
| `admin_board` | `5` | 1-8 | Board number reserved for staff (Spy and above). Player reports are posted here. |
| `admin_max_posts` | `100` | 1-252 | Posts kept on the admin board. |

### `[barber]`

Environment: `TEAOH_BARBER_<KEY>`.

| Key | Default | Range | Meaning |
| --- | ------- | ----- | ------- |
| `base_cost` | `0` | 0-2000000000 | Base haircut price. |
| `cost_per_level` | `200` | 0-2000000000 | Added per character level. |

### `[marriage]`

Environment: `TEAOH_MARRIAGE_<KEY>`.

| Key | Default | Meaning |
| --- | ------- | ------- |
| `approval_cost` | `500` | Gold the law office charges to approve a marriage. |
| `divorce_cost` | `10000` | Gold for a divorce. |
| `female_armor_id`, `male_armor_id` | `163`, `133` | Armor that must be worn at the wedding. |
| `min_level` | `5` | Minimum level to marry. |
| `ring_item_id` | `374` | Ring given to both partners; 0 disables. |
| `ceremony_start_delay_seconds` | `20` | Delay before the priest starts. |
| `mfx_id` | `40` | Music effect played when the ceremony starts; 0 disables. |
| `celebration_effect_id` | `1` | Spell effect shown on the couple; 0 disables. |

### `[jukebox]`

Environment: `TEAOH_JUKEBOX_<KEY>`.

| Key | Default | Range | Meaning |
| --- | ------- | ----- | ------- |
| `cost` | `25` | 0-2000000000 | Gold per song. |
| `max_track_id` | `20` | | Highest selectable track. |
| `track_timer` | `90` | >= 0 | Seconds before the jukebox takes another request. |
| `instrument_items` | `[49, 50]` | | Instrument ids (the equipped weapon's `spec1` in the item file) that can be played as a bard. |
| `max_note_id` | `36` | | Highest playable note. |

### `[sln]`

Environment: `TEAOH_SLN_<KEY>`. See [SLN.md](SLN.md).

| Key | Default | Meaning |
| --- | ------- | ------- |
| `enabled` | `false` | Check in with the server list. |
| `url` | `"https://apollo-games.com/SLN/sln.php/"` | Server list endpoint. |
| `host` | `""` | Public hostname or IP players connect to. Always set it before enabling; an empty host with `enabled = true` logs a warning. |
| `site` | `""` | Website URL; falls back to `host`. |
| `server_name` | `"teaoh"` | Name shown in the list; also `{server}` in emails. |
| `rate` | `5` | Minutes between check-ins (minimum 1). |
| `zone` | `""` | Server list zone; leave empty unless assigned one. |
| `client_url`, `discord`, `facebook`, `twitter`, `youtube` | `""` | Optional links; sent only when set. |
| `port` | `0` | Port advertised to the list; 0 = `server.port`. Set it when players reach the server on a different port (port forwarding, Docker). |

### `[limits]`

Environment: `TEAOH_LIMITS_<KEY>`. `max_send_buffer` applies to new connections.

| Key | Default | Range | Meaning |
| --- | ------- | ----- | ------- |
| `packet_rate_limits` | 66 entries | | Per-connection packet rate limits (below). |
| `max_queued_packets` | `64` | >= 1 | Packets waiting to be handled per connection before it is closed. |
| `max_send_buffer` | `1048576` | >= 65536 | Bytes of unsent output per connection before it is closed. |
| `max_party_size` | `9` | 2-252 | Party members. |
| `max_bank_gold` | `2000000000` | 0-2000000000 | Gold a character can keep in the bank. |
| `max_item` | `2000000000` | 1-2000000000 | Most of one item a character can carry. |
| `max_trade` | `2000000000` | 1 to `max_item` | Most of one item per trade offer. |
| `max_chest` | `10000000` | 1-16194276 | Largest stack in a map chest. |

**Packet rate limits.** Each entry `{ family, action, limit, burst }` gives a
connection a bucket of `burst` tokens (1-100, default 1) that refills one token
every `limit` milliseconds (0-1000). Packets that arrive with an empty bucket are
dropped silently. `action = "*"` shares one bucket across the whole family; an
exact family and action entry takes precedence over `*`. `limit = 0` removes the
limit for that entry. Family and action names are EO packet names
(case-insensitive); `Init` and `Connection` are never limited.

The defaults do not limit account creation, login and character selection
packets: the client waits for their replies, and a dropped packet leaves it
stuck. Those are protected by the throttles in `[account]` instead. Avoid adding
limits for them.

Setting `packet_rate_limits` replaces the whole default list, so copy the entries
you want to keep:

```toml
[[limits.packet_rate_limits]]
family = "Walk"
action = "*"
limit = 300

[[limits.packet_rate_limits]]
family = "Talk"
action = "Report"
limit = 500
burst = 5
```

#### Default packet rate limits

| Limit | Packets |
| ----- | ------- |
| 100 ms, burst 3 | Item Get |
| 120 ms | Emote Report, Face Player, Sit Request |
| 150 ms, burst 3 | Item Use, Item Drop, Item Junk, Paperdoll Add, Paperdoll Remove |
| 200 ms, burst 10 | NpcRange Request, PlayerRange Request, Range Request |
| 300 ms | Spell Request, Spell TargetSelf, Spell TargetOther, Spell TargetGroup, Walk `*` |
| 500 ms | Attack Use, Door Open, Party Request |
| 500 ms, burst 5 | Talk Request, Talk Open, Talk Tell, Talk Report, Talk Admin |
| 1000 ms | Account Agree, AdminInteract Tell, AdminInteract Report, Bank Open, Barber Open, Board Open, Board Take, Board Create, Board Remove, Book Request, Chair Request, Chest Open, Citizen Open, Guild Request, Guild Accept, Guild Agree, Guild Buy, Guild Create, Guild Junk, Guild Kick, Guild Player, Guild Rank, Guild Remove, Guild Take, Guild Open, Guild Tell, Guild Report, Guild Use, Jukebox Msg, Locker Open, Marriage Request, Paperdoll Request, Players Accept, Players Request, Players List, Priest Request, Refresh Request, Shop Open, Trade Request |
| 1000 ms, burst 3 | Talk Msg, Talk Announce |

### `[bank]`

The item locker. Environment: `TEAOH_BANK_<KEY>`.

| Key | Default | Range | Meaning |
| --- | ------- | ----- | ------- |
| `max_item_amount` | `200` | 1-16194276 | Most of one item in a locker. |
| `base_size` | `25` | 0-252 | Locker slots before upgrades. |
| `size_step` | `5` | 0-252 | Slots added per upgrade. |
| `max_upgrades` | `7` | 0-252 | Number of upgrades available. |
| `upgrade_base_cost` | `1000` | 0-2000000000 | Gold for the first upgrade. |
| `upgrade_cost_step` | `1000` | 0-2000000000 | Added to the price for each upgrade already bought. |

### `[chest]`

Environment: `TEAOH_CHEST_<KEY>`.

| Key | Default | Range | Meaning |
| --- | ------- | ----- | ------- |
| `slots` | `5` | 1-252 | Item stacks a map chest holds, including spawn slots. |

### `[items]`

Environment: `TEAOH_ITEMS_<KEY>`. Invalid ids are dropped with a warning.

| Key | Default | Meaning |
| --- | ------- | ------- |
| `infinite_use_items` | `[]` | Item ids that are not consumed when used. |
| `protected_items` | `[]` | Item ids that cannot be dropped, junked or traded. |

### `[map]`

Environment: `TEAOH_MAP_<KEY>`.

| Key | Default | Range | Meaning |
| --- | ------- | ----- | ------- |
| `door_close_rate` | `3` | >= 1 | Seconds before an opened door closes. |
| `max_items` | `250` | | Ground items per map; the oldest are removed beyond this. 0 or less = unlimited. |

### `[evacuate]`

Environment: `TEAOH_EVACUATE_<KEY>`.

| Key | Default | Range | Meaning |
| --- | ------- | ----- | ------- |
| `sfx_id` | `51` | 0-252 | Sound played with each warning. |
| `timer_seconds` | `60` | >= 0 | Countdown for `$evacuate`. When it ends, non-admin players still on the map are jailed. |
| `timer_step` | `15` | >= 1 | Seconds between warnings. |

### `[auto_pickup]`

Environment: `TEAOH_AUTO_PICKUP_<KEY>`.

| Key | Default | Range | Meaning |
| --- | ------- | ----- | ------- |
| `enabled` | `false` | | Enable the `#autopickup` command. |
| `rate` | `8` | >= 1 | Ticks between auto-pickup passes. |

### `[map_saves]`

Environment: `TEAOH_MAP_SAVES_<KEY>`. Restart required.

| Key | Default | Meaning |
| --- | ------- | ------- |
| `enabled` | `true` | Save and restore map state across restarts. |
| `dir` | `""` | Directory for the saves; empty = `<data.dir>/map_saves`. |

A save holds ground items, NPC positions and HP, NPC respawn timers, chest
contents and chest spawn timers. Saves are written every `server.save_rate`
minutes, by **Save all** in the admin panel and on shutdown, and read at startup.
A save is ignored when its map file has changed. Restored items lose their owner
protection, and NPCs forget their attackers. Admin-spawned NPCs are not saved.

### `[admin]`

Environment: `TEAOH_ADMIN_<KEY>`. Restart required. See [ADMIN.md](ADMIN.md).

| Key | Default | Range | Meaning |
| --- | ------- | ----- | ------- |
| `enabled` | `true` | | Start the admin HTTP API and panel. |
| `host` | `"127.0.0.1"` | | Bind address. |
| `port` | `8080` | | HTTP port. |
| `key` | `""` | | API key. Required, with at least 16 characters, unless `host` is a loopback address. |
| `cors_origin` | `"*"` | | Allowed browser origins: `""` none, `"*"` any (only with a key), or a comma-separated list. The shipped config uses `""`. |
| `allowed_hosts` | `[]` | | `Host` header values accepted besides loopback names and the bind address. With a key and an empty list, any host is accepted; without a key, only loopback names. Entries are `name` or `name:port`. |
| `ui_dir` | `"admin-ui/dist"` | | Built panel served at `/`. |
| `max_auth_failures` | `10` | >= 1 | Wrong keys per address before a lockout; the correct key is always accepted. |
| `auth_lockout_seconds` | `300` | >= 1 | Lockout length and failure-counting window. |
| `report_cooldown` | `60` | >= 0 | Seconds between in-game reports or help requests from one character. |
| `mute_length` | `90` | >= 1 | Seconds a `$mute` without a duration lasts. |

### `[data]`

Environment: `TEAOH_DATA_<KEY>`. Restart required.

| Key | Default | Meaning |
| --- | ------- | ------- |
| `dir` | `"data"` | Game data directory (see below). |

### `[log]`

Environment: `TEAOH_LOG_<KEY>`.

| Key | Default | Meaning |
| --- | ------- | ------- |
| `level` | `"info"` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` or `silent`. Invalid values fall back to `info`. |

## Other environment variables

| Variable | Effect |
| -------- | ------ |
| `TEAOH_CONFIG` | Path of the config file (default `config/teaoh.toml`). Language files are read from `lang/` next to it. |
| `TEAOH_LOG_JSON=1` | Write JSON log lines instead of the coloured console format. |
| `NODE_ENV=production` | Same as `TEAOH_LOG_JSON=1` (set in the Docker image). |
| `TEAOH_SLN_DEBUG=1` | Log every TCP frame in hex. Very noisy; for protocol debugging only. |

## Data files

Paths are relative to `data.dir` (default `data/`) unless stated otherwise.
Endless Online game data is not included; supply your own maps and pub files (see
[Game data](../README.md#game-data)). The server refuses to start when one of the
four client pubs is missing or unreadable, or when no map loads, and the error
names the missing files. Other missing files are logged as warnings and do not
stop startup, so check the log after changing `data.dir`.

### `pub/`

| File | Required | Contents |
| ---- | -------- | -------- |
| `dat001.eif` | yes | Items |
| `dtn001.enf` | yes | NPCs |
| `dsl001.esf` | yes | Spells |
| `dat001.ecf` | yes | Classes |
| `dtd001.edf` | no | NPC drop tables |
| `dts001.esf` | no | Shops |
| `dsm001.emf` | no | Skill masters |
| `din001.eid` | no | Inns and homes |
| `ttd001.etf` | no | NPC speech |

The first four come from an Endless Online client and are sent to clients. Files
larger than one packet are split on record boundaries automatically. Each missing
server pub is logged as one warning and its feature is off: no shops or crafting,
no skill masters, no inns (characters respawn at `world.spawn_map`), no NPC speech,
and NPC drops come from `drops.ini`. Reload with `pubs` (all), `shops` (the last
four) or `drops`.

**JSON pubs.** With `server.generate_pub = true` the server rebuilds these files
from the JSON folders in `pub/` (`classes/`, `items/`, `npcs/`, `spells/`,
`shops/`, `inns/`, `skill_masters/`, in [pub2json](https://github.com/sorokya/pub2json)
format) and overwrites them before loading. Files are read in
name order, and the Nth file of `classes/`, `items/`, `npcs/` or `spells/` is
record N. Drops and speech come from the `drops`, `talk_rate` and `talk_messages`
fields of the NPC files. A file that is not valid JSON or holds out-of-range
values is skipped with a warning; in those four folders it becomes an empty
record so later ids do not shift. A missing folder, or one without a usable file,
leaves its binary file untouched.

### `maps/`

One `.emf` file per map, named after the five-digit map id (`00001.emf` is map 1;
the extension may be upper case). Other names, such as the variants `00005c.emf`
and `00136bb.emf`, are skipped and listed in one log line at startup. To use a
variant, give it the map's file name. At least one map is required.

### `formulas.ini`

Stat and combat formulas in EOSERV's reverse Polish notation, one `key = expression`
per line; `#` starts a comment. Keys: `hp`, `tp`, `sp`, `weight`, `hit_rate`,
`damage`, `class.N.damage`, `class.N.accuracy`, `class.N.evade`,
`class.N.defence` and `party_exp_share`. A missing file or formula, or one that
fails to evaluate, falls back to a built-in value and logs a warning.

`party_exp_share` receives `members` (party members in range of the kill) and
`exp` (the kill's experience) and returns each member's share. Without it the
built-in rule gives `exp / 2` for two members and `exp * (1 + members) / members`
for more.

The shipped `hit_rate` and `damage` are EOSERV's defaults, the closest match to the
official server. EOSERV also documents two alternatives:

```ini
hit_rate = 100 modifier target_evade * / 0.8 1.0 critical ? 100 accuracy / + - 0.2 max 1.0 min
damage = 3 target_armor / modifier * damage - 0.1 damage * ceil max 1 1.5 critical ? *
```

The first pair is EOSERV's pre-0.7.0 formula. The second, from the EO clone project:

```ini
hit_rate = 2 target_evade 1 + target_evade 1 + accuracy 2 + - / * 0 - exp 1 + 1 / 1.0 target_sitting ?
damage = 2 2 target_armor damage / pow / damage * 2 target_armor / damage - damage target_armor < ? 1 max 1 1.5 critical ? *
```

### `drops.ini`

Used only when `pub/dtd001.edf` cannot be loaded.

```ini
# npc_id = item_id,min,max,percent, item_id,min,max,percent, ...
10 = 2,3,4,0.5, 1,1,10,100
```

### `global_drops.toml`

Drops that can come from any NPC, rolled together with the NPC's own table.
Optional.

```toml
[[drops]]
item_id = 1
min_amount = 1
max_amount = 1000
rate = 100        # percent, 0-100
```

### `arenas.ini`

Arena definitions keyed by map id. Optional; read at startup only.

```ini
10.enabled = yes
10.time = 30                      # seconds between launches (also 30s, 1m)
10.block = 3                      # no launch while this many players are still in the arena
10.spawns = 11,9, 7,11, 11,6, 4,4 # from_x,from_y,to_x,to_y groups
```

Every `time` seconds, players standing on a `from` tile are warped to the
matching `to` tile and the round starts.

### `emails.toml`

Optional overrides for the validation and recovery email text. Placeholders:
`{server}` (the `sln.server_name`), `{name}`, `{code}` and `{minutes}`. Read at
startup only.

```toml
[validation]
subject = "{server} confirmation code"
body = """
Hi {name},
Your confirmation code is {code}. It expires in {minutes} minutes.
"""

[recovery]
subject = "{server} account recovery"
body = "Your recovery code is {code}."
```

### `news.txt`

Up to nine lines of news, sent to the client when a character enters the game.
Changes are picked up automatically.

### `quests/`

Quest scripts in the EOSERV format, named by quest id (`00001.eqf`; `.txt` also
works). A `quests/quests/` subdirectory is also scanned. Scripts that fail to
parse are skipped with a warning. Reload with `quests`.

### `map_saves/`

Map state written by the server (see [`[map_saves]`](#map_saves)). Safe to delete
while the server is stopped to reset all maps.

### `config/lang/<lang>.toml`

Server message strings (admin announcements, evacuation and shutdown warnings,
wedding lines, guild and arena notices). The file is chosen by `server.lang` and read from
the `lang/` directory next to the config file. Keys missing from the file, or the
whole file if it is missing or invalid, use the built-in English text.
Reloaded with the `config` target.

| Key | Sent | Placeholders |
|---|---|---|
| `announce_freeze` | An admin freezes a player. | `{victim}`, `{name}` (admin) |
| `announce_unfreeze` | An admin unfreezes a player. | `{victim}`, `{name}` |
| `announce_remove` | A player is kicked, banned or jailed. | `{victim}`, `{name}`, `{method}` (`kicked`, `banned`, `jailed`) |
| `announce_mute` | An admin mutes an online player. | `{victim}`, `{name}` |
| `announce_global` | An admin toggles global chat. | `{state}` (`on`/`off`), `{name}` |
| `global_locked` | A player uses global chat while it is locked. | |
| `wedding_start` | The priest agrees to start a ceremony. | `{delay}` (seconds), `{name}`, `{partner}` |
| `wedding_one`, `wedding_two`, `wedding_three`, `wedding_four`, `wedding_five` | Priest lines during the ceremony. | `{name}`, `{partner}` |
| `wedding_do_you` | The priest asks each spouse. | `{name}`, `{partner}` |
| `wedding_i_do` | Each spouse accepts. | |
| `wedding_end` | The ceremony ends. | |
| `wedding_error` | The ceremony is aborted. | |
| `evacuate_warning`, `evacuate_last_warning` | Map evacuation countdown. | `{seconds}` |
| `shutdown_warning` | Scheduled shutdown countdown; an admin message is appended. | `{time}` (e.g. `1 minute 30 seconds`), `{seconds}` |
| `shutdown_cancelled` | A scheduled shutdown is cancelled. | |
| `guild_joined` | A member joins a guild (`guild.announce`). | `{member}`, `{recruiter}` |
| `guild_left` | A member leaves. | `{member}` |
| `guild_kicked` | A member is kicked. | `{member}`, `{name}` |
| `guild_disbanded` | A guild is disbanded (always sent when an admin disbands it). | `{name}` |
| `arena_aborted` | The last arena opponent leaves. | |

### Files the server does not read

EOSERV's `home.ini`, `shops.ini`, `skills.ini` and `speech.ini` formats are not
supported; homes, shops, skill masters and NPC speech come from the
server pubs above. The JSON folders under `pub/` are read only with
`server.generate_pub`.
