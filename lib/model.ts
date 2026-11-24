// The token radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds the
// pre-token protocols the watchlist leaves out: the early rows below the floor, and the off-list rows
// at or above the floor that the house did not put on the watchlist. A protocol is pre-token when its
// index entry records no token (no market cap, no CoinGecko id, no symbol); the snapshot's live-token
// protocols are kept apart and shown as the market's own values, never mixed into the ranked board.
//
// Implied value is two fitted pieces, never a name list and never TVL times a flat multiple:
//
//   launch value = exp(a + b * ln(TVL) + category effect)
//     Fit by ridge regression on the 88 token-trading comparables in the snapshot (log market cap on
//     log TVL plus a category effect, ridge 64 on the category dummies). Slope 0.399: the multiple
//     falls as TVL grows, so a $2.7B protocol is not worth 53x a $51M one.
//   token odds   = logistic(age, size, category token share, 7-day growth)
//     Fit on the 437 stand-alone peers in the snapshot (records a token vs records none).
//   implied      = launch value x token odds (x 0.5 for off-list rows)
//
// Every term was kept only because it lowered the miss in BOTH leave-one-out and walk-forward tests
// (see VALIDATION.md). The headline numbers: flat median multiple misses x4.90 LOO / x4.49
// walk-forward; this model misses x3.09 LOO / x2.45 walk-forward. Token odds score Brier 0.215 on
// ten-fold cross-validation against a 0.248 base rate. Intervals are P25-P75 and P10-P90 from the
// leave-one-out residuals, widened 1.1x; two-fold coverage is 52% and 80% against nominal 50% and 80%.
//
// Farm verdicts price the position: expected drop = implied x 0.000005 (a 5% community allocation
// split across about 10,000 farmers), costs = gas + a 4.5% T-bill capital charge, hours =
// research + setup + weekly upkeep + claim + unwind. FARM means net > 0 and net/hour > $25;
// MARGINAL means net > 0; else SKIP.

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

/**
 * The radar-1 constants, kept so the starter dashboard still renders its model box and its
 * recompute check. The board itself is scored by radar-2 below; the dashboard is rewritten in
 * Phase 2 to state and recompute radar-2.
 */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** The launch-value curve, fit on the snapshot's 88 comparables (see VALIDATION.md). */
export const LAUNCH_INTERCEPT = 9.0121;
export const LAUNCH_SLOPE = 0.3992;

/** Ridge-shrunk category effects on log launch value; a category the fit never saw gets 0. */
export const CATEGORY_EFFECT: Record<string, number> = {
  'AI Agents': -0.0029,
  'Basis Trading': 0.1198,
  CDP: -0.0463,
  'Collateral Management': 0.0513,
  DOR: -0.0114,
  'Decentralized AI': 0.0344,
  Derivatives: 0.0376,
  Dexs: 0.0232,
  'Dual-Token Stablecoin': -0.0236,
  Indexes: 0.0001,
  Launchpad: 0.0033,
  Lending: -0.165,
  'Leveraged Farming': 0.0027,
  'Liquidity Manager': -0.0538,
  'NFT Marketplace': 0.0206,
  'Onchain Capital Allocator': -0.0319,
  Options: 0.0148,
  Payments: -0.0394,
  'Prediction Market': 0.0987,
  Privacy: 0.0651,
  RWA: 0.042,
  Restaking: 0.0144,
  'Risk Curators': 0.0286,
  'Staking Pool': -0.0738,
  'Token Locker': 0.0385,
  Yield: -0.0849,
  'Yield Aggregator': -0.062,
};

/** Leave-one-out residual quantiles of log launch value, and the widening that calibrates them. */
export const LOG_Q25 = -1.1159;
export const LOG_Q75 = 1.133;
export const LOG_Q10 = -2.52;
export const LOG_Q90 = 2.2866;
export const INTERVAL_SCALE = 1.1;

/**
 * The token-odds logit, fit on the snapshot's 437 stand-alone peers. Features, in order:
 * log years listed, log TVL, the category's token share, clamped 7-day growth. Coefficients apply
 * to the standardised features (means and standard deviations below).
 */
export const ODDS_INTERCEPT = 0.1774;
export const ODDS_COEF = [0.4786, 0.3329, 0.3728, -0.5801];
export const ODDS_MEAN = [0.185, 17.4742, 0.547, -0.0477];
export const ODDS_SD = [1.0052, 1.5565, 0.2148, 0.1547];

/** Off-list rows were left off the house watchlist, so the radar credits half their value. */
export const OFF_LIST_DISCOUNT = 0.5;

