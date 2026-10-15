# LibreTV 家庭混合 App

业务页面连接现有 LibreTV Node 服务；点播跳转到原生全屏播放器。iOS 使用 WKWebView + AVPlayerLayer，Android 使用 WebView + Media3 ExoPlayer。2026-10-15 服务端提交 `40c602e` 已部署至 `https://tv.fixepub.com`，iPhone’VIP 已安装开发签名 Release 测试版；尚未进行家庭正式分发。下方初次构建记录中的「未部署」描述当时状态，当前部署记录见 `PERSONALIZATION.md`。

## 已实现

- 全屏内选集/上一集/下一集、0.5～3 倍速、15～120 分钟定时停止、横竖屏切换。
- 倍速和定时跨选集保留，每集独立续播；到时暂停并取消自动下一集。退出播放器取消定时，返回业务页保留进度。
- 原生进度本地持久化 → 同源桥接 → 网页 IndexedDB 提交/ACK → 既有家庭同步 API。同一成员共享网页和 App 记录；无成员时仅本机。
- 服务 Cookie 仅用于本站请求，第三方媒体直连失败后可经已有受鉴权代理重试。外部页面不能调用原生桥接。
- 可返回业务页选择其他源或手动使用网页播放器。网页测速逻辑保留，原生首帧/缓冲统计尚未接入源评分。

首版在后台、锁屏或失去前台时暂停播放；返回后核对定时期限。未启用后台音频、画中画、离线下载或 JavaScript HLS 广告过滤。定时停止不退出 App、不自动锁屏。直播页面仍使用网页播放器。

App 依赖带本轮桥接的服务端页面。家庭构建默认连接 `https://tv.fixepub.com`，首次打开无需填写地址；手动设置过的地址优先。登录后可直接观看，无需选择成员；当前默认使用本机记录，需要跨设备同步或区分家人时再通过头像选择成员。访问会话会记忆，过期或退出后才需重新登录。所有签名证书、密码、设备 ID 均不写入代码。

## iOS 本地构建

最低 iOS 16，本轮使用 Xcode 27。工程可直接打开 `ios/LibreTV.xcodeproj`。新增 Swift 文件后重新生成工程；生成器会覆盖工程配置，因此 Team ID 等本地值建议使用命令行参数或本地 xcconfig 管理。

从仓库根目录执行：

```bash
python3 mobile/scripts/generate-ios-project.py
xcodebuild -project mobile/ios/LibreTV.xcodeproj -scheme LibreTV \
  -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/libretv-ios-sim CODE_SIGNING_ALLOWED=NO build
xcodebuild -project mobile/ios/LibreTV.xcodeproj -scheme LibreTV \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath /tmp/libretv-ios-device CODE_SIGNING_ALLOWED=NO build
xcrun swiftc -module-cache-path /tmp/libretv-swift-cache \
  mobile/ios/LibreTV/SleepTimer.swift mobile/ios/LibreTV/PlaybackPosition.swift \
  mobile/ios/Tests/PlaybackPositionTests.swift mobile/ios/Tests/main.swift -o /tmp/libretv-sleep-tests
/tmp/libretv-sleep-tests
```

未签名的真机 `.app` 仅证明可以编译，不能安装到 iPhone。模拟器不能代替真机解码和后台验收。

## iOS Ad Hoc

1. 在用户的 Apple 开发团队中确定唯一 Bundle ID，登记家人的 iPhone UDID，准备包含这些设备的 Ad Hoc 描述文件和有效分发证书。本轮未替用户登记或访问账号。
2. 在 Xcode 的 Signing & Capabilities 选择团队及 Bundle ID；也可向下面命令传入真实值。默认 `app.libretv.family` 是可修改占位值。
3. 复制 `ios/ExportOptions.example.plist` 为 `ios/ExportOptions.local.plist`，填写真实 `teamID`；模板采用 Xcode 27 的 `release-testing`（Ad Hoc）导出方式。手动签名时还需按 Xcode 提示选择描述文件。
4. 完成签名配置后本地 Archive / Export；以下命令不包含上传或自动注册设备参数。

```bash
xcodebuild -project mobile/ios/LibreTV.xcodeproj -scheme LibreTV \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath mobile/artifacts/LibreTV.xcarchive \
  DEVELOPMENT_TEAM=YOUR_TEAM_ID PRODUCT_BUNDLE_IDENTIFIER=YOUR_BUNDLE_ID archive
xcodebuild -exportArchive -archivePath mobile/artifacts/LibreTV.xcarchive \
  -exportOptionsPlist mobile/ios/ExportOptions.local.plist \
  -exportPath mobile/artifacts/ios-ad-hoc
```

