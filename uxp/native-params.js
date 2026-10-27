'use strict';
// Every panel edit to a native caption layer becomes one named step in
// Premiere's own Undo/Redo history (Edit menu, Cmd+Z, Shift+Cmd+Z, History).
//
// Scalar effect controls are set here inside one UXP transaction, which Premiere
// records and reverts itself. The transcript/style document is an arbitrary-data
// parameter: UXP refuses to set it ("Illegal Parameter type") and ExtendScript
// setters are not recorded in Premiere's history. So each document edit also sets
// a small "edit token" on the hidden Layout editing guide float in that same
// transaction. Premiere Undo/Redo restores an earlier token, and the next
// connection read puts back the document remembered for it. Premiere's history
// does not outlive the session, so neither do these tokens.
const tick = (ppro, ticks) => ppro.TickTime.createWithTicks(String(ticks));
const MAX_TOKENS = 200;
const documents = new Map(); // token -> { clip, documentText }
const applied = new Map(); // clip -> token whose document the layer holds
// Far below epoch-second guide leases, which are the only other values written.
let nextToken = 1 + Math.floor(Math.random() * 1000000) * 100;

const clipKey = locator => JSON.stringify([locator.projectPath, locator.sequenceId, locator.clipNodeId]);
const staleError = () => Object.assign(new Error('Premiere Undo or Redo changed this caption layer. S-Captions is following it.'), { code: 'BC_NATIVE_STALE', method: 'writeNativeCaptionDocument', recoverable: true, operationPending: false });
function remember(token, clip, documentText) {
  documents.set(token, { clip, documentText });
  while (documents.size > MAX_TOKENS) documents.delete(documents.keys().next().value);
}

async function captionComponent(ppro, sequence, target) {
  const track = await sequence.getVideoTrack(target.trackIndex);
  if (!track) throw new Error('The native caption track changed. Reconnect and try again.');
  const matches = [];
  for (const item of await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false)) {
    const start = await item.getStartTime(), end = await item.getEndTime(), source = await item.getInPoint();
    if (String(start.ticks) === target.startTicks && String(end.ticks) === target.endTicks && String(source.ticks) === target.inTicks) matches.push(item);
  }
  if (matches.length !== 1) throw new Error('S-Captions could not find this caption layer for the edit. Reconnect and try again.');
  const chain = await matches[0].getComponentChain(), count = await chain.getComponentCount(), found = [], seen = [];
  for (let i = 0; i < count; i++) {
    const component = await chain.getComponentAtIndex(i), name = await component.getMatchName();
    seen.push(name);
    if (name === target.matchName) found.push(component);
  }
  if (found.length !== 1) throw new Error('Premiere did not expose one caption effect on this layer. Components: ' + seen.join(', '));
  const params = [], names = [], paramCount = await found[0].getParamCount();
  for (let i = 0; i < paramCount; i++) {
    const param = await found[0].getParam(i);
    params.push(param); names.push(param ? String(await param.displayName) : '');
  }
  return { params, names };
}

// ExtendScript and UXP list the same effect parameters, but do not promise the
// same indices. Map through the nearest label that is unique in both lists.
function uxpIndex(hostNames, names, index) {
  if (hostNames.length === names.length && hostNames.every((name, i) => name === names[i])) return index;
  const unique = (list, label) => list.indexOf(label) >= 0 && list.indexOf(label) === list.lastIndexOf(label);
  for (let anchor = index; anchor >= 0; anchor--) {
    const label = hostNames[anchor];
    if (!label || !unique(hostNames, label) || !unique(names, label)) continue;
    const mapped = names.indexOf(label) + index - anchor;
    if (names[mapped] === hostNames[index]) return mapped;
    break;
  }
  throw new Error('Premiere listed the caption effect controls differently in UXP. Host: ' + hostNames.join(' | ') + '. UXP: ' + names.join(' | '));
}

// Checkboxes may only accept booleans in UXP; ExtendScript reports them as 0/1.
function keyframe(ppro, param, write) {
  const value = write.point ? new ppro.PointF(write.value[0], write.value[1]) : write.value;
  try { return param.createKeyframe(value); }
  catch (error) { if (value === 0 || value === 1) return param.createKeyframe(value === 1); throw error; }
}

