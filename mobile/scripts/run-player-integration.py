#!/usr/bin/env python3
"""Run real ZFPlayer/AVFoundation regression scenarios in an isolated simulator app.
Usage: python3 mobile/scripts/run-player-integration.py SIMULATOR_UDID
Requires a booted iOS simulator. Does not touch HomeTV app data or a real device.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import argparse, json, shutil, subprocess, sys, tempfile, threading, time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("device")
parser.add_argument("--sleep-minute-only", action="store_true", help="Verify the real one-minute menu and unattended stop")
parser.add_argument("--offline-only", action="store_true", help="Run download and offline playback checks only")
parser.add_argument("--verify-failure-reporting", action="store_true", help="Exercise missing prerequisites and a failed check before the normal suite")
parser.add_argument("--inject-failure", choices=["missing-root", "missing-controls", "missing-player", "wrong-manager", "missing-reflection", "wrong-type", "failed-check", "progress-write", "report-write"])
args = parser.parse_args()

repo = Path(__file__).resolve().parents[2]
work = Path(tempfile.mkdtemp(prefix='hometv-player-integration-', dir='/tmp'))
print('Working directory:', work, flush=True)
project = work / 'mobile'
shutil.copytree(repo / 'mobile/ios', project / 'ios', ignore=shutil.ignore_patterns('xcuserdata'))
(project / 'scripts').mkdir()
shutil.copy2(repo / 'mobile/scripts/generate-ios-project.py', project / 'scripts')
code = project / 'ios/HomeTV'
for name in ["PlayerIntegrationHarness.swift", "RegressionSupport.swift"]:
    shutil.copy2(project / "ios/Tests" / name, code)
p = code / 'AppDelegate.swift'
s = p.read_text()
entry = 'window.makeKeyAndVisible(); self.window = window'
if s.count(entry) != 1:
    raise RuntimeError('Cannot install player test entry point')
s = s.replace(entry, 'window.makeKeyAndVisible(); self.window = window\n        runPlayerIntegration(window: window, scene: scene)')
p.write_text(s)
# Exercise the real browser/tab bar as the presenter, with an isolated local
# page so orientation regression checks never contact the production service.
browser = code / 'BrowserController.swift'
browser_source = browser.read_text()
connect = 'if let url = bundled ?? saved { connect(url) }'
if browser_source.count(connect) != 1:
    raise RuntimeError('Cannot isolate browser from production service')
browser.write_text(browser_source.replace(connect,
    'if let url = URL(string: "http://127.0.0.1:18085") { connect(url) }'))
subprocess.run([sys.executable, str(project / 'scripts/generate-ios-project.py')], check=True)
video = (project / 'ios/Tests/Fixtures/player.mp4').read_bytes()
class Handler(BaseHTTPRequestHandler):
    offline_blocked = False
    def do_GET(self):
        path = self.path.split('?')[0]
        if path in ['/offline-test-block', '/offline-test-unblock']:
            Handler.offline_blocked = path == '/offline-test-block'
            self.send_response(200); self.end_headers(); return
        if path.startswith('/offline-') and Handler.offline_blocked:
            self.send_error(503); return
        if path.startswith('/offline-hls/'):
            fixture = project / 'ios/Tests/Fixtures/hls' / Path(path).name
            if not fixture.is_file(): self.send_error(404); return
            data = fixture.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'application/vnd.apple.mpegurl' if fixture.suffix == '.m3u8' else 'video/mp2t')
            self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data); return
        if self.path.split('?')[0] in ['/', '/hd', '/settings']:
            page = b'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#101827;color:white"><h1>HomeTV</h1><p>Local player regression fixture</p></body></html>'
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(page))); self.end_headers()
            self.wfile.write(page); return
        if self.path.startswith('/fail.mp4') or 'always-fail.mp4' in self.path:
            self.send_error(404); return
        start, end = 0, len(video) - 1
        raw = self.headers.get('Range')
        if raw:
            a, b = raw.removeprefix('bytes=').split(',')[0].split('-')
            start, end = int(a or 0), min(int(b) if b else end, end)
        self.send_response(206 if raw else 200)
        self.send_header('Content-Type', 'video/mp4')
        self.send_header('Accept-Ranges', 'bytes')
        if raw: self.send_header('Content-Range', f'bytes {start}-{end}/{len(video)}')
        self.send_header('Content-Length', str(end-start+1)); self.end_headers()
        self.wfile.write(video[start:end+1])
    def log_message(self, *args): pass
server = ThreadingHTTPServer(('127.0.0.1', 18085), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
bundle = 'app.libretv.playerintegration'
device = args.device
def sim(*args):
    return subprocess.check_output(['xcrun', 'simctl', *args], text=True).strip()
try:
    with (work / 'build.log').open('w') as log:
        subprocess.run(['xcodebuild', '-project', str(project / 'ios/HomeTV.xcodeproj'), '-scheme', 'HomeTV', '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', str(work / 'build'), 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', 'PRODUCT_BUNDLE_IDENTIFIER='+bundle, 'build'], stdout=log, stderr=subprocess.STDOUT, check=True)
    sim('install', device, str(work / 'build/Build/Products/Debug-iphonesimulator/HomeTV.app'))
    container = Path(sim('get_app_container', device, bundle, 'data')) / 'Documents'
    simulator_home = Path(sim('getenv', device, 'HOME'))
    def run(fault=None):
        # Reinstalls preserve simulator data; never accept a previous run's report.
        for name in ['player-integration.json', 'player-progress.json']:
            (container / name).unlink(missing_ok=True)
        launch_args = ['--harness-failure=' + fault] if fault else (['--sleep-minute-only'] if args.sleep_minute_only else ['--offline-only'] if args.offline_only else [])
        # simctl resolves absolute output paths inside the simulator's data root.
        stderr_path = '/tmp/' + work.name + '/stderr-' + (fault or 'normal') + '.log'
        stdout_path = '/tmp/' + work.name + '/stdout-' + (fault or 'normal') + '.log'
        stderr = simulator_home / stderr_path.lstrip('/')
        stdout = simulator_home / stdout_path.lstrip('/')
        launch = sim('launch', '--terminate-running-process', '--stdout=' + stdout_path, '--stderr=' + stderr_path, device, bundle, *launch_args)
        pid = launch.rsplit(':', 1)[-1].strip()
        try:
            # Allow the default suite to include the sleep boundary matrix.
            for _ in range(240):
                errors = stderr.read_text(errors='replace') if stderr.exists() else ''
                if 'PLAYER_REPORT_ERROR:' in errors:
                    subprocess.run(['kill', '-0', pid], check=True, capture_output=True)
                    raise RuntimeError(errors[errors.index('PLAYER_REPORT_ERROR:'):].strip())
                result = container / 'player-integration.json'
                if result.exists():
                    report = json.loads(result.read_text())
                    target = work / ('failure-' + fault if fault else 'results')
                    shutil.copytree(container, target, dirs_exist_ok=True)
                    if not isinstance(report.get('failures'), list) or not isinstance(report.get('failureDetails'), list) or not isinstance(report.get('aborted'), bool):
                        raise RuntimeError('Malformed harness report: ' + str(target))
                    # The harness must remain alive after reporting, even on a
                    # missing prerequisite. A trap/abort is not a test result.
                    subprocess.run(['kill', '-0', pid], check=True, capture_output=True)
                    return report
                time.sleep(1)
            progress = container / 'player-progress.json'
            detail = progress.read_text() if progress.exists() else 'No progress report'
            raise TimeoutError('Player harness did not finish. Last progress: ' + detail)
        finally:
            for log in [stdout, stderr]:
                if log.exists():
                    shutil.copy2(log, work / log.name)
            subprocess.run(['xcrun', 'simctl', 'terminate', device, bundle], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    if args.verify_failure_reporting:
        expected = {
            'missing-root': 'Missing root view controller',
            'missing-controls': 'Missing initial player controls',
            'missing-player': 'Missing player: controls',
            'wrong-manager': 'Unexpected player manager: controls',
            'missing-reflection': 'Missing or invalid reflected controls',
            'wrong-type': 'Missing or invalid reflected controls',
            'failed-check': 'injected-expectation',
            'progress-write': 'Could not write progress report',
        }
        for fault, message in expected.items():
            report = run(fault)
            expected_failures = {'failed-check': ['injected-expectation'], 'progress-write': ['progress-report']}.get(fault, ['harness-prerequisite'])
            if (report['failures'] != expected_failures
                    or report.get('aborted') != (fault not in ('failed-check', 'progress-write'))
                    or not any(message in text and 'PlayerIntegrationHarness.swift:' in text for text in report['failureDetails'])):
                raise RuntimeError('Failure reporting regression: ' + fault + ': ' + json.dumps(report))
            print('FAILURE_REPORTING_OK:', fault, flush=True)
        try:
            run('report-write')
        except RuntimeError as error:
            if 'PLAYER_REPORT_ERROR:' not in str(error):
                raise
            print('FAILURE_REPORTING_OK: report-write', flush=True)
        else:
            raise RuntimeError('Report write failure was incorrectly accepted')
    report = run(args.inject_failure)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    if report['failures'] or report.get('aborted'):
        print('PLAYER_REGRESSION_FAILED: ' + '; '.join(report['failureDetails']), file=sys.stderr)
        sys.exit(1)

finally:
    server.shutdown()
    subprocess.run(['xcrun','simctl','terminate',device,bundle], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print('Results and build log:', work, flush=True)
