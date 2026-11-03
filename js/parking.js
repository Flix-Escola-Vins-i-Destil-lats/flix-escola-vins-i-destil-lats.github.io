// Aparcar una vez y repartir andando.
// Si varias entregas seguidas de la ruta quedan a pocas manzanas, se propone un sitio donde dejar la furgoneta
// (una zona de carga y descarga si la hay) y se va a pie a cada una. Se cuenta ida y vuelta a la furgoneta
// por cada pedido, que es como se lleva la mercancía con la carretilla.
// Zonas DUM: Ajuntament de Barcelona, Open Data BCN, «Zones de càrrega i descàrrega» (CC BY 4.0).

import { haversineKm } from './geo.js';
import { serviceStart } from './solver.js';

export const BLOCK_M = 133; // una manzana del Eixample (113 m) más la calle
export const WALK_M_MIN = 70; // a pie con la carretilla, unos 4,2 km/h
const DETOUR = 1.25; // por las calles se anda algo más que en línea recta
export const DUM_MINUTES = 30; // lo máximo que deja SPRO en una zona DUM
const OTHER_MAX = 45; // fuera de zona DUM tampoco tiene sentido dejar la furgoneta mucho más
const MAX_WAIT = 15; // con más espera entre dos entregas del grupo, mejor no quedarse aparcado
const REPARK = 4; // lo que cuesta volver a aparcar si se va en furgoneta de una a otra
const SAME_SPOT_M = 50; // «otro sitio» tiene que estar a más de esto de los ya descartados

export const walkM = (a, b) => haversineKm(a, b) * 1000 * DETOUR;
export const walkMin = (a, b) => walkM(a, b) / WALK_M_MIN;
// Hasta 3 manzanas a pie; si se juntan 3 entregas o más, vale la pena llegar a 4.
export const reachM = (n) => (n >= 3 ? 4 : 3) * BLOCK_M;
export const groupKey = (ids) => [...ids].sort().join('+');

// Punto que hace mínima la suma de distancias a todas (mediana geométrica, algoritmo de Weiszfeld).
export function medianPoint(points) {
  let p = { lat: points.reduce((s, q) => s + q.lat, 0) / points.length, lon: points.reduce((s, q) => s + q.lon, 0) / points.length };
  for (let k = 0; k < 60; k++) {
    let wsum = 0, lat = 0, lon = 0;
    for (const q of points) {
      const d = Math.max(haversineKm(p, q), 1e-6);
      wsum += 1 / d; lat += q.lat / d; lon += q.lon / d;
    }
    const next = { lat: lat / wsum, lon: lon / wsum };
    if (haversineKm(p, next) < 1e-5) return next;
    p = next;
  }
  return p;
}

// Cuánto tiempo queda aparcada la furgoneta haciendo el grupo en este orden, o null si no conviene:
// alguna entrega pasaría a llegar tarde o habría que esperar demasiado a que abra.
export function parkedMinutes(members, spot, legs) {
  const first = legs.get(members[0].id);
  if (!first) return null;
  // Se llega al aparcamiento más o menos cuando se llegaría a la primera. Si la primera aún no ha abierto,
  // se aparca (y se valida SPRO) justo a tiempo: esa espera no cuenta como tiempo aparcado.
  let t = first.arrive, start = null;
  for (const s of members) {
    const walk = walkMin(spot, s);
    const arrive = t + walk;
    const { begin, lateBy } = serviceStart(arrive, s.windows);
    if (lateBy > 0.5 && !(legs.get(s.id)?.late > 0.5)) return null;
    if (start == null) start = begin - walk;
    else if (begin - arrive > MAX_WAIT) return null;
    t = begin + (s.service ?? 10) + walk;
  }
  return t - start;
}

const fitsTime = (members, spot, legs) => {
  const m = parkedMinutes(members, spot, legs);
  return m != null && m <= (spot.dum ? DUM_MINUTES : OTHER_MAX) ? m : null;
};

/**
 * Sitios para aparcar a un grupo, del mejor al peor: zonas DUM a su alcance a pie, ordenadas por lo que se
 * anda en total. Si no hay ninguna (fuera de Barcelona), el punto medio. Los descartados no vuelven a salir,
 * ni otro pegado a ellos. zones: [[lat, lon, "calle, número"], …].
 */
