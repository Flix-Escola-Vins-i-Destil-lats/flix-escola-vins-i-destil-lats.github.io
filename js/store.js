// Todo se guarda en el propio móvil (localStorage): ajustes, clientes recordados y rutas por día.

import { clientKey } from './parse.js';

const KEY = 'ruta-escola-v1';

export const DEFAULT_DEPOT = {
  name: 'Comercial Escolà · Sant Joan Despí',
  lat: 41.372083,
  lon: 2.077356,
};

const empty = () => ({
  settings: {
    tomtomKey: '',
    depot: DEFAULT_DEPOT,
    shiftStart: '07:30',
    service: 10,
    returnToDepot: true,
    nav: 'waze',
    leaveIn: 10,
  },
  clients: {}, // clave normalizada -> { key, name, address, lat, lon, label, windows, service, phone, notes, visits, updatedAt }
  routes: {}, // 'YYYY-MM-DD' -> { date, stops: [...], plan, status, pairs, history }
});

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const data = JSON.parse(raw);
    const base = empty();
    return { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) } };
  } catch {
    return empty();
  }
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('No se pudo guardar', e);
  }
}

export const db = () => state;
export const settings = () => state.settings;

export function setSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  save();
}

// ---------- Clientes (memoria) ----------

export function findClient(name) {
  return state.clients[clientKey(name)] || null;
}

export function rememberClient(data) {
  const key = clientKey(data.name);
  if (!key) return null;
  const prev = state.clients[key] || { visits: 0 };
  const merged = { ...prev, ...stripUndefined(data), key, updatedAt: Date.now() };
  state.clients[key] = merged;
  save();
  return merged;
}

export function forgetClient(key) {
  delete state.clients[key];
  save();
}

export function clientList() {
  return Object.values(state.clients).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function stripUndefined(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

// ---------- Rutas ----------

export function route(date) {
  if (!state.routes[date]) state.routes[date] = { date, stops: [], plan: null, status: 'draft', pairs: {}, history: [] };
  return state.routes[date];
}

export function hasRoute(date) {
  return !!state.routes[date]?.stops?.length;
}

export function pruneOldRoutes(keepDays = 21) {
  const limit = new Date();
  limit.setDate(limit.getDate() - keepDays);
  const iso = isoDate(limit);
  for (const d of Object.keys(state.routes)) if (d < iso) delete state.routes[d];
  save();
}

export function isoDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- Compartir memoria con compañeros ----------

export function exportClients() {
  return JSON.stringify({ app: 'ruta-escola', version: 1, exportedAt: new Date().toISOString(), clients: state.clients }, null, 2);
}

export function importClients(json) {
  const data = JSON.parse(json);
  if (!data || typeof data.clients !== 'object') throw new Error('Archivo no válido');
  let added = 0, updated = 0;
  for (const c of Object.values(data.clients)) {
    if (!c?.name) continue;
    const key = clientKey(c.name);
    const mine = state.clients[key];
    if (!mine) { state.clients[key] = { ...c, key }; added++; }
    else if ((c.updatedAt || 0) > (mine.updatedAt || 0)) { state.clients[key] = { ...mine, ...c, key }; updated++; }
  }
  save();
  return { added, updated };
}
