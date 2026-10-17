/* Premiere-only host. Every timeline write checks the captured sequence and project. */
var BetterCaptionsHost = (function () {
    var TICKS = 254016000000;
    // ExtendScript does not guarantee JSON. Keep a local codec instead of
    // depending on another extension's JSON2 globals or evaluating file text.
    function jsonString(value) {
        var out = '"';
        for (var i = 0; i < value.length; i++) {
            var c = value.charAt(i), n = value.charCodeAt(i);
            if (c === '"') out += '\\"';
            else if (c === '\\') out += '\\\\';
            else if (n < 32) out += '\\u' + ('0000' + n.toString(16)).slice(-4);
            else out += c;
        }
        return out + '"';
    }
    function stringify(value) {
        if (value === null) return 'null';
        var type = typeof value;
        if (type === 'string') return jsonString(value);
        if (type === 'number') return isFinite(value) ? String(value) : 'null';
        if (type === 'boolean') return value ? 'true' : 'false';
        var parts = [], i;
        if (value instanceof Array) {
            for (i = 0; i < value.length; i++) parts.push(stringify(value[i]));
            return '[' + parts.join(',') + ']';
        }
        if (type === 'object') {
            for (var key in value) if (Object.prototype.hasOwnProperty.call(value, key) && typeof value[key] !== 'undefined' && typeof value[key] !== 'function') parts.push(jsonString(key) + ':' + stringify(value[key]));
            return '{' + parts.join(',') + '}';
        }
        return 'null';
    }
    function parseJSON(text) {
        var cursor = 0;
        function fail() { throw new Error('Invalid caption job JSON at character ' + cursor + '.'); }
        function whitespace() { while (cursor < text.length && /[ \t\r\n]/.test(text.charAt(cursor))) cursor++; }
        function string() {
            if (text.charAt(cursor++) !== '"') fail();
            var out = '';
            while (cursor < text.length) {
                var c = text.charAt(cursor++);
                if (c === '"') return out;
                if (c.charCodeAt(0) < 32) fail();
                if (c !== '\\') { out += c; continue; }
                c = text.charAt(cursor++);
                if (c === '"' || c === '\\' || c === '/') out += c;
                else if (c === 'b') out += '\b';
                else if (c === 'f') out += '\f';
                else if (c === 'n') out += '\n';
                else if (c === 'r') out += '\r';
                else if (c === 't') out += '\t';
                else if (c === 'u') {
                    var hex = text.substr(cursor, 4);
                    if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail();
                    out += String.fromCharCode(parseInt(hex, 16)); cursor += 4;
                } else fail();
            }
            fail();
        }
        function value(depth) {
            if (depth > 64) fail();
            whitespace(); var c = text.charAt(cursor), out, key;
            if (c === '"') return string();
            if (c === '{') {
                cursor++; out = {}; whitespace(); if (text.charAt(cursor) === '}') { cursor++; return out; }
                while (cursor < text.length) {
                    whitespace(); key = string();
                    if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail();
                    whitespace(); if (text.charAt(cursor++) !== ':') fail(); out[key] = value(depth + 1); whitespace();
                    c = text.charAt(cursor++); if (c === '}') return out; if (c !== ',') fail();
                }
                fail();
            }
            if (c === '[') {
                cursor++; out = []; whitespace(); if (text.charAt(cursor) === ']') { cursor++; return out; }
                while (cursor < text.length) { out.push(value(depth + 1)); whitespace(); c = text.charAt(cursor++); if (c === ']') return out; if (c !== ',') fail(); }
                fail();
            }
            var literals = [['true', true], ['false', false], ['null', null]];
            for (var i = 0; i < literals.length; i++) if (text.substr(cursor, literals[i][0].length) === literals[i][0]) { cursor += literals[i][0].length; return literals[i][1]; }
            var number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(cursor));
            if (!number || !isFinite(Number(number[0]))) fail(); cursor += number[0].length; return Number(number[0]);
        }
        var result = value(0); whitespace(); if (cursor !== text.length) fail(); return result;
    }
    function reply(data) { return stringify(data); }
    function sequence(id, projectPath) {
        var s = app.project.activeSequence;
        if (!s) throw new Error('Open a sequence in Premiere.');
        if (id && String(s.sequenceID) !== String(id)) throw new Error('The active sequence changed. Refresh Better Captions before continuing.');
        if (projectPath && app.project.path !== projectPath) throw new Error('The Premiere project changed. Refresh Better Captions before continuing.');
        return s;
    }
    function context(id) {
        try {
            var s = sequence(id), tracks = [];
            for (var i = 0; i < s.videoTracks.numTracks; i++) tracks.push({ index: i, name: s.videoTracks[i].name, clips: s.videoTracks[i].clips.numItems, locked: s.videoTracks[i].isLocked() });
            return reply({ ok: true, id: String(s.sequenceID), name: s.name, projectPath: app.project.path, width: s.frameSizeHorizontal, height: s.frameSizeVertical, fps: TICKS / Number(s.timebase), ticksPerFrame: String(s.timebase), duration: Number(s.end) / TICKS, tracks: tracks, playhead: s.getPlayerPosition().seconds });
        } catch (e) { return reply({ error: e.toString() }); }
    }
    function seek(id, t, projectPath) {
        try {
            if (!isFinite(t) || t < 0) throw new Error('Invalid playhead time.');
            sequence(id, projectPath).setPlayerPosition(String(Math.round(Number(t) * TICKS)));
            return reply({ ok: true });
        } catch (e) { return reply({ error: e.toString() }); }
    }
    function findItem(parent, path) {
        for (var i = 0; i < parent.children.numItems; i++) {
            var item = parent.children[i];
            if (item.type === 2) { var r = findItem(item, path); if (r) return r; }
            else { try { if (item.getMediaPath() === path) return item; } catch (ignore) {} }
        }
        return null;
    }
    function findClip(s, node) {
        for (var t = 0; t < s.videoTracks.numTracks; t++) for (var i = 0; i < s.videoTracks[t].clips.numItems; i++) {
            var c = s.videoTracks[t].clips[i];
            if (String(c.nodeId) === String(node)) return { clip: c, track: t };
        }
        return null;
    }
    function referenceCount(itemId) {
        var count = 0, seqs = app.project.sequences;
        for (var s = 0; s < seqs.numSequences; s++) {
            var sets = [seqs[s].videoTracks, seqs[s].audioTracks];
            for (var k = 0; k < sets.length; k++) for (var t = 0; t < sets[k].numTracks; t++) for (var c = 0; c < sets[k][t].clips.numItems; c++) {
                var item = sets[k][t].clips[c].projectItem;
                if (item && String(item.nodeId) === String(itemId)) count++;
            }
        }
        return count;
    }
    function readPayload(file) {
        var f = new File(file); f.encoding = 'UTF-8';
        if (f.length > 20971520 || !f.open('r')) throw new Error('Cannot read the caption job.');
        var text = f.read(); f.close();
        return parseJSON(text);
    }
    function sameNode(a, b) { return String(a) === String(b); }
    function overlaps(a, b) { return a.startFrame < b.endFrame && a.endFrame > b.startFrame; }
    function frameTime(frame, ticksPerFrame) { var t = new Time(); t.ticks = String(Math.round(frame * ticksPerFrame)); return t; }
    function ticksTime(ticks) { var t = new Time(); t.ticks = String(ticks); return t; }
    function snapshot(clip) { return { clip: clip, item: clip.projectItem, media: clip.projectItem.getMediaPath(), name: clip.name, start: clip.start.ticks, end: clip.end.ticks, inPoint: clip.inPoint.ticks, outPoint: clip.outPoint.ticks }; }
    function setTiming(clip, startFrame, endFrame, ticksPerFrame) {
        clip.inPoint = frameTime(0, ticksPerFrame);
        clip.outPoint = frameTime(endFrame - startFrame, ticksPerFrame);
        clip.start = frameTime(startFrame, ticksPerFrame);
        clip.end = frameTime(endFrame, ticksPerFrame);
    }
    function assertTiming(clip, cue, ticksPerFrame) {
        if (Math.abs(Number(clip.start.ticks) - cue.startFrame * ticksPerFrame) > 2 || Math.abs(Number(clip.end.ticks) - cue.endFrame * ticksPerFrame) > 2) throw new Error('Premiere did not keep the requested caption timing.');
    }
    function prepare(p, requireMedia) {
        var s = sequence(p.sequenceId, p.projectPath), tpf = Number(s.timebase), fps = TICKS / tpf;
        if (!p.sequenceId || !p.projectPath || !p.cues || !p.cues.length || p.cues.length > 10000) throw new Error('Invalid caption job.');
        if (p.width !== s.frameSizeHorizontal || p.height !== s.frameSizeVertical || Math.abs(p.fps - fps) > 0.000001) throw new Error('Sequence dimensions or frame rate changed. Refresh and render again.');
        if (p.track !== Math.floor(p.track) || !s.videoTracks[p.track]) throw new Error('Add an empty video track in Premiere, then select it in Better Captions.');
        var planned = [], ids = {}, nodes = {}, i, j;
        for (i = 0; i < p.cues.length; i++) {
            var cue = p.cues[i];
            if (!cue.id || ids[cue.id] || !isFinite(cue.startFrame) || !isFinite(cue.endFrame) || cue.startFrame < 0 || cue.startFrame !== Math.floor(cue.startFrame) || cue.endFrame !== Math.floor(cue.endFrame) || cue.endFrame <= cue.startFrame) throw new Error('Caption identities or frame timings are invalid.');
            ids[cue.id] = true;
            if (requireMedia && (!cue.path || !/\.mov$/i.test(cue.path) || !new File(cue.path).exists)) throw new Error('A rendered caption is missing. Render again.');
            var found = cue.clipNodeId ? findClip(s, cue.clipNodeId) : null;
            if (cue.clipNodeId && !found) throw new Error('A generated clip was removed. Pull timeline changes before applying.');
            if (found && nodes[String(found.clip.nodeId)]) throw new Error('Two captions refer to the same timeline clip.');
            if (found) {
                nodes[String(found.clip.nodeId)] = true;
                if (!cue.projectItemId || !sameNode(found.clip.projectItem.nodeId, cue.projectItemId) || (cue.previousPath && found.clip.projectItem.getMediaPath() !== cue.previousPath)) throw new Error('A caption timeline link changed. Pull timeline changes before applying.');
                if (referenceCount(found.clip.projectItem.nodeId) !== 1) throw new Error('A caption media item is used by another timeline clip. Make that clip independent before updating captions.');
            }
            var trackIndex = found ? found.track : p.track;
            if (s.videoTracks[trackIndex].isLocked()) throw new Error('Unlock video track ' + (trackIndex + 1) + ' before applying captions.');
            planned.push({ cue: cue, located: found, track: trackIndex, startFrame: cue.startFrame, endFrame: cue.endFrame });
        }
        // Inspect every destination track and every desired range before importing or relinking anything.
        for (i = 0; i < planned.length; i++) {
            var target = planned[i], clips = s.videoTracks[target.track].clips;
            for (j = 0; j < i; j++) if (target.track === planned[j].track && overlaps(target, planned[j])) throw new Error('Caption clips overlap after frame alignment. Adjust their timing.');
            for (j = 0; j < clips.numItems; j++) {
                var old = clips[j]; if (nodes[String(old.nodeId)]) continue;
                if (Number(old.start.ticks) < target.endFrame * tpf - 2 && Number(old.end.ticks) > target.startFrame * tpf + 2) throw new Error('Video track ' + (target.track + 1) + ' contains another clip in a caption range. Choose an empty track or adjust the caption timing.');
            }
        }
        return { sequence: s, ticksPerFrame: tpf, planned: planned };
    }
    function preflight(file) { try { var p = prepare(readPayload(file), false); return reply({ ok: true, count: p.planned.length }); } catch (e) { return reply({ error: e.toString() }); } }
    function apply(file) {
        var created = [], changed = [], results = [], rollbackErrors = [], p, prepared;
        try {
            p = readPayload(file); prepared = prepare(p, true);
            var s = prepared.sequence, planned = prepared.planned, tpf = prepared.ticksPerFrame, i, j;
            var bin = null;
            for (i = 0; i < app.project.rootItem.children.numItems; i++) if (app.project.rootItem.children[i].type === 2 && app.project.rootItem.children[i].name === 'Better Captions') bin = app.project.rootItem.children[i];
            if (!bin) bin = app.project.rootItem.createBin('Better Captions');
            // Import all new sources before the first timeline edit.
            for (i = 0; i < planned.length; i++) {
                var entry = planned[i];
                if (entry.located) entry.item = entry.located.clip.projectItem;
                else {
                    entry.item = findItem(bin, entry.cue.path);
                    if (entry.item && referenceCount(entry.item.nodeId)) throw new Error('Rendered caption media is already used elsewhere. Render again to a new output folder.');
                    if (!entry.item) { if (!app.project.importFiles([entry.cue.path], true, bin, false)) throw new Error('Premiere could not import caption media.'); entry.item = findItem(bin, entry.cue.path); }
                    if (!entry.item) throw new Error('Imported caption media was not found.');
                }
            }
            for (i = 0; i < planned.length; i++) {
                entry = planned[i]; var cue = entry.cue, item = entry.item, clip;
                if (entry.located) {
                    clip = entry.located.clip; changed.push(snapshot(clip));
                    if (item.getMediaPath() !== cue.path) {
                        var status = item.changeMediaPath(cue.path, true);
                        if (!(status === 0 || status === true) || item.getMediaPath() !== cue.path) throw new Error('Premiere could not update caption media.');
                    }
                } else {
                    item.setInPoint(0, 1); item.setOutPoint((cue.endFrame - cue.startFrame) * tpf / TICKS, 1);
                    s.videoTracks[entry.track].overwriteClip(item, frameTime(cue.startFrame, tpf).seconds);
                    clip = null;
                    var trackClips = s.videoTracks[entry.track].clips;
                    // This item had no timeline references during preflight. Track every
                    // inserted instance for rollback even if Premiere places it incorrectly.
                    for (j = 0; j < trackClips.numItems; j++) if (sameNode(trackClips[j].projectItem.nodeId, item.nodeId)) {
                        created.push(trackClips[j]);
                        if (Math.abs(Number(trackClips[j].start.ticks) - cue.startFrame * tpf) < tpf / 2) clip = trackClips[j];
                    }
                    if (!clip) throw new Error('The caption did not appear at its expected timeline position.');
                }
                setTiming(clip, cue.startFrame, cue.endFrame, tpf);
                clip.name = 'Better Captions | ' + String(cue.text || '').substring(0, 60);
                assertTiming(clip, cue, tpf);
                if (item.getMediaPath() !== cue.path) throw new Error('Caption media readback did not match the rendered movie.');
                results.push({ id: cue.id, clipNodeId: String(clip.nodeId), projectItemId: String(item.nodeId), start: clip.start.seconds, end: clip.end.seconds, track: entry.track, path: item.getMediaPath() });
            }
            return reply({ ok: true, cues: results });
        } catch (e) {
            // No ripple removals. Existing clips keep their effects and Motion parameters throughout.
            for (var c = created.length - 1; c >= 0; c--) try {
                var removedNode = String(created[c].nodeId);
                created[c].remove(false, false);
                if (findClip(prepared.sequence, removedNode)) throw new Error('A new caption clip could not be removed during rollback.');
            } catch (removeError) { rollbackErrors.push(removeError.toString()); }
            for (var u = changed.length - 1; u >= 0; u--) try {
                var old = changed[u];
                if (old.item.getMediaPath() !== old.media) old.item.changeMediaPath(old.media, true);
                old.clip.inPoint = ticksTime(old.inPoint); old.clip.outPoint = ticksTime(old.outPoint); old.clip.start = ticksTime(old.start); old.clip.end = ticksTime(old.end); old.clip.name = old.name;
                if (old.item.getMediaPath() !== old.media || old.clip.start.ticks !== old.start || old.clip.end.ticks !== old.end) throw new Error('A previous caption could not be fully restored.');
            } catch (restoreError) { rollbackErrors.push(restoreError.toString()); }
            return reply({ error: e.toString(), rolledBack: rollbackErrors.length === 0, rollbackErrors: rollbackErrors, recoveryJob: file, attemptedCreated: created.length, attemptedUpdated: changed.length });
        }
    }
    function readTimeline(file) {
        try {
            var p = readPayload(file), s = sequence(p.sequenceId, p.projectPath), out = [];
            for (var i = 0; i < p.cues.length; i++) {
                var cue = p.cues[i], found = cue.clipNodeId ? findClip(s, cue.clipNodeId) : null;
                if (found) out.push({ id: cue.id, start: found.clip.start.seconds, end: found.clip.end.seconds, track: found.track, projectItemId: String(found.clip.projectItem.nodeId), path: found.clip.projectItem.getMediaPath() });
                else out.push({ id: cue.id, missing: true });
            }
            return reply({ ok: true, cues: out });
        } catch (e) { return reply({ error: e.toString() }); }
    }
    return { context: context, seek: seek, preflight: preflight, apply: apply, readTimeline: readTimeline };
})();
