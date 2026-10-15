#!/usr/bin/env python3
"""Run native logic tests and verify failure reporting without assertion traps."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
ios = root / "mobile/ios"
sources = [
    "HomeTV/SleepTimer.swift", "HomeTV/PlaybackPosition.swift",
    "HomeTV/PlaybackSession.swift", "HomeTV/NativeNavigation.swift",
    "Tests/PlaybackPositionTests.swift", "Tests/NativeNavigationTests.swift",
    "Tests/RegressionSupport.swift", "Tests/main.swift",
]
with tempfile.TemporaryDirectory(prefix="hometv-native-tests-") as work:
    binary = str(Path(work) / "native-tests")
    subprocess.run(["xcrun", "swiftc", "-module-cache-path", work + "/cache",
                    *[str(ios / source) for source in sources], "-o", binary], check=True)
    subprocess.run([binary], check=True)
    for flag, message in [
        ("--inject-missing-value", "Injected missing value"),
        ("--inject-wrong-type", "Injected wrong type"),
        ("--inject-check-failure", "Injected expectation failure"),
    ]:
        result = subprocess.run([binary, flag], capture_output=True, text=True)
        # Negative return codes are signals, not a correctly reported failure.
        if (result.returncode != 1 or "REGRESSION_FAILED:" not in result.stderr
                or "main.swift:" not in result.stderr or message not in result.stderr):
            raise RuntimeError(f"Failure reporting regression {flag}: exit={result.returncode} {result.stdout} {result.stderr}")
        print(f"FAILURE_REPORTING_OK: {flag}")