/** One farmer's share of an implied launch value: 5% to the community, ~10,000 farmers. */
export const DROP_SHARE = 0.000005;

/** The risk-free rate the capital charge is priced at. */
export const TBILL_RATE = 0.045;

/** The hourly benchmark a farm verdict is judged against. */
export const FARM_HOURLY_BENCHMARK = 25;

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
  group: 'watchlist' | 'early' | 'off-list';
  launch_value_usd: number;
  token_odds: number;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  implied_p10_usd: number;
  implied_p90_usd: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  expected_drop_usd: number;
  farm_cost_usd: number;
  farm_hours: number;
  net_usd: number;
  net_per_hour_usd: number;
  model: {
    launch_value_usd: number;
    token_odds: number;
    off_list_discount: number;
    growth_pct: number;
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
  group: 'watchlist' | 'early' | 'off-list';
  launch_value_usd: number;
  token_odds: number;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  implied_p10_usd: number;
  implied_p90_usd: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  expected_drop_usd: number;
  net_usd: number;
  net_per_hour_usd: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The validation headline the dashboard's evidence strip states. */
export interface ValidationSummary {
  model: string;
  comparables: number;
  peers: number;
  flat_loo_miss: number;
  flat_wf_miss: number;
  loo_miss: number;
  wf_miss: number;
  wf_expanding_miss: number;
  odds_brier_cv: number;
  odds_brier_base: number;
  odds_brier_wf: number;
  interval_p25_p75_coverage: number;
  interval_p10_p90_coverage: number;
  farm_count: number;
  marginal_count: number;
  skip_count: number;
}

/** How many of the snapshot's protocols fall in each ledger group. */
export interface LedgerCounts {
  'ranked watchlist': number;
  'ranked early': number;
  'ranked off-list': number;
  'token trades': number;
  'token no cap': number;
  bridge: number;
  staked: number;
  exchange: number;
  versioned: number;
  wrapped: number;
  unranked: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  off_list_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  validation: ValidationSummary;
  ledger: LedgerCounts;
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

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The 7-day growth a protocol gets scored on, clamped so one data quirk cannot dominate. */
export function clampedGrowth(p: SnapshotProtocol): number {
  return Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, finite(p.change_7d, 0)));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word `wrapped`, `staked` or `staking` in a name: a wrapped or staked product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Categories that are exchanges, bridges or staking products, never stand-alone launches. */
const STRUCTURAL_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a protocol name must not start with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a bridge, staking product, exchange, versioned pool or wrapped product. */
export function isStructurallyExcluded(p: SnapshotProtocol): boolean {
  if (p.category !== null && STRUCTURAL_CATEGORIES.has(p.category)) return true;
  if (VERSIONED.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  for (const prefix of EXCHANGE_PREFIXES) if (p.name.startsWith(prefix)) return true;
  return false;
}

/** Whether a protocol is one the board may rank: pre-token and stand-alone. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isStructurallyExcluded(p);
}

/** The stand-alone peers the token-odds logit is fit on: everything not structurally excluded. */
export function peerSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => !isStructurallyExcluded(p));
}

/**
 * The category token share for one protocol: among its stand-alone peers in the same category,
 * the fraction that record a token, leaving the protocol itself out. A category with no other
 * peer falls back to the peers' overall token rate.
 */
export function categoryTokenShare(p: SnapshotProtocol, peers: SnapshotProtocol[]): number {
  let total = 0;
  let withToken = 0;
  for (const q of peers) {
    if (q.slug === p.slug) continue;
    if ((q.category ?? 'Unknown') !== (p.category ?? 'Unknown')) continue;
    total += 1;
    if (!isPreToken(q)) withToken += 1;
  }
  if (total === 0) {
    let all = 0;
    let tok = 0;
    for (const q of peers) {
      all += 1;
      if (!isPreToken(q)) tok += 1;
    }
    return all === 0 ? 0 : tok / all;
  }
  return withToken / total;
}

/** The launch value: the fitted log-log curve, exp(intercept + slope * ln(TVL) + category effect). */
export function launchValue(p: SnapshotProtocol): number {
  const effect = CATEGORY_EFFECT[p.category ?? 'Unknown'] ?? 0;
  return Math.exp(LAUNCH_INTERCEPT + LAUNCH_SLOPE * Math.log(p.tvl_usd) + effect);
}

