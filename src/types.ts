export const specialistSourceNames = ['aicu', 'danmakus', 'operationhong', 'matsuri', 'laplace', 'filmot', 'holodex', 'semantic-scholar', 'openreview', 'osv', 'github-advisory', 'gdelt', 'open-library', 'clinicaltrials', 'steamdb', 'vgmdb', 'open-meteo', 'mangaupdates', 'novelupdates', 'syosetu', 'kakuyomu', 'huggingface', 'biorxiv', 'europepmc', 'zenodo', 'google-patents', 'j-platpat', 'ndl', 'nga', '5ch', 'hackernews', 'lobsters'] as const;
export type SpecialistSourceName = typeof specialistSourceNames[number];
export const structuredSourceNames = ['common-crawl', 'gh-archive', 'wikimedia-analytics', 'ecosystems', 'deps-dev', 'ripestat', 'ooni', 'urlscan', 'rcsb-pdb', 'uniprot', 'chembl', 'pubchem', 'materials-project', 'nasa-exoplanets', 'hepdata', 'gbif', 'inaturalist', 'earthdata-cmr', 'fred', 'world-bank', 'un-comtrade', 'eurostat', 'courtlistener', 'federal-register', 'osm-overpass', 'met', 'artic', 'chatarchive', 'sakugabooru', 'isthereanydeal', 'modrinth', 'speedrun', 'boardgamegeek', 'scryfall', 'acoustid', 'setlistfm', 'qq-avatar', 'qq-group-avatar', 'qq-public-profile', 'qq-portrait-legacy', 'wechat-official-account', 'wechat-article-history'] as const;
export const sourceNames = ['exa', 'tavily', 'brave', 'github', 'agent-reach', 'opencli', 'bilibili', 'v2ex', 'web', 'zhipu', 'doubao', 'crossref', 'openalex', 'pubmed', 'serpapi', 'wiki', 'skills', 'bangumi', 'anilist', 'jikan', 'mangadex', 'vndb', 'musicbrainz', 'lastfm', 'listenbrainz', 'discogs', 'youtube', 'netease', 'baidu-images', 'sogou-images', 'trace-moe', 'saucenao', 'twitch', 'discord', 'instagram', 'bing', 'sites', 'wayback', 'archive', 'linuxdo', 'heybox', 'steam', 'nicovideo', 'ghgrab', 'scrapling', 'metadata-parser', 'google-news', 'iptv', 'aliens-eye', 'sherlock', 'gods-eye-view', ...specialistSourceNames, ...structuredSourceNames] as const;
export type SourceName = string;
export const extensionNames = ['aliens-eye', 'sherlock', 'gods-eye-view'] as const;
export type ExtensionName = typeof extensionNames[number];
export const backendNames = ['ghgrab', 'scrapling', ...extensionNames] as const;
export type BackendName = typeof backendNames[number];
export const intents = ['general', 'official', 'feedback', 'historical', 'game', 'galgame', 'academic', 'code', 'images'] as const;
export type Intent = typeof intents[number];
export const catalogGroups = ['default', 'game-wikis', 'galgame'] as const;
export type CatalogGroup = typeof catalogGroups[number];
export const platformIdPattern = /^[a-z0-9][a-z0-9_-]*$/i;

export interface ApiConfig {
  apiKey?: string;
  username?: string;
  password?: string;
  baseUrl?: string;
  engine?: string;
  languageCode?: string;
  locationCode?: number;
  userAgent?: string;
  clientId?: string;
  accountId?: string;
  guildId?: string;
  channelId?: string;
  enabled?: boolean;
  freeTierConfirmed?: boolean;
}

export interface SavedCredentials { apiKey?: string; username?: string; password?: string; clientId?: string }
export interface AuthRecord {
  kind: 'sera-credential';
  source: SourceName;
  platform?: string;
  credentials: SavedCredentials;
  status: 'active' | 'invalid';
  updatedAt: string;
}
export interface WikiSite { apiUrl: string; pageBaseUrl: string; label?: string }

export interface CommandConfig {
  command: string;
  args: string[];
  enabled?: boolean;
}

