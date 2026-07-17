# soc-hub — Administration Manual

`soc-hub` is the **portal + live video-wall** for the CTI/SOC fleet: 26 service tiles
(six groups) with health dots, plus a background aggregator that renders an operations
dashboard from SOC Ops, SOC SBOM and the Wazuh collector.

Python stdlib only, threaded HTTP server, `.env`-driven, default port **8080**.

> Supersedes the old *CD-Startpage* portal and the deprecated *CD-SOC-Bundle*
> orchestrator. There is no monolithic bundle — each service is its own repo/systemd
> unit; `soc-hub` is only the overview layer.

---

## Installation

### Requirements
- Python 3.7+ (`concurrent.futures`)
- ~10 MB disk
- Linux with systemd (for the service unit)

### Setup

```bash
cd soc-hub
cp .env.example .env
nano .env            # set STARTPAGE_PORT, SOC_NAME, and every *_URL
```

### Run

```bash
# Direct
python3 server.py

# Systemd
sudo cp soc-hub.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now soc-hub
sudo journalctl -u soc-hub -f
```

Access at `http://localhost:8080` (or the configured port).

---

## Configuration

Precedence: **shell env > `.env` > built-in defaults**.

| Var | Default | Purpose |
|---|---|---|
| `STARTPAGE_PORT` | `8080` | HTTP listen port |
| `STARTPAGE_HOST` | `0.0.0.0` | Bind address |
| `SOC_NAME` | `CLAW SOC` | Topbar / page title |
| `METRICS_CACHE_TTL` | `5` | Seconds between background metric refreshes |
| `METRICS_FETCH_TIMEOUT` | `2.5` | Per-upstream HTTP timeout |
| `*_URL` | see `.env.example` | One per tile — 26 of them |

The `*_URL` set covers all 26 tiles. Metrics are only fetched from `SOCOPS_URL`,
`SBOMGUARD_URL` and `WAZUHDATA_URL` (the `:8084` Wazuh collector, distinct from
`WAZUH_URL`, which is the Dashboards UI the tile links to). Everything else is a
launch tile whose dot comes from `/api/health`.

> `.env.example` and the `server.py` defaults are deliberately sanitized (`10.10.0.x`)
> — this repo is public. Real addresses live only in the gitignored `.env`. Do not
> "fix" them.

---

## Adding / changing a tile

1. Add the `*_URL` to `.env` **and** `.env.example` (sanitized IP).
2. Add a matching default to `load_env()` in `server.py`.
3. Add a `{{*_URL}}` substitution in the template-render path (`server.py`).
4. Add the `<a class="svc" data-key="…">` tile to the right group in `index.html`.
5. (Live-metrics tiles only) add a fetch job in `collect_metrics()` + a renderer in
   `dashboard.js` + a panel in `index.html`/`dashboard.css`.

That five-touch-point pattern is the same one used to add NetScaler Patch.

---

## Monitoring

```bash
# Running?
ps aux | grep "server.py"
ss -tlnp | grep 8080

# Logs
sudo journalctl -u soc-hub -f

# Health of every upstream at a glance
curl -s http://localhost:8080/api/health | python3 -m json.tool
```

---

## Restart after edits

```bash
sudo systemctl restart soc-hub
# or, if not under systemd:
pkill -f "python3 server.py" ; nohup python3 server.py >/tmp/soc-hub.log 2>&1 &
```

---

## Troubleshooting

**"Address already in use"**
```bash
lsof -i :8080
kill -9 <PID>
```

**A tile is red but the service is up** — check the `*_URL` in `.env` resolves from
the soc-hub host (not `localhost` if soc-hub runs on a different box), and that it is
within `METRICS_FETCH_TIMEOUT`.

**Dashboard panels all show `--`** — the metric upstreams (SOC Ops / SOC SBOM / Wazuh
collector) are unreachable. The wall tiles still work; only the aggregated panels
depend on those three.

---

## Reverse proxy (nginx)

```nginx
upstream soc_hub { server 127.0.0.1:8080; }

server {
  listen 80;
  server_name soc.your.org;

  location / {
    proxy_pass http://soc_hub;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

By default soc-hub is open to anyone on the network. Restrict with a firewall
(`ufw allow from <subnet> to any port 8080`) or an auth'd reverse proxy.

---

See `CLAUDE.md` for aggregator internals and the panel-by-panel data-source map.
