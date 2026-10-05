# Maps

Endless Online maps are not included with teaoh. Copy the `.emf` files from the
`maps/` folder of an Endless Online client into this directory.

Each file is named after its five-digit map id: `00001.emf` is map 1. Other
names, such as variants like `00005c.emf`, are skipped and listed in the log at
startup. The server does not start without at least one map, and the maps
referenced by the configuration (new character spawn, jail, rescue) should
exist. See [docs/CONFIGURATION.md](../../docs/CONFIGURATION.md#maps).
