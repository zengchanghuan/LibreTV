#!/usr/bin/env python3
"""Publish the official English playlist; never modify the curated 27 channels."""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import urlsplit
from channel_names_zh import localize_metadata

UPSTREAM = 'https://iptv-org.github.io/iptv/languages/eng.m3u'
MAX_BYTES = 10 * 1024 * 1024
MIN_CHANNELS = 100


def normalize(raw, localize=False):
    if len(raw) > MAX_BYTES:
        raise ValueError('Playlist exceeds size limit')
    text = raw.decode('utf-8-sig')
    lines = text.splitlines()
    if not lines or not lines[0].startswith('#EXTM3U'):
        raise ValueError('Missing M3U header')
    entries, seen, pending = [], set(), None
    for line in lines[1:]:
        line = line.strip()
        if not line:
            continue
        if line.startswith('#EXTINF:'):
            if pending is not None or ',' not in line:
                raise ValueError('Incomplete channel entry')
            pending = [localize_metadata(line) if localize else line]
        elif line.startswith('#'):
            if pending is not None:
                pending.append(line)
        else:
            if pending is None:
                raise ValueError('Stream without channel metadata')
            parsed = urlsplit(line)
            if parsed.scheme in ('http', 'https') and parsed.hostname:
                if line not in seen:
                    seen.add(line)
                    entries.append('\n'.join(pending + [line]))
            pending = None
    if pending is not None:
        raise ValueError('Truncated playlist')
    if len(entries) < MIN_CHANNELS:
        raise ValueError('Too few channels to publish')
    result = '#EXTM3U\n#PLAYLIST:IPTV-org · English\n' + '\n'.join(entries) + '\n'
    return result.encode(), len(entries)


def download():
    # curl tolerates the slow GitHub route better than the app's 15-second fetch.
    result = subprocess.run([
        '/usr/bin/curl', '--fail', '--silent', '--show-error', '--location',
        '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '15',
        '--max-time', '90', '--retry', '2', '--retry-delay', '5',
        '--max-filesize', str(MAX_BYTES), UPSTREAM,
    ], capture_output=True, timeout=290, check=True)
    return result.stdout


def atomic_write(path, data):
    path = Path(path)
    # Temp file on the same filesystem makes replacement atomic for Nginx readers.
    descriptor, name = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
            os.fchmod(handle.fileno(), 0o644)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def read_json(path):
    return json.loads(path.read_text()) if path.exists() else {}


def synchronize(output, state_dir, fetch=download):
    output, state_dir = Path(output), Path(state_dir)
    state_dir.mkdir(parents=True, exist_ok=True)
    previous_status = read_json(state_dir / 'last-success.json')
    attempt = datetime.now(timezone.utc).isoformat()
    try:
        raw = fetch()
        data, count = normalize(raw, localize=True)
        # Inspect the actual published file, rather than trusting a stale status file.
        if output.exists():
            old = output.read_bytes()
            _, previous_count = normalize(old)
            if count < previous_count * 0.5:
                raise ValueError('Channel count dropped by more than 50%; keeping last good playlist')
        else:
            old = None
        changed = old != data
        if changed:
            if old is not None:
                atomic_write(state_dir / 'previous.m3u', old)
            atomic_write(output, data)
        status = {
            'ok': True, 'checkedAt': attempt, 'lastSuccessAt': attempt,
            'upstream': UPSTREAM, 'language': 'eng', 'channels': count,
            'chineseSuffix': True,
            'changed': changed, 'sha256': hashlib.sha256(data).hexdigest(),
            'upstreamSha256': hashlib.sha256(raw).hexdigest(),
        }
        encoded = (json.dumps(status, ensure_ascii=False, indent=2) + '\n').encode()
        atomic_write(state_dir / 'last-success.json', encoded)
        atomic_write(state_dir / 'last-result.json', encoded)
        return status
    except Exception as error:
        # Never overwrite a working playlist on a network/validation failure.
        status = {
            'ok': False, 'checkedAt': attempt,
            'lastSuccessAt': previous_status.get('lastSuccessAt'),
            'upstream': UPSTREAM, 'language': 'eng',
            'error': str(error)[:400],
        }
        atomic_write(state_dir / 'last-result.json', (json.dumps(status, indent=2) + '\n').encode())
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--state-dir', type=Path, required=True)
    args = parser.parse_args()
    args.state_dir.mkdir(parents=True, exist_ok=True)
    with (args.state_dir / '.sync.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Sync already running; skipped')
            return
        print(json.dumps(synchronize(args.output, args.state_dir), ensure_ascii=False))


if __name__ == '__main__':
    main()
