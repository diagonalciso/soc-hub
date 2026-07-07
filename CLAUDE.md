# CLAUDE.md

## What Is This?

CD-Startpage is a **portal and monitoring dashboard** in one. 

At its simplest: links to all 6 services.  
At its most advanced: live dashboard pulling data from each service, showing real-time metrics.

The code supports both modes — use as a simple portal, or enhance it to pull live data.

**Key characteristics:**
- No pip dependencies — Python stdlib only
- Threaded HTTP server, parallel upstream fetches via `concurrent.futures`
- 5s cache + background refresher → page stays snappy even if upstreams stall
- Browser uses Chart.js + Leaflet (CDN) for charts and the world map
- Configurable via `.env`
- Python 3.7+ (uses `concurrent.futures`)
- Default port 8080

---

## Quick Start

```bash
cd CD-Startpage
cp .env.example .env
python3 server.py
```

Open http://localhost:8080

For ad-hoc tests on another port:
```bash
STARTPAGE_PORT=8090 python3 server.py
```

Shell env wins over `.env`, which wins over built-in defaults.

---

## Architecture

```
                ┌─────────────────────────────────────────────────┐
                │ background refresher (every METRICS_CACHE_TTL s)│
                └──────────┬──────────────────────────────────────┘
                           │
                           ▼
.env ─► load_env() ─► collect_metrics()  ──► ThreadPoolExecutor
                           │                  ├─► SOCops    /api/{stats,kpis,mitre,rules,timeline,alerts}
                           │                  ├─► SBOMguard /api/{stats,feed-status,matches}
                           │                  ├─► Honeypot  /api/{stats,unique-ips,events}
                           │                  └─► Wazuh     /api/data
                           ▼
                    in-memory cache  ◄── /api/metrics  (JSON)
                                          /api/health   (JSON, just service health)
                                          /api/config   (JSON, URLs only)
                                          /             (renders index.html template)
                                          /dashboard.css /dashboard.js (static)
                           ▼
                       Browser
                           │
                           ├─ polls /api/metrics every 5s
                           ├─ Chart.js: timeline, EPS sparkline, severity donut, honeypot bars
                           ├─ Leaflet: dark world map with attacker pings
                           └─ DOM: KPI tiles, MITRE heatmap, rule list, live alert stream, log ticker
```

### File Structure

```
server.py            HTTP server, env loader, metrics aggregator, in-memory cache
index.html           Static template; server substitutes {{SOC_NAME}}, {{*_URL}} on render
dashboard.css        SOC video-wall styling (panel grid, neon, scanlines)
dashboard.js         Polls /api/metrics, renders charts/map/lists, runs the clock
.env / .env.example  Port, host, upstream URLs, display name, cache settings
soc-hub.service systemd unit
```

---

## Configuration

| Var | Default | Purpose |
|---|---|---|
| `STARTPAGE_PORT` | `8080` | HTTP listen port |
| `STARTPAGE_HOST` | `0.0.0.0` | Bind address |
| `SOC_NAME` | `CLAW SOC` | Display name in topbar/title |
| `METRICS_CACHE_TTL` | `5` | Seconds between background metric refreshes |
| `METRICS_FETCH_TIMEOUT` | `2.5` | Per-upstream HTTP timeout |
| `SOCOPS_URL` / `SBOMGUARD_URL` / `SOCINT_URL` / `HONEYPOT_URL` / `WAZUH_URL` | see `.env.example` | Upstream service base URLs |

---

## Routes

| Path | Purpose |
|------|---------|
| `/` | Dashboard HTML (template, generated from `.env`) |
| `/api/metrics` | Aggregated JSON: every upstream's most recent payload + service health |
| `/api/health` | Compact `{service: bool}` map |
| `/api/config` | Service URLs + `soc_name` |
| `/dashboard.css`, `/dashboard.js` | Static assets |

