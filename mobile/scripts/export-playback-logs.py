#!/usr/bin/env python3
"""Export only HomeTV's bounded playback logs from a paired iPhone to a new temp folder."""
import argparse
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("device", help="Device UDID from xcrun devicectl list devices")
args = parser.parse_args()
destination = Path(tempfile.mkdtemp(prefix="hometv-playback-logs-"))
subprocess.run([
    "xcrun", "devicectl", "device", "copy", "from", "--device", args.device,
    "--domain-type", "appDataContainer", "--domain-identifier", "app.libretv.family",
    "--source", "Library/Application Support/PlaybackLogs",
    "--destination", str(destination), "--timeout", "30",
], check=True)
print(f"Playback logs: {destination}")
