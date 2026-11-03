import { parseList, fmt, toMin, clientKey } from './parse.js';
import { geocode, navUrl, currentPosition, coordsFromText, travelMatrix, trafficLegs } from './geo.js';
import { computePlan } from './planner.js';
import { parsePortal } from './portal.js';
import * as store from './store.js';

export const VERSION = '1.6.1';

// ---------- Utilidades ----------

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
const todayIso = () => store.isoDate();
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return store.isoDate(d); };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

const I = {
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="9.5" r="2.5" fill="currentColor"/></svg>',
  nav: '<svg viewBox="0 0 24 24"><path d="M4 11.5 20 4l-7.5 16-2-6.5z" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  paste: '<svg viewBox="0 0 24 24"><path d="M9 4h6v3H9zM8 5.5H6.5A1.5 1.5 0 0 0 5 7v12.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H16M8.5 12h7M8.5 16h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  go: '<svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 11v6M12 7.5v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 4 2.5 20h19z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 10v4.5M12 17v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
};

// Àrea DUM (carga y descarga): hay que validar cada parada en la app SPRO; máximo 30 minutos.
const DUM_MINUTES = 30;
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
function sproUrl() {
  if (isIOS) return 'https://apps.apple.com/app/id1500407078';
  const store = encodeURIComponent('https://play.google.com/store/apps/details?id=cat.bcn.bsm.spro');
  return `intent://open#Intent;scheme=cat.bcn.bsm.spro;package=cat.bcn.bsm.spro;S.browser_fallback_url=${store};end`;
}
function dumChip(r, cur) {
  if (r.dum?.id !== cur.id) return '';
  const left = Math.ceil(DUM_MINUTES - (Date.now() - r.dum.at) / 60000);
  if (left <= 0) return '<span class="chip late solid" id="dum-chip">Zona DUM: tiempo agotado</span>';
  return `<span class="chip ${left <= 5 ? 'late solid' : 'wait'}" id="dum-chip">Zona DUM: quedan ${left} min</span>`;
}

const ui = {
  tab: 'route',
  date: null,
  busy: null, // texto del botón ocupado; mientras hay algo calculando no se aceptan otras acciones de la ruta
  clientFilter: '',
  sheet: null, // { kind, initial, ... }
  persisted: null,
  update: null, // service worker nuevo esperando
};

function toast(msg, ms = 2600, action = null) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-btn" data-toast-action>${esc(action.label)}</button>` : ''}`;
  toast._action = action?.fn || null;
  t.classList.toggle('has-action', !!action);
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.classList.remove('show'); toast._action = null; }, ms);
}

function windowsChips(windows) {
  if (!windows?.length) return '<span class="chip any">Cualquier hora</span>';
  return windows.map(([a, b]) => `<span class="chip win">${fmt(a)}–${fmt(b)}</span>`).join('');
}

// Qué pasa con el horario del cliente a la hora t: abre más tarde, está abierto hasta…, o ya ha cerrado.
function windowState(windows, t) {
  if (!windows?.length) return { label: 'horario', value: 'Libre' };
  const ws = [...windows].sort((a, b) => a[0] - b[0]);
  for (const [a, b] of ws) {
    if (t < a) return { label: 'abre', value: fmt(a) };
    if (t <= b) return { label: 'cierra', value: fmt(b) };
  }
  return { label: 'cerró', value: fmt(ws[ws.length - 1][1]) };
}

function dayName(iso) {
  const d = new Date(iso + 'T12:00:00');
  const rel = iso === todayIso() ? 'Hoy' : iso === addDays(todayIso(), 1) ? 'Mañana' : iso === addDays(todayIso(), -1) ? 'Ayer' : null;
  let long = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  long = long.charAt(0).toUpperCase() + long.slice(1);
  return { rel: rel || long.split(',')[0], long };
}

function settings() { return store.settings(); }
function currentRoute() { return store.route(ui.date); }

function signature(r) {
  return JSON.stringify([
    settings().shiftStart, settings().returnToDepot, !!settings().orsKey, !!settings().tomtomKey,
    r.stops.map((s) => [s.id, s.lat, s.lon, s.windows, s.service]),
  ]);
}
const isDirty = (r) => !r.plan || r.planSig !== signature(r);
const located = (s) => typeof s.lat === 'number' && typeof s.lon === 'number';
const lateText = (m) => (m > 60 ? 'Fuera de horario' : `${Math.round(m)} min tarde`);
const minOfDay = (ts) => { const d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); };

function defaultDate() {
  const t = todayIso();
  const today = store.db().routes[t];
  if (today && today.stops.length && today.status !== 'done') return t;
  return addDays(t, 1);
}

// ---------- Render principal ----------

function render() {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  const eng = $('#engine');
  const { orsKey, tomtomKey } = settings();
  eng.className = `engine ${tomtomKey && orsKey ? 'live' : orsKey ? 'est' : 'off'}`;
  eng.innerHTML = `<span class="dot"></span>${tomtomKey && orsKey ? 'Tráfico real' : orsKey ? 'Tráfico estimado' : 'Falta configurar'}`;

  const view = $('#view');
  let bar = '';
  if (ui.tab === 'route') {
    $('#title').textContent = 'Ruta';
    view.innerHTML = renderRoute();
    bar = renderActionBar();
  } else if (ui.tab === 'clients') {
    $('#title').textContent = 'Clientes';
    view.innerHTML = renderClients();
  } else {
    $('#title').textContent = 'Ajustes';
    view.innerHTML = renderSettings();
  }
  $('#actionbar').innerHTML = bar;
  $('#actionbar').hidden = !bar;
  document.body.classList.toggle('has-actionbar', !!bar);
  renderUpdate();
  renderSheet();
}

function renderRoute() {
  const r = currentRoute();
  if (r.status === 'active') return renderActive(r);
  if (r.status === 'done') return renderDone(r);
  return renderPlanning(r);
}

function dayBar() {
  const { rel, long } = dayName(ui.date);
  return `<div class="daybar">
    <button class="iconbtn" data-action="day" data-d="-1" aria-label="Día anterior">${I.left}</button>
    <div class="day"><b>${esc(rel)}</b><span>${esc(long)}</span></div>
    <button class="iconbtn" data-action="day" data-d="1" aria-label="Día siguiente">${I.right}</button>
  </div>`;
}

function orderedStops(r) {
  if (!r.plan || isDirty(r)) return r.stops.slice();
  const byId = new Map(r.stops.map((s) => [s.id, s]));
  const ordered = r.plan.order.map((id) => byId.get(id)).filter(Boolean);
  const rest = r.stops.filter((s) => !r.plan.order.includes(s.id));
  return [...ordered, ...rest];
}

function stopCard(s, i, leg, extra = '') {
  const chips = [windowsChips(s.windows)];
  if (s.failed) chips.unshift(`<span class="chip late">No entregado · ${esc(s.failed)}</span>`);
  else if (leg?.late > 0.5) chips.push(`<span class="chip late">${lateText(leg.late)}</span>`);
  else if (leg?.wait > 4) chips.push(`<span class="chip wait">Espera ${Math.round(leg.wait)} min</span>`);
  if (!located(s)) chips.push('<span class="chip late">Sin ubicar</span>');
  else if (s.needsCheck && !s.done) chips.push('<span class="chip check">Revisar dirección</span>');
  const cls = ['stop', s.done ? 'done' : '', s.failed ? 'failed' : '', !located(s) ? 'unlocated' : ''].join(' ');
  const mark = s.failed ? I.x : I.check;
  return `<li><button class="${cls}" data-action="edit-stop" data-id="${esc(s.id)}">
    <span class="num" aria-hidden="true">${s.done ? mark.replace('<svg', '<svg width="16" height="16"') : i}</span>
    <span class="grow">
      <span class="name">${esc(s.name || s.address)}</span>
      <span class="addr ellipsis">${esc(s.label || s.address || 'Sin dirección')}</span>
      <span class="chips">${chips.join('')}</span>
    </span>
    <span class="eta">${leg ? `<b>${fmt(leg.arrive)}</b><span>llegada</span>` : extra}</span>
  </button></li>`;
}

// Lo que ve quien abre la app por primera vez: tres pasos, y cada uno se marca al hacerlo.
function firstSteps() {
  const s = settings();
  const step = (done, n, title, body) => `<li class="${done ? 'ok' : ''}"><span class="n">${done ? I.check : n}</span><div class="grow"><b>${title}</b>${body}</div></li>`;
  return `<div class="card first">
    <div class="serif">Primeros pasos</div>
    <ol class="steps">
      ${step(!!s.orsKey, 1, 'Configura la app',
        `<div class="small muted">Si un compañero te ha pasado su configuración, impórtala y listo. Si no, pon tu clave gratuita en Ajustes.</div>
         <div class="actions2" style="margin:10px 0 0">
           <label class="btn line" style="cursor:pointer">Importar archivo<input type="file" id="import-file" accept="application/json,.json" hidden></label>
           <button class="btn ghost" data-action="tab" data-tab="settings">Ir a Ajustes</button>
         </div>`)}
      ${step(false, 2, 'Practica una ruta',
        `<div class="small muted">6 paradas de ejemplo para probar optimizar, «Voy a salir», Waze, SPRO y «Siguiente». Se borra con un toque.</div>
         <button class="btn ghost block" data-action="demo" style="margin-top:10px">Probar con una ruta de ejemplo</button>`)}
      ${step(false, 3, portalApp() ? 'Trae tu ruta de verdad' : 'Pega tu ruta de verdad', portalApp()
        ? `<div class="small muted">Toca «Traer la ruta del portal», entra con tu usuario del portal (solo la primera vez) y pulsa el botón dorado. Ahí mismo puedes pedir que te avise cuando salga la ruta de mañana.</div>`
        : `<div class="small muted">Desde el portal o el albarán: copia la lista y usa «Pegar lista», o compártela desde WhatsApp a Ruta. Con el albarán en papel: Google Lens → Texto → Compartir → Ruta.</div>`)}
    </ol>
  </div>`;
}