export interface Config extends Partial<Record<SpecialistSourceName, ApiConfig>> {
  sources?: Record<string, ApiConfig>;
  connectorFiles?: string[];
  connectors?: import('./connectors.js').ConnectorDefinition[];
  home: string;
  timeoutMs: number;
  retentionDays: number;
  exa: ApiConfig;
  tavily: ApiConfig;
  brave: ApiConfig;
  github: ApiConfig;
  bilibili: ApiConfig;
  v2ex: ApiConfig;
  web?: ApiConfig;
  agentReach?: CommandConfig;
  opencli?: CommandConfig;
  zhipu?: ApiConfig;
  doubao?: ApiConfig;
  crossref?: ApiConfig;
  openalex?: ApiConfig;
  pubmed?: ApiConfig;
  serpapi?: ApiConfig;
  dataforseo?: ApiConfig;
  wiki?: ApiConfig & { sites?: Record<string, WikiSite> };
  skills?: ApiConfig; bangumi?: ApiConfig; anilist?: ApiConfig; jikan?: ApiConfig; mangadex?: ApiConfig; vndb?: ApiConfig;
  musicbrainz?: ApiConfig; lastfm?: ApiConfig; listenbrainz?: ApiConfig; discogs?: ApiConfig;
  youtube?: ApiConfig; netease?: ApiConfig; 'baidu-images'?: ApiConfig; 'sogou-images'?: ApiConfig; 'trace-moe'?: ApiConfig; saucenao?: ApiConfig;
  twitch?: ApiConfig; discord?: ApiConfig; instagram?: ApiConfig; bing?: ApiConfig; sites?: ApiConfig;
  wayback?: ApiConfig; archive?: ApiConfig;
  linuxdo?: ApiConfig; heybox?: ApiConfig;
  steam?: ApiConfig; nicovideo?: ApiConfig;
  ghgrab?: CommandConfig; scrapling?: CommandConfig; 'metadata-parser'?: CommandConfig;
  'aliens-eye'?: CommandConfig; sherlock?: CommandConfig; 'gods-eye-view'?: CommandConfig;
  'google-news'?: ApiConfig & { country?: string; edition?: string; topicId?: string };
  iptv?: ApiConfig;
  catalog?: SiteCatalog;
  catalogFile?: string;
  credentials?: Record<string, AuthRecord>;
  configFile?: string;
  group?: CatalogGroup;
}

export interface SiteCatalog { sites: Record<string, { domains: string[]; label: string; description?: string }> }
export interface Comment { id: string; parentId?: string; rootId?: string; text: string; author?: string; publishedAt?: string; likes?: number; url?: string; replyCount?: number }
export interface CommentRequest { url: string; limit: number; cursor?: string; parentId?: string; order?: string; signal: AbortSignal }
export interface CommentPage { url: string; comments: Comment[]; nextCursor?: string; scope: string; truncated?: boolean; metadata?: Record<string, unknown> }
export interface ImageRequest { query?: string; imageUrl?: string; platform?: string; operation?: string; limit: number; signal: AbortSignal }
export interface CommentReport { status: 'ok' | 'empty' | 'partial' | 'error'; runs: SourceRun[]; page?: CommentPage; evidence?: Omit<Evidence, 'content'>; cacheWarnings?: string[] }

export interface SearchRequest {
  query: string;
  limit: number;
  platform?: string;
  githubType?: 'repositories' | 'code' | 'issues';
  domains?: string[];
  since?: string;
  at?: string;
  until?: string;
  operation?: string;
  params?: Record<string, unknown>;
  contentTypes?: string[];
  onCoverage?: (coverage: DataCoverage) => void;
  aliases?: string[];
  terms?: string[];
  onAttempt?: (attempt: SearchAttempt) => void;
  signal: AbortSignal;
}
export interface SearchAttempt { backend: SourceName; query?: string; status: 'ok' | 'empty' | 'irrelevant' | 'error' | 'cancelled'; elapsedMs: number; returned: number; reason?: string; code?: string; retryAfterSeconds?: number }

export interface SearchHit {
  source: SourceName;
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  locator?: ContentLocator;
  metadata?: Record<string, unknown> & { relevance?: { status: string; matchedTerms?: string[]; missingTerms?: string[]; score?: number } };
}

export type ContentKind = 'page' | 'post' | 'subtitle' | 'metadata';
export type EvidenceSource = SourceName | 'external';

export interface ContentLocator {
  kind: 'segment' | 'event' | 'record';
  id: string;
  parentUrl?: string;
  startSeconds?: number;
  endSeconds?: number;
  occurredAt?: string;
}
export interface DataCoverage {
  scope: string;
  completeness: 'unknown' | 'partial' | 'complete';
  requested?: Record<string, unknown>;
  observed?: { since?: string; until?: string };
  truncated?: boolean;
  nextCursor?: string;
  limitations?: string[];
}
export interface SourceOperation {
  name: string;
  description: string;
  contentTypes: string[];
  inputSchema: Record<string, unknown>;
  accessMethod: 'api' | 'site-search' | 'local';
  access?: AccessPolicy;
  entrypoint?: 'search' | 'comments' | 'images';
}

