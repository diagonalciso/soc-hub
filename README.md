# soc-hub

> SOC operations wall — unified portal + live video-wall dashboard for the CTI/SOC fleet.

`soc-hub` is the single pane of glass for the whole estate. It does two jobs:

1. **Service wall** — quick-access tiles with live health dots for **27 services**,
   grouped into six sections (Core Platform, Monitors, Detection & Network, Analyst
   Tools, Threat Actors, Cases & External).
2. **Live dashboard** — a background aggregator pulls metrics from SOC Ops, SOC SBOM
   and the Wazuh collector into an auto-refreshing operations view (alert timeline,
   severity, MITRE heatmap, agent fleet, CVE posture, live alert stream).

Python **stdlib only**, threaded HTTP server, `.env`-driven. Default port **8080**.

> **History**: `soc-hub` is the evolution of the old *CD-Startpage* portal, and it
> now also fills the orchestration/overview role that the deprecated *CD-SOC-Bundle*
> used to hold. There is no separate "bundle" anymore — the fleet is ~50 standalone
> git repos and `soc-hub` is where they surface together.

> **Private tiles**: **NetScaler Patch** (port 8121, own-gateway patch monitor)
> lives in a **private** repo (`diagonalciso/netscaler-patch-monitor`) — it's part
> of the fleet but not public, since it reveals own-gateway patch posture.

---

## The 27 services on the wall

Hosts below use the sanitized `10.10.0.40` placeholder (public repo); real addresses
live only in the gitignored `.env`.

### Core Platform
| Tile | Port | Repo |
|---|---|---|
| SOC Ops | 8081 | `soc-ops` — alert triage + AI enrichment |
| SOC SBOM | 8082 | `soc-sbom` — SBOM vulnerability tracker |
| SOC Intel | 8083 | `soc-intel` — STIX 2.1 threat-intel platform |
| SOC Threatmap | 8100 | `soc-threatmap` — live attack map |
| SOC Roadmap | 8090 | `soc-roadmap` — unified roadmap portal |

### Monitors
| Tile | Port | Repo |
|---|---|---|
| SOC Phish | 8091 | `soc-phish` — email parser + IOC extraction |
| SOC Attack Surface | 8092 | `soc-attack-surface` — exposure monitor |
| SOC Canary | 8093 | `soc-canary` — deception token manager |
| SOC Cred Monitor | 8094 | `soc-cred-monitor` — breach/credential exposure |
| SOC Passive DNS | 8095 | `soc-passive-dns` — DNS/subdomain tracking |
| SOC Supply | 8109 | `soc-supply` — supply-chain monitor |
| NetScaler Patch | 8121 | `netscaler-patch-monitor` — own-gateway patch monitor (**private repo**) |

### Detection & Network
| Tile | Port | Repo |
|---|---|---|
| SOC NIDS | 8102 | `soc-nids` — network IDS view |
| SOC Detections | 8103 | `soc-detections` — detection rule catalog |
| SOC Validate | 8104 | `soc-validate` — detection validation |
| SOC OSINT | 8105 | `soc-osint` — OSINT aggregation |

### Analyst Tools
| Tile | Port | Repo |
|---|---|---|
| SpiderFoot | 8106 | `soc-osint`/SpiderFoot instance |
| CyberChef | 8107 | CyberChef instance |
| EML Analyzer | 8108 | `soc-eml-analyzer` — our EML parser (headers, URLs, attachments) |

### Threat Actors
| Tile | Port | Repo |
|---|---|---|
| SOC Ransomware | 8096 | `soc-ransomware` — victim/group tracker |
| SOC ShinyHunters | 8097 | `soc-shinyhunters` — actor monitor |
| SOC Qilin | 8098 | `soc-qilin` — actor monitor |

### Cases & External
| Tile | Port | Repo |
|---|---|---|
| SOC IR Cases | 8206 | `soc-ir-cases` — IR case manager |
| IRIS | 8443 (https) | DFIR-IRIS instance |
| Wazuh | `10.10.0.174` (https) | Wazuh Dashboards UI |
| Wazuh Map | `10.10.0.174:8100/attackmap` (https) | `wazuh-attackmap` — our attack map, deployed on the Wazuh host |

Live metrics are aggregated only from **SOC Ops**, **SOC SBOM** and the **Wazuh
collector** (`:8084`, `WAZUHDATA_URL`); every other entry is a launch tile with a
health dot.

### Fleet manifest

The fleet is **~20 standalone repos, not a monorepo** — deliberately. `fleet.tsv` is
the single source of truth (name · port · group · kind · repo · notes); keep it in
lockstep with `.env` (`*_URL`) and `index.html` (tile `data-key`s).

```bash
./clone-all.sh          # clone missing + ff-pull existing (git-kind rows only)
./clone-all.sh --dry    # show what it would do
```

Repos land as siblings of `soc-hub` (`diagonalciso/<repo>`). External tiles
(SpiderFoot, CyberChef, IRIS, Wazuh appliance) are appliances/3rd-party instances and
are skipped.

---

## Requirements

- Python 3.7+ (uses `concurrent.futures`)
- Linux with systemd (for service install)

---

## Installation

```bash
cd soc-hub
cp .env.example .env
```

Edit `.env` to point every `*_URL` at your real service addresses.

### Run manually

```bash
python3 server.py            # http://0.0.0.0:8080
```

For an ad-hoc port: `STARTPAGE_PORT=8090 python3 server.py`.

### Install as systemd service

```bash
sudo cp soc-hub.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now soc-hub
sudo journalctl -u soc-hub -f
```

---

## Configuration

Precedence: **shell env > `.env` file > built-in defaults**.

| Var | Default | Purpose |
|---|---|---|
| `STARTPAGE_PORT` | `8080` | HTTP listen port |
| `STARTPAGE_HOST` | `0.0.0.0` | Bind address |
| `SOC_NAME` | `CLAW SOC` | Display name in topbar/title |
| `METRICS_CACHE_TTL` | `5` | Seconds between background metric refreshes |
| `METRICS_FETCH_TIMEOUT` | `2.5` | Per-upstream HTTP timeout |
| `*_URL` (27 tiles) | see `.env.example` | Base URL per service (`SOCOPS_URL`, `SOCINT_URL`, `WAZUHDATA_URL`, …) |

> IPs in `.env.example` and the `server.py` defaults are deliberately sanitized
> (`10.10.0.x`) because this repo is public. Real addresses live only in the
> gitignored `.env`. Do not "fix" them.

---

## Routes

| Path | Response |
|------|----------|
| `/` | Dashboard HTML (template rendered from `.env`) |
| `/api/metrics` | Aggregated JSON: each upstream's latest payload + health |
| `/api/health` | Compact `{service: bool}` health map |
| `/api/config` | Service URLs + `soc_name` |
| `/dashboard.css`, `/dashboard.js` | Static assets |

Missing/unhealthy upstreams degrade gracefully to `{}` — the frontend renders `--`.

---

## Stack

- Python stdlib only (no pip install); Chart.js is the only browser CDN dependency
- Threaded HTTP server, parallel upstream fetches via `concurrent.futures`
- 5s cache + background refresher → page stays snappy even if upstreams stall

See `CLAUDE.md` for aggregator internals, panel-by-panel data sources, and the
add-an-upstream recipe. See `ADMIN.md` for deploy/backup/troubleshooting.
