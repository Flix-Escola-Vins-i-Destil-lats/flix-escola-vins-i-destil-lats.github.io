// Puente con el portal de Escolà (portal.escoladist.com/Repartos).
// El portal no deja que otra web lea sus datos, así que el puente es un marcador del navegador: se toca
// con el portal abierto y la sesión iniciada, lee la ruta pendiente y la comparte con la app.
import { parseWindows, mergeWindows } from './parse.js';

// ---------- Horarios del portal ----------

// Días: palabras largas siempre; letras sueltas (L-V, J-V-S) solo dentro de una lista o un rango.
const DAY_WORDS = [
  ['miercoles', 3], ['domingo', 0], ['viernes', 5], ['jueves', 4], ['martes', 2], ['sabado', 6], ['lunes', 1],
  ['mier', 3], ['vier', 5], ['lun', 1], ['mar', 2], ['mie', 3], ['jue', 4], ['vie', 5], ['sab', 6], ['dom', 0],
  ['lu', 1], ['ma', 2], ['mi', 3], ['ju', 4], ['vi', 5], ['sa', 6], ['do', 0],
];
const DAY_LETTERS = [['l', 1], ['x', 3], ['j', 4], ['v', 5], ['s', 6], ['d', 0]];
const DAY_NUM = new Map([...DAY_WORDS, ...DAY_LETTERS]);
const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const LONG = DAY_WORDS.map(([w]) => w).join('|');
const ANY = `${LONG}|${DAY_LETTERS.map(([w]) => w).join('|')}`;
const JOIN = String.raw`\s*(?:-|,|\by\b|\ba\b)\s*`;
const DAYS_SRC = String.raw`\b(?:(?:${LONG})\b(?:${JOIN}(?:${ANY})\b)*|(?:${ANY})\b(?:${JOIN}(?:${ANY})\b)+)`;
const DAYS_RE = () => new RegExp(`${DAYS_SRC}|\\bresto\\b`, 'g');
const CLOSED_RE = () => new RegExp(String.raw`(${DAYS_SRC})\s*:?\s*(?:cerrados?|cierran?|festivos?)\b|\b(?:cerrados?|cierran?|festivos?|descansa)\s+(?:los\s+)?(${DAYS_SRC})`, 'g');