/** The token odds: the fitted logit on age, size, category token share and 7-day growth. */
export function tokenOdds(p: SnapshotProtocol, asOf: string, share: number): number {
  const age = ageDays(asOf, p.listed_at);
  const ageYears = Math.max(age ?? 365, 1) / 365;
  const features = [Math.log(ageYears), Math.log(p.tvl_usd), share, clampedGrowth(p) / 100];
  let z = ODDS_INTERCEPT;
  for (let i = 0; i < 4; i++) z += ODDS_COEF[i]! * ((features[i]! - ODDS_MEAN[i]!) / ODDS_SD[i]!);
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 2500;
  if (p.tvl_usd >= 100_000_000) return 1000;
  return 500;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The priced economics of farming one protocol at the $25-an-hour benchmark. */
export interface FarmEconomics {
  capital: number;
  hold_days: number;
  gas_usd: number;
  capital_charge_usd: number;
  cost_usd: number;
  hours: number;
  expected_drop_usd: number;
  net_usd: number;
  net_per_hour_usd: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
}

export function farmEconomics(p: SnapshotProtocol, age: number | null, implied: number): FarmEconomics {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = hold / 7;
  const gas = 8 + 2 * weeks;
  const capitalCharge = capital * TBILL_RATE * (hold / 365);
  const cost = gas + capitalCharge;
  // Hours are priced, not wished: research once (0.5h), wallet setup once (0.25h), one
  // qualifying action plus a check each week (0.5h/week), claim once (0.25h), unwind once
  // (0.25h). A 30-day hold is ~3.39h, in line with the 1.9–3.4h the leading entries show.
  const hours = 1.25 + weeks * 0.5;
  const expectedDrop = implied * DROP_SHARE;
  const net = expectedDrop - cost;
  const netPerHour = net / hours;
  const verdict: FarmEconomics['verdict'] =
    net > 0 && netPerHour > FARM_HOURLY_BENCHMARK ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP';
  return {
    capital,
    hold_days: hold,
    gas_usd: Math.round(gas * 100) / 100,
    capital_charge_usd: Math.round(capitalCharge * 100) / 100,
    cost_usd: Math.round(cost * 100) / 100,
    hours: Math.round(hours * 100) / 100,
    expected_drop_usd: Math.round(expectedDrop * 100) / 100,
    net_usd: Math.round(net * 100) / 100,
    net_per_hour_usd: Math.round(netPerHour * 100) / 100,
    verdict,
  };
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

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A dollar amount as text: $12.34, or -$12.34 when negative. */
function usd(n: number): string {
  const v = Math.round(n * 100) / 100;
  return v < 0 ? `-$${Math.abs(v).toFixed(2)}` : `$${v.toFixed(2)}`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names, and the last step states the priced verdict at the $25-an-hour benchmark.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, econ: FarmEconomics): FarmStep[] {
  const chain = chainOf(p);
  const capital = econ.capital;
  const hold = econ.hold_days;
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '15 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $8 of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '30 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '15 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
    {
      text: `At the $${FARM_HOURLY_BENCHMARK}-an-hour benchmark this position expects a ${usd(econ.expected_drop_usd)} drop against ${usd(econ.cost_usd)} of costs (gas ${usd(econ.gas_usd)} plus a ${usd(econ.capital_charge_usd)} capital charge), a net of ${usd(econ.net_usd)} over ${econ.hours} hours, ${usd(econ.net_per_hour_usd)} an hour, so the verdict is ${econ.verdict}.`,
      cost: `the ${usd(econ.cost_usd)} above`,
      time: `${econ.hours} hours of work`,
    },
  ];
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** One scored protocol, before ranks are assigned. */
interface Scored {
  p: SnapshotProtocol;
  group: 'watchlist' | 'early' | 'off-list';
  age: number | null;
  launch: number;
  odds: number;
  implied: number;
  econ: FarmEconomics;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const peers = peerSet(snapshot);
  const chosen = new Map<string, Scored>();
  const score = (p: SnapshotProtocol, group: Scored['group']): Scored => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const launch = launchValue(p);
    const odds = tokenOdds(p, snapshot.as_of, categoryTokenShare(p, peers));
    const discount = group === 'off-list' ? OFF_LIST_DISCOUNT : 1;
    const implied = launch * odds * discount;
    return { p, group, age, launch, odds, implied, econ: farmEconomics(p, age, implied) };
  };
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, score(p, 'watchlist'));
  }
  // The off-list: rankable protocols at or above the floor that the house did not watchlist.
  // They are ranked, at half credit, because the house left them off its list.
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug)) continue;
    if (isRankable(p) && p.tvl_usd >= snapshot.floor_usd) chosen.set(p.slug, score(p, 'off-list'));
  }
  // The early radar: rankable protocols below the watchlist floor, every one of them.
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug)) continue;
    if (isRankable(p) && p.tvl_usd < snapshot.floor_usd) chosen.set(p.slug, score(p, 'early'));
  }

  const scored = [...chosen.values()].sort(
    (a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map((s, i) => {
    const discount = s.group === 'off-list' ? OFF_LIST_DISCOUNT : 1;
    const base = s.launch * s.odds * discount;
    return {
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
      group: s.group,
      launch_value_usd: Math.max(1, Math.round(s.launch)),
      token_odds: round4(s.odds),
      implied_value_usd: Math.max(1, Math.round(s.implied)),
      implied_low_usd: Math.max(1, Math.round(base * Math.exp(LOG_Q25 * INTERVAL_SCALE))),
      implied_high_usd: Math.max(1, Math.round(base * Math.exp(LOG_Q75 * INTERVAL_SCALE))),
      implied_p10_usd: Math.max(1, Math.round(base * Math.exp(LOG_Q10 * INTERVAL_SCALE))),
      implied_p90_usd: Math.max(1, Math.round(base * Math.exp(LOG_Q90 * INTERVAL_SCALE))),
      verdict: s.econ.verdict,
      expected_drop_usd: s.econ.expected_drop_usd,
      farm_cost_usd: s.econ.cost_usd,
      farm_hours: s.econ.hours,
      net_usd: s.econ.net_usd,
      net_per_hour_usd: s.econ.net_per_hour_usd,
      model: {
        launch_value_usd: Math.max(1, Math.round(s.launch)),
        token_odds: round4(s.odds),
        off_list_discount: discount,
        growth_pct: clampedGrowth(s.p),
        age_days: s.age,
      },
      farm_steps: farmSteps(s.p, s.age, s.econ).map(stepText),
    };
  });
}

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

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
    group: row.group,
    launch_value_usd: row.launch_value_usd,
    token_odds: row.token_odds,
    implied_value_usd: row.implied_value_usd,
    implied_low_usd: row.implied_low_usd,
    implied_high_usd: row.implied_high_usd,
    implied_p10_usd: row.implied_p10_usd,
    implied_p90_usd: row.implied_p90_usd,
    verdict: row.verdict,
    expected_drop_usd: row.expected_drop_usd,
    net_usd: row.net_usd,
    net_per_hour_usd: row.net_per_hour_usd,
  };
}

