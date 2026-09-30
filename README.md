# QUBIC Monitoring

Local prototype of the new QUBIC cryogenic monitoring system.

## Prototype status

- incremental ingestion from ASCII files into a local SQLite database;
- detection of replaced or truncated source files;
- per-channel freshness and data-quality tracking;
- compact snapshots for the web interface;
- lightweight status polling: the multi-megabyte snapshot is fetched only when its generation timestamp changes;
- compact binary-like point tuples in JSON and isolated tooltip updates, avoiding full-chart rerenders while the mouse moves;
- every plotted tuple is `[timeMs, value, bucketMin, bucketMax]`, so extrema
  remain available for all channels (not only Touch);
- viewport-aware chart decimation that keeps local extrema (including short fridge
  peaks) while bounding SVG work, plus a bounded cache for repeated channel selections;
- 30-second binary aggregates instead of repeatedly parsing full ASCII histories;
- interactive views for all instrument temperatures, cryostat pressure,
  normalized Touch/1 K correlation, both compressors and site weather;
- global observatory banner, analysis-mode navigation and central housekeeping selector;
- channel selection by human label and original source-file name;
- mouse-drawn rectangular zoom on both axes, logarithmic scale and 1 h, 2 h, 48 h, 7 d, 30 d and full-history windows;
- zoom-aware time labels and subtle timezone-aware vertical markers at local day boundaries;
- logarithmic bounds derived from the positive data currently visible, without an arbitrary low floor;
- selectable weather channels, Open-Meteo forecast overlays and an optional local 7-day RMS envelope centred on each current curve;
- polar wind view combining the current vector, time-faded recent samples and selectable full-cooldown, 24-hour or 7-day density maps;
- selectable UTC, Paris/Roma and Argentina display times, shown explicitly on axes and tooltips;
- three on-demand site webcams, requested only while the webcam view is open, with fullscreen, still-image capture and bandwidth-limited video capture;
- first automatic markers at 260 K and 1.2 K;
- preparatory views for cold-phase and cooldown comparisons;
- English by default, with French, Argentine Spanish and Italian available.

The local database lives in `.local/` and is not versioned. ASCII source files
inside cooldown directories are never modified.

## Refresh data

```bash
npm run data:sync
npm run data:refresh
```

Or run both steps with:

```bash
npm run data:update
```

For normal local operation, start the dashboard and the automatic collector
together:

```bash
npm run monitor
```

This is the complete local launcher: it stops previous instances belonging to
this checkout, runs `data:update`, rebuilds the application, starts the
watcher, and finally starts the production server. It keeps the terminal
attached so `Ctrl-C` stops both processes cleanly. If port 3000 is already
reserved, use `npm run monitor -- --port 3001`.

The collector refreshes continuously (120 seconds by default) and the browser
checks for a new snapshot every 30 seconds. Set `QUBIC_REFRESH_SECONDS` to tune
the collector interval. An individual refresh is limited to 15 minutes by
default (`QUBIC_UPDATE_TIMEOUT_SECONDS`); a stuck refresh terminates the
watcher so systemd can restart it.

The collector publishes two small ignored status files in `public/data/`:
`data-watch-status.json` records the current cycle and next scheduled update,
while `data-watch-heartbeat.json` is refreshed every 30 seconds. The web
interface uses both files to report whether the updater is running, stopped or
no longer responding. The recommended systemd unit is included at
`deploy/systemd/qubic-data.service`; it uses `Restart=always`, so the server
restarts the collector automatically if its process exits. A stale heartbeat
still produces a visible diagnostic, rather than being mistaken for a healthy
service. On the APC VM, install or refresh that unit with:

```bash
sudo cp deploy/systemd/qubic-data.service /etc/systemd/system/qubic-data.service
sudo cp deploy/systemd/qubic-monitor.service /etc/systemd/system/qubic-monitor.service
sudo systemctl daemon-reload
sudo systemctl enable --now qubic-data.service qubic-monitor.service
sudo systemctl show qubic-data.service -p Restart -p RestartUSec
```

The sync command uses the `qubicdl` SSH alias and downloads the requested
`AVS47`, `TEMPERATURE`, pressure, compressor and weather streams. Webcam
credentials stay in the ignored `.env.local` file and are never sent to the
browser or included in build output. `.env.example` documents the required
variables for another machine.

The default current source is `June2026`. The first run imports existing lines
into 30-second aggregates; later runs resume at the last known byte position in
each file. Channels announced by the catalogue but absent on site remain
visible with a `missing` status.

## Python analysis engine

The Python-refactored application is now maintained on the `main` branch. The
previous stable starting point remains available through the `stable` branch
and the `stable-before-python-refactor` tag, so the former web application can
always be restored without losing this work.

The boundary is intentionally simple:

1. Node.js owns synchronization, ASCII parsing, SQLite writes and the compact
   display snapshot.
2. `analysis/qubic_analysis/` opens SQLite read-only and owns scientific
   detections. It currently contains the cryogenic timeline and the mechanical
   heat-switch (Touch) detector, with documented thresholds and unit tests.
3. `analysis/run.py` writes an atomic `.local/analysis-results.json` contract;
   the Node pipeline embeds that result in the public snapshot.

The analysis package uses only Python's standard library. Run its focused
tests with:

```bash
npm run analysis:test
```

This first step keeps the running site unchanged while moving the most
science-sensitive logic out of the web/data-management process. Resampling and
other presentation-oriented transformations remain in the collector for now;
they are the next candidates for the same Python boundary once this contract
has been validated on live cooldown updates.

Another cooldown can be selected without editing code:

```bash
QUBIC_COOLDOWN_DIR=August2026 QUBIC_COOLDOWN_LABEL="August 2026" npm run data:refresh
```

## Run only the local interface

```bash
npm run dev
```

This development-only command does not run the collector; for a complete local
test use `npm run monitor`. Then open `http://localhost:3000/` (or the port
selected with `--port`).

## Verify the build

```bash
npm run build
node --test tests/rendered-html.test.mjs
```

## Transitional architecture

The prototype uses SQLite so that it runs immediately on the Mac without an
additional service. The collector, channel catalogue and interface are kept
separate so SQLite can later be replaced by PostgreSQL with TimescaleDB for the
Linux deployment at APC.
