/** Error with a message meant for the user (shown next to an editor field or in the stats script output). */
export class LookupError extends Error {
  override name = "LookupError";
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  body: string;
}

const USER_AGENT = "pyquartet-card-tools";
const TIMEOUT_MS = 15_000;
const CACHE_MS = 10 * 60_000;

// The editor asks for stars and repo size separately, both from the same GitHub URL; the cache turns that into one
// request and keeps typing in the editor from burning through GitHub's 60 requests/hour without a token.
const cache = new Map<string, { time: number; response: Promise<HttpResponse> }>();

async function request(url: string, headers: Record<string, string>): Promise<HttpResponse> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new LookupError(`${new URL(url).host} is not reachable (${(error as Error).message})`);
  }
  return { status: response.status, headers: response.headers, body: await response.text() };
}

/** GET with a short in-memory cache for successful responses. */
export function get(url: string, headers: Record<string, string> = {}): Promise<HttpResponse> {
  const key = `${url} ${JSON.stringify(headers)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < CACHE_MS) return hit.response;
  const response = request(url, headers);
  cache.set(key, { time: Date.now(), response });
  response.then(
    (r) => {
      if (r.status >= 300) cache.delete(key);
    },
    () => cache.delete(key),
  );
  return response;
}

export function parseJson<T>(response: HttpResponse, what: string): T {
  try {
    return JSON.parse(response.body) as T;
  } catch {
    throw new LookupError(`${what}: unexpected response`);
  }
}
