# soc-hub — User Manual

**soc-hub** is your entry point to the whole SOC platform: one wall of buttons to
every tool, plus a live operations dashboard.

Open it at:

```
http://your-server:8080
```

(Or whatever port your administrator set.)

---

## The service wall

Click the **Services** toggle to open the wall. Tiles are grouped into six sections,
and each tile has a **live health dot** — green means the service is up, red means
it is down. Click a tile to open that service in a new tab.

**Core Platform** — SOC Ops (alerts), SOC Intel (threat intel), SOC SBOM (CVEs),
SOC Threatmap (attack map), SOC Roadmap.

**Monitors** — SOC Phish, SOC Attack Surface, SOC Canary, SOC Cred Monitor,
SOC Passive DNS, SOC Supply, NetScaler Patch.

**Detection & Network** — SOC NIDS, SOC Detections, SOC Validate, SOC OSINT.

**Analyst Tools** — SpiderFoot, CyberChef, EML Analyzer.

**Threat Actors** — SOC Ransomware, SOC ShinyHunters, SOC Qilin.

**Cases & External** — SOC IR Cases, IRIS, Wazuh, Wazuh Map.

> **NetScaler Patch** (Monitors, port 8121) watches our own NetScaler gateway for
> un-applied CVE patches. It is **under development, unpublished — runs locally
> only**, so its tile only lights up when the tool is running on this box.

---

## The live dashboard

Behind the wall is an auto-refreshing operations view (updates every few seconds):

- **Top KPI bar** — alerts in 24h, critical count, open CVEs, events/min.
- **Threat Level pill** — NOMINAL → GUARDED → ELEVATED → CRITICAL, derived from
  alert weight, KEV, and SBOM criticals.
- **Alert Timeline / Severity / Top Rules / Events-per-minute** — from SOC Ops.
- **Vulnerability Posture** — your own SBOM inventory (SOC SBOM).
- **Agent Fleet / Agent Vulnerabilities / Critical CVEs** — from Wazuh. Agents that
  cycle (like the SV08 printer) show a neutral grey "offline", never an alarm.
- **Live Alert Stream** — newest SOC Ops alerts; new rows flash green.

If a service is down, its panel simply shows `--` — the rest of the wall keeps working.

---

## Bookmarking

Bookmark this page for one-click access:

```
Ctrl+D (Windows/Linux)   ·   Cmd+D (Mac)
```

That's it — soc-hub is your landing page. Click and explore.
