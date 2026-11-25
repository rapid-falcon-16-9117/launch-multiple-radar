// Launch Multiple Radar — the board page. Everything it shows comes from
// window.RADAR (data.js, written by main.ts from the same board the gate
// checks): no network, no framework, no state beyond the URL hash.

(function () {
  'use strict';
  var DATA = window.RADAR;
  var rows = DATA.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    stats: $('stats'), multiples: $('multiples'), q: $('q'), cat: $('cat'),
    chain: $('chain'), sort: $('sort'), watch: $('watch'), count: $('count'),
    tbody: $('rows'), empty: $('empty'), detail: $('detail'),
    asof: $('asof'), scanned: $('scanned')
  };

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function moneyFull(n) { return '$' + n.toLocaleString('en-US'); }
  function pct(x) {
    if (x === null || x === undefined) return '<span class="flat">—</span>';
    var v = x.toFixed(1);
    var cls = x > 0.05 ? 'pos' : x < -0.05 ? 'neg' : 'flat';
    return '<span class="' + cls + '">' + (x > 0 ? '+' : '') + v + '%</span>';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* — masthead stats and the learned multiples — */
  els.stats.innerHTML =
    '<div><dt>Protocols scanned</dt><dd>' + DATA.total_protocols + '</dd></div>' +
    '<div><dt>Record no token</dt><dd>' + DATA.pre_token + '</dd></div>' +
    '<div><dt>On the board</dt><dd>' + DATA.board_size + '</dd></div>' +
    '<div><dt>Median multiple</dt><dd>' + DATA.global_multiple.toFixed(2) + '×</dd></div>';
  els.asof.textContent = DATA.as_of;
  var watchCount = rows.filter(function (r) { return r.watchlist; }).length;
  els.scanned.textContent = DATA.trading + ' protocols already trade and are set aside; the ' +
    DATA.board_size + ' below record no token, with the full watchlist of ' + watchCount + ' included';

  var mults = Object.keys(DATA.category_multiples).map(function (k) {
    return [k, DATA.category_multiples[k]];
  }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 14);
  els.multiples.innerHTML = mults.map(function (m) {
    return '<span class="chip">' + esc(m[0]) + ' <b>' + m[1].toFixed(2) + '×</b></span>';
  }).join('');

  /* — filter option lists, built from the data itself — */
  var cats = {}, chains = {};
  rows.forEach(function (r) {
    if (r.category) cats[r.category] = 1;
    r.chains.forEach(function (c) { chains[c] = 1; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; els.cat.appendChild(o);
  });
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; els.chain.appendChild(o);
  });

  var selected = null;

  function visible() {
    var q = els.q.value.trim().toLowerCase();
    var cat = els.cat.value, chain = els.chain.value, watchOnly = els.watch.checked;
    var out = rows.filter(function (r) {
      if (watchOnly && !r.watchlist) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    });
    var mode = els.sort.value;
    var key = {
      rank: function (r) { return -r.implied_value_usd; },
      tvl: function (r) { return -r.tvl_usd; },
      change: function (r) { return -(r.change_7d === null ? -Infinity : r.change_7d); },
      multiple: function (r) { return -r.multiple; },
      age: function (r) { return -(r.age_days === null ? -1 : r.age_days); }
    }[mode];
    out.sort(function (a, b) { return key(a) - key(b) || a.rank - b.rank; });
    return out;
  }

  function render() {
    var list = visible();
    els.count.textContent = 'Showing ' + list.length + ' of ' + rows.length + ' priced protocols';
    els.empty.hidden = list.length > 0;
    var maxRatio = 0;
    rows.forEach(function (r) { if (r.implied_per_tvl > maxRatio) maxRatio = r.implied_per_tvl; });
    els.tbody.innerHTML = list.map(function (r) {
      var w = Math.max(2, Math.round((r.implied_per_tvl / maxRatio) * 100));
      return '<tr data-slug="' + esc(r.slug) + '"' + (r.slug === selected ? ' class="selected"' : '') + '>' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' +
        (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') +
        '<span class="pslug">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + r.multiple.toFixed(2) + '×</td>' +
        '<td class="num implied">' + money(r.implied_value_usd) + '</td>' +
        '<td class="bar-cell"><div class="bar"><i style="width:' + w + '%"></i></div>' +
        '<span class="bar-label">' + r.implied_per_tvl.toFixed(2) + '× TVL</span></td></tr>';
    }).join('');
    Array.prototype.forEach.call(els.tbody.querySelectorAll('tr'), function (tr) {
      tr.addEventListener('click', function () { select(tr.getAttribute('data-slug'), true); });
    });
  }

  function partRow(label, value) {
    return '<li><span>' + label + '</span><b>' + value + '</b></li>';
  }

  function select(slug, pushHash) {
    var r = bySlug[slug];
    if (!r) return;
    selected = slug;
    if (pushHash) window.history.replaceState(null, '', '#' + slug);
    Array.prototype.forEach.call(els.tbody.querySelectorAll('tr'), function (tr) {
      tr.classList.toggle('selected', tr.getAttribute('data-slug') === slug);
    });
    var p = r.score_parts;
    var age = r.age_days === null ? 'not recorded' :
      r.age_days >= 365 ? (r.age_days / 365).toFixed(1) + ' years' : r.age_days + ' days';
    els.detail.innerHTML =
      '<h3>' + esc(r.name) + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</h3>' +
      '<span class="dslug">' + esc(r.slug) + ' · rank #' + r.rank + ' of ' + rows.length + '</span>' +
      '<p class="verdict">If ' + esc(r.name) + ' launched a token at the price its trading peers command, ' +
      'the launch would be worth <b>' + moneyFull(r.implied_value_usd) + '</b> — ' +
      r.implied_per_tvl.toFixed(2) + '× its current TVL.</p>' +
      '<dl class="dstats">' +
      '<div><dt>TVL</dt><dd>' + moneyFull(r.tvl_usd) + '</dd></div>' +
      '<div><dt>7-day change</dt><dd>' + (r.change_7d === null ? '—' : r.change_7d.toFixed(1) + '%') + '</dd></div>' +
      '<div><dt>Category</dt><dd>' + esc(r.category || '—') + '</dd></div>' +
      '<div><dt>Chains</dt><dd>' + esc(r.chains.join(', ') || '—') + '</dd></div>' +
      '<div><dt>Age, no token</dt><dd>' + age + '</dd></div>' +
      '<div><dt>Category multiple</dt><dd>' + r.multiple.toFixed(2) + '×</dd></div>' +
      '</dl>' +
      '<ul class="parts">' +
      partRow('Base — TVL × multiple', moneyFull(Math.round(p.base))) +
      partRow('Momentum (7d TVL)', '× ' + p.momentum.toFixed(3)) +
      partRow('Maturity (age, no token)', '× ' + p.maturity.toFixed(3)) +
      partRow('Reach (chains)', '× ' + p.reach.toFixed(3)) +
      '<li class="total"><span>Implied launch value</span><b>' + moneyFull(r.implied_value_usd) + '</b></li>' +
      '</ul>' +
      '<h4>Farm plan — before any launch</h4>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
  }

  ['input', 'change'].forEach(function (ev) {
    els.q.addEventListener(ev, render);
    els.cat.addEventListener(ev, render);
    els.chain.addEventListener(ev, render);
    els.sort.addEventListener(ev, render);
    els.watch.addEventListener(ev, render);
  });

  render();
  var fromHash = window.location.hash.replace(/^#/, '');
  select(bySlug[fromHash] ? fromHash : rows[0].slug, false);
})();
