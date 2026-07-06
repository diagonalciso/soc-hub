/* CD-Startpage SOC video-wall — live dashboard logic */
'use strict';

const REFRESH_MS = 5000;
const CLOCK_TZ_LABEL = 'UTC';
let refreshTimer = null;
let countdownTimer = null;
let countdownLeft = REFRESH_MS / 1000;
let lastAlertIds = new Set();

/* ── Country centroids for attacker map ────────────────────────────────── */
const COUNTRY_COORDS = {
  US:[39.8,-98.6],GB:[54.0,-2.5],DE:[51.2,10.5],FR:[46.6,2.2],NL:[52.1,5.3],RU:[61.5,105.3],
  CN:[35.9,104.2],JP:[36.2,138.3],KR:[36.0,128.0],IN:[20.6,78.9],BR:[-14.2,-51.9],CA:[56.1,-106.3],
  AU:[-25.3,133.8],MX:[23.6,-102.5],IT:[41.9,12.6],ES:[40.5,-3.7],PL:[51.9,19.1],UA:[48.4,31.2],
  TR:[38.96,35.2],SA:[23.9,45.1],IR:[32.4,53.7],PK:[30.4,69.3],BD:[23.7,90.4],ID:[-0.8,113.9],
  VN:[14.1,108.3],TH:[15.9,100.99],SG:[1.35,103.8],HK:[22.3,114.1],TW:[23.7,121.0],PH:[13.0,122.0],
  MY:[4.2,101.97],ZA:[-30.6,22.9],EG:[26.8,30.8],NG:[9.1,8.7],KE:[-0.0,37.9],ET:[9.1,40.5],
  AR:[-38.4,-63.6],CL:[-35.7,-71.5],CO:[4.6,-74.3],PE:[-9.2,-75.0],VE:[6.4,-66.6],
  SE:[60.1,18.6],NO:[60.5,8.5],FI:[61.9,25.7],DK:[56.3,9.5],BE:[50.5,4.5],CH:[46.8,8.2],
  AT:[47.5,14.6],CZ:[49.8,15.5],PT:[39.4,-8.2],GR:[39.1,21.8],RO:[45.9,24.97],IE:[53.1,-7.7],
  IL:[31.0,34.85],AE:[23.4,53.85],QA:[25.3,51.2],KZ:[48.0,66.9],UZ:[41.4,64.6],BY:[53.7,27.95],
  RS:[44.0,21.0],HU:[47.2,19.5],SK:[48.7,19.7],BG:[42.7,25.5],HR:[45.1,15.2],LT:[55.2,23.9],
  LV:[56.9,24.6],EE:[58.6,25.0],MD:[47.4,28.4],GE:[42.3,43.4],AM:[40.1,45.0],AZ:[40.1,47.6],
  ZZ:[0,0]
};

/* ── State ────────────────────────────────────────────────────────────── */
const state = { metrics: null, charts: {}, map: null, attackLayer: null };

