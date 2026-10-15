# ZFPlayer vendored dependency

Upstream: https://github.com/renzifeng/ZFPlayer
Version: 4.1.4; revision: `1ede0b9fd80d52a1474201ee506285c9792acb46`.
License: MIT (see LICENSE).

Core, AVPlayer and ControlView are copied from upstream. One Xcode 27 compatibility change removes the private `netinet6/in6.h` import from ZFReachabilityManager; the public `netinet/in.h` already provides the required declarations. The deterministic
Xcode project generator compiles their Objective-C sources with ARC and copies
ZFPlayer.bundle into the application. No CocoaPods installation is required.
HomeTV-specific controls and playback policy live outside this directory.

Local playback fixes:
- Pause preserves in-flight seeks and asset loading; stop and replacement seeks
  still cancel. Sleep/background pauses cannot strand resume completion.
- Buffer retries preserve playback intent and are bound to an item/generation;
  play, pause and stop invalidate queued retries. Queued KVO events from a
  replaced item are ignored.
- Pan and slider seek completions use gesture generations, release dragging on
  cancellation and reset both orientations on an episode change. Late callbacks
  cannot release a newer drag.

Regression coverage: `mobile/ios/Tests/PlayerIntegrationHarness.swift` exercises
real AVPlayer seeks, cancellations, item replacement and delayed buffer recovery.
