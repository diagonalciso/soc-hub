#!/usr/bin/env python3
"""CD-Startpage: live SOC video-wall dashboard.

Aggregates metrics from SOC Ops, SOC SBOM, NetScaler honeypot, Wazuh dashboard,
and SOC Intel into a single auto-refreshing operations view.
"""
import http.server
import socketserver
import socket
import os
import json
import time
import threading
import ssl
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

_INSECURE_SSL = ssl.create_default_context()
_INSECURE_SSL.check_hostname = False
_INSECURE_SSL.verify_mode = ssl.CERT_NONE

os.chdir(os.path.dirname(os.path.abspath(__file__)))


def load_env():
    file_env = {}
    if os.path.exists('.env'):
        with open('.env') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    file_env[key.strip()] = value.strip()

    defaults = {
        'STARTPAGE_PORT': '8080',
        'STARTPAGE_HOST': '0.0.0.0',
        'SOCOPS_URL': 'http://10.10.0.40:8081',
        'SBOMGUARD_URL': 'http://10.10.0.40:8082',
        'SOCINT_URL': 'http://10.10.0.40:8083',
        'HONEYPOT_URL': 'http://10.10.0.40:8084',
        'WAZUH_URL': 'http://10.10.0.40:8080',
        'ROADMAP_URL': 'http://10.10.0.40:8090',
        'PHISHING_URL': 'http://10.10.0.40:8091',
        'ATTACK_URL': 'http://10.10.0.40:8092',
        'CANARY_URL': 'http://10.10.0.40:8093',
        'CRED_URL': 'http://10.10.0.40:8094',
        'PASSIVEDNS_URL': 'http://10.10.0.40:8095',
        'RANSOMWARE_URL': 'http://10.10.0.40:8096',
        'SHINYHUNTERS_URL': 'http://10.10.0.40:8097',
        'QILIN_URL': 'http://10.10.0.40:8098',
        'IR_URL': 'http://10.10.0.40:8206',
        'SOCMAP_URL': 'http://10.10.0.40:8100',
        'NIDS_URL': 'http://10.10.0.40:8102',
        'DETECTIONS_URL': 'http://10.10.0.40:8103',
        'VALIDATE_URL': 'http://10.10.0.40:8104',
        'OSINT_URL': 'http://10.10.0.40:8105',
        'SPIDERFOOT_URL': 'http://10.10.0.40:8106',
        'CYBERCHEF_URL': 'http://10.10.0.40:8107',
        'EMLANALYZER_URL': 'http://10.10.0.40:8108',
        'WAZUHMAP_URL': 'https://10.10.0.174:8100/attackmap',
        'IRIS_URL': 'https://10.10.0.40:8443',
        'SOC_NAME': 'CLAW SOC',
        'METRICS_CACHE_TTL': '5',
        'METRICS_FETCH_TIMEOUT': '2.5',
    }
    # precedence: defaults < .env file < real shell env
    merged = {**defaults, **file_env}
    for k in defaults:
        if k in os.environ and os.environ[k]:
            merged[k] = os.environ[k]
    return merged


CONFIG = load_env()
CACHE_TTL = float(CONFIG['METRICS_CACHE_TTL'])
FETCH_TIMEOUT = float(CONFIG['METRICS_FETCH_TIMEOUT'])

_cache = {'data': None, 'ts': 0.0}
_cache_lock = threading.Lock()


def _fetch_json(url, timeout=None):
    if timeout is None:
        timeout = FETCH_TIMEOUT
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'CD-Startpage/2.0'})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            if not raw:
                return None
            return json.loads(raw.decode('utf-8', errors='replace'))
    except (urllib.error.URLError, urllib.error.HTTPError, socket.timeout, ValueError, OSError):
        return None
    except Exception:
        return None


def _probe(url, timeout=1.5):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'CD-Startpage/2.0'})
        ctx = _INSECURE_SSL if url.startswith('https://') else None
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            return r.status < 500
    except urllib.error.HTTPError as e:
        return e.code < 500
    except Exception:
        return False


