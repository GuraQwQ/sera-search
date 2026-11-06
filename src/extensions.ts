import type { Config, ExtensionName, Source } from './types.js';
import { extensionNames } from './types.js';
import { BackendPool } from './backends.js';
import { hit, object, rows, string } from './providers/shared.js';

const platformId = (name: string) => name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');

export function createExtensionSources(config: Config, pool: BackendPool): Source[] {
  return extensionNames.map((name: ExtensionName): Source => {
    const configured = Boolean(config[name] && config[name]?.enabled !== false);
    const accounts = name !== 'gods-eye-view';
    const sites = async (signal: AbortSignal) => {
      const catalogue: Record<string, unknown>[] = [];
      let offset = 0;
      while (true) {
        const page = object(await pool.data(config, name, 'list_sites', { offset, limit: 1000 }, signal), name);
        catalogue.push(...rows(page.sites, '账号平台'));
        if (!page.truncated) return catalogue;
        if (!Number.isSafeInteger(page.nextOffset) || Number(page.nextOffset) <= offset) throw new Error('账号目录分页缺少有效的下一页位置');
        offset = Number(page.nextOffset);
      }
    };
    return {
      capability: { name, configured, search: accounts, read: false, backend: true, category: 'platform',
        requirement: `install --components ${name}；${name === 'aliens-eye' ? '按平台扫描公开账号，关联与头像匹配通过 backend 分步调用' : accounts ? '按站点规则发现公开账号并保留检测状态' : '按 Schema 查询地理对象、观测和预测数据'}` },
      channels: accounts ? async signal => (await sites(signal)).map(site => ({
        source: name, platform: platformId(string(site.name)), search: true, read: false, configured, browser: false,
        description: string(site.urlTemplate),
      })) : undefined,
      search: accounts ? async request => {
        const started = Date.now();
        if (request.since || request.at) throw new Error('账号存在性扫描需要当前用户名；历史内容请按主页链接查询档案');
        const catalogue = await sites(request.signal);
        const selected = catalogue.filter(site => {
          if (request.platform && platformId(string(site.name)) !== request.platform.toLowerCase()) return false;
          if (request.domains?.length) {
            try {
              const host = new URL(string(site.urlTemplate).replaceAll('{}', 'sera-handle')).hostname.toLowerCase();
              if (!request.domains.some(domain => host === domain.toLowerCase() || host.endsWith('.' + domain.toLowerCase()))) return false;
            } catch { return false; }
          }
          return Boolean(request.platform || request.domains?.length);
        });
        if (!selected.length) throw new Error('先通过 channels 或 backend list_sites 选择平台，再传 platform／domains；用户名及扫描范围由调用方确定');
        const result = object(await pool.data(config, name, 'scan_username', {
          username: request.query, sites: selected.map(site => string(site.name)),
          timeout_seconds: Math.max(1, Math.floor(config.timeoutMs / 1000) - 3),
        }, request.signal), name);
        const evidenceId = string((result.seraEvidence as Record<string, unknown> | undefined)?.id);
        const hits = rows(result.rows, '账号扫描').filter(row => ['found', 'maybe', 'claimed'].includes(string(row.status).toLowerCase())).flatMap(row => hit(name, {
          title: `${string(row.site)} / ${string(row.username) || request.query}`, url: string(row.url),
          snippet: `公开账号候选；检测状态：${string(row.status)}，需读取主页核对主体`,
          metadata: { ...row, contentScope: 'account-candidate', scanStatus: result.status, scope: result.scope, pendingSites: result.pendingSites, seraEvidence: result.seraEvidence },
        })).slice(0, request.limit);
        if (result.status === 'partial') request.onAttempt?.({ backend: name, query: request.query, status: 'error', elapsedMs: Date.now() - started,
          returned: hits.length, code: 'PARTIAL_RESULT', reason: `账号扫描部分完成，待查站点和失败原因见报告 ${evidenceId}` });
        return hits;
      } : undefined,
    };
  });
}
