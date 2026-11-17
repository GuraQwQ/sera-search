import type { Config, Source } from './types.js';
import { createInfrastructureSources } from './providers/infrastructure-connectors.js';
import { createScienceSources } from './providers/science-connectors.js';
import { createPublicDataSources } from './providers/public-data-connectors.js';
import { createHobbySources } from './providers/hobby-connectors.js';
import { createSocialConnectorSources } from './providers/social-connectors.js';
import { createStructuredSource } from './connectors.js';
import { createWikidataSource } from './providers/wikidata.js';

export function createDeclaredSources(config: Config): Source[] {
  return [...createInfrastructureSources(config), ...createScienceSources(config), ...createPublicDataSources(config), ...createHobbySources(config), ...createSocialConnectorSources(config), createWikidataSource(config)];
}

export function configuredSources(config: Config, existing: Source[]): Source[] {
  const names = new Set(existing.map(source => source.capability.name));
  return (config.connectors ?? []).filter(definition => !names.has(definition.id)).map(definition => createStructuredSource(config, definition));
}
