# HomeTV 家庭混合 App

iOS 与 Android 的 App 显示名称为 HomeTV。iOS 工程目录、构建 scheme 和产物名也统一为 HomeTV。应用标识仍使用 `app.libretv.family`，以支持覆盖安装并保留登录与观看记录。

业务页面连接现有 HomeTV Node 服务；点播跳转到原生全屏播放器。iOS 使用 WKWebView + ZFPlayer（AVPlayer 内核），Android 使用 WebView + Media3 ExoPlayer。2026-10-15 服务端提交 `40c602e` 已部署至 `https://tv.fixepub.com`，iPhone’VIP 已安装开发签名 Release 测试版；尚未进行家庭正式分发。下方初次构建记录中的「未部署」描述当时状态，当前部署记录见 `PERSONALIZATION.md`。

## 已实现

- 全屏内选集/上一集/下一集、0.5～3 倍速、15～120 分钟定时停止（iOS 另有 1 分钟验收选项）、横竖屏切换。
- App 点进影片后，等待剧集和原生桥接就绪即自动进入全屏播放；退出全屏后留在影片页，可手动继续播放或改用网页播放器，不会立刻再次弹出。
- 倍速和定时跨选集保留，每集独立续播；iOS 到时保存进度、释放播放器并取消自动下一集；手动点击播放后重新加载续播。退出播放器取消定时，返回业务页保留进度。
- 原生进度本地持久化 → 同源桥接 → 网页 IndexedDB 提交/ACK → 既有家庭同步 API。同一成员共享网页和 App 记录；无成员时仅本机。
- 服务 Cookie 仅用于本站请求，第三方媒体直连失败后可经已有受鉴权代理重试。外部页面不能调用原生桥接。
- 可返回业务页选择其他源或手动使用网页播放器。网页测速逻辑保留，原生首帧/缓冲统计尚未接入源评分。

首版在后台、锁屏或失去前台时暂停播放；返回后核对定时期限。未启用后台音频、画中画或 JavaScript HLS 广告过滤。iOS 手机离线下载见下节。定时停止不退出 App。iOS 到时释放屏幕常亮，允许系统按“自动锁定”设置熄屏；不能强制立即锁屏，设为“永不”时不会自动锁定。直播页面仍使用网页播放器。

App 依赖带本轮桥接的服务端页面。家庭构建固定连接 `https://tv.fixepub.com`，首次打开无需填写地址。登录后可直接观看，无需选择成员；当前默认使用本机记录，需要跨设备同步或区分家人时再通过头像选择成员。访问会话会记忆，过期或退出后才需重新登录。所有签名证书、密码、设备 ID 均不写入代码。

底部导航依次为「首页」「直播」「高清」「设置」，不再常驻刷新入口；连接失败时提供「重试」。App 首页顶部仅保留「历史」，直播统一从底部第二个 Tab 进入。视频源管理、家庭同步、下载管理、外观和关于集中在底部设置页。家庭版固定使用默认服务，不再显示更换服务器入口。原生播放器的上一集、播放/暂停、下一集按钮紧凑靠左排列，iOS 的选集、倍速及定时保留在同一行右侧。

iOS Tab 高亮由同源页面路由驱动，包含 Next.js 的内部跳转、替换地址及浏览器前进/后退；直播及子路径归入直播，设置和关于归入设置，其余页面归入首页。导航通知脚本随安装包注入，无需服务端配合更新。回归测试运行实际注入脚本，并验证原生路由归属及外部来源隔离。

## iOS 本地构建

最低 iOS 16，本轮使用 Xcode 27。工程可直接打开 `ios/HomeTV.xcodeproj`。新增 Swift 文件后重新生成工程；生成器会覆盖工程配置，因此 Team ID 等本地值建议使用命令行参数或本地 xcconfig 管理。

从仓库根目录执行：

```bash
python3 mobile/scripts/generate-ios-project.py
xcodebuild -project mobile/ios/HomeTV.xcodeproj -scheme HomeTV \
  -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/libretv-ios-sim CODE_SIGNING_ALLOWED=NO build
xcodebuild -project mobile/ios/HomeTV.xcodeproj -scheme HomeTV \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath /tmp/libretv-ios-device CODE_SIGNING_ALLOWED=NO build
xcrun swiftc -module-cache-path /tmp/libretv-swift-cache \
  mobile/ios/HomeTV/SleepTimer.swift mobile/ios/HomeTV/PlaybackPosition.swift \
  mobile/ios/HomeTV/PlaybackSession.swift mobile/ios/HomeTV/NativeNavigation.swift \
  mobile/ios/HomeTV/OfflineLibrary.swift mobile/ios/Tests/OfflineLibraryTests.swift \
  mobile/ios/Tests/PlaybackPositionTests.swift mobile/ios/Tests/NativeNavigationTests.swift \
  mobile/ios/Tests/RegressionSupport.swift \
  mobile/ios/Tests/main.swift -o /tmp/libretv-sleep-tests
/tmp/libretv-sleep-tests
```

