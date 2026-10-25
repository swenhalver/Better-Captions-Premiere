import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { derivePauseLines, removePauseLine } from '../webview-ui/src/lib/native-effect/pause-lines.ts';
import { nativeCaptionPhrases } from '../webview-ui/src/lib/native-effect/phrases.ts';
import { transcriptLines, transcriptWords, changeTranscriptLineBreak, replaceTranscriptLine, transcriptLineCaption } from '../webview-ui/src/lib/transcript/lines.ts';
import { replaceText } from '../webview-ui/src/lib/transcript/edit.ts';
import { defaultNativeStyle } from '../webview-ui/src/lib/native-effect/contract.ts';
import { encodeNativeDocument } from '../webview-ui/src/lib/native-effect/encode.ts';

const settings = (blankLineSeconds = 1, visibleLines = 4) => ({ blankLineSeconds, visibleLines });
const caption = (id, startTime, endTime, pauseLinesRemoved) => ({ id, text: id, startTime, endTime,
  words: [{ text: id, startTime, endTime, endOfSentence: true, isActive: false,
    ...(pauseLinesRemoved === undefined ? {} : { pauseLinesRemoved }) }] });
const ranges = rows => rows.map(({ startTime, endTime, nextWordIndex }) => [startTime, endTime, nextWordIndex]);
const sourceWords = captions => transcriptWords(captions).map(({ pauseLinesRemoved, ...word }) => word);

function fixture() {
  return JSON.parse(readFileSync(new URL('./helpers/pause-line-project.json', import.meta.url), 'utf8')).captions;
}
function document(captions) {
  return { version: 1, binaryVersion: 9, animationAuthority: 'premiere-effect', sequenceId: 'sequence', timeOriginSeconds: 0,
    style: defaultNativeStyle(), captions: captions.map(caption => ({ id: caption.id, start: caption.startTime,
      end: caption.endTime, manualSplit: !!caption.manualSplit,
      words: caption.words.map(({ startTime, endTime, isActive, ...word }) => ({ ...word, start: startTime, end: endTime })) })) };
}

test('pause derivation uses complete cadence intervals, cap-before-deletion and last-row remainder', () => {
  assert.deepEqual(derivePauseLines([], settings()), []);
  assert.deepEqual(derivePauseLines([caption('a', 0, 1)], settings()), []);
  for (const [nextStart, expected] of [[1.999999, []], [2, [[1, 2, 1]]], [3.5, [[1, 2, 1], [2, 3.5, 1]]]]) {
    assert.deepEqual(ranges(derivePauseLines([caption('a', 0, 1), caption('b', nextStart, nextStart + 1)], settings())), expected);
  }
  const captions = [caption('a', 0, 1), caption('b', 100, 101, 1)];
  assert.deepEqual(ranges(derivePauseLines(captions, settings())), [[1, 2, 1], [2, 3, 1], [3, 100, 1]]);
  assert.deepEqual(derivePauseLines(captions, settings(1, 1)), []);
  captions[1].words[0].pauseLinesRemoved = 8;
  assert.deepEqual(derivePauseLines(captions, settings()), []);
  for (const invalid of [settings(0, 0), settings(0, 9), settings(0, 1.5), settings(-1), settings(NaN), settings(31)]) {
    assert.throws(() => derivePauseLines(captions, invalid), /settings/);
  }
});

test('Auto cadence averages every spoken line across all storage containers', () => {
  const captions = [caption('short', 0, 1), caption('long', 4, 7), caption('last', 12, 14)];
  assert.deepEqual(ranges(derivePauseLines(captions, settings(0))), [[1, 4, 1], [7, 9, 2], [9, 12, 2]]);
  assert.deepEqual(ranges(derivePauseLines(captions, settings(1))), [[1, 2, 1], [2, 3, 1], [3, 4, 1], [7, 8, 2], [8, 9, 2], [9, 10, 2], [10, 12, 2]]);
});

test('deleting a pause addresses the following global word and preserves source identities and exact times', () => {
  const captions = nativeCaptionPhrases([caption('a', .123456789012345, 1), caption('b', 20, 21), caption('c', 21, 22)], 500);
  const before = structuredClone(captions), rows = transcriptLines(captions);
  let edited = removePauseLine(captions, rows[1].start);
  assert.deepEqual(captions, before);
  assert.deepEqual(sourceWords(edited), sourceWords(before));
  assert.deepEqual(edited.map(caption => [caption.id, caption.startTime, caption.endTime]), before.map(caption => [caption.id, caption.startTime, caption.endTime]));
  assert.equal(transcriptWords(edited)[1].pauseLinesRemoved, 1);
  assert.equal(transcriptLines(edited)[1].segment.words[0].pauseLinesRemoved, 1);
  assert.equal(derivePauseLines(edited, settings()).length, 3);
  for (let index = 1; index < 4; index++) edited = removePauseLine(edited, 1);
  assert.equal(derivePauseLines(edited, settings()).length, 0);
  assert.deepEqual(sourceWords(edited), sourceWords(before));
  const grouped = nativeCaptionPhrases(edited, 1);
  assert.equal(transcriptWords(grouped)[1].pauseLinesRemoved, 4);
  const merged = changeTranscriptLineBreak(grouped, transcriptLines(grouped)[1]);
  assert.equal(transcriptWords(merged)[1].pauseLinesRemoved, 4);
  for (const offset of [-1, 0, 1.5, 3]) assert.throws(() => removePauseLine(captions, offset), /Select/);
});

