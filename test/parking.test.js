import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeParking, spotsFor, medianPoint, walkM, BLOCK_M, groupKey } from '../js/parking.js';
import { computePlan } from '../js/planner.js';

// Puntos a x metros al este e y al norte de una esquina del Eixample.
const O = { lat: 41.39, lon: 2.16 };
const at = (x, y) => ({ lat: O.lat + y / 111200, lon: O.lon + x / (111200 * Math.cos(O.lat * Math.PI / 180)) });
const stop = (id, x, y, windows = [], service = 10) => ({ id, ...at(x, y), windows, service });
const zone = (x, y, label) => { const p = at(x, y); return [p.lat, p.lon, label]; };
const legsOf = (list, t0 = 600) => new Map(list.map((s, i) => [s.id, { id: s.id, arrive: t0 + i * 20, begin: t0 + i * 20, wait: 0, late: 0, drive: 4 }]));

test('el punto medio de tres entregas queda entre ellas', () => {
  const m = medianPoint([at(0, 0), at(200, 0), at(100, 150)]);
  assert.ok(walkM(m, at(100, 50)) < 60);
});

test('dos entregas a una manzana: aparcar en la zona DUM que queda entre las dos', () => {
  const stops = [stop('a', 0, 0), stop('b', 140, 0), stop('c', 3000, 0)];
  const zones = [zone(70, 10, 'C Tuset, 20'), zone(400, 0, 'C Lejos, 1'), zone(0, -40, 'C Junto A, 2')];
  const [p, ...rest] = proposeParking({ order: ['a', 'b', 'c'], stops, legs: legsOf(stops), zones });
  assert.equal(rest.length, 0); // la tercera está lejos
  assert.deepEqual(p.ids, ['a', 'b']);
  assert.equal(p.spot.label, 'C Tuset, 20');
  assert.equal(p.spot.dum, true);
  assert.ok(p.parked <= 30, `aparcado ${p.parked} min`);
});

test('«otro sitio» propone una zona distinta y lejos de la descartada; «no» quita el grupo', () => {
  const stops = [stop('a', 0, 0), stop('b', 140, 0)];
  const zones = [zone(70, 10, 'Mejor'), zone(85, 10, 'Pegada a la mejor'), zone(0, -40, 'Otra')];
  const legs = legsOf(stops);
  const key = groupKey(['a', 'b']);
  const first = proposeParking({ order: ['a', 'b'], stops, legs, zones });
  assert.equal(first[0].spot.label, 'Mejor');
  const second = proposeParking({ order: ['a', 'b'], stops, legs, zones, rejected: { [key]: [first[0].spot] } });
  assert.equal(second[0].spot.label, 'Otra');
  const none = proposeParking({ order: ['a', 'b'], stops, legs, zones, rejected: { [key]: 'off' } });
  assert.equal(none.length, 0);
});

test('hasta 3 manzanas con dos entregas; con tres juntas, hasta 4', () => {
  const far = 3.2 * BLOCK_M;
  const two = [stop('a', 0, 0), stop('b', 2 * far / 1.25, 0)]; // cada una a ~3,5 manzanas a pie del medio
  assert.equal(proposeParking({ order: ['a', 'b'], stops: two, legs: legsOf(two), zones: [] }).length, 0);
  // Con descargas cortas caben en los 30 min de SPRO (unos 24 min andando ida y vuelta)
  const three = [stop('a', 0, 0, [], 1), stop('b', 2 * far / 1.25, 0, [], 1), stop('c', far / 1.25, 30, [], 1)];
  const [p] = proposeParking({ order: ['a', 'b', 'c'], stops: three, legs: legsOf(three), zones: [] });
  assert.deepEqual(p.ids, ['a', 'b', 'c']);
  assert.equal(p.spot.dum, false); // sin zonas DUM: el punto medio
  assert.ok(p.blocks > 3 && p.blocks <= 4);
  // Con 10 min de descarga cada una serían más de 50 min aparcado: las tres juntas no caben
  const slow = three.map((s) => ({ ...s, service: 10 }));
  const props = proposeParking({ order: ['a', 'b', 'c'], stops: slow, legs: legsOf(slow), zones: [] });
  assert.ok(!props.some((x) => x.ids.length === 3));
});

