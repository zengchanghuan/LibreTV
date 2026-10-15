# 英语直播自动同步

`sync_iptv_org.py` 只下载 IPTV-org 官方英语分类 `languages/eng.m3u`，不按名称或国家猜测语言。语言归类由上游维护，不代表每一段节目均为英语，也不代表所有频道始终可播。

频道显示名保留原始英文，并追加 `｜ 中文名/说明`。`channel_names_zh.py` 保存常见电视台、节目的通行译名和地区/类型描述；没有通行中文名的品牌、地方台保留原名或呼号，配中文类型说明，不虚构官方中文名。规则随每次同步执行，不依赖外部翻译服务，也不修改台标、tvg-id、分组或播放地址。

当前服务器使用 `systemd/libretv-iptv-sync.service` 和 `.timer`，每天 **04:00 Asia/Shanghai** 运行。`Persistent=true` 使服务器停机期间错过的任务在恢复后补跑，不依赖本地电脑或 Codex 保持运行。

- 输出：`/var/lib/libretv-public/iptv-sync/english.m3u`。
- Nginx 对外地址沿用 `/live-sources/iptv-org.m3u`，因此已有客户端勾选状态不变。
- 最新执行结果：`/var/lib/libretv-sync/last-result.json`；上次成功：`last-success.json`。
- 内容变化时原子替换文件，并保留一份 `previous.m3u`；未变化时不重写。
- 下载、格式、写入失败，少于 100 台或相对现有英语列表减少超过 50%，均不替换当前列表。下载最多尝试三次。
- 服务仅能写英语输出目录和同步状态目录，不修改独立的 `verified.m3u`。`DEFAULT_LIVE_SOURCES` 始终让原来已验证的 27 台在第一项，英语订阅在第二项。

同步后服务端订阅解析缓存最多保留 10 分钟；重新打开直播页会在缓存过期后获取新列表。无需为每次源更新重启 LibreTV。

服务器检查或立即执行：

```sh
systemctl list-timers libretv-iptv-sync.timer
systemctl start libretv-iptv-sync.service
systemctl status libretv-iptv-sync.service
journalctl -u libretv-iptv-sync.service -n 20 --no-pager
```

部署时先创建输出和状态目录，属主设为 `libretv`；将 `sync_iptv_org.py` 和 `channel_names_zh.py` 一起安装到 `/usr/local/lib/libretv/`，单元文件安装到 `/etc/systemd/system/`。先运行并检查一次服务，再让 Nginx 指向新输出，最后启用定时器。原全球快照及环境、Nginx 配置在本次部署备份中保留，部署记录位于 `config/iptv-org.snapshot.json`。仓库记录的频道数是部署时点结果，日常运行状态以服务器 JSON 为准。

回归测试（不访问网络）：

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts -p 'test_sync_iptv_org.py' -v
```