// Ruta de práctica: direcciones reales del Baix Llobregat y Barcelona, horarios a partir de ahora.
const DEMO = [
  ['Ejemplo · Bar La Plaça', "Rambla de Just Oliveras 30, L'Hospitalet de Llobregat", 41.36142, 2.10137, 0, 120],
  ['Ejemplo · Celler de Sants', 'Carrer de Sants 200, Barcelona', 41.37559, 2.13161, 60, 240],
  ['Ejemplo · Vinoteca Castellbell', 'Rambla de la Marquesa de Castellbell 20, Sant Feliu de Llobregat', 41.3808, 2.05197, null],
  ['Ejemplo · Restaurant Despí', 'Avinguda de Barcelona 45, Sant Joan Despí', 41.36855, 2.06432, null],
  ['Ejemplo · Bodega Molins', 'Plaça de la Creu 3, Molins de Rei', 41.41078, 2.01929, 30, 180],
  ['Ejemplo · Taverna Esplugues', 'Carrer de Laureà Miró 290, Esplugues de Llobregat', 41.37793, 2.08432, null],
];

function loadDemo() {
  const t = todayIso();
  const r = store.route(t);
  if (r.stops.length) { ui.date = t; render(); return toast('Hoy ya tienes paradas: la ruta de ejemplo es para un día vacío'); }
  const base = Math.ceil(nowMin() / 15) * 15;
  r.stops = DEMO.map(([name, address, lat, lon, from, to], i) => ({
    id: `demo${i}`, demo: true, name, address, label: address, lat, lon, service: 10, done: false,
    windows: from == null ? [] : [[Math.min(base + from, 23 * 60), Math.min(base + to, 23 * 60 + 59)]],
    notes: i === 1 ? 'Parada de práctica: prueba aquí el botón SPRO y «Dejar para luego».' : '',
  }));
  r.status = 'draft'; r.plan = null; r.current = null;
  store.save();
  ui.date = t; ui.tab = 'route';
  render();
  optimize();
}

function clearDemo() {
  const r = currentRoute();
  r.stops = r.stops.filter((x) => !x.demo);
  r.status = 'draft'; r.plan = null; r.current = null; r.lastChange = null; r.dum = null; r.pairs = {};
  store.save(); render(); toast('Ruta de ejemplo borrada');
}

const demoBanner = (r) => (r.stops.some((x) => x.demo)
  ? `<div class="notice gold compact">${I.info}<div class="grow">Ruta de ejemplo para practicar: no se guarda en tus clientes.</div><button class="btn line" data-action="clear-demo" style="min-height:40px;padding:0 12px">Borrar</button></div>`
  : '');

function renderPlanning(r) {
  const s = settings();
  const dirty = isDirty(r);
  const stops = orderedStops(r);
  const legs = !dirty && r.plan ? new Map(r.plan.legs.map((l) => [l.id, l])) : new Map();
  let html = dayBar() + demoBanner(r);

  if (!r.stops.length) {
    html += settings().orsKey && store.clientList().length ? `<div class="empty">
      <div class="serif">Sin paradas todavía</div>
      <div class="small">Pega la lista de repartos (del portal de Escolà o de un mensaje) o añade las paradas a mano. Las direcciones y horarios que ya conozca la app se rellenan solos.</div>
      <button class="linkbtn" data-action="demo" style="margin-top:8px">Practicar con una ruta de ejemplo (hoy)</button>
    </div>` : firstSteps();
  } else if (!dirty) {
    const p = r.plan;
    html += `<div class="card summary">
      <div><b>${r.stops.length}</b><span>${r.stops.length === 1 ? 'parada' : 'paradas'}</span></div>
      <div><b>${fmt(p.end)}</b><span>${s.returnToDepot ? 'vuelta' : 'última entrega'}</span></div>
      <div><b>${Math.round(p.km)}</b><span>km</span></div>
    </div>`;
    if (p.late > 0.5) {
      const lateOnes = p.legs.filter((l) => l.late > 0.5).map((l) => r.stops.find((x) => x.id === l.id)?.name).filter(Boolean);
      html += `<div class="notice warn">${I.warn}<div>No da tiempo a llegar dentro del horario a <b>${esc(lateOnes.join(', '))}</b>. Revisa sus horarios o avisa al cliente.</div></div>`;
    }
    html += `<div class="notice info">${I.info}<div>Calculada con ${p.source === 'tomtom' ? 'el tráfico previsto para esa hora' : p.source === 'ors' ? 'tiempos de conducción reales y tráfico estimado por hora' : 'distancias aproximadas: añade la clave gratuita de rutas en Ajustes para tiempos reales'}. Salida ${fmt(p.startMin)} desde el almacén.</div></div>`;
  }

  const unloc = r.stops.filter((x) => !located(x)).length;
  if (unloc) html += `<div class="notice warn">${I.warn}<div>${unloc === 1 ? 'Hay 1 parada' : `Hay ${unloc} paradas`} sin ubicar. Tócala para buscar la dirección; mientras tanto no entra en la ruta.</div></div>`;

  if (portalApp()) html += `<a class="btn gold big block" href="${PORTAL_INTENT}" style="margin:14px 0 10px">Traer la ruta del portal</a>`;
  html += `<div class="actions2">
    <button class="btn ghost" data-action="open-paste">${I.paste}Pegar lista</button>
    <button class="btn ghost" data-action="open-stop">${I.plus}Añadir parada</button>
  </div>`;

  if (stops.length) {
    html += `<h2 class="section-title">${dirty ? 'Paradas' : 'Orden óptimo'}</h2><ol class="stops">`;
    html += stops.map((st, i) => stopCard(st, i + 1, legs.get(st.id))).join('');
    html += '</ol>';
  }

  const canPlan = r.stops.some((x) => located(x) && !x.done);
  if (canPlan) {
    html += `<div class="cta-bar${!dirty && !ui.busy && ui.date !== todayIso() ? ' static' : ''}">`;
    if (ui.busy) {
      html += `<button class="btn gold big block" disabled><span class="spin"></span>${esc(ui.busy)}</button>`;
    } else if (dirty) {
      html += `<button class="btn gold big block" data-action="optimize">${I.spark}Optimizar ruta</button>`;
    } else if (ui.date === todayIso()) {
      html += `<button class="btn gold big block" data-action="leave">${I.go}Voy a salir · reconfirmar ruta</button>
        <div class="leave">Salgo
          <span class="seg">${[0, 10, 20].map((m) => `<button data-action="leave-in" data-m="${m}" class="${s.leaveIn === m ? 'on' : ''}" aria-pressed="${s.leaveIn === m}">${m ? `en ${m} min` : 'ya'}</button>`).join('')}</span>
        </div>`;
    } else {
      html += `<div class="notice gold" style="margin:0">${I.check}<div>Ruta lista. ${esc(dayName(ui.date).rel)}, 10 minutos antes de salir, abre la app y pulsa <b>Voy a salir</b>: la reconfirmo con el tráfico de ese momento.</div></div>`;
    }
    html += '</div>';
  }
  return html;
}

function enRouteBar(r) {
  const total = r.stops.length;
  const finished = r.stops.filter((x) => x.done).length;
  const failed = r.stops.filter((x) => x.failed).length;
  return `<div class="enroute">
      <button class="iconbtn" data-action="day" data-d="-1" aria-label="Día anterior">${I.left}</button>
      <div class="grow"><b>${esc(dayName(ui.date).rel)}</b> · ${finished} de ${total} hechas${failed ? ` <span class="late-ink">· ${failed} sin entregar</span>` : ''}
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${finished}"><i style="transform:scaleX(${total ? finished / total : 0})"></i></div>
      </div>
      <button class="iconbtn" data-action="day" data-d="1" aria-label="Día siguiente">${I.right}</button>
    </div>`;
}

function renderActive(r) {
  const finished = r.stops.filter((x) => x.done).length;
  const cur = r.stops.find((x) => x.id === r.current && !x.done);
  const legs = new Map((r.plan?.legs || []).map((l) => [l.id, l]));
  const pendingCount = r.stops.filter((x) => !x.done).length;
  let html = enRouteBar(r) + demoBanner(r);

  if (r.lastChange) {
    html += `<div class="notice compact ${r.lastChange.kind === 'changed' ? 'gold' : 'info'}">${r.lastChange.kind === 'changed' ? I.spark : I.check}<div class="grow">${esc(r.lastChange.text)}</div>
      <button class="iconbtn plain" data-action="dismiss-change" aria-label="Cerrar aviso">${I.x}</button></div>`;
  }

  if (cur) {
    const leg = legs.get(cur.id);
    const ws = windowState(cur.windows, leg ? leg.arrive : nowMin());
    html += `<section class="now" aria-labelledby="now-name">
      <div class="label">${finished === 0 ? 'Primera parada' : 'Siguiente parada'}</div>
      <h2 id="now-name" class="clamp2">${esc(cur.name || cur.address)}</h2>
      <div class="addr clamp2">${esc(cur.label || cur.address || '')}</div>
      <div class="chips" style="margin-top:10px">${dumChip(r, cur)}${windowsChips(cur.windows)}${leg?.late > 0.5 ? `<span class="chip late solid">${lateText(leg.late)}</span>` : ''}${leg?.wait > 4 ? `<span class="chip wait">Abre a las ${fmt(leg.begin)}</span>` : ''}</div>
      <div class="facts">
        <div><b>${leg ? fmt(leg.arrive) : '--:--'}</b><span>llegada</span></div>
        <div><b>${leg ? Math.round(leg.drive) : '–'}</b><span>min de viaje</span></div>
        <div><b>${ws.value}</b><span>${ws.label}</span></div>
      </div>
      ${cur.notes ? `<details class="notes"><summary>${I.info}<span class="clamp2">${esc(cur.notes)}</span></summary><p>${esc(cur.notes)}</p></details>` : ''}
      <div class="minor">
        <a class="pill spro" href="${esc(sproUrl())}" data-action="spro" data-keep-default="1">${I.pin}SPRO · ${r.dum?.id === cur.id ? 'otra vez' : 'aparcar'}</a>
        ${cur.phone ? `<a class="pill" href="tel:${esc(cur.phone.replace(/[^\d+]/g, ''))}">${I.phone}Llamar</a>` : ''}
        ${pendingCount > 1 ? '<button class="pill" data-action="postpone">Dejar para luego</button>' : ''}
        <button class="pill" data-action="edit-stop" data-id="${esc(cur.id)}">Editar</button>
      </div>
    </section>`;
  }

  const upcoming = (r.plan?.order || []).filter((id) => id !== r.current).map((id) => r.stops.find((x) => x.id === id)).filter((x) => x && !x.done);
  if (upcoming.length) {
    html += `<h2 class="section-title">Después</h2><ol class="stops">${upcoming.map((x, i) => stopCard(x, finished + i + 2, legs.get(x.id))).join('')}</ol>`;
  }
  html += finishedList(r);
  html += `<div style="text-align:center;margin-top:18px"><button class="linkbtn" data-action="stop-route">Volver a planificar</button></div>`;
  return html;
}

