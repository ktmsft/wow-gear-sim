// Renderers for the extra views: set details, stat weights, crest planner,
// Great Vault, trinket chart, fight styles and DPS history.

import { SEASON } from '/lib/upgrades.js';
import { esc, fmt, signed, pct, ticks, wowheadUrl } from './format.js';

const PALETTE = ['#e2a23b', '#5aa9f0', '#8fd162', '#c08cf0', '#ef7a5d', '#4fd1c5', '#f472b6', '#facc15', '#94a3b8'];

const deltaClass = (delta, margin) => (Math.abs(delta) <= margin ? 'side' : delta > 0 ? 'pos' : 'neg');
const itemLink = (item, name = item.name) => `<a class="chg-name item" href="${wowheadUrl(item)}" target="_blank" rel="noopener">${esc(name)}</a>`;

// --- set details (results drawer) -------------------------------------------------

export function detailHtml(detail, base, { loading = false, isBase = false } = {}) {
  if (!detail) {
    return `<div class="drawer-loading"><span class="spinner"></span>Simming this set in detail…</div>`;
  }
  if (detail.error) return `<p class="error">${esc(detail.error)}</p>`;
  const baseBy = new Map((base?.breakdown ?? []).map((r) => [r.name, r]));
  const top = Math.max(...detail.breakdown.map((r) => r.share), 0.01);
  const rows = detail.breakdown.map((r) => {
    const was = baseBy.get(r.name);
    const diff = !isBase && base ? r.dps - (was?.dps ?? 0) : null;
    return `
      <div class="bd-row">
        <span class="bd-name" title="${esc(r.name)}">${esc(r.name)}</span>
        <span class="bd-bar"><i style="width:${((r.share / top) * 100).toFixed(1)}%"></i></span>
        <span class="bd-share">${(r.share * 100).toFixed(1)}%</span>
        <span class="bd-dps">${fmt(r.dps)}</span>
        ${diff == null ? '' : `<span class="bd-diff ${diff > 0 ? 'pos' : diff < 0 ? 'neg' : ''}">${Math.abs(diff) < 1 ? '' : signed(diff)}</span>`}
      </div>`;
  }).join('');
  const buffs = detail.buffs.map((b) => `
    <div class="up-row">
      <span class="up-name" title="${esc(b.name)}">${esc(b.name)}</span>
      <span class="up-bar"><i style="width:${Math.min(100, b.uptime).toFixed(1)}%"></i></span>
      <span class="up-val">${b.uptime.toFixed(0)}%</span>
    </div>`).join('');
  const report = detail.report
    ? `<a class="action-link" href="${detail.report}" target="_blank" rel="noopener">Open the full SimulationCraft report ↗</a>`
    : loading ? '<span class="hint">Preparing the full report…</span>'
    : '<button type="button" class="link" data-report>Get the full SimulationCraft report</button>';
  return `
    <div class="drawer-grid">
      <section>
        <h4>Where the damage comes from${!isBase && base ? '<span class="hint-inline">vs. equipped</span>' : ''}</h4>
        <div class="bd ${!isBase && base ? 'with-diff' : ''}">${rows}</div>
      </section>
      <section>
        <h4>Buff and proc uptime</h4>
        <div class="up">${buffs || '<p class="hint">No buffs to show.</p>'}</div>
      </section>
    </div>
    <div class="drawer-foot">${report}</div>`;
}

// --- stat weights -----------------------------------------------------------------

export function weightsHtml(r) {
  const max = Math.max(...r.stats.map((s) => s.weight), 0.01);
  const ranked = [...r.stats].sort((a, b) => b.weight - a.weight);
  const secondary = ranked.filter((s) => s.key !== r.main).map((s) => s.label).join(' > ');
  return `
    <div class="weights-hero">
      <p class="hero-eyebrow">Your stat priority</p>
      <p class="weights-order">${esc(secondary)}</p>
      <p class="hint">Secondary stats within about 5% of each other are close enough to treat as equal. For steadier weights, set Precision to Precise.</p>
    </div>
    <div class="weights">
      ${ranked.map((s) => `
        <div class="w-row ${s.key === r.main ? 'main' : ''}">
          <span class="w-name">${esc(s.label)}</span>
          <span class="w-bar"><i style="width:${((s.weight / max) * 100).toFixed(1)}%"></i></span>
          <span class="w-val">${s.weight.toFixed(2)}</span>
          <span class="w-per">${s.perPoint.toFixed(1)} DPS per point</span>
        </div>`).join('')}
    </div>
    <h4 class="sub-head">Pawn string</h4>
    <p class="hint">Paste this into the Pawn addon (Pawn, then Import) to see upgrade arrows on items in game.</p>
    <div class="cmd"><code id="pawn-string">${esc(r.pawn)}</code><button type="button" data-copy="pawn-string">Copy</button></div>`;
}