export interface AccessPolicy {
  authentication: 'none' | 'optional' | 'api-key' | 'session';
  billing: 'free' | 'free-quota' | 'mixed' | 'paid' | 'trial' | 'unknown';
  quota?: string;
  nonCommercial?: boolean;
  evidence?: string;
}

export interface Document {
  source: EvidenceSource;
  url: string;
  title: string;
  content: string;
  contentKind: ContentKind;
  publishedAt?: string;
  metadata?: Record<string, unknown>;
  locator?: ContentLocator;
}

export interface Capability {
  name: SourceName;
  search: boolean;
  read: boolean;
  backend?: boolean;
  comments?: boolean;
  images?: boolean;
  configured: boolean;
  requirement?: string;
  platforms?: string[];
  searchPlatforms?: string[];
  category?: 'web' | 'code' | 'academic' | 'wiki' | 'platform' | 'catalog' | 'images';
  requiresLogin?: boolean;
  loggedIn?: boolean;
  contentTypes?: string[];
  operations?: SourceOperation[];
  accessMethod?: SourceOperation['accessMethod'];
  limitations?: string[];
  access?: AccessPolicy;
  priority?: number;
  automatic?: boolean;
}

export interface Source {
  capability: Capability;
  connector?: import('./connectors.js').ConnectorDefinition;
  channels?: (signal: AbortSignal) => Promise<Channel[]>;
  login?: (platform: string, signal: AbortSignal, options?: { sessionOnly?: boolean }) => Promise<void>;
  logout?: (platform: string, signal: AbortSignal) => Promise<void>;
  search?: (request: SearchRequest) => Promise<SearchHit[]>;
  read?: (url: string, signal: AbortSignal, options?: ReadOptions) => Promise<Document>;
  comments?: (request: CommentRequest) => Promise<CommentPage>;
  images?: (request: ImageRequest) => Promise<SearchHit[]>;
}

export interface Channel {
  source: SourceName;
  platform: string;
  search: boolean;
  read: boolean;
  comments?: boolean;
  images?: boolean;
  configured: boolean;
  browser?: boolean;
  strategy?: string;
  description?: string;
  status?: string;
  operations?: SourceOperation[];
  contentTypes?: string[];
  access?: AccessPolicy;
  priority?: number;
  automatic?: boolean;
}

export interface Retrieval {
  source: SourceName;
  rank: number;
  snippet: string;
  metadata?: SearchHit['metadata'];
}

export interface AggregatedHit {
  title: string;
  url: string;
  snippet: string;
  sources: SourceName[];
  retrievals: Retrieval[];
  rankScore: number;
  publisher: string;
  publishedAt?: string;
  locator?: ContentLocator;
}

export interface SourceRun {
  source: SourceName;
  status: 'ok' | 'empty' | 'unavailable' | 'error' | 'cancelled';
  elapsedMs: number;
  returned: number;
  message?: string;
  code?: string;
  retryAfterSeconds?: number;
  retryAt?: string;
  fallbackUrl?: string;
  attempts?: SearchAttempt[];
  cacheHit?: boolean;
  network?: NetworkTrace;
  newUrls?: number;
  newItems?: number;
  coverage?: DataCoverage;
}

export interface NetworkRequest { url: string; method: string; startedAt: string; elapsedMs?: number; status?: number; error?: string }
export interface NetworkTrace { scope: 'sera-http'; requestCount: number; redirectResponseCount: number; requests: NetworkRequest[]; upstreamRequestCount: null }

export interface SearchOptions {
  query: string;
  sources?: SourceName[];
  limit?: number;
  platform?: string;
  githubType?: SearchRequest['githubType'];
  domains?: string[];
  since?: string;
  at?: string;
  until?: string;
  operation?: string;
  params?: Record<string, unknown>;
  contentTypes?: string[];
  maxSources?: number;
  strategy?: 'fallback' | 'cross-check';
  sourceOptions?: Partial<Record<SourceName, { operation?: string; params?: Record<string, unknown> }>>;
  aliases?: string[];
  terms?: string[];
  excludeUrls?: string[];
  excludeItems?: string[];
  intent?: Intent;
  signal?: AbortSignal;
}

