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
- Browser uses Chart.js (CDN) for charts
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
                           │                  └─► wazuh-mods collector :8084 /api/data
                           │                        (agents, vulnerabilities, MITRE, critical CVEs)
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
                           ├─ Chart.js: timeline, EPS sparkline, severity donut
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
| `SOCOPS_URL` / `SBOMGUARD_URL` / `SOCINT_URL` / `WAZUH_URL` | see `.env.example` | Upstream service base URLs |
| `WAZUHDATA_URL` | `:8084` | wazuh-mods collector (`dashboard.py`) `/api/data`. Distinct from `WAZUH_URL`, which is the Wazuh Dashboards UI the launcher links to. |

> IPs in `.env.example` and the `server.py` defaults are **deliberately sanitized** (`10.10.0.x`) because this repo is public. Real addresses live only in the gitignored `.env`. Do not "fix" them.

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
  "health": {"socops": true,  "sbomguard": true,  "socint": true,  "wazuh": false},
  "socops":    {"stats": {...}, "kpis": {...}, "mitre": {...}, "rules": [...], "timeline": [...], "timeline_fine": [...], "alerts": [...]},
  "sbomguard": {"stats": {...}, "feed":  {...}, "matches": [...]},
  "wazuh":     {...}
}
```

Missing/unhealthy upstreams just produce `{}` for that block — the frontend degrades gracefully.

---

## Frontend Panels

| Panel | Source | Behaviour |
|---|---|---|
| Top KPI bar | SOCops kpis + SBOM + Wazuh | Alerts/24h, **CRIT 24H · L9+** (true 24h count from `wazuh.alerts_24h.by_level`), open CVEs, EPS |
| Threat Level pill | Derived | Crit + high alert weight + KEV + SBOM critical → NOMINAL / GUARDED / ELEVATED / CRITICAL |
| Service health pills | `/api/health` | Green dot up, red dot pulsing if down. Click → opens that service. |
| Alert Timeline (24h) | `socops.timeline` (hourly buckets, system local time) | Line chart; empty renders an honest zeroed axis — there is deliberately no substitute source |
| Severity Distribution | computed from latest 15 SOCops alerts (rule_level → crit/high/med/low) | Doughnut |
| Top Rules | `socops.rules` (`rule_description`, `total`) | Ranked list |
| Events / Min | `socops.timeline_fine` (5-min buckets over 2h) | Sparkline (last 24 buckets) |
| Vulnerability Posture | `sbomguard.stats` (`critical`, `new_matches`, `total_cves`, `kev_matches`) | Big stats |
| Agent Fleet | `wazuh.agents` + `agent_count` | Per-agent status/OS/last-seen. Agents cycle by design (SV08 is a printer, up only when printing), so "down" uses neutral `--offline` grey — **never** an alarm state. |
| Agent Vulnerabilities | `wazuh.vulnerabilities` | Wazuh's vuln detector scanning packages on agents. Raw totals, all agents. Distinct from Vulnerability Posture, which is your own SBOM inventory. |
| Critical CVEs · Wazuh Agents | `wazuh.critical_cves` | CVSS + CVE + agent + package + description |
| MITRE ATT&CK | `socops.mitre` `{tactic: {count, techniques}}` | Heatmap cells. Kept on soc-ops: Wazuh's collector only aggregates MITRE over 24h (4 technique buckets, mostly registry churn), while soc-ops gives 6 tactics with nested techniques. Both originate from Wazuh. |
| Live Alert Stream | `socops.alerts` | Table; new rows flash green |
| Log ticker | `socops.alerts` (agent, rule level, srcip, description) | Scrolling marquee |

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
- Chart.js is the only CDN dependency; everything else renders from local DOM.

---

## Related Projects

- **soc-ops**, **soc-sbom**, **wazuh**, **soc-intel** — every panel reads from one of these.
