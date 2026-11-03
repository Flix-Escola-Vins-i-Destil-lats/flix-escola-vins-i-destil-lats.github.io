import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAddress } from '../js/geo.js';

test('al buscar, lo del local tras el número se quita (el buscador quiere el portal)', () => {
  assert.equal(normalizeAddress('CARRER COPERNIC, 75 LOCAL 2, BARCELONA'), 'CARRER COPERNIC, 75, Barcelona');
  assert.match(normalizeAddress('C/ Major 12 bajos, Cornellà'), /Major 12, /);
  assert.match(normalizeAddress('Av. Diagonal 3 piso 2, Barcelona'), /Diagonal 3, /);
  assert.match(normalizeAddress('Carrer Local 5, Barcelona'), /Local 5, /); // "Local" como nombre de calle no se toca
  assert.match(normalizeAddress('GRANADA DEL PENEDES, 19-21, BARCELONA'), /19-21/);
});
