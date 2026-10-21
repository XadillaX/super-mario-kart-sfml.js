# Süper Mario Kart — TypeScript / sfml.js

A TypeScript port of [vmbatlle/super-mario-kart](https://github.com/vmbatlle/super-mario-kart),
an educational recreation of Super Mario Kart originally written in **C++ with SFML 2.5.1**.
This version uses **[sfml.js](https://github.com/XadillaX/sfml.js)**, the Node.js
bindings for SFML 3.1, for native windowing, graphics, keyboard input, and audio.

The game runs on the desktop through Node.js. Its 54 TypeScript modules follow
the upstream source directory layout and file names, retaining the original
gameplay, Mode 7 rendering, AI, and assets.

## Gameplay

- Eight drivers: Mario, Peach, Bowser, Koopa Troopa, Luigi, Yoshi, Donkey Kong Jr., and Toad.
- Grand Prix across five circuits, or a single circuit through the **Versus** menu.
  Both modes pit one human player against seven AI drivers.
- 50cc, 100cc, and 150cc, with drifting, jumps, coins, items, and Lakitu recovery.
- Race results, cumulative Grand Prix standings, podium animations, and an
  automatic race demo when the title screen is idle.

| Circuit | Course overview |
| --- | --- |
| Donut Plains 1 | [View map](./examples/specs_donut_plains_1.png) |
| Mario Circuit 2 | [View map](./examples/specs_mario_circuit_2.png) |
| Ghost Valley 1 | [View map](./examples/specs_ghost_valley_1.png) |
| Bowser Castle 1 | [View map](./examples/specs_bowser_castle_1.png) |
| Rainbow Road | [View map](./examples/specs_rainbow_road.png) |

These previews come from the upstream project and show the assets retained by this port:

<p>
  <img src="./examples/rainbow_road.png" alt="Yoshi racing on Rainbow Road" width="343"/>
  <img src="./examples/donut_plains.png" alt="Mario racing on Donut Plains" width="343"/>
</p>

[Gameplay animation](./examples/gameplay.gif) · [Items in action](./examples/chaos.gif)

## Requirements

Downloadable application packages include Node.js, SFML, the native binding,
and the game assets. They do not require a separate Node.js installation.
The following requirements apply when running from source:

- Node.js **22.22.2 or newer**, with npm.
- A graphical desktop and audio output for the native SFML window.
- The native build prerequisites described in the
  [sfml.js installation guide](https://www.npmjs.com/package/sfml.js).

The game installs **sfml.js 1.0.0** from npm. Its installation script
downloads the SFML libraries and builds the Node.js native binding.

## Install and run

Run these commands from `super-mario-kart-sfml.js`:

```bash
npm install
npm start
```

`npm start` compiles the game into `dist/` and launches it. The entry point
resolves asset paths from the project root.

The project pins **TypeScript 7.0.2**. Its `Node16` module mode follows Node's
resolution rules while emitting CommonJS for this package. Dynamic imports use
`.js` extensions to match the compiled files.

For development:

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Check all TypeScript modules without emitting files |
| `npm run build` | Compile to `dist/` with source maps |
| `npm run build:release` | Type-check and bundle into a single tree-shaken `dist/main.js` |
| `node dist/main.js` | Run the compiled game |
| `npm run dev` | Build and run, equivalent to `npm start` |

## Desktop packages

The [Desktop release workflow](https://github.com/XadillaX/super-mario-kart-sfml.js/actions/workflows/release.yml)
builds these native packages:

| Platform | Downloads | Installation |
| --- | --- | --- |
| macOS 13+, Intel | `macos-x64.dmg`, `macos-x64.zip` | Open the DMG and drag the game into Applications |
| macOS 13+, Apple Silicon | `macos-arm64.dmg`, `macos-arm64.zip` | Open the DMG and drag the game into Applications |
| Windows x64 | Setup `.exe`, portable `.zip` | Run the installer, or extract the entire portable ZIP |
| Ubuntu 24.04+ x64 | `.deb`, `.AppImage` | Install the Debian package, or make the AppImage executable and run it |

Actual filenames also include the game version. All packages contain the same
game code and assets; the executable embeds **Node.js 22.22.2**. Windows portable
downloads must keep the `app` directory and DLLs beside the executable.

Release packaging runs esbuild directly on the TypeScript sources and replaces
`dist/` with one readable `main.js`, without source maps or extra chunks. It folds
dynamic game imports into that file and removes unused code where possible.
The SFML package, native binding, shared libraries, and assets remain external.
Packaged smoke tests exercise the same bundled game classes.

The macOS app is ad-hoc signed and **not notarized**. macOS may block its first
launch: after trying to open the installed app, use **System Settings → Privacy
& Security → Open Anyway**. There is no Developer ID or Apple account dependency
in the build workflow. Windows builds are also unsigned.

For Ubuntu:

```bash
sudo apt install ./super-mario-kart-*.deb
chmod +x ./super-mario-kart-*.AppImage
./super-mario-kart-*.AppImage
```

AppImage needs FUSE 2 (`sudo apt install libfuse2t64` on Ubuntu 24.04).
`./super-mario-kart-*.AppImage --appimage-extract-and-run` runs without FUSE.
A graphical desktop with OpenGL support is required.

Pushes, pull requests, and manual workflow runs upload downloadable **Actions
artifacts**. Pushing a version tag matching `package.json`, such as `v1.0.0`,
publishes a GitHub Release only after all four native builds and packaged
runtime smoke tests pass. Releases include `SHA256SUMS`.

To package locally, use Node.js **22.22.2**, install dependencies with `npm ci`,
and run:

```bash
npm run typecheck
npm test
npm run package
```

Output goes to the ignored `release/` directory. Packaging runs natively on the
target OS and architecture. It requires Xcode command-line tools on macOS,
NSIS and Visual C++ tools on Windows, or the Linux dependencies installed by
the workflow. All packaging scripts are JavaScript; Python is used only by
`node-gyp` while compiling the native dependency.

## Controls

| Action | Default key |
| --- | --- |
| Accelerate | X |
| Brake | Z |
| Hop / drift | C |
| Steer | Left / Right |
| Use item forward | Up |
| Use item backward | Down |
| Pause | Escape |
| Navigate menus | Arrow keys |
| Confirm / skip race flyover | Enter |
| Cancel / go back | Escape |

In the pause menu, choose **No** and press **Enter** to resume, or choose
**Yes** to give up. The **Controls** menu changes key bindings; **Settings**
adjusts music volume, sound effects volume, and resolution. Preferences are
saved in `smk_settings.cfg` inside the platform's writable user configuration
directory:

- macOS: `~/Library/Application Support/super-mario-kart-sfml.js/`
- Windows: `%APPDATA%/super-mario-kart-sfml.js/`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/super-mario-kart-sfml.js/`

Set `SMK_CONFIG_DIR` to choose another directory. An existing configuration
in the game directory is imported once when the user configuration is absent.

Mario and Luigi have balanced handling. Peach and Yoshi accelerate faster;
Koopa and Toad turn faster; Bowser and Donkey Kong Jr. have more weight and a
higher top speed. Coins raise top speed, up to ten coins. Starting acceleration
at the second countdown light gives a boost; starting too early causes a spinout.

## Source layout

```text
src/
├── main.ts       # Entry point
├── game.ts       # Window, state stack, and fixed-step game loop
├── settings.ts   # Saved preferences
├── ai/           # Gradient paths and race-position calculations
├── audio/        # Music, effects, and spatial engine sounds
├── entities/     # Drivers, physics, collisions, items, and animations
├── gui/          # Bitmap text, timer, ranking, and HUD effects
├── input/        # Keyboard actions and configurable bindings
├── map/          # Terrain, floor objects, Mode 7, and minimap
└── states/       # Menus, races, results, and podium
assets/           # Original circuit, sprite, music, and sound assets
examples/         # Upstream gameplay previews and course diagrams
utils/            # Python circuit-generation and gradient-viewing tools
```

The simulation uses the original 60 Hz fixed update. Resource loading uses
sfml.js's asynchronous APIs; states wait for their resources before running.

## Working on circuits

The Python tools in `utils/` are optional authoring utilities. They require
Python 3, NumPy, and Matplotlib; playing the game does not require Python.

From the repository root:

```bash
python3 utils/generate_map.py \
  -f assets/circuit/mario_circuit_2/base.png \
  -w utils/walls.png \
  -t mario_circuit

python3 utils/generate_floor_objects.py \
  -f assets/circuit/mario_circuit_2/objects.png \
  -o utils/floor_objects.png
```

The first tool generates terrain cells in `base.txt`. The second generates
floor-object records, which must be combined with the material, finish-line,
AI lookahead, and wall-object definitions required by the full `objects.txt`
format. Both tools prompt before replacing an existing output file.

Each playable circuit needs `base.png`, `base.txt`, `objects.txt`, `edge.png`,
`sky_back.png`, `sky_front.png`, `music.ogg`, and `final_lap.ogg`. The AI uses
`gradient.txt` and `position.txt` caches and generates them when they are
missing. Remove those two caches after changing terrain or the finish line
so the next load recomputes them.

Course names and paths are defined in
[`src/states/racemanager.ts`](./src/states/racemanager.ts). The game retains
the upstream five-course layout; replacing a course is the simplest way to
try a custom circuit. `utils/visualize_gradient.py` plots the Donut Plains
gradient by default; edit its input path to inspect another course.

## Credits and license

The original C++ / SFML project is
[vmbatlle/super-mario-kart](https://github.com/vmbatlle/super-mario-kart), by
[Diego Royo](https://github.com/diegoroyo),
[Víctor Martínez](https://github.com/vmbatlle), and
[Javier Giménez](https://github.com/JaviBite).

The TypeScript port uses [sfml.js](https://github.com/XadillaX/sfml.js) by
[XadillaX](https://github.com/XadillaX). The code is distributed under
[GNU GPL v3](./LICENSE), following the upstream project.

Super Mario Kart and its characters, graphics, and music belong to Nintendo.
This is an unofficial educational fan project.