function finishedList(r) {
  const done = r.stops.filter((x) => x.done).sort((a, b) => a.doneAt - b.doneAt);
  if (!done.length) return '';
  return `<h2 class="section-title">Hechas</h2><ol class="stops">${done.map((x, i) => stopCard(x, i + 1, null, `<b>${fmt(minOfDay(x.doneAt))}</b><span>${x.failed ? 'intento' : 'hecha'}</span>`)).join('')}</ol>
    <div style="text-align:center;margin-top:12px"><button class="linkbtn" data-action="undo">Deshacer la última</button></div>`;
}

// Los dos botones del día a día, siempre a mano del pulgar mientras estás en ruta.
// La entrega se registra en la tablet de reparto: aquí solo se pasa a la siguiente parada.
function renderActionBar() {
  const r = currentRoute();
  if (r.status !== 'active') return '';
  const cur = r.stops.find((x) => x.id === r.current && !x.done);
  if (!cur) return '';
  const s = settings();
  const last = r.stops.filter((x) => !x.done).length === 1;
  return `<a class="btn gold big" href="${esc(navUrl(s.nav, cur))}" target="_blank" rel="noopener">${I.nav}${s.nav === 'gmaps' ? 'Maps' : 'Waze'}</a>
    ${ui.busy ? `<button class="btn forest big" disabled><span class="spin"></span>${esc(ui.busy)}</button>`
      : `<button class="btn forest big" data-action="next">${last ? `${I.check}Terminar` : `${I.right}Siguiente`}</button>`}`;
}

function backupAge() {
  const at = settings().lastBackupAt;
  if (!at) return 'Aún no has hecho ninguna.';
  const days = Math.floor((Date.now() - at) / 86400000);
  return days === 0 ? 'Última: hoy.' : days === 1 ? 'Última: ayer.' : `Última: hace ${days} días.`;
}

// Recordatorio suave: con clientes guardados y sin copia en una semana.
function needsBackup() {
  const at = settings().lastBackupAt || 0;
  return store.clientList().length >= 3 && Date.now() - at > 7 * 86400000;
}

function renderDone(r) {
  const s = settings();
  const done = r.stops.filter((x) => x.done).sort((a, b) => a.doneAt - b.doneAt);
  const delivered = done.filter((x) => !x.failed).length;
  const first = done[0], last = done[done.length - 1];
  return `${dayBar()}<div class="card finish">
      <div class="serif">Ruta terminada</div>
      <div class="muted" style="margin:6px 0 18px">${plural(delivered, 'parada', 'paradas')}${done.length > delivered ? ` · ${done.length - delivered} sin entregar` : ''} · de ${first ? fmt(minOfDay(r.startedAt || first.doneAt)) : '--'} a ${last ? fmt(minOfDay(last.doneAt)) : '--'}</div>
      <a class="btn gold big block" href="${esc(navUrl(s.nav, s.depot))}" target="_blank" rel="noopener">${I.nav}Volver al almacén</a>
      <div style="height:10px"></div>
      <button class="btn ghost block" data-action="goto-tomorrow">Preparar la ruta de mañana</button>
    </div>
    ${needsBackup() ? `<div class="notice gold">${I.info}<div class="grow">Hace más de una semana que no guardas una copia de tus clientes. <button class="linkbtn" data-action="backup" style="color:inherit">Hacer copia ahora</button></div></div>` : ''}
    ${finishedList(r)}`;
}

function renderClients() {
  const q = clientKey(ui.clientFilter);
  const all = store.clientList();
  const list = all.filter((c) => !q || c.key.includes(q) || clientKey(c.address || '').includes(q));
  let html = `<div class="search">${I.search}<input class="input" id="client-search" type="search" aria-label="Buscar cliente o dirección" placeholder="Buscar cliente o dirección" value="${esc(ui.clientFilter)}" autocomplete="off"></div>`;
  if (!all.length) {
    html += `<div class="empty"><div class="serif">La memoria está vacía</div><div class="small">Cada cliente que añadas a una ruta se guarda aquí con su dirección y su horario de entrega. Si un compañero te pasa su archivo de clientes, impórtalo en Ajustes.</div>
      <button class="btn line" style="margin-top:14px" data-action="tab" data-tab="settings">Importar clientes</button></div>`;
    return html;
  }
  html += `<div class="muted small" style="margin:0 2px 10px">${list.length === 1 ? '1 cliente recordado' : `${list.length} clientes recordados`}</div>`;
  html += list.map((c) => `<button class="client" data-action="edit-client" data-key="${esc(c.key)}">
      <span class="row between"><span class="name ellipsis">${esc(c.name)}</span>${c.visits ? `<span class="tiny faint">${esc(plural(c.visits, 'visita', 'visitas'))}</span>` : ''}</span>
      <span class="addr ellipsis">${esc(c.label || c.address || 'Sin dirección')}</span>
      <span class="chips">${windowsChips(c.windows)}${c.serviceLearned ? `<span class="chip any">Descarga ~${esc(c.service)} min</span>` : ''}${c.needsCheck ? '<span class="chip check">Revisar dirección</span>' : ''}</span>
    </button>`).join('');
  return html;
}

function renderSettings() {
  const s = settings();
  return `
  <h2 class="section-title" style="margin-top:6px">Rutas y tráfico</h2>
  <div class="card">
    ${s.orsKey ? '' : `<div class="notice warn" style="margin-top:0">${I.warn}<div>Falta la clave de rutas: sin ella la app ordena las paradas por distancia en línea recta.</div></div>`}
    <label class="field"><span>Clave de rutas (openrouteservice) · necesaria</span>
      <span class="input-row"><input class="input" id="set-ors" value="${esc(s.orsKey)}" placeholder="Pega aquí tu clave" autocomplete="off" autocapitalize="off" spellcheck="false">
      <button class="btn line" data-action="test-ors">Probar</button></span>
    </label>
    <div class="key-help">Gratis y sin tarjeta (500 rutas al día, de sobra):
      <ol><li>Crea una cuenta en <a href="https://account.heigit.org/" target="_blank" rel="noopener">account.heigit.org</a>.</li>
      <li>En el panel crea una clave (token) y cópiala.</li>
      <li>Pégala arriba y pulsa <b>Probar</b>.</li></ol>
    </div>
    <label class="field" style="margin-top:18px"><span>Clave de TomTom · opcional, tráfico en tiempo real</span>
      <span class="input-row"><input class="input" id="set-key" value="${esc(s.tomtomKey)}" placeholder="Pega aquí tu clave" autocomplete="off" autocapitalize="off" spellcheck="false">
      <button class="btn line" data-action="test-key">Probar</button></span>
    </label>
    <div class="key-help">${s.tomtomKey ? 'Activo: la ruta se corrige con el tráfico previsto al planificar y con el de ese momento al salir y en cada parada.' : 'Sin ella el tráfico se estima por franja horaria: no ve accidentes ni cortes.'}
      Gratis y sin tarjeta (20.000 rutas al mes; la app gasta unas 40 al día):
      <ol><li><a href="https://developer.tomtom.com/user/login" target="_blank" rel="noopener">Crea tu cuenta o inicia sesión en TomTom</a>.
        Pulsa el botón rojo <b>Register / sign in</b>; si te pregunta cómo vas a usarlo, elige <b>Build with APIs</b>.</li>
      <li><a href="https://my.tomtom.com/keys" target="_blank" rel="noopener">Abre tus claves</a> y copia la que ya viene creada
        (<b>My first API key</b>). Si no hay ninguna, pulsa <b>Create Key</b>.</li>
      <li>Pégala arriba y pulsa <b>Probar</b>.</li></ol></div>
  </div>

  <h2 class="section-title">Jornada</h2>
  <div class="card">
    <label class="field"><span>Hora de inicio</span><input class="input" type="time" id="set-shift" value="${esc(s.shiftStart)}"></label>
    <label class="field"><span>Minutos de descarga por parada (por defecto)</span><input class="input" type="number" inputmode="numeric" min="1" max="90" id="set-service" value="${esc(s.service)}"></label>
    <label class="toggle"><span>Volver al almacén al acabar<span class="tiny faint" style="display:block">Cuenta el regreso al calcular la ruta</span></span><input type="checkbox" id="set-return" ${s.returnToDepot ? 'checked' : ''}></label>
    <div class="toggle" style="border:0;padding-bottom:0"><span>Navegar con</span>
      <span class="seg"><button data-action="nav-app" data-v="waze" class="${s.nav === 'waze' ? 'on' : ''}" aria-pressed="${s.nav === 'waze'}">Waze</button><button data-action="nav-app" data-v="gmaps" class="${s.nav === 'gmaps' ? 'on' : ''}" aria-pressed="${s.nav === 'gmaps'}">Google Maps</button></span>
    </div>
  </div>

  <h2 class="section-title">Almacén (punto de salida)</h2>
  <div class="card">
    <div class="row"><span style="color:var(--gold);width:20px" aria-hidden="true">${I.pin}</span><div class="grow"><div style="font-weight:600">${esc(s.depot.name)}</div><div class="tiny faint">${esc(Number(s.depot.lat).toFixed(5))}, ${esc(Number(s.depot.lon).toFixed(5))}</div></div>
    <button class="btn line" data-action="change-depot">Cambiar</button></div>
  </div>

  <h2 class="section-title">Copias y compañeros</h2>
  <div class="card">
    <div class="small muted" style="margin-bottom:12px"><b>Copia de seguridad:</b> guarda clientes, horarios y rutas (sin tus claves) en Drive o en un mensaje a ti mismo. ${backupAge()}</div>
    <button class="btn line block" data-action="backup">Hacer copia de seguridad</button>
    <div class="small muted" style="margin:16px 0 12px"><b>Para un compañero nuevo:</b> «Pasar configuración» le deja la app lista (claves, almacén, horario y tus clientes). Lleva tus claves: mándalo solo por privado.
      «Pasar clientes» manda solo direcciones y horarios. Al <b>importar</b> nada se borra: se suma a lo que ya hay.</div>
    <button class="btn line block" data-action="export-config">Pasar configuración</button>
    <div class="actions2" style="margin:10px 0 0">
      <button class="btn ghost" data-action="export">Pasar clientes</button>
      <label class="btn ghost" style="cursor:pointer">Importar<input type="file" id="import-file" accept="application/json,.json" hidden></label>
    </div>
    <div class="tiny ${ui.persisted ? 'faint' : 'warn-ink'}" style="margin-top:12px">${ui.persisted ? 'Datos protegidos: el móvil no los borrará aunque le falte espacio.' : 'El móvil podría borrar los datos si se queda sin espacio o borras los datos de Chrome: haz una copia de vez en cuando.'}</div>
  </div>

  <div class="tiny faint" style="text-align:center;margin:22px 0 4px;line-height:1.6">Ruta Escolà · v${VERSION}<br>
    Clientes y rutas se guardan en este móvil. Para buscar direcciones y calcular tiempos se consultan
    servicios de mapas; tu posición solo se usa para calcular la siguiente parada.<br>
    Direcciones: © <a href="https://www.icgc.cat/" target="_blank" rel="noopener">ICGC</a> (CC BY 4.0) ·
    <a href="https://www.cartociudad.es/" target="_blank" rel="noopener">CartoCiudad</a> © IGN (CC BY 4.0) ·
    © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">colaboradores de OpenStreetMap</a><br>
    Rutas: © <a href="https://openrouteservice.org/" target="_blank" rel="noopener">openrouteservice</a> by HeiGIT${s.tomtomKey ? ' · Tráfico: © TomTom' : ''}</div>`;
}