`/api/metrics` shape:
```json
{
  "ts": 1234567890.0,
  "soc_name": "CLAW SOC",
  "urls":   {"socops": "...", "sbomguard": "...", ...},
  "health": {"socops": true,  "sbomguard": true,  "socint": true,  "honeypot": true,  "wazuh": false},
  "socops":    {"stats": {...}, "kpis": {...}, "mitre": {...}, "rules": [...], "timeline": [...], "alerts": [...]},
  "sbomguard": {"stats": {...}, "feed":  {...}, "matches": [...]},
  "honeypot":  {"stats": {...}, "ips":   {...}, "events":  {...}},
  "wazuh":     {...}
}
```

Missing/unhealthy upstreams just produce `{}` for that block — the frontend degrades gracefully.

---

## Frontend Panels

| Panel | Source | Behaviour |
|---|---|---|
| Top KPI bar | SOCops kpis + honeypot + SBOM | Alerts/24h, critical (computed from latest alert sample), probes, open CVEs, EPS |
| Threat Level pill | Derived | Crit + high alert weight + KEV + SBOM critical → NOMINAL / GUARDED / ELEVATED / CRITICAL |
| Service health pills | `/api/health` | Green dot up, red dot pulsing if down. Click → opens that service. |
| Alert Timeline (24h) | `socops.timeline` if non-empty, else honeypot 60-min activity | Line chart |
| Attacker Origin Map | `honeypot.ips.ips` country codes mapped via centroid table | Pulsing pings on dark Leaflet basemap |
| Severity Distribution | computed from latest 15 SOCops alerts (rule_level → crit/high/med/low) | Doughnut |
| Top Rules | `socops.rules` (`rule_description`, `total`) | Ranked list |
| Events / Min | honeypot 60-min `activity` array | Sparkline (last 30 minutes) |
| Vulnerability Posture | `sbomguard.stats` (`critical`, `new_matches`, `total_cves`, `kev_matches`) | Big stats |
| MITRE ATT&CK | `socops.mitre` `{tactic: {count, techniques}}` | Heatmap cells |
| Live Alert Stream | `socops.alerts` | Table; new rows flash green |
| Honeypot Activity | `honeypot.stats.by_type` | Bar chart |
| Log ticker | `honeypot.events.events` | Scrolling marquee |

The frontend is permissive about upstream shape changes: every renderer falls
back to alternate field names (`row.name || row.rule || row.rule_id` etc.) and
displays `--` when nothing is available.

---

## Common Tasks

### Add a new upstream
1. Add URL to `.env` and `.env.example`.
2. Add a fetch entry to the `jobs` dict in `collect_metrics()` (`server.py`).
3. Add a top-level key to the returned dict.
4. In `dashboard.js`, add a renderer for the new data; in `index.html`, add a panel section and place it on the grid in `dashboard.css` (`#panel-XYZ`).

### Tune refresh cadence
- Backend cache: `METRICS_CACHE_TTL` env var (default 5s).
- Browser poll: `REFRESH_MS` constant at the top of `dashboard.js` (default 5000).

### Change branding
- `SOC_NAME` env var → topbar + page title.

### Restart after edits
```bash
sudo systemctl restart soc-hub
# or, if not running under systemd:
pkill -f "python3 server.py" ; nohup python3 server.py >/tmp/cdstart.log 2>&1 &
```

---

## Systemd Service

File: `soc-hub.service`

```bash
sudo cp soc-hub.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now soc-hub
sudo journalctl -u soc-hub -f
```

---

## Reverse Proxy (nginx)

```nginx
upstream cd_startpage { server 127.0.0.1:8080; }

server {
  listen 80;
  server_name startpage.your.org;

  location / {
    proxy_pass http://cd_startpage;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

---

## Performance Notes

- Aggregator runs upstream fetches in parallel; total wall time ≈ slowest upstream, capped by `METRICS_FETCH_TIMEOUT`.
- `/api/metrics` is served from cache (a few ms) — the background thread does the work.
- Browser polls every 5s; charts use `update('none')` to avoid animation thrash.
- Leaflet basemap requires internet (CartoDB tiles). Disable map via removing `#panel-map` if running fully offline.

---

## Related Projects

- **soc-ops**, **soc-sbom**, **netscaler-honeypot**, **wazuh**, **soc-intel** — every panel reads from one of these.
