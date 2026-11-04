import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAddress, sameNumber } from '../js/geo.js';

test('al buscar, lo del local tras el número se quita (el buscador quiere el portal)', () => {
  assert.equal(normalizeAddress('CARRER COPERNIC, 75 LOCAL 2, BARCELONA'), 'CARRER COPERNIC, 75, Barcelona');
  assert.match(normalizeAddress('C/ Major 12 bajos, Cornellà'), /Major 12, /);
  assert.match(normalizeAddress('Av. Diagonal 3 piso 2, Barcelona'), /Diagonal 3, /);
  assert.match(normalizeAddress('Carrer Local 5, Barcelona'), /Local 5, /); // "Local" como nombre de calle no se toca
  assert.match(normalizeAddress('GRANADA DEL PENEDES, 19-21, BARCELONA'), /19-21/);
});

test('el local, los bajos o el distrito en un trozo aparte (tras una coma) tampoco se buscan', () => {
  assert.equal(normalizeAddress('CARRER SERRA, 12, LOCAL IZQUIERDA, BARCELONA'), 'CARRER SERRA, 12, Barcelona');
  assert.equal(normalizeAddress('VIA AUGUSTA 40, BAJOS, BARCELONA'), 'VIA AUGUSTA 40, Barcelona');
  assert.equal(normalizeAddress('PASSEIG DEL BORN, 8, CIUTAT VELLA, BARCELONA'), 'PASSEIG DEL BORN, 8, Barcelona');
  assert.equal(normalizeAddress('CARRER MAJOR, 3, SANT MARTI, BARCELONA'), 'CARRER MAJOR, 3, Barcelona');
  // El nombre de un distrito como calle o como población se queda
  assert.match(normalizeAddress('CARRER DE GRACIA, 4, BARCELONA'), /GRACIA, 4/);
  assert.match(normalizeAddress('LOCAL, 4, BARCELONA'), /^LOCAL, 4/);
});

test('los tramos de la Rambla se buscan como «La Rambla» (en el callejero es una sola calle)', () => {
  assert.equal(normalizeAddress('RAMBLA DELS CAPUTXINS, 31, CIUTAT VELLA, BARCELONA'), 'La Rambla, 31, Barcelona');
  assert.match(normalizeAddress('Rambla de Santa Mònica 7, Barcelona'), /^La Rambla 7/);
  assert.match(normalizeAddress('RAMBLA CANALETES 2, BARCELONA'), /^La Rambla 2/);
  assert.match(normalizeAddress('RAMBLA DEL RAVAL 9, BARCELONA'), /RAVAL/); // otra rambla: no se toca
});

test('el número del resultado tiene que ser el buscado (o caer en su tramo «6-10»)', () => {
  assert.equal(sameNumber('VIA LAIETANA 54, Barcelona', 'Via Laietana 53, Barcelona'), false);
  assert.equal(sameNumber('La Rambla, 31, Barcelona', 'Paseo Dels Caputxins 11, Barcelona'), false);
  assert.equal(sameNumber('ABAIXADORS, 10, Barcelona', 'Carrer dels Abaixadors 6-10, Barcelona'), true);
  assert.equal(sameNumber('ABAIXADORS, 8, Barcelona', 'Carrer dels Abaixadors 6-10, Barcelona'), true);
  assert.equal(sameNumber('PINTOR FORTUNY, 6-8, Barcelona', 'Carrer del Pintor Fortuny 6, Barcelona'), true);
  assert.equal(sameNumber('CARRER MAJOR, Barcelona', 'Carrer Major 3, Barcelona'), true); // sin número no hay qué comparar
  assert.equal(sameNumber('CARRER MAJOR 3, 08001 Barcelona', 'Carrer Major 3, Barcelona'), true); // el código postal no cuenta
});
