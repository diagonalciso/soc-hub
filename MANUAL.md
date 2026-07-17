# CD-Startpage User Manual

The **Startpage** is your entry point to the SOC platform.

When you open it, you see buttons to go to:
- Threat Intelligence (soc-intel)
- Alert Queue (soc-ops)
- SBOM Vulnerabilities (SBOMguard)
- Agent Health (wazuh)
- And more...

---

## Using the Portal

### Open Startpage

```
http://your-server:80
```

(Or whatever port your administrator configured.)

### Click to Navigate

Each button takes you to a service. Core:
- **🌐 Threat Intelligence** → Search external threats
- **🚨 Alert Queue** → Review and triage security alerts
- **🔍 SBOM Vulnerabilities** → Check app components for CVEs
- **💻 Agent Health** → See which computers are online

The wall also groups the standalone sidecar tools (Monitors, Detection & Network,
Analyst Tools, Threat Actors, Cases & External). Each tile shows a live health dot.

> **NetScaler Patch** (Monitors group, port 8121) — watches our own NetScaler gateway
> for un-applied CVE patches. **Under development, unpublished — runs locally only**, not
> part of the published soc-* bundle yet. The tile links to it when it is running.

---

## Bookmarking

Bookmark this page for quick access:
```
Ctrl+D (Windows/Linux)
Cmd+D (Mac)
```

---

That's it. Startpage is your landing page. Click and explore.