def collect_metrics():
    """Fetch metrics from each downstream service in parallel."""
    socops = CONFIG['SOCOPS_URL'].rstrip('/')
    sbom = CONFIG['SBOMGUARD_URL'].rstrip('/')
    socint = CONFIG['SOCINT_URL'].rstrip('/')
    honeypot = CONFIG['HONEYPOT_URL'].rstrip('/')
    wazuh = CONFIG['WAZUH_URL'].rstrip('/')

    extra_services = {
        'roadmap':      CONFIG['ROADMAP_URL'].rstrip('/'),
        'ransomware':   CONFIG['RANSOMWARE_URL'].rstrip('/'),
        'shinyhunters': CONFIG['SHINYHUNTERS_URL'].rstrip('/'),
        'qilin':        CONFIG['QILIN_URL'].rstrip('/'),
        'ir':           CONFIG['IR_URL'].rstrip('/'),
        'phishing':     CONFIG['PHISHING_URL'].rstrip('/'),
        'attack':       CONFIG['ATTACK_URL'].rstrip('/'),
        'canary':       CONFIG['CANARY_URL'].rstrip('/'),
        'cred':         CONFIG['CRED_URL'].rstrip('/'),
        'passivedns':   CONFIG['PASSIVEDNS_URL'].rstrip('/'),
        'socmap':       CONFIG['SOCMAP_URL'].rstrip('/'),
        'nids':         CONFIG['NIDS_URL'].rstrip('/'),
        'detections':   CONFIG['DETECTIONS_URL'].rstrip('/'),
        'validate':     CONFIG['VALIDATE_URL'].rstrip('/'),
        'osint':        CONFIG['OSINT_URL'].rstrip('/'),
        'spiderfoot':   CONFIG['SPIDERFOOT_URL'].rstrip('/'),
        'cyberchef':    CONFIG['CYBERCHEF_URL'].rstrip('/'),
        'eml':          CONFIG['EMLANALYZER_URL'].rstrip('/'),
        'wazuhmap':     CONFIG['WAZUHMAP_URL'].rstrip('/'),
        'iris':         CONFIG['IRIS_URL'].rstrip('/'),
    }

    self_port = int(CONFIG['STARTPAGE_PORT'])
    self_markers = {f':{self_port}', f'127.0.0.1:{self_port}', f'localhost:{self_port}'}

    def _enabled(base):
        if not base:
            return False
        # Skip URLs pointing at ourselves to prevent feedback loops
        return not any(m in base for m in self_markers)

    job_specs = []
    if _enabled(socops):
        job_specs += [
            ('socops_stats',    f'{socops}/api/stats'),
            ('socops_kpis',     f'{socops}/api/kpis'),
            ('socops_mitre',    f'{socops}/api/mitre'),
            ('socops_rules',    f'{socops}/api/rules'),
            ('socops_timeline', f'{socops}/api/timeline/global'),
            ('socops_alerts',   f'{socops}/api/alerts?per=15'),
        ]
    if _enabled(sbom):
        job_specs += [
            ('sbom_stats',      f'{sbom}/api/stats'),
            ('sbom_feed',       f'{sbom}/api/feed-status'),
            ('sbom_matches',    f'{sbom}/api/matches?status=new'),
        ]
    if _enabled(honeypot):
        job_specs += [
            ('honeypot_stats',  f'{honeypot}/api/stats'),
            ('honeypot_ips',    f'{honeypot}/api/unique-ips'),
            ('honeypot_events', f'{honeypot}/api/events?per=25'),
        ]

    jobs = dict(job_specs)
    results = {}
    if jobs:
        with ThreadPoolExecutor(max_workers=min(13, len(jobs))) as pool:
            futures = {pool.submit(_fetch_json, url): name for name, url in jobs.items()}
            for fut in as_completed(futures):
                name = futures[fut]
                try:
                    results[name] = fut.result()
                except Exception:
                    results[name] = None

    health = {
        'socops':    bool(results.get('socops_stats') or results.get('socops_kpis')),
        'sbomguard': bool(results.get('sbom_stats') or results.get('sbom_feed') is not None),
        'socint':    _probe(socint) if _enabled(socint) else False,
        'honeypot':  bool(results.get('honeypot_stats') or results.get('honeypot_ips')),
        'wazuh':     _probe(wazuh) if _enabled(wazuh) else False,
    }

    extra_targets = {k: v for k, v in extra_services.items() if _enabled(v)}
    if extra_targets:
        with ThreadPoolExecutor(max_workers=min(10, len(extra_targets))) as pool:
            futures = {pool.submit(_probe, url): key for key, url in extra_targets.items()}
            for fut in as_completed(futures):
                key = futures[fut]
                try:
                    health[key] = bool(fut.result())
                except Exception:
                    health[key] = False
    for key in extra_services:
        health.setdefault(key, False)

    return {
        'ts': time.time(),
        'soc_name': CONFIG['SOC_NAME'],
        'urls': {
            'socops': socops,
            'sbomguard': sbom,
            'socint': socint,
            'honeypot': honeypot,
            'wazuh': wazuh,
            **extra_services,
        },
        'health': health,
        'socops': {
            'stats':    results.get('socops_stats') or {},
            'kpis':     results.get('socops_kpis') or {},
            'mitre':    results.get('socops_mitre') or {},
            'rules':    results.get('socops_rules') or {},
            'timeline': results.get('socops_timeline') or [],
            'alerts':   results.get('socops_alerts') or {},
        },
        'sbomguard': {
            'stats':   results.get('sbom_stats') or {},
            'feed':    results.get('sbom_feed') or {},
            'matches': results.get('sbom_matches') if isinstance(results.get('sbom_matches'), list) else [],
        },
        'honeypot': {
            'stats':  results.get('honeypot_stats') or {},
            'ips':    results.get('honeypot_ips') or {},
            'events': results.get('honeypot_events') or {},
        },
        'wazuh': {},
    }


def get_metrics():
    with _cache_lock:
        age = time.time() - _cache['ts']
        if _cache['data'] is None or age > CACHE_TTL:
            _cache['data'] = collect_metrics()
            _cache['ts'] = time.time()
        return _cache['data']