导出的 IPA 仅能装到描述文件中登记的设备。签名及描述文件需按有效期维护。当前没有可安装的 Ad Hoc IPA。

## Android APK

最低 Android 8（API 26），需要 Android SDK 36、JDK 17 或 21。仓库包含 Gradle 8.12 Wrapper，固定了官方下载校验值。设置 `JAVA_HOME` 指向可用 JDK；设置 `ANDROID_HOME` 或创建本地 `mobile/android/local.properties`。

```bash
cd mobile/android
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

测试 APK：[`artifacts/LibreTV-android-debug.apk`](artifacts/LibreTV-android-debug.apk)（本轮保留的副本）；构建原始输出为 `mobile/android/app/build/outputs/apk/debug/app-debug.apk`。使用 Android 标准 Debug 签名，适合本地验收；不同机器的 Debug 密钥可能不同，不能作为长期家庭更新签名。

正式分发应创建并安全备份长期密钥，通过环境变量提供：

- `LIBRETV_KEYSTORE`：密钥库绝对路径
- `LIBRETV_STORE_PASSWORD`：密钥库密码
- `LIBRETV_KEY_ALIAS`：别名
- `LIBRETV_KEY_PASSWORD`：密钥密码

配置后运行 `./gradlew :app:assembleRelease`，输出位于 `app/build/outputs/apk/release/`。未设置密钥时 Release 输出是未签名 APK，不能直接安装。覆盖更新须保持相同 applicationId 和签名，提高 versionCode；从 Debug 换到正式签名可能需要先卸载测试版。

Release 只接受 HTTPS 服务及媒体，HTTP 媒体需通过 HTTPS 服务代理。Debug 为本地测试允许回环服务地址：iOS `http://127.0.0.1:端口`，Android 模拟器 `http://10.0.2.2:端口` 或 adb reverse 的 `http://127.0.0.1:端口`。没有放开证书校验。

## 验证记录与待办

2026-10-15：

| 层级 | 已验证 | 尚未验证 |
| --- | --- | --- |
| Web / 桥接接收 | lint、类型检查、365 项测试；重复/乱序、成员隔离、结束、删除防复活 | App 与独立浏览器真实互相续播 |
| iOS | 模拟器 Debug、真机 arm64 Release 未签名构建；原生定时 5 个场景；模拟器安装/进程启动 | Mac 锁屏，未操作菜单或验证解码；无签名 IPA、无真机验证 |
| Android | Debug APK（签名校验通过）、未签名 Release 构建、定时 3 项单元测试、lint（非阻断提示） | 未接手机，本机未创建 AVD；未验证界面与实际解码；无正式签名 |
| 部署 | 无 | 按用户要求先不部署 |

定时测试用可注入时钟覆盖边界到点、延迟回调不重复停止、挂起后补查、取消、重新设置。尚未通过真机验证定时与自然片尾同刻发生、耳机中断和系统终止进程。

2026-10-15 代理重试进度修复：双端在替换失败媒体前保存当前播放位置，恢复期间的临时零值不会覆盖续播目标。新增双端各 6 个回归场景，覆盖续播后中途失败、恢复期间再次失败、无效时钟、初次加载失败、主动回到开头及跨集/片尾隔离。

本轮验证：Web 365 项测试、lint、类型检查、生产构建通过；iOS 6 个进度场景及 5 个定时场景通过，模拟器 Debug 与真机 Release 未签名构建通过；Android 使用临时 Java 21 / Kotlin 2.1.20 工具链直接编译并运行 JUnit，6 个进度测试及 3 个定时测试通过。本机缺少 Android SDK，未重跑 APK 构建或 Android lint；未进行真机代理故障注入验收。

后续真机验收顺序：登录选头像 → HLS/MP4 → 全屏内换集及各集续播 → 1.5 倍速跨集 → 定时暂停且不连播 → 横竖屏/后台返回 → 断网与代理回退 → 独立浏览器同成员同步 → Ad Hoc/APK 安装与覆盖更新。

原生待发送队列按服务隔离，网页事务提交成功才删除。进程重启后的旧队列遇到更高服务端版本会保守舍弃，避免恢复已删除历史；可能丢弃那次旧进程尚未上传的离线进度。家庭同步仍是最终一致，后台不承诺即时上传。HTTP 无扩展名直连、站点私有格式及编码需要逐源实测；原生不能增加设备本身没有的解码器。