// --- crest planner ----------------------------------------------------------------

const crestTotal = (cost) => Object.values(cost ?? {}).reduce((a, b) => a + b, 0);
const crestShort = (id) => (SEASON.currencies[id] ?? `Crest ${id}`).replace(' Mistcrest', '');

export function crestsHtml(r, owned = {}, slotLabels = {}) {
  const margin = r.baseline.error ?? 0;
  const rows = r.rows.map((row) => {
    const n = crestTotal(row.cost);
    return { ...row, crests: n, perCrest: n ? row.delta / n : Infinity };
  });
  const good = rows.filter((x) => x.delta > (x.error ?? 0) + margin).sort((a, b) => b.perCrest - a.perCrest || b.delta - a.delta);
  const rest = rows.filter((x) => !good.includes(x)).sort((a, b) => b.delta - a.delta);
  const maxPer = Math.max(...good.filter((x) => Number.isFinite(x.perCrest)).map((x) => x.perCrest), 0.01);
  const line = (x, i, worth) => {
    const afford = Object.entries(x.cost).every(([id, need]) => (owned[id] ?? 0) >= need);
    const cost = x.crests
      ? Object.entries(x.cost).map(([id, need]) => `<span class="crest-chip">${need} ${esc(crestShort(id))}</span>`).join('')
      : '<span class="crest-chip free">Free</span>';
    return `
      <div class="rank-row crest ${worth ? 'pos' : deltaClass(x.delta, (x.error ?? 0) + margin)}${x.estimate ? ' estimate' : ''}">
        <span class="rank-n">${worth ? i + 1 : '-'}</span>
        <div class="rank-chgs">
          <span class="chg"><span class="chg-slot">${esc(slotLabels[x.slot] ?? x.slot)}</span>
            <span class="chg-body">${itemLink(x, x.itemName)}
              <span class="chg-meta"><span class="ilvl-pill">${x.fromIlvl} → ${x.ilvl}</span><span class="tag">${esc(x.track)} ${x.from}/${x.max} → ${x.level}/${x.max}</span>${x.equipped ? '' : '<span class="tag">From bags</span>'}</span>
            </span></span>
          <span class="crest-cost">${cost}${afford || !x.crests ? '' : '<span class="tag warn-tag">Need more crests</span>'}</span>
        </div>
        <div class="per-crest">${worth && Number.isFinite(x.perCrest)
          ? `<span class="pc-bar"><i style="width:${((x.perCrest / maxPer) * 100).toFixed(1)}%"></i></span><small>${x.perCrest.toFixed(1)} DPS per crest</small>`
          : worth ? '<small>No crests needed</small>' : ''}</div>
        <span class="rank-dps">${fmt(x.dps)}<small>±${fmt(x.error ?? 0)}</small></span>
        <span class="rank-delta">${signed(x.delta)}<small>${pct(x.delta, r.baseline.dps)}</small></span>
      </div>`;
  };
  return `
    <div class="hero ${good.length ? 'win' : 'keep'}">
      <div class="hero-main">
        <p class="hero-eyebrow">Crest planner</p>
        <h3 class="hero-title">${good.length ? `Upgrade ${esc(good[0].itemName)} first` : 'No upgrade is worth crests right now'}</h3>
        <p class="hero-sub">${good.length
          ? 'Ranked by DPS gained per crest spent. Ranks up to your best item level in each slot are free.'
          : 'None of the upgrades beat your current gear by more than the margin of error.'}</p>
      </div>
      ${good.length ? `<div class="hero-num"><span class="hero-dps">${signed(good[0].delta)}</span><span class="hero-unit">DPS</span></div>` : ''}
    </div>
    ${good.length ? `<h4 class="sub-head">Worth it</h4><div class="rank">${good.map((x, i) => line(x, i, true)).join('')}</div>` : ''}
    ${rest.length ? `<h4 class="sub-head">Not worth it yet</h4><div class="rank">${rest.slice(0, 5).map((x, i) => line(x, i, false)).join('')}</div>` : ''}
    ${rest.length > 5 ? `<details class="more"><summary>Show ${rest.length - 5} more</summary><div class="rank">${rest.slice(5).map((x, i) => line(x, i, false)).join('')}</div></details>` : ''}`;
}

