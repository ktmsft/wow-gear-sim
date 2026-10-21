// The "best setup" view: a character sheet with the winning changes applied,
// plus a step-by-step list of what to do in game.

import ICONS from '/lib/icons.js';
import { GEM_BY_ID, CONSUMABLES } from '/lib/catalog.js';
import { esc, signed, wowheadUrl } from './format.js';

const LEFT = ['head', 'neck', 'shoulder', 'back', 'chest', 'wrist'];
const RIGHT = ['hands', 'waist', 'legs', 'feet', 'finger1', 'finger2', 'trinket1', 'trinket2'];
const WEAPONS = ['main_hand', 'off_hand'];
const QUALITY = { 2: 'q2', 3: 'q3', 4: 'q4', 5: 'q5' };

// ",id=1,gem_id=2/3" -> { id: '1', gem_id: '2/3' }
function lineFields(line) {
  return Object.fromEntries(line.split(',').slice(1).filter(Boolean).map((p) => {
    const i = p.indexOf('=');
    return i < 0 ? [p, ''] : [p.slice(0, i), p.slice(i + 1)];
  }));
}
const itemFields = (item) => Object.fromEntries(item.fields);
const gemIds = (f) => (f.gem_id ?? '').split('/').filter((g) => g && g !== '0');

// Missing icons fall back to a short label (see the error listener in app.js).
export const icon = (name, cls = '', alt = '', fallback = '') => (name
  ? `<img class="ic ${cls}" src="/api/icons/${esc(name)}.jpg" alt="${esc(alt)}" data-fb="${esc(fallback)}" loading="lazy">`
  : `<span class="ic ${cls} broken">${esc(fallback)}</span>`);

const SHORT = {
  head: 'Head', neck: 'Neck', shoulder: 'Shldr', back: 'Back', chest: 'Chest', wrist: 'Wrist', hands: 'Hands',
  waist: 'Waist', legs: 'Legs', feet: 'Feet', finger1: 'Ring', finger2: 'Ring', trinket1: 'Trnkt', trinket2: 'Trnkt',
  main_hand: 'MH', off_hand: 'OH',
};

const itemIcon = (id) => ICONS.items[id] ?? null;
const gemName = (id) => GEM_BY_ID[id]?.name ?? ICONS.gems[id]?.[1] ?? `Gem ${id}`;
const enchantName = (id) => ICONS.enchants[id]?.[1] ?? null;

// Equipped gear with the winning gear and gem changes applied.
function finalSlots(parsed, winners) {
  const slots = {};
  for (const [slot, item] of Object.entries(parsed.equipped)) {
    if (slot === 'shirt' || slot === 'tabard') continue;
    slots[slot] = { slot, name: item.name, ilvl: item.ilvl, id: item.id, bonusIds: item.bonusIds, f: itemFields(item), was: null, mods: [] };
  }
  const gems = winners.find((r) => r.kind === 'gems');
  for (const c of gems?.changes ?? []) {
    if (slots[c.slot]) slots[c.slot] = { ...slots[c.slot], f: lineFields(c.line), gemsChanged: true };
  }
  const gear = winners.find((r) => r.kind === 'gear');
  for (const c of gear?.changes ?? []) {
    const old = parsed.equipped[c.slot];
    slots[c.slot] = {
      slot: c.slot, name: c.name, ilvl: c.ilvl, id: c.id, bonusIds: c.bonusIds, f: lineFields(c.line),
      mods: c.mods ?? [], swapped: true, was: old ? { name: old.name, ilvl: old.ilvl, f: itemFields(old) } : null,
    };
  }
  return slots;
}

function tile(s, labels, side) {
  if (!s) return '';
  const [ic, q] = itemIcon(s.id) ?? [null, 4];
  const gems = gemIds(s.f).map((g) => icon(ICONS.gems[g]?.[0], 'gem', gemName(g))).join('');
  const ench = enchantName(s.f.enchant_id);
  const state = s.swapped ? 'swap' : s.gemsChanged ? 'gem' : 'same';
  const badge = s.swapped ? '<span class="st-badge">Equip</span>' : s.gemsChanged ? '<span class="st-badge gem">Gems</span>' : '';
  return `
    <div class="st ${state} ${side}">
      <a class="st-ic ${QUALITY[q] ?? 'q4'}" href="${wowheadUrl(s)}" target="_blank" rel="noopener">${icon(ic, '', s.name, SHORT[s.slot])}</a>
      <div class="st-body">
        <span class="st-slot">${esc(labels[s.slot] ?? s.slot)}${badge}</span>
        <a class="st-name ${QUALITY[q] ?? 'q4'}" href="${wowheadUrl(s)}" target="_blank" rel="noopener">${esc(s.name)}</a>
        <span class="st-meta"><span class="ilvl-pill">${s.ilvl ?? ''}</span>${gems ? `<span class="st-gems">${gems}</span>` : ''}${ench ? `<span class="st-ench">${esc(ench)}</span>` : ''}${s.mods.map((m) => `<span class="tag mod">${esc(m)}</span>`).join('')}</span>
        ${s.was ? `<span class="st-was">Replaces ${esc(s.was.name)} (${s.was.ilvl})</span>` : ''}
      </div>
    </div>`;
}

