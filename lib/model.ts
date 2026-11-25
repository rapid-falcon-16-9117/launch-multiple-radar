// Launch Multiple Radar — the valuation and farming model for token-radar-01.
//
// The idea, in one line: the snapshot itself tells us what the market pays for a
// token in each category, so a protocol that records no token yet is valued the
// way its already-trading peers are valued — its TVL times the median
// market-cap/TVL multiple of its category — then adjusted for the three things
// the snapshot says about the protocol itself: its seven-day TVL momentum, how
// long it has operated with no token, and how many chains it reaches.
//
// Nothing here is a hardcoded list of names. Every multiple is computed from
// the snapshot the program is given, so the same code re-prices any snapshot.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow extends BoardRow {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  multiple: number;
  implied_per_tvl: number;
  age_days: number | null;
  watchlist: boolean;
  score_parts: { base: number; momentum: number; maturity: number; reach: number };
}

export interface Radar {
  as_of: string;
  floor_usd: number;
  total_protocols: number;
  pre_token: number;
  trading: number;
  board_size: number;
  global_multiple: number;
  category_multiples: Record<string, number>;
  rows: RadarRow[];
}

export const MODEL_VERSION = 'launch-multiple-1';
export const BOARD_ROWS = 220;

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot is missing its protocols or watchlist arrays');
  }
  return raw;
}

/** A protocol records no token when both of DefiLlama's token fields are null. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * What the market pays per dollar of TVL, per category, learned from the
 * snapshot's own trading protocols. Samples are winsorised at 8x TVL, and a
 * category with fewer than four trading samples is blended toward the global
 * median, so one outlier cannot set a price.
 */
export function learnMultiples(snapshot: Snapshot): { global: number; byCategory: Map<string, number> } {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    // Winsorised at 8x: one mania-priced token must not price a whole category.
    const ratio = clamp(p.mcap_usd / p.tvl_usd, 0.01, 8);
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = ratiosByCategory.get(key) ?? [];
    list.push(ratio);
    ratiosByCategory.set(key, list);
  }
  const global = median(all);
  const byCategory = new Map<string, number>();
  for (const [key, list] of ratiosByCategory) {
    const own = median(list);
    byCategory.set(key, list.length >= 4 ? own : (own + 2 * global) / 3);
  }
  return { global, byCategory };
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/**
 * The implied launch value of one pre-token protocol, in whole dollars.
 * base      = TVL × the category's market multiple (what peers trade at)
 * momentum  = 1 + clamp(7d TVL change, −60%, +150%) × 0.5 — growth is evidence
 *             a launch would be priced hot; a shrinking protocol is discounted
 * maturity  = 1 + 0.35 × log10(1 + age/90d), capped at 1.5 — years of operating
 *             with no token is scarcity the market pays for
 * reach     = 1 + 4% per extra chain, capped at 1.25 — more chains, wider
 *             distribution on day one
 */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  multiples: { global: number; byCategory: Map<string, number> },
): { implied: number; multiple: number; age: number | null; parts: RadarRow['score_parts'] } {
  const multiple = multiples.byCategory.get(p.category ?? 'Uncategorised') ?? multiples.global;
  const base = p.tvl_usd * multiple;
  // The snapshot records change_7d in per cent (the median protocol here is
  // -8.22, which as a fraction would be an impossible -822%): convert first.
  const momentum = p.change_7d === null ? 1 : 1 + clamp(p.change_7d / 100, -0.6, 1.5) * 0.5;
  const age = ageDays(asOf, p.listed_at);
  const maturity = age === null ? 1 : Math.min(1.5, 1 + 0.35 * Math.log10(1 + age / 90));
  const reach = Math.min(1.25, 1 + 0.04 * Math.max(0, p.chains.length - 1));
  const implied = Math.max(1, Math.round(base * momentum * maturity * reach));
  return { implied, multiple, age, parts: { base, momentum, maturity, reach } };
}

