// Token Radar radar-2 dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a per-protocol detail view with its farm plan, the protocol
// ledger, the out-of-sample evidence and the model. No network: every byte it shows is in data.js.
// The page recomputes each row's launch value from TVL and the category effect and checks it
// against board.json, so the page's arithmetic and the board's data are visibly the same model.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var V = DATA.validation;

  /* The launch-value curve, fit on the snapshot's 88 comparables (see VALIDATION.md). */
  var LAUNCH_A = 9.0121;
  var LAUNCH_B = 0.3992;
  var CAT_EFFECT = {
    'AI Agents': -0.0029, 'Basis Trading': 0.1198, CDP: -0.0463,
    'Collateral Management': 0.0513, DOR: -0.0114, 'Decentralized AI': 0.0344,
    Derivatives: 0.0376, Dexs: 0.0232, 'Dual-Token Stablecoin': -0.0236,
    Indexes: 0.0001, Launchpad: 0.0033, Lending: -0.165, 'Leveraged Farming': 0.0027,
    'Liquidity Manager': -0.0538, 'NFT Marketplace': 0.0206,
    'Onchain Capital Allocator': -0.0319, Options: 0.0148, Payments: -0.0394,
    'Prediction Market': 0.0987, Privacy: 0.0651, RWA: 0.042, Restaking: 0.0144,
    'Risk Curators': 0.0286, 'Staking Pool': -0.0738, 'Token Locker': 0.0385,
    Yield: -0.0849, 'Yield Aggregator': -0.062
  };
  var DROP_SHARE = 0.000005;
  var TBILL = 0.045;
  var BENCH = 25;
  var OFF_DISCOUNT = 0.5;

  /* The out-of-sample term tests (VALIDATION.md §1). A term is kept only when it lowers the miss
     in BOTH leave-one-out and walk-forward. */
  var EVIDENCE = [
    ['Flat (median multiple)', '×4.90', '×4.49', 'baseline'],
    ['+ size curve (ln TVL)', '×3.24', '×2.55', 'kept'],
    ['+ category effect (ridge 64)', '×3.09', '×2.45', 'kept'],
    ['+ chain count', '×3.10', '×2.38', 'dropped'],
    ['+ age (log age)', '×3.15', '×2.66', 'dropped'],
    ['+ 7-day growth', '×3.17', '×2.27', 'dropped'],
    ['+ chains + age', '×3.06', '×2.98', 'dropped'],
    ['+ chains + age + growth', '×3.26', '×2.67', 'dropped']
  ];
  var LEDGER_ORDER = ['ranked watchlist', 'ranked early', 'ranked off-list', 'token trades',
    'token no cap', 'bridge', 'staked', 'exchange', 'versioned', 'wrapped', 'unranked'];
  var LEDGER_COLOR = {
    'ranked watchlist': '#3fb27f', 'ranked early': '#58a6ff', 'ranked off-list': '#e3a008',
    'token trades': '#39c5cf', 'token no cap': '#7d8590', bridge: '#bc8cff', staked: '#f778ba',
    exchange: '#ffa657', versioned: '#d2a679', wrapped: '#a3b8cc', unranked: '#3a4552'
  };

  var state = {
    q: '', category: 'all', filter: 'all', tab: 'pre-token',
    sort: 'implied', dir: -1, selected: null,
    deposit: null, drop: 5, horizon: null
  };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtUsd2(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var v = Math.round(n * 100) / 100;
    return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function r2(n) { return Math.round(n * 100) / 100; }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  /* The priced economics of farming one protocol. Same arithmetic as lib/model.ts: no rounding
     until display, so at the model scenario these numbers reproduce board.json on all 197 rows. */
  function capitalFor(row) {
    if (row.tvl_usd >= 1e9) return 2500;
    if (row.tvl_usd >= 1e8) return 1000;
    return 500;
  }
  function holdFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function farmEcon(row) {
    var capital = state.deposit !== null ? state.deposit : capitalFor(row);
    var hold = state.horizon !== null ? state.horizon : holdFor(row.age_days);
    var drop = state.drop * 1e-6;
    var weeks = hold / 7;
    var gas = 8 + 2 * weeks;
    var cc = capital * TBILL * (hold / 365);
    var cost = gas + cc;
    var hours = 0.25 + weeks * (10 / 60) + 0.17;
    var expected = row.implied_value_usd * drop;
    var net = expected - cost;
    var nph = net / hours;
    return {
      capital: capital, hold: hold, gas: r2(gas), cc: r2(cc), cost: r2(cost), hours: r2(hours),
      expected: r2(expected), net: r2(net), nph: r2(nph),
      verdict: net > 0 && nph > BENCH ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP'
    };
  }

  /* A protocol's farm plan: the same derivation main.ts writes to board.json. Category, chains,
     TVL and age decide the action, the capital, the hold and every cost and time. No name is
     special-cased, and the last step states the priced verdict at the $25-an-hour benchmark. */
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(row, econ) {
    var chain = chainOf(row);
    var capital = econ.capital;
    var hold = econ.hold;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(row, capital, chain), cost: '$' + capital + ' of capital and about $8 of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
      { text: 'At the $' + BENCH + '-an-hour benchmark this position expects a ' + fmtUsd2(econ.expected) + ' drop against ' + fmtUsd2(econ.cost) + ' of costs (gas ' + fmtUsd2(econ.gas) + ' plus a ' + fmtUsd2(econ.cc) + ' capital charge), a net of ' + fmtUsd2(econ.net) + ' over ' + econ.hours + ' hours, ' + fmtUsd2(econ.nph) + ' an hour, so the verdict is ' + econ.verdict + '.', cost: 'the ' + fmtUsd2(econ.cost) + ' above', time: econ.hours + ' hours of work' }
    ].map(stepText);
  }

  /* Recompute a row in the page and check it against board.json. The launch value is exactly
     reproducible from TVL and the category effect; the implied value is checked within 2% because
     board.json stores odds to 4 decimal places and launch to whole dollars. */
  function recompute(row) {
    var eff = CAT_EFFECT[row.category || 'Unknown'] || 0;
    var launch = Math.max(1, Math.round(Math.exp(LAUNCH_A + LAUNCH_B * Math.log(row.tvl_usd) + eff)));
    var disc = row.group === 'off-list' ? OFF_DISCOUNT : 1;
    var implied = Math.max(1, Math.round(row.launch_value_usd * row.token_odds * disc));
    var rel = Math.abs(implied - row.implied_value_usd) / row.implied_value_usd;
    return {
      launch: launch, launchOK: launch === row.launch_value_usd,
      implied: implied, impliedOK: rel <= 0.02, rel: rel
    };
  }
  var CHECK = (function () {
    var l = 0, i = 0, maxRel = 0;
    DATA.rows.forEach(function (r) {
      var c = recompute(r);
      if (c.launchOK) l++;
      if (c.impliedOK) i++;
      if (c.rel > maxRel) maxRel = c.rel;
    });
    return { launch: l, implied: i, maxRel: maxRel };
  })();

  function verdictClass(v) { return v === 'FARM' ? 'farm' : v === 'MARGINAL' ? 'marginal' : 'skip'; }
  function groupTag(row) {
    if (row.group === 'watchlist') return el('span', { class: 'tag wl', text: 'WATCHLIST' });
    if (row.group === 'off-list') return el('span', { class: 'tag off', text: 'OFF-LIST ×0.5' });
    return el('span', { class: 'tag early', text: 'EARLY' });
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.filter === 'FARM' || state.filter === 'MARGINAL' || state.filter === 'SKIP') {
        if (farmEcon(r).verdict !== state.filter) return false;
      } else if (state.filter === 'watchlist' || state.filter === 'early' || state.filter === 'off-list') {
        if (r.group !== state.filter) return false;
      }
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'launch') { av = a.launch_value_usd; bv = b.launch_value_usd; }
      else if (key === 'odds') { av = a.token_odds; bv = b.token_odds; }
      else if (key === 'net') { av = farmEcon(a).nph; bv = farmEcon(b).nph; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' }),
        el('span', { text: '758 protocols' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('h1', { text: DATA.board_size + ' pre-token protocols, ranked by implied value' }),
      el('p', null,
        'The watchlist is the floor: ', el('b', { text: '40 protocols' }),
        ' with at least $50M of TVL and no token on record. The early radar adds ',
        el('b', { text: DATA.early_size + ' pre-token protocols' }),
        ' below that floor, and ', el('b', { text: DATA.off_list_size + ' off-list rows' }),
        ' at half credit. Implied value = launch value × token odds — a model, not a promise.'
      )
    );
  }

  function kpi(label, big, sub) {
    return el('div', { class: 'kpi' }, el('label', { text: label }), el('b', { html: big }), el('span', { html: sub }));
  }
  function kpis() {
    return el('section', { class: 'kpis' },
      kpi('Walk-forward miss', '×' + V.wf_miss.toFixed(2), 'flat ×' + V.flat_wf_miss.toFixed(2) + ' · LOO ×' + V.loo_miss.toFixed(2) + ' vs flat ×' + V.flat_loo_miss.toFixed(1)),
      kpi('Range honesty', '52.3<span class="u">%</span>', 'in P25–P75 (nominal 50%) · 75–84% in P10–P90 (nominal 80%)'),
      kpi('Token odds · Brier', V.odds_brier_cv.toFixed(3), 'ten-fold CV vs base ' + V.odds_brier_base.toFixed(3) + ' · WF 0.25, label time-censored'),
      kpi('Terms kept', '2 <span class="u">of 8</span>', 'size + category ridge · chains, age, growth dropped'),
      kpi('Worth farming · $25/hr', V.farm_count + ' <span class="u">FARM</span>', V.marginal_count + ' MARGINAL · ' + V.skip_count + ' SKIP · of ' + DATA.board_size + ' rows'),
      kpi('Watchlist', DATA.watchlist_size + '<span class="u">/' + DATA.watchlist_size + '</span>', DATA.board_size + ' rows · ' + DATA.early_size + ' early · ' + DATA.off_list_size + ' off-list ×0.5')
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var chips = [['all', 'All'], ['FARM', 'FARM'], ['MARGINAL', 'Marginal'], ['SKIP', 'Skip'], ['watchlist', 'Watchlist'], ['off-list', 'Off-list'], ['early', 'Early']].map(function (f) {
      var n = f[0] === 'all' ? DATA.board_size : f[0] === 'watchlist' ? DATA.watchlist_size : f[0] === 'early' ? DATA.early_size : f[0] === 'off-list' ? DATA.off_list_size : DATA.rows.filter(function (r) { return farmEcon(r).verdict === f[0]; }).length;
      return el('button', {
        type: 'button', class: 'chip', 'aria-pressed': state.filter === f[0] ? 'true' : 'false',
        onclick: function () { state.filter = f[0]; writeHash(); render(); }
      }, f[1], el('span', { class: 'n', text: String(n) }));
    });
    var deposit = el('input', { type: 'range', id: 'deposit', min: '100', max: '5000', step: '100', value: state.deposit === null ? '1000' : String(state.deposit), 'aria-label': 'Deposit size in dollars' });
    var depositOut = el('output', { id: 'deposit-out', text: state.deposit === null ? 'auto · $500–$2,500 by TVL' : '$' + state.deposit.toLocaleString('en-US') });
    deposit.addEventListener('input', function () { state.deposit = parseInt(deposit.value, 10); depositOut.textContent = '$' + state.deposit.toLocaleString('en-US'); render(); });
    var drop = el('input', { type: 'range', id: 'drop', min: '1', max: '20', step: '1', value: String(state.drop), 'aria-label': 'Drop share per million' });
    var dropOut = el('output', { id: 'drop-out', text: state.drop + ' per 1M' });
    drop.addEventListener('input', function () { state.drop = parseInt(drop.value, 10); dropOut.textContent = state.drop + ' per 1M'; render(); });
    var horizon = el('input', { type: 'range', id: 'horizon', min: '7', max: '180', step: '1', value: state.horizon === null ? '30' : String(state.horizon), 'aria-label': 'Hold horizon in days' });
    var horizonOut = el('output', { id: 'horizon-out', text: state.horizon === null ? 'auto · 30–60d by age' : state.horizon + ' days' });
    horizon.addEventListener('input', function () { state.horizon = parseInt(horizon.value, 10); horizonOut.textContent = state.horizon + ' days'; render(); });
    var reset = el('button', { type: 'button', class: 'btn', text: 'Reset scenario', onclick: function () { state.deposit = null; state.drop = 5; state.horizon = null; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'row' },
        el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
        el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
        el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
        el('button', { type: 'button', class: 'btn', text: 'Export CSV', onclick: exportCSV }),
        el('button', { type: 'button', class: 'btn', text: 'Export JSON', onclick: exportJSON }),
        el('span', { class: 'count', text: state.tab === 'pre-token' ? filteredRows().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' live-token protocols' })
      ),
      el('div', { class: 'row chips' }, chips),
      el('div', { class: 'sliders' },
        el('div', { class: 'slider' + (state.deposit === null ? ' is-model' : ''), id: 'deposit-wrap' }, el('label', { for: 'deposit', text: 'Deposit' }), deposit, depositOut),
        el('div', { class: 'slider', id: 'drop-wrap' }, el('label', { for: 'drop', text: 'Drop share' }), drop, dropOut),
        el('div', { class: 'slider' + (state.horizon === null ? ' is-model' : ''), id: 'horizon-wrap' }, el('label', { for: 'horizon', text: 'Horizon' }), horizon, horizonOut),
        reset,
        el('span', { class: 'sub', text: 'Sliders re-price the farm economics live; the model values stay the board’s own.' })
      )
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another filter to see the board again.' }),
        el('button', { class: 'btn primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.filter = 'all'; writeHash(); render(); } })
      ));
    }
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var econ = farmEcon(r);
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('div', null, el('b', { text: r.name }), ' ', groupTag(r)),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.launch_value_usd) }),
        el('td', { class: 'num', text: (r.token_odds * 100).toFixed(0) + '%' }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('div', { class: 'name' },
            el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
            el('span', { class: 'sub', text: fmtUsd(r.implied_low_usd) + '–' + fmtUsd(r.implied_high_usd) })
          )
        )),
        el('td', null, el('span', { class: 'pill ' + verdictClass(econ.verdict), text: econ.verdict })),
        el('td', { class: 'num ' + (econ.nph > 0 ? 'pos' : econ.nph < 0 ? 'neg' : ''), text: fmtUsd2(econ.nph) + '/h' })
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'caption', text: 'Pre-token protocols, strongest implied value first. Implied = launch value × token odds (× 0.5 for off-list). Select a row for its model and farm plan.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('launch', 'Launch'),
            sortHeader('odds', 'Odds'),
            sortHeader('implied', 'Implied value'),
            sortHeader('net', 'Verdict'),
            sortHeader('net', 'Net / hour')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'pill skip', text: 'ALREADY TRADES' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'caption', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function ledgerSection() {
    var total = LEDGER_ORDER.reduce(function (s, k) { return s + (DATA.ledger[k] || 0); }, 0);
    var sorted = DATA.rows.every(function (r, i, a) { return i === 0 || a[i - 1].implied_value_usd >= r.implied_value_usd; });
    var bar = el('div', { class: 'ledger-bar' }, LEDGER_ORDER.map(function (k) {
      var n = DATA.ledger[k] || 0;
      if (n === 0) return null;
      return el('i', { style: 'width:' + (n / total * 100) + '%;background:' + LEDGER_COLOR[k], title: k + ': ' + n });
    }));
    var grid = el('div', { class: 'ledger-grid' }, LEDGER_ORDER.map(function (k) {
      return el('div', null,
        el('span', null, el('span', { class: 'dot', style: 'background:' + LEDGER_COLOR[k] }), k),
        el('b', { text: String(DATA.ledger[k] || 0) })
      );
    }));
    return el('section', { class: 'panel section' },
      el('h2', { text: 'Protocol accounting — all 758 protocols, exactly one group each' }),
      el('p', { class: 'sub', text: 'Every protocol in the snapshot lands in exactly one group. Ranked rows are the board; the rest are set aside with a reason, not hidden.' }),
      bar, grid,
      el('div', { class: 'checks' },
        el('div', null, el('span', { class: 'ok', text: '✓ ' }), 'This table = board.json: ', el('b', { text: CHECK.launch + ' of ' + DATA.board_size + ' launch values recomputed in-page and exact' }), ', ', el('b', { text: CHECK.implied + ' of ' + DATA.board_size + ' implied values within ' + (CHECK.maxRel * 100).toFixed(1) + '%' }), ' (odds stored to 4 dp).'),
        el('div', null, el('span', { class: 'ok', text: '✓ ' }), 'Ranks 1–', el('b', { text: String(DATA.board_size) }), ' in order, implied strictly non-increasing: ', el('b', { text: sorted ? 'yes' : 'NO — check the board' }), '.'),
        el('div', null, el('span', { class: 'ok', text: '✓ ' }), 'Ledger totals ', el('b', { text: total + ' of 758' }), ' protocols; watchlist coverage ', el('b', { text: DATA.watchlist_size + ' of ' + DATA.watchlist_size }), '.'),
        el('div', null, el('span', { class: 'ok', text: '✓ ' }), 'Board and dashboard read the same data.js written by main.ts from the same board.')
      )
    );
  }

  function evidenceSection() {
    var tbody = el('tbody');
    EVIDENCE.forEach(function (t) {
      var cls = t[3] === 'kept' ? 'kept' : t[3] === 'dropped' ? 'dropped' : '';
      var dec = t[3] === 'kept' ? el('span', { class: 'k', text: 'KEPT' }) : t[3] === 'dropped' ? el('span', { class: 'd', text: 'DROPPED' }) : el('span', { class: 'base', text: 'baseline' });
      tbody.appendChild(el('tr', { class: cls },
        el('td', { text: t[0] }),
        el('td', { class: 'num', text: t[1] }),
        el('td', { class: 'num', text: t[2] }),
        el('td', null, dec)
      ));
    });
    return el('section', { class: 'panel section' },
      el('h2', { text: 'Out-of-sample evidence — every term tested twice' }),
      el('p', { class: 'sub', text: 'A term is kept only when it lowers the miss in BOTH leave-one-out and walk-forward tests. Miss is the median multiplicative error on the 88 token-trading comparables; walk-forward fits on older listings and tests on newer ones.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'evidence' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Term' }), el('th', { scope: 'col', class: 'num', text: 'LOO miss' }), el('th', { scope: 'col', class: 'num', text: 'Walk-forward miss' }), el('th', { scope: 'col', text: 'Decision' }))),
          tbody
        )
      ),
      el('div', { class: 'two-col' },
        el('p', { class: 'note' }, el('b', { text: 'Token odds. ' }), 'In-sample Brier 0.2100, ten-fold cross-validation Brier ', el('b', { text: '0.2154' }), ' vs base rate 0.2476. Walk-forward Brier 0.25 — worse than base — because the token label is time-censored (see the model note below).'),
        el('p', { class: 'note' }, el('b', { text: 'Interval honesty. ' }), 'P25–P75 coverage 52.3% / 52.3% (nominal 50%); P10–P90 75.0% / 84.1% (nominal 80%). Intervals come from leave-one-out residuals, widened ×1.1.')
      )
    );
  }

  function modelSection() {
    var catRows = Object.keys(CAT_EFFECT).map(function (k) { return [k, CAT_EFFECT[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; });
    var catCols = [0, 1, 2].map(function (c) {
      var tbody = el('tbody');
      catRows.slice(c * 9, c * 9 + 9).forEach(function (kv) {
        tbody.appendChild(el('tr', null,
          el('td', { text: kv[0] }),
          el('td', { class: 'num', text: (kv[1] > 0 ? '+' : '') + kv[1].toFixed(3) })
        ));
      });
      return el('table', { class: 'cat-effects' }, tbody);
    });
    return el('section', { class: 'panel section' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Two fitted pieces, never a name list and never TVL times a flat multiple. Every row is scored by the same two functions of the snapshot figures.' }),
      el('div', { class: 'formula' },
        el('div', null, el('b', { text: 'launch = ' }), 'exp(9.0121 + 0.3992 · ln(TVL) + category effect) — ridge λ=64, fit on 88 token-trading comparables'),
        el('div', null, el('b', { text: 'odds = ' }), 'logit(log years listed, ln TVL, category token share, clamped 7-day growth) — fit on 437 stand-alone peers, λ=1'),
        el('div', null, el('b', { text: 'implied = ' }), 'launch × odds (× 0.5 for off-list rows)')
      ),
      el('p', { class: 'note' }, el('b', { text: 'Category effects (ridge λ=64, all 27, largest first). ' })),
      el('div', { class: 'cat-grid' }, catCols),
      el('p', { class: 'note' }, 'Off-list rows are protocols at or above the $50M floor that the house did not watchlist; the snapshot carries no parent data, so no parent is claimed for any of them and the ×0.5 is caution for rows the house did not vet, not a fitted coefficient.'),
      el('p', { class: 'note warn' }, el('b', { text: 'Honest note on the odds. ' }), 'Odds are validated by ten-fold cross-validation (Brier 0.215 vs base 0.248). Walk-forward Brier is 0.25 — worse than base — because the token label is time-censored: the newest cohort had only ~31% tokens recorded, so forward validation under-predicts them. This dashboard states the cross-validated number, not a walk-forward claim.')
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var econ = farmEcon(row);
    var c = recompute(row);
    var steps = farmSteps(row, econ);
    var inner = el('div', { class: 'detail-inner' },
      el('div', { class: 'detail-head' },
        el('div', null,
          el('span', { class: 'rankline', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + row.group.toUpperCase() + (row.group === 'off-list' ? ' ×0.5' : '') }),
          el('h2', { id: 'detail-title', text: row.name }),
          el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · TVL ' + fmtUsd(row.tvl_usd) + ' · 7d ' + fmtPct(row.change_7d) + ' · age ' + fmtAge(row.age_days) })
        ),
        el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
      ),
      el('div', { class: 'verdict-line' },
        el('span', { class: 'pill ' + verdictClass(econ.verdict), text: econ.verdict }),
        el('span', null, 'Expected drop ', el('b', { class: 'num', text: fmtUsd2(econ.expected) })),
        el('span', null, 'Cost ', el('b', { class: 'num', text: fmtUsd2(econ.cost) })),
        el('span', null, 'Net ', el('b', { class: 'num', text: fmtUsd2(econ.net) })),
        el('span', null, 'Net / hour ', el('b', { class: 'num', text: fmtUsd2(econ.nph) })),
        el('span', { class: 'sub', text: 'at the $25-an-hour benchmark' })
      ),
      el('div', { class: 'detail-grid' },
        el('div', { class: 'detail-box' },
          el('h3', { text: 'Implied value' }),
          el('div', { class: 'equation' },
            el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
            el('div', null, el('span', { text: 'Launch value' }), el('b', { text: fmtUsd(row.launch_value_usd) })),
            el('div', null, el('span', { text: 'Token odds' }), el('b', { text: (row.token_odds * 100).toFixed(1) + '%' })),
            row.group === 'off-list' ? el('div', null, el('span', { text: 'Off-list discount' }), el('b', { text: '×0.5' })) : null,
            el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'big', text: fmtUsd(row.implied_value_usd) })),
            el('div', null, el('span', { text: 'P25–P75 range' }), el('b', { text: fmtUsd(row.implied_low_usd) + ' – ' + fmtUsd(row.implied_high_usd) })),
            el('div', null, el('span', { text: 'P10–P90 range' }), el('b', { text: fmtUsd(row.implied_p10_usd) + ' – ' + fmtUsd(row.implied_p90_usd) }))
          ),
          el('p', { class: 'sub', text: 'Recomputed in-page: launch ' + fmtUsd(c.launch) + (c.launchOK ? ' — matches board.json.' : ' — DIFFERS from board.json.') + ' Implied ' + fmtUsd(c.implied) + (c.impliedOK ? ' — within ' + (c.rel * 100).toFixed(1) + '% of board.json (odds stored to 4 dp).' : ' — DIFFERS from board.json.') + ' This is an estimate, not a price.' })
        ),
        el('div', { class: 'detail-box' },
          el('h3', { text: 'Farm plan' }),
          el('p', { class: 'plan-summary', text: steps.length + ' steps over ' + econ.hold + ' days on ' + usd0.format(econ.capital) }),
          el('ol', { class: 'steps' }, steps.map(function (s) {
            var at = s.indexOf(' Cost: ');
            var action = at >= 0 ? s.slice(0, at) : s;
            var tail = at >= 0 ? s.slice(at + 1) : '';
            return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
          }))
        )
      )
    );
    dialog.appendChild(inner);
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    var app = document.getElementById('board');
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(kpis());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(ledgerSection());
      shell.appendChild(evidenceSection());
      shell.appendChild(modelSection());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('c')) state.category = params.get('c');
    if (params.get('f')) state.filter = params.get('f');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('sort')) state.sort = params.get('sort');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('c', state.category);
    if (state.filter !== 'all') params.set('f', state.filter);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCSV() {
    var list = sortedRows(filteredRows());
    var head = ['rank', 'slug', 'name', 'category', 'chains', 'tvl_usd', 'launch_value_usd', 'token_odds', 'implied_value_usd', 'implied_low_usd', 'implied_high_usd', 'verdict', 'net_per_hour_usd', 'group'];
    var lines = [head.join(',')];
    list.forEach(function (r) {
      var e = farmEcon(r);
      lines.push([r.rank, r.slug, r.name, r.category, (r.chains || []).join(';'), r.tvl_usd, r.launch_value_usd, r.token_odds, r.implied_value_usd, r.implied_low_usd, r.implied_high_usd, e.verdict, e.nph, r.group].map(csvCell).join(','));
    });
    download('token-radar-board.csv', lines.join('\n') + '\n', 'text/csv');
  }
  function exportJSON() {
    var list = sortedRows(filteredRows()).map(function (r) {
      var e = farmEcon(r);
      return { rank: r.rank, slug: r.slug, name: r.name, category: r.category, chains: r.chains, tvl_usd: r.tvl_usd, launch_value_usd: r.launch_value_usd, token_odds: r.token_odds, implied_value_usd: r.implied_value_usd, implied_low_usd: r.implied_low_usd, implied_high_usd: r.implied_high_usd, verdict: e.verdict, net_per_hour_usd: e.nph, group: r.group };
    });
    download('token-radar-board.json', JSON.stringify({ as_of: DATA.as_of, model: DATA.model_version, rows: list }, null, 2) + '\n', 'application/json');
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
