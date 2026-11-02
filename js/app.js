import { parseList, fmt, toMin, clientKey } from './parse.js';
import { geocode, navUrl, currentPosition, coordsFromText } from './geo.js';
import { computePlan } from './planner.js';
import * as store from './store.js';

// ---------- Utilidades ----------

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
const todayIso = () => store.isoDate();
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return store.isoDate(d); };

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

const ui = {
  tab: 'route',
  date: null,
  busy: null, // texto del botón ocupado
  clientFilter: '',
  sheet: null, // { kind, ... }
};

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

function windowsChips(windows) {
  if (!windows?.length) return '<span class="chip any">Cualquier hora</span>';
  return windows.map(([a, b]) => `<span class="chip win">${fmt(a)}–${fmt(b)}</span>`).join('');
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
    settings().shiftStart, settings().returnToDepot, !!settings().tomtomKey,
    r.stops.map((s) => [s.id, s.lat, s.lon, s.windows, s.service]),
  ]);
}
const isDirty = (r) => !r.plan || r.planSig !== signature(r);
const located = (s) => typeof s.lat === 'number' && typeof s.lon === 'number';

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
  const live = !!settings().tomtomKey;
  eng.className = `engine ${live ? 'live' : 'est'}`;
  eng.innerHTML = `<span class="dot"></span>${live ? 'Tráfico real' : 'Tráfico estimado'}`;

  const view = $('#view');
  if (ui.tab === 'route') {
    $('#title').textContent = 'Ruta';
    view.innerHTML = renderRoute();
  } else if (ui.tab === 'clients') {
    $('#title').textContent = 'Clientes';
    view.innerHTML = renderClients();
  } else {
    $('#title').textContent = 'Ajustes';
    view.innerHTML = renderSettings();
  }
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
  if (leg?.late > 0.5) chips.push(`<span class="chip late">${lateText(leg.late)}</span>`);
  else if (leg?.wait > 4) chips.push(`<span class="chip wait">Espera ${Math.round(leg.wait)} min</span>`);
  if (!located(s)) chips.push('<span class="chip late">Sin ubicar</span>');
  else if (s.needsCheck) chips.push('<span class="chip check">Revisar dirección</span>');
  const cls = ['stop', s.done ? 'done' : '', !located(s) ? 'unlocated' : ''].join(' ');
  return `<li><button class="${cls}" data-action="edit-stop" data-id="${s.id}">
    <span class="num">${s.done ? I.check.replace('<svg', '<svg width="16" height="16"') : i}</span>
    <span class="grow">
      <div class="name">${esc(s.name || s.address)}</div>
      <div class="addr ellipsis">${esc(s.label || s.address || 'Sin dirección')}</div>
      <div class="chips">${chips.join('')}</div>
    </span>
    <span class="eta">${leg ? `<b>${fmt(leg.arrive)}</b><span>llegada</span>` : extra}</span>
  </button></li>`;
}

function renderPlanning(r) {
  const s = settings();
  const dirty = isDirty(r);
  const stops = orderedStops(r);
  const legs = !dirty && r.plan ? new Map(r.plan.legs.map((l) => [l.id, l])) : new Map();
  let html = dayBar();

  if (!r.stops.length) {
    html += `<div class="empty">
      <div class="serif">Sin paradas todavía</div>
      <div class="small">Pega la lista del portal o añade las paradas a mano. Las direcciones y horarios que ya conozca la app se rellenan solos.</div>
    </div>`;
  } else if (!dirty) {
    const p = r.plan;
    html += `<div class="card summary">
      <div><b>${r.stops.length}</b><span>paradas</span></div>
      <div><b>${fmt(p.end)}</b><span>${s.returnToDepot ? 'vuelta' : 'última entrega'}</span></div>
      <div><b>${Math.round(p.km)}</b><span>km</span></div>
    </div>`;
    if (p.late > 0.5) {
      const lateOnes = p.legs.filter((l) => l.late > 0.5).map((l) => r.stops.find((x) => x.id === l.id)?.name).filter(Boolean);
      html += `<div class="notice warn">${I.warn}<div>No da tiempo a llegar dentro del horario a <b>${esc(lateOnes.join(', '))}</b>. Revisa sus horarios o avisa al cliente.</div></div>`;
    }
    html += `<div class="notice info">${I.info}<div>Calculada con ${p.source === 'tomtom' ? 'el tráfico previsto para esa hora' : 'tiempos estimados (sin clave de tráfico)'}. Salida ${fmt(p.startMin)} desde el almacén.</div></div>`;
  }

  const unloc = r.stops.filter((x) => !located(x)).length;
  if (unloc) html += `<div class="notice warn">${I.warn}<div>${unloc === 1 ? 'Hay 1 parada' : `Hay ${unloc} paradas`} sin ubicar. Tócala para buscar la dirección; mientras tanto no entra en la ruta.</div></div>`;

  html += `<div class="actions2">
    <button class="btn ghost" data-action="open-paste">${I.paste}Pegar lista</button>
    <button class="btn ghost" data-action="open-stop">${I.plus}Añadir parada</button>
  </div>`;

  if (stops.length) {
    html += `<div class="section-title">${dirty ? 'Paradas' : 'Orden óptimo'}</div><ol class="stops">`;
    html += stops.map((st, i) => stopCard(st, i + 1, legs.get(st.id))).join('');
    html += '</ol>';
  }

  const canPlan = r.stops.some(located);
  if (canPlan) {
    html += `<div class="cta-bar${!dirty && !ui.busy && ui.date !== todayIso() ? ' static' : ''}">`;
    if (ui.busy) {
      html += `<button class="btn gold big block" disabled><span class="spin"></span>${esc(ui.busy)}</button>`;
    } else if (dirty) {
      html += `<button class="btn gold big block" data-action="optimize">${I.spark}Optimizar ruta</button>`;
    } else if (ui.date === todayIso()) {
      html += `<button class="btn gold big block" data-action="leave">${I.go}Voy a salir · reconfirmar ruta</button>
        <div class="leave">Salgo
          <span class="seg">${[0, 10, 20].map((m) => `<button data-action="leave-in" data-m="${m}" class="${s.leaveIn === m ? 'on' : ''}">${m ? `en ${m} min` : 'ya'}</button>`).join('')}</span>
        </div>`;
    } else {
      html += `<div class="notice gold" style="margin:0">${I.check}<div>Ruta lista. ${esc(dayName(ui.date).rel)}, 10 minutos antes de salir, abre la app y pulsa <b>Voy a salir</b>: la reconfirmo con el tráfico de ese momento.</div></div>`;
    }
    html += '</div>';
  }
  return html;
}

