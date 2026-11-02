// Optimizador de ruta con ventanas horarias (TSPTW).
// Tiempos en minutos desde medianoche. Matriz de viaje en minutos.
// Nodo 0 = punto de salida (almacén o posición actual); nodos 1..n = paradas.

const LATE_PENALTY = 1000; // cada minuto tarde pesa como ~17 h de ruta: llegar tarde es lo último

// Recorre un orden y devuelve horarios, esperas y retrasos.
export function evaluate(order, ctx) {
  const { matrix, stops, start, returnTo } = ctx;
  let t = start;
  let prev = 0;
  let late = 0;
  let wait = 0;
  const legs = [];
  for (const i of order) {
    const s = stops[i - 1];
    const arrive = t + matrix[prev][i];
    const { begin, lateBy } = serviceStart(arrive, s.windows);
    wait += begin - arrive;
    late += lateBy;
    legs.push({ node: i, arrive, begin, wait: begin - arrive, late: lateBy, drive: matrix[prev][i] });
    t = begin + (s.service ?? 0);
    prev = i;
  }
  // back[i] = minutos del nodo i al almacén, cuando el punto de salida no es el almacén (p. ej. tras una entrega)
  const back = returnTo !== false && order.length ? (ctx.back ? ctx.back[prev] : matrix[prev][0]) : 0;
  const end = t + back;
  const drive = legs.reduce((s, l) => s + l.drive, 0) + back;
  // Primero no llegar tarde, luego acabar antes; a igual hora de fin, menos conducción y menos esperas parado.
  const cost = late * LATE_PENALTY + (end - start) + 0.25 * drive + 0.1 * wait;
  return { legs, end, late, wait, drive, cost };
}

// Primera ventana en la que se puede atender; si ya han cerrado todas, se atiende al llegar y cuenta el retraso.
export function serviceStart(arrive, windows) {
  if (!windows || windows.length === 0) return { begin: arrive, lateBy: 0 };
  const ws = [...windows].sort((a, b) => a[0] - b[0]);
  for (const [open, close] of ws) {
    if (arrive <= close) return { begin: Math.max(arrive, open), lateBy: 0 };
  }
  const lastClose = ws[ws.length - 1][1];
  return { begin: arrive, lateBy: arrive - lastClose };
}

function* permutations(arr) {
  if (arr.length <= 1) { yield arr.slice(); return; }
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) { p.unshift(arr[i]); yield p; }
  }
}

export function bruteForce(ctx) {
  const ids = ctx.stops.map((_, i) => i + 1);
  let best = null;
  for (const p of permutations(ids)) {
    const e = evaluate(p, ctx);
    if (!best || e.cost < best.cost) best = { order: p, ...e };
  }
  return best;
}

// Generador pseudoaleatorio reproducible (mulberry32) para que dos ejecuciones den la misma ruta.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Construcción voraz: siempre la parada que antes se puede empezar a atender, priorizando las que cierran antes.
function greedy(ctx) {
  const left = new Set(ctx.stops.map((_, i) => i + 1));
  const order = [];
  let t = ctx.start;
  let prev = 0;
  while (left.size) {
    let pick = null;
    let pickScore = Infinity;
    for (const i of left) {
      const s = ctx.stops[i - 1];
      const arrive = t + ctx.matrix[prev][i];
      const { begin, lateBy } = serviceStart(arrive, s.windows);
      const closes = s.windows?.length ? Math.max(...s.windows.map((w) => w[1])) : 24 * 60;
      const score = lateBy * LATE_PENALTY + begin + (closes - begin) * 0.05;
      if (score < pickScore) { pickScore = score; pick = i; }
    }
    const s = ctx.stops[pick - 1];
    const { begin } = serviceStart(t + ctx.matrix[prev][pick], s.windows);
    t = begin + (s.service ?? 0);
    prev = pick;
    order.push(pick);
    left.delete(pick);
  }
  return order;
}

function neighbour(order, rand) {
  const n = order.length;
  const o = order.slice();
  const i = Math.floor(rand() * n);
  let j = Math.floor(rand() * (n - 1));
  if (j >= i) j++;
  const move = rand();
  if (move < 0.4) {
    // mover una parada a otra posición
    const [x] = o.splice(i, 1);
    o.splice(j, 0, x);
  } else if (move < 0.7) {
    [o[i], o[j]] = [o[j], o[i]];
  } else {
    // invertir un tramo (2-opt)
    const a = Math.min(i, j), b = Math.max(i, j);
    for (let l = a, r = b; l < r; l++, r--) [o[l], o[r]] = [o[r], o[l]];
  }
  return o;
}

// Recocido simulado con varios arranques. Para pocas paradas, búsqueda exhaustiva.
export function optimize(ctx, opts = {}) {
  const n = ctx.stops.length;
  if (n === 0) return { order: [], ...evaluate([], ctx) };
  if (n <= 8) return bruteForce(ctx);
  const rand = rng(opts.seed ?? 12345);
  const restarts = opts.restarts ?? 6;
  const iters = opts.iterations ?? Math.min(60000, 1500 * n);
  let best = null;
  for (let r = 0; r < restarts; r++) {
    let cur = r === 0 ? greedy(ctx) : shuffle(greedy(ctx), rand, Math.ceil(n / 3));
    let curE = evaluate(cur, ctx);
    if (!best || curE.cost < best.cost) best = { order: cur, ...curE };
    let temp = 30;
    const cool = Math.pow(0.05 / temp, 1 / iters);
    for (let k = 0; k < iters; k++) {
      const cand = neighbour(cur, rand);
      const e = evaluate(cand, ctx);
      const delta = e.cost - curE.cost;
      if (delta <= 0 || rand() < Math.exp(-delta / temp)) {
        cur = cand; curE = e;
        if (e.cost < best.cost) best = { order: cand, ...e };
      }
      temp *= cool;
    }
  }
  return best;
}

function shuffle(order, rand, swaps) {
  const o = order.slice();
  for (let k = 0; k < swaps; k++) {
    const i = Math.floor(rand() * o.length), j = Math.floor(rand() * o.length);
    [o[i], o[j]] = [o[j], o[i]];
  }
  return o;
}
