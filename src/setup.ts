import { readFile } from 'node:fs/promises';
import { Engine } from './core.js';
import { login } from './auth.js';
import { errorMessage, loadConfig } from './config.js';
import { apiSources, authKey, invalidateCredential, loadCredentials, saveCredential } from './credentials.js';
import { mutateJsonFile } from './files.js';
import { sourceConfig } from './source-config.js';
import { sourceNameSchema } from './source-schema.js';
import { platformIdPattern } from './types.js';
import type { Config, SavedCredentials } from './types.js';
import { discoverSetupCommands } from './setup-discovery.js';

export interface SetupOptions {
  configCreated?: boolean;
  sources?: string[];
  platforms?: string[];
  confirmFreeTier?: string[];
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  ask?: (question: string) => Promise<string>;
  progress?: (message: string) => void;
}
interface SetupItem { source: string; platform?: string; status: string; message: string }

const keyVariables: Record<string, string[]> = {
  github: ['GITHUB_TOKEN', 'GH_TOKEN'], bilibili: ['BILIBILI_COOKIE'], v2ex: ['V2EX_TOKEN'],
  zhipu: ['ZHIPU_API_KEY', 'ZHIPUAI_API_KEY'], doubao: ['DOUBAO_API_KEY'],
  'semantic-scholar': ['SEMANTIC_SCHOLAR_API_KEY', 'S2_API_KEY'], huggingface: ['HF_TOKEN', 'HUGGINGFACE_TOKEN'],
  youtube: ['YOUTUBE_API_KEY', 'GOOGLE_API_KEY'], twitch: ['TWITCH_ACCESS_TOKEN'], discord: ['DISCORD_BOT_TOKEN'],
  instagram: ['INSTAGRAM_ACCESS_TOKEN'], heybox: ['HEYBOX_COOKIE'], 'wechat-article-history': ['WECHAT_ACCESS_TOKEN'],
};
const settingVariables: Record<string, Record<string, string[]>> = {
  discord: { guildId: ['DISCORD_GUILD_ID'], channelId: ['DISCORD_CHANNEL_ID'] },
  instagram: { accountId: ['INSTAGRAM_ACCOUNT_ID'] },
  netease: { baseUrl: ['NETEASE_BASE_URL'] },
};
const prefix = (source: string) => source.toUpperCase().replaceAll('-', '_');
function environmentValue(env: NodeJS.ProcessEnv, names: string[]) { return names.map(name => env[name]?.trim()).find(Boolean); }

async function patchConfig(config: Config, patch: (input: Record<string, any>) => void) {
  if (!config.configFile) throw new Error('配置文件位置尚未确定');
  await mutateJsonFile(config.configFile, patch);
}
function sourcePatch(input: Record<string, any>, name: string, settings: Record<string, unknown>) {
  input.sources ??= {}; input.sources[name] = { ...input.sources[name], ...settings };
}

