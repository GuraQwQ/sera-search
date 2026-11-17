import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { commandSettingsSchema, errorMessage, loadConfig, parseConfig, sourceSettingsSchema } from './config.js';
import { connectorDefinitionSchema } from './connectors.js';
import { Engine } from './core.js';
import { writeAtomic } from './files.js';
import { sourceConfig } from './source-config.js';
import { sourceNameSchema } from './source-schema.js';
import { sourceNames } from './types.js';
import type { Config } from './types.js';

export const configurableBackends = ['opencli', 'agent-reach', 'ghgrab', 'scrapling', 'metadata-parser', 'aliens-eye', 'sherlock', 'gods-eye-view'] as const;
export const configurationInputSchema = z.strictObject({
  sources: z.array(sourceNameSchema).min(1).optional(),
  updates: z.record(sourceNameSchema, sourceSettingsSchema).optional(),
  backends: z.partialRecord(z.enum(configurableBackends), commandSettingsSchema.partial().extend({ args: z.array(z.string()).optional() })).optional(),
  connectorFiles: z.array(z.string().min(1)).optional(),
  connectors: z.array(connectorDefinitionSchema).optional(),
});

const pendingUpdates = new Map<string, Promise<unknown>>();
export async function configureSources(config: Config, request: unknown = {}) {
  const key = config.configFile ?? config.home;
  const previous = pendingUpdates.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => applyConfiguration(config, request));
  pendingUpdates.set(key, next);
  try { return await next; }
  finally { if (pendingUpdates.get(key) === next) pendingUpdates.delete(key); }
}

async function applyConfiguration(config: Config, request: unknown) {
  const input = configurationInputSchema.parse(request);
  const location = { home: config.home, file: config.configFile, catalog: config.catalogFile, group: config.group };
  const file = config.configFile;
  let current = await loadConfig(location);
  const changed = input.updates !== undefined || input.backends !== undefined || input.connectorFiles !== undefined || input.connectors !== undefined;
  if (changed) {
    if (!file) throw new Error('配置文件位置尚未确定');
    let raw: Record<string, any>;
    try { raw = JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; raw = {}; }
    const before = JSON.stringify(raw);
    if (input.connectorFiles) raw.connectorFiles = input.connectorFiles;
    if (input.connectors) raw.connectors = [...new Map([...(raw.connectors ?? []), ...input.connectors].map(definition => [definition.id, definition])).values()];
    const definitions = z.array(connectorDefinitionSchema).parse(raw.connectors ?? []);
    for (const path of raw.connectorFiles ?? []) {
      const data = JSON.parse(await readFile(resolve(dirname(file), path), 'utf8'));
      definitions.push(...z.array(connectorDefinitionSchema).parse(Array.isArray(data) ? data : [data]));
    }
    const known = new Set<string>([...sourceNames, ...definitions.map(definition => definition.id)]);
    for (const name of input.sources ?? []) if (!known.has(name)) throw new Error(`来源不存在：${name}`);
    for (const [name, settings] of Object.entries(input.updates ?? {})) {
      if (!known.has(name)) throw new Error(`来源不存在：${name}，请先配置连接器定义`);
      if ((configurableBackends as readonly string[]).includes(name)) throw new Error(`组件 ${name} 的设置请放入 backends`);
      raw.sources ??= {}; raw.sources[name] = { ...raw.sources[name], ...settings };
    }
    for (const [name, settings] of Object.entries(input.backends ?? {})) {
      const key = name === 'agent-reach' ? 'agentReach' : name;
      const command = commandSettingsSchema.parse({ ...raw[key], ...settings });
      raw[key] = command;
      // 组件入口统一由对应顶层配置管理，清除旧的通用启用覆盖。
      if (raw.sources?.[name]) delete raw.sources[name].enabled;
    }
    new Engine({ ...current, ...parseConfig(raw), home: current.home, connectors: [...new Map(definitions.map(definition => [definition.id, definition])).values()] });
    if (JSON.stringify(raw) !== before) await writeAtomic(file, JSON.stringify(raw, null, 2) + '\n');
    current = await loadConfig(location);
  }
  const names = input.sources ?? [...new Engine(current).sources.map(source => source.capability.name)];
  const entries = new Engine(current).sources;
  for (const name of names) if (!entries.some(source => source.capability.name === name)) throw new Error(`来源不存在：${name}`);
  const sources = Object.fromEntries(names.filter(name => !(configurableBackends as readonly string[]).includes(name)).map(name => {
    const settings = sourceConfig(current, name);
    // 仅投影运行设置，凭据记录始终由登录接口管理。
    const projected = Object.fromEntries(Object.keys(sourceSettingsSchema.shape).flatMap(key => key in settings ? [[key, settings[key as keyof typeof settings]]] : []));
    return [name, projected];
  }));
  const backends = Object.fromEntries(configurableBackends.filter(name => !input.sources || names.includes(name)).flatMap(name => {
    const command = current[name === 'agent-reach' ? 'agentReach' : name];
    return command ? [[name, command]] : [];
  }));
  const result = { home: current.home, config: current.configFile, sources, backends, connectorFiles: current.connectorFiles ?? [], connectors: (current.connectors ?? []).map(definition => ({ id: definition.id, type: definition.type, label: definition.label })) };
  return JSON.parse(JSON.stringify(result, (_key, value) => typeof value === 'string' ? errorMessage(new Error(value), current) : value)) as typeof result;
}
