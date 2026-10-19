/** A false adjustment-layer flag never establishes a native caption source. */
export function validTransparentCarrier(revision: any, projectItemId?: string): boolean {
  if (revision?.adjustmentLayer !== false || revision.carrierKind !== 'transparent-video' || typeof revision.carrierItemId !== 'string' || !revision.carrierItemId || projectItemId !== undefined && revision.carrierItemId !== projectItemId || typeof revision.carrierRevision !== 'string' || revision.carrierRevision.length > 4096) return false;
  try {
    const m = JSON.parse(revision.carrierRevision);
    if (Object.keys(m).length !== 7 || m.version !== 1 || m.owner !== 'com.swen.bettercaptions' || m.kind !== 'transparent-video' || m.projectItemId !== revision.carrierItemId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(m.creationId) || !Number.isInteger(m.width) || m.width < 1 || m.width > 16384 || !Number.isInteger(m.height) || m.height < 1 || m.height > 16384) return false;
    return JSON.stringify({version:1,owner:m.owner,kind:m.kind,projectItemId:m.projectItemId,creationId:m.creationId,width:m.width,height:m.height}) === revision.carrierRevision;
  } catch { return false; }
}
