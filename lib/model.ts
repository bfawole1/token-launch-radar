// Token Radar's model, version radar-2: one sealed snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the floor: the early rows the radar exists to find. A protocol is
// pre-token when its record carries no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown with the market's own values, never
// mixed into the ranked board. Say "records no token", never "has no token": the record is not
// proof, and a listed protocol may still carry a token DefiLlama does not record.
//
// Implied value follows only from the snapshot's own figures. The multiple is a peer multiple,
// not a constant: for each category it is the median market-cap/TVL ratio of the live-token
// protocols in that same category, so a lending protocol is priced like lending and a DEX like a
// DEX. Categories with fewer than three live peers fall back to the global median, and every
// multiple is clamped, so one outlier protocol cannot set a category's price.
//
//   peer       = median(mcap_usd / tvl_usd) over live peers in the category (n >= 3),
//                else the global median over all live protocols; clamped to [0.05, 1.50]
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x 0.5
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365 days)
//   chains     = 1 + 0.03 x min(chains - 1, 5)            (a protocol live on more chains
//                                                          reaches more users; capped at 1.15)
//   implied    = max(1, round(tvl_usd x peer x growthMult x maturity x chains))
//
// No protocol name is ever special-cased: the same function scores every row. The dashboard
// recomputes each row from the same figures, so the page and board.json visibly agree.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  min_peers: number;
  multiple_floor: number;
  multiple_cap: number;
  chain_step: number;
  chain_max_bonus: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  min_peers: 3,
  multiple_floor: 0.05,
  multiple_cap: 1.5,
  chain_step: 0.03,
  chain_max_bonus: 5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 260;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 30;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    peer_source: 'category' | 'global';
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  peer_source: 'category' | 'global';
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

/** One category's peer multiple, for the dashboard's peer table. */
export interface PeerRow {
  category: string;
  peers: number;
  multiple: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the peers and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  peers: PeerRow[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A live-token protocol: the record carries a token with a market cap. */
export function isLiveToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.tvl_usd > 0;
}

/**
 * The peer multiples: for every category, the median market-cap/TVL of its live-token protocols,
 * when the category has at least `min_peers` of them; the global median otherwise. Every multiple
 * is clamped, so a single outlier protocol cannot price a whole category.
 */
export function peerMultiples(protocols: SnapshotProtocol[], model: ModelConstants): { byCategory: Map<string, { multiple: number; peers: number }>; global: number } {
  const live = protocols.filter(isLiveToken);
  const global = clamp(median(live.map((p) => p.mcap_usd! / p.tvl_usd)), model.multiple_floor, model.multiple_cap);
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  const groups = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = groups.get(key);
    if (list) list.push(p.mcap_usd! / p.tvl_usd);
    else groups.set(key, [p.mcap_usd! / p.tvl_usd]);
  }
  for (const [category, ratios] of groups) {
    if (ratios.length >= model.min_peers) {
      byCategory.set(category, { multiple: clamp(median(ratios), model.multiple_floor, model.multiple_cap), peers: ratios.length });
    }
  }
  return { byCategory, global };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** The peer multiple one protocol is priced at, and where it came from. */
export function peerFor(p: SnapshotProtocol, peers: { byCategory: Map<string, { multiple: number; peers: number }>; global: number }): { multiple: number; peers: number; source: 'category' | 'global' } {
  const hit = peers.byCategory.get(p.category ?? 'Other');
  if (hit) return { multiple: hit.multiple, peers: hit.peers, source: 'category' };
  return { multiple: peers.global, peers: 0, source: 'global' };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  peers: { byCategory: Map<string, { multiple: number; peers: number }>; global: number },
): { implied: number; peer: number; peerCount: number; peerSource: 'category' | 'global'; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, peers: peerCount, source: peerSource } = peerFor(protocol, peers);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainCount = Math.max(1, protocol.chains.length);
  const chainMult = 1 + model.chain_step * Math.min(chainCount - 1, model.chain_max_bonus);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * chainMult));
  return { implied, peer: multiple, peerCount, peerSource, growthPct, growthMult, maturityMult, chainMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const peers = peerMultiples(snapshot.protocols, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. A chosen
  // protocol stays chosen; the early rows only add what the floor leaves out.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, peers);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      // Full precision on purpose: the dashboard recomputes this row from the stored multiple,
      // and a rounded multiple would make its number differ from board.json by a few dollars.
      peer_multiple: s.peer,
      peer_count: s.peerCount,
      peer_source: s.peerSource,
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The second chain a protocol names, when it runs on more than one. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category family a protocol farms like: lending, dex, yield, bridge, staking, perps, rwa, stable, prediction, curator, insurance, launchpad, payments, or other. */
export function familyOf(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('dex') || c.includes('leveraged farm')) return 'dex';
  if (c.includes('yield') || c.includes('farm')) return 'yield';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('staking') || c.includes('restak')) return 'staking';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return 'perps';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('stable')) return 'stable';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('curator') || c.includes('allocator') || c.includes('index')) return 'curator';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('launchpad')) return 'launchpad';
  if (c.includes('payment')) return 'payments';
  return 'other';
}

