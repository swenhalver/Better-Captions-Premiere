// Native writes are prepared and verified by ExtendScript, and committed by UXP
// in one Premiere transaction (uxp/native-params.js). These helpers stand in
// for that UXP commit against the mocked ExtendScript effect parameters.
export function commitPrepared(prepared, properties) {
  if (!prepared?.ok) return prepared;
  if (!prepared.writes.length) return null; // As in UXP: no transaction, no lookup.
  const names = Array.from({ length: properties.length }, (_, index) => String(properties[index].displayName));
  if (JSON.stringify(names) !== JSON.stringify(prepared.target.names)) return { error: 'Premiere listed the caption effect controls differently. The caption effect changed.' };
  try {
    for (const write of prepared.writes) {
      const param = properties[write.index];
      if (write.atTicks === null || write.atTicks === undefined) param.setValue(write.value, 1);
      else {
        const at = { ticks: write.atTicks };
        if (!param.getKeys().some(key => String(key.ticks) === write.atTicks)) param.addKey(at);
        param.setValueAtKey(at, write.value, 1);
      }
    }
  } catch (error) {
    // A failed transaction is as uncertain to the panel as a failed readback.
    return { error: String(error.message), code: 'BC_OUTPUT_UNCONFIRMED', recoverable: false, outputApplied: false, retry: 'never' };
  }
  return null;
}
export function editControl(call, properties, data) {
  const prepared = call('editNativeCaptionControl', { ...data, request: { ...data.request, phase: 'prepare' } });
  const failed = commitPrepared(prepared, properties());
  if (failed) return failed;
  return call('editNativeCaptionControl', { ...data, request: { ...data.request, phase: 'verify', receipt: prepared.receipt } });
}
// ExtendScript writes the document itself (UXP cannot); the UXP transaction then
// sets the edit token and any grouping scalar. See uxp/native-params.js.
export function writeDocument(call, properties, data, token) {
  const prepared = call('writeNativeCaptionDocument', { ...data, snapshot: { ...data.snapshot, phase: 'prepare' } });
  if (!prepared?.ok) return prepared;
  const written = call('writeNativeCaptionDocument', { ...data, snapshot: { ...data.snapshot, phase: 'write', ...(token?.seed === undefined ? {} : { seedToken: token.seed }) } });
  if (!written?.ok) return written;
  const tokened = token && prepared.token && prepared.documentChanged;
  const writes = tokened ? [...prepared.writes, { index: prepared.token.index, label: 'Layout editing guide', value: token.next, point: false, atTicks: null }] : prepared.writes;
  const failed = commitPrepared({ ...prepared, writes }, properties());
  if (failed) return failed;
  return call('writeNativeCaptionDocument', { ...data, snapshot: { ...data.snapshot, phase: 'verify', ...(tokened ? { expectedToken: token.next } : {}) } });
}