test('Swen project retains all 73 words and 22 text rows while deriving real short and long pauses', () => {
  const captions = fixture(), before = structuredClone(captions);
  assert.equal(transcriptWords(captions).length, 73);
  assert.equal(transcriptLines(captions).length, 22);
  assert.equal(derivePauseLines(captions, settings(0, 1)).length, 6);
  assert.equal(derivePauseLines(captions, settings(0, 2)).length, 8);
  assert.equal(derivePauseLines(captions, settings(0, 4)).length, 10);
  assert.equal(derivePauseLines(captions, settings(.5, 1)).length, 8);
  const longPause = derivePauseLines(captions, settings(1, 2)).filter(row => row.nextWordIndex === 55);
  assert.deepEqual(ranges(longPause), [[23.25666666666273, 24.25666666666273, 55], [24.25666666666273, 27.5, 55]]);
  const edited = removePauseLine(captions, 55);
  assert.deepEqual(ranges(derivePauseLines(edited, settings(1, 2)).filter(row => row.nextWordIndex === 55)), [[23.25666666666273, 27.5, 55]]);
  assert.equal(transcriptLines(edited).length, 22);
  assert.deepEqual(sourceWords(edited), sourceWords(captions));
  assert.deepEqual(captions, before);
});

test('TS pause rows match actual C++ derivation for Swen timings, both modes, caps, deletions and regrouping', () => {
  const root = fileURLToPath(new URL('../', import.meta.url)), temp = mkdtempSync(join(tmpdir(), 'bcap-pause-parity-'));
  try {
    const source = join(temp, 'pause-parity.cpp'), executable = join(temp, 'pause-parity');
    // Include production core in this one test TU to inspect its derived rows;
    // no duplicate algorithm or production testing API is needed.
    writeFileSync(source, `#include ${JSON.stringify(join(root, 'native/core/caption_core.cpp'))}
#include <fstream>
#include <iostream>
#include <iomanip>
#include <iterator>
int main(int argc,char** argv) {
  using namespace better_captions;
  std::ifstream input(argv[1],std::ios::binary);
  std::vector<std::uint8_t> bytes((std::istreambuf_iterator<char>(input)),{});
  auto d=decode(bytes); auto phrases=regroup(d,std::stoul(argv[2]));
  RollUpSettings settings;settings.visibleLines=std::stoul(argv[3]);settings.blankLineSeconds=std::stod(argv[4]);settings.enabled=std::stoi(argv[5]);
  auto rows=withSilenceRows(d,phrases,.6,settings);std::cout<<std::setprecision(17);
  std::size_t words=0;
  for(const auto& row:rows) { if(row.wordCount)words+=row.wordCount;else std::cout<<row.start<<" "<<row.end<<" "<<words<<"\\n"; }
}`);
    execFileSync(process.env.CXX || 'c++', ['-std=c++17', source, '-o', executable]);
    const original = fixture();
    // A long blank line must not set the Auto cadence in either implementation.
    const lines = transcriptLines(nativeCaptionPhrases(original, 56)), blanked = nativeCaptionPhrases(original, 56);
    const line = lines[5], blankRow = replaceText(transcriptLineCaption(blanked, line), '');
    blankRow.words[0].endTime = transcriptWords(blanked)[lines[6].start].startTime - .01; blankRow.words[0].endOfSentence = false;
    for (const captions of [original, removePauseLine(original, 55), removePauseLine(removePauseLine(original, 55), 55), replaceTranscriptLine(blanked, line, blankRow)]) {
      for (const maxChars of [1, 30, 56, 500]) {
        const grouped = nativeCaptionPhrases(captions, maxChars), input = join(temp, 'input.bcap');
        writeFileSync(input, encodeNativeDocument(document(grouped)));
        for (const visibleLines of [1, 2, 4, 8]) for (const blankLineSeconds of [0, .25, 1, 30]) for (const enabled of [0, 1]) {
          const output = execFileSync(executable, [input, String(maxChars), String(visibleLines), String(blankLineSeconds), String(enabled)], { encoding: 'utf8' }).trim();
          const actual = output ? output.split('\n').map(row => row.split(' ').map(Number)) : [];
          const expected = ranges(derivePauseLines(grouped, { visibleLines, blankLineSeconds }));
          assert.deepEqual(actual, expected, JSON.stringify({ maxChars, visibleLines, blankLineSeconds, enabled, removed: transcriptWords(captions)[55].pauseLinesRemoved ?? 0 }));
        }
      }
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
