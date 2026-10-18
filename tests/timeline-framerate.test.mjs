import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the real legacy UXP metadata reader without loading the Adobe runtime.
const source = fs.readFileSync(new URL('../src/api/premierepro.ts', import.meta.url), 'utf8');
const reader = source.slice(source.indexOf('const PREMIERE_TICKS_PER_SECOND'), source.indexOf('export const fetchTranscriptJSON'))
  .replace('export const getActiveSequenceInfo', 'globalThis.getActiveSequenceInfo');
async function sequenceInfo(timebase) {
  const sequence = {
    guid: 'timeline', name: 'Timeline rate',
    getSettings: async () => ({ getVideoFrameRect: async () => ({ width: 1920, height: 1080 }) }),
    getEndTime: async () => ({ seconds: 10 }), getTimebase: async () => timebase,
  };
  const context = vm.createContext({
    premierepro: { Project: { getActiveProject: async () => ({ getActiveSequence: async () => sequence }) } },
    console: { log() {}, error() {} },
  });
  vm.runInContext(reader, context);
  return context.getActiveSequenceInfo();
}
test('timeline metadata preserves exact fractional cadence and integer rates', async () => {
  for (const [ticks, expected] of [[10594584000, 24000 / 1001], [8475667200, 30000 / 1001], [8467200000, 30], [4233600000, 60]]) {
    assert.equal((await sequenceInfo(String(ticks))).frameRate, expected);
  }
});
test('an unavailable or malformed timeline timebase never silently chooses 24 fps', async () => {
  for (const value of ['', '0', '-1', '8467200000junk', 'NaN', 'Infinity', undefined, 1.5, '1']) {
    assert.equal(await sequenceInfo(value), null);
  }
});
