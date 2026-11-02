import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWindows, parseList, clientKey, fmt } from '../js/parse.js';

test('horarios en formatos habituales', () => {
  assert.deepEqual(parseWindows('9-11:30'), [[540, 690]]);
  assert.deepEqual(parseWindows('de 9 a 11.30h'), [[540, 690]]);
  assert.deepEqual(parseWindows('09:00 - 13:00 / 16:00 - 19:30'), [[540, 780], [960, 1170]]);
  assert.deepEqual(parseWindows('de les 10 a les 13h'), [[600, 780]]);
  assert.deepEqual(parseWindows('Horario: 10-12'), [[600, 720]]);
  assert.deepEqual(parseWindows('Carrer Major 9-11, Cornellà'), []);
});

test('lista de una línea por parada', () => {
  const list = parseList(`1. Vinos Paco - C/ Major 12, Sant Feliu de Llobregat - 9:00-11:30
Bar La Plaça | Plaça de la Vila 3, Cornellà
Carrer de Sants 100, Barcelona`);
  assert.equal(list.length, 3);
  assert.deepEqual(list[0], { name: 'Vinos Paco', address: 'C/ Major 12, Sant Feliu de Llobregat', windows: [[540, 690]] });
  assert.equal(list[1].name, 'Bar La Plaça');
  assert.equal(list[1].address, 'Plaça de la Vila 3, Cornellà');
  assert.equal(list[2].address, 'Carrer de Sants 100, Barcelona');
});

test('bloques separados por línea en blanco', () => {
  const list = parseList(`Restaurant Can Pep
Av. de Barcelona 45, Sant Joan Despí
Horario 10:00-13:00

Vinoteca Montse
Rambla Just Oliveras 20, L'Hospitalet`);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { name: 'Restaurant Can Pep', address: 'Av. de Barcelona 45, Sant Joan Despí', windows: [[600, 780]] });
  assert.equal(list[1].address, "Rambla Just Oliveras 20, L'Hospitalet");
});

test('memoria por nombre tolera mayúsculas, acentos y S.L.', () => {
  assert.equal(clientKey('Vinos Paco S.L.'), clientKey('vinos  PACO'));
  assert.equal(clientKey('Bodega Lluís'), 'bodega lluis');
  assert.equal(fmt(690), '11:30');
});