function renderActive(r) {
  const s = settings();
  const total = r.stops.length;
  const doneCount = r.stops.filter((x) => x.done).length;
  const cur = r.stops.find((x) => x.id === r.current);
  const legs = new Map((r.plan?.legs || []).map((l) => [l.id, l]));
  let html = `${dayBar()}<div class="row between small"><span class="muted">${doneCount} de ${total} entregadas</span><span class="faint">En ruta</span></div>
    <div class="progress"><i style="transform:scaleX(${doneCount / total})"></i></div>`;

  if (r.lastChange) {
    html += `<div class="notice ${r.lastChange.kind === 'changed' ? 'gold' : 'info'}">${r.lastChange.kind === 'changed' ? I.spark : I.check}<div class="grow">${esc(r.lastChange.text)}</div>
      <button class="linkbtn" data-action="dismiss-change" aria-label="Cerrar" style="padding:0;text-decoration:none">${I.x.replace('<svg', '<svg width="18" height="18"')}</button></div>`;
  }

  if (cur) {
    const leg = legs.get(cur.id);
    const close = cur.windows?.length ? fmt(Math.max(...cur.windows.map((w) => w[1]))) : '—';
    html += `<section class="now">
      <div class="label">${doneCount === 0 ? 'Primera parada' : 'Siguiente parada'}</div>
      <h2>${esc(cur.name || cur.address)}</h2>
      <div class="addr">${esc(cur.label || cur.address || '')}</div>
      <div class="chips" style="margin-top:10px">${windowsChips(cur.windows)}${leg?.late > 0.5 ? `<span class="chip late">${lateText(leg.late)}</span>` : ''}${leg?.wait > 4 ? `<span class="chip wait">Abre a las ${fmt(leg.begin)}</span>` : ''}</div>
      <div class="facts">
        <div><b>${leg ? fmt(leg.arrive) : '--:--'}</b><span>llegada</span></div>
        <div><b>${leg ? Math.round(leg.drive) : '–'}</b><span>min de viaje</span></div>
        <div><b>${close}</b><span>cierra</span></div>
      </div>
      ${cur.notes ? `<div class="notice gold" style="margin:-4px 0 14px">${I.info}<div>${esc(cur.notes)}</div></div>` : ''}
      <div class="btns">
        <a class="btn gold big block" href="${navUrl(s.nav, cur)}" target="_blank" rel="noopener">${I.nav}Abrir en ${s.nav === 'gmaps' ? 'Google Maps' : 'Waze'}</a>
        ${ui.busy ? `<button class="btn forest big block" disabled><span class="spin"></span>${esc(ui.busy)}</button>`
          : `<button class="btn forest big block" data-action="next">${I.check}Entregado · siguiente</button>`}
      </div>
      <div class="minor">
        ${r.stops.filter((x) => !x.done).length > 1 ? '<button class="linkbtn" data-action="postpone">Dejar para luego</button>' : ''}
        <button class="linkbtn" data-action="edit-stop" data-id="${cur.id}">Editar</button>
        ${cur.phone ? `<a class="linkbtn" href="tel:${esc(cur.phone.replace(/\s/g, ''))}">Llamar</a>` : ''}
      </div>
    </section>`;
  }

  const upcoming = (r.plan?.order || []).filter((id) => id !== r.current).map((id) => r.stops.find((x) => x.id === id)).filter((x) => x && !x.done);
  if (upcoming.length) {
    html += `<div class="section-title">Después</div><ol class="stops">${upcoming.map((x, i) => stopCard(x, doneCount + i + 2, legs.get(x.id))).join('')}</ol>`;
  }
  const done = r.stops.filter((x) => x.done).sort((a, b) => a.doneAt - b.doneAt);
  if (done.length) {
    html += `<div class="section-title">Entregadas</div><ol class="stops">${done.map((x, i) => stopCard(x, i + 1, null, `<b>${fmt(minOfDay(x.doneAt))}</b><span>entregado</span>`)).join('')}</ol>
      <div style="text-align:center;margin-top:12px"><button class="linkbtn" data-action="undo">Deshacer la última entrega</button></div>`;
  }
  html += `<div style="text-align:center;margin-top:18px"><button class="linkbtn" data-action="stop-route">Volver a planificar</button></div>`;
  return html;
}

