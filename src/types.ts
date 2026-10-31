export const sourceNames = ['exa', 'tavily', 'brave', 'github', 'agent-reach', 'opencli', 'bilibili', 'v2ex', 'web', 'zhipu', 'doubao', 'crossref', 'openalex', 'pubmed', 'serpapi', 'dataforseo', 'wiki', 'skills', 'bangumi', 'anilist', 'jikan', 'mangadex', 'vndb', 'musicbrainz', 'lastfm', 'listenbrainz', 'discogs', 'youtube', 'netease', 'baidu-images', 'sogou-images', 'trace-moe', 'saucenao', 'twitch', 'discord', 'instagram', 'bing', 'sites', 'wayback', 'archive', 'linuxdo', 'heybox', 'steam', 'nicovideo'] as const;
export type SourceName = typeof sourceNames[number];
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

export interface Config {
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
export interface ImageRequest { query?: string; imageUrl?: string; platform?: string; limit: number; signal: AbortSignal }
export interface CommentReport { status: 'ok' | 'empty' | 'partial' | 'error'; runs: SourceRun[]; page?: CommentPage; evidence?: Omit<Evidence, 'content'>; cacheWarnings?: string[] }

export interface SearchRequest {
  query: string;
  limit: number;
  platform?: string;
  githubType?: 'repositories' | 'code' | 'issues';
  domains?: string[];
  since?: string;
  at?: string;
  aliases?: string[];
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
  metadata?: Record<string, unknown>;
}

export type ContentKind = 'page' | 'post' | 'subtitle' | 'metadata';

export interface Document {
  source: SourceName;
  url: string;
  title: string;
  content: string;
  contentKind: ContentKind;
  publishedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface Capability {
  name: SourceName;
  search: boolean;
  read: boolean;
  comments?: boolean;
  images?: boolean;
  configured: boolean;
  requirement?: string;
  platforms?: string[];
  category?: 'web' | 'code' | 'academic' | 'wiki' | 'platform' | 'catalog' | 'images';
  requiresLogin?: boolean;
  loggedIn?: boolean;
}

export interface Source {
  capability: Capability;
  channels?: (signal: AbortSignal) => Promise<Channel[]>;
  login?: (platform: string, signal: AbortSignal) => Promise<void>;
  logout?: (platform: string, signal: AbortSignal) => Promise<void>;
  search?: (request: SearchRequest) => Promise<SearchHit[]>;
  read?: (url: string, signal: AbortSignal) => Promise<Document>;
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
}

export interface Retrieval {
  source: SourceName;
  rank: number;
  snippet: string;
  metadata?: Record<string, unknown>;
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
}

export interface SearchOptions {
  query: string;
  sources?: SourceName[];
  limit?: number;
  platform?: string;
  githubType?: SearchRequest['githubType'];
  domains?: string[];
  since?: string;
  at?: string;
  aliases?: string[];
  intent?: Intent;
  signal?: AbortSignal;
}

export interface SearchReport {
  query: string;
  status: 'ok' | 'partial' | 'empty' | 'error';
  hits: AggregatedHit[];
  runs: SourceRun[];
  route?: { intent: Intent; reason: string; directUrl?: string };
}

export interface Evidence extends Document {
  kind: 'sera-evidence';
  id: string;
  contentHash: string;
  retrievedAt: string;
  retrievedBy: SourceName[];
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
  sections?: { title: string; offset: number }[];
  cacheHit?: boolean;
  cacheAgeMs?: number;
  cacheWarnings?: string[];
  nextSteps?: string[];
  runs: SourceRun[];
}
export interface ReadOptions { sources?: SourceName[]; signal?: AbortSignal; query?: string; keywords?: string[]; length?: number; refresh?: boolean; maxAgeMs?: number }
export interface BatchReadReport { status: 'ok' | 'partial' | 'error'; documents: ReadReport[] }
export interface ResearchField { name: string; status: 'pending' | 'supported' | 'conflict'; evidenceIds: string[]; note?: string }
export interface ResearchState {
  fields: ResearchField[];
  examinedUrls: string[];
  candidates?: { field: string; evidenceId: string; url: string }[];
  accessFailures?: { url: string; codes: string[]; retryAt?: string }[];
  nextAction?: 'continue' | 'review-evidence' | 'complete';
  nextQuery?: string;
}
export interface ResearchOptions extends SearchOptions { readLimit?: number; readSources?: SourceName[]; goals?: string[]; state?: ResearchState; keywords?: string[]; length?: number; refresh?: boolean }

export interface ResearchReport extends SearchReport {
  documents: ReadReport[];
  state?: ResearchState;
  stateWarnings?: string[];
  comparison: {
    documentsRead: number;
    publisherGroups: { publisher: string; evidenceIds: string[] }[];
    duplicateContent: { contentHash: string; evidenceIds: string[] }[];
    nextSteps: string[];
  };
}
