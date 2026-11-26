// ──────────────────────────────────────────────
// CoC7 cost meter prices: what one model call costs, and a reference table of the common model families
// ──────────────────────────────────────────────
// Sources, all per 1M tokens and converted to USD before they reach the game:
// - NanoGPT, OpenRouter (own lists) and Vertex (models.dev) through the connection's own model catalog,
//   which Marinara already prices (`GET /api/connections/:id/models`);
// - LinkAPI from its public `/api/pricing`, read here because its per-call models ("[次]…", `fixed(x)`)
//   are a price per request, not per token;
// - OpenRouter's public list for the reference table when no OpenRouter connection exists.
// Public lists are read at most once a day and only while outside reads are allowed.
import type { FastifyInstance } from "fastify";
import { OUTSIDE_READS_SETTINGS_KEY } from "@marinara-engine/shared";
import { logger } from "../lib/logger.js";
import { createAppSettingsStorage } from "../services/storage/app-settings.storage.js";
import { safeFetch } from "../utils/security.js";

export interface CocPrice {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  perCall?: number;
  source: string;
  /** The list's own currency, its units per USD, and the prices as listed, when it was not USD (LinkAPI lists CNY). */
  currency?: string;
  usdRate?: number;
  original?: PriceParts;
}

type Json = Record<string, unknown>;
type PriceParts = Pick<CocPrice, "input" | "output" | "cacheRead" | "cacheWrite" | "perCall">;
const isRecord = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const num = (value: unknown) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};
const round = (value: number | undefined) => (value === undefined ? undefined : Math.round(value * 1e6) / 1e6);

/** The model families the reference table lists. */
export const COC_PRICE_FAMILIES = /deepseek|kimi|moonshot|gemini|claude|gpt|glm|z-ai|zhipu/i;
const LINKAPI_PRICING_URL = "https://api.linkapi.ai/api/pricing";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const DAY_MS = 24 * 60 * 60_000;

// ── Cached public reads ─────────────────────────

const reads = new Map<string, { until: number; value: unknown }>();
async function readJson(url: string): Promise<unknown> {
  const hit = reads.get(url);
  if (hit && Date.now() < hit.until) return hit.value;
  try {
    const response = await safeFetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
      maxResponseBytes: 32 * 1024 * 1024,
    });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    const value = JSON.parse(await response.text());
    reads.set(url, { until: Date.now() + DAY_MS, value });
    return value;
  } catch (error) {
    logger.warn(error, "CoC price list read failed: %s", url);
    if (hit) reads.set(url, { until: Date.now() + 15 * 60_000, value: hit.value });
    return hit?.value ?? null;
  }
}

/** Units of `currency` per US dollar, from a public exchange-rate service. */
async function usdRate(currency: string): Promise<number | undefined> {
  if (currency === "USD") return 1;
  const json = await readJson(`https://api.frankfurter.dev/v1/latest?from=USD&to=${encodeURIComponent(currency)}`);
  return isRecord(json) && isRecord(json.rates) ? num(json.rates[currency]) : undefined;
}

// ── LinkAPI ─────────────────────────────────────

/**
 * One LinkAPI billing expression in its display unit per 1M tokens: `p` prompt, `c` completion, `cr` cache
 * read, `cc` cache write; `fixed(x)` is a price per request. The first tier is the base price.
 */