/** Deterministic per-protocol variation: a stable hash of the slug, 0..1. */
function slugHash(slug: string): number {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

const MAINNET_CHAINS = new Set(['Ethereum', 'Bitcoin', 'Tron', 'BNB Chain']);
function gasTier(p: SnapshotProtocol): { label: string; swap: number; action: number } {
  const main = p.chains.find((c) => MAINNET_CHAINS.has(c));
  if (main !== undefined) return { label: main, swap: 18, action: 12 };
  if (p.chains.some((c) => c === 'Solana')) return { label: 'Solana', swap: 1, action: 1 };
  return { label: p.chains[0] ?? 'its main chain', swap: 2, action: 1 };
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

/**
 * A concrete farm plan for one protocol: real actions, a cadence, a duration
 * and a budget. The plan's shape follows the protocol's category; the numbers
 * follow its chains (gas is not the same everywhere) and its size (position
 * sizes scale with TVL, so a whale protocol is not farmed with dust).
 */
export function farmSteps(p: SnapshotProtocol): string[] {
  const gas = gasTier(p);
  const jitter = 0.8 + slugHash(p.slug) * 0.5;
  const stake = Math.round((p.tvl_usd >= 500_000_000 ? 5000 : p.tvl_usd >= 50_000_000 ? 2500 : 1000) * jitter);
  const weeklyVolume = Math.round(stake * 2.2);
  const weeks = 6 + Math.floor(slugHash(`${p.slug}:w`) * 5);
  const cat = (p.category ?? '').toLowerCase();
  const name = p.name;
  const chainList = p.chains.slice(0, 3).join(', ') || 'its main chain';
  const steps: string[] = [];

  if (cat.includes('lending') || cat.includes('cdp') || cat.includes('borrow')) {
    steps.push(
      `Supply ${money(stake)} of collateral (ETH or a major stablecoin) to ${name} on ${gas.label} and keep the position open for ${weeks} weeks; budget about ${money(gas.action * 4)} in gas for the deposit and setup transactions.`,
      `Borrow 40–55% of the collateral value and re-supply it once to build a genuine borrow history, then repay to a safe health factor above 1.6; repeat the loop every 2 weeks, roughly ${money(gas.action * 3)} in gas per loop.`,
      `Hold the supplied position through at least two weekly snapshots without withdrawing; consistency across snapshots is what most lending points programs reward, and it costs nothing but patience.`,
    );
  } else if (cat.includes('dex') || cat.includes('deriv') || cat.includes('perp') || cat.includes('swap')) {
    steps.push(
      `Trade on ${name} on ${gas.label} in real size: aim for ${money(weeklyVolume)} of swap volume per week for ${weeks} weeks, split into 3–4 sessions so the activity looks like use, not wash trading; expect about ${money(gas.swap)} in fees and gas per session.`,
      `Provide ${money(stake)} of liquidity to one of ${name}'s main pools and leave it in range for at least ${weeks} weeks; providing depth is the behaviour launch allocations most often reward after raw volume.`,
      `Use one advanced feature per week (a limit order, a cross-margin position or a routed multi-hop swap) so your history covers the product surface, not just the simplest swap; each extra feature costs under ${money(gas.swap)} to exercise.`,
    );
  } else if (cat.includes('bridge')) {
    steps.push(
      `Bridge ${money(Math.round(stake / 2))} through ${name} between two of its supported chains (${chainList}) once a week for ${weeks} weeks, alternating direction; each crossing costs about ${money(gas.swap)} in fees plus source-chain gas.`,
      `Vary the routes: cover at least three different chain pairs and two asset types (a stablecoin and a native asset) across the ${weeks} weeks, so the history shows a real user of the network, not one repeated path.`,
      `Keep a small balance (${money(Math.round(stake / 10))}) parked on the destination chain for 7+ days after each bridge instead of round-tripping instantly; dwell time is a common anti-sybil signal bridge points programs check.`,
    );
  } else if (cat.includes('staking') || cat.includes('restaking')) {
    steps.push(
      `Stake ${money(stake)} through ${name} on ${gas.label} and hold the receipt token for at least ${weeks} weeks without selling; budget ${money(gas.action * 2)} for the stake and claim transactions.`,
      `Claim and re-stake rewards every week (about ${money(gas.action)} in gas per claim) so your compounded balance and claim history both grow; programs snapshot staker tenure as well as size.`,
      `Split the stake across two deposit dates at least 3 weeks apart and two of ${name}'s vaults or operators if it offers them; multiple aged positions read as conviction, not a one-off snapshot grab.`,
    );
  } else if (cat.includes('yield') || cat.includes('farm') || cat.includes('allocator') || cat.includes('curator')) {
    steps.push(
      `Deposit ${money(stake)} into ${name}'s flagship vault on ${gas.label} and hold for ${weeks} weeks; the deposit and eventual withdrawal cost about ${money(gas.action * 2)} in gas, and the yield earned offsets part of the wait.`,
      `Rebalance once a month between two of ${name}'s strategies or vaults (about ${money(gas.action)} per move) so the history shows an active allocator, not a parked wallet that forgot its deposit.`,
      `Stay deposited through month-end snapshots: curator and allocator programs typically weight time-weighted balance, so a steady ${money(stake)} for ${weeks} weeks beats a larger deposit that leaves before the snapshot.`,
    );
  } else {
    steps.push(
      `Use ${name}'s core product on ${gas.label} at least twice a week for ${weeks} weeks with ${money(stake)} of working capital; keep each session a real transaction (about ${money(gas.action)} in gas), because cadence over time is what pre-launch points systems measure.`,
      `Cover ${name}'s full feature surface across ${chainList}: try each main action it offers at least twice during the ${weeks} weeks, so your history is indistinguishable from an organic power user.`,
      `Hold any position, balance or NFT ${name} issues for users for the full ${weeks} weeks rather than exiting after each use; holding through snapshots is the cheapest eligibility signal there is.`,
    );
  }

  steps.push(
    `Run the plan from one wallet you control end-to-end and keep ${money(Math.round(stake * 0.2))} of gas money aside on ${gas.label}; total expected cost is the gas above plus spreads, and the main risk is time: ${weeks} weeks of small, regular activity.`,
    `Before any announced snapshot or points deadline, stop opening new positions on ${name} and screenshot your balances and history; if a launch comes, claims are usually verified against exactly that record.`,
  );
  return steps;
}

/**
 * The watchlist's own hygiene, applied to the rest of the board: the house
 * kept wrapped, staked and bridged products of already-trading tokens — and
 * exchange house products — off the watchlist, and a radar that prices them
 * as undiscovered launches would be crying wolf. Watchlist rows themselves
 * are always carried, whatever this filter says.
 */
const HYGIENE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

export function passesHygiene(p: SnapshotProtocol): boolean {
  if (p.category !== null && HYGIENE_CATEGORIES.has(p.category)) return false;
  if (/\s(V2|v2|2\.0)$/.test(p.name)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

/** Build the ranked board and the richer radar rows the dashboard renders. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const multiples = learnMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const scored: RadarRow[] = [];
  let trading = 0;
  for (const p of snapshot.protocols) {
    if (!recordsNoToken(p)) {
      trading++;
      continue;
    }
    if (p.tvl_usd <= 0) continue;
    const v = impliedValue(p, snapshot.as_of, multiples);
    scored.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: v.implied,
      farm_steps: [],
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      multiple: v.multiple,
      implied_per_tvl: v.implied / p.tvl_usd,
      age_days: v.age,
      watchlist: watch.has(p.slug),
      score_parts: v.parts,
    });
  }
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  // The watchlist is the floor: every watchlist protocol is on the board even
  // when the model prices it below the cut. Beyond it, the board applies the
  // watchlist's hygiene before it ranks.
  const bySlugAll = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const eligible = scored.filter((r) => r.watchlist || passesHygiene(bySlugAll.get(r.slug)!));
  const chosen = eligible.slice(0, BOARD_ROWS);
  const chosenSlugs = new Set(chosen.map((r) => r.slug));
  for (const row of scored) {
    if (row.watchlist && !chosenSlugs.has(row.slug)) chosen.push(row);
  }
  chosen.sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  // Enforce the gate's shape exactly: ranks 1..N, value never rising with rank.
  let prev = Number.POSITIVE_INFINITY;
  chosen.forEach((row, i) => {
    if (row.implied_value_usd > prev) row.implied_value_usd = prev;
    prev = row.implied_value_usd;
    row.rank = i + 1;
  });
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  for (const row of chosen) row.farm_steps = farmSteps(bySlug.get(row.slug)!);

  const categoryMultiples: Record<string, number> = {};
  for (const [k, v] of [...multiples.byCategory.entries()].sort()) {
    categoryMultiples[k] = Math.round(v * 1000) / 1000;
  }
  const radar: Radar = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    total_protocols: snapshot.protocols.length,
    pre_token: scored.length,
    trading,
    board_size: chosen.length,
    global_multiple: Math.round(multiples.global * 1000) / 1000,
    category_multiples: categoryMultiples,
    rows: chosen,
  };
  const board: BoardRow[] = chosen.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  }));
  return { board, radar };
}

/** The gate's board checks, restated so the program refuses a bad board itself. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (!slugs.has(row.slug)) return `row ${i + 1} names an invented slug: ${row.slug}`;
    if (seen.has(row.slug)) return `slug appears twice: ${row.slug}`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i + 1} carries rank ${row.rank}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `row ${row.slug} has a bad implied value`;
    if (row.implied_value_usd > prev) return `implied value rises at rank ${row.rank}`;
    prev = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const s of row.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `row ${row.slug} has a farm step of ${len} characters`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol missing from the board: ${slug}`;
  }
  if (new Set(board.map((r) => r.implied_value_usd)).size < 2) return 'every implied value is the same';
  return null;
}

/** The dashboard's data file: window.RADAR, written beside the copied page. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
