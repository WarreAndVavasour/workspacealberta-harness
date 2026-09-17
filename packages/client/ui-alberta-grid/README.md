# @workspacealberta/ui-alberta-grid

English | [中文](README.zh.md)

workspaceAlberta conversation view tab **Grid** (`conversation.view` id `alberta-grid`). This is **v2 / Wilke**: aligned 2D encodings are always visible so a reader can invert every comparison without orbiting a 3D scene.

The plugin is a pure consumer: it registers one view tab and fetches two read-only Railway feeds that already project AESO Current Supply Demand and pool price. It does not add AESO endpoints, invent dollar savings, or write to the Railway app.

## Encodings

Fuel comparison is a shared-baseline bar chart from 0 (Claus Wilke, *Fundamentals of Data Visualization*, ch.17) for Solar / Wind / Gas (cogen+CC+steam+SC) / Hydro+Other / Storage, each labeled in MW and % of AIL. Fuel hues are qualitative Okabe–Ito-like colors (ch.4), reused by the legend and the optional 3D panel. AIL is a large number; the optional 3D “load vessel” is decorative only. Pool price is a numeric `$/MWh` plus a cool–amber–hot sequential/diverging ramp (cool under ~$40, amber mid, hot spikes) — never bloom-as-magnitude and never a rainbow. Intertie (BC / Montana, plus their net) is signed length from 0: import left, export right. The HUD shows poll health (“Live AESO feed”) instead of the CSD `Last update` stamp. Hover and select still report MW and % of load. `?lite` or a failed WebGL probe hides the orbit panel and leaves the same 2D bars. The 3D panel, when mounted, is interactive orbit only (ch.26); it is not required to read any value.

## Data

- `https://web-production-02936.up.railway.app/api/csd` (CSV text)
- `https://web-production-02936.up.railway.app/api/price` (CSV text)

Solar is AESO-visible generation above 5 MW. The view polls every 90s. Mounted via `workspace-alberta.patch.yml`.

## Run and build

From the workspaceAlberta checkout, rebuild the official web client and relaunch only port **3081** (leave :3080 untouched):

```sh
git fetch origin
git checkout workspace-alberta
git pull origin workspace-alberta
pnpm install
DSH_CLIENT_BUILD_PROFILE=official DSH_CLIENT_TITLE=workspaceAlberta pnpm run build
DSH_TELEMETRY_DISABLED=1 pnpm wa --profile web --patch workspace-alberta.patch.yml --host 127.0.0.1 --port 3081 --no-open
```

RaspberryPiBot / CLIbot should pull this branch (or `workspace-alberta` after merge), run the same build, then restart the existing :3081 `dsh` process. Open the **Grid** tab; add `?lite` to force the 2D-only path.

## Model Experience

None, as the Grid view renders AESO-shaped CSV in the browser and registers nothing that reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **CSD last-update stamp is parsed and discarded from the HUD** — the feed clock made a live poll look stale; health is the last successful client poll, not AESO's printed timestamp.
- **3D is optional and non-authoritative** — Pi-class software rasterizers and `?lite` unmount it; the 2D bars remain the comparison encoding.
- **Price table dash rows** — the newest hour often prints `-` before AESO settles; the view keeps the latest numeric `$/MWh` and does not invent a value.