// ---------- Hojas (formularios) ----------

const background = () => [$('.top'), $('#view'), $('.tabs'), $('#actionbar')];

function snapshot(sh) {
  return JSON.stringify(sh.draft ?? sh.text ?? '');
}

function openSheet(sheet) {
  sheet.initial = snapshot(sheet);
  ui.sheet = sheet;
  renderSheet();
  background().forEach((el) => el && (el.inert = true));
  $('.sheet')?.focus();
}

function closeSheet() {
  ui.sheet = null;
  background().forEach((el) => el && (el.inert = false));
  renderSheet();
}

// Pregunta de sí/no con el diseño de la app. El confirm() del navegador a veces no llega a mostrarse
// dentro de la app instalada (Chrome/Edge lo bloquean), y además sale con el dominio como título.
function ask(text, { ok = 'Aceptar', danger = false } = {}) {
  return new Promise((resolve) => {
    const box = $('#ask');
    const prevFocus = document.activeElement;
    box.innerHTML = `<div class="ask" role="alertdialog" aria-modal="true" aria-labelledby="ask-text">
      <p id="ask-text">${esc(text)}</p>
      <div class="actions2" style="margin:0">
        <button class="btn ghost" data-ask="0">Cancelar</button>
        <button class="btn ${danger ? 'danger' : 'gold'}" data-ask="1">${esc(ok)}</button>
      </div></div>`;
    box.hidden = false;
    $('[data-ask="1"]', box).focus();
    const done = (v) => { box.hidden = true; box.innerHTML = ''; box.onclick = null; prevFocus?.focus?.(); resolve(v); };
    box.onclick = (e) => {
      const b = e.target.closest('[data-ask]');
      if (b) done(b.dataset.ask === '1');
      else if (e.target === box) done(false);
    };
  });
}

// Cerrar sin querer (tocar fuera, otra pestaña) no debe tirar lo que estabas escribiendo.
async function requestCloseSheet() {
  const sh = ui.sheet;
  if (!sh) return true;
  if (sh.busy) return false;
  syncDraft();
  if (snapshot(sh) !== sh.initial && !(await ask('¿Salir sin guardar los cambios?', { ok: 'Salir' }))) return false;
  if (ui.sheet === sh) closeSheet();
  return true;
}

function renderSheet() {
  const wrap = $('#sheet');
  const sh = ui.sheet;
  if (!sh) { wrap.hidden = true; wrap.innerHTML = ''; document.body.style.overflow = ''; return; }
  const scroll = $('.sheet', wrap)?.scrollTop || 0;
  wrap.hidden = false;
  document.body.style.overflow = 'hidden';
  let body = '';
  if (sh.kind === 'stop') body = sheetStop(sh);
  else if (sh.kind === 'paste') body = sheetPaste(sh);
  else if (sh.kind === 'depot') body = sheetDepot(sh);
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1"><div class="grab" aria-hidden="true"></div>${body}</div>`;
  $('.sheet', wrap).scrollTop = scroll;
}

function candidatesHtml(sh) {
  if (sh.searching) return '<div class="muted small" style="margin:-4px 0 14px" role="status"><span class="spin inline"></span> Buscando…</div>';
  if (sh.candidates?.length) {
    return `<div class="candidates">${sh.candidates.map((c, i) => `<button class="cand ${sh.picked === i ? 'on' : ''}" data-action="pick" data-i="${i}" aria-pressed="${sh.picked === i}">${I.pin}<span>${esc(c.label)}${c.doubt ? `<span class="doubt">${c.otherTown ? 'Otra población' : 'Otra calle'}: compruébala</span>` : ''}</span></button>`).join('')}</div>`;
  }
  if (sh.candidates && !sh.candidates.length) return '<div class="hint" style="color:var(--warn)">No he encontrado esa dirección. Prueba con calle, número y población, o pega un enlace de Google Maps.</div>';
  return '';
}

function sheetStop(sh) {
  const d = sh.draft;
  const isClient = sh.mode === 'client';
  const remembered = !isClient && d.name && store.findClient(d.name);
  const names = store.clientList().map((c) => `<option value="${esc(c.name)}">`).join('');
  return `<h2 id="sheet-title">${isClient ? 'Cliente' : sh.id ? 'Editar parada' : 'Nueva parada'}</h2>
    <label class="field"><span>Cliente</span>
      <input class="input" id="f-name" list="client-names" value="${esc(d.name)}" placeholder="Ej. Vinos Paco" autocomplete="off">
      <datalist id="client-names">${names}</datalist>
    </label>
    ${remembered && !sh.id ? `<div class="hint"><span class="chip mem">Recordado</span> dirección y horario rellenados de la última vez</div>` : ''}
    <label class="field"><span>Dirección</span>
      <span class="input-row"><input class="input" id="f-address" value="${esc(d.address)}" placeholder="Calle, número, población" autocomplete="off">
      <button class="btn line" data-action="search-address" aria-label="Buscar dirección">${I.search}</button></span>
    </label>
    ${candidatesHtml(sh)}
    ${located(d) && !sh.candidates?.length ? `<div class="located">${I.pin}<span>${esc(d.label || 'Ubicación guardada')}</span></div>` : ''}

    <div class="field" style="margin-bottom:8px"><span class="small muted" style="font-weight:500" id="win-label">Horario en que acepta entregas</span></div>
    <div class="windows-edit" role="group" aria-labelledby="win-label">
      ${d.windows.map(([a, b], i) => `<div class="win-row">
        <input class="input" type="time" data-win="${i}" data-end="0" value="${fmt(a)}" aria-label="Franja ${i + 1}: desde">
        <span class="sep">a</span>
        <input class="input" type="time" data-win="${i}" data-end="1" value="${fmt(b)}" aria-label="Franja ${i + 1}: hasta">
        <button class="iconbtn" data-action="del-window" data-i="${i}" aria-label="Quitar franja ${i + 1}">${I.x}</button>
      </div>`).join('')}
    </div>
    ${d.windows.length ? '' : '<div class="hint">Sin horario: se le puede entregar a cualquier hora.</div>'}
    <div class="presets">
      <button data-action="add-window" data-a="09:00" data-b="13:00">+ 9:00–13:00</button>
      <button data-action="add-window" data-a="10:00" data-b="13:00">+ 10:00–13:00</button>
      <button data-action="add-window" data-a="16:00" data-b="19:00">+ 16:00–19:00</button>
      <button data-action="add-window" data-other="1" data-a="08:00" data-b="12:00">+ Otra franja</button>
    </div>

    <div class="input-row">
      <label class="field" style="flex:1"><span>Descarga (min)</span><input class="input" type="number" inputmode="numeric" id="f-service" value="${esc(d.service ?? settings().service)}" min="1" max="120"></label>
      <label class="field" style="flex:1.4"><span>Teléfono</span><input class="input" type="tel" id="f-phone" value="${esc(d.phone || '')}" placeholder="Opcional"></label>
    </div>
    ${serviceHint(sh)}
    <label class="field"><span>Notas para la entrega</span><input class="input" id="f-notes" value="${esc(d.notes || '')}" placeholder="Ej. entrar por la puerta de atrás o plaza DUM 08-123"></label>

    <div class="foot">
      <button class="btn gold big block" data-action="save-stop">${isClient ? 'Guardar cliente' : sh.id ? 'Guardar' : 'Añadir a la ruta'}</button>
      ${isClient ? `<button class="btn ghost block" data-action="client-to-route">Añadir a la ruta de ${esc(dayName(ui.date).rel.toLowerCase())}</button>` : ''}
      ${sh.id && !isClient ? '<button class="btn danger block" data-action="remove-stop">Quitar de la ruta</button>' : ''}
      ${isClient ? '<button class="btn danger block" data-action="forget-client">Olvidar este cliente</button>' : ''}
      <button class="btn ghost block" data-action="close">Cancelar</button>
    </div>`;
}