// What to actually do in game, in order.
function steps(parsed, winners, slots, labels) {
  const out = [];
  const gear = winners.find((r) => r.kind === 'gear');
  for (const c of gear?.changes ?? []) {
    const s = slots[c.slot];
    const [ic] = itemIcon(c.id) ?? [null];
    const where = labels[c.slot] ?? c.slot;
    const base = c.baseName ?? c.name;
    const cat = s.mods.includes('Catalyst');
    const up = s.mods.find((m) => /\d\/\d/.test(m));
    const crests = Object.values(c.crests ?? {}).reduce((a, b) => a + b, 0);
    const actions = [];
    if (cat) actions.push(`catalyze your <b>${esc(base)}</b> into <b>${esc(c.name)}</b> (1 charge)`);
    if (up) actions.push(`${cat ? 'upgrade it' : `upgrade your <b>${esc(base)}</b>`} to <b>${esc(up)}</b> <span class="ilvl-pill">${c.ilvl}</span>${crests ? ` (${crests} crests)` : ' (free)'}`);
    const sameSlot = !c.bag && s.was?.name === base;
    if (!sameSlot) actions.push(`${actions.length ? 'then equip it' : `equip <b>${esc(c.name)}</b> <span class="ilvl-pill">${c.ilvl}</span>`} in <b>${esc(where)}</b>${c.bag && !actions.length ? (c.vault ? ' from the Great Vault' : ' from your bags') : ''}`);
    const text = actions.join(', ');
    out.push({
      icon: icon(ic, '', c.name, SHORT[c.slot]),
      html: `${text.charAt(0).toUpperCase()}${text.slice(1)}.`,
      gain: gear.delta, group: 'gear',
    });
    // A different physical item needs the old one's enchant and gems redone; catalyzing in place keeps them.
    if (!c.bag) continue;
    const oldEnch = s.was?.f.enchant_id;
    if (s.f.enchant_id && s.f.enchant_id === oldEnch && enchantName(oldEnch)) {
      out.push({ icon: icon(ICONS.enchants[oldEnch]?.[0], '', ''), html: `Enchant it with <b>${esc(enchantName(oldEnch))}</b> (same as your old ${esc(where.toLowerCase())}).`, group: 'gear' });
    }
    const gemsNow = gemIds(s.f);
    if (gemsNow.length && gemsNow.join('/') === gemIds(s.was?.f ?? {}).join('/')) {
      out.push({ icon: icon(ICONS.gems[gemsNow[0]]?.[0], 'gem', ''), html: `Socket it with <b>${esc(gemsNow.map(gemName).join(', '))}</b>.`, group: 'gear' });
    }
  }
  const gems = winners.find((r) => r.kind === 'gems');
  if (gems) {
    for (const c of gems.changes) {
      const now = gemIds(lineFields(c.line));
      const before = gemIds(itemFields(parsed.equipped[c.slot] ?? { fields: [] }));
      if (now.join('/') === before.join('/') || slots[c.slot]?.swapped) continue;
      out.push({
        icon: icon(ICONS.gems[now[0]]?.[0], 'gem', ''),
        html: `Socket <b>${esc(now.map(gemName).join(', '))}</b> in your <b>${esc((labels[c.slot] ?? c.slot).toLowerCase())}</b>.`,
        gain: gems.delta, group: 'gems',
      });
    }
  }
  for (const r of winners.filter((w) => w.kind === 'consumable')) {
    out.push({ icon: '<span class="ic glyph">✦</span>', html: `Use <b>${esc(r.label.split(': ')[1] ?? r.label)}</b> (${esc(CONSUMABLES[r.category]?.label.toLowerCase() ?? '')}).`, gain: r.delta, group: r.name });
  }
  const t = winners.find((r) => r.kind === 'talents');
  if (t) out.push({ icon: '<span class="ic glyph">❖</span>', html: `Switch to your <b>${esc(t.loadout)}</b> talent loadout.`, gain: t.delta, group: 'talents' });
  // The gain shows once per group, on its first step, with the steps it covers.
  out.forEach((step, i) => {
    step.first = i === 0 || out[i - 1].group !== step.group;
    if (!step.first) return;
    let last = i;
    while (out[last + 1]?.group === step.group) last++;
    step.span = last > i ? `steps ${i + 1} to ${last + 1}` : '';
  });
  return out;
}

export function loadoutHtml(parsed, winners, labels) {
  const slots = finalSlots(parsed, winners);
  const list = steps(parsed, winners, slots, labels);
  const col = (keys, side) => keys.map((k) => tile(slots[k], labels, side)).join('');
  const extras = [
    ...winners.filter((w) => w.kind === 'consumable').map((r) => `<span class="ex on">${esc(r.label)}</span>`),
    ...winners.filter((w) => w.kind === 'talents').map((r) => `<span class="ex on">Talents: ${esc(r.loadout)}</span>`),
  ];
  return `
    ${list.length ? `
    <div class="todo">
      <h4>Do this</h4>
      <ol>
        ${list.map((s, i) => `
          <li>
            <span class="todo-n">${i + 1}</span>
            ${s.icon}
            <span class="todo-text">${s.html}</span>
            ${s.gain != null && s.first ? `<span class="todo-gain">${signed(s.gain)}${s.span ? `<small>${s.span}</small>` : ''}</span>` : ''}
          </li>`).join('')}
      </ol>
    </div>` : ''}
    <div class="doll ${list.length ? 'has-changes' : ''}">
      <div class="doll-col">${col(LEFT, 'left')}</div>
      <div class="doll-col">${col(RIGHT, 'right')}</div>
      <div class="doll-weapons">${col(WEAPONS, 'left')}</div>
    </div>
    ${extras.length ? `<div class="extras">${extras.join('')}</div>` : ''}
    ${list.length ? '<p class="doll-legend"><span class="lg swap"></span>Change this<span class="lg same"></span>Keep as is</p>' : ''}`;
}

