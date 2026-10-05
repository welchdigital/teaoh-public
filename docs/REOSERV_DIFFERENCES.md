# Differences from REOSERV

teaoh follows [REOSERV](https://github.com/sorokya/reoserv) unless there is a
reason not to. These are the deliberate differences; where another reference
server was followed instead, it is named.

## Protocol and connections

- The client sequence number is read as a two-byte value when the expected value
  is 253 or more (EOSERV behaviour).
- `ACCOUNT_REQUEST` rotates the sequence start within 0-240.
- Pub files too large for one packet are split on record boundaries and served by
  file id.
- Idle connections that have not logged in are closed; reconnects per IP are
  rate-limited.
- Trusted proxies (`server.trusted_proxies`) can supply the client IP through the
  PROXY protocol (TCP) or `X-Forwarded-For` (WebSocket).
- Walking is also checked against the server clock, with a small burst allowance.
  A client timestamp wrap is accepted only near midnight, and the Walk rate limit
  covers the whole Walk family.
- Spell cast times are also checked against the server clock.

## Accounts and security

- Email validation and recovery use an expiring PIN bound to the account, with a
  limited number of attempts, and emails are rate-limited per account and per IP.
  This closes an account-takeover flaw in REOSERV's `LOGIN_AGREE` flow.
  Validation requires a Deep client.
- Remember-me tokens are stored hashed and rotated on every use.
- Bans are checked by IP and hardware id when a client connects and by account at
  login. Banning deletes the account's remember-me sessions. Locked accounts are
  refused like banned ones.
- Failed logins are throttled per account and per IP; account creation is
  throttled per connection and per IP; password hashing runs in a bounded queue.
- `first_character_admin` grants High Game Master only when the characters table
  is empty (REOSERV's auto-admin semantics), and does so atomically.
- The in-game password change only changes the logged-in account's password.
- `server.max_players` counts logged-in accounts, including those still choosing
  a character; REOSERV counts selected characters.

## Combat and NPCs

- Sitting regenerates faster than standing (ETHEOS; REOSERV has it reversed).
- Respawning refills HP to maximum.
- A dying character is removed from the map until the respawn warp is accepted
  and cannot act meanwhile.
- Aggressive NPCs without a target still wander.
- Kill notices and attack and spell replies are sent only to nearby players.
- PK spells need a PK map, a target other than yourself, and a spell that is not
  restricted to NPCs. Party members cannot hit each other with PK melee or spells.
- Boss aggression spreads on spell hits as well as melee, and `NpcJunk` is sent for
  every child NPC id.
- Party experience is shared only among members within range of the kill, and
  only they get quest kill credit. The split can be changed with the
  `party_exp_share` formula in `formulas.ini` (variables `members` and `exp`).
- The captcha reward's `RecoverReply` carries total experience.
- Secondary stats scale from the base stats (ETHEOS) unless
  `combat.use_class_formulas` is on. The shipped `formulas.ini` is EOSERV's: the
  hit rate floor is 0.2 (REOSERV 0.5), and sitting players are always hit, in PK
  too.
- An attack refused for weight or missing arrows is answered with a message.
- Kill-steal protection ends when the protecting players leave the map, and
  stationary NPCs also lose bored opponents. An NPC turns to face its target
  before rolling a critical hit.
- Randomly placed NPCs spawn on a free tile; fixed NPCs spawn exactly where the
  map puts them.
- Characters whose home is not an inn respawn at `world.spawn_map`, `spawn_x`,
  `spawn_y`; REOSERV uses the rescue location.

## World

- Closed doors block the step. Warp tiles leading to map 0 are ignored.
- Ground items outside a map's bounds are dropped when the map reloads, and
  clients get a refresh after a map mutation.
- Hidden admins do not broadcast chat, heals, level-ups or combat replies, and do
  not block tiles. They are left out of the online and friend lists and are not
  found by the client's player search.
- Teleport scrolls are not used up when the target map is missing or a warp is
  already pending. Spell scrolls teach the spell at level 1.
- `PlayerRange` is answered with `PlayersAgree`.
- Ground item stacks are capped at 16,194,276.
- Standing up from a chair only moves the character to a free, walkable tile.
- Frozen characters cannot walk, use chairs or teleport scrolls, or be pulled
  into warps. Cursed items cannot be unequipped or swapped out (EOSERV).

## Quests

- Quest item events run after the packets of the operation that triggered them.
- Kill counters are cleared when the quest state changes (EOSERV).
- `KilledPlayers` counts PK kills (EOSERV's one-argument form).
- `rule Cond Action` is supported. `goto End` or `goto Done` without such a state
  finishes the quest. Bare actions such as `Reset()` are accepted.
- Quest-book icons follow REOSERV's priority.
- Quest actions run before the dialog reply is built, so their packets arrive
  first and the dialog shows their effects.
- Quest files numbered 0 are skipped (`QuestUse` quest id 0 means "first
  offered quest").
- EOSERV extensions are accepted: case-insensitive names, `if`/`elseif`/`else`,
  `SetState`, `SetCoord`, and the `hidden`, `hidden_end` and `disabled` flags.

## Economy

- Items change hands only when the trade completes. Any change to an offer resets
  both agreements, and items that would exceed `limits.max_item` are returned to
  the giver.
- Taking from a chest or locker takes what fits when the whole stack does not.
  Chest deposits are clamped, and items deposited by players never occupy spawn
  slots.
- Opening a locked chest answers `ChestClose` with the key, so the client shows
  its "locked" message.
- Lore and cursed items cannot be put in lockers. A stack already in a full
  locker can still grow.
- Chests start filled (`world.chest_spawn_on_boot`); REOSERV fills them after
  their spawn time. Chests open only from an adjacent tile (EOSERV).
- Inn answers are compared case-insensitively. Skill masters enforce each
  skill's level requirement, and their own level range only when it is not zero.
  Skill levels stop at the spell's maximum level.

## Social

- The client's whisper toggle (`GlobalPlayer` / `GlobalRemove`) blocks and allows
  incoming whispers (EOSERV); REOSERV ignores it.
- "Already in a party" replies name the target, and only the leader can remove
  party members.
- A wedding in progress cannot be overwritten, pending marriage requests expire
  after 60 seconds, and `PriestRequest` is limited to one every 3 seconds. The
  priest capitalizes the couple's names.
- Deleting board posts needs Guardian level and proximity to the board; players
  cannot delete their own posts. The admin board is readable by Spy and above.
  Post handles sent to clients are per-player numbers, not database ids.
- Guild deposits are capped before gold is taken. Guild names and tags are
  case-insensitive. Joins, leaves, kicks and disbands are announced in guild chat,
  and kicks and rank changes work for offline members.

## Administration

- Mutes are stored in the database and can be timed: `$mute <player> [duration]`.
- Invalid ban durations are rejected, a duration without a unit means minutes
  (REOSERV reads seconds), and a ban is saved before the announcement and the kick.
- In-game `$` commands only act on characters with a lower admin level (or
  yourself), hidden admins at or above your level are reported as not online, and
  `$set admin` cannot grant your own level or higher unless you are a High Game
  Master.
- `$player` and `$inventory` work on offline characters.
- Player reports are validated, rate-limited, stored in a reports table and posted
  to the admin board.
- The global chat lock applies to everyone, including admins (as in REOSERV).
- The admin API refuses to start on a non-loopback address with an empty or short
  (under 16 characters) key.

## Data files

- The server refuses to start when one of the four client pubs is missing or
  unreadable, or when no map loads, and names the missing files; REOSERV starts
  with empty pubs and no maps. A `pubs` reload that finds a client pub missing
  fails and keeps the loaded pubs. Each missing server pub is logged as one
  warning.
- `server.generate_pub` also accepts the key names written by other pub2json
  versions (`element_ramage`, `minLevel`/`maxLevel`, `hp_heal`/`tp_heal`/`sp_heal`,
  a craft's `item_id`, speech lines as plain strings). Invalid JSON files are
  skipped with a warning instead of stopping the server, and a missing JSON folder
  keeps the existing pub file instead of writing an empty one.