// "lu-mi" = lunes, martes y miércoles; "lu, mi y vi" = esos tres.
function daySet(expr) {
  const out = new Set();
  const parts = expr.split(/(\s*(?:-|,|\by\b|\ba\b)\s*)/);
  let prev = null, range = false;
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    if (t === '-' || t === 'a') { range = true; continue; }
    if (t === ',' || t === 'y') { range = false; continue; }
    const d = DAY_NUM.get(t);
    if (d == null) continue;
    if (range && prev != null) for (let k = prev; k !== d; k = (k + 1) % 7) out.add(k);
    out.add(d);
    prev = d; range = false;
  }
  return [...out];
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/(\d),(\d{2})\b/g, '$1:$2') // 13,00 → 13:00
    .replace(/([a-z])\.(?=[\s\w(/]|$)/g, '$1 ') // "lu.a vier." / "hs." → sin puntos
    .replace(/(\d)\s*(?:hs|horas?)\b/g, '$1h') // "13HS" → "13h"
    .replace(/([a-z])(\d)/g, '$1 $2') // "de10:30" → "de 10:30"
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MORNING = [6 * 60, 14 * 60], AFTERNOON = [15 * 60, 20 * 60];

function intersect(a, b) {
  const out = [];
  for (const x of a) for (const y of b) {
    const s = Math.max(x[0], y[0]), e = Math.min(x[1], y[1]);
    if (e > s) out.push([s, e]);
  }
  return mergeWindows(out);
}

function segmentWindows(text) {
  let ws = parseWindows(text, { loose: true });
  const morning = /\b(mananas?|mati)\b/.test(text), afternoon = /\btardes?\b/.test(text);
  if (!ws.length) {
    if (morning && !afternoon) ws = [MORNING];
    else if (afternoon && !morning) ws = [AFTERNOON];
  } else if (morning && !afternoon) {
    const cut = intersect(ws, [MORNING]);
    if (cut.length) ws = cut;
  }
  return ws;
}

// Lee un horario del portal para un día de la semana (0 = domingo):
// { windows, closed: el portal dice que cierra ese día, otherDay: el horario es de otros días }.
export function parseHorario(text, weekday) {
  let s = normalize(text);
  const closedDays = new Set();
  s = s.replace(CLOSED_RE(), (m, a, b) => { daySet(a || b).forEach((d) => closedDays.add(d)); return ' '; });
  s = s.replace(new RegExp(String.raw`\b(?:preferente|preferiblemente|mejor)\s+(?:${DAYS_SRC})`, 'g'), ' '); // preferencia, no obligación

  const segs = [];
  let last = 0, days = null, m;
  const re = DAYS_RE();
  while ((m = re.exec(s))) {
    segs.push({ days, text: s.slice(last, m.index) });
    days = m[0] === 'resto' ? 'rest' : daySet(m[0]);
    last = m.index + m[0].length;
  }
  segs.push({ days, text: s.slice(last) });
  for (const g of segs) g.windows = segmentWindows(g.text);
  // "DE 8 A 12:30 DE LU A VI": los días van detrás de su horario.
  for (let i = 1; i < segs.length; i++) {
    const g = segs[i], before = segs[i - 1];
    if (Array.isArray(g.days) && !g.windows.length && before.days === null && before.windows.length) { before.days = g.days; g.days = null; }
  }

  const named = new Set(segs.flatMap((g) => (Array.isArray(g.days) ? g.days : [])));
  const usable = segs.filter((g) => g.windows.length);
  let pick = usable.filter((g) => Array.isArray(g.days) && g.days.includes(weekday));
  if (!pick.length && !named.has(weekday)) pick = usable.filter((g) => g.days === 'rest');
  if (!pick.length) pick = usable.filter((g) => g.days === null);
  const otherDay = !pick.length && usable.length > 0;
  if (otherDay) pick = usable; // mejor el horario de otro día que ninguno
  return {
    windows: mergeWindows(pick.flatMap((g) => g.windows)).map(([a, b]) => [a, Math.min(b, 23 * 60 + 59)]),
    closed: closedDays.has(weekday),
    otherDay,
    byDay: named.size > 0 || closedDays.size > 0,
  };
}

// Texto libre del pedido: quita fechas ("01/09/2026", "21 DE SETIEMBRE", "00:00 ") que no son horario.
const MONTHS = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|setembre|octubre|noviembre|diciembre';
export function cleanOrderText(text) {
  return String(text || '')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
    .replace(new RegExp(String.raw`\b\d{1,2}\s+de\s+(?:${MONTHS})\b`, 'gi'), ' ')
    .replace(/\bdia\s+\d{1,2}\b/gi, ' ')
    .replace(/^\s*00:00\b/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- Ruta compartida desde el portal ----------

const MARK = '"ruta":"escola-portal"';
const txt = (v, max = 200) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, max);

// Lo que comparte el marcador: {"ruta":"escola-portal","v":1,"fecha":"04/11/2026","id":…,"paradas":[[id_cliente,
// razón social, dirección, población, teléfono, horario, texto libre del pedido, observaciones, orden], …]}.
// Devuelve { date, id, stops } o null si el texto no es eso.
export function parsePortal(text) {
  const s = String(text || '');
  const i = s.indexOf(`{${MARK}`);
  if (i < 0) return null;
  let p;
  try { p = JSON.parse(s.slice(i, s.lastIndexOf('}') + 1)); } catch { return null; }
  const f = String(p?.fecha || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!f || !Array.isArray(p.paradas)) return null;
  const [y, mo, d] = [+f[3], +f[2], +f[1]];
  const date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const weekday = new Date(y, mo - 1, d).getDay();

  // Un cliente con varios albaranes sale varias veces: una sola parada.
  const groups = new Map();
  for (const row of p.paradas.slice(0, 200)) {
    if (!Array.isArray(row)) continue;
    const [idc, name, dir, town, phone, horario, order, obs, orden] = row;
    const nm = txt(name, 120);
    if (!nm) continue;
    const key = `${txt(idc, 20) || nm}|${txt(dir)}`;
    const g = groups.get(key) || { name: nm, dir: txt(dir), town: txt(town, 80), phone: '', horario: txt(horario), orders: new Set(), obs: new Set(), n: 0, orden: Infinity };
    g.n++;
    if (!g.phone && /\d{6,}/.test(String(phone || '').replace(/\D/g, ''))) g.phone = txt(phone, 40);
    const o = cleanOrderText(txt(order));
    if (o) g.orders.add(o);
    // De las observaciones solo interesa la del pedido; la de la factura es para la oficina.
    const ob = txt(String(obs || '').split(/obs\.?\s*factura\s*:/i)[0].replace(/obs\.?\s*pedido\s*:/i, ''), 160);
    if (ob) g.obs.add(ob);
    if (+orden < g.orden) g.orden = +orden;
    groups.set(key, g);
  }

  // "MARTES - MAÑANA" en una ruta del martes no dice nada nuevo en las notas (la mañana ya va a la franja).
  const sameDay = new RegExp(String.raw`^(?:${DAY_NAMES[weekday]})?[\s,.-]*(?:(?:por la\s+)?(?:manana|mati|tarde))?[\s.]*$`);
  const unique = (list) => [...new Map(list.map((t) => [normalize(t).replace(/\b(h|hs)\b|[^a-z0-9]/g, ''), t])).values()];

  const stops = [...groups.values()].sort((a, b) => a.orden - b.orden).map((g) => {
    const h = parseHorario(g.horario, weekday);
    const orders = unique([...g.orders]);
    const obs = unique([...g.obs]).filter((o) => !orders.some((x) => normalize(x) === normalize(o)));
    // El horario del pedido manda: se cruza con el del cliente y, si no coinciden, gana el del pedido.
    // Las observaciones ("MARTES - MAÑANA") solo afinan: si chocan, no cuentan.
    const winsOf = (list) => mergeWindows(list.flatMap((o) => parseHorario(o, weekday).windows));
    const narrow = (base, extra, wins) => (!extra.length ? base : intersect(base, extra).length ? intersect(base, extra) : wins ? extra : base);
    const windows = narrow(narrow(h.windows, winsOf(orders), true), winsOf(obs), false);
    // Lo que va entre paréntesis en la dirección ("ENTRADA MERCANCIAS POR PARKING") es para el conductor,
    // y despista al buscar la dirección.
    const access = [...g.dir.matchAll(/\(([^)]*)\)?/g)].map((m) => m[1].trim()).filter(Boolean);
    const street = g.dir.replace(/\([^)]*\)?/g, ' ').replace(/\s+/g, ' ').replace(/[\s,.]+$/, '').trim();
    const notes = [
      h.closed ? '⚠ Según el portal, este día cierra.' : h.otherDay ? '⚠ El horario del portal es de otros días de la semana.' : '',
      ...access.map((a) => `Acceso: ${a}`),
      g.horario ? `Horario: ${g.horario}` : '',
      ...orders.map((o) => `Pedido: ${o}`),
      ...obs.filter((o) => !sameDay.test(normalize(o))).map((o) => `Obs.: ${o}`),
      g.n > 1 ? `${g.n} albaranes` : '',
    ].filter(Boolean).join('\n').slice(0, 500);
    return {
      name: g.name,
      address: [street, g.town].filter(Boolean).join(', '),
      phone: g.phone,
      windows,
      notes,
      horario: g.horario,
      closed: h.closed,
      // Solo un horario igual todos los días se recuerda como horario del cliente (sin lo del pedido).
      clientWindows: h.byDay ? [] : h.windows,
    };
  });
  return { date, id: txt(p.id, 20), stops };
}