export interface SearchReport {
  query: string;
  status: 'ok' | 'partial' | 'empty' | 'error';
  hits: AggregatedHit[];
  runs: SourceRun[];
  route?: { intent: Intent; reason: string; directUrl?: string };
  plan?: { strategy: 'fallback' | 'cross-check'; contentTypes: string[]; selected: SourceName[]; stopReason: 'enough-results' | 'budget' | 'exhausted' | 'cancelled'; pendingActions?: { source: SourceName; operation: string; entrypoint: NonNullable<SourceOperation['entrypoint']>; required: string[] }[] };
}

export interface Evidence extends Document {
  kind: 'sera-evidence';
  id: string;
  contentHash: string;
  retrievedAt: string;
  retrievedBy: EvidenceSource[];
}

export interface ReadReport {
  status: 'ok' | 'partial' | 'error';
  evidence?: Omit<Evidence, 'content'>;
  document?: Omit<Document, 'content'>;
  content?: string;
  totalCharacters?: number;
  nextOffset?: number | null;
  offset?: number;
  selection?: 'focused' | 'leading';
  fragments?: { content: string; offset: number; endOffset: number; matchedTerms: string[] }[];
  contexts?: { content: string; offset: number; endOffset: number; kind: 'heading' | 'table-header' }[];
  sections?: { title: string; offset: number }[];
  cacheHit?: boolean;
  cacheAgeMs?: number;
  cacheWarnings?: string[];
  nextSteps?: string[];
  runs: SourceRun[];
}
export interface ReadOptions { sources?: SourceName[]; signal?: AbortSignal; query?: string; keywords?: string[]; length?: number; refresh?: boolean; maxAgeMs?: number; timeoutMs?: number; browser?: string; raw?: boolean; locator?: ContentLocator }
export interface BatchReadReport { status: 'ok' | 'partial' | 'error'; documents: ReadReport[] }
export interface ResearchSubject { id: string; name: string; aliases?: string[]; urls?: string[] }
export interface ResearchCriterion { id: string; description: string; kind: 'required' | 'preference'; intent?: Intent; scope?: Record<string, string>; keywords?: string[] }
export interface ResearchCitation { evidenceId: string; offset?: number; endOffset?: number }
export interface ResearchAssessment {
  subjectId: string;
  criterionId: string;
  status: 'pending' | 'supported' | 'conflict';
  outcome: 'unknown' | 'satisfied' | 'violated';
  conclusion?: string;
  scope?: Record<string, string>;
  citations: ResearchCitation[];
  reviewedEvidenceIds: string[];
  measurement?: { value: number; unit: string; normalization?: { factor: number; unit: string; note: string } };
}
export interface ResearchCandidate { subjectId: string; criterionId: string; evidenceId: string; url: string; itemKey?: string }
export interface ResearchRound { query: string; sources: SourceName[]; newUrls: number; newItems?: number; newEvidence: number; resolved: number }
export interface ResearchState {
  version: 2;
  subjects: ResearchSubject[];
  criteria: ResearchCriterion[];
  assessments: ResearchAssessment[];
  targetCount?: number;
  evidenceIds: string[];
  discoveredUrls: string[];
  examinedUrls: string[];
  discoveredItems?: string[];
  examinedItems?: string[];
  candidates: ResearchCandidate[];
  accessFailures: { url: string; codes: string[]; retryAt?: string }[];
  history: ResearchRound[];
  resolvedCount: number;
  nextAction?: 'continue' | 'review-evidence' | 'change-query' | 'change-source' | 'waiting' | 'complete';
  nextQuery?: string;
  nextSources?: SourceName[];
}
export interface ResearchOptions extends SearchOptions { readLimit?: number; readSources?: SourceName[]; goals?: string[]; subjects?: ResearchSubject[]; criteria?: ResearchCriterion[]; targetCount?: number; discoveryQuery?: string; state?: ResearchState; keywords?: string[]; length?: number; refresh?: boolean; timeoutMs?: number; browser?: string; raw?: boolean }

export interface ResearchReport extends SearchReport {
  documents: ReadReport[];
  state?: ResearchState;
  stateWarnings?: string[];
  coverage?: { qualified: string[]; excluded: string[]; unresolved: string[]; verified: { subjectId: string; criterionId: string }[]; gaps: { subjectId?: string; criterionId?: string; reason: string }[]; complete: boolean };
  comparison: {
    documentsRead: number;
    publisherGroups: { publisher: string; evidenceIds: string[] }[];
    duplicateContent: { contentHash: string; evidenceIds: string[] }[];
    groups?: { criterionId: string; scope: Record<string, string>; unit?: string; values: { subjectId: string; conclusion: string; value?: number; originalValue?: number; originalUnit?: string; conversion?: string }[] }[];
    progress?: ResearchRound;
    nextSteps: string[];
  };
}