function serviceHint(sh) {
  const d = sh.draft;
  const mem = d.name && store.findClient(d.name);
  const parts = [];
  if (mem?.serviceLearned && mem.service === d.service) parts.push(`Aprendido de tus últimas ${mem.serviceLog.length} entregas aquí.`);
  if (d.service > DUM_MINUTES) parts.push(`Si aparcas en zona DUM, el máximo son ${DUM_MINUTES} min (60 con vehículo de cero emisiones).`);
  return parts.length ? `<div class="hint">${esc(parts.join(' '))}</div>` : '';
}

function sheetPaste(sh) {
  if (sh.portal) return sheetPortal(sh);
  const items = sh.parsed;
  return `<h2 id="sheet-title">Pegar lista</h2>
    <div class="small muted" style="margin:-6px 0 12px" id="paste-help">Copia las paradas del portal, de un mensaje o escríbelas tú: una por línea, o separadas por una línea en blanco. Si pones horarios (9:00-11:30, de 10 a 13h…) los leo.</div>
    <label class="field"><textarea class="input" id="f-paste" aria-label="Lista de paradas" aria-describedby="paste-help" placeholder="Vinos Paco - C/ Major 12, Sant Feliu - 9:00-11:30&#10;Bar La Plaça | Plaça de la Vila 3, Cornellà">${esc(sh.text || '')}</textarea></label>
    ${items ? `<h3 class="section-title" style="margin-top:4px">${items.length === 1 ? '1 parada detectada' : `${items.length} paradas detectadas`}</h3>
      <ul class="parsed">${items.map((it) => {
        const mem = store.findClient(it.name);
        return `<li><b>${esc(it.name)}</b>${mem ? ' <span class="chip mem">Recordado</span>' : ''}<div class="muted small">${esc(it.address || mem?.address || 'Sin dirección: la buscaré por el nombre')}</div>
          <div class="chips" style="margin-top:6px">${windowsChips(it.windows.length ? it.windows : mem?.windows)}</div></li>`;
      }).join('')}</ul>` : ''}
    <div class="foot">
      ${sh.busy ? `<button class="btn gold big block" disabled><span class="spin"></span>${esc(sh.busy)}</button>`
        : items ? `<button class="btn gold big block" data-action="paste-add">${items.length === 1 ? 'Añadir 1 parada' : `Añadir ${items.length} paradas`}</button>`
        : '<button class="btn gold big block" data-action="paste-read">Leer lista</button>'}
      <button class="btn ghost block" data-action="close">Cancelar</button>
    </div>`;
}

function sheetPortal(sh) {
  const { date, stops } = sh.portal;
  const have = new Set(store.route(date).stops.map((x) => clientKey(x.name)));
  const fresh = stops.filter((it) => !have.has(clientKey(it.name)));
  return `<h2 id="sheet-title">Ruta del portal</h2>
    <div class="small muted" style="margin:-6px 0 12px">${esc(dayName(date).long)} · ${stops.length === 1 ? '1 parada' : `${stops.length} paradas`}${fresh.length < stops.length ? ` · ${stops.length - fresh.length} ya estaban en la ruta` : ''}</div>
    <ul class="parsed">${stops.map((it) => {
      const mem = store.findClient(it.name);
      const dup = have.has(clientKey(it.name));
      return `<li${dup ? ' style="opacity:.55"' : ''}><b>${esc(it.name)}</b>${mem ? ' <span class="chip mem">Recordado</span>' : ''}${dup ? ' <span class="chip any">Ya está</span>' : ''}
        <div class="muted small">${esc(it.address)}</div>
        <div class="chips" style="margin-top:6px">${it.closed ? '<span class="chip late">Ese día cierra</span>' : ''}${windowsChips(it.windows.length ? it.windows : mem?.windows)}</div></li>`;
    }).join('')}</ul>
    <div class="foot">
      ${sh.busy ? `<button class="btn gold big block" disabled><span class="spin"></span>${esc(sh.busy)}</button>`
        : fresh.length ? `<button class="btn gold big block" data-action="paste-add">${fresh.length === 1 ? 'Añadir 1 parada' : `Añadir ${fresh.length} paradas`} · ${esc(dayName(date).rel)}</button>`
        : '<button class="btn gold big block" data-action="close">Ya las tienes todas</button>'}
      <button class="btn ghost block" data-action="close">Cancelar</button>
    </div>`;
}

function sheetDepot(sh) {
  return `<h2 id="sheet-title">Punto de salida</h2>
    <label class="field"><span>Dirección del almacén</span>
      <span class="input-row"><input class="input" id="f-address" value="${esc(sh.draft.address || '')}" placeholder="Calle, número, población">
      <button class="btn line" data-action="search-address" aria-label="Buscar dirección">${I.search}</button></span>
    </label>
    ${candidatesHtml(sh)}
    <div class="foot">
      <button class="btn gold big block" data-action="save-depot" ${located(sh.draft) ? '' : 'disabled'}>Guardar</button>
      <button class="btn ghost block" data-action="reset-depot">Volver a Comercial Escolà</button>
      <button class="btn ghost block" data-action="close">Cancelar</button>
    </div>`;
}

// Copia lo escrito en el formulario al borrador antes de redibujar.
function syncDraft() {
  const sh = ui.sheet;
  if (!sh) return;
  if (!sh.draft) { if (sh.kind === 'paste') sh.text = $('#f-paste')?.value ?? sh.text; return; }
  const d = sh.draft;
  const v = (id) => $(id)?.value;
  if ($('#f-name')) d.name = v('#f-name').trim();
  if ($('#f-address')) setDraftAddress(sh, v('#f-address').trim());
  if ($('#f-service')) d.service = Math.min(180, Math.max(1, parseInt(v('#f-service'), 10) || settings().service));
  if ($('#f-phone')) d.phone = v('#f-phone').trim();
  if ($('#f-notes')) d.notes = v('#f-notes').trim();
  document.querySelectorAll('[data-win]').forEach((inp) => {
    const i = +inp.dataset.win, end = +inp.dataset.end;
    const m = toMin(inp.value);
    if (m != null && d.windows[i]) d.windows[i][end] = m;
  });
  d.windows = d.windows.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
}

// Si cambia el texto de la dirección, la ubicación anterior ya no vale.
function setDraftAddress(sh, addr) {
  const d = sh.draft;
  if (addr === (d.address || '')) return;
  d.address = addr;
  d.lat = null; d.lon = null; d.label = '';
  sh.candidates = null; sh.picked = null;
}

function stopDraft(src = {}) {
  return {
    name: src.name || '',
    address: src.address || '',
    lat: located(src) ? src.lat : null,
    lon: located(src) ? src.lon : null,
    label: src.label || '',
    windows: (src.windows || []).map((w) => [...w]),
    service: src.service ?? settings().service,
    phone: src.phone || '', notes: src.notes || '',
    needsCheck: !!src.needsCheck,
  };
}

async function searchAddress() {
  const sh = ui.sheet;
  if (!sh || sh.searching) return;
  syncDraft();
  const byName = sh.kind === 'stop' && !sh.draft.address;
  const q = byName ? sh.draft.name : sh.draft.address;
  if (!q) return toast('Escribe una dirección o el nombre del local');
  const direct = coordsFromText(sh.draft.address);
  sh.searching = true; sh.candidates = null; renderSheet();
  let res = null, error = null;
  try {
    res = await geocode(q, { kind: byName ? 'name' : 'address' });
    // Si con la dirección no sale nada, prueba a buscar el local por su nombre.
    if (!res.length && sh.draft.name && sh.draft.address && !direct) res = await geocode(`${sh.draft.name}, ${sh.draft.address}`, { kind: 'name' });
  } catch (e) {
    error = e;
  }
  sh.searching = false;
  if (ui.sheet !== sh) return; // la hoja se cerró mientras buscaba
  syncDraft(); // no perder lo escrito mientras tanto
  if (error) { sh.candidates = null; toast(error.message || 'No se pudo buscar'); }
  else {
    sh.candidates = res.slice(0, 5);
    if (res.length === 1 && !res[0].doubt) pickCandidate(sh, 0);
  }
  renderSheet();
}

function pickCandidate(sh, i) {
  const c = sh.candidates?.[i];
  if (!c) return;
  sh.picked = i;
  Object.assign(sh.draft, { lat: c.lat, lon: c.lon, label: c.label, needsCheck: false });
}

function fillFromMemory() {
  const sh = ui.sheet;
  if (!sh || sh.kind !== 'stop' || sh.id || sh.mode === 'client') return;
  const mem = store.findClient($('#f-name')?.value || '');
  if (!mem) return;
  syncDraft();
  const d = sh.draft;
  if (!d.address) Object.assign(d, { address: mem.address, lat: located(mem) ? mem.lat : null, lon: located(mem) ? mem.lon : null, label: mem.label || '', needsCheck: !!mem.needsCheck });
  if (!d.windows.length && mem.windows?.length) d.windows = mem.windows.map((w) => [...w]);
  d.service = mem.service ?? d.service;
  d.phone = d.phone || mem.phone || '';
  d.notes = d.notes || mem.notes || '';
  d.name = mem.name;
  renderSheet();
}

