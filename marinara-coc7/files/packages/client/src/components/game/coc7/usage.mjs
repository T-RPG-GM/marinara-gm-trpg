/* global fetch */
/* Token usage and cost for the CoC game's own model calls.
   Records come from the server's "done" event; prices are the Keeper's own, in USD per 1M tokens. */

export const usageLimit = 5000;
export const usageTasks = { turn:'AI 답변', sheet:'수치 제안', 'sheet-profile':'능력치 자동 적용', vision:'이미지 분석', summary:'세션 요약' };
export const usageParts = [
  ['input','일반 입력'], ['cacheRead','캐시 읽기(hit)'], ['cacheWrite','캐시 쓰기(created)'], ['output','출력 (추론 포함)'],
];

const count = (value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : 0);
const price = (value) => (Number.isFinite(value) && value >= 0 ? value : null);

export function validUsageRecord(record) {
  return !!record && typeof record.id === 'string' && typeof record.at === 'string' && typeof record.model === 'string' &&
    (record.missing === true || (record.usage && typeof record.usage === 'object'));
}

export function usageTotals(records) {
  const totals = { calls:0, missing:0, input:0, cacheRead:0, cacheWrite:0, output:0, reasoning:0 };
  for (const record of records) {
    totals.calls++;
    if (record.missing || !record.usage) { totals.missing++; continue; }
    for (const key of ['input','cacheRead','cacheWrite','output','reasoning']) totals[key] += count(record.usage[key]);
  }
  totals.tokens = totals.input + totals.cacheRead + totals.cacheWrite + totals.output;
  return totals;
}

// Normalizes one price row to USD; cache reads and writes fall back to the input price when left empty.
// A row the Keeper entered in another currency carries `unit` and the units per USD it was saved with.
function priceRow(row) {
  if (!row) return null;
  const factor = row.unit && row.unit !== 'USD' && row.usdRate > 0 ? 1 / row.usdRate : 1;
  const usd = (value) => { const parsed = price(value); return parsed == null ? null : parsed * factor; };
  const input = usd(row.input);
  const output = usd(row.output);
  const perCall = usd(row.perCall);
  if (input == null && output == null && perCall == null) return null;
  return { input:input ?? 0, output:output ?? 0, cacheRead:usd(row.cacheRead) ?? input ?? 0, cacheWrite:usd(row.cacheWrite) ?? input ?? 0, perCall:perCall ?? 0 };
}

// The Keeper's own price for a model, if entered.
export function modelPrices(pricing, model) {
  return priceRow(pricing?.[model]);
}

// The price a record is charged at: the Keeper's own price wins, else the price looked up when the call ran.
// `currency`/`usdRate` say which currency the price is really billed in (LinkAPI bills CNY).
export function effectivePrices(record, pricing) {
  const own = pricing?.[record.model];
  const manual = modelPrices(pricing,record.model);
  if (manual) return { ...manual, source:'manual', ...(own.unit && own.unit !== 'USD' ? { currency:own.unit, usdRate:own.usdRate } : {}) };
  const auto = priceRow(record.pricing);
  return auto ? { ...auto, source:record.pricing.source ?? 'auto',
    ...(record.pricing.currency && record.pricing.currency !== 'USD' ? { currency:record.pricing.currency, usdRate:record.pricing.usdRate } : {}) } : null;
}

// USD per part for one record, or null when it has no price at all.
export function recordCost(record, pricing) {
  const prices = effectivePrices(record,pricing);
  if (!prices || record.missing || !record.usage) return null;
  const parts = Object.fromEntries(usageParts.map(([key]) => [key,count(record.usage[key]) * prices[key] / 1e6]));
  parts.perCall = prices.perCall;
  return { ...parts, total:Object.values(parts).reduce((sum, value) => sum + value,0), source:prices.source,
    currency:prices.currency ?? 'USD', usdRate:prices.usdRate ?? 1 };
}

// One call's cost in the local currency: a yuan-billed call uses the CNY rate when one is set,
// anything else goes through the USD rate. Null while the needed rate is missing.
export function localCost(cost, fx) {
  if (!cost || !fx) return null;
  const direct = cost.currency !== 'USD' ? fx.rates?.[cost.currency] : null;
  if (direct > 0) return cost.total * cost.usdRate * direct;
  return fx.rate > 0 ? cost.total * fx.rate : null;
}