const lateText = (m) => (m > 60 ? "Fuera de horario" : `${Math.round(m)} min tarde`);

function minOfDay(ts) { const d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); }

function renderDone(r) {
  const s = settings();
  const done = r.stops.filter((x) => x.done).sort((a, b) => a.doneAt - b.doneAt);
  const first = done[0], last = done[done.length - 1];
  return `${dayBar()}<div class="card finish">
      <div class="serif">Ruta terminada</div>
      <div class="muted" style="margin:6px 0 18px">${done.length} entregas · de ${first ? fmt(minOfDay(r.startedAt || first.doneAt)) : '--'} a ${last ? fmt(minOfDay(last.doneAt)) : '--'}</div>
      <a class="btn gold big block" href="${navUrl(s.nav, s.depot)}" target="_blank" rel="noopener">${I.nav}Volver al almacén</a>
      <div style="height:10px"></div>
      <button class="btn ghost block" data-action="goto-tomorrow">Preparar la ruta de mañana</button>
    </div>
    <div class="section-title">Entregadas</div>
    <ol class="stops">${done.map((x, i) => stopCard(x, i + 1, null, `<b>${fmt(minOfDay(x.doneAt))}</b><span>entregado</span>`)).join('')}</ol>
    <div style="text-align:center;margin-top:14px"><button class="linkbtn" data-action="undo">Deshacer la última entrega</button></div>`;
}

function renderClients() {
  const q = clientKey(ui.clientFilter);
  const list = store.clientList().filter((c) => !q || c.key.includes(q) || clientKey(c.address || '').includes(q));
  let html = `<div class="search">${I.search}<input class="input" id="client-search" placeholder="Buscar cliente o dirección" value="${esc(ui.clientFilter)}" autocomplete="off"></div>`;
  if (!store.clientList().length) {
    html += `<div class="empty"><div class="serif">La memoria está vacía</div><div class="small">Cada cliente que añadas a una ruta se guarda aquí con su dirección y su horario de entrega. La próxima vez se rellena solo.</div></div>`;
    return html;
  }
  html += `<div class="muted small" style="margin:0 2px 10px">${list.length} ${list.length === 1 ? 'cliente recordado' : 'clientes recordados'}</div>`;
  html += list.map((c) => `<button class="client" data-action="edit-client" data-key="${esc(c.key)}">
      <div class="row between"><span class="name ellipsis">${esc(c.name)}</span>${c.visits ? `<span class="tiny faint">${c.visits} ${c.visits === 1 ? 'visita' : 'visitas'}</span>` : ''}</div>
      <div class="addr ellipsis">${esc(c.label || c.address || 'Sin dirección')}</div>
      <div class="chips">${windowsChips(c.windows)}${c.needsCheck ? '<span class="chip check">Revisar dirección</span>' : ''}</div>
    </button>`).join('');
  return html;
}

function renderSettings() {
  const s = settings();
  return `
  <div class="section-title" style="margin-top:6px">Tráfico en tiempo real</div>
  <div class="card">
    ${s.tomtomKey
      ? `<div class="notice info" style="margin-top:0">${I.check}<div>Activo: rutas con tráfico previsto el día antes y tráfico en vivo al salir y en cada parada.</div></div>`
      : `<div class="notice warn" style="margin-top:0">${I.warn}<div>Sin clave la app funciona, pero estima el tráfico por franja horaria: no ve accidentes ni cortes.</div></div>`}
    <label class="field"><span>Clave de TomTom</span>
      <div class="input-row"><input class="input" id="set-key" value="${esc(s.tomtomKey)}" placeholder="Pega aquí tu clave" autocomplete="off" autocapitalize="off" spellcheck="false">
      <button class="btn line" data-action="test-key">Probar</button></div>
    </label>
    <div class="key-help">Es gratis y sin tarjeta (2.500 consultas al día, de sobra para un repartidor):
      <ol><li>Entra en <a href="https://developer.tomtom.com/user/register" target="_blank" rel="noopener">developer.tomtom.com</a> y crea una cuenta.</li>
      <li>En tu panel, abre <b>Keys</b> y copia la clave que aparece.</li>
      <li>Pégala arriba y pulsa <b>Probar</b>.</li></ol>
    </div>
  </div>

  <div class="section-title">Jornada</div>
  <div class="card">
    <label class="field"><span>Hora de inicio</span><input class="input" type="time" id="set-shift" value="${esc(s.shiftStart)}"></label>
    <label class="field"><span>Minutos de descarga por parada (por defecto)</span><input class="input" type="number" inputmode="numeric" min="1" max="90" id="set-service" value="${s.service}"></label>
    <label class="toggle"><span>Volver al almacén al acabar<div class="tiny faint">Cuenta el regreso al calcular la ruta</div></span><input type="checkbox" id="set-return" ${s.returnToDepot ? 'checked' : ''}></label>
    <div class="toggle" style="border:0;padding-bottom:0"><span>Navegar con</span>
      <span class="seg"><button data-action="nav-app" data-v="waze" class="${s.nav === 'waze' ? 'on' : ''}">Waze</button><button data-action="nav-app" data-v="gmaps" class="${s.nav === 'gmaps' ? 'on' : ''}">Google Maps</button></span>
    </div>
  </div>

  <div class="section-title">Almacén (punto de salida)</div>
  <div class="card">
    <div class="row"><span style="color:var(--gold);width:20px">${I.pin}</span><div class="grow"><div style="font-weight:600">${esc(s.depot.name)}</div><div class="tiny faint">${s.depot.lat.toFixed(5)}, ${s.depot.lon.toFixed(5)}</div></div>
    <button class="btn line" data-action="change-depot">Cambiar</button></div>
  </div>

  <div class="section-title">Compartir con compañeros</div>
  <div class="card">
    <div class="small muted" style="margin-bottom:12px">Pasa tu memoria de clientes (direcciones y horarios) a otro repartidor. Al importar se suman a los suyos sin borrar nada.</div>
    <div class="actions2" style="margin:0">
      <button class="btn ghost" data-action="export">Exportar clientes</button>
      <label class="btn ghost" style="cursor:pointer">Importar<input type="file" id="import-file" accept="application/json,.json" hidden></label>
    </div>
  </div>
  <div class="tiny faint" style="text-align:center;margin:22px 0 4px">Ruta Escolà · v1.0 · los datos se guardan solo en este móvil</div>`;
}

