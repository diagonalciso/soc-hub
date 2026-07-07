# CD-Startpage

A lightweight service dashboard providing quick access links to all CTI/SOC services: SOCops, SBOMguard, SOCint, NetScaler Honeypot, and Wazuh dashboard.

---

## Requirements

- Python 3.6+
- Linux with systemd (for service install)

---

## Installation

```bash
cd CD-Startpage
cp .env.example .env
```

Edit `.env` to point to your service URLs.

### Run manually

```bash
python3 server.py
```

### Install as systemd service

```bash
sudo cp soc-hub.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now soc-hub
```

---

## Configuration

Edit `.env`:

```
STARTPAGE_PORT=8080
STARTPAGE_HOST=0.0.0.0

SOCOPS_URL=http://10.10.0.40:8081
SBOMGUARD_URL=http://10.10.0.40:8082
SOCINT_URL=http://10.10.0.40:8083
HONEYPOT_URL=http://10.10.0.40:8084
WAZUH_URL=http://10.10.0.40:8080
```

---

## Architecture

Single-threaded Python HTTP server serving a static dashboard page with configurable service links.

```
.env (configuration)
     ↓
server.py (HTTP server)
     ↓
render_index() (dynamic HTML generation)
     ↓
Browser (:8080)
```

---

## Routes

| Path | Response |
|------|----------|
| `/` | Dashboard HTML page |
| `/api/config` | JSON config object with all service URLs |

---

## Stack

- Python stdlib only (no pip install)
- Inline HTML generation
- Single-file deployment