test('no agrupa si habría que esperar mucho, si alguna llegaría tarde o si no cabe en los 30 min de SPRO', () => {
  const wait = [stop('a', 0, 0, [[600, 700]]), stop('b', 140, 0, [[720, 780]])];
  assert.equal(proposeParking({ order: ['a', 'b'], stops: wait, legs: legsOf(wait), zones: [] }).length, 0);
  const late = [stop('a', 0, 0, [[600, 700]]), stop('b', 140, 0, [[600, 612]])];
  assert.equal(proposeParking({ order: ['a', 'b'], stops: late, legs: legsOf(late), zones: [] }).length, 0);
  const slow = [stop('a', 0, 0, [], 15), stop('b', 140, 0, [], 15)];
  assert.equal(proposeParking({ order: ['a', 'b'], stops: slow, legs: legsOf(slow), zones: [zone(70, 0, 'Z')] }).length, 0);
});

test('si la primera aún no ha abierto, esa espera no cuenta como tiempo aparcado', () => {
  const stops = [stop('a', 0, 0, [[640, 700]]), stop('b', 140, 0, [[600, 720]])];
  const [p] = proposeParking({ order: ['a', 'b'], stops, legs: legsOf(stops, 600), zones: [] });
  assert.deepEqual(p.ids, ['a', 'b']);
  assert.ok(p.parked < 30, `aparcado ${p.parked} min`);
});

test('solo agrupa entregas seguidas y no repite las que ya tienen aparcamiento', () => {
  const stops = [stop('a', 0, 0), stop('x', 3000, 0), stop('b', 140, 0)];
  assert.equal(proposeParking({ order: ['a', 'x', 'b'], stops, legs: legsOf(stops), zones: [] }).length, 0);
  const near = [stop('a', 0, 0), stop('b', 140, 0), stop('c', 200, 60)];
  const props = proposeParking({ order: ['a', 'b', 'c'], stops: near, legs: legsOf(near), zones: [], taken: new Set(['a']) });
  assert.deepEqual(props[0].ids, ['b', 'c']);
});

test('sitios: sin zonas DUM cerca sale el punto medio, y una sola vez', () => {
  const members = [stop('a', 0, 0), stop('b', 140, 0)];
  const [mid] = spotsFor(members, []);
  assert.equal(mid.dum, false);
  assert.equal(spotsFor(members, [], [mid]).length, 0);
});

test('con un aparcamiento aceptado, entre sus entregas se va a pie pasando por la furgoneta', async () => {
  const depot = at(-4000, 0);
  const stops = [stop('a', 0, 0), stop('b', 140, 0)];
  const spot = at(70, 0);
  const plan = await computePlan({ from: depot, depot, stops, startMin: 540, departAt: new Date('2026-11-04T09:00:00'), returnToDepot: true,
    parking: [{ ids: ['a', 'b'], ...spot }] });
  const [first, second] = plan.legs;
  assert.equal(first.foot, false);
  assert.ok(first.walk > 0.5 && first.walk < 2); // del aparcamiento a la primera
  assert.equal(second.foot, true);
  assert.equal(second.km, 0);
  assert.ok(Math.abs(second.drive - (walkM(spot, stops[0]) + walkM(spot, stops[1])) / 70) < 0.01);
  // Sin aparcamiento, el mismo tramo es en coche
  const car = await computePlan({ from: depot, depot, stops, startMin: 540, departAt: new Date('2026-11-04T09:00:00'), returnToDepot: true });
  assert.equal(car.legs[1].foot, false);
});