export function parseLinkApiBilling(row: Json): PriceParts | null {
  const expr = typeof row.billing_expr === "string" ? row.billing_expr : "";
  if (row.billing_mode === "tiered_expr" && expr) {
    // The base tier is the first one: everything up to the next `tier(`.
    const tier = expr.split(/(?=tier\()/).find((part) => part.trim()) ?? expr;
    const fixed = /fixed\(\s*([\d.]+)\s*\)/.exec(tier);
    if (fixed) return { perCall: num(fixed[1]) ?? 0 };
    const parts: PriceParts = {};
    const keys: Record<string, keyof PriceParts> = { p: "input", c: "output", cr: "cacheRead", cc: "cacheWrite" };
    for (const [, name, value] of tier.matchAll(/\b(cc1h|cc|cr|p|c)\s*\*\s*([\d.]+)/g)) {
      const key = keys[name!];
      if (key && parts[key] === undefined) parts[key] = num(value);
    }
    for (const [, value, name] of tier.matchAll(/([\d.]+)\s*\*\s*\b(cc1h|cc|cr|p|c)\b/g)) {
      const key = keys[name!];
      if (key && parts[key] === undefined) parts[key] = num(value);
    }
    return Object.keys(parts).length ? parts : null;
  }
  // Older ratio billing (New API): ratio 1 is 2 per 1M input tokens; a fixed model price is per request.
  const fixedPrice = num(row.model_price);
  if (fixedPrice) return { perCall: fixedPrice };
  const ratio = num(row.model_ratio);
  if (ratio === undefined) return null;
  const input = ratio * 2;
  return { input, output: input * (num(row.completion_ratio) ?? 1) };
}

async function linkApiTable(): Promise<Map<string, PriceParts>> {
  const json = await readJson(LINKAPI_PRICING_URL);
  const rows = isRecord(json) && Array.isArray(json.data) ? json.data : [];
  const table = new Map<string, PriceParts>();
  for (const row of rows) {
    if (!isRecord(row) || typeof row.model_name !== "string") continue;
    const parts = parseLinkApiBilling(row);
    if (parts) table.set(row.model_name, parts);
  }
  return table;
}

// ── OpenRouter (public list) ────────────────────

async function openRouterTable(): Promise<Map<string, PriceParts>> {
  const json = await readJson(OPENROUTER_MODELS_URL);
  const rows = isRecord(json) && Array.isArray(json.data) ? json.data : [];
  const table = new Map<string, PriceParts>();
  const perMillion = (value: unknown) => {
    const parsed = num(value);
    return parsed === undefined ? undefined : parsed * 1e6;
  };
  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== "string" || !isRecord(row.pricing)) continue;
    const p = row.pricing;
    table.set(row.id, {
      input: perMillion(p.prompt),
      output: perMillion(p.completion),
      cacheRead: perMillion(p.input_cache_read),
      cacheWrite: perMillion(p.input_cache_write),
      perCall: num(p.request) || undefined,
    });
  }
  return table;
}

// ── Connection catalogs ─────────────────────────

type CatalogModel = { id: string; pricing?: Json };
async function connectionCatalog(app: FastifyInstance, connectionId: string): Promise<CatalogModel[]> {
  const response = await app.inject({ method: "GET", url: `/api/connections/${encodeURIComponent(connectionId)}/models` });
  if (response.statusCode !== 200) return [];
  const json = response.json() as unknown;
  return isRecord(json) && Array.isArray(json.models)
    ? (json.models.filter((model) => isRecord(model) && typeof model.id === "string") as CatalogModel[])
    : [];
}

function catalogParts(pricing: Json | undefined): PriceParts | null {
  if (!pricing) return null;
  const parts: PriceParts = {
    input: num(pricing.prompt),
    output: num(pricing.completion),
    cacheRead: num(pricing.cacheRead),
    cacheWrite: num(pricing.cacheWrite),
    perCall: num(pricing.perCall),
  };
  return Object.values(parts).some((value) => value !== undefined) ? parts : null;
}

// ── Which list a connection is priced from ──────

type ConnectionLike = { id: string; provider: string; baseUrl?: string | null };
const hostOf = (conn: ConnectionLike) => {
  try {
    return new URL(conn.baseUrl ?? "").hostname.toLowerCase();
  } catch {
    return "";
  }
};
export function priceProvider(conn: ConnectionLike): "linkapi" | "openrouter" | "nanogpt" | "vertex" | "other" {
  const host = hostOf(conn);
  if (host.endsWith("linkapi.ai")) return "linkapi";
  if (conn.provider === "openrouter" || host.endsWith("openrouter.ai")) return "openrouter";
  if (conn.provider === "nanogpt" || host.endsWith("nano-gpt.com")) return "nanogpt";
  if (conn.provider === "vertex" || /vertex|aiplatform\.googleapis\.com/.test(host)) return "vertex";
  return "other";
}

