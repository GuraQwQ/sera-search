import type { ApiConfig, Config } from './types.js';

export function sourceConfig(config: Config, name: string): ApiConfig {
  const value = (config as unknown as Record<string, unknown>)[name];
  const settings = value && typeof value === 'object' && !Array.isArray(value) ? value as ApiConfig : {};
  const record = config.credentials?.[name];
  return { ...settings, ...config.sources?.[name], ...(record?.status === 'active' ? record.credentials : {}) };
}