// ---------- Hojas (formularios) ----------

function openSheet(sheet) { ui.sheet = sheet; renderSheet(); }
function closeSheet() { ui.sheet = null; renderSheet(); }

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
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${body}</div>`;
  $('.sheet', wrap).scrollTop = scroll;
}

function candidatesHtml(sh) {
  if (sh.searching) return '<div class="muted small" style="margin:-4px 0 14px"><span class="spin" style="display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .8s linear infinite;vertical-align:-1px"></span> Buscando…</div>';
  if (sh.candidates?.length) {
    return `<div class="candidates">${sh.candidates.map((c, i) => `<button class="cand ${sh.picked === i ? 'on' : ''}" data-action="pick" data-i="${i}">${I.pin}<span>${esc(c.label)}</span></button>`).join('')}</div>`;
  }
  if (sh.candidates && !sh.candidates.length) return '<div class="hint" style="color:var(--warn)">No he encontrado esa dirección. Prueba con calle, número y población, o pega un enlace de Google Maps.</div>';
  return '';
}

function sheetStop(sh) {
  const d = sh.draft;
  const isClient = sh.mode === 'client';
  const remembered = !isClient && d.name && store.findClient(d.name);
  const names = store.clientList().map((c) => `<option value="${esc(c.name)}">`).join('');
  return `<h3>${isClient ? 'Cliente' : sh.id ? 'Editar parada' : 'Nueva parada'}</h3>
    <label class="field"><span>Cliente</span>
      <input class="input" id="f-name" list="client-names" value="${esc(d.name)}" placeholder="Ej. Vinos Paco" autocomplete="off">
      <datalist id="client-names">${names}</datalist>
    </label>
    ${remembered && !sh.id ? `<div class="hint"><span class="chip mem">Recordado</span> dirección y horario rellenados de la última vez</div>` : ''}
    <label class="field"><span>Dirección</span>
      <div class="input-row"><input class="input" id="f-address" value="${esc(d.address)}" placeholder="Calle, número, población" autocomplete="off">
      <button class="btn line" data-action="search-address" aria-label="Buscar dirección">${I.search}</button></div>
    </label>
    ${candidatesHtml(sh)}
    ${located(d) && !sh.candidates?.length ? `<div class="located">${I.pin}<span>${esc(d.label || 'Ubicación guardada')}</span></div>` : ''}

    <div class="field" style="margin-bottom:8px"><span class="small muted" style="font-weight:500">Horario en que acepta entregas</span></div>
    <div class="windows-edit">
      ${d.windows.map(([a, b], i) => `<div class="win-row">
        <input class="input" type="time" data-win="${i}" data-end="0" value="${fmt(a)}">
        <span class="sep">a</span>
        <input class="input" type="time" data-win="${i}" data-end="1" value="${fmt(b)}">
        <button class="iconbtn" data-action="del-window" data-i="${i}" aria-label="Quitar franja">${I.x}</button>
      </div>`).join('')}
    </div>
    ${d.windows.length ? '' : '<div class="hint">Sin horario: se le puede entregar a cualquier hora.</div>'}
    <div class="presets">
      <button data-action="add-window" data-a="09:00" data-b="13:00">+ 9:00–13:00</button>
      <button data-action="add-window" data-a="10:00" data-b="13:00">+ 10:00–13:00</button>
      <button data-action="add-window" data-a="16:00" data-b="19:00">+ 16:00–19:00</button>
      <button data-action="add-window" data-a="08:00" data-b="12:00">+ Otra franja</button>
    </div>

    <div class="input-row">
      <label class="field" style="flex:1"><span>Descarga (min)</span><input class="input" type="number" inputmode="numeric" id="f-service" value="${d.service ?? settings().service}" min="1" max="120"></label>
      <label class="field" style="flex:1.4"><span>Teléfono</span><input class="input" type="tel" id="f-phone" value="${esc(d.phone || '')}" placeholder="Opcional"></label>
    </div>
    <label class="field"><span>Notas para la entrega</span><input class="input" id="f-notes" value="${esc(d.notes || '')}" placeholder="Ej. entrar por la puerta de atrás"></label>

    <div class="foot">
      <button class="btn gold big block" data-action="save-stop">${isClient ? 'Guardar cliente' : sh.id ? 'Guardar' : 'Añadir a la ruta'}</button>
      ${isClient ? `<button class="btn ghost block" data-action="client-to-route">Añadir a la ruta de ${esc(dayName(ui.date).rel.toLowerCase())}</button>` : ''}
      ${sh.id && !isClient ? '<button class="btn danger block" data-action="remove-stop">Quitar de la ruta</button>' : ''}
      ${isClient ? '<button class="btn danger block" data-action="forget-client">Olvidar este cliente</button>' : ''}
      <button class="btn ghost block" data-action="close">Cancelar</button>
    </div>`;
}

function sheetPaste(sh) {
  const items = sh.parsed;
  return `<h3>Pegar lista</h3>
    <div class="small muted" style="margin:-6px 0 12px">Copia las paradas del portal, de un mensaje o escríbelas tú: una por línea, o separadas por una línea en blanco. Si pones horarios (9:00-11:30, de 10 a 13h…) los leo.</div>
    <label class="field"><textarea class="input" id="f-paste" placeholder="Vinos Paco - C/ Major 12, Sant Feliu - 9:00-11:30&#10;Bar La Plaça | Plaça de la Vila 3, Cornellà">${esc(sh.text || '')}</textarea></label>
    ${items ? `<div class="section-title" style="margin-top:4px">${items.length} paradas detectadas</div>
      <ul class="parsed">${items.map((it) => {
        const mem = store.findClient(it.name);
        return `<li><b>${esc(it.name)}</b>${mem ? ' <span class="chip mem">Recordado</span>' : ''}<div class="muted small">${esc(it.address || mem?.address || 'Sin dirección: la buscaré por el nombre')}</div>
          <div class="chips" style="margin-top:6px">${windowsChips(it.windows.length ? it.windows : mem?.windows)}</div></li>`;
      }).join('')}</ul>` : ''}
    <div class="foot">
      ${sh.busy ? `<button class="btn gold big block" disabled><span class="spin"></span>${esc(sh.busy)}</button>`
        : items ? `<button class="btn gold big block" data-action="paste-add">Añadir ${items.length} paradas</button>`
        : '<button class="btn gold big block" data-action="paste-read">Leer lista</button>'}
      <button class="btn ghost block" data-action="close">Cancelar</button>
    </div>`;
}

function sheetDepot(sh) {
  return `<h3>Punto de salida</h3>
    <label class="field"><span>Dirección del almacén</span>
      <div class="input-row"><input class="input" id="f-address" value="${esc(sh.draft.address || '')}" placeholder="Calle, número, población">
      <button class="btn line" data-action="search-address">${I.search}</button></div>
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
  if (!sh?.draft) { if (sh?.kind === 'paste') sh.text = $('#f-paste')?.value ?? sh.text; return; }
  const d = sh.draft;
  const v = (id) => $(id)?.value;
  if ($('#f-name')) d.name = v('#f-name').trim();
  if ($('#f-address')) {
    const addr = v('#f-address').trim();
    if (addr !== (d.address || '')) { d.address = addr; }
  }
  if ($('#f-service')) d.service = Math.max(1, parseInt(v('#f-service'), 10) || settings().service);
  if ($('#f-phone')) d.phone = v('#f-phone').trim();
  if ($('#f-notes')) d.notes = v('#f-notes').trim();
  document.querySelectorAll('[data-win]').forEach((inp) => {
    const i = +inp.dataset.win, end = +inp.dataset.end;
    const m = toMin(inp.value);
    if (m != null && d.windows[i]) d.windows[i][end] = m;
  });
  d.windows = d.windows.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
}