async function outsideReadsAllowed(app: FastifyInstance) {
  return (await createAppSettingsStorage(app.db).get(OUTSIDE_READS_SETTINGS_KEY)) === "on";
}

async function toUsd(parts: PriceParts, source: string, currency = "USD"): Promise<CocPrice | null> {
  const rate = await usdRate(currency);
  if (!rate) return null;
  const usd = (value: number | undefined) => round(value === undefined ? undefined : value / rate);
  return {
    input: usd(parts.input),
    output: usd(parts.output),
    cacheRead: usd(parts.cacheRead),
    cacheWrite: usd(parts.cacheWrite),
    perCall: usd(parts.perCall),
    source,
    ...(currency !== "USD" ? { currency, usdRate: rate, original: { ...parts } } : {}),
  };
}

/** What one call of `model` on `conn` costs, in USD, or null when no list prices it. */
export async function cocPriceFor(app: FastifyInstance, conn: ConnectionLike, model: string): Promise<CocPrice | null> {
  const kind = priceProvider(conn);
  const outside = await outsideReadsAllowed(app);
  if (kind === "linkapi" && outside) {
    const parts = (await linkApiTable()).get(model);
    return parts ? toUsd(parts, "linkapi", "CNY") : null;
  }
  const hit = (await connectionCatalog(app, conn.id)).find((item) => item.id === model);
  const parts = catalogParts(hit?.pricing);
  if (parts) {
    const listed = typeof hit?.pricing?.source === "string" ? hit.pricing.source : kind;
    const source = listed === "models.dev" && kind === "vertex" ? "vertex" : listed;
    const currency = typeof hit?.pricing?.currency === "string" ? hit.pricing.currency : "USD";
    return toUsd(parts, source, currency);
  }
  if (kind === "openrouter" && outside) {
    const row = (await openRouterTable()).get(model);
    return row ? toUsd(row, "openrouter") : null;
  }
  return null;
}

/** The reference table: the common families across NanoGPT, OpenRouter, Vertex and LinkAPI, in USD. */
export async function cocPriceTable(app: FastifyInstance, connections: ConnectionLike[]) {
  const outside = await outsideReadsAllowed(app);
  const providers: Array<{ id: string; label: string; models: Array<CocPrice & { id: string }> }> = [];
  const add = async (id: string, label: string, rows: Iterable<[string, PriceParts]>, source: string, currency = "USD") => {
    const models: Array<CocPrice & { id: string }> = [];
    for (const [model, parts] of rows) {
      if (!COC_PRICE_FAMILIES.test(model)) continue;
      const price = await toUsd(parts, source, currency);
      if (price) models.push({ id: model, ...price });
    }
    models.sort((a, b) => a.id.localeCompare(b.id));
    providers.push({ id, label, models });
  };
  const fromCatalog = async (kind: string) => {
    const conn = connections.find((item) => priceProvider(item) === kind);
    if (!conn) return null;
    const rows: Array<[string, PriceParts]> = [];
    for (const model of await connectionCatalog(app, conn.id)) {
      const parts = catalogParts(model.pricing);
      if (parts) rows.push([model.id, parts]);
    }
    return rows;
  };
  const nano = await fromCatalog("nanogpt");
  if (nano) await add("nanogpt", "NanoGPT", nano, "nanogpt");
  const openrouter = (await fromCatalog("openrouter")) ?? (outside ? [...(await openRouterTable())] : null);
  if (openrouter) await add("openrouter", "OpenRouter", openrouter, "openrouter");
  const vertex = await fromCatalog("vertex");
  if (vertex) await add("vertex", "Vertex", vertex, "vertex");
  if (outside) await add("linkapi", "LinkAPI", await linkApiTable(), "linkapi", "CNY");
  return { providers, outsideReads: outside, fetchedAt: new Date().toISOString() };
}
