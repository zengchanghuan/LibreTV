#!/usr/bin/env python3
"""Run real ZFPlayer/AVFoundation regression scenarios in an isolated simulator app.
Usage: python3 mobile/scripts/run-player-integration.py SIMULATOR_UDID
Requires a booted iOS simulator. Does not touch HomeTV app data or a real device.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json, shutil, subprocess, sys, tempfile, threading, time

repo = Path(__file__).resolve().parents[2]
work = Path(tempfile.mkdtemp(prefix='hometv-player-integration-', dir='/tmp'))
print('Working directory:', work, flush=True)
project = work / 'mobile'
shutil.copytree(repo / 'mobile/ios', project / 'ios', ignore=shutil.ignore_patterns('xcuserdata'))
(project / 'scripts').mkdir()
shutil.copy2(repo / 'mobile/scripts/generate-ios-project.py', project / 'scripts')
code = project / 'ios/LibreTV'
shutil.copy2(project / 'ios/Tests/PlayerIntegrationHarness.swift', code)
p = code / 'AppDelegate.swift'
s = p.read_text().replace('window.rootViewController = BrowserController()', 'window.rootViewController = UIViewController()')
s = s.replace('window.makeKeyAndVisible(); self.window = window', 'window.makeKeyAndVisible(); self.window = window\n        runPlayerIntegration(window: window, scene: scene)')
p.write_text(s)
subprocess.run([sys.executable, str(project / 'scripts/generate-ios-project.py')], check=True)
video = (project / 'ios/Tests/Fixtures/player.mp4').read_bytes()
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
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
device = sys.argv[1]
def sim(*args):
    return subprocess.check_output(['xcrun', 'simctl', *args], text=True).strip()
try:
    with (work / 'build.log').open('w') as log:
        subprocess.run(['xcodebuild', '-project', str(project / 'ios/LibreTV.xcodeproj'), '-scheme', 'LibreTV', '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', str(work / 'build'), 'CODE_SIGNING_ALLOWED=NO', 'PRODUCT_BUNDLE_IDENTIFIER='+bundle, 'build'], stdout=log, stderr=subprocess.STDOUT, check=True)
    sim('install', device, str(work / 'build/Build/Products/Debug-iphonesimulator/LibreTV.app'))
    container = Path(sim('get_app_container', device, bundle, 'data')) / 'Documents'
    # Reinstalls preserve simulator data; never accept a previous run's report.
    (container / 'player-integration.json').unlink(missing_ok=True)
    sim('launch', '--terminate-running-process', device, bundle)
    for _ in range(100):
        result = container / 'player-integration.json'
        if result.exists():
            shutil.copytree(container, work / 'results', dirs_exist_ok=True)
            report = json.loads(result.read_text())
            print(json.dumps(report, indent=2, ensure_ascii=False))
            if report['failures']: raise RuntimeError('Player regression checks failed')
            break
        time.sleep(1)
    else: raise TimeoutError('Player harness did not finish')
finally:
    server.shutdown()
    subprocess.run(['xcrun','simctl','terminate',device,bundle], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print('Results and build log:', work, flush=True)
