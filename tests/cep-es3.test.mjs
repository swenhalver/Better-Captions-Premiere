import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../webview-ui/package.json', import.meta.url));
const { parse } = require('acorn');
test('the entire installed CEP host bridge parses as strict ES3, including future-reserved identifiers', () => {
  const source = readFileSync(new URL('../cep/host/bridge.jsx', import.meta.url), 'utf8');
  assert.doesNotThrow(() => parse(source, { ecmaVersion: 3, allowReserved: 'never' }));
  assert.throws(() => parse('var native = [];', { ecmaVersion: 3, allowReserved: 'never' }), /reserved/);
});