function stopDraft(src = {}) {
  return {
    name: src.name || '',
    address: src.address || '',
    lat: src.lat, lon: src.lon, label: src.label,
    windows: (src.windows || []).map((w) => [...w]),
    service: src.service ?? settings().service,
    phone: src.phone || '', notes: src.notes || '',
    needsCheck: src.needsCheck,
  };
}

async function searchAddress() {
  const sh = ui.sheet;
  syncDraft();
  const q = [sh.draft.address, sh.kind === 'stop' && !sh.draft.address ? sh.draft.name : ''].filter(Boolean).join(' ');
  if (!q) return toast('Escribe una dirección o el nombre del local');
  const direct = coordsFromText(sh.draft.address);
  sh.searching = true; sh.candidates = null; renderSheet();
  try {
    let res = await geocode(q, { key: settings().tomtomKey, near: settings().depot });
    // Si con la dirección no sale nada, prueba con el nombre del local (TomTom encuentra negocios).
    if (!res.length && sh.draft.name && sh.draft.address && !direct) res = await geocode(`${sh.draft.name} ${sh.draft.address}`, { key: settings().tomtomKey, near: settings().depot });
    sh.candidates = res.slice(0, 5);
    if (res.length === 1) pickCandidate(0);
  } catch (e) {
    sh.candidates = null;
    toast(e.message || 'No se pudo buscar');
  }
  sh.searching = false;
  renderSheet();
}