// Lo que se guarda de una parada / cliente. lat/lon a null = sin ubicar (también borra una ubicación vieja).
function stopFields(d) {
  const loc = located(d);
  return {
    name: d.name, address: d.address,
    lat: loc ? d.lat : null, lon: loc ? d.lon : null, label: loc ? d.label || '' : '',
    windows: d.windows, service: d.service, phone: d.phone, notes: d.notes,
    needsCheck: loc ? !!d.needsCheck : false,
  };
}

async function saveStop() {
  const sh = ui.sheet;
  if (!sh || sh.saving) return false;
  syncDraft();
  const d = sh.draft;
  if (!d.name && !d.address) { toast('Pon al menos el nombre o la dirección'); return false; }
  if (!d.name) d.name = d.address.slice(0, 120);
  // Quien guarda la ficha ha visto la ubicación que se muestra en ella: se da por revisada.
  if (located(d)) d.needsCheck = false;
  else if (d.address) {
    // Guardar sin pasar por "buscar": tomo el primer resultado y lo marco para revisar.
    sh.saving = true;
    try {
      const [hit] = await geocode(d.address);
      // Un resultado dudoso (otra población u otra calle) no se usa: desviaría la ruta sin que te dieras cuenta.
      if (hit && !hit.doubt) Object.assign(d, { lat: hit.lat, lon: hit.lon, label: hit.label, needsCheck: true });
    } catch { /* se queda sin ubicar */ }
    sh.saving = false;
    if (ui.sheet !== sh) return false;
  }
  const fields = stopFields(d);
  const renamedFrom = sh.mode === 'client' ? sh.key : undefined;
  if (JSON.parse(sh.initial).service !== d.service) Object.assign(fields, { serviceLog: [], serviceLearned: false });
  const isDemo = sh.id && currentRoute().stops.find((x) => x.id === sh.id)?.demo;
  if (!isDemo) store.rememberClient(fields, { renamedFrom });

  if (sh.mode !== 'client') {
    const r = currentRoute();
    const { serviceLog, serviceLearned, ...stopData } = fields;
    if (sh.id) {
      const s = r.stops.find((x) => x.id === sh.id);
      if (s) Object.assign(s, stopData);
    } else {
      r.stops.push({ id: uid(), ...stopData, done: false });
      if (r.status === 'done') r.status = 'draft';
    }
    store.save();
    closeSheet();
    if (r.status === 'active') { replanActive('Parada actualizada'); return true; }
    toast(located(fields) ? (sh.id ? 'Parada guardada' : 'Parada añadida') : 'Guardada sin ubicar: búscala para incluirla');
  } else {
    closeSheet();
    toast('Cliente guardado');
  }
  render();
  return true;
}

// ---------- Planificar ----------

function routeStopsForPlan(r) {
  return r.stops.filter((s) => !s.done && located(s)).map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, windows: s.windows, service: s.service }));
}

async function optimize() {
  const r = currentRoute();
  const s = settings();
  const stops = routeStopsForPlan(r);
  if (!stops.length) return toast('No hay paradas ubicadas');
  let startMin = toMin(s.shiftStart) ?? 450;
  const departAt = new Date(ui.date + 'T00:00:00');
  if (ui.date === todayIso() && nowMin() > startMin) startMin = Math.ceil(nowMin());
  departAt.setMinutes(startMin);
  ui.busy = s.tomtomKey && s.orsKey ? 'Calculando con el tráfico previsto…' : 'Calculando la mejor ruta…';
  render();
  try {
    const plan = await computePlan({ from: s.depot, depot: s.depot, stops, startMin, departAt, orsKey: s.orsKey, tomtomKey: s.tomtomKey, live: false, pairs: {}, returnToDepot: s.returnToDepot });
    r.pairs = plan.pairs; delete plan.pairs;
    r.plan = plan; r.planSig = signature(r); r.status = 'planned';
    store.save();
    toast(plan.warning ? `Ruta aproximada (${plan.warning}). Revisa la clave en Ajustes.` : 'Ruta optimizada', plan.warning ? 6000 : 2600);
  } catch (e) {
    toast(friendlyError(e), 4000);
  }
  ui.busy = null;
  render();
}

function friendlyError(e) {
  if (!navigator.onLine || e?.name === 'TimeoutError' || e?.name === 'TypeError') return 'Sin conexión o muy lenta. Prueba de nuevo cuando tengas cobertura.';
  return e?.message || 'Algo ha fallado al calcular la ruta';
}

async function leave() {
  const r = currentRoute();
  const s = settings();
  const stops = routeStopsForPlan(r);
  const startMin = Math.ceil(nowMin()) + (s.leaveIn || 0);
  const departAt = new Date(Date.now() + (s.leaveIn || 0) * 60000);
  const before = r.plan;
  ui.busy = 'Mirando el tráfico ahora mismo…';
  render();
  try {
    // Los tiempos entre paradas calculados al planificar siguen valiendo; lo que se mira en vivo
    // es la salida desde el almacén. Si se planificó hace más de un día, se recalcula todo.
    const plan = await computePlan({ from: s.depot, depot: s.depot, stops, startMin, departAt, orsKey: s.orsKey, tomtomKey: s.tomtomKey, live: true, pairs: r.pairs || {}, maxAgeMin: 24 * 60, returnToDepot: s.returnToDepot });
    r.pairs = plan.pairs; delete plan.pairs;
    const changed = before && before.order.join() !== plan.order.join();
    r.lastChange = plan.warning
      ? { kind: 'same', text: `Ruta aproximada: ${plan.warning}. Vuelta prevista a las ${fmt(plan.end)}.` }
      : changed
        ? { kind: 'changed', text: `He cambiado el orden según el tráfico de ahora. Vuelta prevista a las ${fmt(plan.end)}.` }
        : { kind: 'same', text: `Ruta confirmada: el orden se mantiene. Vuelta prevista a las ${fmt(plan.end)}.` };
    r.plan = plan; r.planSig = signature(r);
    r.status = 'active'; r.current = plan.order[0]; r.startedAt = departAt.getTime(); r.postponed = [];
    markCurrent(r, plan.legs[0], departAt.getTime());
    store.save();
  } catch (e) {
    // Sin red: se sale con el plan del día anterior.
    if (!before) { ui.busy = null; render(); return toast(friendlyError(e), 4000); }
    r.status = 'active'; r.current = before.order.find((id) => stops.some((x) => x.id === id)); r.startedAt = Date.now(); r.postponed = [];
    r.lastChange = { kind: 'same', text: 'No he podido consultar el tráfico ahora; sigues con la ruta planificada.' };
    store.save();
  }
  ui.busy = null;
  render();
  window.scrollTo({ top: 0, behavior: smooth() });
}

// Recalcula lo que queda desde donde estás (GPS o la última parada) con tráfico en vivo.
async function replanActive(msg) {
  const r = currentRoute();
  const s = settings();
  ui.busy = 'Calculando la siguiente…';
  render();
  const gps = await currentPosition(4000);

  // Se mira qué queda después de esperar al GPS, por si algo cambió mientras tanto.
  const pending = r.stops.filter((x) => !x.done && located(x));
  if (!pending.length) {
    r.status = 'done'; r.current = null; r.pairs = {};
    store.save(); ui.busy = null; render();
    window.scrollTo({ top: 0, behavior: smooth() });
    return toast('¡Ruta terminada!');
  }
  r.postponed = (r.postponed || []).filter((id) => pending.some((p) => p.id === id));
  const postponed = new Set(r.postponed.length < pending.length ? r.postponed : []);
  const active = pending.filter((p) => !postponed.has(p.id));
  const lastDone = r.stops.filter((x) => x.done).sort((a, b) => b.doneAt - a.doneAt)[0];
  const from = gps && gps.accuracy < 1000 ? gps : lastDone && located(lastDone) ? lastDone : s.depot;
  try {
    const plan = await computePlan({
      from, depot: s.depot, startMin: nowMin(), departAt: new Date(), orsKey: s.orsKey, tomtomKey: s.tomtomKey, live: true,
      stops: active.map((x) => ({ id: x.id, lat: x.lat, lon: x.lon, windows: x.windows, service: x.service })),
      pairs: r.pairs || {}, returnToDepot: s.returnToDepot,
    });
    r.pairs = plan.pairs; delete plan.pairs;
    plan.order.push(...r.postponed.filter((id) => postponed.has(id)));
    r.plan = plan; r.planSig = signature(r);
    r.current = plan.order[0];
    markCurrent(r, plan.legs[0], Date.now());
    const next = r.stops.find((x) => x.id === r.current);
    const leg = plan.legs[0];
    if (plan.warning) toast(`Siguiente: ${next.name} · ruta aproximada (${plan.warning})`, 5000);
    else if (msg !== null) toast(msg || `Siguiente: ${next.name}${leg ? ` · llegada ${fmt(leg.arrive)}` : ''}`, 3200);
  } catch {
    // Sin red: siguiente del orden previsto.
    const order = (r.plan?.order || []).filter((id) => active.some((p) => p.id === id));
    r.current = order[0] || active[0].id;
    r.plan = { ...(r.plan || {}), order: [...order, ...active.filter((p) => !order.includes(p.id)).map((p) => p.id), ...[...postponed]] };
    toast('Sin conexión: sigo el orden previsto', 3200);
  }
  r.lastChange = null;
  store.save();
  ui.busy = null;
  render();
  window.scrollTo({ top: 0, behavior: smooth() });
}

// Apunta cuándo sales hacia la parada actual y cuánto se prevé de viaje y de espera: al entregarla,
// lo que sobra es lo que has tardado en descargar.
function markCurrent(r, leg, since) {
  const cur = r.stops.find((x) => x.id === r.current);
  if (!cur || !leg || leg.id !== cur.id) return;
  cur.trip = { since, drive: leg.drive, wait: leg.wait || 0 };
}