// --- Great Vault ------------------------------------------------------------------

export function vaultHtml(r, equipped, slotLabels) {
  const margin = r.baseline.error ?? 0;
  const rows = [...r.rows].sort((a, b) => b.dps - a.dps);
  const winner = rows[0] && rows[0].delta > (rows[0].error ?? 0) + margin ? rows[0] : null;
  return `
    <div class="hero ${winner ? 'win' : 'keep'}">
      <div class="hero-main">
        <p class="hero-eyebrow">Great Vault</p>
        <h3 class="hero-title">${winner ? `Take ${esc(winner.itemName)}` : 'No reward beats your gear'}</h3>
        <p class="hero-sub">${winner
          ? `It replaces your ${esc(slotLabels[winner.slot] ?? winner.slot)}.`
          : 'None of them beat your current gear by more than the margin of error. Pick the one you would upgrade or use later.'}</p>
      </div>
      ${winner ? `<div class="hero-num"><span class="hero-dps">${signed(winner.delta)}</span><span class="gain-pill">${pct(winner.delta, r.baseline.dps)}</span></div>` : ''}
    </div>
    <div class="vault-grid">
      ${rows.map((x, i) => {
        const cls = deltaClass(x.delta, (x.error ?? 0) + margin);
        const old = equipped[x.slot];
        return `
          <div class="vault-card ${cls}${x === winner ? ' winner' : ''}">
            ${x === winner ? '<span class="vault-badge">Best pick</span>' : `<span class="vault-rank">#${i + 1}</span>`}
            <span class="chg-slot">${esc(slotLabels[x.slot] ?? x.slot)}</span>
            ${itemLink(x, x.itemName)}
            ${x.ilvl ? `<span class="ilvl-pill">${x.ilvl}</span>` : ''}
            ${old ? `<span class="vault-old">Replaces ${esc(old.name)} (${old.ilvl})</span>` : ''}
            <span class="vault-delta">${signed(x.delta)} <small>${pct(x.delta, r.baseline.dps)}</small></span>
          </div>`;
      }).join('')}
    </div>`;
}

// --- trinket chart ----------------------------------------------------------------

// One bar per trinket when none of them can be upgraded (a line chart would be empty).
function trinketBars(r, series) {
  const rows = series.map((s) => ({ s, p: s.points[0] })).sort((a, b) => b.p.delta - a.p.delta);
  const max = Math.max(...rows.map((x) => Math.abs(x.p.delta)), 1);
  return `
    <p class="hint">All of your trinkets are already at max rank, so each one is shown at its current item level, compared with your equipped pair.</p>
    <div class="tbars">
      ${rows.map(({ s, p }) => {
        const w = (Math.abs(p.delta) / max) * 50;
        const cls = p.current ? 'base' : p.delta > 0 ? 'pos' : 'neg';
        return `
          <div class="tb-row ${cls}">
            <span class="tb-name">${itemLink(s)}<span class="tag">${esc(s.source)}</span><span class="ilvl-pill">${p.ilvl}</span></span>
            <span class="tb-track"><i style="${p.delta >= 0 ? 'left:50%' : `left:${(50 - w).toFixed(1)}%`};width:${w.toFixed(1)}%"></i><b></b></span>
            <span class="tb-val">${p.current ? 'Equipped' : signed(p.delta)}</span>
          </div>`;
      }).join('')}
    </div>`;
}