/* ── Utilities ────────────────────────────────────────────────────────── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (n) => {
  if (n === null || n === undefined || isNaN(n)) return '--';
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return Math.round(n).toString();
};
const pad2 = (n) => String(n).padStart(2, '0');
function severityClass(level) {
  const s = String(level || '').toLowerCase();
  if (/(crit|sev[_-]?5|^5$)/.test(s)) return 'crit';
  if (/(high|sev[_-]?4|^4$)/.test(s)) return 'high';
  if (/(med|warn|sev[_-]?3|^3$)/.test(s)) return 'med';
  if (/(low|sev[_-]?2|^2$)/.test(s)) return 'low';
  return 'info';
}
function severityScore(counts) {
  return (counts.critical || 0) * 8 + (counts.high || 0) * 3 + (counts.medium || 0) * 1;
}

function severityFromAlerts(alerts) {
  const out = { critical: 0, high: 0, medium: 0, low: 0 };
  if (!Array.isArray(alerts)) return out;
  for (const a of alerts) {
    const lvl = Number(a.rule_level ?? a.level ?? a.severity ?? 0);
    if (lvl >= 12) out.critical++;
    else if (lvl >= 8) out.high++;
    else if (lvl >= 4) out.medium++;
    else out.low++;
  }
  return out;
}

function honeypotEPS(stats) {
  const arr = stats?.activity;
  if (!Array.isArray(arr) || !arr.length) return 0;
  const tail = arr.slice(-5);
  return tail.reduce((s, n) => s + (Number(n) || 0), 0);
}

/* ── Clock ─────────────────────────────────────────────────────────────── */
function tickClock() {
  const d = new Date();
  $('#clock-time').textContent = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
  $('#clock-date').textContent = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())} ${CLOCK_TZ_LABEL}`;
}
setInterval(tickClock, 1000); tickClock();

/* ── Chart defaults ───────────────────────────────────────────────────── */
if (window.Chart) {
  Chart.defaults.color = '#6c8090';
  Chart.defaults.font.family = "'JetBrains Mono', monospace";
  Chart.defaults.font.size = 10;
  Chart.defaults.borderColor = 'rgba(0, 255, 136, 0.08)';
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(5, 8, 16, 0.95)';
  Chart.defaults.plugins.tooltip.borderColor = 'rgba(0, 255, 136, 0.5)';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.titleColor = '#00ff88';
  Chart.defaults.plugins.tooltip.bodyColor = '#c8d6e0';
}

/* ── Map ──────────────────────────────────────────────────────────────── */
function initMap() {
  if (!window.L || state.map) return;
  state.map = L.map('map', {
    zoomControl: false, attributionControl: false,
    worldCopyJump: true, minZoom: 1, maxZoom: 4,
    scrollWheelZoom: false, doubleClickZoom: false, dragging: true,
  }).setView([20, 10], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd', maxZoom: 4, noWrap: false,
  }).addTo(state.map);
  state.attackLayer = L.layerGroup().addTo(state.map);
}

function renderAttackMap(ips) {
  if (!state.map || !state.attackLayer) return;
  state.attackLayer.clearLayers();
  if (!ips || !ips.length) return;
  const counts = {};
  ips.forEach(entry => {
    const code = (entry.country || 'ZZ').toUpperCase();
    counts[code] = (counts[code] || 0) + 1;
  });
  Object.entries(counts).forEach(([code, count]) => {
    const coord = COUNTRY_COORDS[code];
    if (!coord || (coord[0] === 0 && coord[1] === 0)) return;
    const radius = Math.min(28, 6 + Math.log2(count + 1) * 4);
    const html = `
      <div style="position:relative;width:${radius*2}px;height:${radius*2}px;display:flex;align-items:center;justify-content:center;">
        <div class="attack-marker" style="width:${radius*2}px;height:${radius*2}px"></div>
        <div class="attack-marker-core" style="width:8px;height:8px;"></div>
      </div>`;
    const icon = L.divIcon({ html, className: 'attack-marker-wrap', iconSize: [radius*2, radius*2] });
    L.marker(coord, { icon, interactive: true })
      .bindTooltip(`${code} · ${count} probe${count !== 1 ? 's' : ''}`, { permanent: false, direction: 'top' })
      .addTo(state.attackLayer);
  });
}

/* ── Charts ───────────────────────────────────────────────────────────── */
function buildLineChart(canvasId, labels, data, color) {
  if (!window.Chart) return null;
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const grad = ctx.getContext('2d').createLinearGradient(0, 0, 0, 200);
  grad.addColorStop(0, color + 'cc');
  grad.addColorStop(1, color + '00');
  return new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{
      data, borderColor: color, backgroundColor: grad,
      borderWidth: 1.6, tension: 0.35, fill: true,
      pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: color,
    }]},
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 600 },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 6, autoSkip: true, font: { size: 9 } } },
        y: { grid: { color: 'rgba(0, 255, 136, 0.05)' }, beginAtZero: true, ticks: { font: { size: 9 }, maxTicksLimit: 5 } },
      },
    },
  });
}

function buildBarChart(canvasId, labels, data, colors) {
  if (!window.Chart) return null;
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  return new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{
      data, backgroundColor: colors,
      borderColor: colors.map(c => c.replace('0.45', '1').replace('0.6', '1')),
      borderWidth: 1, borderRadius: 2,
    }]},
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 600 },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 9 } } },
        y: { grid: { color: 'rgba(0, 255, 136, 0.05)' }, beginAtZero: true, ticks: { font: { size: 9 }, maxTicksLimit: 5 } },
      },
    },
  });
}

function buildDoughnut(canvasId, labels, data, colors) {
  if (!window.Chart) return null;
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  return new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{
      data, backgroundColor: colors, borderColor: 'rgba(5, 8, 16, 0.9)',
      borderWidth: 2, hoverOffset: 6,
    }]},
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 600 },
      cutout: '62%',
      plugins: {
        legend: { display: true, position: 'bottom', labels: { font: { size: 9 }, boxWidth: 10, padding: 6 } },
      },
    },
  });
}

/* ── Renderers ────────────────────────────────────────────────────────── */
function renderHealth(health, urls) {
  $$('.svc').forEach(svc => {
    const k = svc.dataset.key;
    const up = !!health?.[k];
    svc.dataset.status = up ? 'up' : 'down';
    if (urls && urls[k]) svc.href = urls[k];
  });
}

function renderHeaderKPIs(m) {
  const stats = m.socops?.stats || {};
  const kpis  = m.socops?.kpis  || {};
  const honey = m.honeypot?.stats || {};
  const sbom  = m.sbomguard?.stats || {};

  const alertsArr = Array.isArray(m.socops?.alerts) ? m.socops.alerts
                  : (Array.isArray(m.socops?.alerts?.alerts) ? m.socops.alerts.alerts : []);
  const sevCounts = severityFromAlerts(alertsArr);

  const alerts24 = kpis.alerts_last_24h ?? kpis.alerts_24h ?? stats.today ?? stats.total ?? null;
  const critical = sevCounts.critical || sbom.critical || 0;
  const probes   = honey.total ?? null;
  const cves     = sbom.new_matches ?? sbom.total_cves ?? null;
  const eps      = honeypotEPS(honey);

  $('#hdr-alerts24').textContent = alerts24 != null ? fmt(alerts24) : '--';
  $('#hdr-critical').textContent = critical != null ? fmt(critical) : '--';
  $('#hdr-probes').textContent   = probes   != null ? fmt(probes)   : '--';
  $('#hdr-cves').textContent     = cves     != null ? fmt(cves)     : '--';
  $('#hdr-eps').textContent      = eps      != null ? fmt(eps)      : '--';
  $('#meta-eps').textContent     = 'last 5 min · honeypot';

  // Threat = combined SOCops crit/high alerts + KEV exposure
  const score = severityScore(sevCounts) + (sbom.kev_matches || 0) * 0.005 + (sbom.critical || 0) * 0.01;
  let level = 1, label = 'NOMINAL';
  if (score >= 80)       { level = 4; label = 'CRITICAL'; }
  else if (score >= 30)  { level = 3; label = 'ELEVATED'; }
  else if (score >= 8)   { level = 2; label = 'GUARDED';  }
  else                   { level = 1; label = 'NOMINAL';  }
  const pill = $('#threat-pill');
  pill.dataset.level = String(level);
  $('#threat-text').textContent = label;
}

function renderTimeline(m) {
  // Prefer SOCops timeline; if empty, derive from honeypot 60-min activity (still SOC-meaningful)
  const tl = m.socops?.timeline;
  let labels = [], data = [], source = 'soc-ops';
  if (Array.isArray(tl) && tl.length) {
    tl.forEach(p => {
      labels.push(p.label || p.t || p.hour || '');
      data.push(p.value ?? p.count ?? 0);
    });
  } else if (tl && Array.isArray(tl.points) && tl.points.length) {
    tl.points.forEach(p => {
      labels.push(p.label || p.t || p[0] || '');
      data.push(p.value ?? p[1] ?? 0);
    });
  } else {
    // fallback: honeypot 60-min activity
    const arr = m.honeypot?.stats?.activity;
    if (Array.isArray(arr) && arr.length) {
      const now = new Date();
      arr.forEach((v, i) => {
        const minsAgo = arr.length - 1 - i;
        labels.push(`-${minsAgo}m`);
        data.push(Number(v) || 0);
      });
      source = 'Honeypot · 60min';
    } else {
      const now = new Date();
      for (let i = 23; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 3600 * 1000);
        labels.push(pad2(d.getUTCHours()) + 'h');
        data.push(0);
      }
    }
  }
  $('#meta-timeline').textContent = source;
  if (state.charts.timeline) {
    state.charts.timeline.data.labels = labels;
    state.charts.timeline.data.datasets[0].data = data;
    state.charts.timeline.update('none');
  } else {
    state.charts.timeline = buildLineChart('chart-timeline', labels, data, '#00ff88');
  }
}

function renderSeverity(m) {
  const alertsArr = Array.isArray(m.socops?.alerts) ? m.socops.alerts
                  : (Array.isArray(m.socops?.alerts?.alerts) ? m.socops.alerts.alerts : []);
  const c = severityFromAlerts(alertsArr);
  const data = [c.critical, c.high, c.medium, c.low];
  const labels = ['Critical', 'High', 'Medium', 'Low'];
  const colors = [
    'rgba(255, 56, 96, 0.85)',
    'rgba(255, 176, 0, 0.85)',
    'rgba(0, 204, 255, 0.85)',
    'rgba(0, 255, 136, 0.85)',
  ];
  if (state.charts.severity) {
    state.charts.severity.data.datasets[0].data = data;
    state.charts.severity.update('none');
  } else {
    state.charts.severity = buildDoughnut('chart-severity', labels, data, colors);
  }
}

function renderRules(m) {
  const r = m.socops?.rules || {};
  let rows = [];
  if (Array.isArray(r))            rows = r;
  else if (Array.isArray(r.rules)) rows = r.rules;
  else if (typeof r === 'object')  rows = Object.entries(r).map(([k, v]) => ({ name: k, count: typeof v === 'number' ? v : (v?.count ?? 0) }));
  rows = rows.filter(x => x).slice(0, 8);
  const ul = $('#rules-list');
  if (!rows.length) {
    ul.innerHTML = '<li class="empty">no rule activity</li>';
    return;
  }
  ul.innerHTML = rows.map((row, i) => {
    const name = row.rule_description || row.name || row.rule || row.rule_id || `rule ${i+1}`;
    const cnt  = row.total ?? row.count ?? row.new_count ?? row.hits ?? row.value ?? 0;
    const safeName = esc(name);
    return `<li><span class="rank">${i+1}</span><span class="name" title="${safeName}">${safeName}</span><span class="count">${fmt(cnt)}</span></li>`;
  }).join('');
}

function renderEPS(m) {
  // Live events/min sparkline driven by honeypot 60-min activity (resolved per minute)
  const arr = m.honeypot?.stats?.activity;
  let labels = [], data = [];
  if (Array.isArray(arr) && arr.length) {
    arr.slice(-30).forEach((v, i, slice) => {
      labels.push(`-${slice.length - 1 - i}m`);
      data.push(Number(v) || 0);
    });
  } else {
    for (let i = 29; i >= 0; i--) { labels.push(`-${i}m`); data.push(0); }
  }
  if (state.charts.eps) {
    state.charts.eps.data.labels = labels;
    state.charts.eps.data.datasets[0].data = data;
    state.charts.eps.update('none');
  } else {
    state.charts.eps = buildLineChart('chart-eps', labels, data, '#00ccff');
  }
}

function renderCVE(m) {
  const s = m.sbomguard?.stats || {};
  const f = m.sbomguard?.feed || {};
  const map = {
    critical: s.critical ?? 0,
    high:     s.new_matches ?? 0,
    medium:   s.total_cves ?? 0,
    kev:      s.kev_matches ?? s.kev ?? 0,
  };
  $$('.stat-num').forEach(el => {
    const k = el.dataset.key;
    if (k && map[k] != null) el.textContent = fmt(map[k]);
  });
  $('#cve-hosts').textContent = fmt(s.hosts ?? s.host_count ?? (Array.isArray(s.hosts_list) ? s.hosts_list.length : 0));
  $('#cve-sboms').textContent = fmt(s.total_sbom ?? s.sboms ?? 0);
  const feedTs = f.last_run || f.last_updated || f.last_fetch;
  let feedLabel = '--';
  if (feedTs) {
    const d = new Date(feedTs);
    if (!isNaN(d.getTime())) feedLabel = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  } else if (Object.keys(f).length) {
    feedLabel = 'OK';
  }
  $('#cve-feed').textContent = feedLabel;
  // Relabel captions to match the real semantics
  const caps = $$('.stat-cap');
  if (caps.length === 4) {
    caps[0].textContent = 'CRIT';
    caps[1].textContent = 'NEW';
    caps[2].textContent = 'CVES';
    caps[3].textContent = 'KEV';
  }
}

function renderMITRE(m) {
  const data = m.socops?.mitre || {};
  let entries = [];
  if (Array.isArray(data.tactics)) entries = data.tactics;
  else if (Array.isArray(data))    entries = data;
  else if (typeof data === 'object') entries = Object.entries(data).map(([k, v]) => ({ name: k, count: typeof v === 'number' ? v : (v?.count ?? 0) }));
  entries = entries.filter(x => x).slice(0, 10);
  const grid = $('#mitre-grid');
  if (!entries.length) {
    grid.innerHTML = '<div class="mitre-cell"><span class="tname">no MITRE data</span><span class="tcount">--</span></div>';
    return;
  }
  const max = Math.max(1, ...entries.map(e => e.count ?? e.value ?? 0));
  grid.innerHTML = entries.map(e => {
    const name = e.name || e.tactic || e.id || 'unknown';
    const cnt  = e.count ?? e.value ?? 0;
    const heat = Math.round((cnt / max) * 100);
    const safe = esc(name);
    return `<div class="mitre-cell">
              <div class="heat" style="width:${heat}%"></div>
              <span class="tname" title="${safe}">${safe}</span>
              <span class="tcount">${fmt(cnt)}</span>
            </div>`;
  }).join('');
}

function renderStream(m) {
  const a = m.socops?.alerts || {};
  let rows = [];
  if (Array.isArray(a.alerts)) rows = a.alerts;
  else if (Array.isArray(a.rows)) rows = a.rows;
  else if (Array.isArray(a))    rows = a;
  rows = rows.slice(0, 15);
  const tbody = $('#alert-stream');
  if (!rows.length) {
    tbody.innerHTML = '<tr class="empty"><td colspan="5">awaiting alerts…</td></tr>';
    return;
  }
  const seen = new Set();
  tbody.innerHTML = rows.map(r => {
    const id = r.id ?? r.alert_id ?? r.uid ?? `${r.timestamp || ''}-${r.rule || ''}`;
    seen.add(id);
    const isNew = !lastAlertIds.has(id);
    const ts = r.timestamp || r.created_at || r.time || '';
    const sev = r.severity ?? r.rule_level ?? r.level ?? r.alert ?? '';
    const sevLabel = String(sev || 'info').toUpperCase().slice(0, 5);
    const rule = r.rule_description || r.rule || r.description || r.title || '—';
    const agent = r.agent_name || r.agent || r.host || '—';
    const src = r.src_ip || r.source_ip || r.srcip || r.ip || '—';
    return `<tr class="${isNew ? 'new' : ''}">
              <td>${esc(String(ts).slice(11, 19) || '—')}</td>
              <td><span class="sev-pill ${severityClass(sev)}">${esc(sevLabel)}</span></td>
              <td title="${esc(rule)}">${esc(rule)}</td>
              <td>${esc(agent)}</td>
              <td>${esc(src)}</td>
            </tr>`;
  }).join('');
  lastAlertIds = seen;
}

function renderHoneypotChart(m) {
  // Render top probe types as bar chart (more SOC-meaningful than activity, which is on the EPS panel)
  const stats = m.honeypot?.stats || {};
  const byType = stats.by_type || {};
  const entries = Object.entries(byType).slice(0, 6);
  let labels = entries.map(([k]) => k.replace(/_/g, ' '));
  let data = entries.map(([, v]) => Number(v) || 0);
  if (!labels.length) {
    labels = ['Total', 'Creds', 'CVEs', 'Users'];
    data = [
      stats.total || 0,
      stats.cred_count || 0,
      Object.keys(stats.by_cve || {}).length,
      Array.isArray(stats.unique_users) ? stats.unique_users.length : (stats.unique_users || 0),
    ];
  }
  const colors = data.map((_, i) => {
    const palette = [
      'rgba(255, 56, 96, 0.7)',
      'rgba(255, 176, 0, 0.7)',
      'rgba(0, 204, 255, 0.7)',
      'rgba(0, 255, 136, 0.7)',
      'rgba(255, 94, 196, 0.7)',
      'rgba(160, 130, 255, 0.7)',
    ];
    return palette[i % palette.length];
  });
  if (state.charts.honeypot && state.charts.honeypot.config.type === 'bar') {
    state.charts.honeypot.data.labels = labels;
    state.charts.honeypot.data.datasets[0].data = data;
    state.charts.honeypot.data.datasets[0].backgroundColor = colors;
    state.charts.honeypot.update('none');
  } else {
    if (state.charts.honeypot) { state.charts.honeypot.destroy(); state.charts.honeypot = null; }
    state.charts.honeypot = buildBarChart('chart-honeypot', labels, data, colors);
  }
}

function renderTicker(m) {
  const events = m.honeypot?.events?.events || m.honeypot?.events || [];
  const items = (Array.isArray(events) ? events : []).slice(0, 25).map(e => {
    const ip = esc(e.src_ip || '?');
    const path = esc(e.path || '');
    const cve = e.cve ? `<span class="cve">${esc(e.cve)}</span>` : '';
    const alert = e.alert ? `<span class="alert">${esc(e.alert)}</span>` : '';
    return `<span class="ev">▸ <span class="ip">${ip}</span> ${alert} ${cve} ${path}</span>`;
  });
  if (!items.length) {
    const ips = m.honeypot?.ips?.ips || [];
    if (ips.length) {
      const sample = ips.slice(0, 30).map(i => `<span class="ev">▸ <span class="ip">${esc(i.ip)}</span> ${esc(i.country || '')}</span>`).join('');
      $('#log-ticker').innerHTML = sample || '▸ no honeypot activity';
    } else {
      $('#log-ticker').innerHTML = '▸ no honeypot activity';
    }
    return;
  }
  $('#log-ticker').innerHTML = items.join('') + items.join('');
}

function renderMap(m) {
  const ips = m.honeypot?.ips?.ips || [];
  renderAttackMap(ips);
  $('#meta-map').textContent = `honeypot · ${ips.length} unique`;
}

/* ── Refresh loop ─────────────────────────────────────────────────────── */
async function fetchMetrics() {
  try {
    const r = await fetch('/api/metrics', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    console.warn('metrics fetch failed:', e);
    return null;
  }
}

async function refresh() {
  const m = await fetchMetrics();
  if (!m) {
    $('#status-text').textContent = 'OFFLINE';
    $('#status-text').style.color = 'var(--crit)';
    return;
  }
  state.metrics = m;
  $('#status-text').textContent = 'ONLINE';
  $('#status-text').style.color = '';

  renderHealth(m.health, m.urls);
  renderHeaderKPIs(m);
  renderTimeline(m);
  renderSeverity(m);
  renderRules(m);
  renderEPS(m);
  renderCVE(m);
  renderMITRE(m);
  renderStream(m);
  renderHoneypotChart(m);
  renderTicker(m);
  renderMap(m);

  const t = new Date(m.ts * 1000);
  $('#last-update').textContent = `last refresh: ${pad2(t.getHours())}:${pad2(t.getMinutes())}:${pad2(t.getSeconds())}`;
  countdownLeft = REFRESH_MS / 1000;
}

function startLoop() {
  refresh();
  refreshTimer = setInterval(refresh, REFRESH_MS);
  countdownTimer = setInterval(() => {
    countdownLeft = Math.max(0, countdownLeft - 1);
    $('#refresh-counter').textContent = `next: ${countdownLeft}s`;
  }, 1000);
}

function dismissBoot() {
  setTimeout(() => {
    const ov = $('#boot-overlay');
    if (ov) ov.classList.add('hidden');
    setTimeout(() => ov && ov.remove(), 800);
  }, 1500);
}

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  startLoop();
  dismissBoot();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});
