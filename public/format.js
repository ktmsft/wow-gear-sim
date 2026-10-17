// Small formatting helpers shared by the UI modules.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export const fmt = (n) => Math.round(n).toLocaleString();

export const signed = (n) => `${n > 0 ? '+' : ''}${fmt(n)}`;

export const pct = (delta, base) => `${delta >= 0 ? '+' : ''}${((delta / base) * 100).toFixed(2)}%`;

export function duration(s) {
  if (s < 60) return `${Math.max(5, Math.round(s / 5) * 5)} sec`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} hr`;
}

export function wowheadUrl(item) {
  const bonus = item.bonusIds ? `?bonus=${item.bonusIds.split('/').join(':')}` : '';
  return `https://www.wowhead.com/item=${item.id}${bonus}`;
}

// Round axis ticks covering lo..hi.
export function ticks(lo, hi, count = 4) {
  const raw = (hi - lo || 1) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Math.round(v / step) * step);
  return out;
}