function learnFrom(cur) {
  if (!cur.trip) return;
  const minutes = (Date.now() - cur.trip.since) / 60000 - cur.trip.drive - cur.trip.wait;
  delete cur.trip;
  store.learnService(cur.name, minutes);
}

// Marca la parada actual como hecha y pasa a la siguiente, con opción de deshacer.
async function finishCurrent() {
  const r = currentRoute();
  const cur = r.stops.find((x) => x.id === r.current && !x.done);
  if (!cur) return;
  cur.done = true; cur.doneAt = Date.now();
  delete cur.failed;
  const mem = store.findClient(cur.name);
  if (mem) store.rememberClient({ name: mem.name, visits: (mem.visits || 0) + 1, lastVisit: ui.date });
  learnFrom(cur);
  delete cur.trip;
  if (r.dum?.id === cur.id) r.dum = null;
  r.postponed = (r.postponed || []).filter((id) => id !== cur.id);
  store.save();
  await replanActive(null);
  const r2 = currentRoute();
  const next = r2.stops.find((x) => x.id === r2.current);
  const what = `Hecha: ${cur.name}`;
  toast(next && r2.status === 'active' ? `${what} · siguiente: ${next.name}` : what, 6000, { label: 'Deshacer', fn: () => undoLast() });
}

function undoLast() {
  if (ui.busy) return;
  const r = currentRoute();
  const last = r.stops.filter((x) => x.done).sort((a, b) => b.doneAt - a.doneAt)[0];
  if (!last) return;
  last.done = false; delete last.doneAt;
  if (!last.failed) {
    const mem = store.findClient(last.name);
    if (mem?.visits) store.rememberClient({ name: mem.name, visits: mem.visits - 1 });
  }
  delete last.failed;
  r.status = 'active'; r.current = last.id;
  r.plan = { ...(r.plan || { legs: [] }), order: [last.id, ...(r.plan?.order || []).filter((id) => id !== last.id)] };
  store.save(); render(); toast(`${last.name} vuelve a estar pendiente`);
}

// ---------- Eventos ----------

// Mientras se calcula algo de la ruta, estas acciones esperan: evita estados a medias.
const BLOCKED_WHILE_BUSY = new Set(['next', 'postpone', 'undo', 'edit-stop', 'leave', 'optimize', 'stop-route', 'open-stop', 'open-paste', 'remove-stop', 'day', 'demo', 'clear-demo']);

const actions = {
  tab: async (el) => { if (!(await requestCloseSheet())) return; ui.tab = el.dataset.tab; render(); window.scrollTo(0, 0); },
  day: (el) => { ui.date = addDays(ui.date, +el.dataset.d); render(); },
  'goto-tomorrow': () => { ui.date = addDays(todayIso(), 1); render(); },
  'leave-in': (el) => { store.setSettings({ leaveIn: +el.dataset.m }); render(); },
  optimize: () => optimize(),
  leave: () => leave(),
  next: () => finishCurrent(),
  postpone: () => {
    const r = currentRoute();
    if (ui.sheet) closeSheet();
    r.postponed = [...new Set([...(r.postponed || []), r.current])];
    store.save();
    replanActive('Dejada para el final');
  },
  undo: () => undoLast(),
  'stop-route': async () => {
    if (!(await ask('¿Volver a planificar? Las paradas hechas se mantienen marcadas.', { ok: 'Volver a planificar' }))) return;
    const r = currentRoute();
    r.status = 'draft'; r.current = null; r.plan = null; r.lastChange = null;
    store.save(); render();
  },
  'dismiss-change': () => { currentRoute().lastChange = null; store.save(); render(); },
  'open-stop': () => openSheet({ kind: 'stop', draft: stopDraft() }),
  'edit-stop': (el) => {
    const s = currentRoute().stops.find((x) => x.id === el.dataset.id);
    if (s) openSheet({ kind: 'stop', id: s.id, draft: stopDraft(s) });
  },
  'edit-client': (el) => {
    const c = store.findClient(store.db().clients[el.dataset.key]?.name || '');
    if (c) openSheet({ kind: 'stop', mode: 'client', key: c.key, draft: stopDraft(c) });
  },
  'open-paste': () => openSheet({ kind: 'paste', text: '' }),
  'paste-read': () => {
    syncDraft();
    const portal = parsePortal(ui.sheet.text);
    if (portal) { ui.sheet.portal = portal; ui.sheet.parsed = portal.stops; return renderSheet(); }
    const parsed = parseList(ui.sheet.text);
    if (!parsed.length) return toast('No veo ninguna parada en el texto');
    ui.sheet.parsed = parsed;
    renderSheet();
  },
  'paste-add': () => pasteAdd(),
  'search-address': () => searchAddress(),
  pick: (el) => { syncDraft(); pickCandidate(ui.sheet, +el.dataset.i); renderSheet(); },
  'add-window': (el) => {
    syncDraft();
    const d = ui.sheet.draft;
    let a = toMin(el.dataset.a), b = toMin(el.dataset.b);
    if (el.dataset.other && d.windows.length) { a = Math.min(d.windows[d.windows.length - 1][1] + 60, 22 * 60); b = Math.min(a + 180, 23 * 60 + 59); }
    d.windows.push([a, b]);
    d.windows.sort((x, y) => x[0] - y[0]);
    renderSheet();
  },
  'del-window': (el) => { syncDraft(); ui.sheet.draft.windows.splice(+el.dataset.i, 1); renderSheet(); },
  'save-stop': () => saveStop(),
  'remove-stop': async () => {
    const r = currentRoute();
    const id = ui.sheet.id;
    const s = r.stops.find((x) => x.id === id);
    if (!(await ask(`¿Quitar ${s?.name || 'esta parada'} de la ruta?`, { ok: 'Quitar', danger: true }))) return;
    const idx = r.stops.indexOf(s);
    r.stops = r.stops.filter((x) => x.id !== id);
    if (r.current === id) r.current = null;
    store.save(); closeSheet();
    const restore = () => { r.stops.splice(idx, 0, s); store.save(); if (r.status === 'active') replanActive('Parada recuperada'); else render(); };
    if (r.status === 'active') replanActive(null).then(() => toast('Parada quitada', 6000, { label: 'Deshacer', fn: restore }));
    else { render(); toast('Parada quitada', 6000, { label: 'Deshacer', fn: restore }); }
  },
  'forget-client': async () => {
    const key = ui.sheet.key;
    if (!(await ask('¿Olvidar este cliente? Se borra su dirección y horario guardados.', { ok: 'Olvidar', danger: true }))) return;
    store.forgetClient(key); closeSheet(); render();
  },
  'client-to-route': async () => {
    syncDraft();
    const name = ui.sheet.draft.name || ui.sheet.draft.address;
    if (!(await saveStop())) return;
    const target = store.findClient(name);
    if (!target) return;
    const r = currentRoute();
    r.stops.push({ id: uid(), ...stopFields(stopDraft(target)), done: false });
    if (r.status === 'done') r.status = 'draft';
    store.save();
    ui.tab = 'route';
    if (r.status === 'active') return replanActive(`${target.name} añadido a la ruta`);
    render();
    toast(`${target.name} añadido a ${dayName(ui.date).rel.toLowerCase()}`);
  },
  close: () => requestCloseSheet(),
  'nav-app': (el) => { store.setSettings({ nav: el.dataset.v === 'gmaps' ? 'gmaps' : 'waze' }); render(); },
  'test-key': () => testKey(),
  'test-ors': () => testOrs(),
  'change-depot': () => openSheet({ kind: 'depot', draft: { address: '', lat: null, lon: null, label: '' } }),
  'save-depot': () => {
    const d = ui.sheet.draft;
    if (!located(d)) return;
    store.setSettings({ depot: { name: (d.label || d.address).slice(0, 120), lat: d.lat, lon: d.lon } });
    closeSheet(); render(); toast('Punto de salida cambiado');
  },
  'reset-depot': () => { store.setSettings({ depot: store.DEFAULT_DEPOT }); closeSheet(); render(); toast('Salida: Comercial Escolà'); },
  export: () => exportClients(),
  'export-config': () => exportConfig(),
  demo: () => loadDemo(),
  'clear-demo': () => clearDemo(),
  backup: () => backup(),
  spro: () => {
    const r = currentRoute();
    // Se redibuja después: si el enlace desaparece antes de abrirse, Android no llega a abrir SPRO.
    if (r.current) { r.dum = { id: r.current, at: Date.now() }; store.save(); setTimeout(render, 600); }
  },
  'apply-update': () => applyUpdate(),
};

async function pasteAdd() {
  const sh = ui.sheet;
  if (sh.busy) return;
  const portal = sh.portal;
  if (portal) ui.date = portal.date;
  const r = currentRoute();
  const have = new Set(r.stops.map((x) => clientKey(x.name)));
  const items = portal ? sh.parsed.filter((it) => !have.has(clientKey(it.name))) : sh.parsed;
  let n = 0, unlocated = 0;
  for (const it of items) {
    n++;
    sh.busy = `Buscando direcciones ${n}/${items.length}…`;
    renderSheet();
    const mem = store.findClient(it.name);
    const stop = stopDraft(mem || {});
    stop.name = (mem?.name || it.name).slice(0, 120);
    if (it.windows.length) stop.windows = it.windows;
    if (it.phone) stop.phone = it.phone;
    const addressChanged = it.address && clientKey(it.address) !== clientKey(mem?.address || '');
    if (it.address) stop.address = it.address;
    if (!mem || addressChanged || !located(stop)) {
      stop.lat = null; stop.lon = null; stop.label = '';
      try {
        const [hit] = await geocode(it.address || it.name, { kind: it.address ? 'address' : 'name' });
        if (hit && !hit.doubt) Object.assign(stop, { lat: hit.lat, lon: hit.lon, label: hit.label, needsCheck: true });
      } catch { /* queda sin ubicar */ }
    }
    if (!located(stop)) unlocated++;
    const fields = stopFields(stop);
    if (portal) {
      // Del portal se recuerda dónde está y el teléfono; el horario solo si vale para todos los días.
      store.rememberClient({ ...fields, notes: undefined, windows: it.clientWindows.length ? it.clientWindows : undefined });
      fields.notes = [mem?.notes, it.notes].filter(Boolean).join('\n').slice(0, 500);
    } else store.rememberClient(fields);
    r.stops.push({ id: uid(), ...fields, done: false });
  }
  if (r.status === 'done') r.status = 'draft';
  store.save();
  sh.busy = null;
  closeSheet();
  const added = items.length === 1 ? '1 parada añadida' : `${items.length} paradas añadidas`;
  toast(unlocated ? `${added} · ${unlocated} sin ubicar` : added);
  if (r.status === 'active') return replanActive(null);
  if (r.stops.some(located)) await optimize(); else render();
}

