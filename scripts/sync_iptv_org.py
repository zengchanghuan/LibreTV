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
import sys
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
    """Status is advisory: malformed JSON must not block a fresh sync."""
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (FileNotFoundError, ValueError, UnicodeError):
        return {}


def inspect_playlist(data):
    if data is None:
        return None
    try:
        return normalize(data)[1]
    except (ValueError, UnicodeError):
        return None


def synchronize(output, state_dir, fetch=download):
    output, state_dir = Path(output), Path(state_dir)
    attempt = datetime.now(timezone.utc).isoformat()
    previous_status = {}
    recovered = False
    published = False
    try:
        state_dir.mkdir(parents=True, exist_ok=True)
        previous_status = read_json(state_dir / 'last-success.json')
        old = output.read_bytes() if output.exists() else None
        previous_count = inspect_playlist(old)
        if previous_count is None:
            backup_path = state_dir / 'previous.m3u'
            backup = backup_path.read_bytes() if backup_path.exists() else None
            backup_count = inspect_playlist(backup)
            if backup_count is not None:
                # Restore a validated backup even if the upstream is offline.
                # Never rotate corrupt output over the last usable backup.
                atomic_write(output, backup)
                old, previous_count = backup, backup_count
                recovered = True
        raw = fetch()
        data, count = normalize(raw, localize=True)
        if previous_count is not None and count < previous_count * 0.5:
            raise ValueError('Channel count dropped by more than 50%; keeping last good playlist')
        changed = old != data
        if changed:
            if previous_count is not None:
                atomic_write(state_dir / 'previous.m3u', old)
            atomic_write(output, data)
            published = True
        status = {
            'ok': True, 'checkedAt': attempt, 'lastSuccessAt': attempt,
            'upstream': UPSTREAM, 'language': 'eng', 'channels': count,
            'chineseSuffix': True, 'recoveredBackup': recovered,
            'changed': changed, 'sha256': hashlib.sha256(data).hexdigest(),
            'upstreamSha256': hashlib.sha256(raw).hexdigest(),
        }
        encoded = (json.dumps(status, ensure_ascii=False, indent=2) + '\n').encode()
        atomic_write(state_dir / 'last-success.json', encoded)
        atomic_write(state_dir / 'last-result.json', encoded)
        return status
    except Exception as error:
        status = {
            'ok': False, 'checkedAt': attempt,
            'lastSuccessAt': previous_status.get('lastSuccessAt'),
            'upstream': UPSTREAM, 'language': 'eng',
            'recoveredBackup': recovered, 'playlistUpdated': published,
            'error': str(error)[:400],
        }
        try:
            atomic_write(state_dir / 'last-result.json', (json.dumps(status, indent=2) + '\n').encode())
        except OSError as status_error:
            # Disk/permission failures may prevent recording status too. Keep the
            # original failure visible in systemd's journal rather than masking it.
            print('Could not record sync failure: ' + str(status_error), file=sys.stderr)
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