def _refresh_worker():
    while True:
        try:
            data = collect_metrics()
            with _cache_lock:
                _cache['data'] = data
                _cache['ts'] = time.time()
        except Exception as exc:
            print(f'[metrics] refresh failed: {exc}')
        time.sleep(CACHE_TTL)


class ReusableThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def server_bind(self):
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        super().server_bind()


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Quiet logs; only log errors
        if args and isinstance(args[1], str) and args[1].startswith(('4', '5')):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def do_GET(self):
        path = self.path.split('?', 1)[0]

        if path in ('/', ''):
            return self._serve_dashboard()
        if path == '/api/config':
            return self._json({
                'socops': CONFIG['SOCOPS_URL'],
                'sbomguard': CONFIG['SBOMGUARD_URL'],
                'socint': CONFIG['SOCINT_URL'],
                'honeypot': CONFIG['HONEYPOT_URL'],
                'wazuh': CONFIG['WAZUH_URL'],
                'soc_name': CONFIG['SOC_NAME'],
            })
        if path == '/api/metrics':
            return self._json(get_metrics())
        if path == '/api/health':
            return self._json(get_metrics().get('health', {}))
        if path == '/api/docs/user-manual':
            return self._serve_manual()

        return super().do_GET()

    def _json(self, obj, code=200):
        body = json.dumps(obj, default=str).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_dashboard(self):
        try:
            with open('index.html', 'r', encoding='utf-8') as f:
                html = f.read()
        except FileNotFoundError:
            self.send_error(500, 'index.html missing')
            return

        replacements = {
            '{{SOC_NAME}}':          CONFIG['SOC_NAME'],
            '{{SOCOPS_URL}}':        CONFIG['SOCOPS_URL'],
            '{{SBOMGUARD_URL}}':     CONFIG['SBOMGUARD_URL'],
            '{{SOCINT_URL}}':        CONFIG['SOCINT_URL'],
            '{{HONEYPOT_URL}}':      CONFIG['HONEYPOT_URL'],
            '{{WAZUH_URL}}':         CONFIG['WAZUH_URL'],
            '{{ROADMAP_URL}}':       CONFIG['ROADMAP_URL'],
            '{{PHISHING_URL}}':      CONFIG['PHISHING_URL'],
            '{{ATTACK_URL}}':        CONFIG['ATTACK_URL'],
            '{{CANARY_URL}}':        CONFIG['CANARY_URL'],
            '{{CRED_URL}}':          CONFIG['CRED_URL'],
            '{{PASSIVEDNS_URL}}':    CONFIG['PASSIVEDNS_URL'],
            '{{RANSOMWARE_URL}}':    CONFIG['RANSOMWARE_URL'],
            '{{SHINYHUNTERS_URL}}':  CONFIG['SHINYHUNTERS_URL'],
            '{{QILIN_URL}}':         CONFIG['QILIN_URL'],
            '{{IR_URL}}':            CONFIG['IR_URL'],
            '{{SOCMAP_URL}}':     CONFIG['SOCMAP_URL'],
            '{{NIDS_URL}}':       CONFIG['NIDS_URL'],
            '{{DETECTIONS_URL}}': CONFIG['DETECTIONS_URL'],
            '{{VALIDATE_URL}}':   CONFIG['VALIDATE_URL'],
            '{{OSINT_URL}}':      CONFIG['OSINT_URL'],
            '{{SPIDERFOOT_URL}}': CONFIG['SPIDERFOOT_URL'],
            '{{CYBERCHEF_URL}}':  CONFIG['CYBERCHEF_URL'],
            '{{EMLANALYZER_URL}}':CONFIG['EMLANALYZER_URL'],
            '{{WAZUHMAP_URL}}':   CONFIG['WAZUHMAP_URL'],
            '{{IRIS_URL}}':       CONFIG['IRIS_URL'],
        }
        for k, v in replacements.items():
            html = html.replace(k, v)

        body = html.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_manual(self):
        try:
            with open('STARTPAGE_MANUAL.html', 'r', encoding='utf-8') as f:
                html = f.read()
        except FileNotFoundError:
            self.send_error(404, 'Manual not found')
            return

        body = html.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    port = int(CONFIG['STARTPAGE_PORT'])
    host = CONFIG['STARTPAGE_HOST']

    refresher = threading.Thread(target=_refresh_worker, daemon=True)
    refresher.start()

    print(f'CD-Startpage SOC video-wall: http://{host}:{port}')
    print(f'  cache TTL: {CACHE_TTL}s   fetch timeout: {FETCH_TIMEOUT}s')
    print(f'  upstreams: socops={CONFIG["SOCOPS_URL"]} sbom={CONFIG["SBOMGUARD_URL"]} '
          f'honeypot={CONFIG["HONEYPOT_URL"]} wazuh={CONFIG["WAZUH_URL"]}')

    with ReusableThreadingHTTPServer((host, port), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nShutting down.')


if __name__ == '__main__':
    main()