function pickCandidate(i) {
  const sh = ui.sheet;
  const c = sh.candidates[i];
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
  if (!d.address) Object.assign(d, { address: mem.address, lat: mem.lat, lon: mem.lon, label: mem.label, needsCheck: mem.needsCheck });
  if (!d.windows.length && mem.windows?.length) d.windows = mem.windows.map((w) => [...w]);
  d.service = mem.service ?? d.service;
  d.phone = d.phone || mem.phone || '';
  d.notes = d.notes || mem.notes || '';
  d.name = mem.name;
  renderSheet();
}

async function saveStop() {
  const sh = ui.sheet;
  syncDraft();
  const d = sh.draft;
  if (!d.name && !d.address) return toast('Pon al menos el nombre o la dirección');
  if (!d.name) d.name = d.address;
  // Quien guarda la ficha ha visto la ubicación que se muestra en ella: se da por revisada.
  if (located(d)) d.needsCheck = false;
  else if (d.address) {
    // Guardar sin pasar por "buscar": tomo el primer resultado y lo marco para revisar.
    try {
      const [hit] = await geocode(d.address, { key: settings().tomtomKey, near: settings().depot });
      if (hit) Object.assign(d, { lat: hit.lat, lon: hit.lon, label: hit.label, needsCheck: true });
    } catch { /* se queda sin ubicar */ }
  }
  const prevKey = sh.mode === 'client' ? sh.key : null;
  if (prevKey && prevKey !== clientKey(d.name)) store.forgetClient(prevKey);
  store.rememberClient({ name: d.name, address: d.address, lat: d.lat, lon: d.lon, label: d.label, windows: d.windows, service: d.service, phone: d.phone, notes: d.notes, needsCheck: !!d.needsCheck });

  if (sh.mode !== 'client') {
    const r = currentRoute();
    if (sh.id) {
      const s = r.stops.find((x) => x.id === sh.id);
      Object.assign(s, d);
    } else {
      r.stops.push({ id: uid(), ...d, done: false });
    }
    if (r.status === 'active') { store.save(); closeSheet(); return replanActive('Parada actualizada'); }
    store.save();
    toast(located(d) ? (sh.id ? 'Parada guardada' : 'Parada añadida') : 'Guardada sin ubicar: búscala para incluirla');
  } else {
    toast('Cliente guardado');
  }
  closeSheet();
  render();
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
  ui.busy = s.tomtomKey ? 'Calculando con el tráfico previsto…' : 'Calculando la mejor ruta…';
  render();
  try {
    const plan = await computePlan({ from: s.depot, depot: s.depot, stops, startMin, departAt, key: s.tomtomKey, live: false, pairs: {}, returnToDepot: s.returnToDepot });
    r.pairs = plan.pairs; delete plan.pairs;
    r.plan = plan; r.planSig = signature(r); r.status = 'planned';
    store.save();
    toast('Ruta optimizada');
  } catch (e) {
    toast(friendlyError(e), 4000);
  }
  ui.busy = null;
  render();
}

function friendlyError(e) {
  if (!navigator.onLine) return 'Sin conexión. Prueba de nuevo cuando tengas cobertura.';
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
    const plan = await computePlan({ from: s.depot, depot: s.depot, stops, startMin, departAt, key: s.tomtomKey, live: !!s.tomtomKey, pairs: {}, returnToDepot: s.returnToDepot });
    r.pairs = plan.pairs; delete plan.pairs;
    const changed = before && before.order.join() !== plan.order.join();
    r.lastChange = changed
      ? { kind: 'changed', text: `He cambiado el orden según el tráfico de ahora. Vuelta prevista a las ${fmt(plan.end)}.` }
      : { kind: 'same', text: `Ruta confirmada con el tráfico de ahora: el orden se mantiene. Vuelta prevista a las ${fmt(plan.end)}.` };
    r.plan = plan; r.planSig = signature(r);
    r.status = 'active'; r.current = plan.order[0]; r.startedAt = departAt.getTime(); r.postponed = [];
    store.save();
  } catch (e) {
    // Sin red: se sale con el plan del día anterior.
    if (!before) { ui.busy = null; render(); return toast(friendlyError(e), 4000); }
    r.status = 'active'; r.current = before.order[0]; r.startedAt = Date.now(); r.postponed = [];
    r.lastChange = { kind: 'same', text: 'No he podido consultar el tráfico ahora; sigues con la ruta planificada.' };
    store.save();
  }
  ui.busy = null;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Recalcula lo que queda desde donde estás (GPS o la última parada) con tráfico en vivo.