export function spotsFor(members, zones, rejected = []) {
  const reach = reachM(members.length);
  const center = medianPoint(members);
  const dLat = (reach / 1000) / 111.2, dLon = dLat / Math.cos(center.lat * Math.PI / 180);
  const near = [];
  for (const [lat, lon, label] of zones) {
    if (Math.abs(lat - center.lat) > dLat || Math.abs(lon - center.lon) > dLon) continue;
    const z = { lat, lon, label, dum: true };
    if (members.every((s) => walkM(z, s) <= reach)) near.push({ ...z, cost: members.reduce((sum, s) => sum + walkM(z, s), 0) });
  }
  near.sort((a, b) => a.cost - b.cost);
  const apart = (z, list) => !list.some((p) => haversineKm(p, z) * 1000 < SAME_SPOT_M);
  const out = [];
  for (const z of near) if (apart(z, rejected) && apart(z, out)) out.push(z);
  if (!out.length && apart(center, rejected)) out.push({ lat: center.lat, lon: center.lon, label: '', dum: false });
  return out;
}

/**
 * Propuestas de aparcar una vez para varias entregas seguidas de la ruta optimizada.
 * stops: [{id, lat, lon, windows, service}] (con los horarios que usa el optimizador). legs: Map id → tramo del plan.
 * taken: ids que ya están en un aparcamiento aceptado. rejected: { clave del grupo: [sitios descartados] | 'off' }.
 */
export function proposeParking({ order, stops, legs, zones, taken = new Set(), rejected = {} }) {
  const byId = new Map(stops.map((s) => [s.id, s]));
  const seq = order.map((id) => byId.get(id)).filter(Boolean);
  const reachable = (group) => {
    const c = medianPoint(group);
    return group.every((s) => walkM(c, s) <= reachM(group.length)) && fitsTime(group, { ...c, dum: true }, legs) != null;
  };
  const out = [];
  let k = 0;
  while (k < seq.length) {
    if (taken.has(seq[k].id)) { k++; continue; }
    let group = [seq[k]];
    const free = (j) => j < seq.length && !taken.has(seq[j].id);
    for (let j = k + 1; free(j);) {
      // Si con una más no llega, se prueba con dos: con tres entregas el alcance sube a 4 manzanas.
      if (reachable([...group, seq[j]])) { group = [...group, seq[j]]; j++; }
      else if (free(j + 1) && reachable([...group, seq[j], seq[j + 1]])) { group = [...group, seq[j], seq[j + 1]]; j += 2; }
      else break;
    }
    k += group.length;
    if (group.length < 2) continue;
    const key = groupKey(group.map((s) => s.id));
    if (rejected[key] === 'off') continue;
    const spot = spotsFor(group, zones, rejected[key] || []).find((z) => fitsTime(group, z, legs) != null);
    out.push(spot ? describe(group, spot, legs, key) : { key, ids: group.map((s) => s.id), spot: null });
  }
  return out;
}

function describe(group, spot, legs, key) {
  const walks = group.map((s) => walkMin(spot, s));
  const walking = walks.reduce((s, w) => s + 2 * w, 0);
  // Lo mismo en furgoneta: los tramos del plan entre ellas y volver a aparcar en cada una.
  const driving = group.slice(1).reduce((s, x) => s + (legs.get(x.id)?.drive ?? 0) + REPARK, 0);
  return {
    key,
    ids: group.map((s) => s.id),
    spot: { lat: spot.lat, lon: spot.lon, label: spot.label, dum: spot.dum },
    walks: walks.map((w) => Math.max(1, Math.round(w))),
    blocks: Math.max(...group.map((s) => walkM(spot, s))) / BLOCK_M,
    parked: Math.round(fitsTime(group, spot, legs)),
    saved: Math.round(driving - walking),
  };
}

// Para el optimizador: a qué aparcamiento va cada parada y cuánto se anda de la furgoneta a ella.
// parking: [{ids, lat, lon}]. Devuelve { group: índice o -1, walk: minutos } por parada.
export function walkPlan(stops, parking) {
  const at = new Map();
  parking.forEach((p, g) => p.ids.forEach((id) => at.set(id, g)));
  return stops.map((s) => {
    const g = at.has(s.id) ? at.get(s.id) : -1;
    return { group: g, walk: g < 0 ? 0 : walkMin(parking[g], s) };
  });
}