// ---------- El marcador ----------

// Se ejecuta dentro del portal (no en la app): no puede usar nada de fuera de la función.
// Solo lee: las mismas dos consultas que hace la pantalla «Repartos de entrega» del portal.
function bridge() {
  const NAME = 'Ruta Escolà';
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const old = document.getElementById('ruta-escola-puente');
  if (old) old.remove();
  const box = document.createElement('div');
  box.id = 'ruta-escola-puente';
  box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;max-width:520px;margin:0 auto;background:#0e1311;color:#eee7d4;border:1px solid #c9a54c;border-radius:16px;padding:16px 16px 10px;font:15px/1.45 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.45)';
  const say = (html) => {
    box.innerHTML = '<div style="color:#c9a54c;font-weight:700;margin-bottom:6px">Pasar a ' + NAME + '</div>' + html +
      '<button data-x style="display:block;margin:8px auto 0;padding:8px 14px;background:none;border:0;color:#eee7d4;opacity:.75;font:inherit">Cerrar</button>';
    box.querySelector('[data-x]').onclick = () => box.remove();
  };
  document.body.appendChild(box);
  if (!/(^|\.)escoladist\.com$/.test(location.hostname)) return say('Abre primero portal.escoladist.com e inicia sesión, y vuelve a tocar el marcador.');
  say('Buscando la ruta pendiente…');
  const post = (url, body) => fetch(url, {
    method: 'POST', credentials: 'same-origin', body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
  }).then((r) => { if (!r.ok) throw new Error('el portal responde ' + r.status); return r.json(); });
  const iso = (f) => String(f || '').split('/').reverse().join('-');
  post('/Repartos/RepartosDatos', 'codReparto=&status=Q&sentido=desc&verTodas=true').then(async (res) => {
    const list = (res.data || []).filter((e) => e.status === 'P' || e.status === 'R').sort((a, b) => iso(b.fecha).localeCompare(iso(a.fecha))).slice(0, 4);
    if (!list.length) return say('Todavía no hay ninguna ruta pendiente. La de mañana suele aparecer sobre las 17:30.');
    const routes = [];
    for (const e of list) {
      const pts = (await post('/Repartos/PuntosEntregaDatos', 'draw=1&start=0&length=-1&paginate=0&id_entrega=' + encodeURIComponent(e.id_entrega))).data || [];
      routes.push({
        e, n: new Set(pts.map((p) => p.id_cliente)).size,
        text: JSON.stringify({ ruta: 'escola-portal', v: 1, fecha: e.fecha, id: e.id_entrega,
          paradas: pts.map((p) => [p.id_cliente, p.razon_social, p.direccion, p.poblacion, p.telefono, p.horario, p.texto_libre_pedido, p.observaciones, p.orden]) }),
      });
    }
    say(routes.map((r, i) => '<button data-i="' + i + '" style="display:block;width:100%;margin-top:8px;padding:14px;border:0;border-radius:12px;background:#c9a54c;color:#14110a;font:700 16px system-ui,sans-serif">Ruta del ' +
      esc(r.e.fecha) + ' · ' + r.n + (r.n === 1 ? ' parada' : ' paradas') + '</button>').join('') +
      '<div data-m style="margin-top:8px;font-size:13px;opacity:.85">Al compartir, elige <b>Ruta</b>.</div>');
    box.querySelectorAll('[data-i]').forEach((b) => {
      b.onclick = async () => {
        const r = routes[+b.dataset.i], m = box.querySelector('[data-m]');
        if (navigator.share) {
          try { await navigator.share({ title: NAME, text: r.text }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
        }
        try { await navigator.clipboard.writeText(r.text); m.innerHTML = 'Copiada. En la app: <b>Pegar lista</b>, pega y <b>Leer lista</b>.'; } catch (err) { m.textContent = 'No he podido compartirla ni copiarla.'; }
      };
    });
  }).catch((err) => say('No he podido leer la ruta (' + esc(err.message) + '). ¿Tienes la sesión iniciada?'));
}

export const BRIDGE_URL = 'javascript:' + encodeURIComponent(`(${bridge.toString()})()`);
