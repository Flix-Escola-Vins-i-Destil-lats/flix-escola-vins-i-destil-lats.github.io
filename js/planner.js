// Une la matriz de tiempos con el optimizador y guarda los tiempos entre paradas para reutilizarlos
// en cada "Siguiente" (así solo se pide de nuevo la fila desde donde estás, que es la que cambia).

import { travelMatrix, trafficLegs } from './geo.js';
import { optimize, evaluate } from './solver.js';

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
 * orsKey: openrouteservice (tiempos de conducción). tomtomKey + live: corrección con tráfico (no se guarda).
 */
export async function computePlan({ from, stops, depot, startMin, departAt, orsKey, tomtomKey, live, pairs = {}, maxAgeMin = 90, returnToDepot = true }) {
  if (stops.length === 0) return { order: [], legs: [], end: startMin, late: 0, wait: 0, km: 0, pairs };
  const src = orsKey ? 'ors' : 'estimate';
  const dests = [...stops, depot];
  // keys[i] para i < n: paradas; keys[n]: almacén.
  const keys = [...stops.map((s) => nodeKey(s, s.id)), nodeKey(depot, 'depot')];
  const reusePairs = haveFreshPairs(keys, pairs, src, maxAgeMin);
  const origins = reusePairs ? [from] : [from, ...stops];
  const mx = await travelMatrix(origins, dests, { orsKey, departAt });

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
  let best = optimize(ctx);

  // Con TomTom: se piden los tiempos con tráfico de la ruta elegida (una consulta), se corrigen esos tramos
  // y se vuelve a optimizar; si el orden cambia, se comprueba también el nuevo (máximo 3 consultas).
  let traffic = false;
  if (tomtomKey) {
    const seen = new Set();
    for (let round = 0; round < 3; round++) {
      const key = best.order.join(',');
      if (seen.has(key)) break;
      seen.add(key);
      const nodes = [0, ...best.order, ...(returnToDepot ? [n + 1] : [])];
      const point = (i) => (i === 0 ? from : i === n + 1 ? depot : stops[i - 1]);
      let legsMin = null;
      try { legsMin = await trafficLegs(nodes.map(point), { key: tomtomKey, departAt, live }); } catch (e) { if (/clave/.test(e.message)) throw e; }
      if (!legsMin) break;
      traffic = true;
      legsMin.forEach((m, k) => {
        const a = nodes[k], b = nodes[k + 1];
        if (b === n + 1) back[a] = m; else matrix[a][b] = m;
      });
      const again = optimize(ctx);
      best = again.order.join(',') === key ? evaluateOrder(best.order, ctx) : again;
    }
  }

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
    source: traffic ? 'tomtom' : mx.source,
    live: traffic && !!live,
    computedAt: now,
    startMin,
    pairs: next,
  };
}

function evaluateOrder(order, ctx) {
  return { order, ...evaluate(order, ctx) };
}