export async function configureSetup(initial: Config, options: SetupOptions = {}) {
  let config = initial;
  const env = options.env ?? process.env, signal = options.signal ?? new AbortController().signal;
  const credentials: SetupItem[] = [], platforms: SetupItem[] = [], issues: SetupItem[] = [];
  const commands: Awaited<ReturnType<typeof discoverSetupCommands>> = [];
  const selected = options.sources ? new Set(options.sources.map(name => sourceNameSchema.parse(name))) : undefined;
  const refresh = async () => config = await loadConfig({ home: initial.home, file: initial.configFile, group: initial.group, catalog: initial.catalogOverride });
  const ask = async (question: string) => { signal.throwIfAborted(); const answer = await options.ask?.(question); signal.throwIfAborted(); return answer?.trim() ?? ''; };
  const accepts = async (question: string, fallback = true) => options.ask ? /^(?:y|yes|是)$/i.test(await ask(question) || (fallback ? 'y' : 'n')) : fallback;
  const progress = (message: string) => options.progress?.(message);
  try {
    signal.throwIfAborted();
    const known = new Set(new Engine(config).sources.map(source => source.capability.name));
    for (const name of selected ?? []) if (!known.has(name)) throw new Error(`来源不存在：${name}`);
    progress('检测本机已有组件入口…');
    commands.push(...await discoverSetupCommands(config, signal, options.sources));
    signal.throwIfAborted();
    const template = JSON.parse(await readFile(new URL('../config.example.json', import.meta.url), 'utf8'));
    const ready = commands.filter(item => item.status === 'ready' && item.command);
    if (ready.length && await accepts(`将检测到的组件补入配置（${ready.map(item => item.name).join('、')}）？[Y/n] `)) {
      for (const item of ready) {
        signal.throwIfAborted();
        const key = item.name === 'agent-reach' ? 'agentReach' : item.name;
        try {
          await patchConfig(config, input => {
            const current = input[key], defaults = template[key];
            const isTemplate = !current || JSON.stringify(current) === JSON.stringify(defaults);
            input[key] = { ...item.command, enabled: current?.enabled === false ? Boolean(options.configCreated && isTemplate) : true };
          });
        } catch (error) { if (signal.aborted) throw error; issues.push({ source: item.name, status: 'error', message: '组件配置未写入，请检查配置文件后重试' }); }
      }
      await refresh();
    }
    const disabled = ready.filter(item => config[item.name === 'agent-reach' ? 'agentReach' : item.name]?.enabled === false);
    if (disabled.length && options.ask) {
      const enable = new Set((await ask(`已停用组件：${disabled.map(item => item.name).join('、')}。填写本次要启用的组件（逗号分隔，回车保留）：`)).split(',').map(value => value.trim()));
      for (const item of disabled) if (enable.has(item.name)) {
        signal.throwIfAborted();
        await patchConfig(config, input => { input[item.name === 'agent-reach' ? 'agentReach' : item.name].enabled = true; });
      }
      await refresh();
    }

    progress('检查已有凭据和受支持的环境变量…');
    const sources = new Engine(config).sources.filter(source => !selected || selected.has(source.capability.name));
    const candidates = sources.flatMap(source => {
      const name = source.capability.name, access = source.capability.access;
      const supportsKey = (apiSources as readonly string[]).includes(name) || source.connector?.auth && source.connector.auth.type !== 'none'
        || access?.authentication === 'api-key' || source.capability.operations?.some(operation => operation.access?.authentication === 'api-key');
      if (!supportsKey) return [];
      const tag = prefix(name), apiKey = environmentValue(env, [`SERA_${tag}_API_KEY`, ...(keyVariables[name] ?? []), `${tag}_API_KEY`]);
      const clientId = name === 'twitch' ? environmentValue(env, ['SERA_TWITCH_CLIENT_ID', 'TWITCH_CLIENT_ID']) : undefined;
      const username = name === 'linuxdo' ? environmentValue(env, ['SERA_LINUXDO_USERNAME', 'LINUXDO_USERNAME']) : undefined;
      const settings = Object.fromEntries(Object.entries(settingVariables[name] ?? {}).flatMap(([field, names]) => {
        const value = environmentValue(env, [`SERA_${tag}_${field.replace(/[A-Z]/g, c => '_' + c).toUpperCase()}`, ...names]);
        return value ? [[field, value]] : [];
      }));
      if (!apiKey && !clientId && !username && !Object.keys(settings).length) return [];
      return [{ name, values: { ...(apiKey ? { apiKey } : {}), ...(clientId ? { clientId } : {}), ...(username ? { username } : {}) } as SavedCredentials, settings }];
    });
    if (candidates.length && await accepts(`从环境变量补齐凭据和设置（${candidates.map(item => item.name).join('、')}），保留已有字段？[Y/n] `)) {
      for (const candidate of candidates) {
        signal.throwIfAborted();
        try {
          const records = await loadCredentials(config.home), previous = records[candidate.name];
          const settingsBefore = sourceConfig(config, candidate.name);
          const saved = { ...(settingsBefore.clientId ? { clientId: settingsBefore.clientId } : {}), ...(settingsBefore.username ? { username: settingsBefore.username } : {}), ...(previous?.status === 'active' ? previous.credentials : {}) };
          const merged = { ...candidate.values, ...saved };
          if (merged.apiKey && Object.entries(merged).some(([key, value]) => value !== saved[key as keyof SavedCredentials])) {
            await saveCredential(config.home, candidate.name, merged);
            credentials.push({ source: candidate.name, status: 'recorded', message: '已补齐凭据，实际调用时验证' });
          } else credentials.push({ source: candidate.name, status: saved.apiKey ? 'preserved' : 'pending', message: saved.apiKey ? '保留已有凭据，实际调用时验证' : '尚缺 API Key／Token' });
          await refresh();
          const settings = sourceConfig(config, candidate.name), missing = Object.fromEntries(Object.entries(candidate.settings).filter(([key]) => !(settings as Record<string, unknown>)[key]));
          if (Object.keys(missing).length) {
            if (Object.entries(missing).some(([key, value]) => ['guildId', 'channelId'].includes(key) && !/^\d+$/.test(value))) throw new Error('Discord ID 环境变量需要纯数字');
            if (missing.baseUrl && !['http:', 'https:'].includes(new URL(missing.baseUrl).protocol)) throw new Error('服务地址需要 HTTP 或 HTTPS');
            await patchConfig(config, input => sourcePatch(input, candidate.name, missing));
          }
        } catch (error) {
          if (signal.aborted) throw error;
          issues.push({ source: candidate.name, status: 'error', message: '补齐未完成，请检查环境变量与配置后重试' });
        }
      }
      await refresh();
    }

    if (options.ask) {
      for (const [name, fields] of Object.entries({ twitch: ['clientId'], discord: ['guildId', 'channelId'], instagram: ['accountId'] })) {
        if (selected && !selected.has(name)) continue;
        const settings = sourceConfig(config, name);
        if (!settings.apiKey || settings.enabled === false) continue;
        for (const field of fields) {
          if ((settings as Record<string, unknown>)[field]) continue;
          const value = await ask(`${name} 的 ${field}${field === 'channelId' ? '（可选）' : ''}（回车稍后填写）：`);
          if (!value) continue;
          if (['guildId', 'channelId'].includes(field) && !/^\d+$/.test(value)) { issues.push({ source: name, status: 'pending', message: `${field} 需要纯数字，可重新运行向导填写` }); continue; }
          await patchConfig(config, input => sourcePatch(input, name, { [field]: value }));
        }
      }
      await refresh();
    }

    const engine = new Engine(config), pendingFree = engine.capabilities().filter(item => (!selected || selected.has(item.name))
      && ['mixed', 'unknown'].includes(item.access?.billing ?? '') && sourceConfig(config, item.name).apiKey && !sourceConfig(config, item.name).freeTierConfirmed);
    const free = new Set(options.confirmFreeTier ?? []);
    if (pendingFree.length && options.ask) {
      const response = await ask(`待确认免费档：${pendingFree.map(item => item.name).join('、')}。仅填写已确认处于免费档的来源（逗号分隔，回车跳过；该设置不限制服务端扣费）：`);
      for (const name of response.split(',').map(value => value.trim()).filter(Boolean)) free.add(name);
    }
    for (const name of free) {
      signal.throwIfAborted();
      if (!sourceNameSchema.safeParse(name).success) { issues.push({ source: name, status: 'pending', message: '来源 ID 格式有误，请重新选择' }); continue; }
      const capability = engine.capabilities([name])[0];
      if (!capability || selected && !selected.has(name) || !['mixed', 'unknown'].includes(capability.access?.billing ?? '')) {
        issues.push({ source: name, status: 'pending', message: '此来源不属于本次待确认的混合账单或费用未知入口' }); continue;
      }
      try { await patchConfig(config, input => sourcePatch(input, name, { freeTierConfirmed: true })); }
      catch (error) { if (signal.aborted) throw error; issues.push({ source: name, status: 'error', message: '免费档确认未写入，请检查配置后重试' }); }
    }
    await refresh();

    const requested = new Set(options.platforms ?? []);
    for (const record of Object.values(config.credentials ?? {})) if (record.platform && ['opencli', 'agent-reach'].includes(record.source) && (!selected || selected.has(record.source))) requested.add(`${record.source}:${record.platform}`);
    for (const name of ['opencli', 'agent-reach']) {
      if (selected && !selected.has(name)) continue;
      const provider = new Engine(config).sources.find(item => item.capability.name === name);
      if (!provider?.capability.configured || !provider.channels) continue;
      progress(`发现 ${name} 的平台与会话要求…`);
      try {
        const channels = await provider.channels(AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]));
        if (options.ask) {
          const gated = channels.filter(item => item.status !== '公开可用');
          if (gated.length) {
            const response = await ask(`${name} 可登录平台：${gated.map(item => item.platform).join('、')}。填写要验证／登录的平台（逗号分隔，回车跳过）：`);
            for (const platform of response.split(',').map(value => value.trim()).filter(Boolean)) requested.add(`${name}:${platform}`);
          }
        }
      } catch (error) {
        if (signal.aborted) throw error;
        platforms.push({ source: name, status: 'pending', message: errorMessage(error, config) });
      }
    }
    for (const target of requested) {
      signal.throwIfAborted();
      const parts = target.split(':'), [name, platform] = parts;
      if (parts.length !== 2 || !['opencli', 'agent-reach'].includes(name!) || !platformIdPattern.test(platform ?? '')) {
        platforms.push({ source: 'platform', status: 'pending', message: '平台使用 opencli:平台 或 agent-reach:平台 格式' }); continue;
      }
      if (selected && !selected.has(name!)) continue;
      const provider = new Engine(config).sources.find(item => item.capability.name === name);
      if (!provider?.capability.configured) { platforms.push({ source: name!, platform, status: 'pending', message: '请先配置并启用对应后端' }); continue; }
      progress(`验证 ${target} 的已有会话${options.ask ? '，需要时打开登录页面' : ''}…`);
      try {
        const channels = await provider.channels!(AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]));
        const channel = channels.find(item => item.platform === platform);
        if (channel?.status === '公开可用') { platforms.push({ source: name!, platform, status: 'public', message: '公开渠道无需登录' }); continue; }
        await login(config, name!, undefined, platform, signal, { sessionOnly: !options.ask });
        platforms.push({ source: name!, platform, status: 'verified', message: '平台已确认登录，记录已保存' });
        await refresh();
      } catch (error) {
        if (signal.aborted) throw error;
        if (['NOT_LOGGED_IN', 'NEED_LOGIN', 'AUTH_REQUIRED'].includes(String((error as { code?: string })?.code))) {
          const previous = config.credentials?.[authKey(name!, platform)];
          if (previous) await invalidateCredential(config.home, name!, platform, previous);
        }
        platforms.push({ source: name!, platform, status: 'pending', message: errorMessage(error, config) });
      }
    }
  } catch (error) {
    if (!signal.aborted) throw error;
  }
  await refresh();
  const sources = new Engine(config).capabilities().filter(item => !selected || selected.has(item.name)).map(item => {
    const settings = sourceConfig(config, item.name), missing = [
      ...(item.name === 'twitch' && settings.apiKey && !settings.clientId ? ['clientId'] : []),
      ...(item.name === 'discord' && settings.apiKey && !settings.guildId ? ['guildId'] : []),
      ...(item.name === 'instagram' && settings.apiKey && !settings.accountId ? ['accountId'] : []),
    ];
    const status = settings.enabled === false || item.name === 'agent-reach' && config.agentReach?.enabled === false ? 'disabled' : missing.length ? 'needs-settings' : item.requiresLogin && !settings.apiKey ? 'needs-key'
      : ['mixed', 'unknown'].includes(item.access?.billing ?? '') && !settings.freeTierConfirmed ? 'needs-free-tier'
      : item.backend || ['opencli', 'agent-reach'].includes(item.name) ? item.configured ? 'configured' : 'needs-component'
      : item.configured ? settings.apiKey ? 'recorded' : 'public' : 'needs-settings';
    return { source: item.name, status, ...(missing.length ? { missing } : {}), ...(item.access ? { access: item.access } : {}) };
  });
  const nextSteps = [
    ...(sources.some(item => item.status === 'disabled') ? ['已停用项保持原设置；可在交互向导中选择启用组件，或调整对应来源的 enabled 设置。'] : []),
    ...(sources.some(item => item.status === 'needs-key') ? ['缺少 Key：设置对应环境变量后重新运行 install --setup，或使用 login <来源> --stdin 登记。'] : []),
    ...(sources.some(item => item.status === 'needs-settings') ? ['补充 sources 中列出的账号 ID 或服务地址后重试；已有配置与凭据会保留。'] : []),
    ...(sources.some(item => item.status === 'needs-free-tier') ? ['核对免费档后使用 --confirm-free-tier 来源列表，或在交互向导中逐项选择。'] : []),
    ...(platforms.some(item => item.status === 'pending') ? ['平台待登录项可在就绪的浏览器桥接中运行 login <后端> --platform <平台>，完成扫码后重跑向导。'] : []),
    ...(commands.some(item => item.status !== 'ready') ? ['缺失组件可用 install --components 选择安装；OpenCLI／Agent Reach 请先准备对应原生入口。'] : []),
  ];
  return { status: signal.aborted ? 'cancelled' : issues.length || nextSteps.length ? 'partial' : 'ready', commands, credentials, platforms, sources, issues, nextSteps };
}
