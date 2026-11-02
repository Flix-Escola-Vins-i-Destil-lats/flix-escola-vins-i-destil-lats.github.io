// Une la matriz de tiempos con el optimizador y guarda los tiempos entre paradas para reutilizarlos
// en cada "Siguiente" (así solo se pide de nuevo la fila desde donde estás, que es la que cambia).

import { travelMatrix } from './geo.js';
import { optimize } from './solver.js';

const DEPOT = 'depot';
const pairKey = (a, b) => `${a}>${b}`;

// pairs: { "idA>idB": { m: minutos, km, at: timestamp, src } }
function haveFreshPairs(stops, pairs, src, maxAgeMin) {
  const limit = Date.now() - maxAgeMin * 60000;
  for (const a of stops) {
    for (const b of [...stops.map((s) => s.id), DEPOT]) {
      if (a.id === b) continue;
      const p = pairs[pairKey(a.id, b)];
      if (!p || p.src !== src || p.at < limit) return false;
    }
  }
  return true;
}

/**
 * from: {lat, lon} punto de salida. stops: [{id, lat, lon, windows:[[a,b]], service}].
 * startMin: minuto del día en que se sale. departAt: Date de salida (para el tráfico).
 */
export async function computePlan({ from, stops, depot, startMin, departAt, key, live, pairs = {}, maxAgeMin = 90, returnToDepot = true }) {
  if (stops.length === 0) return { order: [], legs: [], end: startMin, late: 0, wait: 0, km: 0, pairs };
  const src = key ? 'tomtom' : 'osrm';
  const dests = [...stops, depot];
  const reusePairs = haveFreshPairs(stops, pairs, src, maxAgeMin);
  const origins = reusePairs ? [from] : [from, ...stops];
  const mx = await travelMatrix(origins, dests, { key, departAt, live });

  const now = Date.now();
  const next = { ...pairs };
  if (!reusePairs) {
    stops.forEach((a, i) => dests.forEach((b, j) => {
      const bid = j === stops.length ? DEPOT : b.id;
      if (a.id !== bid) next[pairKey(a.id, bid)] = { m: mx.minutes[i + 1][j], km: mx.km[i + 1][j], at: now, src };
    }));
  }

  const n = stops.length;
  const minutes = (i, j) => {
    // i, j: 0 = salida, 1..n = paradas, n+1 = almacén
    if (i === 0) return { m: mx.minutes[0][j - 1], km: mx.km[0][j - 1] };
    const a = stops[i - 1].id, b = j === n + 1 ? DEPOT : stops[j - 1].id;
    if (a === b) return { m: 0, km: 0 };
    return next[pairKey(a, b)];
  };

  const matrix = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (j === 0 ? 0 : minutes(i, j).m)));
  const back = Array.from({ length: n + 1 }, (_, i) => minutes(i, n + 1).m);

  const ctx = {
    matrix,
    back,
    start: startMin,
    returnTo: returnToDepot,
    stops: stops.map((s) => ({ windows: s.windows || [], service: s.service ?? 10 })),
  };
  const best = optimize(ctx);

  let km = 0, prev = 0;
  const legs = best.legs.map((leg) => {
    const d = minutes(prev, leg.node);
    km += d.km || 0;
    prev = leg.node;
    return { id: stops[leg.node - 1].id, arrive: leg.arrive, begin: leg.begin, wait: leg.wait, late: leg.late, drive: leg.drive, km: d.km };
  });
  if (returnToDepot && legs.length) km += minutes(prev, n + 1).km || 0;

  return {
    order: legs.map((l) => l.id),
    legs,
    end: best.end,
    late: best.late,
    wait: best.wait,
    km,
    source: mx.source,
    live: mx.live,
    computedAt: now,
    startMin,
    pairs: next,
  };
}
