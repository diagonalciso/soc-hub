/* CD-Startpage SOC video-wall — live dashboard logic */
'use strict';

const REFRESH_MS = 5000;
const CLOCK_TZ_LABEL = (() => {
  try {
    const tz = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(new Date())
      .find(p => p.type === 'timeZoneName');
    if (tz && tz.value) return tz.value;
  } catch (e) { /* fall through */ }
  const off = -new Date().getTimezoneOffset();
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
})();
let refreshTimer = null;
let countdownTimer = null;
let countdownLeft = REFRESH_MS / 1000;
let lastAlertIds = new Set();

/* ── State ────────────────────────────────────────────────────────────── */
const state = { metrics: null, charts: {} };

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
// Wazuh's stock "critical" is rule.level >= 12, but this estate's rules top
// out at 10, so that tile could only ever read 0. Level 9+ is the real
// critical band here (25 at L9, 18 at L10 over 7d).
const CRITICAL_LEVEL = 9;

// True 24h count from Wazuh's by_level aggregate. The soc-ops alert list is
// only a 15-row sample, so counting criticals from it under-reports badly.
function criticalFromWazuh(m) {
  const levels = m.wazuh?.alerts_24h?.by_level;
  if (!Array.isArray(levels) || !levels.length) return null;
  return levels.reduce(
    (n, b) => (Number(b.label) >= CRITICAL_LEVEL ? n + (Number(b.count) || 0) : n), 0);
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

// Alerts in the most recent 5-minute bucket of the fine-grained soc-ops timeline.
function recentAlertRate(fine) {
  if (!Array.isArray(fine) || !fine.length) return 0;
  return Number(fine[fine.length - 1].count) || 0;
}

/* ── Clock ─────────────────────────────────────────────────────────────── */
function tickClock() {
  const d = new Date();
  // Orbitron ships no tabular-figure feature (its only OpenType features are kern
  // and mark), so font-variant-numeric:tabular-nums is a no-op on this font and the
  // digits keep their wildly uneven natural advances -- '1' is 391/1000 em against
  // 834 for '0' and '8'. Setting the clock as plain text therefore made it visibly
  // jump sideways every time a digit ticked past a 1. Box each digit instead (see
  // .clock-time .dg); colons keep their natural narrow width so the look is
  // unchanged. Safe as innerHTML: the content is generated digits, never input.
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  $('#clock-time').innerHTML = time.replace(/\d/g, ch => `<span class="dg">${ch}</span>`);
  $('#clock-date').textContent = `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${CLOCK_TZ_LABEL}`;
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
  let up = 0, total = 0;
  $$('.svc').forEach(svc => {
    const k = svc.dataset.key;
    const isUp = !!health?.[k];
    svc.dataset.status = isUp ? 'up' : 'down';
    if (urls && urls[k]) svc.href = urls[k];
    total++; if (isUp) up++;
  });
  const txt = `${up}/${total}`;
  const c1 = $('#svc-count-txt'); if (c1) c1.textContent = txt;
  const c2 = $('#svc-count-txt2'); if (c2) c2.textContent = txt;
  const badge = $('#svc-count');
  if (badge) badge.dataset.health = up === total ? 'ok' : (up === 0 ? 'down' : 'degraded');
}

function renderHeaderKPIs(m) {
  const stats = m.socops?.stats || {};
  const kpis  = m.socops?.kpis  || {};
  const sbom  = m.sbomguard?.stats || {};

  const alertsArr = Array.isArray(m.socops?.alerts) ? m.socops.alerts
                  : (Array.isArray(m.socops?.alerts?.alerts) ? m.socops.alerts.alerts : []);
  const sevCounts = severityFromAlerts(alertsArr);

  const alerts24 = kpis.alerts_last_24h ?? kpis.alerts_24h ?? stats.today ?? stats.total ?? null;
  const wzCrit   = criticalFromWazuh(m);
  const critical = wzCrit !== null ? wzCrit : (sevCounts.critical || 0);
  const cves     = sbom.new_matches ?? sbom.total_cves ?? null;
  const eps      = recentAlertRate(m.socops?.timeline_fine);

  $('#hdr-alerts24').textContent = alerts24 != null ? fmt(alerts24) : '--';
  $('#hdr-critical').textContent = critical != null ? fmt(critical) : '--';
  $('#hdr-cves').textContent     = cves     != null ? fmt(cves)     : '--';
  $('#hdr-eps').textContent      = eps      != null ? fmt(eps)      : '--';
  $('#meta-eps').textContent     = 'last 5 min · soc-ops';

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
    // No substitute source: an empty timeline renders as an honest empty 24h axis
    // rather than silently borrowing another feed's data under this panel's label.
    const now = new Date();
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 3600 * 1000);
      labels.push(pad2(d.getHours()) + 'h');
      data.push(0);
    }
    source = 'soc-ops · no data';
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
  // Alert rate sparkline: 5-minute buckets from soc-ops over the last 2h.
  const fine = m.socops?.timeline_fine;
  let labels = [], data = [];
  if (Array.isArray(fine) && fine.length) {
    fine.slice(-24).forEach(p => {
      labels.push(p.label || '');
      data.push(Number(p.count) || 0);
    });
  } else {
    for (let i = 23; i >= 0; i--) { labels.push(`-${i * 5}m`); data.push(0); }
  }
  if (state.charts.eps) {
    state.charts.eps.data.labels = labels;
    state.charts.eps.data.datasets[0].data = data;
    state.charts.eps.update('none');
  } else {
    state.charts.eps = buildLineChart('chart-eps', labels, data, '#00ccff');
  }
}

