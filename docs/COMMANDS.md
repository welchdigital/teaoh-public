# Commands

Commands are typed into the public (local) chat box. `#` commands are available
to every player. `$` commands require an admin level and are only processed for
characters whose admin level is above 0; for everyone else a `$` message is
ordinary chat.

Commands and aliases are case-insensitive, and player names are matched
case-insensitively.

## Player commands (`#`)

### Handled by the server

| Command | Alias | Usage | Effect |
| ------- | ----- | ----- | ------ |
| `#autopickup` | `#ap` | `#ap [list \| clear \| add <item> \| remove <item>]` | Manage your auto-pickup list. `list` (the default) opens the list; `add` and `remove` take an item name or id. Only available when `[auto_pickup] enabled = true`; otherwise the command does nothing. |
| `#uptime` | `#u` | `#uptime` | Server uptime, e.g. `Server uptime: 2d 4h 13m 5s`. |
| `#online` | | `#online` | Number of players online. |
| `#loc` | | `#loc` | Your map and coordinates. |
| `#ping` | | `#ping` | Replies `pong`. |

The vanilla client intercepts `#loc` and `#ping` itself (see below), so the
server versions only answer clients that forward them as chat.

Auto-pickup picks up listed items within `[world] drop_distance` tiles every
`[auto_pickup] rate` ticks. The list is saved with the character.

An unrecognised `#` command is sent to the map as normal chat.

### Handled by the vanilla client

The Endless Online client handles these itself; typing them never produces a
chat message.

| Command | Effect |
| ------- | ------ |
| `#usage` | Shows the character's total play time. |
| `#engine` | Shows the client version and render engine. |
| `#ping` | Measures the round trip to the server (the server answers the ping packet). |
| `#loc`, `#location` | Shows the current map and coordinates. |
| `#find <name>` | Asks the server whether a player is online, and whether they are on your map. |
| `#nowall` | Admin client toggle for walking through walls. The server allows it for characters with admin level 1 (Spy) or higher. |
| `#item <name>`, `#npc <name>` | Client-side lookups in the client's own pub files. |
| `#badcaptcha` | Client-internal command; the server has no handling for it. |

## Admin levels

| Value | Name | Short |
| ----- | ---- | ----- |
| 0 | Player | |
| 1 | Spy | |
| 2 | Light Guide | LG |
| 3 | Guardian | GRD |
| 4 | Game Master | GM |
| 5 | High Game Master | HGM |

The first character created on an empty database becomes a High Game Master
when `[character] first_character_admin = true` (the default). Disable it once
your own admin exists. Admin levels are changed with `$set admin <player> <level>`
or from the admin panel.

Rules that apply to every `$` command:

- A command below your level is ignored silently and logged as `admin command denied`.
- An unknown command replies `Unknown command: <name>`.
- Wrong argument counts or types reply with the command's usage.
- In-game admins can only target characters with a lower admin level than their
  own (or themselves). Hidden admins at or above your level are reported as not online.
