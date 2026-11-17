// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a sortable and filterable table, a per-protocol detail view with the
// model's own working and the protocol's farm plan, the live-token set and the peer multiples.
// No network: every byte it shows is in data.js. The page recomputes each row's implied value
// from the snapshot figures, so the code and board.json visibly agree.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var WATCH = {};
  (DATA.watchlist || []).forEach(function (s) { WATCH[s] = true; });

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
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
  function fmtMult(n) { return 'x' + n.toFixed(2); }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are the same arithmetic.
  // implied = tvl x peerMultiple x growthMult x maturityMult x chainMult, each from the row.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chains = Math.max(1, (row.chains || []).length);
    var chainMult = 1 + model.chain_step * Math.min(chains - 1, model.chain_max_bonus);
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * growthMult * maturity * chainMult));
  }

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
      else if (typeof child === 'string' || typeof child === 'number') node.appendChild(document.createTextNode(String(child)));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category family, chains,
  // TVL and age decide the action, the capital, the hold and every cost and time. No name is
  // special-cased, so the plan the page shows is the plan board.json carries.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function familyOf(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'lending';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'dex';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return 'yield';
    if (c.indexOf('bridge') >= 0) return 'bridge';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'staking';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'perps';
    if (c.indexOf('rwa') >= 0) return 'rwa';
    if (c.indexOf('stable') >= 0) return 'stable';
    if (c.indexOf('prediction') >= 0) return 'prediction';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('index') >= 0) return 'curator';
    if (c.indexOf('insurance') >= 0) return 'insurance';
    if (c.indexOf('launchpad') >= 0) return 'launchpad';
    if (c.indexOf('payment') >= 0) return 'payments';
    return 'other';
  }
  function coreAction(family, p, capital, chain) {
    var name = p.name;
    if (family === 'lending') return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', then borrow $20 of USDC against it and repay the borrow within the week.';
    if (family === 'dex') return 'Provide $' + capital + ' of liquidity to ' + name + "'s main USDC pair on " + chain + ' and make one swap through the pool each week.';
    if (family === 'yield') return 'Deposit $' + capital + ' of USDC into ' + name + "'s main vault on " + chain + ' and claim or compound the yield it pays each week.';
    if (family === 'bridge') return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ', then use the bridged funds in one app on the destination chain.';
    if (family === 'staking') return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and hold the receipt token it issues.';
    if (family === 'perps') return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ' and open one small long and one small short over the week.';
    if (family === 'rwa') return 'Mint $' + capital + ' of ' + name + "'s yield-bearing asset on " + chain + ' and hold it in the farming wallet.';
    if (family === 'stable') return 'Mint $' + capital + ' of the stable asset through ' + name + ' on ' + chain + " and hold it, or supply it to the protocol's own pool.";
    if (family === 'prediction') return 'Fund $' + capital + ' on ' + name + ' on ' + chain + ' and place one small position in an active market each week.';
    if (family === 'curator') return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares in the farming wallet.';
    if (family === 'insurance') return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active for the whole farming window.';
    if (family === 'launchpad') return 'Stake $' + capital + ' of the launchpad\'s qualifying asset on ' + name + ' on ' + chain + ' and join one sale or allocation round.';
    if (family === 'payments') return 'Send $' + capital + ' of USDC through ' + name + ' on ' + chain + ' in two or three real payments over the month.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + " and use the protocol's main feature once a week.";
  }
  function weeklyAction(family, p) {
    var name = p.name;
    if (family === 'lending') return 'Once a week, adjust the position on ' + name + ': add $10 of collateral, borrow $5, or repay $5, so the wallet shows steady use.';
    if (family === 'dex') return 'Once a week, swap $10 through ' + name + "'s pool and add or remove $5 of liquidity, so the wallet shows steady use.";
    if (family === 'yield') return 'Once a week, claim the vault yield on ' + name + ' or top the deposit up by $10, so the wallet shows steady use.';
    if (family === 'bridge') return 'Once a week, bridge $10 through ' + name + ' and use it on the destination chain, so the wallet shows steady use.';
    if (family === 'staking') return 'Once a week, restake the rewards ' + name + ' pays or top the stake up by $10, so the wallet shows steady use.';
    if (family === 'perps') return 'Once a week, open and close one small trade on ' + name + ' with $10 of margin, so the wallet shows steady use.';
    if (family === 'rwa') return 'Once a week, check the asset\'s yield on ' + name + ' and mint or redeem $10, so the wallet shows steady use.';
    if (family === 'stable') return 'Once a week, mint or redeem $10 of the stable asset on ' + name + ', so the wallet shows steady use.';
    if (family === 'prediction') return 'Once a week, place one small position in a new market on ' + name + ', so the wallet shows steady use.';
    if (family === 'curator') return 'Once a week, check the vault\'s allocation on ' + name + ' and add $10, so the wallet shows steady use.';
    if (family === 'insurance') return 'Once a week, review the cover on ' + name + ' and renew or extend it before it lapses, so the wallet shows steady use.';
    if (family === 'launchpad') return 'Once a week, check ' + name + ' for a new sale and keep the qualifying stake topped up by $10.';
    if (family === 'payments') return 'Once a week, make one real payment of $10 through ' + name + ', so the wallet shows steady use.';
    return 'Once a week, use ' + name + "'s main feature with $10, so the wallet shows steady use.";
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var second = p.chains && p.chains.length > 1 ? p.chains[1] : null;
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var family = familyOf(p);
    var gas = capital >= 150 ? 8 : 4;
    var secondStep = second
      ? { text: 'Repeat the core position on ' + second + ' with $25: ' + (family === 'bridge' ? 'bridge $25 there through ' + p.name + ' and use it in one app' : 'open the same kind of position on ' + second + ' so the wallet is active on two chains') + '.', cost: '$25 of capital and about $5 of gas', time: '20 minutes' }
      : { text: 'Open a second, smaller position of $25 in another pool or vault on ' + p.name + ' so the wallet touches more than one part of the protocol.', cost: '$25 of capital and about $3 of gas', time: '20 minutes' };
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: coreAction(family, p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: weeklyAction(family, p), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      secondStep,
      { text: 'Hold every position for at least ' + hold + ' days so the activity is counted in more than one snapshot, and check the protocol\'s own points or rewards page weekly.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Before you withdraw, claim only from the link the protocol itself publishes, never from a link in a message or a search result. Write the wallet, the dates and every transaction in a farm log.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
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
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.peer_multiple; bv = b.peer_multiple; }
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
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Watchlist floor ', el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M TVL' })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function hero() {
    var top = DATA.rows[0];
    return el('section', { class: 'hero' },
      el('div', null,
        el('div', { class: 'kicker', text: 'Pre-token protocols · ranked by implied value' }),
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by what their token could be worth' }),
        el('p', null,
          'The watchlist is the floor: every protocol with at least $', el('b', { text: Math.round(DATA.floor_usd / 1e6) + 'M' }),
          ' of TVL and no token on record. The early radar adds ', el('b', { text: String(DATA.early_size) }),
          ' pre-token protocols below that floor, found the same way. Implied value is a model of the snapshot figures, not a promise — and not a prediction that a token is coming.'
        )
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Watchlist covered' }), el('b', null, DATA.watchlist_size, ' / ', el('em', { text: String(DATA.watchlist_size) }))),
        el('div', { class: 'stat' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Top implied value' }), el('b', { text: top ? fmtUsd(top.implied_value_usd) : 'n/a' })),
        el('div', { class: 'stat' }, el('span', { text: 'Global peer multiple' }), el('b', { text: fmtMult(DATA.global_multiple) })),
        el('div', { class: 'stat' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var selectCat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    selectCat.addEventListener('change', function () { state.category = selectCat.value; writeHash(); render(); });
    var selectChain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    selectChain.addEventListener('change', function () { state.chain = selectChain.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), selectCat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), selectChain),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var max = 0;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        class: r.rank <= 3 ? 'top3' : null,
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', null, el('span', { class: 'rank-badge', text: String(r.rank) })),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }),
          WATCH[r.slug] ? el('span', { class: 'watch', text: 'watchlist' }) : null
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.peer_multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'pill', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('multiple', 'Multiple'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
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
        el('td', { class: 'num', text: r.mcap_usd && r.tvl_usd ? fmtMult(r.mcap_usd / r.tvl_usd) : 'n/a' }),
        el('td', null, el('span', { class: 'pill live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their market-cap/TVL ratios are the peer multiples the model prices with.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var peers = DATA.peers.slice(0, 12);
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row, from the snapshot figures alone. No protocol name is special-cased and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ', el('b', { text: 'peer multiple' }), ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + 0.03 x min(chains - 1, 5)) )'
      ),
      el('p', { class: 'sub', text: 'The peer multiple is the median market-cap/TVL of the live-token protocols in the same category (at least ' + m.min_peers + ' peers), clamped to ' + m.multiple_floor + '–' + m.multiple_cap + '; a category with too few peers uses the global median of ' + fmtMult(DATA.global_multiple) + '. Age is the time since the protocol was first listed — how long it has run with no token on record; an unlisted age uses ' + m.unknown_age_days + ' days. Growth is the seven-day TVL change, clamped so one wild week cannot set the price.' }),
      el('h3', { text: 'Peer multiples by category' }),
      el('div', { class: 'peer-grid' }, peers.map(function (p) {
        return el('div', { class: 'peer' }, el('span', { text: p.category }), el('b', { text: fmtMult(p.multiple) }), el('small', { text: p.peers + ' peers' }));
      })),
      el('p', { class: 'sub', text: 'Showing the ' + peers.length + ' largest peer groups of ' + DATA.peers.length + ' priced categories. The live-token table above is the source of every multiple.' })
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
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var agrees = recomputed === row.implied_value_usd;
    var chainNote = (row.chains || []).length > 1
      ? ' It runs on ' + row.chains.length + ' chains (' + row.chains.slice(0, 3).join(', ') + (row.chains.length > 3 ? ', and more' : '') + '), which lifts the value by ' + fmtMult(row.chain_multiplier) + '.'
      : ' It runs on one chain, so the chain factor is 1.00.';
    var peerNote = row.peer_source === 'global'
      ? ' The ' + (row.category || 'Other') + ' category has too few live-token peers to price itself, so the global median multiple of ' + fmtMult(DATA.global_multiple) + ' is used.'
      : ' The multiple is the median market-cap/TVL of the live-token ' + (row.category || 'Other') + ' protocols.';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (WATCH[row.slug] ? ' · watchlist' : ' · early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — the working' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: row.peer_source === 'global' ? 'Peer multiple (global median)' : 'Peer multiple (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: fmtMult(row.peer_multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: fmtMult(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Chain multiplier' }), el('b', { class: 'num', text: fmtMult(row.chain_multiplier) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'why', text: 'Why this rank: ' + row.name + ' holds ' + fmtUsd(row.tvl_usd) + ' of TVL, priced at the ' + (row.category || 'Other') + ' peer multiple of ' + fmtMult(row.peer_multiple) + ', with seven-day growth of ' + fmtPct(row.change_7d) + ' and ' + fmtAge(row.age_days) + ' of age with no token on record.' + chainNote + peerNote }),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (agrees ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price, and not a prediction that a token is coming.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Data: ' + DATA.source + '. Snapshot date ' + DATA.as_of + '. "No token" means the snapshot records no token for the protocol — the record is not proof that none exists.' }),
      el('p', { text: 'Implied value is this entry\u2019s model of the snapshot figures: TVL, seven-day growth, age with no token on record, and chain count, priced at the category peer multiple. It is not a price, not a prediction, and not financial advice.' })
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
