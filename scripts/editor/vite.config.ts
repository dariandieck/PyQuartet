// Local-only card editor: `npm run editor`. A Vite dev server for src/editor plus a small JSON API that does the
// lookups (no CORS limits, API keys stay server-side) and writes data/cards.json. Never part of the Pages build.
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { STAT_SOURCES, type StatSource } from "../../src/game/model.ts";
import { DeckError } from "../../src/game/parse.ts";
import { readCards, readCategories, writeCards, type RawCard } from "../lib/cardsFile.ts";
import { brandColorOf } from "../lib/colors.ts";
import { LookupError } from "../lib/http.ts";
import { credentialsFromEnv, fetchStat, findLogo, resolveLibrary, type Credentials } from "../lib/lookup.ts";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function param(query: URLSearchParams, name: string): string | null {
  return query.get(name)?.trim() || null;
}

async function saveCard(body: unknown): Promise<RawCard[]> {
  const { card, replace } = body as { card: RawCard; replace: string | null };
  if (!card || typeof card.library !== "string" || !card.library.trim()) throw new HttpError(400, "Library is required");
  const categories = await readCategories();
  const cards = await readCards();
  const index = replace ? cards.findIndex((c) => c.library === replace) : -1;
  const clash = cards.findIndex((c) => c.library.toLowerCase() === card.library.trim().toLowerCase());
  if (clash !== -1 && clash !== index) throw new HttpError(409, `A card named "${cards[clash]!.library}" already exists`);
  if (index === -1) cards.push(card);
  else cards[index] = card;
  await writeCards(cards, categories);
  return readCards();
}

function api(credentials: Credentials): Plugin {
  const routes: Record<string, (query: URLSearchParams, req: IncomingMessage) => Promise<unknown>> = {
    "GET /data": async () => ({ categories: await readCategories(), cards: await readCards() }),
    "GET /resolve": (q) => resolveLibrary({ library: param(q, "library"), url: param(q, "url") }, credentials),
    "GET /stat": async (q) => {
      const source = param(q, "source") as StatSource;
      if (!STAT_SOURCES.includes(source)) throw new HttpError(400, `Unknown source ${source}`);
      return { value: await fetchStat(source, { repo: param(q, "repo"), pypi: param(q, "pypi") }, credentials) };
    },
    "GET /logo": async (q) => ({
      logo: await findLogo({ repo: param(q, "repo"), pypi: param(q, "pypi") }, credentials),
    }),
    "GET /color": async (q) => {
      const url = param(q, "url");
      if (!url) throw new HttpError(400, "url is required");
      return { color: await brandColorOf(url) };
    },
    "POST /cards": async (_q, req) => ({ cards: await saveCard(await readBody(req)) }),
  };

  return {
    name: "card-editor-api",
    configureServer(server) {
      server.middlewares.use("/api", (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const route = routes[`${req.method} ${url.pathname}`];
        if (!route) return send(res, 404, { error: "Not found" });
        route(url.searchParams, req).then(
          (body) => send(res, 200, body),
          (error: unknown) => {
            if (error instanceof HttpError) return send(res, error.status, { error: error.message });
            if (error instanceof LookupError || error instanceof DeckError) return send(res, 422, { error: error.message });
            server.config.logger.error(String((error as Error).stack ?? error));
            send(res, 500, { error: String((error as Error).message ?? error) });
          },
        );
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const credentials = credentialsFromEnv(loadEnv(mode, projectRoot, ""));
  return {
    root: fileURLToPath(new URL("../../src/editor", import.meta.url)),
    envDir: projectRoot,
    clearScreen: false,
    plugins: [api(credentials)],
    server: {
      host: "localhost",
      port: 5180,
      open: true,
      // The editor writes data/*.json itself; a reload on every save would throw away the form.
      watch: { ignored: ["**/data/**"] },
    },
  };
});
