import test from 'node:test';
import assert from 'node:assert/strict';

// Red simulada. openrouteservice: tiempos = distancia en "grados" × 1000 min. TomTom: lo que diga `jam`.
let requests = [], tomtomCalls = 0, jam = null, lastOrsBody = null;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.includes('openrouteservice')) {
    const body = JSON.parse(opts.body);
    lastOrsBody = body;
    requests.push(body.sources.length);
    const p = body.locations;
    const d = (a, b) => Math.hypot(p[a][0] - p[b][0], p[a][1] - p[b][1]) * 1000;
    return { ok: true, status: 200, json: async () => ({ durations: body.sources.map((a) => body.destinations.map((b) => d(a, b) * 60)), distances: body.sources.map((a) => body.destinations.map((b) => d(a, b))) }) };
  }
  if (url.includes('calculateRoute')) {
    tomtomCalls++;
    const pts = url.match(/calculateRoute\/([^/]+)\/json/)[1].split(':').map((s) => s.split(',').map(Number));
    const legs = pts.slice(1).map((b, i) => ({ summary: { travelTimeInSeconds: (jam?.(pts[i], b) ?? 5) * 60 } }));
    return { ok: true, status: 200, json: async () => ({ routes: [{ legs }] }) };
  }
  throw new Error('URL inesperada ' + url);
};
const { computePlan } = await import('../js/planner.js');

const depot = { lat: 41.37, lon: 2.07 };
const night = new Date('2026-11-03T03:00:00'); // factor de tráfico 1,1
const stops = [
  { id: 'a', lat: 41.38, lon: 2.08, windows: [], service: 5 },
  { id: 'b', lat: 41.39, lon: 2.09, windows: [], service: 5 },
];
const base = { from: depot, depot, startMin: 450, departAt: night, orsKey: 'k' };

test('reutiliza los tiempos entre paradas y solo pide la fila desde donde estás', async () => {
  requests = [];
  const p1 = await computePlan({ ...base, stops });
  const p2 = await computePlan({ ...base, stops, pairs: p1.pairs });
  assert.deepEqual(requests, [3, 1]);
  assert.deepEqual(p2.order, p1.order);
  assert.equal(p1.source, 'ors');
});

test('si una parada cambia de sitio, sus tiempos guardados no se reutilizan', async () => {
  requests = [];
  const p1 = await computePlan({ ...base, stops });
  const moved = [stops[0], { ...stops[1], lat: 41.5, lon: 2.3 }];
  await computePlan({ ...base, stops: moved, pairs: p1.pairs });
  assert.deepEqual(requests, [3, 3]);
});

test('cada punto se manda una sola vez', async () => {
  await computePlan({ ...base, stops });
  assert.equal(lastOrsBody.locations.length, 3); // salida = almacén, a, b
});

test('sin clave de rutas: estimación por distancia, sin red', async () => {
  requests = [];
  const p = await computePlan({ ...base, stops, orsKey: '' });
  assert.equal(p.source, 'estimate');
  assert.equal(requests.length, 0);
  assert.equal(p.order.length, 2);
});

test('con TomTom: un atasco en un tramo cambia el orden y no se guarda en la caché', async () => {
  // Sin tráfico el orden natural es a → b. Atasco de 60 min para llegar a "a" desde el almacén.
  const near = (p, q) => Math.abs(p[0] - q.lat) < 1e-4 && Math.abs(p[1] - q.lon) < 1e-4;
  const p0 = await computePlan({ ...base, stops });
  tomtomCalls = 0;
  jam = (from, to) => (near(from, depot) && near(to, stops[0]) ? 60 : 5);
  const p1 = await computePlan({ ...base, stops, tomtomKey: 't', live: true });
  jam = null;
  assert.deepEqual(p0.order, ['a', 'b']);
  assert.deepEqual(p1.order, ['b', 'a']);
  assert.ok(tomtomCalls >= 1 && tomtomCalls <= 3, `${tomtomCalls} consultas`);
  assert.equal(p1.source, 'tomtom');
  assert.ok(Object.values(p1.pairs).every((x) => x.src === 'ors'));
});
