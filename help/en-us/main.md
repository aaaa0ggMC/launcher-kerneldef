# Kernel Defense

> Last updated: 2026-10-02

**Kernel Defense** is a dual-bus tower defense game: hostile processes (viruses, worms, trojans, ransomware — and a Rootkit boss every 5th wave) crawl along circuit buses toward the CPU core in the middle. You install defense programs on fixed solder pads to stop them.

What sets it apart from a normal tower defense is that **the machine room itself is a resource**:

- Every program draws **power (load)**, and total load cannot exceed **supply capacity**.
- Programs **generate heat** when they fire; **cooling** brings the temperature down. Above a threshold every program **throttles** (slower fire rate); higher still and the core takes **overheat damage**.
- So building more is never free — you spend compute on **capacity upgrades** (which raise both supply and cooling).

> Quick start: **pick a program → click an empty pad to deploy → click an enemy for SIGKILL → survive wave after wave**.

## What you can do

- 4 defense programs: Scanner (fast single target), Firewall (splash + slow), Antivirus (long-range, armor-piercing), Honeypot (generates compute).
- Each tower upgrades up to level 3; upgrading also raises its power draw.
- 2 manual abilities: **SIGKILL** (instantly damage any enemy, 6s cooldown) and **Overclock** (all towers fire faster for a while, at much higher heat).
- 5 enemy types plus a **Rootkit boss** every 5th wave that keeps summoning worms.
- Endless waves with rising difficulty; records (best wave / most kills / best score) are saved locally.

## Screen at a glance

| Area            | Description                                                                                |
| --------------- | ------------------------------------------------------------------------------------------ |
| Status row      | Wave, core integrity, compute, load/capacity, temperature (with throttle / overheat hints) |
| Build row       | 4 program buttons showing cost ⌘ and load ⚡; number keys 1–4 select                       |
| Action row      | Start now (early start grants compute), Overclock, Expand, Pause                           |
| Selection panel | Appears when a built tower is selected: Upgrade / Salvage                                  |
| Field           | Two buses enter from the left and merge into the CPU core on the right                     |

## Common actions

### Build and upgrade

1. Click a program in the build row (or press 1–4).
2. Empty pads highlight: green = buildable, red = not enough compute or power.
3. Click a built tower to select it; the Upgrade / Salvage panel appears on top.

### SIGKILL and Overclock

- **SIGKILL**: hover an enemy — the cursor becomes a crosshair; click to deal 95 damage. 6s cooldown.
- **Overclock**: press **O** or click the button. For 4 seconds all towers fire 60% faster, but heat rises sharply. 20s cooldown.

### Temperature and power

- Above **92°C** towers throttle; above **126°C** the core starts taking overheat damage.
- **Expand** raises supply capacity (more/stronger towers) and cooling (faster cooldown) at once.
- Leaked enemies damage core integrity; **Repair** spends compute to restore 12 integrity (price rises each time, up to full).

### Pause

- **P** or **Esc** to pause / resume.