const PROBE = [{ lat: 41.372083, lon: 2.077356 }, { lat: 41.3756, lon: 2.1316 }]; // almacén → Carrer de Sants

async function testKey() {
  const key = $('#set-key').value.trim();
  store.setSettings({ tomtomKey: key });
  if (!key) { render(); return toast('Clave de TomTom quitada: tráfico estimado'); }
  try {
    const legs = await trafficLegs(PROBE, { key, live: true });
    if (!legs) throw new Error('TomTom no ha respondido; prueba en un rato');
    toast(`Clave correcta: tráfico real activado ✓ (almacén → Sants ahora: ${Math.round(legs[0])} min)`, 4000);
  } catch (e) {
    toast(e.message || 'La clave no funciona', 4000);
  }
  render();
}

async function testOrs() {
  const key = $('#set-ors').value.trim();
  store.setSettings({ orsKey: key });
  if (!key) { render(); return toast('Clave de rutas quitada'); }
  try {
    const mx = await travelMatrix([PROBE[0]], [PROBE[1]], { orsKey: key, departAt: new Date() });
    toast(`Clave correcta ✓ (almacén → Sants: ${mx.km[0][0].toFixed(1)} km)`, 4000);
  } catch (e) {
    toast(e.message || 'La clave no funciona', 4000);
  }
  render();
}

function shareFile(json, name, title) {
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) return navigator.share({ files: [file], title }).then(() => true, () => false);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return Promise.resolve(true);
}

function exportClients() {
  shareFile(store.exportClients(), `clientes-ruta-${todayIso()}.json`, 'Clientes · Ruta Escolà');
}

async function exportConfig() {
  if (!settings().orsKey && !settings().tomtomKey) return toast('Primero pon tus claves en Ajustes');
  const ok = await ask('El archivo lleva tus claves de rutas y tráfico. Pásalo solo por privado a compañeros de Escolà, nunca en grupos ni redes.', { ok: 'Entendido, pasar' });
  if (ok) shareFile(store.exportConfig(), `configuracion-ruta-${todayIso()}.json`, 'Configuración · Ruta Escolà');
}

async function backup() {
  const ok = await shareFile(store.exportBackup(), `copia-ruta-escola-${todayIso()}.json`, 'Copia de seguridad · Ruta Escolà');
  if (ok) { store.markBackup(); toast('Copia guardada ✓'); render(); }
}

// ---------- Actualizaciones ----------

function renderUpdate() {
  const el = $('#update');
  el.hidden = !ui.update;
  el.innerHTML = ui.update ? `<span>Hay una versión nueva de la app.</span><button class="btn gold" data-action="apply-update">Actualizar</button>` : '';
}

function applyUpdate() {
  if (ui.sheet || ui.busy) return toast('Termina lo que estás haciendo y vuelve a pulsar Actualizar');
  ui.update?.postMessage('SKIP_WAITING');
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  // Solo se recarga al cambiar de versión, no la primera vez que el service worker toma el control.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (w) => { if (w && navigator.serviceWorker.controller) { ui.update = w; renderUpdate(); } };
    offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
}

// ---------- Escuchas ----------

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-toast-action]')) {
    const fn = toast._action;
    $('#toast').classList.remove('show');
    toast._action = null;
    fn?.();
    return;
  }
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) {
    if (!el.dataset.keepDefault) e.preventDefault();
    if (ui.busy && BLOCKED_WHILE_BUSY.has(el.dataset.action)) return;
    actions[el.dataset.action](el);
    return;
  }
  if (e.target.id === 'sheet') requestCloseSheet(); // tocar fuera de la hoja
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'f-name') fillFromMemory();
  if (t.id === 'f-address' && ui.sheet?.draft) {
    // Sin redibujar, para no perder el toque en "buscar".
    setDraftAddress(ui.sheet, t.value.trim());
    if (!located(ui.sheet.draft)) $('.located')?.remove();
  }
  if (t.dataset.win !== undefined) syncDraft();
  if (t.id === 'set-shift') store.setSettings({ shiftStart: t.value || '07:30' });
  if (t.id === 'set-service') store.setSettings({ service: Math.min(180, Math.max(1, parseInt(t.value, 10) || 10)) });
  if (t.id === 'set-return') store.setSettings({ returnToDepot: t.checked });
  if (t.id === 'set-key') store.setSettings({ tomtomKey: t.value.trim() });
  if (t.id === 'set-ors') store.setSettings({ orsKey: t.value.trim() });
  if (t.id === 'import-file' && t.files[0]) {
    t.files[0].text().then(async (txt) => {
      t.value = '';
      try {
        let applied = [];
        const data = JSON.parse(txt);
        if (data?.kind === 'config') {
          const n = Object.keys(data.clients || {}).length;
          const ok = await ask(`Configuración de un compañero: claves, almacén, horario y ${plural(n, 'cliente', 'clientes')}. ¿Aplicarla? No se borra nada tuyo.`, { ok: 'Aplicar' });
          if (!ok) return;
          applied = store.applyConfig(data.settings);
        }
        const { added, updated, routes } = store.importClients(txt);
        toast([applied.length ? `Listo: ${applied.join(', ')}` : '', `${plural(added, 'cliente nuevo', 'clientes nuevos')} · ${updated} actualizados`,
          routes ? plural(routes, 'ruta recuperada', 'rutas recuperadas') : ''].filter(Boolean).join(' · '), 5000);
        render();
      } catch (err) {
        toast(/grande/.test(err.message) ? 'El archivo es demasiado grande' : 'Ese archivo no es de la app Ruta');
      }
    });
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'client-search') {
    ui.clientFilter = e.target.value;
    const pos = e.target.selectionStart;
    $('#view').innerHTML = renderClients();
    const inp = $('#client-search');
    inp.focus(); inp.setSelectionRange(pos, pos);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#ask').hidden) return; // la pregunta se cierra con sus botones
  if (e.key === 'Escape' && ui.sheet) requestCloseSheet();
  if (e.key === 'Enter' && e.target.id === 'f-address') { e.preventDefault(); searchAddress(); }
});

// Al volver a la app (p. ej. desde Waze), refresca horas y estado.
document.addEventListener('visibilitychange', () => { if (!document.hidden && !ui.sheet && !ui.busy) render(); });

// La cuenta atrás de la zona DUM se actualiza cada 20 s sin redibujar la pantalla.
setInterval(() => {
  const chip = $('#dum-chip');
  if (!chip || ui.tab !== 'route') return;
  const r = currentRoute();
  const cur = r.stops.find((x) => x.id === r.current && !x.done);
  if (cur) chip.outerHTML = dumChip(r, cur);
}, 20000);

// ---------- Recibir una lista compartida (WhatsApp, portal, correo…) ----------

// La APK (desde la 1.2.0) tiene una pantalla con el portal que trae la ruta; se abre con este enlace.
const PORTAL_INTENT = 'intent://portal#Intent;scheme=rutaescola;package=com.flixescola.ruta;end';

function portalApp() {
  try {
    const [major, minor] = (localStorage.getItem('ruta-apk') || '').split('.').map(Number);
    return major > 1 || (major === 1 && minor >= 2);
  } catch { return false; }
}

// Lo que llega al abrir la app: una lista compartida (?text=), la ruta del portal que manda la APK
// (#portal=, que nunca sale del móvil) y la versión de la APK (?apk=).
function incoming() {
  const q = new URLSearchParams(location.search);
  const apk = q.get('apk');
  if (apk) try { localStorage.setItem('ruta-apk', apk.slice(0, 20)); } catch { /* sin almacenamiento */ }
  let text = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join('\n').trim();
  if (location.hash.startsWith('#portal=')) {
    try { text = decodeURIComponent(location.hash.slice('#portal='.length)); } catch { text = ''; }
  }
  if (location.search || location.hash) history.replaceState(null, '', location.pathname);
  return text.slice(0, 100000);
}

// Lo recibido va a la hoja de "Pegar lista", ya leído, para revisarlo antes de añadir.
function receive(text) {
  if (!text) return;
  const portal = parsePortal(text);
  if (ui.sheet) closeSheet();
  if (ui.tab !== 'route') { ui.tab = 'route'; render(); }
  openSheet({ kind: 'paste', text: portal ? '' : text, portal });
  ui.sheet.parsed = portal ? portal.stops : parseList(text);
  ui.sheet.initial = '';
  renderSheet();
}

// ---------- Arranque ----------

store.setSaveErrorHandler(() => toast('No queda espacio para guardar. Exporta tus clientes y borra rutas antiguas.', 8000));
store.pruneOldRoutes();
ui.date = defaultDate();
const first = incoming();
render();
receive(first);
// Con la app ya abierta, la APK manda la ruta cambiando solo el #: no se recarga la página.
window.addEventListener('hashchange', () => receive(incoming()));
store.requestPersist().then((p) => { ui.persisted = p; if (ui.tab === 'settings' && !ui.sheet) render(); });
registerServiceWorker();
