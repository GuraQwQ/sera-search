import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { Engine } from './core.js';
import { sourceNames, platformIdPattern } from './types.js';
import type { Config, SavedCredentials, SourceName } from './types.js';
import { apiSources, authKey, loadCredentials, notLoggedIn, removeCredential, saveCredential } from './credentials.js';
import { writeAtomic } from './files.js';

function validate(source: SourceName, platform?: string) {
  z.enum(sourceNames).parse(source);
  if (platform) z.string().regex(platformIdPattern).parse(platform);
}

async function enable(config: Config, source: SourceName) {
  if (!config.configFile) return;
  let input: Record<string, unknown> = {};
  try { input = JSON.parse(await readFile(config.configFile, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const key = source === 'agent-reach' ? 'agentReach' : source;
  const settings = input[key];
  input[key] = { ...(settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {}), enabled: true };
  await writeAtomic(config.configFile, JSON.stringify(input, null, 2) + '\n');
}

export async function login(config: Config, source: SourceName, credentials?: SavedCredentials, platform?: string, signal = AbortSignal.timeout(platform ? 300000 : config.timeoutMs)) {
  validate(source, platform);
  if (platform) {
    if (credentials && Object.keys(credentials).length) throw new Error('该平台通过已配置后端的官方登录页面验证；API 账号请使用对应 API 来源');
    const provider = new Engine(config).sources.find(item => item.capability.name === source);
    if (!provider?.login) throw new Error('此来源没有平台登录入口');
    await provider.login(platform, signal);
    const result = await saveCredential(config.home, source, {}, platform);
    await enable(config, source);
    return { ...result, status: '已登录' };
  }
  if (!(apiSources as readonly string[]).includes(source)) return { source, status: '公开渠道可直接使用' };
  if (!credentials) throw new Error('需要 apiKey 或 API 账号 username/password');
  const result = await saveCredential(config.home, source, credentials);
  await enable(config, source);
  return result;
}

export async function logout(config: Config, source: SourceName, platform?: string, signal = AbortSignal.timeout(config.timeoutMs)) {
  validate(source, platform);
  let backend: string | undefined;
  if (platform) {
    const provider = new Engine(config).sources.find(item => item.capability.name === source);
    try { if (provider?.logout) await provider.logout(platform, signal); }
    catch { backend = '本地登录记录已清除；平台会话需要在对应后端或官网退出'; }
  }
  return { ...(await removeCredential(config.home, source, platform)), ...(backend ? { backend } : {}) };
}

export async function authStatus(config: Config, source?: SourceName, platform?: string) {
  if (source) validate(source, platform);
  const records = await loadCredentials(config.home);
  if (source && platform) {
    const provider = new Engine(config).sources.find(item => item.capability.name === source);
    const backend = ['agent-reach', 'opencli'].includes(source);
    const channel = backend && provider?.capability.configured && provider.channels
      ? (await provider.channels(AbortSignal.timeout(config.timeoutMs)).catch(() => [])).find(item => item.platform === platform) : undefined;
    if (!backend && !provider?.capability.requiresLogin || channel?.status === '公开可用') return { source, platform, status: '公开查询可用' };
    const record = records[authKey(source, platform)];
    return { source, platform, status: record?.status === 'active' ? '已登录' : notLoggedIn, ...(record ? { updatedAt: record.updatedAt } : {}) };
  }
  const entries = new Engine(config).capabilities().filter(item => !source || item.name === source).map(item => {
    const record = records[item.name];
    return { source: item.name, status: ['agent-reach', 'opencli'].includes(item.name) ? '按平台查看登录记录' : item.requiresLogin ? record?.status === 'active' ? '已记录' : notLoggedIn : '公开查询可用', ...(record ? { updatedAt: record.updatedAt } : {}) };
  });
  const platforms = Object.values(records).filter(record => record.platform && (!source || record.source === source)).map(record => ({ source: record.source, platform: record.platform, status: record.status === 'active' ? '已登录' : notLoggedIn, updatedAt: record.updatedAt }));
  return [...entries, ...platforms];
}
