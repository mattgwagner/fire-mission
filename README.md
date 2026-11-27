# Fire Mission

Side-view artillery duel for 2–4 players on one keyboard. Arcade (degrees and power), Gunner (mils and charge), and Observer (the hill past your ridge is hidden, and a correction comes back in plain language).

```bash
npx wrangler dev
```

Open the URL it prints. Deploy is `npx wrangler deploy` (fire-mission.mattgwagner.workers.dev).

CPU-vs-CPU check, plus a fit check at 1920×1080 and 1366×768:

```bash
node e2e/play.mjs
```
