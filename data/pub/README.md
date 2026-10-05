# Pub files

Endless Online pub files are not included with teaoh. Put them in this
directory:

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

The first four come from the `pub/` folder of an Endless Online client; they are
also sent to game clients. The server does not start without them. The other
five are server-only; each one that is missing is logged as a warning and its
feature is off.

Instead of the binary files you can put JSON sources in
[pub2json](https://github.com/sorokya/pub2json) format in the subdirectories
`classes/`, `items/`, `npcs/`, `spells/`, `shops/`, `inns/` and
`skill_masters/` and enable `server.generate_pub`; the server then rebuilds all
nine files from them at startup. See
[docs/CONFIGURATION.md](../../docs/CONFIGURATION.md#pub).
