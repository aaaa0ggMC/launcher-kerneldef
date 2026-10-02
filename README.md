# 内核防线 · Kernel Defense

A dual-bus tower defense game, packaged as an ability for
[Linux System Cockpit](https://github.com/aaaa0ggMC) (Electron + Vue 3 + Vuetify).

Hostile processes crawl along circuit buses toward the CPU core. You install defense
programs on fixed solder pads to stop them — but the machine room is a resource too:
every program draws **power**, firing makes **heat**, and an overbuilt rig **throttles
itself** and eventually cooks the core.

## The idea

Most tower defenses ask "can I afford this tower?". Kernel Defense adds a second,
thematic budget: **you are the cooling and the power supply as well.**

- **Load / capacity** — each tower occupies load; total load ≤ supply capacity.
- **Heat / cooling** — firing raises temperature. Above 92°C all towers throttle;
  above 126°C the core takes overheat damage.
- **Expand** — one upgrade raises capacity _and_ cooling, so scaling always costs.
- **SIGKILL** — click an enemy to delete it instantly (6s cooldown).
- **Overclock** — all towers fire 60% faster for 4s, at 2.6× heat.

## Content

| #   | Enemy      | Notes                                 |
| --- | ---------- | ------------------------------------- |
| 1   | Virus      | basic                                 |
| 2   | Worm       | fast, fragile                         |
| 3   | Trojan     | tanky, armored                        |
| 4   | Ransomware | splits into worms on death            |
| 5   | Rootkit    | boss, every 5th wave, summons minions |

Four towers (Scanner / Firewall / Antivirus / Honeypot), 3 upgrade levels each, endless
waves, persistent records.

## Controls

| Input           | Action                     |
| --------------- | -------------------------- |
| 1–4             | select program             |
| Click empty pad | deploy                     |
| Click a tower   | select (Upgrade / Salvage) |
| Click an enemy  | SIGKILL                    |
| O               | Overclock                  |
| P / Esc         | pause                      |
| Space           | start wave / restart       |

## Install

The game has no third-party dependencies; it lives directly in the main repository:

```bash
cd <launcher> && pnpm install && pnpm dev
```

Records are saved to `~/.config/LinuxCockpit/kerneldef/stats.json` and can be managed
from the Cockpit CLI:

```bash
kerneldef.stats
kerneldef.record --wave 7 --kills 84 --score 1320 --time 420
kerneldef.reset --confirm true
```

## How it's made

- `game/engine.ts`: state machine, power/heat simulation, waves, towers, enemies, rendering
- `game/levels.ts`: map (two buses merging into the core), tower/enemy data, wave generator
- `game/sprites.ts`: every tower, enemy, core and effect is drawn procedurally (Canvas 2D)
- `game/audio.ts`: sound effects and chiptune music, synthesized live with WebAudio
- `assets/*.jpg`: environment backdrops generated locally with ComfyUI (Z-Image Turbo)

## License

MIT. See [LICENSE](LICENSE).