未签名的真机 `.app` 仅证明可以编译，不能安装到 iPhone。模拟器不能代替真机解码和后台验收。

## iOS 原生播放器

影片点播使用 [ZFPlayer](https://github.com/renzifeng/ZFPlayer) 4.1.4 的
`ZFAVPlayerManager`、`ZFPlayerController` 和 `ZFPlayerControlView`。底层解码仍为
AVFoundation；播放控件、缓冲进度及滑动手势由 ZFPlayer 提供。HomeTV 保留选集、
倍速、定时停止、同源认证与代理回退、观看进度桥接，并通过系统 scene API 管理横竖屏。
直播仍使用网页 ArtPlayer。

固定的上游源码及 MIT 许可在 `ios/Vendor/ZFPlayer`，工程生成器直接编译，
无需安装 CocoaPods。新增文件后仍执行 `generate-ios-project.py`，不要只改生成的工程。

原生播放器集成测试使用独立 bundle ID，不影响 HomeTV 数据或真机：

```bash
# 先启动一个 iOS 模拟器，传入它的 UDID。
python3 mobile/scripts/run-player-integration.py SIMULATOR_UDID
```

脚本从当前源码构建测试 App，使用本地合成视频验证播放、续播、暂停拖动、
前后集切换、自然片尾、后台暂停、定时停止和失败代理回退；输出 JSON 与横竖屏截图。
测试不会连接生产服务，截图和构建日志保留在脚本输出的临时目录。

初次接入验证：24 个原生逻辑场景、26 个播放器集成检查通过；已检查横竖屏截图，真机 Release 构建及签名验证通过。真实站点的解码效果仍以真机验收为准。

2026-10-15 后续修复：用户拖动会取代初始续播定位；缓冲重试随暂停、停止和切集失效；切集或取消定位会清除拖动状态，旧回调不能干扰新手势。回归测试现覆盖 45 个播放器集成检查，包含连续横竖屏切换、选集与快速切集、续播定位中拖动、缓冲后暂停/后台/退出。HomeTV 工程改名后，24 个基础场景和 45 个集成检查再次通过。

## iOS Ad Hoc

1. 在用户的 Apple 开发团队中确定唯一 Bundle ID，登记家人的 iPhone UDID，准备包含这些设备的 Ad Hoc 描述文件和有效分发证书。本轮未替用户登记或访问账号。
2. 在 Xcode 的 Signing & Capabilities 选择团队及 Bundle ID；也可向下面命令传入真实值。现有安装使用 `app.libretv.family`，更新测试机时应保留此标识。
3. 复制 `ios/ExportOptions.example.plist` 为 `ios/ExportOptions.local.plist`，填写真实 `teamID`；模板采用 Xcode 27 的 `release-testing`（Ad Hoc）导出方式。手动签名时还需按 Xcode 提示选择描述文件。
4. 完成签名配置后本地 Archive / Export；以下命令不包含上传或自动注册设备参数。

```bash
xcodebuild -project mobile/ios/HomeTV.xcodeproj -scheme HomeTV \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath mobile/artifacts/HomeTV.xcarchive \
  DEVELOPMENT_TEAM=YOUR_TEAM_ID PRODUCT_BUNDLE_IDENTIFIER=YOUR_BUNDLE_ID archive
xcodebuild -exportArchive -archivePath mobile/artifacts/HomeTV.xcarchive \
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

2026-10-15 底部导航增加第二个「直播」Tab，顺序为首页、直播、设置。`/live` 及子路径高亮第二项，设置和关于高亮第三项；SPA 跳转、返回和前进继续通过导航桥同步高亮。导航测试覆盖三个入口与高亮映射、路径边界及跨源隔离。iOS 原生 19 个场景、导航桥 6 项测试和真机 Release 签名构建通过。

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

### 测试失败报告（避免系统崩溃弹窗）

Swift 测试使用 `testRequire` / `testCheck`，失败包含文件、行号及原因。
基础测试失败以状态码 1 退出；模拟器测试写入 `player-integration.json`
的 `failures`、`failureDetails`、`aborted`，由 Python runner 返回非零状态。
缺失前置条件会停止后续场景，普通检查失败仍会记录；报告采用原子写入，
每次启动清除旧报告。测试支持代码只复制进隔离测试应用，不进入正式应用。

```bash
# 先验证缺失根视图、控件、播放器、错误类型/反射、普通检查失败及报告写入失败，再跑完整套件
python3 mobile/scripts/run-player-integration.py SIMULATOR_UDID --verify-failure-reporting
# 独立负例：应明确报告失败、返回 1，且不生成崩溃报告
python3 mobile/scripts/run-player-integration.py SIMULATOR_UDID --inject-failure missing-controls
# 基础测试和三个失败路径的自动验证
python3 mobile/scripts/run-native-tests.py
# 也可单独运行基础测试负例（先用上面的 swiftc 命令编译）
/tmp/libretv-sleep-tests --inject-missing-value
/tmp/libretv-sleep-tests --inject-wrong-type
/tmp/libretv-sleep-tests --inject-check-failure
```

推送 `personal` 分支或提交涉及 mobile 的 PR 时，`iOS regression` 会运行基础测试、
失败报告故障注入和完整播放器模拟器回归，并保存测试报告及构建日志。
最终报告写入失败会通过独立 stderr 通道立即报错；进度报告写入失败也会计入失败，
不会被最后的成功检查覆盖。


### iOS 手机下载与离线观看

- 原生播放器右上角「下载本集到手机」将当前集保存到这台 iPhone；网页播放页的下载按钮也转交原生下载。HLS 使用 AVAssetDownloadURLSession，MP4 使用后台 URLSession 文件下载，不在内存拼装整部影片。
- 「设置 → 下载管理」打开原生「我的下载」，显示进度、占用和失败原因。成功保存并验证可播放后才显示已完成；点已完成影片直接用 ZFPlayer 播放本地文件并保留本机续播位置。
- 无网络或服务器无法连接时，连接提示下仍有「我的下载 · 离线观看」入口；无需先加载网页、登录或访问服务器。
- 左滑条目，确认「删除文件」后删除手机视频及记录并释放空间；下载中条目可取消并删除。看完仅标记「已看完」，不会自动删除。下载不上传到云服务器或家庭同步；卸载 App 会清除本机下载。
- 下载可能使用蜂窝流量。后台下载由 iOS 调度；强制退出会中断任务，重新启动后恢复系统仍持有的任务，失去任务的下载显示失败。被片源限制、过期或不支持离线缓存的资源会报错，不能承诺所有来源都可下载。仅支持可直接访问的 HLS / MP4，不处理 BT、网盘或 DRM 授权。
- HLS 文件保留在系统提供的媒体包位置；MP4 与下载索引保存在 App 私有 Application Support 中，排除 iCloud 备份。持久化相对路径适配更新安装后的容器移动；只删除本 App 内已登记的视频文件。
- 回归使用仓库内合成 MP4/HLS 短片，验证真实下载、关闭来源后本地播放、续播、文件删除、重复点击、错误响应和取消后不复活。模拟器测试 App 必须使用本地 ad-hoc 签名，否则系统后台下载服务会拒绝无身份的客户端；不需要开发团队证书。

本轮验证：53 个原生逻辑场景、103 个模拟器集成检查通过；HLS/MP4 均验证来源关闭后仍可本地播放，删除同时清除媒体包/文件和记录。真机 Release 构建与签名验证通过，已覆盖安装并启动 iPhone’VIP。手机实际片源下载仍需验收；没有替用户下载整部影片。

## 2026-10-16 定时停止与系统自动锁屏

- 新增 1 分钟菜单项。计时采用绝对截止时间，定时检查注册到 common run-loop 模式，避免界面拖动阻塞检查。
- 新回归在旧版复现：重播定位完成回调晚于到点暂停时，仍会再次调用 `play`。播放管理器现在统一检查截止时间、睡眠状态、用户暂停和续播定位状态，阻止迟到回调重启。该竞态已复现，但没有用户现场日志，不能断定私人手机当时触发的是同一条路径。
- 到点保存进度和时长，取消解析任务、使旧回调失效、关闭进度定时器并释放媒体资源；释放音频会话及屏幕常亮。这里停止的是播放器相关任务，不是冻结 App 的所有系统线程。
- 定时结束后只有明确的播放、切集或重试操作才能恢复；关闭定时或调整倍速不会自行开始播放。退出和手动续播均保留原进度。
- 新增 `run-player-integration.py SIMULATOR_UDID --sleep-minute-only`：通过实际菜单动作设置一分钟，播放合成素材，使用真实时间且不操作播放器，验证到点停止、自动锁屏许可、无后续进度轮询和退出进度保存。模拟器不会证明真机屏幕已经熄灭，仍需私人手机验收系统自动锁定行为。

验证记录：53 个原生逻辑场景、108 个播放器集成检查通过；真实一分钟专项 6 项通过，约 61 秒确认停止，之后无自动播放或周期性进度事件，退出保存位置和时长。Release 构建及签名验证通过，已覆盖安装至私人 Huan’s iPhone（iPhone 15 Pro Max），版本 1.0.0（2）。用户解锁后已成功启动；真机自动锁屏仍待用户验收。

2026-10-16 review 回归固化：默认集成命令纳入 7 组、38 项倒计时边界检查，覆盖到期前切集、切集同时到期、片尾同时到期、迟到的片尾回调、停止后横竖屏切换、后台期间到期以及停止后反复前后台切换；同时验证停止后主动切集仍可播放。使用真实 ZFPlayer/AVPlayer 和按钮，截止时间与生命周期通知由测试注入，不代表真机锁屏验收；真实一分钟专项保持独立。

本轮完整默认集成回归 146 项全部通过，其中新增倒计时边界检查 38 项；无失败或提前中止。仅更新测试与说明文档，不需要重新安装手机 App。

## 2026-10-16 iOS 页面导航

- 首页、直播、高清专区、设置有统一原生顶部导航栏；搜索结果、影片详情、资源详情、关于页面提供返回入口。
- 返回优先使用同一 Tab 的浏览历史，保留搜索与筛选；直接打开高清资源详情时返回对应站点目录。主 Tab 根页面不显示跨 Tab 的返回按钮，外站 URL 不能控制原生导航。
- 导航栏避开刘海和状态栏，网页排在导航栏与底部 Tab 之间；全屏播放器、选集和下载管理沿用各自的返回或关闭控件。
- 默认集成回归增加 11 项导航检查；可使用 `python3 mobile/scripts/run-player-integration.py SIMULATOR_UDID --navigation-only` 单独验证导航及 Tab 横竖屏布局。测试使用本地页面，不连接生产服务。

验证：60 个原生逻辑场景、157 项完整播放器集成检查通过。最终导航专项 17 项通过，已检查横竖屏截图。Release 1.0.0（3）已覆盖安装私人 Huan’s iPhone，保留应用数据。

2026-10-16 导航配色调整：原生导航栏、状态栏与底部 Tab 同步网页已解析的浅色/深色主题，使用 `globals.css` 对应的背景、文字、边框与高亮配色。默认深色，启动时先使用上次主题；网页加载或设置切换后通过同源主 frame 桥接更新。仅覆盖原生栏的外观，不覆盖 WKWebView 或页面控制器的系统外观，避免干扰网页“跟随系统”选项。

验证：导航专项 21 项通过（新增深色、浅色、跨文档保持和系统偏好不被覆盖 4 项），并查看浅深色竖屏、深色横屏截图；测试页面直接读取仓库 CSS 主题色。Release 1.0.0（4）构建及签名验证通过。

2026-10-16 选集面板统一：页面栏与选集共用 `NativeTheme`，选集采用同主题导航栏和分组列表；当前集使用主题高亮、勾选与“当前集”提示，长标题自动换行，支持系统字体缩放，打开时定位当前集。完成按钮使用普通文字样式，避免新版系统实心强调色按钮降低深色对比度。播放器切集时同步刷新仍打开的列表标识。

新增选集回归覆盖浅深色配色、当前集与长标题、打开面板后旋转，以及关闭面板不意外恢复暂停播放；已有切集与横屏关闭回归继续执行。最终 Release 版本为 1.0.0（5）。

最终验证：60 个原生逻辑场景和 168 项完整播放器集成检查全部通过；已复核选集浅深色与横屏截图。Release 1.0.0（5）构建通过。

已覆盖安装并成功启动私人 Huan’s iPhone（iPhone 15 Pro Max）的 Release 1.0.0（5）；真机界面体验待用户验收。