export function trinketsHtml(r) {
  if (r.series.every((s) => s.points.length < 2)) return trinketBars(r, r.series.filter((s) => s.points.length));
  const W = 760; const H = 330; const L = 70; const R = 18; const T = 18; const B = 42;
  // Equipped trinkets with nothing to upgrade are just the zero line.
  const series = r.series.filter((s) => s.points.length > 1 || !s.equipped);
  const pts = series.flatMap((s) => s.points);
  let xlo = Math.min(...pts.map((p) => p.ilvl)); let xhi = Math.max(...pts.map((p) => p.ilvl));
  if (xlo === xhi) { xlo -= 3; xhi += 3; }
  const ys = [...pts.map((p) => p.delta), 0];
  let ylo = Math.min(...ys); let yhi = Math.max(...ys);
  const padY = (yhi - ylo || 100) * 0.1;
  ylo -= padY; yhi += padY;
  const X = (v) => L + ((v - xlo) / (xhi - xlo)) * (W - L - R);
  const Y = (v) => T + ((yhi - v) / (yhi - ylo)) * (H - T - B);
  const ilvls = [...new Set(pts.map((p) => p.ilvl))].sort((a, b) => a - b);

  const grid = ticks(ylo, yhi, 5).map((v) => `
    <line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="${v === 0 ? 'zero' : 'grid'}"/>
    <text x="${L - 8}" y="${Y(v) + 4}" class="ylab">${signed(v)}</text>`).join('');
  const xlabels = ilvls.map((v) => `<text x="${X(v)}" y="${H - B + 18}" class="xlab">${v}</text>`).join('');
  const lines = series.map((s, i) => {
    const color = PALETTE[i % PALETTE.length];
    const path = s.points.map((p) => `${X(p.ilvl).toFixed(1)},${Y(p.delta).toFixed(1)}`).join(' ');
    const dots = s.points.map((p) => `
      <circle cx="${X(p.ilvl)}" cy="${Y(p.delta)}" r="${p.current ? 6 : 4}" fill="${p.current ? 'var(--panel)' : color}" stroke="${color}" stroke-width="${p.current ? 2.5 : 0}">
        <title>${esc(s.name)} at ${p.ilvl}: ${signed(p.delta)} DPS${p.current ? ' (equipped)' : ''}</title>
      </circle>`).join('');
    return `<polyline points="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>${dots}`;
  }).join('');

  const best = r.series.filter((s) => s.points.length).map((s) => {
    const i = series.indexOf(s);
    const top = [...s.points].sort((a, b) => b.delta - a.delta)[0];
    return { s, i, top };
  }).sort((a, b) => b.top.delta - a.top.delta);

  return `
    <p class="hint">DPS change compared with your current trinkets. Each trinket is tried in whichever slot suits it best. A hollow dot is the version you have equipped.</p>
    <div class="chart-wrap">
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trinket DPS by item level">
        ${grid}
        <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="axis"/>
        ${xlabels}
        <text x="${(L + W - R) / 2}" y="${H - 6}" class="xlab title">Item level</text>
        ${lines}
      </svg>
    </div>
    <div class="legend-list">
      ${best.map(({ s, i, top }) => `
        <div class="legend-row">
          <i style="background:${i < 0 ? 'var(--muted)' : PALETTE[i % PALETTE.length]}"></i>
          ${itemLink(s)}
          <span class="tag">${esc(s.source)}</span>
          ${s.track ? `<span class="hint-inline">${esc(s.track)} track</span>` : ''}
          <span class="legend-best ${top.delta > 0 ? 'pos' : top.delta < 0 ? 'neg' : ''}">Best: ${signed(top.delta)} at ${top.ilvl}</span>
        </div>`).join('')}
    </div>`;
}

// --- fight styles -----------------------------------------------------------------