// The resolved params of the last commit, so a document write can keep its
// layer's edit-token param for typing fast steps.
let resolvedWrites = [];
async function commitNativeParams(ppro, project, sequence, prepared, writes, label) {
  if (!prepared || prepared.ok !== true || !prepared.target || !Array.isArray(prepared.target.names) || !Array.isArray(writes)) throw new Error('Premiere did not prepare the caption edit.');
  if (!writes.length) return false;
  const { params, names } = await captionComponent(ppro, sequence, prepared.target);
  const resolved = writes.map(write => {
    const param = params[uxpIndex(prepared.target.names, names, write.index)];
    if (!param || prepared.target.names[write.index] !== write.label) throw new Error('Premiere did not expose the caption control ' + write.label + '.');
    return { ...write, param };
  });
  let committed = false;
  resolvedWrites = resolved;
  project.lockedAccess(() => {
    committed = project.executeTransaction(compound => {
      for (const write of resolved) {
        // Keyframes are created inside the lock, as Adobe's point-key path requires.
        const key = keyframe(ppro, write.param, write);
        let action;
        if (write.atTicks === null || write.atTicks === undefined) action = write.param.createSetValueAction(key, true);
        else { key.position = tick(ppro, write.atTicks); action = write.param.createAddKeyframeAction(key); }
        if (compound.addAction(action) === false) throw new Error('Premiere refused the ' + write.label + ' change.');
      }
    }, 'S-Captions: ' + label);
  });
  if (!committed) throw new Error('Premiere did not commit the caption change.');
  return true;
}

// Plans a document write: the scalar writes for the undo step, the next edit
// token, and a seed token when the layer's current document has none yet.
function planDocumentWrite(snapshot, prepared, documentText) {
  const writes = prepared.writes.slice();
  if (!prepared.documentChanged || !prepared.token) return { writes, commit() {} };
  const clip = clipKey(snapshot.locator), current = JSON.parse(snapshot.revision).documentText, known = documents.get(prepared.token.value);
  // Premiere Undo/Redo moved the token and its document is not back yet: a write
  // now would bury that step. The panel reads (and restores) the layer instead.
  if (known && known.clip === clip && known.documentText !== current && applied.get(clip) !== prepared.token.value) throw staleError();
  const plan = { writes, token: nextToken++, commit() { remember(plan.token, clip, documentText); applied.set(clip, plan.token); } };
  if (!known || known.clip !== clip || known.documentText !== current) { plan.seedToken = nextToken++; remember(plan.seedToken, clip, current); }
  writes.push({ index: prepared.token.index, label: 'Layout editing guide', value: plan.token, point: false, atTicks: null });
  return plan;
}

// Layers whose edit token was moved by Premiere Undo/Redo to a remembered
// document that the layer does not hold yet.
function pendingRestores(connections) {
  return (connections?.native ?? []).flatMap(entry => {
    const clip = entry.locator && clipKey(entry.locator), known = documents.get(entry.editToken);
    return known && known.clip === clip && applied.get(clip) !== entry.editToken ? [{ locator: entry.locator, token: entry.editToken, documentText: known.documentText }] : [];
  });
}
const remembersDocuments = () => documents.size > 0;
// reply is the host's answer to the restore: the token the layer holds and
// Premiere's undo position, so the typing fast step can continue from there.
function restored(restore, reply) {
  const clip = clipKey(restore.locator), lane = fast.get(clip);
  applied.set(clip, restore.token);
  if (reply && reply.editToken === restore.token) fillStep(clip, restore.token, reply.undoIndex);
  if (lane && reply && reply.editToken === restore.token && typeof reply.undoIndex === 'number') Object.assign(lane, { token: restore.token, undoIndex: reply.undoIndex });
}

