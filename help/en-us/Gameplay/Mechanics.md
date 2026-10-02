# Mechanics

> Last updated: 2026-10-02

## Power and cooling

- Starting values: capacity **8**, cooling **18**, compute **220**.
- Every program occupies a fixed **load**, and the sum of all towers' load cannot exceed capacity.
  - Scanner 1 · Firewall 2 · Antivirus 2 · Honeypot 1
  - **Upgrading raises load**: +1 per level. Check your power before upgrading.
- Cooling sets how fast temperature falls back toward ambient (35°C). Each **Expand** gives +2 capacity and +3 cooling; the price grows ×1.55 each time, up to level 6.

### Temperature model

Firing generates heat continuously; cooling removes heat proportional to the difference from ambient. Roughly:

```
equilibrium ≈ 35 + 100 × totalLoad × (×2.6 while overclocked) / cooling
```

- **> 92°C**: all towers throttle, fire rate falls linearly to a minimum of 40%.
- **> 126°C**: the core takes overheat damage (faster the hotter it is).
- Each shot also adds a small temperature spike — many fast towers hurt more.

> Bottom line: the more towers you build and upgrade, the more mandatory "Expand" becomes; a throttled army is worse than a smaller cooled one.

## Defense programs

| Program   | Cost | Load | Notes                                                                            |
| --------- | ---- | ---- | -------------------------------------------------------------------------------- |
| Scanner   | 50   | 1    | 2.9 shots/s, single target, short range. Best value for clearing trash           |
| Firewall  | 95   | 2    | 64-radius splash + 45% slow for 1.4s. Great over bus junctions                   |
| Antivirus | 155  | 2    | 252 range, 72 damage, ignores armor. Kills trojans/bosses, slow and power-hungry |
| Honeypot  | 75   | 1    | No attack; +7 compute/s, ×1.8 per upgrade level                                  |

Upgrade effects: damage ×1.72/level, range ×1.10/level, fire rate ×1.18/level, load +1/level. Salvage refunds 60% of everything invested.

## Enemies

| Enemy          | Notes                                            | Core damage |
| -------------- | ------------------------------------------------ | ----------- |
| Virus          | Basic unit                                       | 7           |
| Worm           | Fast, low HP                                     | 4           |
| Trojan         | Tanky, 5 armor, slow                             | 15          |
| Ransomware     | Splits into 2 worms on death                     | 10          |
| Rootkit (boss) | Every 5th wave; high HP and armor, summons worms | 45          |

- Enemy HP scales ×(1 + (wave−1)×0.15); bounty rises slightly too.
- Armor is a flat reduction per hit; the **Antivirus ignores it**.

## Score and records

- Kills grant bounty; clearing a wave adds +wave×10 score.
- On defeat the result is written to `~/.config/LinuxCockpit/kerneldef/stats.json`, keeping only better records.
- CLI: `kerneldef.stats` / `kerneldef.record` / `kerneldef.reset`.
