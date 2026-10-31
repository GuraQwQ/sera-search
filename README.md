<div align="center">

**English** · [简体中文](docs/readme/README_zh.md)

<img src="docs/assets/sera-icon.svg" alt="SERA magnifying glass" width="128" height="128" />

# SERA: Search Everything

### One CLI and MCP toolkit to search the web, communities, databases, and archives.

**Find the original sources. Read the material. Answer with evidence.**

[![Cross-platform checks](https://github.com/GuraQwQ/sera-search/actions/workflows/ci.yml/badge.svg)](https://github.com/GuraQwQ/sera-search/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-39786B?style=flat-square)](https://nodejs.org/)
[![MIT](https://img.shields.io/badge/license-MIT-D99A42?style=flat-square)](LICENSE)

[Quick start](#quick-start) · [Connect your agent](#connect-your-agent) · [How it works](#how-it-works) · [What you can search](#what-you-can-search) · [Documentation](#documentation)

</div>

Need to verify a product specification, trace a claim to its source, or recover a page that disappeared? Ask your agent to investigate with SERA. It finds relevant sources, reads the original material, follows unresolved leads, and returns evidence you can revisit.

SERA connects your agent to tools for searching websites, code, communities, academic records, media databases, and internet archives. Your agent uses MCP; you can use the same workflows from a terminal. Search results lead to original pages, posts, comments, structured records, or historical snapshots, with URLs, versions, timestamps, and saved evidence IDs.

## Quick start

Requires **Node.js 22 or later**. Run from source; an npm release is not yet available.

```bash
git clone https://github.com/GuraQwQ/sera-search.git
cd sera-search
npm ci --cache ./.cache/npm
npm run build
node dist/cli.js install --home ./.sera
node dist/cli.js capabilities --home ./.sera --sources bing,web --json
```

Search public sources and read the original pages:

```bash
node dist/cli.js research "TypeScript official release notes" --home ./.sera --sources bing --read-sources web --read-limit 3 --json
```

Public sources can be requested directly. Register credentials with `login` for sources that require an account. Use the same `--home` or `SERA_HOME` for every call; repeated `install` preserves existing configuration. Each response records actual network, login, and quota outcomes in `runs`.

Already have a URL or object ID? Read it directly:

```bash
node dist/cli.js read-many "steam:105600" "sm8628149" --home ./.sera --keyword "release_date" --keyword "firstRetrieve" --json
```

See the [CLI guide](docs/cli.md) for commands and the [configuration guide](docs/configuration.md) for API keys, proxies, and platform backends.

## Connect your agent

Register a local stdio MCP server in your agent's configuration. Replace the paths with your installation and use the same data directory as the CLI:

```json
{
  "mcpServers": {
    "sera": {
      "command": "node",
      "args": [
        "/absolute/path/to/sera-search/dist/cli.js",
        "mcp",
        "--home",
        "/absolute/path/to/sera-data"
      ]
    }
  }
}
```

On Windows, an absolute path such as `F:/tools/sera-search/dist/cli.js` also works.

Link the bundled Skill to your agent's standard skill directory for source selection and evidence workflows:

```bash
node dist/cli.js install --home /absolute/path/to/sera-data --skill-dir /absolute/path/to/agent-skills
```

The Skill links to the package directory, so keep that directory available. Start with the sources relevant to the task, then take the first batch of evidence; platform and credential details load when needed. Load the MCP configuration and Skill according to your client. See [Agent Skill and MCP](docs/mcp.md).

Then ask your agent:

```text
Use SERA to trace Chinese-language support in the Steam edition of AIR.
Identify the exact product and version, then check the official store,
announcements, and historical snapshots. Report interface, subtitles,
and audio separately, with evidence, conflicts, and unresolved fields.
```

## How it works

```mermaid
flowchart LR
    A[Your question] --> B[Agent identifies entities and missing facts]
    B --> C[SERA selects sources, searches, and reads]
    C --> D[Original material, versions, dates, evidence IDs]
    D --> E[Agent verifies and answers]
    E -->|Unresolved leads| B
```

- **Choose the right material.** Prefer official pages for versions, dates, and specifications; read original posts and comments for user feedback; locate original URLs and snapshots for historical questions. Account sources without valid credentials report that they are unavailable.
- **Read less, keep the original.** Use `query` and `keywords` to locate relevant passages. `read-many` deduplicates URLs and reads up to three documents concurrently. Fresh cached evidence can be reused; `refresh` requests a new copy.
- **Follow the remaining gaps.** Start a multi-part task with `research` and `goals`, review the returned passages, then send back the updated `state` for the remaining fields. For a multi-round CLI task, pass `--state ./research-state.json` from the first call; the CLI creates or updates that file, and you can edit verified fields before repeating the command. Previously examined URLs are skipped; fields become supported only after the agent verifies the evidence. See the [workflow examples](skills/sera-search/references/workflows.md).
- **Inspect the route taken.** Default search selects sources by intent and switches backends after empty, unrelated, or failed results. Explicit `sources` aggregates the selected providers in parallel. Follow `runs` and any `retryAfterSeconds` before retrying a limited source; keep successful evidence while continuing other leads.

Full material remains available under its evidence ID. Passages retain Unicode offsets, and ranking organizes retrieval results. Multiple engines finding the same article still provide one original source. See the [evidence guide](docs/evidence.md) for reading scope, content types, and follow-up retrieval.

## What you can search

SERA currently registers **44 sources** and exposes **12 MCP tools**. Available operations depend on configuration, permissions, and the provider's actual response.

| Material | Example sources | What you get |
|---|---|---|
| Websites, news, and official documentation | Bing, Exa, Tavily, Brave, Zhipu, Doubao, SerpAPI, DataForSEO | Candidate URLs and snippets; original text through supported reading backends |
| Repositories, code, and platform content | GitHub, Agent Reach, OpenCLI, Bilibili, V2EX | Repositories, files, posts, or platform records through discoverable operations |
| Academic records and encyclopedias | Crossref, OpenAlex, PubMed, MediaWiki | Bibliography, abstracts, page source, and specific revisions |
| Games, animation, music, and media records | Steam, Niconico, VNDB, Bangumi, MusicBrainz, and others | Object IDs, release records, specifications, credits, and metadata |
| Historical pages and lost information | Wayback Machine, Internet Archive | Capture indexes, actual snapshots, collection metadata, and file listings |
| Communities, comments, and image sources | LinuxDo, Heybox, YouTube, NetEase Music, image and reverse-image providers | Original posts, comment pages, reply relationships, hosting pages, and match clues |

Game Wikis and visual-novel communities use catalogs loaded on demand:

```bash
node dist/cli.js search "Guide" --home ./.sera --sources wiki --platform terraria --group game-wikis --json
node dist/cli.js search "CLANNAD impressions" --home ./.sera --sources sites --platform fuwanovel --group galgame --json
```

MCP calls accept `group:"game-wikis"` or `group:"galgame"` within the same connection. See the [source guide](skills/sera-search/references/sources.md) and [domain routing guide](skills/sera-search/references/domains.md) for exact objects and reading scope.

## Results and evidence

Responses distinguish snippets, original text, metadata, subtitles, and comments. Partial failures preserve successful results; `status`, `runs`, and `cacheWarnings` identify follow-up work. Login, paid API access, rate limits, and snapshot availability are determined by actual requests.

Saved evidence can be located, paged, or refreshed from the chosen data directory. Multiple engines can lead to the same article; the agent verifies claims against original material, time and version boundaries, and publisher relationships.

## Documentation

| Guide | Contents |
|---|---|
| [Configuration](docs/configuration.md) | Credentials, proxies, Agent Reach, OpenCLI, and data directories |
| [CLI](docs/cli.md) | Search, research, reading, comments, images, and exit codes |
| [Evidence](docs/evidence.md) | Passages, caching, timestamps, gap tracking, and cleanup |
| [Agent Skill and MCP](docs/mcp.md) | Skill links, server registration, and the tool catalog |
| [Routing Skill](skills/sera-search/SKILL.md) | Agent startup, source selection, and references loaded on demand |

Detailed guides and the bundled Skill are currently written in Simplified Chinese.

## Development and contributing

```bash
npm run check
npm run build
npm pack --ignore-scripts --dry-run --cache ./.cache/npm
```

The version comes from `package.json`; `package-lock.json` records reproducible installation inputs. Source code lives in `src/`, and catalogs live in `catalogs/`. CI checks types, builds the project, starts the CLI, and checks packaging on Windows, macOS, and Linux. New providers should declare their search, reading, authentication, and content scope.

Report a reproducible problem or suggest a source in an [issue](https://github.com/GuraQwQ/sera-search/issues), or contribute an implementation or documentation improvement through a pull request.

## Acknowledgments

SERA's shared entry points and evidence organization were inspired by [REA](https://github.com/morluto/rea). Provider integration, platform discovery, and query expansion also draw on [MCP Omnisearch](https://github.com/spences10/mcp-omnisearch), [OpenCLI](https://github.com/jackwener/OpenCLI), and [search-skills](https://github.com/blessonism/search-skills).

## License

[MIT](LICENSE). Third-party services and source material retain their own terms and licenses.