// Typing fast step. A Cmd+Z right after typing reaches Premiere within a few
// hundred ms, before a full document write (three host round trips) commits its
// step. So a typing write sets the next edit token in its own UXP transaction
// first, from the guide param kept per layer here, and the document follows.
// The token's document is remembered before the transaction: an Undo landing
// between the two then restores correctly, and Redo puts the typed text back.
const fast = new Map(); // clip -> { param, token, undoIndex }: the layer's guide param, its token, Premiere's undo position
const steps = new Map(); // clip -> { token, documentText, before: { index, token } } committed, document not yet written
const unwrap = value => { for (let depth = 0; depth < 3 && value && typeof value === 'object' && 'value' in value; depth++) { const next = value.value; if (next === value) break; value = next; } return value; };
// After a confirmed write or merge: the layer holds token's document at this undo position.
function keepFastLane(locator, token, undoIndex, param) {
  const clip = clipKey(locator), lane = fast.get(clip);
  if (typeof undoIndex !== 'number' || (!param && !lane)) { fast.delete(clip); return; }
  fast.set(clip, { param: param ?? lane.param, token, undoIndex });
}
function forgetFastLanes() { fast.clear(); }
// A connection read: a layer still on its lane's token reports Premiere's current
// undo position, which moves when the user acts on something else in Premiere.
function observe(connections) {
  if (typeof connections?.undoIndex !== 'number') return;
  for (const entry of connections.native ?? []) {
    const clip = entry.locator && clipKey(entry.locator), lane = clip && fast.get(clip);
    if (clip && typeof entry.editToken === 'number') fillStep(clip, entry.editToken, connections.undoIndex);
    if (lane && !steps.has(clip) && entry.editToken === lane.token && applied.get(clip) === lane.token) lane.undoIndex = connections.undoIndex;
  }
}
// The guide param of the last commitNativeParams, when it set an edit token.
function committedGuide() { return resolvedWrites.find(write => write.label === 'Layout editing guide')?.param ?? null; }
// Commits the next "Typing" step for documentText at once, or returns null when
// the layer is not exactly where the last confirmed write or restore left it
// (the normal write path then runs). busy: another native mutation is running.
async function fastStep(ppro, project, locator, documentText, label, busy) {
  const clip = clipKey(locator), lane = fast.get(clip);
  if (busy || !lane || steps.has(clip) || applied.get(clip) !== lane.token) return null;
  // A Premiere Undo/Redo the panel has not followed yet moved the token.
  let current;
  try { current = unwrap((await lane.param.getStartValue()).value); } catch { return null; }
  if (current !== lane.token || steps.has(clip) || fast.get(clip) !== lane) return null;
  const token = nextToken++;
  remember(token, clip, documentText);
  const step = { token, documentText, before: { index: lane.undoIndex, token: lane.token }, at: 0 };
  steps.set(clip, step);
  let committed = false;
  try {
    project.lockedAccess(() => {
      committed = project.executeTransaction(compound => {
        const key = keyframe(ppro, lane.param, { value: token, point: false });
        if (compound.addAction(lane.param.createSetValueAction(key, true)) === false) throw new Error('Premiere refused the typing step.');
      }, 'S-Captions: ' + label);
    });
  } catch { committed = false; }
  if (!committed) { steps.delete(clip); fast.delete(clip); return null; }
  step.at = Date.now();
  return step;
}
// The committed fast step a document write must finish, taken off the list.
function takeStep(locator, documentText) {
  const clip = clipKey(locator), step = steps.get(clip);
  if (!step || step.documentText !== documentText) return null;
  steps.delete(clip);
  return step;
}
// A fast step whose write never ran: a read restores its document like an Undo's.
function dropStep(locator, token) {
  const clip = clipKey(locator);
  if (steps.get(clip)?.token === token) { steps.delete(clip); fast.delete(clip); }
}
// The fast step's document is on the layer: it holds that token now.
function stepWritten(locator, step, undoIndex) {
  const clip = clipKey(locator);
  applied.set(clip, step.token);
  keepFastLane(locator, step.token, undoIndex);
}
// Prepares the fast step when a line editor opens: the layer's current document
// gets a remembered token. Returns the seed token to write first, or undefined
// when the current token already names this document. Throws stale like a write
// when Premiere Undo/Redo moved the token and its document is not back yet.
function primeTyping(snapshot, prepared) {
  if (!prepared.token) return { ok: false };
  const clip = clipKey(snapshot.locator), current = JSON.parse(snapshot.revision).documentText, known = documents.get(prepared.token.value);
  if (known && known.clip === clip && known.documentText !== current && applied.get(clip) !== prepared.token.value) throw staleError();
  if (known && known.clip === clip && known.documentText === current) { applied.set(clip, prepared.token.value); return { ok: true, token: prepared.token.value }; }
  const seed = nextToken++;
  remember(seed, clip, current);
  return { ok: true, token: seed, seed };
}
function primed(locator, token, undoIndex, param) {
  applied.set(clipKey(locator), token);
  keepFastLane(locator, token, undoIndex, param);
}