/** The core action for a family: what the farmer actually does with the capital. */
function coreAction(family: string, p: SnapshotProtocol, capital: number, chain: string): string {
  const name = p.name;
  switch (family) {
    case 'lending':
      return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $20 of USDC against it and repay the borrow within the week.`;
    case 'dex':
      return `Provide $${capital} of liquidity to ${name}'s main USDC pair on ${chain} and make one swap through the pool each week.`;
    case 'yield':
      return `Deposit $${capital} of USDC into ${name}'s main vault on ${chain} and claim or compound the yield it pays each week.`;
    case 'bridge':
      return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds in one app on the destination chain.`;
    case 'staking':
      return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and hold the receipt token it issues.`;
    case 'perps':
      return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small long and one small short over the week.`;
    case 'rwa':
      return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`;
    case 'stable':
      return `Mint $${capital} of the stable asset through ${name} on ${chain} and hold it, or supply it to the protocol's own pool.`;
    case 'prediction':
      return `Fund $${capital} on ${name} on ${chain} and place one small position in an active market each week.`;
    case 'curator':
      return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in the farming wallet.`;
    case 'insurance':
      return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the whole farming window.`;
    case 'launchpad':
      return `Stake $${capital} of the launchpad's qualifying asset on ${name} on ${chain} and join one sale or allocation round.`;
    case 'payments':
      return `Send $${capital} of USDC through ${name} on ${chain} in two or three real payments over the month.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chain} and use the protocol's main feature once a week.`;
  }
}

/** The weekly qualifying action for a family: the habit that keeps the wallet active. */
function weeklyAction(family: string, p: SnapshotProtocol): string {
  const name = p.name;
  switch (family) {
    case 'lending':
      return `Once a week, adjust the position on ${name}: add $10 of collateral, borrow $5, or repay $5, so the wallet shows steady use.`;
    case 'dex':
      return `Once a week, swap $10 through ${name}'s pool and add or remove $5 of liquidity, so the wallet shows steady use.`;
    case 'yield':
      return `Once a week, claim the vault yield on ${name} or top the deposit up by $10, so the wallet shows steady use.`;
    case 'bridge':
      return `Once a week, bridge $10 through ${name} and use it on the destination chain, so the wallet shows steady use.`;
    case 'staking':
      return `Once a week, restake the rewards ${name} pays or top the stake up by $10, so the wallet shows steady use.`;
    case 'perps':
      return `Once a week, open and close one small trade on ${name} with $10 of margin, so the wallet shows steady use.`;
    case 'rwa':
      return `Once a week, check the asset's yield on ${name} and mint or redeem $10, so the wallet shows steady use.`;
    case 'stable':
      return `Once a week, mint or redeem $10 of the stable asset on ${name}, so the wallet shows steady use.`;
    case 'prediction':
      return `Once a week, place one small position in a new market on ${name}, so the wallet shows steady use.`;
    case 'curator':
      return `Once a week, check the vault's allocation on ${name} and add $10, so the wallet shows steady use.`;
    case 'insurance':
      return `Once a week, review the cover on ${name} and renew or extend it before it lapses, so the wallet shows steady use.`;
    case 'launchpad':
      return `Once a week, check ${name} for a new sale and keep the qualifying stake topped up by $10.`;
    case 'payments':
      return `Once a week, make one real payment of $10 through ${name}, so the wallet shows steady use.`;
    default:
      return `Once a week, use ${name}'s main feature with $10, so the wallet shows steady use.`;
  }
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category family, chains, TVL, age), never from a hand-written
 * list of names. A multi-chain protocol gets a second-chain step; a single-chain one gets a
 * second-pool step instead.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const second = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const family = familyOf(p);
  const gas = capital >= 150 ? 8 : 4;
  const secondStep: FarmStep = second
    ? {
        text: `Repeat the core position on ${second} with $25: ${family === 'bridge' ? `bridge $25 there through ${p.name} and use it in one app` : `open the same kind of position on ${second} so the wallet is active on two chains`}.`,
        cost: '$25 of capital and about $5 of gas',
        time: '20 minutes',
      }
    : {
        text: `Open a second, smaller position of $25 in another pool or vault on ${p.name} so the wallet touches more than one part of the protocol.`,
        cost: '$25 of capital and about $3 of gas',
        time: '20 minutes',
      };
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: coreAction(family, p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyAction(family, p),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    secondStep,
    {
      text: `Hold every position for at least ${hold} days so the activity is counted in more than one snapshot, and check the protocol's own points or rewards page weekly.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, claim only from the link the protocol itself publishes, never from a link in a message or a search result. Write the wallet, the dates and every transaction in a farm log.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    peer_multiple: row.model.peer_multiple,
    peer_source: row.model.peer_source,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const peers = peerMultiples(snapshot.protocols, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const peerRows: PeerRow[] = [...peers.byCategory.entries()]
    .map(([category, v]) => ({ category, peers: v.peers, multiple: round4(v.multiple) }))
    .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist: snapshot.watchlist,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_multiple: round4(peers.global),
    peers: peerRows,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