/** Which ledger group one protocol falls in: every protocol lands in exactly one group. */
export function ledgerGroup(p: SnapshotProtocol, snapshot: Snapshot): keyof LedgerCounts {
  if (snapshot.watchlist.includes(p.slug)) return 'ranked watchlist';
  if (isRankable(p) && p.tvl_usd >= snapshot.floor_usd) return 'ranked off-list';
  if (isRankable(p)) return 'ranked early';
  if (!isPreToken(p)) return p.mcap_usd !== null ? 'token trades' : 'token no cap';
  if (p.category === 'Bridge' || p.category === 'Canonical Bridge' || p.category === 'Cross Chain Bridge') return 'bridge';
  if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC') return 'staked';
  if (p.category === 'CEX') return 'exchange';
  if (VERSIONED.test(p.name)) return 'versioned';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped';
  return 'unranked';
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const early = board.filter((r) => r.group === 'early').length;
  const offList = board.filter((r) => r.group === 'off-list').length;
  const ledger: LedgerCounts = {
    'ranked watchlist': 0,
    'ranked early': 0,
    'ranked off-list': 0,
    'token trades': 0,
    'token no cap': 0,
    bridge: 0,
    staked: 0,
    exchange: 0,
    versioned: 0,
    wrapped: 0,
    unranked: 0,
  };
  for (const p of snapshot.protocols) ledger[ledgerGroup(p, snapshot)] += 1;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    off_list_size: offList,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
    validation: {
      model: MODEL_VERSION,
      comparables: 88,
      peers: 437,
      flat_loo_miss: 4.9,
      flat_wf_miss: 4.49,
      loo_miss: 3.09,
      wf_miss: 2.45,
      wf_expanding_miss: 2.7,
      odds_brier_cv: 0.215,
      odds_brier_base: 0.248,
      odds_brier_wf: 0.25,
      interval_p25_p75_coverage: 0.52,
      interval_p10_p90_coverage: 0.8,
      farm_count: board.filter((r) => r.verdict === 'FARM').length,
      marginal_count: board.filter((r) => r.verdict === 'MARGINAL').length,
      skip_count: board.filter((r) => r.verdict === 'SKIP').length,
    },
    ledger,
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
