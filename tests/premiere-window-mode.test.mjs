import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const source = readFileSync(new URL('../scripts/maximize-premiere-sspace.swift', import.meta.url), 'utf8');

test('window verifier cannot invoke the green/full-screen button or resize the app', () => {
  assert.doesNotMatch(source, /\bAXUIElementPerformAction\s*\(/);
  assert.doesNotMatch(source, /\bAXUIElementSetAttributeValue\s*\(/);
  assert.match(source, /AXFullScreen/);
});

test('normal maximization excludes full-monitor and menu-bar-covering frames', { skip: process.platform !== 'darwin' }, () => {
  const predicate = source.match(/func fills\(_ rect: CGRect\) -> Bool \{[\s\S]*?\n\}/)?.[0];
  assert.ok(predicate, 'Actual frame predicate must be exercised');
  const program = `
import Foundation
import CoreGraphics
let target = CGRect(x: -2560, y: 1137, width: 2560, height: 1409)
${predicate}
assert(fills(target))
assert(fills(CGRect(x: -2559, y: 1138, width: 2559, height: 1408)))
assert(!fills(CGRect(x: -2560, y: 1106, width: 2560, height: 1440)))
assert(!fills(CGRect(x: -2560, y: 1106, width: 2560, height: 1409)))
assert(!fills(CGRect(x: -2560, y: 1137, width: 2054, height: 1409)))
assert(!fills(CGRect(x: 0, y: 1137, width: 2560, height: 1409)))
`;
  const result = spawnSync('swift', ['-'], { input: program, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
