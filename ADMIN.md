# CD-Startpage Administration Manual

CD-Startpage is a **landing page portal** that links to all 6 services.

Think of it as: "Home page for your SOC platform. Click to go where you need."

---

## Installation

### Requirements

- Python 3.8+
- 10 MB disk

### Setup

```bash
cd ~/claude/CD-Startpage
cp .env.example .env
nano .env

# Edit:
STARTPAGE_PORT=80           # or 8080 if no sudo
THEME=dark                  # or light
```

### Run

```bash
# Direct
python3 app.py

# Or systemd (port 80 requires sudo)
sudo cp startpage.service /etc/systemd/system/
sudo systemctl enable --now startpage
sudo journalctl -u startpage -f
```

Access at `http://localhost:80` (or configured port)

---

## Configuration

Edit `.env`:

```env
STARTPAGE_PORT=80              # Port to listen on
THEME=dark                     # Color scheme
TITLE=SOC Platform             # Page title
ORGANIZATION=My Company        # Branding
```

---

## Customization

### Edit Links

File: `app.py` function `_handle_home()`

```python
links = [
    {"title": "Threat Intelligence", "url": "http://localhost:3000", "icon": "🌐"},
    {"title": "Alert Queue", "url": "http://localhost:8081", "icon": "🚨"},
    # Add more services here
]
```

### Add Custom CSS

Edit HTML in `app.py`:
```python
<style>
    /* Your custom CSS here */
</style>
```

### Change Theme

```env
THEME=dark      # Dark mode (default)
THEME=light     # Light mode
```

---

## Monitoring

```bash
# Is it running?
ps aux | grep "app.py"

# Check port
ss -tlnp | grep 80

# Logs
sudo journalctl -u startpage -f
```

---

## Troubleshooting

**"Permission denied" (port 80)**
- Use port 8080: `STARTPAGE_PORT=8080`
- Or run with sudo: `sudo python3 app.py`

**"Address already in use"**
```bash
lsof -i :80
kill -9 <PID>
```

---

## Security

By default, Startpage is open to anyone. To restrict access:

```bash
# Firewall (Ubuntu)
sudo ufw allow from 10.0.0.0/24 to any port 80
sudo ufw deny 80
```

Or use reverse proxy with auth (see soc-intel ADMIN.md for nginx example).

---

Done. Startpage is a simple static portal. Customize links, deploy, and forget.
