// Lectura de horarios y de listas pegadas (del portal, de WhatsApp o escritas a mano).

export function clientKey(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(s\.?\s?l\.?u?|s\.?\s?a\.?|s\.?\s?c\.?p\.?)(?=\s|$)/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toMin(str) {
  const m = String(str).trim().toLowerCase().match(/^(\d{1,2})(?:\s*[:.h']\s*(\d{2}))?\s*h?$/);
  if (!m) return null;
  const h = +m[1], mi = m[2] ? +m[2] : 0;
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}

export function fmt(min) {
  if (min == null || !isFinite(min)) return '--:--';
  const m = Math.round(min);
  const h = Math.floor(m / 60) % 24, mm = ((m % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

const T = String.raw`\d{1,2}(?:\s*[:.h']\s*\d{2})?\s*h?`;
const RANGE = new RegExp(String.raw`(de\s+(?:les\s+|las\s+)?|horari[o]?:?\s*|entrega:?\s*)?(${T})\s*(?:-|–|—|a\s+les|a\s+las|a|hasta|fins\s+a(?:\s+les)?)\s*(${T})`, 'gi');

// Devuelve [{from,to}] en minutos. Un "9-11" a secas no cuenta: en una dirección suele ser un número de portal.
export function parseWindows(text) {
  const out = [];
  for (const m of String(text || '').matchAll(RANGE)) {
    const [, prefix, a, b] = m;
    const explicit = prefix || /[:.h']/.test(a) || /[:.h']/.test(b);
    if (!explicit) continue;
    const from = toMin(a), to = toMin(b);
    if (from == null || to == null || to <= from) continue;
    out.push([from, to]);
  }
  return out;
}

export function stripWindows(text) {
  return String(text || '')
    .replace(RANGE, (m, prefix, a, b) => (prefix || /[:.h']/.test(a) || /[:.h']/.test(b) ? ' ' : m))
    .replace(/[\s\/|,;\-–—]+$/, '')
    .replace(/\b(horari[o]?|entrega|y|i)\b\s*:?$/i, '')
    .replace(/[\s\/|,;\-–—]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const ADDRESS_RE = /^(c\/|c\.|cl\.?|calle|carrer|crta|ctra|carretera|av\.?|avda\.?|avinguda|avenida|pl\.?|pla[çc]a|plaza|pg\.?|passeig|paseo|ronda|rbla\.?|rambla|via|v[ií]a|trav\.?|travessera|travesera|gran via|cami|cam[ií]|pol[ií]gon|pol\.|urb\.?|torrent)\b/i;

export function looksLikeAddress(s) {
  s = s.trim();
  return ADDRESS_RE.test(s) || /\b\d{5}\b/.test(s) || /,\s*\d+/.test(s);
}

// Cada parada: { name, address, windows }. Bloques separados por línea en blanco = una parada por bloque;
// si no hay líneas en blanco, una parada por línea.
export function parseList(text) {
  const raw = String(text || '').replace(/\r/g, '');
  const blocks = /\n\s*\n/.test(raw.trim())
    ? raw.split(/\n\s*\n/).map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean))
    : raw.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => [l]);

  return blocks.filter((b) => b.length).map((lines) => {
    const windows = lines.flatMap(parseWindows);
    const clean = lines.map(stripWindows).filter(Boolean);
    let parts;
    if (clean.length > 1) parts = clean;
    else parts = (clean[0] || '').split(/\t|\s\|\s|;|\s[-–—]\s/).map((p) => p.trim()).filter(Boolean);
    parts = parts.map((p) => p.replace(/^\d+[.)]\s+/, '')); // "1. Bar Pepe" o "2) ..."

    let name = '', address = '';
    const addrIdx = parts.findIndex(looksLikeAddress);
    if (parts.length === 1) {
      if (addrIdx === 0) address = parts[0]; else name = parts[0];
    } else if (addrIdx > 0) {
      name = parts.slice(0, addrIdx).join(' - ');
      address = parts.slice(addrIdx).join(', ');
    } else if (addrIdx === 0) {
      address = parts[0];
      name = parts.slice(1).join(' - ');
    } else {
      name = parts[0];
      address = parts.slice(1).join(', ');
    }
    return { name: name || address, address, windows };
  });
}