async function replanActive(msg) {
  const r = currentRoute();
  const s = settings();
  const pending = r.stops.filter((x) => !x.done && located(x));
  if (!pending.length) {
    r.status = 'done'; r.current = null; store.save(); render();
    return toast('¡Ruta terminada!');
  }
  r.postponed = (r.postponed || []).filter((id) => pending.some((p) => p.id === id));
  const postponed = new Set(r.postponed.length < pending.length ? r.postponed : []);
  const active = pending.filter((p) => !postponed.has(p.id));
  const lastDone = r.stops.filter((x) => x.done).sort((a, b) => b.doneAt - a.doneAt)[0];

  ui.busy = 'Calculando la siguiente…';
  render();
  const gps = await currentPosition(6000);
  const from = gps && gps.accuracy < 1000 ? gps : lastDone && located(lastDone) ? lastDone : s.depot;
  try {
    const plan = await computePlan({
      from, depot: s.depot, startMin: nowMin(), departAt: new Date(), key: s.tomtomKey, live: !!s.tomtomKey,
      stops: active.map((x) => ({ id: x.id, lat: x.lat, lon: x.lon, windows: x.windows, service: x.service })),
      pairs: r.pairs || {}, returnToDepot: s.returnToDepot,
    });
    r.pairs = plan.pairs; delete plan.pairs;
    plan.order.push(...r.postponed.filter((id) => postponed.has(id)));
    r.plan = plan; r.planSig = signature(r);
    r.current = plan.order[0];
    const next = r.stops.find((x) => x.id === r.current);
    const leg = plan.legs[0];
    toast(msg ? msg : `Siguiente: ${next.name}${leg ? ` · llegada ${fmt(leg.arrive)}` : ''}`, 3200);
  } catch {
    // Sin red: siguiente del orden previsto.
    const order = (r.plan?.order || []).filter((id) => active.some((p) => p.id === id));
    r.current = order[0] || active[0].id;
    toast('Sin conexión: sigo el orden previsto', 3200);
  }
  r.lastChange = null;
  store.save();
  ui.busy = null;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function nextStop() {
  const r = currentRoute();
  const cur = r.stops.find((x) => x.id === r.current);
  if (cur) {
    cur.done = true; cur.doneAt = Date.now();
    const mem = store.findClient(cur.name);
    if (mem) store.rememberClient({ name: mem.name, visits: (mem.visits || 0) + 1, lastVisit: ui.date });
    r.postponed = (r.postponed || []).filter((id) => id !== cur.id);
  }
  store.save();
  await replanActive();
}

// ---------- Eventos ----------

const actions = {
  tab: (el) => { ui.tab = el.dataset.tab; closeSheet(); render(); window.scrollTo(0, 0); },
  day: (el) => { ui.date = addDays(ui.date, +el.dataset.d); render(); },
  'goto-tomorrow': () => { ui.date = addDays(todayIso(), 1); render(); },
  'leave-in': (el) => { store.setSettings({ leaveIn: +el.dataset.m }); render(); },
  optimize: () => optimize(),
  leave: () => leave(),
  next: () => nextStop(),
  postpone: () => {
    const r = currentRoute();
    r.postponed = [...new Set([...(r.postponed || []), r.current])];
    store.save();
    replanActive('Dejada para el final');
  },
  undo: () => {
    const r = currentRoute();
    const last = r.stops.filter((x) => x.done).sort((a, b) => b.doneAt - a.doneAt)[0];
    if (!last) return;
    last.done = false; delete last.doneAt;
    r.status = 'active'; r.current = last.id;
    if (r.plan && !r.plan.order.includes(last.id)) r.plan.order.unshift(last.id);
    else if (r.plan) r.plan.order = [last.id, ...r.plan.order.filter((id) => id !== last.id)];
    store.save(); render(); toast(`${last.name} vuelve a estar pendiente`);
  },
  'stop-route': () => {
    if (!confirm('¿Volver a planificar? Las entregas hechas se mantienen marcadas.')) return;
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
    const c = store.db().clients[el.dataset.key];
    if (c) openSheet({ kind: 'stop', mode: 'client', key: c.key, draft: stopDraft(c) });
  },
  'open-paste': () => openSheet({ kind: 'paste', text: '' }),
  'paste-read': () => {
    syncDraft();
    const parsed = parseList(ui.sheet.text);
    if (!parsed.length) return toast('No veo ninguna parada en el texto');
    ui.sheet.parsed = parsed;
    renderSheet();
  },
  'paste-add': () => pasteAdd(),
  'search-address': () => searchAddress(),
  pick: (el) => { pickCandidate(+el.dataset.i); syncDraftKeepCandidates(); },
  'add-window': (el) => {
    syncDraft();
    const d = ui.sheet.draft;
    let a = toMin(el.dataset.a), b = toMin(el.dataset.b);
    if (el.textContent.includes('Otra') && d.windows.length) { a = d.windows[d.windows.length - 1][1] + 60; b = Math.min(a + 180, 23 * 60); }
    d.windows.push([a, b]);
    d.windows.sort((x, y) => x[0] - y[0]);
    renderSheet();
  },
  'del-window': (el) => { syncDraft(); ui.sheet.draft.windows.splice(+el.dataset.i, 1); renderSheet(); },
  'save-stop': () => saveStop(),
  'remove-stop': () => {
    const r = currentRoute();
    const id = ui.sheet.id;
    r.stops = r.stops.filter((x) => x.id !== id);
    if (r.current === id) r.current = null;
    store.save(); closeSheet();
    if (r.status === 'active') replanActive('Parada quitada'); else render();
  },
  'forget-client': () => {
    if (!confirm('¿Olvidar este cliente? Se borra su dirección y horario guardados.')) return;
    store.forgetClient(ui.sheet.key); closeSheet(); render();
  },
  'client-to-route': async () => {
    syncDraft();
    const name = ui.sheet.draft.name || ui.sheet.draft.address;
    await saveStop();
    const target = store.findClient(name);
    if (!target) return;
    const r = currentRoute();
    r.stops.push({ id: uid(), ...stopDraft(target), done: false });
    store.save();
    ui.tab = 'route'; render();
    toast(`${target.name} añadido a ${dayName(ui.date).rel.toLowerCase()}`);
  },
  close: () => closeSheet(),
  'nav-app': (el) => { store.setSettings({ nav: el.dataset.v }); render(); },
  'test-key': () => testKey(),
  'change-depot': () => openSheet({ kind: 'depot', draft: { address: '' } }),
  'save-depot': () => {
    const d = ui.sheet.draft;
    store.setSettings({ depot: { name: d.label || d.address, lat: d.lat, lon: d.lon } });
    closeSheet(); render(); toast('Punto de salida cambiado');
  },
  'reset-depot': () => { store.setSettings({ depot: store.DEFAULT_DEPOT }); closeSheet(); render(); toast('Salida: Comercial Escolà'); },
  export: () => exportClients(),
};

function syncDraftKeepCandidates() { syncDraft(); renderSheet(); }

async function pasteAdd() {
  const sh = ui.sheet;
  const r = currentRoute();
  const s = settings();
  const items = sh.parsed;
  let n = 0, unlocated = 0;
  for (const it of items) {
    n++;
    sh.busy = `Buscando direcciones ${n}/${items.length}…`;
    renderSheet();
    const mem = store.findClient(it.name);
    const stop = stopDraft(mem || {});
    stop.name = mem?.name || it.name;
    if (it.windows.length) stop.windows = it.windows;
    const addressChanged = it.address && clientKey(it.address) !== clientKey(mem?.address || '');
    if (it.address) stop.address = it.address;
    if (!mem || addressChanged || !located(stop)) {
      try {
        const q = it.address || it.name;
        const [hit] = await geocode(q, { key: s.tomtomKey, near: s.depot });
        if (hit) Object.assign(stop, { lat: hit.lat, lon: hit.lon, label: hit.label, needsCheck: true });
        else { delete stop.lat; delete stop.lon; delete stop.label; }
      } catch { /* queda sin ubicar */ }
    }
    if (!located(stop)) unlocated++;
    store.rememberClient({ name: stop.name, address: stop.address, lat: stop.lat, lon: stop.lon, label: stop.label, windows: stop.windows, service: stop.service, phone: stop.phone, notes: stop.notes, needsCheck: !!stop.needsCheck });
    r.stops.push({ id: uid(), ...stop, done: false });
  }
  if (r.status === 'done') r.status = 'draft';
  store.save();
  closeSheet();
  toast(unlocated ? `${items.length} añadidas · ${unlocated} sin ubicar` : `${items.length} paradas añadidas`);
  if (r.status !== 'active' && r.stops.some(located)) await optimize(); else render();
}

async function testKey() {
  const key = $('#set-key').value.trim();
  store.setSettings({ tomtomKey: key });
  if (!key) { render(); return toast('Clave quitada: tráfico estimado'); }
  try {
    const res = await geocode('Sant Joan Despí', { key });
    if (!res.length) throw new Error('Respuesta vacía');
    toast('Clave correcta: tráfico real activado ✓', 3200);
  } catch (e) {
    toast(e.message || 'La clave no funciona', 4000);
  }
  // Las rutas planificadas se recalculan con la nueva fuente de tiempos.
  render();
}

function exportClients() {
  const json = store.exportClients();
  const name = `clientes-ruta-${todayIso()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: 'Clientes · Ruta Escolà' }).catch(() => {});
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) {
    e.preventDefault();
    actions[el.dataset.action](el);
    return;
  }
  if (e.target.id === 'sheet') closeSheet(); // tocar fuera de la hoja
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'f-name') fillFromMemory();
  if (t.id === 'f-address' && ui.sheet?.draft) {
    // Dirección cambiada a mano: la ubicación anterior ya no vale. Sin redibujar, para no perder el toque en "buscar".
    const d = ui.sheet.draft;
    const val = t.value.trim();
    if (val !== d.address) { d.address = val; delete d.lat; delete d.lon; delete d.label; ui.sheet.candidates = null; $('.located')?.remove(); }
  }
  if (t.dataset.win !== undefined) syncDraft();
  if (t.id === 'set-shift') store.setSettings({ shiftStart: t.value || '07:30' });
  if (t.id === 'set-service') store.setSettings({ service: Math.max(1, parseInt(t.value, 10) || 10) });
  if (t.id === 'set-return') store.setSettings({ returnToDepot: t.checked });
  if (t.id === 'set-key') store.setSettings({ tomtomKey: t.value.trim() });
  if (t.id === 'import-file' && t.files[0]) {
    t.files[0].text().then((txt) => {
      try { const { added, updated } = store.importClients(txt); toast(`${added} clientes nuevos · ${updated} actualizados`); render(); }
      catch { toast('Ese archivo no es una exportación de la app'); }
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
  if (e.key === 'Escape' && ui.sheet) closeSheet();
  if (e.key === 'Enter' && e.target.id === 'f-address') { e.preventDefault(); searchAddress(); }
});

// Al volver a la app (p. ej. desde Waze), refresca horas y estado.
document.addEventListener('visibilitychange', () => { if (!document.hidden && !ui.sheet) render(); });

// ---------- Arranque ----------

store.pruneOldRoutes();
ui.date = defaultDate();
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