export function stylesHtml(r, describe) {
  const cols = r.scenarios;
  const rows = ['baseline', ...r.names];
  const bestIn = cols.map((c) => {
    let best = 'baseline'; let dps = c.baseline.dps;
    for (const n of r.names) if ((c.results[n]?.dps ?? -Infinity) > dps) { best = n; dps = c.results[n].dps; }
    return best;
  });
  return `
    <p class="hint">The same sets simmed in four kinds of fight. Gold marks the best set in each column.</p>
    <div class="styles-wrap">
      <table class="styles">
        <thead><tr><th>Set</th>${cols.map((c) => `<th><span>${esc(c.label)}</span><small>${esc(c.note)}</small></th>`).join('')}</tr></thead>
        <tbody>
          ${rows.map((n) => `
            <tr class="${n === 'baseline' ? 'base' : ''}">
              <td class="styles-set">${n === 'baseline' ? '<span class="chg-name">Your current gear</span>' : describe(n)}</td>
              ${cols.map((c, ci) => {
                const crown = bestIn[ci] === n ? ' best' : '';
                if (n === 'baseline') return `<td class="cell${crown}"><b>${fmt(c.baseline.dps)}</b><small>DPS</small></td>`;
                const res = c.results[n];
                if (!res) return '<td class="cell">-</td>';
                const d = res.dps - c.baseline.dps;
                const cls = deltaClass(d, (res.error ?? 0) + (c.baseline.error ?? 0));
                return `<td class="cell ${cls}${crown}"><b>${signed(d)}</b><small>${pct(d, c.baseline.dps)}</small></td>`;
              }).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// --- history ----------------------------------------------------------------------

const day = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function historyHtml(runs) {
  const list = [...runs].sort((a, b) => a.at - b.at);
  const W = 760; const H = 220; const L = 70; const R = 18; const T = 16; const B = 34;
  const vals = list.flatMap((r) => [r.dps, r.best]);
  let lo = Math.min(...vals); let hi = Math.max(...vals);
  const pad = (hi - lo || hi * 0.02 || 100) * 0.12;
  lo -= pad; hi += pad;
  const X = (i) => (list.length === 1 ? (L + W - R) / 2 : L + (i / (list.length - 1)) * (W - L - R));
  const Y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const grid = ticks(lo, hi, 4).map((v) => `
    <line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/>
    <text x="${L - 8}" y="${Y(v) + 4}" class="ylab">${fmt(v)}</text>`).join('');
  const path = (key) => list.map((r, i) => `${X(i).toFixed(1)},${Y(r[key]).toFixed(1)}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(list.length / 8));
  const xl = list.map((r, i) => (i % labelEvery === 0 || i === list.length - 1
    ? `<text x="${X(i)}" y="${H - B + 18}" class="xlab">${day(r.at)}</text>` : '')).join('');
  const dots = list.map((r, i) => `
    <circle cx="${X(i)}" cy="${Y(r.dps)}" r="4.5" class="h-dot"><title>${day(r.at)}: ${fmt(r.dps)} DPS (${esc(r.fightStyle)})</title></circle>
    ${r.best > r.dps ? `<circle cx="${X(i)}" cy="${Y(r.best)}" r="3.5" class="h-best"><title>Best found: ${fmt(r.best)} DPS</title></circle>` : ''}`).join('');
  const recent = [...list].reverse().slice(0, 8);
  return `
    <div class="chart-wrap">
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="DPS over time">
        ${grid}
        <polyline points="${path('best')}" fill="none" class="h-best-line"/>
        <polyline points="${path('dps')}" fill="none" class="h-line"/>
        ${dots}${xl}
      </svg>
    </div>
    <div class="rank-legend">
      <span><i class="lg-hline"></i>Your DPS</span>
      <span><i class="lg-hbest"></i>Best set found that run</span>
    </div>
    <div class="history-list">
      ${recent.map((r, i) => {
        const prev = recent[i + 1];
        const change = prev ? r.dps - prev.dps : null;
        return `
          <div class="h-row">
            <span class="h-date">${new Date(r.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            <span class="h-fight">${esc(r.fightStyle)}${r.targets > 1 ? `, ${r.targets} targets` : ''}</span>
            <span class="h-dps">${fmt(r.dps)}${change == null ? '' : ` <small class="${change > 0 ? 'pos' : change < 0 ? 'neg' : ''}">${signed(change)}</small>`}</span>
            <span class="h-best-text">${r.bestText ? `Best: ${esc(r.bestText)} (${signed(r.best - r.dps)})` : 'Gear was already the best'}</span>
          </div>`;
      }).join('')}
    </div>`;
}