- Every command that changes state is written to the audit log (see
  [ADMIN.md](ADMIN.md#audit-log)).
- Warps, bans, mutes, item and property changes are refused while the server
  is shutting down.

`$commands` whispers you the list of commands available at your level.

## Admin commands (`$`)

`<player>` is a character name. "Online only" commands reply `<name> is not
online.` for offline characters; the others also work on offline characters by
editing the saved record.

### Light Guide (2)

| Command | Aliases | Arguments | Effect |
| ------- | ------- | --------- | ------ |
| `$warpmeto` | `$wmt` | `<player>` | Warp yourself to a player. Online only. |
| `$player` | `$p` | `<player>` | Open the player info dialog (level, exp, usage, stats, location, weight, bank gold). Works offline. |
| `$inventory` | `$i`, `$inv` | `<player>` | Open the player's inventory and bank. Works offline. |
| `$commands` | `$help` | | Whisper the commands available to you. |

### Guardian (3)

| Command | Aliases | Arguments | Effect |
| ------- | ------- | --------- | ------ |
| `$warp` | `$w` | `<map> [x y]` | Warp yourself. Without coordinates (or with only `x`) you land in the map centre. Coordinates are bounds-checked. |
| `$jail` | `$j` | `<player>` | Send a player to `[world] jail_map/jail_x/jail_y`. Announced server-wide. Works offline. |
| `$free` | `$f` | `<player>` | Release a player to `[jail] free_map/free_x/free_y`. Works offline. |
| `$freeze` | `$l` | `<player>` | Stop a player from walking. Announced. Online only. |
| `$unfreeze` | `$u` | `<player>` | Undo `$freeze`. Announced. Online only. |
| `$mute` | `$m` | `<player> [duration]` | Mute a player. Without a duration the mute lasts `[admin] mute_length` seconds (default 90). Mutes are stored in the database and survive relogs and restarts. Announced when the player is online. Works offline. |
| `$unmute` | | `<player>` | Lift a mute. |
| `$kick` | `$k` | `<player>` | Disconnect a player and announce it. Online only. |
| `$skick` | `$sk` | `<player>` | Disconnect a player without an announcement. Online only. |
| `$global` | `$g` | | Toggle global chat on or off for everyone. Announced. |
| `$announce` | | `<message>` | Send a server-wide announcement under your name (up to 200 characters). |
| `$quake` | `$q` | `[magnitude]` | Shake every map. Magnitude 1-8, default 1. |
| `$hide` | `$x` | | Toggle your visibility. Hidden admins are not shown to players, and their chat, heals and level-ups are not broadcast. |
| `$captcha` | `$c` | `<player> <exp>` | Show a captcha to a player using a Deep client; solving it awards `<exp>` experience. Online only. |

### Game Master (4)

| Command | Aliases | Arguments | Effect |
| ------- | ------- | --------- | ------ |
| `$warptome` | `$wtm` | `<player>` | Warp a player to your position. Online only. |
| `$ban` | `$b` | `<player> [duration]` | Ban a player and announce it. Without a duration the ban is permanent. Works offline. |
| `$sban` | `$sb` | `<player> [duration]` | Ban without an announcement; replies with the ban length. |
| `$remap` | | | Reload your current map from disk. NPCs and chests on it are reset. |
| `$evacuate` | `$e` | | Start an evacuation of your current map, or cancel a running one. Players get warnings every `[evacuate] timer_step` seconds; after `[evacuate] timer_seconds`, non-admin players still on the map are sent to jail. |
| `$spawnnpc` | `$sn`, `$snpc` | `<npc> [amount]` | Spawn NPCs at your position. `<npc>` is a name or id. Admin-spawned NPCs do not respawn and are not saved. |
| `$set` | `$s` | `<property> <player> <value>` | Change a character property (see below). |
| `$skillreset` | | `<player>` | Remove all of a player's spells and set their skill points to `level x [world] skill_points_per_level`. Online only. |

### High Game Master (5)

| Command | Aliases | Arguments | Effect |
| ------- | ------- | --------- | ------ |
| `$spawnitem` | `$si`, `$item`, `$sitem` | `<item> [amount]` | Put an item into your inventory. Default amount 1. |
| `$dropitem` | `$di`, `$ditem` | `<item> [amount]` | Drop an item at your feet. Default amount 1. |

### Names, ids and amounts

`<item>` and `<npc>` accept an id or a name. Names may contain spaces; a trailing
number is read as the amount (`$si big bag 5`). A name is matched exactly first,
then as a prefix, then as a substring. If more than one record matches, the reply
lists the matching ids, except that an NPC name matched exactly picks the first
such NPC.

### Durations

`$mute` and `$ban` durations accept:

- a number of minutes: `30`
- a number with a unit: `90s`, `30m`, `2h`, `1d`, `1w`, `1mon`, `1y`
- combined units: `1d12h`, `2h 30m`
- `perm`, `permanent`, `forever` or `never` for no expiry

Units: `s`/`sec`/`second(s)`, `m`/`min`/`minute(s)`, `h`/`hr`/`hour(s)`,
`d`/`day(s)`, `w`/`wk`/`week(s)`, `mon`/`month(s)` (30 days), `y`/`yr`/`year(s)`
(365 days). Durations are rounded up to whole minutes.
Zero, invalid values and durations over 100 years are rejected.

### What a ban covers

`$ban` and `$sban` record one ban entry covering:

- the character's account;
- an IP address: the player's current IP when online, otherwise the account's
  last login IP (loopback and `trusted_proxies` addresses are skipped);
- the client's hardware id (HDID), when the player is online.

Every connection matching the account, the character or the IP is closed; IP
matches skip characters of Guardian level and above. Bans are checked by IP and
HDID when a client connects and by account at login, and banning deletes the
account's remember-me sessions. Bans can be listed and revoked in the admin
panel.

### `$set` properties

`$set <property> <player> <value>`. The value may contain spaces (for titles).
Changes to online characters are pushed to the client immediately.

| Property | Aliases | Values |
| -------- | ------- | ------ |
| `level` | `lvl` | 0-250. Changing the level adds or removes `[world] stat_points_per_level` stat points and `skill_points_per_level` skill points per level (never below 0). |
| `experience` | `exp` | 0-2,000,000,000 |
| `str`, `int`, `wis`, `agi`, `con`, `cha` | `strength`, `intl`/`intelligence`, `wisdom`, `agility`, `constitution`, `charisma` | 0-64,000 |
| `statpoints`, `skillpoints` | | 0-64,000 |
| `karma` | | 0-2,000 |
| `class` | `classid` | A class id that exists in the class file. |
| `admin` | `adminlevel` | 0-5. You cannot change your own level, and only a High Game Master can grant a level equal to or above their own. |
| `title` | | Up to `[character] max_title_length` characters; empty clears it. |
| `home` | | Up to 32 characters; empty clears it. |
| `fiance`, `partner` | | The name of an existing character, or empty to clear. |
| `gender` | | `male`/`m`/`1` or `female`/`f`/`0` |
| `hairstyle`, `haircolor` | | 0 to `[character] max_hair_style` / `max_hair_color` |
| `skin` | `race` | 0 to `[character] max_skin` |
| `hp`, `tp` | | 0-64,000 |

Numeric values outside these ranges are clamped; an invalid `admin` level or
`class` id is rejected. After an admin level change the target is told to relog
so the client shows every change.

## Player reports and help requests

Players can report another player or ask for help from the client's admin menu
(Admin Interact). Each submission is validated, rate-limited per player
(`[admin] report_cooldown` seconds), stored in the database and posted to the
admin board (`[board] admin_board`, readable by Spy and above). Staff can review
and resolve reports in the admin panel.
