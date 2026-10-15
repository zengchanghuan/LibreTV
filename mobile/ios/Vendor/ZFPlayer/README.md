# ZFPlayer vendored dependency

Upstream: https://github.com/renzifeng/ZFPlayer
Version: 4.1.4; revision: `1ede0b9fd80d52a1474201ee506285c9792acb46`.
License: MIT (see LICENSE).

Core, AVPlayer and ControlView are copied from upstream. One Xcode 27 compatibility change removes the private `netinet6/in6.h` import from ZFReachabilityManager; the public `netinet/in.h` already provides the required declarations. The deterministic
Xcode project generator compiles their Objective-C sources with ARC and copies
ZFPlayer.bundle into the application. No CocoaPods installation is required.
HomeTV-specific controls and playback policy live outside this directory.
