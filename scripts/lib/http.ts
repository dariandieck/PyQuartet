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

const RETRY_WAIT_MS = 15_000;
const MAX_RETRY_WAIT_MS = 60_000;

async function request(url: string, headers: Record<string, string>): Promise<HttpResponse> {
  // pepy.tech's free API key allows only a few requests per minute and answers 429 without a Retry-After header,
  // so short rate limits are waited out. GitHub's hourly limit (remaining 0) is reported instead, see lookup.ts.
  for (let waited = 0; ; ) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, ...headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new LookupError(`${new URL(url).host} is not reachable (${(error as Error).message})`);
    }
    const result = { status: response.status, headers: response.headers, body: await response.text() };
    const wait = (Number(response.headers.get("retry-after")) || RETRY_WAIT_MS / 1000) * 1000;
    const hourlyLimit = response.headers.get("x-ratelimit-remaining") === "0";
    if (result.status !== 429 || hourlyLimit || waited + wait > MAX_RETRY_WAIT_MS) return result;
    await new Promise((resolve) => setTimeout(resolve, wait));
    waited += wait;
  }
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