// Sums in USD, in the local currency, and also in the billing currency when every priced call shares one
// that is not USD (each call converted back at the rate it was priced with).
export function costTotals(records, pricing, fx = null) {
  let total = 0;
  let unpriced = 0;
  let local = 0;
  let localMissing = false;
  const keys = [...usageParts.map(([key]) => key),'perCall'];
  const parts = Object.fromEntries(keys.map((key) => [key,0]));
  const billed = Object.fromEntries(keys.map((key) => [key,0]));
  let billedTotal = 0;
  const sources = new Set();
  const currencies = new Set();
  for (const record of records) {
    const cost = recordCost(record,pricing);
    if (!cost) { if (!record.missing) unpriced++; continue; }
    total += cost.total;
    billedTotal += cost.total * cost.usdRate;
    const inLocal = localCost(cost,fx);
    if (inLocal == null) localMissing = true; else local += inLocal;
    sources.add(cost.source);
    currencies.add(cost.currency);
    for (const key of keys) { parts[key] += cost[key]; billed[key] += cost[key] * cost.usdRate; }
  }
  const currency = currencies.size === 1 ? [...currencies][0] : 'USD';
  return { total, parts, unpriced, sources:[...sources], currency, local:localMissing ? null : local,
    ...(currency !== 'USD' ? { billed:{ total:billedTotal, parts:billed } } : {}) };
}

const currencySymbols = { KRW:'₩', JPY:'¥', CNY:'¥', EUR:'€', USD:'$' };
// An amount in a billing currency, e.g. "¥0.0461" (CNY) or "USD 0.0069".
export function formatMoney(value, currency = 'USD') {
  if (currency === 'USD') return formatUsd(value);
  if (!Number.isFinite(value)) return '—';
  return `${currencySymbols[currency] ?? `${currency} `}${value === 0 ? '0' : value < .01 ? value.toFixed(6) : value.toFixed(4)}`;
}
export const currencyLabel = (currency) => ({ CNY:'위안(¥)', USD:'달러($)' })[currency] ?? currency;

export const priceSources = {
  manual:'직접 입력', openrouter:'OpenRouter 가격표', nanogpt:'NanoGPT 가격표', linkapi:'LinkAPI 가격표(그룹 할인 전)',
  'models.dev':'공개 가격표(models.dev)', vertex:'Vertex 공개 가격표', auto:'자동 가격표',
};

export const formatTokens = (value) => `${Math.round(value).toLocaleString('ko-KR')} tok`;
export const shortTokens = (value) => value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value >= 1e4 ? `${(value / 1e3).toFixed(1)}k` : Math.round(value).toLocaleString('ko-KR');
export function formatUsd(value) {
  if (!Number.isFinite(value)) return '—';
  return `USD ${value === 0 ? '0' : value < .01 ? value.toFixed(6) : value.toFixed(4)}`;
}
// An amount already in the local currency, e.g. "₩61.75".
export function formatLocalAmount(amount, fx) {
  if (!Number.isFinite(amount) || !fx?.currency) return '';
  const symbol = currencySymbols[fx.currency] ?? `${fx.currency} `;
  return `${symbol}${amount.toLocaleString('ko-KR',{ maximumFractionDigits:fx.currency === 'KRW' || fx.currency === 'JPY' ? (amount < 1000 ? 2 : 0) : 2 })}`;
}
export function formatLocal(usd, fx) {
  return Number.isFinite(usd) && fx?.rate ? formatLocalAmount(usd * fx.rate,fx) : '';
}

// The billing currencies the meter converts from: dollars, and yuan for LinkAPI.
export const fxSources = ['USD','CNY'];

// Today's rate for one currency pair from a public exchange-rate service.
async function readRate(from, to, fetcher) {
  const response = await fetcher(`https://api.frankfurter.dev/v1/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  if (!response.ok) throw Error(`환율을 불러오지 못했습니다 (${response.status}).`);
  const body = await response.json();
  const rate = body?.rates?.[to];
  if (!Number.isFinite(rate) || rate <= 0) throw Error('환율 응답을 확인할 수 없습니다.');
  return { rate, date:String(body.date ?? '') };
}

// Units of `currency` per USD (used to convert a price the Keeper typed in yuan).
export async function fetchExchangeRate(currency, fetcher = fetch) {
  const { rate, date } = await readRate('USD',currency,fetcher);
  return { currency, rate, date, updatedAt:new Date().toISOString() };
}

// Today's local-currency rates for every billing currency; only asked when the Keeper presses refresh.
export async function fetchLocalRates(currency, fetcher = fetch) {
  const usd = await readRate('USD',currency,fetcher);
  const rates = {};
  for (const from of fxSources.filter((item) => item !== 'USD' && item !== currency)) rates[from] = (await readRate(from,currency,fetcher)).rate;
  return { currency, rate:usd.rate, rates, date:usd.date, updatedAt:new Date().toISOString() };
}

export function formatRate(fx) {
  if (!fx?.rate) return '';
  const symbol = currencySymbols[fx.currency] ?? `${fx.currency} `;
  const one = (from, rate) => `${from} 1 = ${symbol}${rate.toLocaleString('ko-KR',{ maximumFractionDigits:2 })}`;
  return [one('USD',fx.rate),...Object.entries(fx.rates ?? {}).filter(([,rate]) => rate > 0).map(([from,rate]) => one(from,rate))].join(' · ');
}
