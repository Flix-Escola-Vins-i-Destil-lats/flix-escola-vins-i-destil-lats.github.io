// Une la matriz de tiempos con el optimizador y guarda los tiempos entre paradas para reutilizarlos
// en cada "Siguiente" (así solo se pide de nuevo la fila desde donde estás, que es la que cambia).

import { travelMatrix } from './geo.js';
import { optimize } from './solver.js';

// La clave incluye la ubicación: si una parada o el almacén se mueven, sus tiempos guardados dejan de valer.
const nodeKey = (p, id) => `${id}@${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
const pairKey = (a, b) => `${a}>${b}`;

// pairs: { "idA@lat,lon>idB@lat,lon": { m: minutos, km, at: timestamp, src } }
function haveFreshPairs(keys, pairs, src, maxAgeMin) {
  const limit = Date.now() - maxAgeMin * 60000;
  for (let i = 0; i < keys.length - 1; i++) {
    for (let j = 0; j < keys.length; j++) {
      if (i === j) continue;
      const p = pairs[pairKey(keys[i], keys[j])];
      if (!p || p.src !== src || p.at < limit) return false;
    }
  }
  return true;
}

/**
 * from: {lat, lon} punto de salida. stops: [{id, lat, lon, windows:[[a,b]], service}].
 * startMin: minuto del día en que se sale. departAt: Date de salida (para el tráfico).
 * maxAgeMin: antigüedad máxima de los tiempos entre paradas guardados para reutilizarlos.
 */
export async function computePlan({ from, stops, depot, startMin, departAt, key, live, pairs = {}, maxAgeMin = 90, returnToDepot = true }) {
  if (stops.length === 0) return { order: [], legs: [], end: startMin, late: 0, wait: 0, km: 0, pairs };
  const src = key ? 'tomtom' : 'osrm';
  const dests = [...stops, depot];
  // keys[i] para i < n: paradas; keys[n]: almacén.
  const keys = [...stops.map((s) => nodeKey(s, s.id)), nodeKey(depot, 'depot')];
  const reusePairs = haveFreshPairs(keys, pairs, src, maxAgeMin);
  const origins = reusePairs ? [from] : [from, ...stops];
  const mx = await travelMatrix(origins, dests, { key, departAt, live });

  const now = Date.now();
  const next = {};
  // Solo se conservan los pares de las paradas actuales: lo demás es peso muerto en el móvil.
  for (let i = 0; i < stops.length; i++) {
    for (let j = 0; j < keys.length; j++) {
      if (i === j) continue;
      const k = pairKey(keys[i], keys[j]);
      if (reusePairs) next[k] = pairs[k];
      else next[k] = { m: mx.minutes[i + 1][j], km: mx.km[i + 1][j], at: now, src };
    }
  }

  const n = stops.length;
  const minutes = (i, j) => {
    // i, j: 0 = salida, 1..n = paradas, n+1 = almacén
    if (i === 0) return { m: mx.minutes[0][j - 1], km: mx.km[0][j - 1] };
    if (i === j) return { m: 0, km: 0 };
    return next[pairKey(keys[i - 1], keys[j - 1])];
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
