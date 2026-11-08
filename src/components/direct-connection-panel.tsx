'use client';

import { useEffect, useState } from 'react';
import {
  buildDirectRules, clearDirectHosts, getDirectHosts, subscribeDirectHosts,
  type DirectRuleFormat,
} from '@/lib/direct-connection';
import { copyToClipboard } from '@/lib/clipboard';
import { SectionTitle, SelectRow } from './settings-shared';
import { useToast } from './toast';

export function DirectConnectionPanel() {
  const [hosts, setHosts] = useState<string[]>([]);
  const [format, setFormat] = useState<DirectRuleFormat>('clash');
  const { toast } = useToast();
  useEffect(() => {
    const refresh = () => setHosts(getDirectHosts());
    refresh();
    return subscribeDirectHosts(refresh);
  }, []);
  const rules = buildDirectRules(hosts, format);

  const download = () => {
    const url = URL.createObjectURL(new Blob([rules], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `hometv-direct.${format === 'clash' ? 'yaml' : 'txt'}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    toast('规则文件已生成，请在代理工具中添加并启用', 'info');
  };

  return (
    <section className="space-y-4">
      <SectionTitle title="代理工具直连" />
      <p className="text-sm text-content">
        在 Clash、小火箭等代理工具中，为本站和媒体地址设置直连（DIRECT）。网页无法自动绕过系统代理或 VPN，也无法判断规则是否已生效。
      </p>
      <p className="text-xs text-muted">先播放视频，再回来导出规则。导出后还需在代理工具中添加并启用。</p>
      <SelectRow
        label="导出格式"
        value={format}
        onChange={(value) => setFormat(value as DirectRuleFormat)}
        options={[
          { value: 'clash', label: 'Clash / Mihomo' },
          { value: 'text', label: '规则文本' },
        ]}
      />
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span>本站及已遇到的地址 · {hosts.length} 个</span>
        <button type="button" className="text-accent hover:underline" onClick={clearDirectHosts}>清空采集记录</button>
      </div>
      <textarea
        aria-label="直连规则预览"
        className="input w-full h-44 resize-y font-mono text-xs"
        readOnly
        spellCheck={false}
        value={rules}
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary btn-sm" disabled={!hosts.length} onClick={async () => {
          const copied = await copyToClipboard(rules);
          toast(copied ? '已复制，请在代理工具中添加并启用' : '复制失败，请从预览框手动复制', copied ? 'info' : 'error');
        }}>复制规则</button>
        <button type="button" className="btn-ghost btn-sm" disabled={!hosts.length} onClick={download}>下载规则</button>
      </div>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer text-accent">如何启用和确认直连</summary>
        <ol className="list-decimal pl-5 mt-3 space-y-2">
          <li>Clash / Mihomo：将条目合并到现有 rules 最前面，启用规则模式。文件是配置片段，请勿替换整个订阅。</li>
          <li>小火箭等其他工具：在当前配置里为列表中的域名或 IP 添加直连规则，并使用按配置分流。全局代理模式可能忽略这些规则。</li>
          <li>应用规则后重新加载页面，并在代理工具的连接记录中确认本站及媒体连接显示 DIRECT。</li>
        </ol>
        <p className="mt-3">
          部分原生播放或跨域跳转地址可能不可见，遗漏时请从代理工具的连接记录补充。本站的服务器转发仍保留用于播放兼容，它与用户设备的代理工具是两回事。
        </p>
      </details>
      <p className="text-xs text-faint">
        仅在当前标签页保存最近遇到的最多 256 个资源主机名，不保存播放链接、令牌或片名，不上传。清空后新的请求会继续补充；更换视频源或出现新域名时，需要重新添加规则。
      </p>
    </section>
  );
}