// Typing in the line editor commits one "Typing" step after each pause. When the
// editor closes, those steps are undone and replaced by one "Edit text" step. A
// layer has at most one typing session: Premiere's undo position and edit token
// before its first step (base), and the steps above it, oldest first.
const typing = new Map(); // clip -> { id, base: { index, token, documentText }, steps: [{ index, token }], broken }
const position = (session, index, token) => [session.base, ...session.steps].findIndex(item => item.index === index && item.token === token);

// Records a confirmed typing write. before is the undo position and token the
// transaction started from; after is the position it produced. An undo position
// is the QE undoStackIndex: the id of Premiere's latest applied action. Every new
// action gets a fresh, larger id, and Undo returns to the previous action's id.
// It is null when QE is unavailable, which leaves the session unmergeable.
function recordTypingStep(locator, id, before, after, beforeDocument) {
  const clip = clipKey(locator);
  let session = typing.get(clip);
  if (!session || session.id !== id) {
    session = { id, base: { index: before.index, token: before.token, documentText: beforeDocument }, steps: [], broken: false };
    typing.set(clip, session);
  }
  const at = position(session, before.index, before.token);
  if (session.broken || before.index === null || after.index === null || after.index === before.index || at < 0) { session.broken = true; return session; }
  // A step from a lower position replaces Premiere's discarded redo branch.
  session.steps = session.steps.slice(0, at);
  session.steps.push({ index: after.index, token: after.token });
  return session;
}
// A fast step that Premiere Undo took back before its document was written. It
// waits on the redo branch; its undo position is filled in if Redo brings it back.
function recordUndoneStep(locator, id, before, token, beforeDocument) {
  const session = recordTypingStep(locator, id, before, { index: -1, token }, beforeDocument);
  const step = session.steps[session.steps.length - 1];
  if (!session.broken && step?.token === token) step.index = null;
}
function fillStep(clip, token, index) {
  const step = typing.get(clip)?.steps.find(item => item.index === null && item.token === token);
  if (step && typeof index === 'number') step.index = index;
}
// The undo positions to step back over, or why the steps cannot be merged.
function typingCollapse(locator, id) {
  const session = typing.get(clipKey(locator));
  if (!session || session.id !== id) return { ok: false, reason: 'no-steps' };
  if (session.broken) return { ok: false, reason: 'history-changed' };
  // Steps still waiting on the redo branch were never redone: nothing to undo.
  const positions = [session.base, ...session.steps];
  while (positions.length > 1 && positions[positions.length - 1].index === null) positions.pop();
  if (positions.some(item => item.index === null)) return { ok: false, reason: 'history-changed' };
  return { ok: true, positions: positions.map(item => ({ index: item.index, token: item.token })), baseDocument: session.base.documentText, baseToken: session.base.token };
}
function endTyping(locator, id) {
  const clip = clipKey(locator), session = typing.get(clip);
  if (session && (id === undefined || session.id === id)) typing.delete(clip);
}

module.exports = { commitNativeParams, planDocumentWrite, pendingRestores, restored, remembersDocuments, recordTypingStep, recordUndoneStep, typingCollapse, endTyping, keepFastLane, committedGuide, fastStep, takeStep, dropStep, stepWritten, primeTyping, primed, forgetFastLanes, observe, captionComponent, uxpIndex };