function agentSeen(iso) {
  // Agents here cycle by design (SV08 is a printer, only up when printing),
  // so last-seen is neutral context, not an alarm.
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (mins < 60)   return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

function renderAgents(m) {
  const agents = Array.isArray(m.wazuh?.agents) ? m.wazuh.agents : [];
  const ul = $('#agent-list');
  if (!agents.length) {
    ul.innerHTML = '<li class="empty">no agent data</li>';
    $('#meta-agents').textContent = 'wazuh · no data';
    return;
  }
  const c = m.wazuh?.agent_count || {};
  $('#meta-agents').textContent = `${c.active ?? '?'}/${c.total ?? agents.length} reporting`;
  ul.innerHTML = agents.map(a => {
    const active = a.status === 'active';
    // The collector flattens os to a plain string ("Debian GNU/Linux"),
    // falling back to platform; it is not a nested object.
    const os = a.os || a.platform || '';
    const tip = [a.id, a.ip, a.version].filter(Boolean).join(' · ');
    return `<li class="agent ${active ? 'up' : 'down'}">`
         + `<span class="dot"></span>`
         + `<span class="name" title="${esc(tip)}">${esc(a.name)}</span>`
         + `<span class="agent-os" title="${esc(os)}">${esc(os)}</span>`
         + `<span class="agent-seen">${esc(agentSeen(a.lastKeepAlive))}</span>`
         + `</li>`;
  }).join('');
}

function renderWazuhVulns(m) {
  const v = m.wazuh?.vulnerabilities || {};
  const map = { critical: v.critical, high: v.high, medium: v.medium, low: v.low };
  $$('#wvuln-stats .stat-num').forEach(el => {
    const val = map[el.dataset.key];
    el.textContent = (val === undefined || val === null) ? '--' : fmt(val);
  });
  $('#meta-wvulns').textContent = v.total ? `${fmt(v.total)} total · wazuh` : 'wazuh · no data';

  const byAgent = Array.isArray(v.by_agent) ? v.by_agent : [];
  const seen = {};
  (m.wazuh?.agents || []).forEach(a => { seen[a.name] = a; });
  const ul = $('#wvuln-agents');
  if (!byAgent.length) {
    ul.innerHTML = '<li class="empty">no vulnerability data</li>';
    return;
  }
  ul.innerHTML = byAgent.slice(0, 6).map((b, i) => {
    const a = seen[b.label];
    const when = a ? agentSeen(a.lastKeepAlive) : '';
    return `<li><span class="rank">${i + 1}</span>`
         + `<span class="name" title="${esc(b.label)}">${esc(b.label)}`
         + (when ? ` <span class="agent-seen">${esc(when)}</span>` : '')
         + `</span><span class="count">${fmt(b.count)}</span></li>`;
  }).join('');
}

function renderWazuhCVEs(m) {
  const cves = Array.isArray(m.wazuh?.critical_cves) ? m.wazuh.critical_cves : [];
  const tb = $('#wcve-list');
  if (!cves.length) {
    tb.innerHTML = '<tr class="empty"><td colspan="5">no critical CVEs</td></tr>';
    $('#meta-wcves').textContent = 'wazuh · no data';
    return;
  }
  $('#meta-wcves').textContent = `wazuh · ${cves.length}`;
  tb.innerHTML = cves.map(c => {
    const score = (c.score === '' || c.score === null || c.score === undefined)
      ? '--' : Number(c.score).toFixed(1);
    return `<tr>`
         + `<td><span class="sev-pill crit">${esc(score)}</span></td>`
         + `<td class="mono">${esc(c.cve)}</td>`
         + `<td>${esc(c.agent)}</td>`
         + `<td title="${esc(c.package)}">${esc(String(c.package).slice(0, 28))}</td>`
         + `<td title="${esc(c.title)}">${esc(String(c.title).slice(0, 70))}</td>`
         + `</tr>`;
  }).join('');
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
    if (!isNaN(d.getTime())) feedLabel = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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

function renderTicker(m) {
  const alerts = Array.isArray(m.socops?.alerts) ? m.socops.alerts
               : (Array.isArray(m.socops?.alerts?.alerts) ? m.socops.alerts.alerts : []);
  const items = alerts.slice(0, 25).map(a => {
    const agent = esc(a.agent_name || a.agent_ip || '?');
    const desc  = esc(a.rule_description || '');
    const lvl   = Number(a.rule_level ?? 0);
    const sev   = severityClass(lvl >= 12 ? 'critical' : lvl >= 8 ? 'high' : lvl >= 4 ? 'medium' : 'low');
    const src   = a.srcip ? `<span class="ip">${esc(a.srcip)}</span>` : '';
    return `<span class="ev">▸ <span class="ip">${agent}</span> `
         + `<span class="alert ${sev}">L${lvl}</span> ${src} ${desc}</span>`;
  });
  if (!items.length) {
    $('#log-ticker').innerHTML = '▸ no alerts';
    return;
  }
  $('#log-ticker').innerHTML = items.join('') + items.join('');
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
  renderAgents(m);
  renderWazuhVulns(m);
  renderWazuhCVEs(m);
  renderMITRE(m);
  renderStream(m);
  renderTicker(m);

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

function initLauncher() {
  const btn = $('#svc-toggle'), drawer = $('#svc-drawer');
  if (!btn || !drawer) return;
  const open = () => { drawer.hidden = false; btn.setAttribute('aria-expanded', 'true'); };
  const close = () => { drawer.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  const toggle = () => (drawer.hidden ? open() : close());
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  // close on outside click, Esc, or picking a service
  document.addEventListener('click', (e) => {
    if (!drawer.hidden && !drawer.contains(e.target) && e.target !== btn) close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  drawer.addEventListener('click', (e) => { if (e.target.closest('.svc')) close(); });
}

document.addEventListener('DOMContentLoaded', () => {
  initLauncher();
  startLoop();
  dismissBoot();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});
