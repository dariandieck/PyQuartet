// Automated stat extraction: finds a library's PyPI package and GitHub repo, then reads the category values
// (GitHub REST API for stars / contributors / size, pepy.tech for total downloads).
import type { StatSource } from "../../src/game/model.ts";
import { get, LookupError, parseJson, type HttpResponse } from "./http.ts";

export interface Credentials {
  /** Optional; raises GitHub's limit from 60 to 5000 requests per hour. */
  githubToken?: string | undefined;
  /** Optional; without it downloads come from pepy's public badge, rounded to 2-3 digits. */
  pepyApiKey?: string | undefined;
}

export function credentialsFromEnv(env: Record<string, string | undefined>): Credentials {
  return { githubToken: env.GITHUB_TOKEN || undefined, pepyApiKey: env.PEPY_API_KEY || undefined };
}

export interface Resolved {
  library: string | null;
  pypi: string | null;
  /** True when the PyPI package links to the found repo; false means the package name is a guess to double-check. */
  pypiLinked: boolean;
  repo: string | null;
  homepage: string | null;
}

export interface Ids {
  repo?: string | null | undefined;
  pypi?: string | null | undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (unit tested)

const GITHUB_REPO = /github\.com\/([\w.-]+)\/([\w.-]+)/i;
// Only real links: scripts and widgets embedded in a page reference unrelated repos (pytorch.org → newrelic/...).
const GITHUB_HREF = /href=["'](https?:\/\/(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+)/gi;
// First path segments on github.com that are site pages, not repo owners.
const NOT_OWNERS = new Set([
  "about", "apps", "collections", "contact", "enterprise", "features", "login", "marketplace", "orgs", "pricing",
  "settings", "site", "sponsors", "topics",
]);

export function repoFromUrl(url: string): string | null {
  const match = GITHUB_REPO.exec(url);
  if (!match) return null;
  const owner = match[1]!;
  const name = match[2]!.replace(/\.git$/i, "");
  if (NOT_OWNERS.has(owner.toLowerCase()) || !name || name === "." || name === "..") return null;
  return `${owner}/${name}`;
}

export function isGithubUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?github\.com\//i.test(url);
}

export function sameRepo(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.toLowerCase() === b.toLowerCase();
}

function simplify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The repo linked most often, e.g. among a PyPI project's URLs or all links on a homepage. Pages also link related
 * repos (tutorials, examples), so with a library name, repos named like the library win.
 */
export function mostLinkedRepo(urls: Iterable<string>, library?: string | null): string | null {
  const counts = new Map<string, { repo: string; n: number; named: boolean }>();
  const wanted = library ? simplify(library) : null;
  for (const url of urls) {
    const repo = repoFromUrl(url);
    if (!repo) continue;
    const entry = counts.get(repo.toLowerCase()) ?? { repo, n: 0, named: simplify(repo.split("/")[1]!) === wanted };
    entry.n += 1;
    counts.set(repo.toLowerCase(), entry);
  }
  let best: { repo: string; n: number; named: boolean } | null = null;
  for (const entry of counts.values()) {
    if (!best || Number(entry.named) > Number(best.named) || (entry.named === best.named && entry.n > best.n)) {
      best = entry;
    }
  }
  return best?.repo ?? null;
}

/** `name` from the [project] table of a pyproject.toml. */
export function pyprojectName(toml: string): string | null {
  const project = /^\[project\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(toml);
  const name = project && /^name\s*=\s*["']([^"']+)["']/m.exec(project[1]!);
  return name ? name[1]! : null;
}

/** Page number of the rel="last" link in a GitHub Link header, i.e. the item count when per_page=1. */
export function lastPage(link: string | null): number | null {
  const match = link && /[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link);
  return match ? Number(match[1]) : null;
}

const SUFFIXES: Record<string, number> = { "": 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9, B: 1e9, T: 1e12 };

/** Total from a pepy badge SVG, whose last text element reads like "18G" or "523k". */
export function parseBadge(svg: string): number | null {
  const texts = [...svg.matchAll(/>\s*([\d.,]+)\s*([kKMGBT]?)\s*<\/text>/g)];
  const last = texts.at(-1);
  if (!last) return null;
  const value = Number(last[1]!.replace(/,/g, "")) * SUFFIXES[last[2]!]!;
  return Number.isFinite(value) ? Math.round(value) : null;
}

/** GitHub reports KB; keep one decimal for small repos so they don't all become "0 MB". */
export function kbToMb(kb: number): number {
  const mb = kb / 1024;
  return mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10;
}

// ---------------------------------------------------------------------------------------------------------------
// PyPI

interface PypiInfo {
  name: string;
  repo: string | null;
  homepage: string | null;
}

interface PypiJson {
  info: { name: string; home_page: string | null; project_urls: Record<string, string> | null };
}

async function pypiInfo(name: string): Promise<PypiInfo | null> {
  const response = await get(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
  if (response.status === 404) return null;
  if (response.status !== 200) throw new LookupError(`PyPI answered ${response.status}`);
  const { info } = parseJson<PypiJson>(response, "PyPI");
  const projectUrls = Object.entries(info.project_urls ?? {});
  const urls = [...projectUrls.map(([, url]) => url), info.home_page ?? ""];
  const homepageKeys = projectUrls.filter(([key]) => /^home(page)?$/i.test(key)).map(([, url]) => url);
  const homepage = [...homepageKeys, info.home_page].find((url): url is string => !!url && !isGithubUrl(url)) ?? null;
  return { name: info.name, repo: mostLinkedRepo(urls, info.name), homepage };
}

// ---------------------------------------------------------------------------------------------------------------
// GitHub

interface GithubRepo {
  full_name: string;
  stargazers_count: number;
  size: number;
  homepage: string | null;
}

function githubHeaders(credentials: Credentials): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(credentials.githubToken ? { Authorization: `Bearer ${credentials.githubToken}` } : {}),
  };
}

async function github(path: string, credentials: Credentials): Promise<HttpResponse> {
  const response = await get(`https://api.github.com${path}`, githubHeaders(credentials));
  if ((response.status === 403 || response.status === 429) && response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
    const minutes = Math.max(1, Math.ceil((reset - Date.now()) / 60_000));
    throw new LookupError(
      `GitHub rate limit reached (resets in ${minutes} min)` +
        (credentials.githubToken ? "" : "; set GITHUB_TOKEN in .env.local for a higher limit"),
    );
  }
  return response;
}

async function githubRepo(repo: string, credentials: Credentials): Promise<GithubRepo> {
  const response = await github(`/repos/${repo}`, credentials);
  if (response.status === 404) throw new LookupError(`GitHub repo ${repo} not found`);
  if (response.status !== 200) throw new LookupError(`GitHub answered ${response.status} for ${repo}`);
  return parseJson<GithubRepo>(response, "GitHub");
}

async function contributorCount(repo: string, credentials: Credentials): Promise<number> {
  // anon=1: without it GitHub only matches the first ~500 commit emails to users (pandas: 414 instead of ~4.4k).
  const response = await github(`/repos/${repo}/contributors?per_page=1&anon=1`, credentials);
  if (response.status === 204) return 0;
  if (response.status === 403) throw new LookupError("GitHub can't list contributors of a repo this large");
  if (response.status === 404) throw new LookupError(`GitHub repo ${repo} not found`);
  if (response.status !== 200) throw new LookupError(`GitHub answered ${response.status} for contributors`);
  return lastPage(response.headers.get("link")) ?? parseJson<unknown[]>(response, "GitHub").length;
}

async function searchGithub(library: string, credentials: Credentials): Promise<string | null> {
  const query = encodeURIComponent(`${library} in:name`);
  const response = await github(`/search/repositories?q=${query}&sort=stars&order=desc&per_page=1`, credentials);
  if (response.status !== 200) return null;
  const { items } = parseJson<{ items: { full_name: string }[] }>(response, "GitHub search");
  return items[0]?.full_name ?? null;
}

/** Homepages of big projects link their repo in header/footer, e.g. pytorch.org → pytorch/pytorch. */
async function repoFromHomepage(url: string, library: string | null): Promise<string | null> {
  try {
    const response = await get(url, { Accept: "text/html" });
    if (response.status !== 200) return null;
    return mostLinkedRepo([...response.body.matchAll(GITHUB_HREF)].map((m) => m[1]!), library);
  } catch {
    return null;
  }
}

/** The package name the repo itself declares (pytorch/pytorch → "torch"); raw files don't count against the API limit. */
async function packageFromRepo(repo: string): Promise<string | null> {
  try {
    const response = await get(`https://raw.githubusercontent.com/${repo}/HEAD/pyproject.toml`);
    return response.status === 200 ? pyprojectName(response.body) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// pepy.tech

async function totalDownloads(pypi: string, credentials: Credentials): Promise<number> {
  const name = encodeURIComponent(pypi);
  if (credentials.pepyApiKey) {
    const response = await get(`https://api.pepy.tech/api/v2/projects/${name}`, { "X-API-Key": credentials.pepyApiKey });
    if (response.status === 404) throw new LookupError(`pepy.tech doesn't know ${pypi}`);
    if (response.status === 401 || response.status === 403) throw new LookupError("pepy.tech rejected PEPY_API_KEY");
    if (response.status !== 200) throw new LookupError(`pepy.tech answered ${response.status}`);
    return parseJson<{ total_downloads: number }>(response, "pepy.tech").total_downloads;
  }
  const response = await get(`https://static.pepy.tech/badge/${name}`);
  const value = response.status === 200 ? parseBadge(response.body) : null;
  if (value === null) throw new LookupError(`pepy.tech has no downloads for ${pypi}`);
  return value;
}

// ---------------------------------------------------------------------------------------------------------------
// Public API

/**
 * Finds the PyPI package, GitHub repo and homepage for a library name and/or homepage URL. Order: GitHub URL given
 * directly → PyPI project links → links on the homepage → GitHub search by name.
 */
export async function resolveLibrary(
  input: { library?: string | null; url?: string | null },
  credentials: Credentials,
): Promise<Resolved> {
  const library = input.library?.trim() || null;
  const url = input.url?.trim() || null;
  let repo = url ? repoFromUrl(url) : null;
  let homepage: string | null = null;

  let pypi: PypiInfo | null = null;
  if (library) pypi = await pypiInfo(library);
  if (!repo && pypi?.repo) repo = pypi.repo;
  if (!repo && url && !isGithubUrl(url)) repo = await repoFromHomepage(url, library);
  if (!repo && library) repo = await searchGithub(library, credentials);

  if (repo) {
    const info = await githubRepo(repo, credentials);
    repo = info.full_name; // canonical spelling, follows renames
    homepage = info.homepage || null;
    // No package for the name, or one that doesn't link this repo (PyPI's "pytorch" is a placeholder): try the name
    // the repo declares, then the repo name; only a package that links back to the repo is taken.
    const tried = new Set([pypi?.name.toLowerCase()]);
    for (const candidate of [() => packageFromRepo(repo!), async () => repo!.split("/")[1]!]) {
      if (sameRepo(pypi?.repo ?? null, repo)) break;
      const name = await candidate();
      if (!name || tried.has(name.toLowerCase())) continue;
      tried.add(name.toLowerCase());
      const guess = await pypiInfo(name);
      if (guess && sameRepo(guess.repo, repo)) pypi = guess;
    }
  }
  const pypiLinked = pypi !== null && sameRepo(pypi.repo, repo);
  // An unlinked package (e.g. the "pytorch" placeholder on PyPI) may point anywhere, so prefer GitHub's homepage then.
  homepage = (pypiLinked ? pypi?.homepage : null) ?? homepage ?? pypi?.homepage ?? (repo ? `https://github.com/${repo}` : null);

  return {
    library: library ?? (repo ? repo.split("/")[1]! : null),
    pypi: pypi?.name ?? null,
    pypiLinked,
    repo,
    homepage,
  };
}

/** One category value for a library. */
export async function fetchStat(source: StatSource, ids: Ids, credentials: Credentials): Promise<number> {
  if (source === "pepy_downloads") {
    if (!ids.pypi) throw new LookupError("no PyPI package");
    return totalDownloads(ids.pypi, credentials);
  }
  if (!ids.repo) throw new LookupError("no GitHub repo");
  switch (source) {
    case "github_stars":
      return (await githubRepo(ids.repo, credentials)).stargazers_count;
    case "github_size_mb":
      return kbToMb((await githubRepo(ids.repo, credentials)).size);
    case "github_contributors":
      return contributorCount(ids.repo, credentials);
  }
}
