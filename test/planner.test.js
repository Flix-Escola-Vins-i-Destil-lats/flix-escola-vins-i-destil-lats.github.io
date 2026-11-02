import test from 'node:test';
import assert from 'node:assert/strict';

// Red simulada: tiempos = distancia en "grados" × 1000 min; cuenta cuántos orígenes se piden.
let requests = [];
globalThis.fetch = async (url) => {
  const m = String(url).match(/driving\/([^?]+)\?sources=([^&]+)&destinations=([^&]+)/);
  const pts = m[1].split(';').map((p) => p.split(',').map(Number));
  const src = m[2].split(';').map(Number), dst = m[3].split(';').map(Number);
  requests.push(src.length);
  const d = (a, b) => Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]) * 1000;
  return { ok: true, json: async () => ({ code: 'Ok', durations: src.map((a) => dst.map((b) => d(a, b) * 60)), distances: src.map((a) => dst.map((b) => d(a, b))) }) };
};
const { computePlan } = await import('../js/planner.js');

const depot = { lat: 41.37, lon: 2.07 };
const night = new Date('2026-11-03T03:00:00'); // factor de tráfico 1,1
const stops = [
  { id: 'a', lat: 41.38, lon: 2.08, windows: [], service: 5 },
  { id: 'b', lat: 41.39, lon: 2.09, windows: [], service: 5 },
];

test('reutiliza los tiempos entre paradas y solo pide la fila desde donde estás', async () => {
  requests = [];
  const p1 = await computePlan({ from: depot, depot, stops, startMin: 450, departAt: night });
  const p2 = await computePlan({ from: depot, depot, stops, startMin: 450, departAt: night, pairs: p1.pairs });
  assert.deepEqual(requests, [3, 1]);
  assert.deepEqual(p2.order, p1.order);
});

test('si una parada cambia de sitio, sus tiempos guardados no se reutilizan', async () => {
  requests = [];
  const p1 = await computePlan({ from: depot, depot, stops, startMin: 450, departAt: night });
  const moved = [stops[0], { ...stops[1], lat: 41.5, lon: 2.3 }];
  await computePlan({ from: depot, depot, stops: moved, startMin: 450, departAt: night, pairs: p1.pairs });
  assert.deepEqual(requests, [3, 3]);
});

test('OSRM recibe cada punto una sola vez', async () => {
  let sent = '';
  const f = globalThis.fetch;
  globalThis.fetch = (url) => { sent = url; return f(url); };
  await computePlan({ from: depot, depot, stops, startMin: 450, departAt: night });
  globalThis.fetch = f;
  const coords = sent.match(/driving\/([^?]+)/)[1].split(';');
  assert.equal(coords.length, new Set(coords).size);
  assert.equal(coords.length, 3); // salida = almacén, a, b
});
