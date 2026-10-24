/* Premiere-only host. Every timeline write checks the captured sequence and project. */
// Lease records contain identifiers and numbers only; retain cleanup across a
// CEP worker reload without retaining stale Premiere object references.
var BetterCaptionsLayoutGuideLeasesV1 = typeof BetterCaptionsLayoutGuideLeasesV1 === 'undefined' ? [] : BetterCaptionsLayoutGuideLeasesV1;
var BetterCaptionsHost = (function () {
    var TICKS = 254016000000;
    // ExtendScript does not guarantee JSON. Keep a local codec instead of
    // depending on another extension's JSON2 globals or evaluating file text.
    function jsonString(value) {
        // Most native carrier strings are long uninterrupted hex runs. Let
        // the ES3 regex engine copy those runs instead of concatenating every
        // character through ExtendScript. Preserve the exact local encoding.
        return '"' + value.replace(/["\\\x00-\x1f]/g, function (c) {
            if (c === '"') return '\\"';
            if (c === '\\') return '\\\\';
            return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
        }) + '"';
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
            var parts = [], special = /["\\\x00-\x1f]/g;
            while (cursor < text.length) {
                special.lastIndex = cursor;
                var match = special.exec(text);
                if (!match) fail();
                parts.push(text.substring(cursor, match.index)); cursor = match.index + 1;
                var c = match[0];
                if (c === '"') return parts.join('');
                if (c.charCodeAt(0) < 32) fail();
                c = text.charAt(cursor++);
                if (c === '"' || c === '\\' || c === '/') parts.push(c);
                else if (c === 'b') parts.push('\b');
                else if (c === 'f') parts.push('\f');
                else if (c === 'n') parts.push('\n');
                else if (c === 'r') parts.push('\r');
                else if (c === 't') parts.push('\t');
                else if (c === 'u') {
                    var hex = text.substr(cursor, 4);
                    if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail();
                    parts.push(String.fromCharCode(parseInt(hex, 16))); cursor += 4;
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
    function canonicalSequenceId(value) {
        var text = String(value);
        if (text.charAt(0) === '{' && text.charAt(text.length - 1) === '}') text = text.slice(1, -1);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return null;
        return text.toLowerCase();
    }
    function sameSequenceId(a, b) {
        if (String(a) === String(b)) return true;
        var normalized = canonicalSequenceId(a);
        return normalized !== null && normalized === canonicalSequenceId(b);
    }
    function sequence(id, projectPath) {
        var s = app.project.activeSequence;
        if (!s) throw new Error('Open a sequence in Premiere.');
        if (id && !sameSequenceId(s.sequenceID, id)) throw new Error('The active sequence changed. Refresh Better Captions before continuing.');
        if (projectPath && app.project.path !== projectPath) throw new Error('The Premiere project changed. Refresh Better Captions before continuing.');
        return s;
    }
    function context(id) {
        try {
            var s = sequence(id), tracks = [];
            for (var i = 0; i < s.videoTracks.numTracks; i++) tracks.push({ index: i, name: s.videoTracks[i].name, clips: s.videoTracks[i].clips.numItems, locked: s.videoTracks[i].isLocked() });
            return reply({ ok: true, id: id ? String(id) : String(s.sequenceID), name: s.name, projectPath: app.project.path, width: s.frameSizeHorizontal, height: s.frameSizeVertical, fps: TICKS / Number(s.timebase), ticksPerFrame: String(s.timebase), duration: Number(s.end) / TICKS, tracks: tracks, playhead: s.getPlayerPosition().seconds });
        } catch (e) { return reply({ error: e.toString() }); }
    }
    function seek(id, t, projectPath) {
        try {
            if (typeof t !== 'number' || !isFinite(t) || t < 0) throw new Error('Invalid playhead time.');
            var s = sequence(id, projectPath), time = setPlayhead(s, Math.round(t * TICKS));
            return reply({ ok: true, time: time.seconds });
        } catch (e) { return reply({ error: e.toString() }); }
    }
    function setPlayhead(s, ticks) {
        var status = s.setPlayerPosition(String(ticks)), time = s.getPlayerPosition();
        // Premiere may snap an arbitrary requested time to the nearest frame.
        // Never report success when the native seek failed or did not occur.
        if (status === false || !time || !isFinite(Number(time.ticks)) || Math.abs(Number(time.ticks) - ticks) > Math.max(2, Number(s.timebase) / 2 + 2)) throw new Error('Premiere could not seek to the requested caption frame.');
        return time;
    }
    function findItem(parent, path) {
        for (var i = 0; i < parent.children.numItems; i++) {
            var item = parent.children[i];
            if (item.type === 2) { var r = findItem(item, path); if (r) return r; }
            else { try { if (item.getMediaPath() === path) return item; } catch (ignore) {} }
        }
        return null;
    }
    function findClip(s, node, limit) {
        var inspected = 0;
        for (var t = 0; t < s.videoTracks.numTracks; t++) for (var i = 0; i < s.videoTracks[t].clips.numItems; i++) {
            if (typeof limit === 'number' && ++inspected > limit) throw new Error('This sequence is too large for automatic caption geometry lookup on this Premiere version. Use Update Program Monitor.');
            var c = s.videoTracks[t].clips[i];
            if (String(c.nodeId) === String(node)) return { clip: c, track: t };
        }
        return null;
    }
    function geometryClip(s, node) {
        try {
            if (typeof s.getSelection === 'function') {
                var selected = s.getSelection();
                if (selected && typeof selected.length === 'number' && selected.length >= 0 && selected.length <= 256) for (var i = 0; i < selected.length; i++) if (selected[i].mediaType === 'Video' && sameNode(selected[i].nodeId, node)) return { clip: selected[i] };
            }
        } catch (selectionError) { /* A bounded older-host scan remains available. */ }
        if (s.videoTracks.numTracks > 256) throw new Error('This sequence has too many tracks for automatic caption geometry lookup. Use Update Program Monitor.');
        return findClip(s, node, 2000);
    }
    function referenceCount(itemId) {
        var count = 0, inspected = 0, seqs = app.project.sequences;
        if (seqs.numSequences > 256) throw new Error('This project is too large to verify caption media references.');
        for (var s = 0; s < seqs.numSequences; s++) {
            var sets = [seqs[s].videoTracks, seqs[s].audioTracks];
            if (sets[0].numTracks > 256 || sets[1].numTracks > 256) throw new Error('This project has too many tracks to verify caption media references.');
            for (var k = 0; k < sets.length; k++) for (var t = 0; t < sets[k].numTracks; t++) for (var c = 0; c < sets[k][t].clips.numItems; c++) {
                if (++inspected > 2000) throw new Error('This project is too large to verify caption media references automatically.');
                var item = sets[k][t].clips[c].projectItem;
                if (item && String(item.nodeId) === String(itemId)) count++;
            }
        }
        return count;
    }
    function fragmentReceipt(parts) {
        var out = [];
        for (var i = 0; i < parts.length; i++) {
            var c = parts[i].clip;
            out.push({ clipNodeId: String(c.nodeId), track: parts[i].track, startTicks: String(c.start.ticks), endTicks: String(c.end.ticks), inTicks: String(c.inPoint.ticks), outTicks: String(c.outPoint.ticks) });
        }
        return out;
    }
    function captionFragments(s, caption, path, found) {
        if (caption.captionBundle !== true) return null;
        var parts = [], inspected = 0, seqs = app.project.sequences;
        if (seqs.numSequences > 256) throw new Error('This project is too large to verify native caption splits safely.');
        for (var q = 0; q < seqs.numSequences; q++) {
            var sets = [seqs[q].videoTracks, seqs[q].audioTracks];
            for (var g = 0; g < sets.length; g++) {
                if (sets[g].numTracks > 256) throw new Error('This project has too many tracks to verify native caption splits safely.');
                for (var t = 0; t < sets[g].numTracks; t++) for (var i = 0; i < sets[g][t].clips.numItems; i++) {
                    if (++inspected > 2000) throw new Error('This project is too large to verify native caption splits automatically.');
                    var clip = sets[g][t].clips[i];
                    if (!clip.projectItem || !sameNode(clip.projectItem.nodeId, found.clip.projectItem.nodeId)) continue;
                    if (g !== 0 || !sameNode(seqs[q].sequenceID, s.sequenceID) || clip.projectItem.getMediaPath() !== path) throw new Error('Caption bundle media is used outside its native video splits. Make the other copy independent before updating captions.');
                    if (parts.length >= 64) throw new Error('A caption bundle supports at most 64 native split fragments.');
                    parts.push({ clip: clip, track: t });
                }
            }
        }
        if (!parts.length) throw new Error('The caption bundle timeline link changed.');
        if (parts.length === 1) return null;
        parts.sort(function (a, b) { return Number(a.clip.start.ticks) - Number(b.clip.start.ticks); });
        for (var n = 0; n < parts.length; n++) {
            var c = parts[n].clip, start = Number(c.start.ticks), end = Number(c.end.ticks), sourceIn = Number(c.inPoint.ticks), sourceOut = Number(c.outPoint.ticks);
            assertNormalSpeed(c);
            var clocks = [start, end, sourceIn, sourceOut], tpf = Number(s.timebase);
            for (var clock = 0; clock < clocks.length; clock++) if (!isFinite(clocks[clock]) || Math.abs(clocks[clock] - Math.round(clocks[clock] / tpf) * tpf) > 2) throw new Error('Native caption split boundaries must align to sequence video frames.');
            if (!isFinite(start) || !isFinite(end) || !isFinite(sourceIn) || !isFinite(sourceOut) || start < 0 || sourceIn < 0 || end <= start || Math.abs(sourceOut - sourceIn - (end - start)) > 2
                || parts[n].track !== parts[0].track || n === 0 && Math.abs(sourceIn) > 2
                || n > 0 && (Math.abs(start - Number(parts[n - 1].clip.end.ticks)) > 2 || Math.abs(sourceIn - Number(parts[n - 1].clip.outPoint.ticks)) > 2)) {
                throw new Error('Caption bundle fragments must stay in their original source order with contiguous timeline and source timing. Reordered, duplicated, trimmed or moved splits are protected.');
            }
        }
        return parts;
    }
    function assertFragmentRange(parts, firstFrame, count, tpf) {
        if (Math.abs(Number(parts[0].clip.start.ticks) - firstFrame * tpf) > 2 || Math.abs(Number(parts[parts.length - 1].clip.end.ticks) - (firstFrame + count) * tpf) > 2) throw new Error('Keep the native split caption bundle timing unchanged. Sync timing from Premiere before applying.');
    }
    function verifyBundleReferences(s, entry) {
        if (!entry.bundleReceipt) return;
        var found = findClip(s, entry.cue.clipNodeId);
        if (!found || !sameNode(found.clip.projectItem.nodeId, entry.item.nodeId) || found.clip.projectItem.getMediaPath() !== entry.cue.path) throw new Error('The caption bundle link changed while refreshing media.');
        var parts = captionFragments(s, entry.cue, entry.cue.path, found) || [found];
        if (stringify(fragmentReceipt(parts)) !== stringify(entry.bundleReceipt)) throw new Error('Native caption splits or references changed while refreshing media.');
    }
    function preferredFragment(s, parts, fallback) {
        var current = Number(s.getPlayerPosition().ticks), selected = null, selectedCount = 0, at = null;
        for (var i = 0; i < parts.length; i++) {
            var c = parts[i].clip;
            if (typeof c.isSelected === 'function' && c.isSelected()) { selected = parts[i]; selectedCount++; }
            if (current >= Number(c.start.ticks) && current < Number(c.end.ticks)) at = parts[i];
        }
        return selectedCount === 1 ? selected : at || fallback;
    }
    function readPayload(file) {
        var f = new File(file); f.encoding = 'UTF-8';
        if (f.length > 20971520 || !f.open('r')) throw new Error('Cannot read the caption job.');
        var text = f.read(); f.close();
        return parseJSON(text);
    }
    function sameNode(a, b) { return String(a) === String(b); }
    function selectionItems(s) {
        var out = [], groups = [s.videoTracks, s.audioTracks];
        for (var g = 0; g < groups.length; g++) for (var t = 0; t < groups[g].numTracks; t++) {
            var track = groups[g][t], sets = [track.clips, track.transitions];
            for (var k = 0; k < sets.length; k++) if (sets[k]) for (var i = 0; i < sets[k].numItems; i++) {
                var clip = sets[k][i];
                if (typeof clip.setSelected !== 'function' || typeof clip.isSelected !== 'function') throw new Error('Premiere cannot select this timeline item.');
                out.push({ clip: clip, selected: !!clip.isSelected() });
            }
        }
        return out;
    }
    function selectState(clip, selected, updateUI) {
        clip.setSelected(selected ? 1 : 0, updateUI ? 1 : 0);
        if (!!clip.isSelected() !== selected) throw new Error('Premiere did not keep the requested caption selection.');
    }
    function captionFrame(s, clip, caption) {
        var tpf = Number(s.timebase), start = Number(clip.start.ticks), end = Number(clip.end.ticks);
        if (!isFinite(tpf) || tpf <= 0 || !isFinite(start) || !isFinite(end) || end <= start) throw new Error('The linked caption has invalid timeline timing.');
        var first = caption.words && caption.words.length ? caption.words[0] : null;
        var last = caption.words && caption.words.length ? caption.words[caption.words.length - 1] : null, current = s.getPlayerPosition();
        var visibleStart = first && typeof first.startTime === 'number' && isFinite(first.startTime) ? Math.max(start, first.startTime * TICKS) : start;
        var visibleEnd = last && typeof last.endTime === 'number' && isFinite(last.endTime) ? Math.min(end, last.endTime * TICKS) : end;
        // Keep the frame being edited when a user changes a width keyframe.
        if (current && isFinite(Number(current.ticks)) && Number(current.ticks) >= visibleStart && Number(current.ticks) < visibleEnd) return Number(current.ticks);
        var time = first && typeof first.startTime === 'number' && typeof first.endTime === 'number' && isFinite(first.startTime) && isFinite(first.endTime) && first.endTime > first.startTime ? (first.startTime + first.endTime) / 2 : (start + end) / (2 * TICKS);
        // Pending edits may use timings that have not yet been applied. Select
        // the real linked clip instead of seeking away from it.
        if (time * TICKS < start || time * TICKS >= end) time = (start + end) / (2 * TICKS);
        var firstFrame = Math.ceil(start / tpf - 0.0000001), lastFrame = Math.ceil(end / tpf - 0.0000001) - 1;
        if (lastFrame < firstFrame) throw new Error('The linked caption is shorter than a video frame.');
        return Math.max(firstFrame, Math.min(lastFrame, Math.floor(time * TICKS / tpf + 0.0000001))) * tpf;
    }
    function selectCaptionClip(file) {
        var s = null, original = null, previousTime = null, changed = false, restoreErrors = [];
        try {
            var p = readPayload(file), caption = p.cues && p.cues.length === 1 ? p.cues[0] : null;
            if (!p.sequenceId || !p.projectPath || !caption || typeof caption.id !== 'string' || !caption.id || typeof caption.clipNodeId !== 'string' || !caption.clipNodeId || typeof caption.projectItemId !== 'string' || !caption.projectItemId || typeof caption.mediaPath !== 'string' || !caption.mediaPath) throw new Error('Apply one caption before selecting it in the Program Monitor.');
            s = sequence(p.sequenceId, p.projectPath);
            var found = findClip(s, caption.clipNodeId);
            if (!found || !sameNode(found.clip.projectItem.nodeId, caption.projectItemId) || found.clip.projectItem.getMediaPath() !== caption.mediaPath) throw new Error('The caption timeline link changed. Sync timing from Premiere before selecting it.');
            var fragments = captionFragments(s, caption, caption.mediaPath, found);
            if (fragments) found = preferredFragment(s, fragments, found);
            var track = s.videoTracks[found.track], clip = found.clip;
            if (track.isLocked()) throw new Error('Unlock video track ' + (found.track + 1) + ' to move or resize this caption.');
            if (typeof track.isMuted === 'function' && track.isMuted()) throw new Error('Enable video track ' + (found.track + 1) + ' output to see this caption in the Program Monitor.');
            if (clip.disabled) throw new Error('Enable this caption clip to see it in the Program Monitor.');
            var ticks = captionFrame(s, clip, caption);
            original = selectionItems(s); previousTime = s.getPlayerPosition(); changed = true;
            var time = Math.abs(Number(previousTime.ticks) - ticks) <= 2 ? previousTime : setPlayhead(s, ticks);
            // Seek first: Selection Follows Playhead must not replace the final
            // explicit caption selection with underlying footage or its audio.
            for (var i = 0; i < original.length; i++) if (!sameNode(original[i].clip.nodeId, clip.nodeId) && original[i].clip.isSelected()) selectState(original[i].clip, false, false);
            selectState(clip, true, true);
            for (i = 0; i < original.length; i++) if (!sameNode(original[i].clip.nodeId, clip.nodeId) && original[i].clip.isSelected()) selectState(original[i].clip, false, false);
            if (!clip.isSelected()) throw new Error('Premiere did not select the linked caption.');
            return reply({ ok: true, id: caption.id, clipNodeId: String(clip.nodeId), projectItemId: String(clip.projectItem.nodeId), path: clip.projectItem.getMediaPath(), track: found.track, time: time.seconds });
        } catch (e) {
            if (changed && original) {
                try { if (previousTime && Math.abs(Number(s.getPlayerPosition().ticks) - Number(previousTime.ticks)) > 2) setPlayhead(s, Number(previousTime.ticks)); } catch (timeError) { restoreErrors.push(timeError.toString()); }
                for (var r = 0; r < original.length; r++) try { selectState(original[r].clip, original[r].selected, r === original.length - 1); } catch (selectionError) { restoreErrors.push(selectionError.toString()); }
            }
            return reply({ error: e.toString(), selectionRestored: restoreErrors.length === 0, restoreErrors: restoreErrors });
        }
    }
    function readCaptionSelection(file) {
        try {
            var p = readPayload(file);
            if (!p.sequenceId || !p.projectPath || !p.cues || p.cues.length > 10000) throw new Error('Invalid caption selection request.');
            var s = sequence(p.sequenceId, p.projectPath), selected = null, count = 0, captionId = null, logicalNode = null;
            var nativeSelection = null, nativeUsable = false;
            try {
                if (typeof s.getSelection === 'function') {
                    nativeSelection = s.getSelection();
                    nativeUsable = !!nativeSelection && typeof nativeSelection.length === 'number' && nativeSelection.length >= 0 && nativeSelection.length <= 256;
                    for (var n = 0; nativeUsable && n < nativeSelection.length; n++) {
                        var mediaType = nativeSelection[n].mediaType;
                        if (mediaType !== 'Video' && mediaType !== 'Audio') nativeUsable = false;
                    }
                }
            } catch (selectionError) { nativeUsable = false; }
            if (nativeUsable) {
                for (n = 0; n < nativeSelection.length; n++) if (nativeSelection[n].mediaType === 'Video') { selected = nativeSelection[n]; count++; if (count > 1) break; }
            } else {
                // Older hosts may not provide the selection snapshot. Bound
                // the fallback and stop as soon as the answer is ambiguous.
                var inspected = 0;
                if (s.videoTracks.numTracks > 256) throw new Error('This sequence has too many tracks for automatic caption selection. Select the caption in Better Captions.');
                for (var t = 0; t < s.videoTracks.numTracks && count < 2; t++) for (var c = 0; c < s.videoTracks[t].clips.numItems && count < 2; c++) {
                    if (++inspected > 2000) throw new Error('This sequence is too large for automatic caption selection on this Premiere version. Select the caption in Better Captions.');
                    var clip = s.videoTracks[t].clips[c];
                    if (typeof clip.isSelected === 'function' && clip.isSelected()) { selected = clip; count++; }
                }
            }
            if (count === 1) for (var i = 0; i < p.cues.length; i++) {
                var cue = p.cues[i];
                var matches = cue.id && cue.clipNodeId && cue.projectItemId && cue.mediaPath && sameNode(cue.projectItemId, selected.projectItem.nodeId) && cue.mediaPath === selected.projectItem.getMediaPath() && sameNode(cue.clipNodeId, selected.nodeId);
                if (!matches && cue.captionBundle === true && cue.id && cue.clipNodeId && cue.projectItemId && sameNode(cue.projectItemId, selected.projectItem.nodeId) && cue.mediaPath === selected.projectItem.getMediaPath()) {
                    var canonical = findClip(s, cue.clipNodeId, 2000), fragments = canonical ? captionFragments(s, cue, cue.mediaPath, canonical) : null;
                    for (var f = 0; fragments && f < fragments.length; f++) if (sameNode(fragments[f].clip.nodeId, selected.nodeId)) matches = true;
                }
                if (matches) {
                    if (captionId !== null) { captionId = null; logicalNode = null; break; }
                    captionId = cue.id; logicalNode = String(cue.clipNodeId);
                }
            }
            var result = { ok: true, captionId: captionId, clipNodeId: captionId === null ? null : logicalNode, time: s.getPlayerPosition().seconds };
            if (captionId !== null && !sameNode(logicalNode, selected.nodeId)) result.nativeClipNodeId = String(selected.nodeId);
            return reply(result);
        } catch (e) { return reply({ error: e.toString() }); }
    }
    function motionParameters(clip, binding) {
        var motion = null;
        for (var i = 0; clip.components && i < clip.components.numItems; i++) {
            var component = clip.components[i];
            if (component.matchName === 'AE.ADBE Motion' || component.matchName === 'ADBE Motion') { motion = component; break; }
        }
        if (!motion) throw new Error('Premiere did not expose the caption Motion controls.');
        if (binding) {
            if (motion.properties.numItems < 1 || motion.properties.numItems > 64) throw new Error('Premiere returned an invalid Motion parameter count.');
            binding.version = 1; binding.componentMatchName = String(motion.matchName); binding.parameterCount = motion.properties.numItems;
        }
        var out = {};
        for (i = 0; i < motion.properties.numItems; i++) {
            var param = motion.properties[i], name = param.displayName;
            if (name === 'Position') out.position = param;
            else if (name === 'Scale' || name === 'Scale (Height)' || name === 'Scale Height') out.height = param;
            else if (name === 'Scale Width' || name === 'Scale (Width)') { out.width = param; if (binding) binding.widthIndex = typeof binding.widthIndex === 'number' ? -1 : i; }
            else if (name === 'Uniform Scale') { out.uniform = param; if (binding) binding.uniformIndex = typeof binding.uniformIndex === 'number' ? -1 : i; }
            else if (name === 'Rotation') { out.rotation = param; if (binding) binding.rotationIndex = typeof binding.rotationIndex === 'number' ? -1 : i; }
            else if (name === 'Anchor Point') out.anchor = param;
        }
        if (!out.height || !out.width || !out.uniform) throw new Error('Premiere did not expose separate caption width and height controls.');
        return out;
    }
    function parameterCurve(param, limit) {
        var animated = !!param.isTimeVarying(), keys = [], nativeKeys = animated ? param.getKeys() : null;
        if (nativeKeys && nativeKeys.length > (typeof limit === 'number' ? limit : 10000)) throw new Error(typeof limit === 'number' ? 'This caption has too many width or height keyframes for automatic reflow. Use Update Program Monitor to render it manually.' : 'The caption has too many Motion keyframes to read safely.');
        for (var i = 0; nativeKeys && i < nativeKeys.length; i++) {
            if (!isFinite(Number(nativeKeys[i].ticks))) throw new Error('Premiere returned an invalid Motion keyframe time.');
            keys.push({ ticks: String(nativeKeys[i].ticks), value: param.getValueAtKey(nativeKeys[i]) });
        }
        keys.sort(function (a, b) { return Number(a.ticks) - Number(b.ticks); });
        return { animated: animated, value: animated ? null : param.getValue(), keys: keys };
    }
    function parameterAt(param, curve, time) { return curve.animated ? param.getValueAtTime(time) : curve.value; }
    function curveSignature(value) {
        // Two independent 32-bit accumulators form a compact dirty-state token.
        // This is not an authentication token; the request nonce provides that.
        var text = stringify(value), a = 2166136261, b = 5381;
        for (var i = 0; i < text.length; i++) {
            var c = text.charCodeAt(i); a ^= c;
            a = (a + (a << 1) + (a << 4) + (a << 7) + (a << 8) + (a << 24)) >>> 0;
            b = ((b << 5) + b + c) >>> 0;
        }
        return 'motion-v1-' + ('00000000' + a.toString(16)).slice(-8) + ('00000000' + b.toString(16)).slice(-8);
    }
    function assertNormalSpeed(clip) {
        var speed = typeof clip.getSpeed === 'function' ? Number(clip.getSpeed()) : 1;
        if (typeof clip.isSpeedReversed === 'function' && clip.isSpeedReversed() || !isFinite(speed) || Math.abs(speed - 1) > 0.000001) throw new Error('Caption box reflow requires a forward clip at its original playback speed.');
    }
    function geometrySignature(clip, firstFrame, count, tpf, params, availableCurves) {
        var names = ['height', 'width', 'uniform'], curves = {}, sampled = {}, remaining = 256, sourceIn = Number(clip.inPoint.ticks);
        if (!isFinite(sourceIn) || sourceIn < 0) throw new Error('The caption has an invalid source in point.');
        var sourceEnd = sourceIn + count * tpf;
        for (var index = 0; index < names.length; index++) {
            var name = names[index], curve = availableCurves ? availableCurves[name] : copyCurve(parameterCurve(params[name], remaining), name);
            if (curve.keys.length > remaining) throw new Error('This caption has too many width or height keyframes for automatic reflow. Use Update Program Monitor to render it manually.');
            remaining -= curve.keys.length; curves[name] = curve; sampled[name] = [];
            if (!curve.animated) continue;
            var times = [], seen = {};
            function addTime(ticks) {
                ticks = Math.round(ticks);
                if (ticks < sourceIn || ticks >= sourceEnd || seen[String(ticks)]) return;
                seen[String(ticks)] = true; times.push(ticks);
            }
            addTime(sourceIn + tpf / 2); addTime(sourceEnd - tpf / 2);
            addTime(sourceIn + (sourceEnd - sourceIn) / 4); addTime(sourceIn + (sourceEnd - sourceIn) / 2); addTime(sourceIn + 3 * (sourceEnd - sourceIn) / 4);
            for (var key = 0; key + 1 < curve.keys.length; key++) {
                var lo = Math.max(sourceIn, Number(curve.keys[key].ticks)), hi = Math.min(sourceEnd, Number(curve.keys[key + 1].ticks));
                if (hi <= lo) continue;
                addTime(lo + (hi - lo) / 4); addTime(lo + (hi - lo) / 2); addTime(lo + 3 * (hi - lo) / 4);
            }
            times.sort(function (a, b) { return a - b; });
            // Fingerprinting is deliberately independent of video duration.
            // Full per-frame interpolation is sampled only for actual renders.
            var probes = Math.min(24, times.length);
            for (var probe = 0; probe < probes; probe++) {
                var ticks = times.length <= probes ? times[probe] : times[Math.round(probe * (times.length - 1) / (probes - 1))];
                sampled[name].push({ ticks: String(ticks), value: motionValue(params[name].getValueAtTime(ticksTime(ticks)), name) });
            }
        }
        return curveSignature({ sourceIn: String(sourceIn), ticksPerFrame: String(tpf), count: count, curves: curves, probes: sampled }).replace('motion-v1-', 'geometry-v1-');
    }
    function controlRevision(clip, firstFrame, count, tpf, params, sizeSignature) {
        var curve = copyCurve(parameterCurve(params.position, 256), 'position'), probes = [], sourceIn = Number(clip.inPoint.ticks);
        if (curve.animated) {
            var times = [], seen = {}, end = sourceIn + count * tpf;
            function add(ticks) { ticks = Math.round(ticks); if (ticks >= sourceIn && ticks < end && !seen[String(ticks)]) { seen[String(ticks)] = true; times.push(ticks); } }
            add(sourceIn + tpf / 2); add(end - tpf / 2); add(sourceIn + count * tpf / 2);
            for (var i = 0; i + 1 < curve.keys.length; i++) {
                var lo = Math.max(sourceIn, Number(curve.keys[i].ticks)), hi = Math.min(end, Number(curve.keys[i + 1].ticks));
                if (hi > lo) { add(lo + (hi - lo) / 4); add(lo + (hi - lo) / 2); add(lo + 3 * (hi - lo) / 4); }
            }
            times.sort(function (a, b) { return a - b; });
            var limit = Math.min(24, times.length);
            for (var n = 0; n < limit; n++) { var at = times.length <= limit ? times[n] : times[Math.round(n * (times.length - 1) / (limit - 1))]; probes.push({ ticks: String(at), value: motionValue(params.position.getValueAtTime(ticksTime(at)), 'position') }); }
        }
        return curveSignature({ size: sizeSignature, position: curve, probes: probes }).replace('motion-v1-', 'controls-v1-');
    }
    function motionPhase(trace, phase, frame) {
        if (trace) { trace.phase = phase; trace.frame = typeof frame === 'number' ? frame : null; }
    }
    function motionProfile(clip, firstFrame, count, tpf, trace) {
        motionPhase(trace, 'Motion playback speed');
        assertNormalSpeed(clip);
        motionPhase(trace, 'Motion parameters');
        var params = motionParameters(clip);
        motionPhase(trace, 'height curve');
        var height = copyCurve(parameterCurve(params.height), 'height');
        motionPhase(trace, 'width curve');
        var width = copyCurve(parameterCurve(params.width), 'width');
        motionPhase(trace, 'Uniform Scale curve');
        var uniform = copyCurve(parameterCurve(params.uniform), 'uniform'), samples = [], values = [], fps = TICKS / tpf;
        motionPhase(trace, 'Motion source timing');
        var sourceIn = Number(clip.inPoint.ticks);
        if (!isFinite(sourceIn) || sourceIn < 0) throw new Error('The caption has an invalid source in point.');
        for (var frame = 0; frame < count; frame++) {
            // Effect keys use the clip's source clock, independent of its
            // position on the sequence or the current playhead.
            motionPhase(trace, 'Motion sample time', frame);
            var at = height.animated || width.animated || uniform.animated ? ticksTime(Math.round(sourceIn + (frame + 0.5) * tpf)) : null;
            motionPhase(trace, 'Uniform Scale sample', frame);
            var locked = parameterAt(params.uniform, uniform, at);
            motionPhase(trace, 'height sample', frame);
            var sy = Number(parameterAt(params.height, height, at)) / 100;
            if (!(locked === true || locked === false || locked === 0 || locked === 1)) throw new Error('Premiere returned an invalid Uniform Scale value.');
            motionPhase(trace, 'width sample', frame);
            var sx = locked ? sy : Number(parameterAt(params.width, width, at)) / 100;
            if (!isFinite(sx) || !isFinite(sy) || sx < 0.01 || sy < 0.01 || sx > 100 || sy > 100) throw new Error('Caption box width and height must remain between 1% and 10000%.');
            samples.push({ time: (firstFrame + frame + 0.5) / fps, scaleX: sx, scaleY: sy }); values.push([sx, sy]);
        }
        // ExtendScript has no interpolation-mode getter. Evaluating every
        // output frame captures interpolation changes affecting the video.
        motionPhase(trace, 'Motion profile signature');
        var profile = { signature: curveSignature({ sourceIn: String(sourceIn), count: count, height: height, width: width, uniform: uniform, values: values }), samples: samples };
        try { profile.watchSignature = geometrySignature(clip, firstFrame, count, tpf, params, { height: height, width: width, uniform: uniform }); }
        catch (watchError) { profile.watchError = watchError.toString().slice(0, 300); }
        return profile;
    }
    function fragmentGeometry(parts, tpf) {
        var sizes = [], controls = [], keys = 0;
        for (var i = 0; i < parts.length; i++) {
            var clip = parts[i].clip, params = motionParameters(clip), first = Math.round(Number(clip.start.ticks) / tpf), count = Math.round((Number(clip.end.ticks) - Number(clip.start.ticks)) / tpf);
            // One aggregate key budget bounds automatic polling even after
            // a user makes many Razor cuts of a keyed caption asset.
            var names = ['height', 'width', 'uniform', 'position'];
            for (var k = 0; k < names.length; k++) if (params[names[k]].isTimeVarying()) {
                var nativeKeys = params[names[k]].getKeys(); keys += nativeKeys ? nativeKeys.length : 0;
                if (keys > 256) throw new Error('This split caption has too many Motion keys for automatic reflow. Use Update Program Monitor.');
            }
            var size = geometrySignature(clip, first, count, tpf, params);
            sizes.push(size); controls.push(controlRevision(clip, first, count, tpf, params, size));
        }
        var receipt = fragmentReceipt(parts);
        return { watchSignature: curveSignature({ fragments: receipt, sizes: sizes }).replace('motion-v1-', 'geometry-bundle-v1-'), controlRevision: curveSignature({ fragments: receipt, controls: controls }).replace('motion-v1-', 'controls-bundle-v1-') };
    }
    function fragmentProfile(parts, firstFrame, count, tpf, trace) {
        assertFragmentRange(parts, firstFrame, count, tpf);
        var samples = [], signatures = [];
        for (var i = 0; i < parts.length; i++) {
            if (trace) trace.fragment = i;
            var clip = parts[i].clip, first = Math.round(Number(clip.start.ticks) / tpf), frames = Math.round((Number(clip.end.ticks) - Number(clip.start.ticks)) / tpf), profile = motionProfile(clip, first, frames, tpf, trace);
            signatures.push(profile.signature);
            for (var frame = 0; frame < profile.samples.length; frame++) samples.push(profile.samples[frame]);
        }
        if (samples.length !== count) throw new Error('The native split caption frames do not match their source timing.');
        var result = { signature: curveSignature({ fragments: fragmentReceipt(parts), profiles: signatures }), samples: samples };
        try { result.watchSignature = fragmentGeometry(parts, tpf).watchSignature; }
        catch (watchError) { result.watchError = watchError.toString().slice(0, 300); }
        return result;
    }
    function readMediaDiagnostics(item, diagnostic) {
        var methods = ['getProjectMetadata', 'getXMPMetadata'], fields = ['projectMetadata', 'xmpMetadata'];
        for (var i = 0; i < methods.length; i++) {
            try {
                if (typeof item[methods[i]] !== 'function') throw new Error('Native metadata is unavailable.');
                var value = item[methods[i]]();
                if (typeof value !== 'string') throw new Error('Premiere did not return metadata text.');
                diagnostic[fields[i]] = value.slice(0, 8000);
                diagnostic[fields[i] + 'Truncated'] = value.length > 8000;
            } catch (e) { diagnostic[fields[i] + 'Error'] = e.toString().slice(0, 300); }
        }
    }
    function requestedCaptionRange(caption, clip, fragments) {
        // Keep nullable native fallbacks in explicit branches. Premiere's
        // ExtendScript evaluator failed on the previous nested conditional
        // even when the caller supplied numeric start/end values.
        var start, end;
        if (typeof caption.startTime === 'number') start = caption.startTime;
        else if (fragments) start = fragments[0].clip.start.seconds;
        else start = clip.start.seconds;
        if (typeof caption.endTime === 'number') end = caption.endTime;
        else if (fragments) end = fragments[fragments.length - 1].clip.end.seconds;
        else end = clip.end.seconds;
        return { start: start, end: end };
    }
    function readCaptionGeometry(file) {
        try {
            var p = readPayload(file);
            if (!p.sequenceId || !p.projectPath || !p.cues || !p.cues.length || p.cues.length > 16) throw new Error('Read caption box geometry in batches of at most 16 captions.');
            var s = sequence(p.sequenceId, p.projectPath), tpf = Number(s.timebase), fps = TICKS / tpf, out = [];
            if (!isFinite(tpf) || tpf <= 0) throw new Error('The sequence has an invalid frame rate.');
            for (var i = 0; i < p.cues.length; i++) {
                var caption = p.cues[i], found = caption.clipNodeId ? geometryClip(s, caption.clipNodeId) : null;
                if (!found || !caption.id || !caption.projectItemId || !sameNode(found.clip.projectItem.nodeId, caption.projectItemId) || found.clip.projectItem.getMediaPath() !== caption.mediaPath) throw new Error('The caption timeline link changed. Sync timing from Premiere before reading its box size.');
                var clip = found.clip, fragments = captionFragments(s, caption, caption.mediaPath, found);
                assertNormalSpeed(clip);
                var requested = requestedCaptionRange(caption, clip, fragments), requestedStart = requested.start, requestedEnd = requested.end;
                if (!isFinite(requestedStart) || !isFinite(requestedEnd) || requestedStart < 0 || requestedEnd <= requestedStart) throw new Error('The caption has invalid box-animation timing.');
                var firstFrame = Math.floor(requestedStart * fps + 0.0000001), endFrame = Math.ceil(requestedEnd * fps - 0.0000001), count = endFrame - firstFrame;
                if (count < 1 || count > 100000000) throw new Error('The caption has invalid automatic-reflow timing.');
                var params, signature, controls;
                if (fragments) { assertFragmentRange(fragments, firstFrame, count, tpf); var geometry = fragmentGeometry(fragments, tpf); signature = geometry.watchSignature; controls = geometry.controlRevision; }
                else { params = motionParameters(clip); signature = geometrySignature(clip, firstFrame, count, tpf, params); controls = controlRevision(clip, firstFrame, count, tpf, params, signature); }
                out.push({ id: caption.id, clipNodeId: String(clip.nodeId), projectItemId: String(clip.projectItem.nodeId), path: clip.projectItem.getMediaPath(), watchSignature: signature, controlRevision: controls });
            }
            return reply({ ok: true, cues: out });
        } catch (e) { return reply({ error: e.toString() }); }
    }
    function areaDescriptor(p) {
        var c = p.cues && p.cues.length === 1 ? p.cues[0] : null;
        if (!p.sequenceId || !p.projectPath || !c || !c.id || !c.clipNodeId || !c.projectItemId || !c.mediaPath) throw new Error('Apply this caption before editing native keyframes.');
        var s = sequence(p.sequenceId, p.projectPath), found = findClip(s, c.clipNodeId);
        if (!found || !sameNode(found.clip.projectItem.nodeId, c.projectItemId) || found.clip.projectItem.getMediaPath() !== c.mediaPath) throw new Error('The caption timeline link changed. Sync timing from Premiere.');
        var fragments = captionFragments(s, c, c.mediaPath, found);
        if (fragments) found = preferredFragment(s, fragments, found);
        var clip = found.clip, track = s.videoTracks[found.track];
        if (track.isLocked()) throw new Error('Unlock the caption video track before editing its text area.');
        assertNormalSpeed(clip);
        var b = renderBounds(c.renderBounds, s), binding = {}, params = motionParameters(clip, binding), uniformAnimated = !!params.uniform.isTimeVarying();
        binding.uniform = { animated: uniformAnimated, value: uniformAnimated ? null : !!motionValue(params.uniform.getValue(), 'uniform') };
        var nativeMotion = {}, total = 0;
        for (var i = 0; i < motionNames.length; i++) {
            var name = motionNames[i]; nativeMotion[name] = copyCurve(parameterCurve(params[name], 256), name); total += nativeMotion[name].keys.length;
        }
        if (total > 1536) throw new Error('The caption has too many Motion keys for a bounded text-area edit.');
        var descriptor = {ok:true,sequenceId:p.sequenceId,projectPath:p.projectPath,clipNodeId:String(clip.nodeId),projectItemId:String(clip.projectItem.nodeId),path:c.mediaPath,track:found.track,startTicks:String(clip.start.ticks),endTicks:String(clip.end.ticks),inTicks:String(clip.inPoint.ticks),outTicks:String(clip.outPoint.ticks),ticksPerFrame:Number(s.timebase),frameWidth:s.frameSizeHorizontal,frameHeight:s.frameSizeVertical,bounds:b,motionBinding:binding,nativeMotion:nativeMotion};
        if (fragments) { descriptor.bundleSourceContiguous = true; descriptor.bundleFragments = fragmentReceipt(fragments); }
        return { clip: clip, params: params, descriptor: descriptor };
    }
    function readCaptionAreaDescriptor(file) {
        try { return reply(areaDescriptor(readPayload(file)).descriptor); }
        catch (e) { return reply({error:e.toString()}); }
    }
    function sameAreaIdentity(expected, actual) {
        if (!expected || expected.ok !== true) return false;
        var names = ['sequenceId','projectPath','clipNodeId','projectItemId','path','track','startTicks','endTicks','inTicks','outTicks','ticksPerFrame','frameWidth','frameHeight'];
        for (var i = 0; i < names.length; i++) if (expected[names[i]] !== actual[names[i]]) return false;
        return stringify(expected.bounds) === stringify(actual.bounds) && stringify(expected.motionBinding) === stringify(actual.motionBinding) && expected.bundleSourceContiguous === actual.bundleSourceContiguous && stringify(expected.bundleFragments) === stringify(actual.bundleFragments);
    }
    function sameMotion(expected, actual) {
        if (!expected || !actual) return false;
        for (var i = 0; i < motionNames.length; i++) {
            var name = motionNames[i], a = expected[name], b = actual[name];
            if (!a || typeof a.animated !== 'boolean' || !(a.keys instanceof Array) || a.keys.length > 256 || a.animated !== b.animated || a.keys.length !== b.keys.length) return false;
            if (!a.animated && !sameValue(a.value, b.value) || a.animated && a.value !== null) return false;
            for (var k = 0; k < a.keys.length; k++) if (!a.keys[k] || typeof a.keys[k].ticks !== 'string' || a.keys[k].ticks !== b.keys[k].ticks || !sameValue(a.keys[k].value, b.keys[k].value)) return false;
        }
        return true;
    }
    function patchCaptionKeyValues(file) {
        var attempted = [], before, p, info, rollbackErrors = [];
        try {
            p = readPayload(file); var patch = p.patch;
            if (!patch || patch.version !== 1 || !(patch.updates instanceof Array) || patch.updates.length < 1 || patch.updates.length > 32) throw new Error('Invalid existing-key value patch.');
            for (var patchKey in patch) if (Object.prototype.hasOwnProperty.call(patch, patchKey) && patchKey !== 'version' && patchKey !== 'descriptor' && patchKey !== 'updates') throw new Error('Unknown existing-key patch property.');
            info = areaDescriptor(p); before = info.descriptor;
            if (!sameAreaIdentity(patch.descriptor, before) || !sameMotion(patch.descriptor.nativeMotion, before.nativeMotion)) throw new Error('Motion or the caption timeline identity changed before the key edit. Refresh and try again.');
            var desired = parseJSON(stringify(before.nativeMotion)), planned = [], seen = {};
            for (var i = 0; i < patch.updates.length; i++) {
                var update = patch.updates[i];
                if (!update || (update.property !== 'position' && update.property !== 'width' && update.property !== 'height') || typeof update.ticks !== 'string' || !/^\d+$/.test(update.ticks) || !isFinite(Number(update.ticks))) throw new Error('Invalid existing-key property or time.');
                for (var updateKey in update) if (Object.prototype.hasOwnProperty.call(update, updateKey) && updateKey !== 'property' && updateKey !== 'ticks' && updateKey !== 'expectedValue' && updateKey !== 'value') throw new Error('Unknown existing-key update property.');
                var keyId = update.property + ':' + update.ticks;
                if (seen[keyId]) throw new Error('Duplicate existing-key update.'); seen[keyId] = true;
                var curve = desired[update.property], found = null;
                for (var k = 0; k < curve.keys.length; k++) if (curve.keys[k].ticks === update.ticks) found = curve.keys[k];
                if (!curve.animated || !found || Number(update.ticks) < Number(before.inTicks) || Number(update.ticks) >= Number(before.outTicks)) throw new Error('Choose an existing key inside this caption. No key was added.');
                if (!sameValue(found.value, update.expectedValue)) throw new Error('The existing key value changed. Refresh before editing it.');
                var value = motionValue(update.value, update.property);
                if (update.property === 'position' && (value[0] < -2 || value[0] > 3 || value[1] < -2 || value[1] > 3)) throw new Error('Caption Position must stay within the supported frame range.');
                if (typeof info.params[update.property].setValueAtKey !== 'function') throw new Error('Premiere did not expose an in-place key value setter.');
                planned.push({ property: update.property, ticks: update.ticks, previous: motionValue(found.value, update.property), value: value }); found.value = value;
            }
            // Every identity, key and old value is checked before the first write.
            for (i = 0; i < planned.length; i++) {
                var entry = planned[i]; attempted.push(entry);
                var status = info.params[entry.property].setValueAtKey(ticksTime(entry.ticks), entry.value, 1);
                if (status === false || !sameValue(info.params[entry.property].getValueAtKey(ticksTime(entry.ticks)), entry.value)) throw new Error('Premiere did not keep the existing key value.');
            }
            var after = areaDescriptor(p).descriptor;
            if (!sameAreaIdentity(before, after) || !sameMotion(desired, after.nativeMotion)) throw new Error('Premiere changed another Motion value while applying the key patch.');
            return reply({ok:true,descriptor:after,updates:planned});
        } catch (e) {
            for (var r = attempted.length - 1; r >= 0; r--) try {
                var old = attempted[r]; info.params[old.property].setValueAtKey(ticksTime(old.ticks), old.previous, 1);
                if (!sameValue(info.params[old.property].getValueAtKey(ticksTime(old.ticks)), old.previous)) throw new Error('The previous key value was not restored.');
            } catch (restoreError) { rollbackErrors.push(restoreError.toString()); }
            if (attempted.length && before) try { var restored = areaDescriptor(p).descriptor; if (!sameAreaIdentity(before, restored) || !sameMotion(before.nativeMotion, restored.nativeMotion)) throw new Error('The original Motion state could not be fully verified.'); } catch (verifyError) { rollbackErrors.push(verifyError.toString()); }
            return reply({error:e.toString(),rolledBack:rollbackErrors.length===0,rollbackErrors:rollbackErrors,recoveryJob:file});
        }
    }
    function readCaptionMotion(file) {
        var trace = { phase: 'caption job', frame: null, fragment: null };
        try {
            var p = readPayload(file);
            if (!p.sequenceId || !p.projectPath || !p.cues || !p.cues.length || p.cues.length > 10000) throw new Error('Invalid caption Motion request.');
            trace.phase = 'sequence context';
            var s = sequence(p.sequenceId, p.projectPath), tpf = Number(s.timebase), fps = TICKS / tpf, out = [], totalFrames = 0;
            if (!isFinite(tpf) || tpf <= 0) throw new Error('The sequence has an invalid frame rate.');
            for (var i = 0; i < p.cues.length; i++) {
                motionPhase(trace, 'caption clip lookup'); trace.fragment = null;
                var caption = p.cues[i], found = caption.clipNodeId ? findClip(s, caption.clipNodeId) : null;
                if (!found || !caption.id || !caption.projectItemId || !sameNode(found.clip.projectItem.nodeId, caption.projectItemId) || found.clip.projectItem.getMediaPath() !== caption.mediaPath) throw new Error('The caption timeline link changed. Sync timing from Premiere before reading its box size.');
                motionPhase(trace, 'caption split references');
                var clip = found.clip, fragments = captionFragments(s, caption, caption.mediaPath, found);
                motionPhase(trace, 'caption frame timing');
                var requested = requestedCaptionRange(caption, clip, fragments), requestedStart = requested.start, requestedEnd = requested.end;
                if (!isFinite(requestedStart) || !isFinite(requestedEnd) || requestedStart < 0 || requestedEnd <= requestedStart) throw new Error('The caption has invalid box-animation timing.');
                var firstFrame = Math.floor(requestedStart * fps + 0.0000001), endFrame = Math.ceil(requestedEnd * fps - 0.0000001), count = endFrame - firstFrame;
                totalFrames += count;
                if (count < 1 || totalFrames > 100000) throw new Error('Read caption box animation in smaller batches of at most 100000 frames.');
                motionPhase(trace, 'caption Motion profile');
                var result = { id: caption.id, clipNodeId: String(clip.nodeId), projectItemId: String(clip.projectItem.nodeId), path: clip.projectItem.getMediaPath(), motionProfile: fragments ? fragmentProfile(fragments, firstFrame, count, tpf, trace) : motionProfile(clip, firstFrame, count, tpf, trace) };
                if (fragments) result.bundleFragments = fragmentReceipt(fragments);
                if (p.includeDiagnostics === true) {
                    motionPhase(trace, 'optional Motion diagnostics');
                    var params = motionParameters(clip), diagnosticTime = ticksTime(Math.round(Number(clip.inPoint.ticks) + tpf / 2));
                    // Native metadata/Position/Anchor probing is explicit and
                    // never part of the automatic geometry watch path.
                    var diagnostic = { sourceInTicks: String(clip.inPoint.ticks), sampleSourceTicks: diagnosticTime.ticks };
                    if (params.position) diagnostic.position = motionVector(parameterAt(params.position, parameterCurve(params.position), diagnosticTime), 'Position');
                    if (params.anchor) diagnostic.anchor = motionVector(parameterAt(params.anchor, parameterCurve(params.anchor), diagnosticTime), 'Anchor Point');
                    readMediaDiagnostics(clip.projectItem, diagnostic);
                    result.motionInfo = diagnostic;
                }
                out.push(result);
            }
            motionPhase(trace, 'Motion response encoding');
            return reply({ ok: true, cues: out });
        } catch (e) {
            // Preserve bounded native line/phase details through the fixed
            // service error string; never return media text or raw parameters.
            var line = null, detail = 'Unknown native Motion error.';
            try { var candidateLine = Number(e && e.line); if (isFinite(candidateLine) && candidateLine > 0 && candidateLine <= 10000000) line = Math.floor(candidateLine); } catch (lineError) {}
            try { detail = String(e).slice(0, 400); } catch (detailError) {}
            var phase = String(trace.phase).slice(0, 80), frame = typeof trace.frame === 'number' && trace.frame >= 0 && trace.frame < 100000 ? trace.frame : null;
            return reply({ error: 'Premiere caption Motion read failed during ' + phase + (frame === null ? '' : ' at output frame ' + frame) + (line === null ? '' : ' (line ' + line + ')') + ': ' + detail, phase: phase, nativeLine: line, frame: frame, fragment: trace.fragment });
        }
    }
    function overlaps(a, b) { return a.startFrame < b.endFrame && a.endFrame > b.startFrame; }
    function frameTime(frame, ticksPerFrame) { var t = new Time(); t.ticks = String(Math.round(frame * ticksPerFrame)); return t; }
    function ticksTime(ticks) { var t = new Time(); t.ticks = String(ticks); return t; }
    function motionVector(value, label) {
        if (!value || value.length !== 2 || typeof value[0] !== 'number' || typeof value[1] !== 'number' || !isFinite(value[0]) || !isFinite(value[1])) throw new Error('Premiere returned an invalid ' + label + ' coordinate.');
        return [value[0], value[1]];
    }
    function motionScalar(value, label) {
        if (typeof value !== 'number' || !isFinite(value)) throw new Error('Premiere returned an invalid ' + label + ' value.');
        return value;
    }
    function motionValue(value, label) {
        if (label === 'position' || label === 'anchor') return motionVector(value, label === 'position' ? 'Position' : 'Anchor Point');
        if (label === 'uniform') {
            if (!(value === true || value === false || value === 0 || value === 1)) throw new Error('Premiere returned an invalid Uniform Scale value.');
            return value;
        }
        var number = motionScalar(value, label);
        if ((label === 'height' || label === 'width') && (number < 1 || number > 10000)) throw new Error('Caption box width and height must remain between 1% and 10000%.');
        return number;
    }
    var motionNames = ['position', 'height', 'width', 'uniform', 'rotation', 'anchor'];
    function copyCurve(curve, label) {
        var keys = [];
        if (curve.animated && !curve.keys.length) throw new Error('Premiere did not expose the caption ' + label + ' keyframes.');
        for (var i = 0; i < curve.keys.length; i++) keys.push({ ticks: curve.keys[i].ticks, value: motionValue(curve.keys[i].value, label) });
        return { animated: curve.animated, value: curve.animated ? null : motionValue(curve.value, label), keys: keys };
    }
    function motionState(clip) {
        var params = motionParameters(clip), state = {};
        for (var i = 0; i < motionNames.length; i++) {
            var name = motionNames[i];
            if (!params[name]) throw new Error('Premiere did not expose the caption ' + name + ' control.');
            state[name] = copyCurve(parameterCurve(params[name]), name);
        }
        return state;
    }
    function scalarCurve(value) { return { animated: false, value: value, keys: [] }; }
    function sameValue(a, b) {
        if (a && b && typeof a === 'object' && typeof b === 'object' && a.length === 2 && b.length === 2) return sameValue(a[0], b[0]) && sameValue(a[1], b[1]);
        if ((a === true || a === false) && (b === 0 || b === 1)) return Number(a) === b;
        if ((b === true || b === false) && (a === 0 || a === 1)) return a === Number(b);
        return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 0.000001 * Math.max(1, Math.abs(a), Math.abs(b)) : a === b;
    }
    function writeCurve(param, target, label) {
        var current = copyCurve(parameterCurve(param), label), i, status;
        if (current.animated !== target.animated || current.keys.length !== target.keys.length) throw new Error('The caption ' + label + ' keyframe structure changed. Refresh and apply again.');
        if (target.animated) {
            for (i = 0; i < target.keys.length; i++) if (Math.abs(Number(current.keys[i].ticks) - Number(target.keys[i].ticks)) > 2) throw new Error('The caption ' + label + ' keyframe times changed. Refresh and apply again.');
            for (i = 0; i < target.keys.length; i++) if (!sameValue(current.keys[i].value, target.keys[i].value)) {
                status = param.setValueAtKey(ticksTime(target.keys[i].ticks), target.keys[i].value, 1);
                if (status === false || !sameValue(param.getValueAtKey(ticksTime(target.keys[i].ticks)), target.keys[i].value)) throw new Error('Premiere did not keep the caption ' + label + ' keyframe value.');
            }
        } else if (!sameValue(current.value, target.value)) {
            status = param.setValue(target.value, 1);
            if (status === false || !sameValue(param.getValue(), target.value)) throw new Error('Premiere did not keep the caption ' + label + ' value.');
        }
    }
    function writeMotion(clip, target) {
        var params = motionParameters(clip);
        // Write independent Width before unlocking Uniform Scale. No frame is
        // allowed to inherit a stale hidden width value during conversion.
        var order = ['width', 'height', 'uniform', 'anchor', 'position', 'rotation'];
        for (var i = 0; i < order.length; i++) writeCurve(params[order[i]], target[order[i]], order[i]);
    }
    function renderBounds(value, s) {
        if (!value || value.frameWidth !== s.frameSizeHorizontal || value.frameHeight !== s.frameSizeVertical) throw new Error('The caption text box belongs to different sequence dimensions. Render again.');
        var names = ['x', 'y', 'width', 'height'];
        for (var i = 0; i < names.length; i++) {
            var n = value[names[i]];
            if (typeof n !== 'number' || !isFinite(n) || n !== Math.floor(n) || Math.abs(n) > 10000000) throw new Error('The caption text box has invalid pixel bounds.');
        }
        if (value.width < 1 || value.height < 1 || value.width > value.frameWidth || value.height > value.frameHeight) throw new Error('The caption text box must fit within the sequence dimensions.');
        return { x: value.x, y: value.y, width: value.width, height: value.height, frameWidth: value.frameWidth, frameHeight: value.frameHeight };
    }
    function geometryPlan(clip, cue, s, verifiedSplit) {
        var bounds = renderBounds(cue.renderBounds, s), before = motionState(clip), target = {}, animated = false;
        if (typeof clip.projectItem.refreshMedia !== 'function') throw new Error('Premiere cannot refresh the caption source geometry. Update Premiere before changing this caption text box.');
        assertNormalSpeed(clip);
        for (var i = 0; i < motionNames.length; i++) {
            var name = motionNames[i]; target[name] = copyCurve(before[name], name); animated = animated || before[name].animated;
        }
        if (animated && Math.abs(Number(clip.inPoint.ticks)) > 2 && !verifiedSplit) throw new Error('Caption box reflow cannot preserve animated Motion on a trimmed source. Restore the caption source in point to zero before applying.');
        if (before.uniform.animated || before.uniform.value && (before.height.animated || before.width.animated)) throw new Error('Turn off Uniform Scale and create independent width and height keyframes before applying this caption box.');
        if (before.uniform.value) target.width = scalarCurve(before.height.value);
        target.uniform = scalarCurve(false);
        var old = cue.previousRenderBounds ? renderBounds(cue.previousRenderBounds, s) : { x: 0, y: 0, width: s.frameSizeHorizontal, height: s.frameSizeVertical };
        var changed = old.x !== bounds.x || old.y !== bounds.y || old.width !== bounds.width || old.height !== bounds.height;
        if (changed && before.anchor.animated) throw new Error('This caption has animated Anchor Point geometry. Keep its existing text box bounds or remove Anchor Point animation before migrating the box. Position, width, height and rotation animation are supported.');
        if (changed && animated) {
            // Position/Scale/Rotation keys and their native interpolation stay
            // untouched. Express the same logical anchor in the new source.
            var previousAnchor = target.anchor.value;
            target.anchor.value = [(previousAnchor[0] * old.width + old.x - bounds.x) / bounds.width, (previousAnchor[1] * old.height + old.y - bounds.y) / bounds.height];
        } else if (changed) {
            var anchor = before.anchor.value, position = before.position.value;
            var dx = bounds.x + bounds.width / 2 - old.x - anchor[0] * old.width, dy = bounds.y + bounds.height / 2 - old.y - anchor[1] * old.height;
            var sy = before.height.value / 100, sx = before.uniform.value ? sy : before.width.value / 100, angle = before.rotation.value * Math.PI / 180;
            var x = dx * sx, y = dy * sy;
            target.position = scalarCurve([position[0] + (x * Math.cos(angle) - y * Math.sin(angle)) / s.frameSizeHorizontal, position[1] + (x * Math.sin(angle) + y * Math.cos(angle)) / s.frameSizeVertical]);
            target.anchor = scalarCurve([0.5, 0.5]);
        }
        return { before: before, target: target, bounds: bounds };
    }
    function initializeGeometry(clip, bounds, s) {
        var target = { position: scalarCurve([(bounds.x + bounds.width / 2) / s.frameSizeHorizontal, (bounds.y + bounds.height / 2) / s.frameSizeVertical]), height: scalarCurve(100), width: scalarCurve(100), uniform: scalarCurve(false), rotation: scalarCurve(0), anchor: scalarCurve([0.5, 0.5]) };
        writeMotion(clip, target);
    }
    function snapshot(clip, motion) { return { clip: clip, item: clip.projectItem, media: clip.projectItem.getMediaPath(), name: clip.name, start: clip.start.ticks, end: clip.end.ticks, inPoint: clip.inPoint.ticks, outPoint: clip.outPoint.ticks, motion: motion }; }
    function refreshCaptionMedia(item, expectedPath) {
        if (typeof item.refreshMedia !== 'function') throw new Error('Premiere cannot refresh the caption source geometry.');
        // Adobe's CEP sample does not require a boolean return (older typings
        // declare a string); unlike UXP, zero is not a failure signal here.
        var status = item.refreshMedia();
        if (status === false || item.getMediaPath() !== expectedPath || typeof item.isOffline === 'function' && item.isOffline()) throw new Error('Premiere could not refresh the caption source geometry.');
    }
    function setTiming(clip, startFrame, endFrame, ticksPerFrame) {
        clip.inPoint = frameTime(0, ticksPerFrame);
        clip.outPoint = frameTime(endFrame - startFrame, ticksPerFrame);
        clip.start = frameTime(startFrame, ticksPerFrame);
        clip.end = frameTime(endFrame, ticksPerFrame);
    }
    function assertTiming(clip, cue, ticksPerFrame) {
        if (Math.abs(Number(clip.start.ticks) - cue.startFrame * ticksPerFrame) > 2 || Math.abs(Number(clip.end.ticks) - cue.endFrame * ticksPerFrame) > 2) throw new Error('Premiere did not keep the requested caption timing.');
    }
    function captionDestination(s, requested) {
        var count = s.videoTracks.numTracks;
        if (typeof count !== 'number' || count !== Math.floor(count) || count < 0 || count > 256) throw new Error('Automatic captions support sequences with at most 256 video tracks.');
        if (requested !== -1) {
            if (requested !== Math.floor(requested) || requested < 0 || !s.videoTracks[requested]) throw new Error('Choose an existing video track or Automatic for captions.');
            return { mode: 'explicit', trackIndex: requested, expectedVideoTrackCount: count, newCaptionCount: 0 };
        }
        var top = count ? s.videoTracks[count - 1] : null;
        if (top && !top.isLocked() && !(typeof top.isMuted === 'function' && top.isMuted()) && top.clips.numItems === 0) return { mode: 'reuse', trackIndex: count - 1, expectedVideoTrackCount: count, newCaptionCount: 0 };
        return { mode: 'create', trackIndex: count, expectedVideoTrackCount: count, newCaptionCount: 0 };
    }
    function otherEffects(clip) {
        var result = [], components = clip.components;
        if (!components || components.numItems > 32) throw new Error('This legacy caption has unsupported effects. Its existing clip was preserved.');
        for (var i = 0; i < components.numItems; i++) {
            var c = components[i];
            if (c.matchName === 'AE.ADBE Motion' || c.matchName === 'ADBE Motion') continue;
            if (c.matchName !== 'AE.ADBE Opacity' && c.matchName !== 'ADBE Opacity' && c.matchName !== 'AE.ADBE Time Remapping' && c.matchName !== 'ADBE Time Remapping') throw new Error('Remove custom effects from legacy captions before combining them. Existing clips were preserved.');
            if (!c.properties || c.properties.numItems > 32) throw new Error('Premiere could not verify legacy caption effects.');
            var properties = [];
            for (var j = 0; j < c.properties.numItems; j++) {
                var prop = c.properties[j];
                if (typeof prop.isTimeVarying !== 'function' || prop.isTimeVarying()) throw new Error('Animated legacy caption effects cannot be combined without losing their native keys. Existing clips were preserved.');
                var value = prop.getValue();
                if (typeof value !== 'number' && typeof value !== 'boolean' && typeof value !== 'string') throw new Error('Premiere could not verify a legacy caption effect value.');
                properties.push({ name: prop.displayName, value: value });
            }
            result.push({ matchName: c.matchName, properties: properties });
        }
        return result;
    }
    function legacyPlan(p) {
        var cues = p.legacyCues || p.cues, s = sequence(p.sequenceId, p.projectPath), tpf = Number(s.timebase), clips = [], samples = [], ids = {}, bounds = null;
        if (!cues || cues.length < 2 || cues.length > 64) throw new Error('Combine between two and 64 legacy caption clips at once.');
        for (var i = 0; i < cues.length; i++) {
            var cue = cues[i], found = cue.clipNodeId ? findClip(s, cue.clipNodeId, 2000) : null;
            if (cue.manualSplit || cue.captionBundle || !cue.id || !cue.projectItemId || !found || !sameNode(found.clip.projectItem.nodeId, cue.projectItemId) || found.clip.projectItem.getMediaPath() !== cue.mediaPath || ids[String(found.clip.nodeId)]) throw new Error('A legacy caption link changed or contains a deliberate split. Existing clips were preserved.');
            var clip = found.clip, track = s.videoTracks[found.track];
            if (clip.disabled || typeof track.isMuted === 'function' && track.isMuted()) throw new Error('Enable every legacy caption clip and its video track before combining captions. Existing clips were preserved.');
            var b = renderBounds(cue.renderBounds, s), motion = motionState(clip);
            ids[String(clip.nodeId)] = true; assertNormalSpeed(clip);
            if (track.isLocked() || track.transitions && track.transitions.numItems) throw new Error('Unlock the legacy caption track and remove its transitions before combining clips.');
            if (referenceCount(clip.projectItem.nodeId) !== 1) throw new Error('Legacy caption media is reused. Make copied captions independent before combining them.');
            for (var m = 0; m < motionNames.length; m++) if (motion[motionNames[m]].animated) throw new Error('Legacy captions with native animation are preserved as separate clips. Use one new caption clip or keep their existing keys.');
            if (!sameValue(motion.anchor.value, [0.5, 0.5]) || !sameValue(motion.rotation.value, 0)) throw new Error('Legacy captions with a custom anchor or rotation are preserved as separate clips.');
            if (!bounds) bounds = b;
            if (stringify(b) !== stringify(bounds)) throw new Error('Legacy captions with different source text-box bounds are preserved as separate clips.');
            var start = Number(clip.start.ticks), end = Number(clip.end.ticks), first = Math.round(start / tpf), last = Math.round(end / tpf);
            if (Math.abs(start - first * tpf) > 2 || Math.abs(end - last * tpf) > 2 || end <= start || Number(clip.inPoint.ticks) !== 0 || Math.abs(Number(clip.outPoint.ticks) - (end - start)) > 2 || Math.abs(cue.startTime * TICKS - start) > 2 || Math.abs(cue.endTime * TICKS - end) > 2) throw new Error('Sync legacy caption timing from Premiere before combining untrimmed clips.');
            if (i && (found.track !== clips[0].track || String(clip.start.ticks) !== clips[i - 1].endTicks)) throw new Error('Legacy caption clips must be adjacent on one track before combining.');
            if (samples.length + last - first > 100000) throw new Error('Combine legacy captions in a smaller sequence.');
            var effects = otherEffects(clip), receipt = fragmentReceipt([found])[0];
            receipt.id = cue.id; receipt.projectItemId = String(clip.projectItem.nodeId); receipt.path = cue.mediaPath; receipt.bounds = b; receipt.motion = motion; receipt.effects = effects;
            if (i && stringify(effects) !== stringify(clips[0].effects)) throw new Error('Legacy captions have different effects. Their existing clips were preserved.');
            clips.push(receipt);
            var sx = (motion.uniform.value ? motion.height.value : motion.width.value) / 100, sy = motion.height.value / 100;
            for (var frame = first; frame < last; frame++) samples.push({ time: (frame + 0.5) * tpf / TICKS, scaleX: sx, scaleY: sy });
        }
        var result = { ok: true, version: 1, sequenceId: p.sequenceId, projectPath: p.projectPath, clips: clips, bounds: bounds, ticksPerFrame: tpf };
        result.signature = curveSignature(result); result.motionProfile = { signature: result.signature, samples: samples };
        return result;
    }
    function readCaptionConsolidation(file) { try { return reply(legacyPlan(readPayload(file))); } catch (e) { return reply({ error: e.toString() }); } }
    function confirmLegacyPlan(p) {
        var actual = legacyPlan(p);
        if (!p.plan || p.plan.version !== 1 || p.plan.signature !== actual.signature || stringify(p.plan.clips) !== stringify(actual.clips) || stringify(p.plan.bounds) !== stringify(actual.bounds)) throw new Error('Legacy caption geometry or timing changed while rendering. No original clips were removed.');
        return actual;
    }
    function consolidationValues(plan, name) {
        var values = [];
        for (var i = 0; i < plan.clips.length; i++) {
            var m = plan.clips[i].motion, value = name === 'width' && m.uniform.value ? m.height.value : m[name].value;
            values.push({ ticks: String(Number(plan.clips[i].startTicks) - Number(plan.clips[0].startTicks)), value: value });
        }
        return values;
    }
    function verifyConsolidatedMotion(clip, plan) {
        var params = motionParameters(clip), names = ['position', 'width', 'height'];
        if (stringify(otherEffects(clip)) !== stringify(plan.clips[0].effects)) throw new Error('The combined clip cannot preserve the legacy effects exactly.');
        if (params.uniform.isTimeVarying() || !!params.uniform.getValue() || params.rotation.isTimeVarying() || !sameValue(params.rotation.getValue(), 0) || params.anchor.isTimeVarying() || !sameValue(params.anchor.getValue(), [0.5, 0.5])) throw new Error('The combined caption Motion changed.');
        for (var n = 0; n < names.length; n++) {
            var name = names[n], expected = consolidationValues(plan, name), curve = copyCurve(parameterCurve(params[name], 64), name);
            if (!curve.animated || curve.keys.length !== expected.length) throw new Error('Premiere did not retain every legacy caption hold key.');
            for (var i = 0; i < expected.length; i++) if (curve.keys[i].ticks !== expected[i].ticks || !sameValue(curve.keys[i].value, expected[i].value)) throw new Error('Premiere changed a legacy caption position or size key.');
            // CEP has no interpolation getter. Sample every visible frame to
            // prove these newly created hold curves without flattening old keys.
            for (i = 0; i < plan.clips.length; i++) {
                var first = Number(expected[i].ticks), end = Number(plan.clips[i].endTicks) - Number(plan.clips[0].startTicks);
                for (var at = first; at < end; at += plan.ticksPerFrame) if (!sameValue(params[name].getValueAtTime(ticksTime(at)), expected[i].value)) throw new Error('Premiere did not preserve the legacy caption hold geometry.');
            }
        }
    }
    function consolidatedClip(p) {
        var s = sequence(p.sequenceId, p.projectPath), cue = p.cues && p.cues.length === 1 && p.cues[0], found = cue && findClip(s, cue.clipNodeId, 2000);
        if (!found || !sameNode(found.clip.projectItem.nodeId, cue.projectItemId) || found.clip.projectItem.getMediaPath() !== cue.mediaPath || referenceCount(found.clip.projectItem.nodeId) !== 1) throw new Error('The combined caption link changed. No original clips were removed.');
        var clip = found.clip, plan = p.plan;
        validateConsolidationPlan(plan, s, p);
        if (!plan || !plan.clips || plan.clips.length < 2 || plan.clips.length > 64 || String(clip.start.ticks) !== plan.clips[0].startTicks || String(clip.end.ticks) !== plan.clips[plan.clips.length - 1].endTicks || String(clip.inPoint.ticks) !== '0' || Number(clip.outPoint.ticks) !== Number(clip.end.ticks) - Number(clip.start.ticks) || s.videoTracks[found.track].isLocked()) throw new Error('The combined caption timing changed.');
        assertNormalSpeed(clip); verifyConsolidatedMotion(clip, plan);
        return found;
    }
    function validateConsolidationPlan(plan, s, p) {
        if (!plan || plan.version !== 1 || plan.sequenceId !== p.sequenceId || plan.projectPath !== p.projectPath || plan.ticksPerFrame !== Number(s.timebase) || !isFinite(plan.ticksPerFrame) || plan.ticksPerFrame <= 0 || !plan.clips || plan.clips.length < 2 || plan.clips.length > 64) throw new Error('Invalid legacy conversion proof.');
        renderBounds(plan.bounds, s);
        var nodes = {}, frames = 0;
        for (var i = 0; i < plan.clips.length; i++) {
            var c = plan.clips[i];
            if (!c || typeof c.clipNodeId !== 'string' || !c.clipNodeId || nodes[c.clipNodeId] || c.track !== plan.clips[0].track || !isFinite(c.track) || c.track < 0 || c.track !== Math.floor(c.track) || !c.motion || !c.effects || c.effects.length > 32 || stringify(c.effects).length > 20000) throw new Error('Invalid legacy conversion proof.');
            nodes[c.clipNodeId] = true;
            var names = ['startTicks', 'endTicks', 'inTicks', 'outTicks'];
            for (var j = 0; j < names.length; j++) if (typeof c[names[j]] !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(c[names[j]])) throw new Error('Invalid legacy conversion timing.');
            var start = Number(c.startTicks), end = Number(c.endTicks), count = (end - start) / plan.ticksPerFrame;
            if (count <= 0 || count !== Math.floor(count) || start / plan.ticksPerFrame > 100000000 || start / plan.ticksPerFrame !== Math.floor(start / plan.ticksPerFrame) || c.inTicks !== '0' || Number(c.outTicks) !== end - start || i && c.startTicks !== plan.clips[i - 1].endTicks) throw new Error('Invalid legacy conversion timing.');
            frames += count; if (frames > 100000) throw new Error('Legacy conversion exceeds the frame limit.');
            for (j = 0; j < motionNames.length; j++) {
                var curve = c.motion[motionNames[j]];
                if (!curve || curve.animated !== false || !curve.keys || curve.keys.length) throw new Error('Invalid static legacy Motion proof.');
                motionValue(curve.value, motionNames[j]);
            }
            if (stringify(c.bounds) !== stringify(plan.bounds) || !sameValue(c.motion.anchor.value, [0.5,0.5]) || !sameValue(c.motion.rotation.value,0)) throw new Error('Invalid legacy conversion geometry.');
        }
    }
    function verifyCaptionConsolidation(file) {
        try {
            var p = readPayload(file), s = sequence(p.sequenceId, p.projectPath), found = consolidatedClip(p), present = 0;
            for (var i = 0; i < p.plan.clips.length; i++) if (findClip(s, p.plan.clips[i].clipNodeId, 2000)) present++;
            if (present && present !== p.plan.clips.length) throw new Error('Only some legacy clips remain. Review Premiere Undo before continuing; no automatic cleanup was attempted.');
            if (present) confirmLegacyPlan(p);
            var replacement = fragmentReceipt([found])[0]; replacement.path = found.clip.projectItem.getMediaPath();
            return reply({ ok: true, complete: present === 0, clips: p.plan.clips, replacement: replacement });
        } catch (e) { return reply({ error: e.toString() }); }
    }
    function stageCaptionConsolidation(file) {
        var result = null, p;
        try {
            p = readPayload(file); var plan = confirmLegacyPlan(p);
            if (!p.cues || p.cues.length !== 1 || p.cues[0].clipNodeId || p.cues[0].captionBundle !== true || stringify(p.cues[0].renderBounds) !== stringify(plan.bounds)) throw new Error('Invalid combined caption replacement.');
            result = parseJSON(apply(file));
            if (!result.ok) return reply(result);
            var s = sequence(p.sequenceId, p.projectPath), found = findClip(s, result.cues[0].clipNodeId), clip = found.clip, params = motionParameters(clip), names = ['position', 'width', 'height'];
            if (stringify(otherEffects(clip)) !== stringify(plan.clips[0].effects)) throw new Error('The combined clip cannot preserve the legacy effects exactly.');
            for (var n = 0; n < names.length; n++) {
                var name = names[n], param = params[name], values = consolidationValues(plan, name);
                if (param.isTimeVarying() || typeof param.setTimeVarying !== 'function' || typeof param.addKey !== 'function' || typeof param.setInterpolationTypeAtKey !== 'function') throw new Error('Premiere did not expose native hold-key creation for combined captions.');
                param.setTimeVarying(true);
                for (var k = 0; k < values.length; k++) {
                    var at = ticksTime(values[k].ticks);
                    param.addKey(at); param.setValueAtKey(at, values[k].value, 1); param.setInterpolationTypeAtKey(at, 4, 1);
                }
            }
            confirmLegacyPlan(p); verifyConsolidatedMotion(clip, plan);
            result.cues[0].motionProfile = motionProfile(clip, p.cues[0].startFrame, p.cues[0].endFrame - p.cues[0].startFrame, Number(s.timebase));
            return reply(result);
        } catch (e) {
            var cleanup = true;
            if (result && result.ok) try {
                confirmLegacyPlan(p);
                var staged = findClip(sequence(p.sequenceId, p.projectPath), result.cues[0].clipNodeId);
                if (!staged || !sameNode(staged.clip.projectItem.nodeId, result.cues[0].projectItemId) || staged.clip.projectItem.getMediaPath() !== result.cues[0].path || referenceCount(staged.clip.projectItem.nodeId) !== 1) throw new Error('The staged caption changed.');
                staged.clip.remove(false, false);
                if (findClip(sequence(p.sequenceId, p.projectPath), result.cues[0].clipNodeId)) throw new Error('The staged caption could not be removed.');
            } catch (cleanupError) { cleanup = false; }
            return reply({ error: e.toString() + (cleanup ? ' Original clips were preserved.' : ' Original clips were preserved; review the extra staged clip before retrying.'), rolledBack: cleanup, recoveryJob: file });
        }
    }
    function rollbackCaptionConsolidation(file) {
        try {
            var p = readPayload(file); confirmLegacyPlan(p);
            var found = consolidatedClip(p), node = String(found.clip.nodeId), s = sequence(p.sequenceId, p.projectPath);
            found.clip.remove(false, false);
            if (findClip(s, node)) throw new Error('Premiere could not remove the staged replacement.');
            return reply({ ok: true, rolledBack: true });
        } catch (e) { return reply({ error: e.toString() }); }
    }
    function driveMediaPath(path) {
        var letter = path.charCodeAt(0);
        return ((letter >= 65 && letter <= 90) || (letter >= 97 && letter <= 122)) && path.charAt(1) === ':' && (path.charAt(2) === '/' || path.charAt(2) === '\\');
    }
    function localMediaPath(path) {
        if (typeof path !== 'string' || path.length > 4096 || /[\u0000-\u001f]/.test(path)) return false;
        var normalized = path.split('\\').join('/');
        if (normalized.charAt(0) === '/' && normalized.charAt(1) === '/') return false;
        if (path.charAt(0) !== '/' && !driveMediaPath(path)) return false;
        var parts = normalized.split('/');
        for (var i = 0; i < parts.length; i++) if (parts[i] === '.' || parts[i] === '..') return false;
        return true;
    }
    function linkIdentity(cue) {
        function identity(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f]/.test(value); }
        if (!cue || !identity(cue.id) || !identity(cue.clipNodeId) || !identity(cue.projectItemId) || !localMediaPath(cue.mediaPath)) throw new Error('A caption timeline link is incomplete. Sync timing from Premiere before updating it.');
    }
    function comparableMediaPath(path) {
        // Drive paths are case-insensitive on supported Windows installs;
        // macOS/POSIX paths retain case to avoid identifying unrelated media.
        return driveMediaPath(path) ? path.split('\\').join('/').toLowerCase() : path;
    }
    function activeReferences(s) {
        var references = [], sets = [s.videoTracks, s.audioTracks], inspected = 0;
        for (var k = 0; k < sets.length; k++) {
            var tracks = sets[k];
            if (!tracks || typeof tracks.numTracks !== 'number' || !isFinite(tracks.numTracks) || tracks.numTracks < 0 || tracks.numTracks !== Math.floor(tracks.numTracks) || tracks.numTracks > 256) throw new Error('Premiere could not safely inspect every caption track.');
            for (var t = 0; t < tracks.numTracks; t++) {
                var clips = tracks[t].clips;
                if (!clips || typeof clips.numItems !== 'number' || !isFinite(clips.numItems) || clips.numItems < 0 || clips.numItems !== Math.floor(clips.numItems) || inspected + clips.numItems > 2000) throw new Error('This sequence is too large to confirm deleted caption clips automatically.');
                for (var c = 0; c < clips.numItems; c++) {
                    inspected++;
                    var clip = clips[c], item = clip && clip.projectItem;
                    if (!clip || clip.nodeId === undefined || clip.nodeId === null || !item || item.nodeId === undefined || item.nodeId === null || typeof item.getMediaPath !== 'function') throw new Error('Premiere could not confirm every timeline media reference.');
                    var path = item.getMediaPath();
                    if (typeof path !== 'string') throw new Error('Premiere could not confirm every timeline media path.');
                    references.push({ clip: clip, video: k === 0, track: t, clipNodeId: String(clip.nodeId), projectItemId: String(item.nodeId), path: comparableMediaPath(path) });
                }
            }
        }
        return references;
    }
    function confirmAbsent(cue, references) {
        linkIdentity(cue);
        var path = comparableMediaPath(cue.mediaPath);
        for (var i = 0; i < references.length; i++) {
            var ref = references[i];
            if (ref.clipNodeId === cue.clipNodeId || ref.projectItemId === cue.projectItemId || ref.path === path) throw new Error('A deleted caption still has a clip, split fragment or media copy in this sequence. Sync timing from Premiere before applying again.');
        }
    }
    function confirmDeletedLinks(p, s) {
        if (p.deletedLinks === undefined) return;
        if (!(p.deletedLinks instanceof Array) || p.deletedLinks.length > 10000) throw new Error('Invalid deleted caption links.');
        if (!p.deletedLinks.length) return;
        var references = activeReferences(s), ids = {}, nodes = {};
        for (var i = 0; i < p.deletedLinks.length; i++) {
            var cue = p.deletedLinks[i]; linkIdentity(cue);
            if (ids['$' + cue.id] || nodes['$' + cue.clipNodeId]) throw new Error('Duplicate deleted caption links.');
            ids['$' + cue.id] = true; nodes['$' + cue.clipNodeId] = true;
            confirmAbsent(cue, references);
        }
    }
    function prepare(p, requireMedia) {
        var s = sequence(p.sequenceId, p.projectPath), tpf = Number(s.timebase), fps = TICKS / tpf;
        if (!p.sequenceId || !p.projectPath || !p.cues || !p.cues.length || p.cues.length > 10000) throw new Error('Invalid caption job.');
        if (p.width !== s.frameSizeHorizontal || p.height !== s.frameSizeVertical || Math.abs(p.fps - fps) > 0.000001) throw new Error('Sequence dimensions or frame rate changed. Refresh and render again.');
        // Recheck the positive deletion receipt after rendering and again after
        // UXP creates an automatic track. Undo/re-add must never duplicate clips.
        confirmDeletedLinks(p, s);
        var destination = captionDestination(s, p.track);
        var planned = [], ids = {}, nodes = {}, i, j, geometryFrames = 0;
        for (i = 0; i < p.cues.length; i++) {
            var cue = p.cues[i];
            if (!cue.id || ids[cue.id] || !isFinite(cue.startFrame) || !isFinite(cue.endFrame) || cue.startFrame < 0 || cue.startFrame !== Math.floor(cue.startFrame) || cue.endFrame !== Math.floor(cue.endFrame) || cue.endFrame <= cue.startFrame) throw new Error('Caption identities or frame timings are invalid.');
            ids[cue.id] = true;
            if (requireMedia && (!cue.path || !/\.mov$/i.test(cue.path) || !new File(cue.path).exists)) throw new Error('A rendered caption is missing. Render again.');
            var found = cue.clipNodeId ? findClip(s, cue.clipNodeId) : null;
            if (cue.clipNodeId && !found) throw new Error('A generated clip was removed. Pull timeline changes before applying.');
            if (found && nodes[String(found.clip.nodeId)]) throw new Error('Two captions refer to the same timeline clip.');
            var fragments = null, fragmentMotions = null, fragmentGeometryPlans = null;
            if (found) {
                nodes[String(found.clip.nodeId)] = true;
                if (!cue.projectItemId || !sameNode(found.clip.projectItem.nodeId, cue.projectItemId) || (cue.previousPath && found.clip.projectItem.getMediaPath() !== cue.previousPath)) throw new Error('A caption timeline link changed. Pull timeline changes before applying.');
                fragments = captionFragments(s, cue, cue.previousPath || found.clip.projectItem.getMediaPath(), found);
                if (!fragments && referenceCount(found.clip.projectItem.nodeId) !== 1) throw new Error('A caption media item is used by another timeline clip. Make that clip independent before updating captions.');
                if (fragments) {
                    assertFragmentRange(fragments, cue.startFrame, cue.endFrame - cue.startFrame, tpf);
                    fragmentMotions = [];
                    for (var f = 0; f < fragments.length; f++) {
                        var part = fragments[f];
                        if (!sameNode(part.clip.nodeId, found.clip.nodeId) && nodes[String(part.clip.nodeId)]) throw new Error('Two captions refer to the same native split bundle.');
                        nodes[String(part.clip.nodeId)] = true;
                        if (s.videoTracks[part.track].isLocked()) throw new Error('Unlock the native split caption video track before applying.');
                        fragmentMotions.push(motionState(part.clip));
                    }
                }
            }
            var trackIndex = found ? found.track : destination.trackIndex;
            if (!found) destination.newCaptionCount++;
            if (s.videoTracks[trackIndex] && s.videoTracks[trackIndex].isLocked()) throw new Error('Unlock video track ' + (trackIndex + 1) + ' before applying captions.');
            var geometry = null, bounds = null;
            if (cue.renderBounds || cue.motionProfile) {
                geometryFrames += cue.endFrame - cue.startFrame;
                if (geometryFrames > 100000) throw new Error('Apply caption box animation in smaller batches of at most 100000 frames.');
            }
            if (cue.renderBounds) {
                bounds = renderBounds(cue.renderBounds, s);
                if (fragments) {
                    fragmentGeometryPlans = [];
                    for (var g = 0; g < fragments.length; g++) fragmentGeometryPlans.push(geometryPlan(fragments[g].clip, cue, s, true));
                    geometry = fragmentGeometryPlans[0];
                } else if (found) geometry = geometryPlan(found.clip, cue, s);
            }
            if (found && cue.motionProfile) {
                if (typeof cue.motionProfile.signature !== 'string' || cue.endFrame - cue.startFrame > 100000 || (fragments ? fragmentProfile(fragments, cue.startFrame, cue.endFrame - cue.startFrame, tpf) : motionProfile(found.clip, cue.startFrame, cue.endFrame - cue.startFrame, tpf)).signature !== cue.motionProfile.signature) throw new Error('The caption box size or its keyframes changed during rendering. Wait for the adjustment to finish and apply again.');
            }
            var bundleReceipt = cue.captionBundle === true && found ? fragmentReceipt(fragments || [found]) : null;
            if (bundleReceipt && !fragments) {
                // An unsplit caption may deliberately change its range. The
                // final reference proof must confirm the authorized setTiming
                // result; native Razor cuts retain their original receipt.
                bundleReceipt[0].startTicks = String(Math.round(cue.startFrame * tpf));
                bundleReceipt[0].endTicks = String(Math.round(cue.endFrame * tpf));
                bundleReceipt[0].inTicks = '0';
                bundleReceipt[0].outTicks = String(Math.round((cue.endFrame - cue.startFrame) * tpf));
            }
            planned.push({ cue: cue, located: found, track: trackIndex, startFrame: cue.startFrame, endFrame: cue.endFrame, geometry: geometry, bounds: bounds, fragments: fragments, fragmentReceipt: fragments ? fragmentReceipt(fragments) : null, bundleReceipt: bundleReceipt, fragmentMotions: fragmentMotions, fragmentGeometry: fragmentGeometryPlans });
        }
        // Inspect every destination track and every desired range before importing or relinking anything.
        for (i = 0; i < planned.length; i++) {
            var target = planned[i], clips = s.videoTracks[target.track] ? s.videoTracks[target.track].clips : { numItems: 0 };
            for (j = 0; j < i; j++) if (target.track === planned[j].track && overlaps(target, planned[j])) throw new Error('Caption clips overlap after frame alignment. Adjust their timing.');
            for (j = 0; j < clips.numItems; j++) {
                var old = clips[j]; if (nodes[String(old.nodeId)]) continue;
                if (Number(old.start.ticks) < target.endFrame * tpf - 2 && Number(old.end.ticks) > target.startFrame * tpf + 2) throw new Error('Video track ' + (target.track + 1) + ' contains another clip in a caption range. Choose an empty track or adjust the caption timing.');
            }
        }
        if (p.track === -1 && !destination.newCaptionCount) { destination.mode = 'linked'; destination.trackIndex = null; }
        if (destination.mode === 'create' && destination.newCaptionCount && destination.expectedVideoTrackCount >= 256) throw new Error('The sequence already has 256 video tracks. Remove an unused track before creating a caption track.');
        return { sequence: s, ticksPerFrame: tpf, planned: planned, destination: destination };
    }
    function preflight(file) { try { var p = prepare(readPayload(file), false); return reply({ ok: true, count: p.planned.length, destination: p.destination }); } catch (e) { return reply({ error: e.toString() }); } }
    function prepareCaptionTrack(file) {
        try {
            var p = readPayload(file), prepared = prepare(p, true), destination = prepared.destination, seed = null;
            if (destination.mode === 'create') {
                var entry = null;
                for (var i = 0; i < prepared.planned.length; i++) if (!prepared.planned[i].located) { entry = prepared.planned[i]; break; }
                if (!entry) throw new Error('No new caption is available to create its video track.');
                var bin = null;
                for (i = 0; i < app.project.rootItem.children.numItems; i++) if (app.project.rootItem.children[i].type === 2 && app.project.rootItem.children[i].name === 'Better Captions') bin = app.project.rootItem.children[i];
                if (!bin) bin = app.project.rootItem.createBin('Better Captions');
                var item = findItem(bin, entry.cue.path);
                if (item && referenceCount(item.nodeId)) throw new Error('The temporary caption source is already used by a timeline clip. No new track was created.');
                if (!item) {
                    if (!app.project.importFiles([entry.cue.path], true, bin, false)) throw new Error('Premiere could not import the temporary caption source.');
                    item = findItem(bin, entry.cue.path);
                }
                if (!item || item.getMediaPath() !== entry.cue.path || referenceCount(item.nodeId)) throw new Error('The exact temporary caption source could not be confirmed.');
                var cue = entry.cue, tpf = prepared.ticksPerFrame;
                item.setInPoint(0, 1); item.setOutPoint((cue.endFrame - cue.startFrame) * tpf / TICKS, 1);
                seed = { id: cue.id, path: item.getMediaPath(), projectItemId: String(item.nodeId), startFrame: cue.startFrame, endFrame: cue.endFrame, startTicks: frameTime(cue.startFrame, tpf).ticks, endTicks: frameTime(cue.endFrame, tpf).ticks, durationTicks: frameTime(cue.endFrame - cue.startFrame, tpf).ticks };
            }
            return reply({ ok: true, sequenceId: p.sequenceId, projectPath: p.projectPath, ticksPerFrame: prepared.ticksPerFrame, destination: destination, seed: seed });
        } catch (e) { return reply({ error: e.toString() }); }
    }
    function apply(file) {
        var created = [], changed = [], results = [], rollbackErrors = [], p, prepared;
        try {
            p = readPayload(file); prepared = prepare(p, true);
            var s = prepared.sequence, planned = prepared.planned, tpf = prepared.ticksPerFrame, i, j;
            if (prepared.destination.mode === 'create') throw new Error('The automatic caption track must be created by the Better Captions UXP panel before applying. No timeline changes were made.');
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
                    clip = entry.located.clip;
                    if (entry.fragments) for (var f = 0; f < entry.fragments.length; f++) changed.push(snapshot(entry.fragments[f].clip, entry.fragmentMotions[f]));
                    else changed.push(snapshot(clip, entry.geometry ? entry.geometry.before : null));
                    if (item.getMediaPath() !== cue.path) {
                        var status = item.changeMediaPath(cue.path, true);
                        if (!(status === 0 || status === true) || item.getMediaPath() !== cue.path) throw new Error('Premiere could not update caption media.');
                        if (entry.geometry || entry.fragments) refreshCaptionMedia(item, cue.path);
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
                if (entry.fragments) {
                    verifyBundleReferences(s, entry);
                    for (f = 0; f < entry.fragments.length; f++) {
                        var fragment = entry.fragments[f].clip;
                        writeMotion(fragment, entry.fragmentGeometry ? entry.fragmentGeometry[f].target : entry.fragmentMotions[f]);
                        fragment.name = 'Better Captions | ' + String(cue.text || '').substring(0, 60);
                    }
                    if (stringify(fragmentReceipt(entry.fragments)) !== stringify(entry.fragmentReceipt)) throw new Error('Premiere changed native caption split timing while refreshing its media.');
                } else {
                    setTiming(clip, cue.startFrame, cue.endFrame, tpf);
                    if (entry.geometry) writeMotion(clip, entry.geometry.target);
                    else if (entry.bounds) initializeGeometry(clip, entry.bounds, s);
                    clip.name = 'Better Captions | ' + String(cue.text || '').substring(0, 60);
                    assertTiming(clip, cue, tpf);
                }
                if (item.getMediaPath() !== cue.path) throw new Error('Caption media readback did not match the rendered movie.');
                var result = { id: cue.id, clipNodeId: String(clip.nodeId), projectItemId: String(item.nodeId), start: entry.fragments ? entry.fragments[0].clip.start.seconds : clip.start.seconds, end: entry.fragments ? entry.fragments[entry.fragments.length - 1].clip.end.seconds : clip.end.seconds, track: entry.track, path: item.getMediaPath() };
                if (entry.fragments) result.bundleFragments = fragmentReceipt(entry.fragments);
                if (entry.bounds) { result.renderBounds = entry.bounds; result.motionProfile = entry.fragments ? fragmentProfile(entry.fragments, cue.startFrame, cue.endFrame - cue.startFrame, tpf) : motionProfile(clip, cue.startFrame, cue.endFrame - cue.startFrame, tpf); }
                results.push(result);
            }
            // Rediscover global references after every relink and native write.
            // Cached TrackItems alone cannot reveal a new external copy or cut.
            for (i = 0; i < planned.length; i++) verifyBundleReferences(s, planned[i]);
            return reply({ ok: true, cues: results });
        } catch (e) {
            // No ripple removals. Restore source geometry and the exact native
            // Motion key values when a later operation fails.
            for (var c = created.length - 1; c >= 0; c--) try {
                var removedNode = String(created[c].nodeId);
                created[c].remove(false, false);
                if (findClip(prepared.sequence, removedNode)) throw new Error('A new caption clip could not be removed during rollback.');
            } catch (removeError) { rollbackErrors.push(removeError.toString()); }
            for (var u = changed.length - 1; u >= 0; u--) try {
                var old = changed[u];
                if (old.item.getMediaPath() !== old.media) {
                    old.item.changeMediaPath(old.media, true);
                    if (old.item.getMediaPath() !== old.media) throw new Error('Premiere could not restore the previous caption source.');
                    if (old.motion) refreshCaptionMedia(old.item, old.media);
                }
                old.clip.inPoint = ticksTime(old.inPoint); old.clip.outPoint = ticksTime(old.outPoint); old.clip.start = ticksTime(old.start); old.clip.end = ticksTime(old.end); old.clip.name = old.name;
                if (old.motion) writeMotion(old.clip, old.motion);
                if (old.item.getMediaPath() !== old.media || old.clip.start.ticks !== old.start || old.clip.end.ticks !== old.end) throw new Error('A previous caption could not be fully restored.');
            } catch (restoreError) { rollbackErrors.push(restoreError.toString()); }
            return reply({ error: e.toString(), rolledBack: rollbackErrors.length === 0, rollbackErrors: rollbackErrors, recoveryJob: file, attemptedCreated: created.length, attemptedUpdated: changed.length });
        }
    }
    function readTimeline(file) {
        try {
            var p = readPayload(file), s = sequence(p.sequenceId, p.projectPath), out = [];
            if (!p.sequenceId || !p.projectPath || !(p.cues instanceof Array) || p.cues.length > 10000) throw new Error('Invalid caption timeline read.');
            var references = activeReferences(s), ids = {};
            for (var i = 0; i < p.cues.length; i++) {
                var cue = p.cues[i], found = null;
                if (!cue || typeof cue.id !== 'string' || !cue.id || ids['$' + cue.id]) throw new Error('Invalid caption timeline identities.');
                ids['$' + cue.id] = true;
                if (!cue.clipNodeId) { out.push({ id: cue.id, missing: true }); continue; }
                linkIdentity(cue);
                for (var r = 0; r < references.length; r++) if (references[r].video && references[r].clipNodeId === cue.clipNodeId) {
                    if (found) throw new Error('Premiere returned an ambiguous caption timeline link.');
                    found = references[r];
                }
                if (found) {
                    var fragments = null;
                    if (!sameNode(found.clip.projectItem.nodeId, cue.projectItemId)) throw new Error('A caption timeline link changed. Sync timing from Premiere before updating it.');
                    if (cue.captionBundle === true) {
                        if (!cue.projectItemId || !cue.mediaPath || !sameNode(found.clip.projectItem.nodeId, cue.projectItemId) || found.clip.projectItem.getMediaPath() !== cue.mediaPath) throw new Error('The caption bundle timeline link changed.');
                        fragments = captionFragments(s, cue, cue.mediaPath, found);
                    }
                    var result = { id: cue.id, clipNodeId: String(found.clip.nodeId), start: fragments ? fragments[0].clip.start.seconds : found.clip.start.seconds, end: fragments ? fragments[fragments.length - 1].clip.end.seconds : found.clip.end.seconds, track: found.track, projectItemId: String(found.clip.projectItem.nodeId), path: found.clip.projectItem.getMediaPath() };
                    if (fragments) result.bundleFragments = fragmentReceipt(fragments);
                    out.push(result);
                }
                else {
                    confirmAbsent(cue, references);
                    out.push({ id: cue.id, clipNodeId: cue.clipNodeId, projectItemId: cue.projectItemId, path: cue.mediaPath, missing: true });
                }
            }
            return reply({ ok: true, cues: out });
        } catch (e) { return reply({ error: e.toString() }); }
    }
    var nativeCaptionMatch = 'com.swen.bettercaptions.native.experimental', nativeCarrierBytes = 16777216;
    function nativeCaptionName(name) { return name === nativeCaptionMatch || name === 'AE.' + nativeCaptionMatch; }
    function connectionId(value) {
        if (value === undefined || value === null) throw new Error('Premiere did not expose a caption clip identity.');
        var text = String(value);
        if (!text || text.length > 256 || /[\u0000-\u001f]/.test(text)) throw new Error('Premiere returned an invalid caption clip identity.');
        return text;
    }
    function connectionCount(value, maximum) {
        if (typeof value !== 'number' || !isFinite(value) || value < 0 || value !== Math.floor(value) || value > maximum) throw new Error('Caption connection discovery exceeded a safe collection bound.');
        return value;
    }
    function connectionTiming(clip) {
        var out = {}, names = ['start', 'end', 'inPoint', 'outPoint'], keys = ['startTicks', 'endTicks', 'inTicks', 'outTicks'];
        for (var i = 0; i < names.length; i++) {
            var value = clip[names[i]], ticks = value && String(value.ticks);
            if (typeof ticks !== 'string' || !/^-?\d{1,21}$/.test(ticks) || !isFinite(Number(ticks)) || Math.abs(Number(ticks)) > 864000 * TICKS) throw new Error('Premiere returned invalid caption source timing.');
            out[keys[i]] = ticks;
        }
        if (Number(out.startTicks) < 0 || Number(out.endTicks) <= Number(out.startTicks) || Number(out.outTicks) <= Number(out.inTicks)) throw new Error('Premiere returned an invalid caption clip interval.');
        return out;
    }
    function boundedNativeCarrier(text) {
        if (typeof text !== 'string' || text.length <= 7 || text.length % 2 !== 1 || (text.length + 1) * 2 > nativeCarrierBytes || text.slice(0, 7) !== 'BCDOC1:') throw new Error('The native caption document is not a bounded BCDOC1 carrier.');
        for (var offset = 7; offset < text.length; offset += 16384) if (/[^0-9a-f]/.test(text.slice(offset, offset + 16384))) throw new Error('The native caption document contains invalid carrier bytes.');
        return text;
    }
    function nativeCreationId(value) {
        if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new Error('Use a fresh native caption creation identity.');
        return value;
    }
    function nativeInteger(value, minimum, maximum, label) {
        if (typeof value !== 'number' || !isFinite(value) || value !== Math.floor(value) || value < minimum || value > maximum) throw new Error('Invalid native caption ' + label + '.');
        return value;
    }
    var nativeMarkerNamespace = 'http://ns.adobe.com/premierePrivateProjectMetaData/1.0/', nativeMarkerField = 'BetterCaptionsNativeCarrier';
    function nativeMetadataReady() {
        if (typeof XMPMeta === 'undefined') {
            if (typeof ExternalObject === 'undefined') throw new Error('Premiere native caption metadata support is unavailable.');
            if (!ExternalObject.AdobeXMPScript) ExternalObject.AdobeXMPScript = new ExternalObject('lib:AdobeXMPScript');
        }
        if (typeof XMPMeta === 'undefined') throw new Error('Premiere could not load native caption metadata support.');
    }
    function nativeProjectMetadata(item) {
        nativeMetadataReady();
        if (!item || typeof item.getProjectMetadata !== 'function') throw new Error('Premiere did not expose native source project metadata.');
        var text = item.getProjectMetadata();
        if (typeof text !== 'string' || text.length > 1048576) throw new Error('Native source project metadata exceeds its read bound.');
        return new XMPMeta(text);
    }
    function nativeSourceMarker(item) {
        var xmp = nativeProjectMetadata(item), property = xmp.getProperty(nativeMarkerNamespace, nativeMarkerField);
        if (property === undefined || property === null) return '';
        var text = String(property);
        if (text.length > 4096) throw new Error('Native source ownership metadata exceeds its read bound.');
        return text;
    }
    function nativeWriteSourceMarker(item, marker, checkContext) {
        if (typeof app.project.addPropertyToProjectMetadataSchema !== 'function' || typeof item.setProjectMetadata !== 'function') throw new Error('Premiere cannot persist native source ownership.');
        var xmp = nativeProjectMetadata(item), existing = xmp.getProperty(nativeMarkerNamespace, nativeMarkerField);
        if (existing !== undefined && existing !== null && String(existing) !== '') throw new Error('A newly created native source already has ownership metadata.');
        // Generated media rejects setXMPMetadata. Premiere's project metadata
        // stores this single custom property without rewriting other fields.
        checkContext();
        app.project.addPropertyToProjectMetadataSchema(nativeMarkerField, 'Better Captions native carrier', 2);
        xmp.setProperty(nativeMarkerNamespace, nativeMarkerField, marker);
        var encoded = xmp.serialize();
        if (typeof encoded !== 'string' || encoded.length > 1048576) throw new Error('Native source ownership metadata exceeds its write bound.');
        checkContext();
        if (item.setProjectMetadata(encoded, [nativeMarkerField]) === false || nativeSourceMarker(item) !== marker) throw new Error('Premiere did not retain native source ownership.');
        checkContext();
    }
    function nativeMarker(text, item) {
        if (typeof text !== 'string' || !text || text.length > 4096) throw new Error('The generated native caption source has no bounded ownership marker.');
        var value = parseJSON(text), keys = ['version', 'owner', 'kind', 'projectItemId', 'creationId', 'width', 'height'], count = 0;
        if (!value || typeof value !== 'object' || value instanceof Array) throw new Error('Invalid native caption source marker.');
        for (var key in value) if (Object.prototype.hasOwnProperty.call(value, key)) {
            var allowed = false;
            for (var k = 0; k < keys.length; k++) if (key === keys[k]) allowed = true;
            if (!allowed) throw new Error('Unknown native caption source marker field.');
            count++;
        }
        if (count !== keys.length || value.version !== 1 || value.owner !== 'com.swen.bettercaptions' || value.kind !== 'transparent-video' || value.projectItemId !== connectionId(item.nodeId)) throw new Error('The generated native caption source identity changed.');
        var normalized = { version: 1, owner: 'com.swen.bettercaptions', kind: 'transparent-video', projectItemId: value.projectItemId,
            creationId: nativeCreationId(value.creationId), width: nativeInteger(value.width, 1, 16384, 'source width'), height: nativeInteger(value.height, 1, 16384, 'source height') };
        if (stringify(normalized) !== text) throw new Error('The native caption source marker is not canonical.');
        return normalized;
    }
    function nativeCaptionCarrier(clip) {
        if (typeof clip.isAdjustmentLayer !== 'function') throw new Error('Premiere did not expose the native caption carrier type.');
        var adjustment = clip.isAdjustmentLayer();
        if (adjustment === true) return null;
        var item = clip.projectItem;
        if (adjustment !== false || !item || item.type !== 1 || typeof item.getMediaPath !== 'function' || item.getMediaPath() !== '') throw new Error('Native captions require an adjustment layer or an owned Transparent Video source.');
        var marker = nativeSourceMarker(item);
        nativeMarker(marker, item);
        return { carrierKind: 'transparent-video', carrierItemId: connectionId(item.nodeId), carrierRevision: marker };
    }
    function nativeToggleValue(value, label) {
        if (typeof value === 'boolean') return value ? 1 : 0;
        if (typeof value !== 'number' || !isFinite(value) || value < 0 || value > 1) throw new Error((label || 'Native toggle') + ' must be between zero and one.');
        return value >= 0.5 ? 1 : 0;
    }
    // ComponentParam collection/name access crosses Premiere's native bridge.
    // Read each property/name once per checked context; never retain this table
    // between requests or across the preflight/mutation/readback checks.
    function nativePropertyTable(properties) {
        var count = connectionCount(properties && properties.numItems, 128), entries = [], names = [], byName = {};
        for (var p = 0; p < count; p++) {
            var param = properties[p], label = String(param.displayName), key = '$' + label;
            if (label.length > 1024) throw new Error('Native parameter names exceed the caption discovery bound.');
            entries.push(param); names.push(label);
            if (!Object.prototype.hasOwnProperty.call(byName, key)) byName[key] = [];
            byName[key].push(p);
        }
        return { entries: entries, names: names, byName: byName, count: count };
    }
    function nativePropertyIndex(table, label, ambiguous) {
        var key = '$' + label, indices = Object.prototype.hasOwnProperty.call(table.byName, key) ? table.byName[key] : null;
        if (!indices) return -1;
        if (indices.length !== 1) throw new Error(ambiguous);
        return indices[0];
    }
    // Script setters on the saved dimension streams do not reliably request
    // UPDATE_PARAMS_UI in Premiere. Mirror only our cosmetic, non-animated
    // dimension proxies after the authoritative stream has been verified.
    function nativeDimensionProxy(table, name) {
        if (name !== 'width' && name !== 'height') return null;
        var label = name === 'width' ? 'Width, px' : 'Height, px';
        var index = nativePropertyIndex(table, label, 'Ambiguous native dimension display controls.');
        if (index < 0) return null; // Older native builds have no proxy.
        var param = table.entries[index];
        if (!param || typeof param.getValue !== 'function' || typeof param.setValue !== 'function' || typeof param.isTimeVarying !== 'function' || param.isTimeVarying()) throw new Error('The native dimension display must be a non-animated UI control.');
        // Premiere reports keyframe capability for UI-only floats even with
        // CANNOT_TIME_VARY. Reject actual keys, rather than that capability bit.
        var keys = typeof param.getKeys === 'function' ? param.getKeys() : null;
        if (keys && (typeof keys.length !== 'number' || keys.length > 0)) throw new Error('The native dimension display must be a non-animated UI control.');
        return param;
    }
    function nativeSyncDimensionProxy(param, value) {
        if (!param) return;
        param.setValue(value, 1);
        var actual = param.getValue();
        if (typeof actual !== 'number' || !isFinite(actual) || Math.abs(actual - value) > 0.0001) throw new Error('Premiere did not confirm the native dimension display update.');
    }
    function nativeLineFitStates(table, sample) {
        var stateNames = ['current', 'spoken', 'upcoming'], topics = ['Current word', 'Previously spoken words', 'Upcoming words'];
        var labels = ['Size, %', 'Word bubble', 'Bubble padding, %'], values = [[], [], []], grouped = {}, topicSeen = {}, topicCount = 0, active = null, total = 0;
        for (var p = 0; p < table.count; p++) {
            var label = table.names[p];
            for (var t = 0; t < topics.length; t++) if (label === topics[t]) {
                active = stateNames[t];
                if (topicSeen[active]) throw new Error('Ambiguous native line fit word-state topics.');
                topicSeen[active] = true; topicCount++;
                grouped[active] = [null, null, null];
            }
            for (var f = 0; f < labels.length; f++) if (label === labels[f]) {
                total++; values[f].push(table.entries[p]);
                if (active !== null) {
                    if (grouped[active][f]) throw new Error('Ambiguous native line fit word-state controls.');
                    grouped[active][f] = table.entries[p];
                }
            }
        }
        var result = { upcoming: { sizeScale: 1, bubbleMode: 1, paddingScale: 1 }, current: { sizeScale: 1, bubbleMode: 1, paddingScale: 1 }, spoken: { sizeScale: 1, bubbleMode: 1, paddingScale: 1 } };
        // Old bounded carriers and test fixtures may have no word overrides.
        // Partial or duplicate state controls are unsafe to project as defaults.
        if (!total) return result;
        if (total !== 9 || values[0].length !== 3 || values[1].length !== 3 || values[2].length !== 3 || topicCount !== 0 && topicCount !== 3) throw new Error('Premiere did not expose complete native line fit word-state controls.');
        for (var s = 0; s < stateNames.length; s++) {
            var name = stateNames[s], params = [values[0][s], values[1][s], values[2][s]];
            if (topicCount) params = grouped[name];
            if (!params || !params[0] || !params[1] || !params[2]) throw new Error('Premiere did not expose each native line fit word-state control.');
            var size = sample(params[0]), bubble = sample(params[1]), padding = sample(params[2]);
            if (typeof size !== 'number' || !isFinite(size) || size < 1 || size > 400 || typeof padding !== 'number' || !isFinite(padding) || padding < 0 || padding > 400) throw new Error('Invalid native line fit word-state size or padding.');
            // Premiere ComponentParam exposes native popup entries zero-based;
            // the native renderer uses Document=1, On=2, Off=3.
            nativeInteger(bubble, 0, 2, 'word bubble mode');
            result[name] = { sizeScale: size / 100, bubbleMode: bubble + 1, paddingScale: padding / 100 };
        }
        return result;
    }
    function nativeDocumentFingerprint(text) {
        var hash = 2166136261, i, length = text.length;
        // FNV-1a with shift-add multiplication: products stay exact without Math.imul in ExtendScript.
        for (i = 0; i < length; i++) { hash ^= text.charCodeAt(i); hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0; }
        return length + ':' + hash.toString(16);
    }
    function nativeCaptionRecord(s, clip, trackIndex, clipIndex, componentIndex, includeDocument) {
        var carrier = nativeCaptionCarrier(clip);
        var components = clip.components, count = connectionCount(components && components.numItems, 128), names = [], nativeCount = 0;
        for (var c = 0; c < count; c++) {
            var name = String(components[c].matchName);
            if (name.length > 1024) throw new Error('Native component names exceed the caption discovery bound.');
            names.push(name); if (nativeCaptionName(name)) nativeCount++;
        }
        if (nativeCount !== 1 || componentIndex >= count || !nativeCaptionName(names[componentIndex])) throw new Error('Ambiguous native caption effect instances.');
        var table = nativePropertyTable(components[componentIndex].properties), documentIndex = nativePropertyIndex(table, 'Caption document (experimental)', 'Ambiguous native caption document parameters.');
        var documentParam = documentIndex < 0 ? null : table.entries[documentIndex];
        if (!documentParam || typeof documentParam.isTimeVarying !== 'function' || documentParam.isTimeVarying()) throw new Error('The native caption document parameter is missing or animated.');
        var timing = connectionTiming(clip), projectPath = String(app.project.path), sequenceId = String(s.sequenceID), clipNodeId = connectionId(clip.nodeId);
        var locator = { projectPath: projectPath, sequenceId: sequenceId, clipNodeId: clipNodeId, trackIndex: trackIndex, clipIndex: clipIndex, componentIndex: componentIndex, documentParamIndex: documentIndex };
        var selected = typeof clip.isSelected === 'function' && clip.isSelected() === true;
        var result = { kind: 'native-effect', clipNodeId: clipNodeId, projectItemId: connectionId(clip.projectItem && clip.projectItem.nodeId), trackIndex: trackIndex, clipIndex: clipIndex,
            startTicks: timing.startTicks, endTicks: timing.endTicks, inTicks: timing.inTicks, outTicks: timing.outTicks, selected: selected, disabled: clip.disabled === true, locator: locator, matchName: names[componentIndex] };
        // Read grouping independently of the embedded transcript. Scalar edits
        // in Effect Controls must refresh phrase rows without rewriting keys.
        var groupingIndex = nativePropertyIndex(table, 'Characters per line', 'Ambiguous native caption character limits.'), groupingParam = groupingIndex < 0 ? null : table.entries[groupingIndex];
        if (groupingParam && typeof groupingParam.isTimeVarying === 'function' && !groupingParam.isTimeVarying()) {
            var limit = groupingParam.getValue();
            if (typeof limit !== 'number' || !isFinite(limit) || limit !== Math.floor(limit) || limit < 1 || limit > 500) throw new Error('Invalid native caption character limit.');
            result.maxChars = limit;
        }
        // Line-fit metadata is sampled from effect settings, never a document rewrite.
        // The panel's line fit button measures these source-clock samples to pick a character limit.
        var sampleTimeline = nativeControlTicks(String(s.getPlayerPosition().ticks));
        function sampleGrouping(param) {
            if (typeof param.isTimeVarying !== 'function') throw new Error('Premiere did not expose a line fit control clock.');
            if (!param.isTimeVarying()) return param.getValue();
            assertNormalSpeed(clip);
            var sampleSource = timing.inTicks;
            if (nativeTickCompare(sampleTimeline, timing.startTicks) >= 0 && nativeTickCompare(sampleTimeline, timing.endTicks) < 0) sampleSource = nativeTickMath(nativeTickMath(sampleTimeline, timing.startTicks, true), timing.inTicks, false);
            if (typeof param.getValueAtTime !== 'function') throw new Error('Premiere did not expose animated line fit samples.');
            return param.getValueAtTime(ticksTime(sampleSource));
        }
        var fitLabels = ['Width', 'Global font size (64 = 1x)'], fitValues = [];
        for (var fl = 0; fl < fitLabels.length; fl++) {
            var fitIndex = nativePropertyIndex(table, fitLabels[fl], 'Ambiguous native line fit controls.'), fitParam = fitIndex < 0 ? null : table.entries[fitIndex];
            if (!fitParam) throw new Error('Premiere did not expose the native caption width or font size.');
            fitValues.push(sampleGrouping(fitParam));
        }
        result.lineFitWidth = nativeControlValue(fitValues[0], 'width');
        var fontSize = fitValues[1];
        if (typeof fontSize !== 'number' || !isFinite(fontSize) || fontSize < 1 || fontSize > 512) throw new Error('Invalid native caption font size.');
        result.lineFitFontScale = fontSize / 64;
        result.lineFitStates = nativeLineFitStates(table, sampleGrouping);
        if (nativeControlTicks(String(sequence(sequenceId, projectPath).getPlayerPosition().ticks)) !== sampleTimeline) throw new Error('The playhead moved while reading caption line fit. Read it again.');
        var connectionRevision = { locator: locator, timing: timing, components: names, documentIndex: documentIndex, selected: selected, lineFitWidth: result.lineFitWidth, lineFitFontScale: result.lineFitFontScale, lineFitStates: result.lineFitStates };
        // Premiere Undo/Redo of a transcript or style edit only changes the document text. Fingerprint it on
        // every poll so the panel re-reads and follows that change within one poll instead of its 30 s refresh.
        connectionRevision.documentFingerprint = nativeDocumentFingerprint(boundedNativeCarrier(documentParam.getValue()));
        // Panel document edits set this hidden float to a small "edit token" in a
        // named UXP undo step. Premiere Undo/Redo restores an earlier token and the
        // panel puts back that token's document (uxp/native-params.js). Tokens stay
        // far below the epoch-second guide leases, so they never draw the guide.
        var guideIndex = nativePropertyIndex(table, 'Layout editing guide', 'Ambiguous native layout guide.'), guideParam = guideIndex < 0 ? null : table.entries[guideIndex];
        if (guideParam && typeof guideParam.isTimeVarying === 'function' && !guideParam.isTimeVarying()) {
            var editToken = guideParam.getValue();
            if (typeof editToken === 'number' && isFinite(editToken)) { result.editToken = editToken; connectionRevision.editToken = editToken; }
        }
        if (carrier) {
            result.carrierKind = carrier.carrierKind; result.carrierItemId = carrier.carrierItemId; result.carrierRevision = carrier.carrierRevision;
            connectionRevision.carrierKind = carrier.carrierKind; connectionRevision.carrierItemId = carrier.carrierItemId; connectionRevision.carrierRevision = carrier.carrierRevision;
        }
        result.connectionRevision = stringify(connectionRevision);
        if (includeDocument) {
            var text = boundedNativeCarrier(documentParam.getValue());
            result.documentText = text;
            // Keep byte-identical ordering with the existing native CEP adapter.
            var revision = { projectPath: projectPath, sequenceId: sequenceId, clipNodeId: clipNodeId, adjustmentLayer: !carrier,
                start: timing.startTicks, end: timing.endTicks, inPoint: timing.inTicks, outPoint: timing.outTicks, components: names, documentIndex: documentIndex, documentText: text };
            if (carrier) { revision.carrierKind = carrier.carrierKind; revision.carrierItemId = carrier.carrierItemId; revision.carrierRevision = carrier.carrierRevision; }
            result.revision = stringify(revision);
        }
        return { record: result, param: documentParam, groupingParam: groupingParam, guideParam: guideParam, guideIndex: guideIndex, propertyTable: table };
    }
    function nativeProjectItems() {
        var result = [], seen = {};
        function visit(parent, depth) {
            if (depth > 32) throw new Error('The project bin hierarchy exceeds the native creation bound.');
            var children = parent && parent.children, count = connectionCount(children && children.numItems, 10000);
            for (var i = 0; i < count; i++) {
                if (result.length >= 10000) throw new Error('Native creation supports at most 10000 project items.');
                var item = children[i], id = connectionId(item && item.nodeId);
                if (seen['$' + id]) throw new Error('Premiere returned duplicate project item identities.');
                seen['$' + id] = true; result.push(item);
                if (item.type === 2) visit(item, depth + 1);
            }
        }
        visit(app.project.rootItem, 0);
        return { items: result, ids: seen };
    }
    function nativePreservation(s, ignoredClip, videoCount, audioCount) {
        var sets = [s.videoTracks, s.audioTracks], counts = [videoCount, audioCount], result = [], inspected = 0;
        for (var k = 0; k < sets.length; k++) {
            var tracks = sets[k], count = counts[k];
            if (connectionCount(tracks && tracks.numTracks, 256) < count) throw new Error('An existing native caption track disappeared.');
            var rows = [];
            for (var t = 0; t < count; t++) {
                var track = tracks[t], clips = track.clips, n = connectionCount(clips && clips.numItems, 2000), entries = [];
                inspected += n; if (inspected > 2000) throw new Error('Native creation supports at most 2000 existing clips.');
                if (typeof track.isLocked !== 'function') throw new Error('Premiere did not expose an existing track lock.');
                for (var c = 0; c < n; c++) {
                    var clip = clips[c], id = connectionId(clip && clip.nodeId);
                    if (id === ignoredClip) continue;
                    var item = clip.projectItem, components = clip.components, names = [], componentCount = 0;
                    if (!item || typeof item.getMediaPath !== 'function') throw new Error('Premiere did not expose every existing media identity.');
                    if (components) componentCount = connectionCount(components.numItems, 128);
                    for (var f = 0; f < componentCount; f++) names.push(String(components[f].matchName));
                    entries.push({ clipNodeId: id, projectItemId: connectionId(item.nodeId), path: item.getMediaPath(), name: clip.name,
                        timing: connectionTiming(clip), disabled: clip.disabled, components: names });
                }
                rows.push({ name: track.name, locked: track.isLocked(), muted: typeof track.isMuted === 'function' && track.isMuted(), clips: entries });
            }
            result.push(rows);
        }
        return stringify(result);
    }
    function nativeGeometry(value) {
        if (!value || typeof value !== 'object' || !(value.position instanceof Array) || value.position.length !== 2) throw new Error('Invalid native caption geometry.');
        for (var i = 0; i < 2; i++) if (typeof value.position[i] !== 'number' || !isFinite(value.position[i]) || value.position[i] < 0 || value.position[i] > 1) throw new Error('Native caption position must be normalized to the video frame.');
        var names = ['width', 'height'];
        for (i = 0; i < names.length; i++) if (typeof value[names[i]] !== 'number' || !isFinite(value[names[i]]) || value[names[i]] < 1 || value[names[i]] > 8192) throw new Error('Native caption dimensions must be between 1 and 8192 pixels.');
        nativeInteger(value.maxChars, 1, 500, 'character limit');
        return value;
    }
    function nativeNewEffectIndex(clip) {
        var components = clip.components, count = connectionCount(components && components.numItems, 128), found = -1;
        for (var i = 0; i < count; i++) if (nativeCaptionName(String(components[i].matchName))) {
            if (found !== -1) throw new Error('Premiere added ambiguous native caption effect instances.');
            found = i;
        }
        if (found === -1) throw new Error('Premiere did not expose the newly added native caption effect.');
        return found;
    }
    function nativeNewParameters(clip, index) {
        var names = ['Position', 'Width', 'Height', 'Characters per line', 'Caption document (experimental)'], found = [], properties = clip.components[index].properties;
        var count = connectionCount(properties && properties.numItems, 128);
        for (var n = 0; n < names.length; n++) {
            var param = null;
            for (var p = 0; p < count; p++) if (String(properties[p].displayName) === names[n]) {
                if (param) throw new Error('Premiere exposed duplicate native caption controls.');
                param = properties[p];
            }
            if (!param || typeof param.getValue !== 'function' || typeof param.setValue !== 'function' || typeof param.isTimeVarying !== 'function' || param.isTimeVarying()) throw new Error('A new native caption control is missing or animated.');
            found.push(param);
        }
        return found;
    }
    var nativeCreationAttempts = {}, nativeCreationAttemptCount = 0;
    function createNativeCaptionDocument(file) {
        var attempted = false, stage = 'preflight', created = { projectItemId: null, clipNodeId: null, trackIndex: null, createdTrack: false, creationId: null };
        try {
            var p = readPayload(file);
            if (!p || p.version !== 1 || typeof p.sequenceId !== 'string' || !p.sequenceId || !localMediaPath(p.projectPath) || p.startFrame !== 0 || p.sourceInTicks !== '0') throw new Error('Invalid native caption creation context or source origin.');
            created.creationId = nativeCreationId(p.creationId);
            boundedNativeCarrier(p.documentText);
            nativeInteger(p.width, 1, 16384, 'frame width'); nativeInteger(p.height, 1, 16384, 'frame height');
            nativeInteger(p.endFrame, 1, 1000000, 'duration'); nativeInteger(p.expectedVideoTrackCount, 0, 256, 'track count');
            var geometry = nativeGeometry(p.geometry), s = sequence(p.sequenceId, p.projectPath), tpf = Number(s.timebase), durationTicks = p.endFrame * tpf;
            if (typeof p.ticksPerFrame !== 'string' || !/^\d{1,15}$/.test(p.ticksPerFrame) || p.ticksPerFrame !== String(s.timebase) || !isFinite(tpf) || tpf <= 0 || tpf !== Math.floor(tpf) || durationTicks > 9007199254740991 || durationTicks !== Math.floor(durationTicks) || s.frameSizeHorizontal !== p.width || s.frameSizeVertical !== p.height) throw new Error('Sequence dimensions or frame rate changed before native creation.');
            var videoCount = connectionCount(s.videoTracks.numTracks, 256), audioCount = connectionCount(s.audioTracks.numTracks, 256);
            if (videoCount !== p.expectedVideoTrackCount) throw new Error('The native caption destination changed. Refresh before creating.');
            var destination = captionDestination(s, -1);
            if (destination.mode === 'create' && videoCount >= 256) throw new Error('There is no room for another native caption video track.');
            var attemptKey = '$' + p.projectPath + '|' + p.creationId;
            if (nativeCreationAttempts[attemptKey] || nativeCreationAttemptCount >= 1000) throw new Error('This native caption creation cannot be retried automatically. Inspect the project first.');
            nativeMetadataReady();
            if (typeof app.project.addPropertyToProjectMetadataSchema !== 'function' || typeof Time === 'undefined') throw new Error('Premiere cannot prepare persistent native caption metadata and timing.');
            var beforeItems = nativeProjectItems(), i;
            for (i = 0; i < beforeItems.items.length; i++) {
                var oldItem = beforeItems.items[i];
                if (oldItem.type === 1 && typeof oldItem.getMediaPath === 'function' && oldItem.getMediaPath() === '') {
                    var oldMarker = nativeSourceMarker(oldItem);
                    if (oldMarker && nativeMarker(oldMarker, oldItem).creationId === p.creationId) throw new Error('This native caption source already exists. Reconnect instead of creating again.');
                }
            }
            var preservation = nativePreservation(s, null, videoCount, audioCount);
            var expectedCount = videoCount;
            function checkContext() {
                var current = sequence(p.sequenceId, p.projectPath);
                if (String(current.timebase) !== p.ticksPerFrame || current.frameSizeHorizontal !== p.width || current.frameSizeVertical !== p.height || current.videoTracks.numTracks !== expectedCount || current.audioTracks.numTracks !== audioCount) throw new Error('The native caption sequence configuration changed.');
            }
            function checkOwnedClip() {
                checkContext();
                var currentTrack = s.videoTracks[created.trackIndex];
                if (!currentTrack || currentTrack.isLocked() || typeof currentTrack.isMuted === 'function' && currentTrack.isMuted() || currentTrack.clips.numItems !== 1) throw new Error('The owned native caption destination changed.');
                var currentClip = currentTrack.clips[0];
                if (connectionId(currentClip.nodeId) !== created.clipNodeId || !currentClip.projectItem || connectionId(currentClip.projectItem.nodeId) !== created.projectItemId || nativeCaptionCarrier(currentClip).carrierRevision !== marker) throw new Error('The owned native caption clip identity changed.');
                var currentTiming = connectionTiming(currentClip);
                if (currentTiming.startTicks !== '0' || currentTiming.inTicks !== '0' || currentTiming.endTicks !== endTicks || currentTiming.outTicks !== endTicks) throw new Error('The owned native caption clip timing changed.');
                if (nativePreservation(s, created.clipNodeId, videoCount, audioCount) !== preservation) throw new Error('Existing clips changed during native caption creation.');
                checkContext();
            }
            if (typeof app.enableQE !== 'function') throw new Error('Premiere does not expose native caption source creation.');
            app.enableQE();
            if (typeof qe === 'undefined' || !qe.project || typeof qe.project.newTransparentVideo !== 'function' || typeof qe.project.getActiveSequence !== 'function' || typeof qe.project.getVideoEffectByName !== 'function') throw new Error('Premiere does not expose the required native source APIs.');
            var q = qe.project.getActiveSequence(), effect = qe.project.getVideoEffectByName('S-Captions') || qe.project.getVideoEffectByName('Better Captions Native Probe');
            if (!q || !effect || typeof q.getVideoTrackAt !== 'function' || destination.mode === 'create' && typeof q.addTracks !== 'function') throw new Error('The native caption effect or destination API is unavailable.');
            checkContext();
            attempted = true; nativeCreationAttempts[attemptKey] = true; nativeCreationAttemptCount++; stage = 'source creation';
            var factoryResult = qe.project.newTransparentVideo(p.width, p.height, 0, 1, 1), afterItems = nativeProjectItems(), added = [];
            for (i = 0; i < afterItems.items.length; i++) if (!beforeItems.ids['$' + connectionId(afterItems.items[i].nodeId)]) added.push(afterItems.items[i]);
            if (added.length === 1) created.projectItemId = connectionId(added[0].nodeId);
            if (factoryResult !== true || added.length !== 1 || afterItems.items.length !== beforeItems.items.length + 1) throw new Error('Premiere did not identify exactly one newly generated caption source.');
            for (i = 0; i < beforeItems.items.length; i++) if (!afterItems.ids['$' + connectionId(beforeItems.items[i].nodeId)]) throw new Error('An existing project item changed during native source creation.');
            var item = added[0];
            if (item.type !== 1 || typeof item.getMediaPath !== 'function' || item.getMediaPath() !== '' || typeof item.setInPoint !== 'function' || typeof item.setOutPoint !== 'function') throw new Error('The new native caption source is not an eligible generated item.');
            if (nativePreservation(sequence(p.sequenceId, p.projectPath), null, videoCount, audioCount) !== preservation) throw new Error('Existing timeline clips changed during source creation.');
            checkContext();
            stage = 'source ownership';
            var marker = stringify({ version: 1, owner: 'com.swen.bettercaptions', kind: 'transparent-video', projectItemId: created.projectItemId, creationId: p.creationId, width: p.width, height: p.height });
            nativeWriteSourceMarker(item, marker, checkContext);
            if (nativeSourceMarker(item) !== marker) throw new Error('Premiere did not retain the generated caption ownership marker.');
            nativeMarker(marker, item);
            checkContext(); item.setInPoint(0, 4);
            checkContext(); item.setOutPoint(durationTicks / TICKS, 4);
            stage = 'destination preparation';
            checkContext();
            if (destination.mode === 'create') {
                q = qe.project.getActiveSequence(); checkContext();
                if (!q || typeof q.addTracks !== 'function') throw new Error('The native caption track creation API changed.');
                q.addTracks(1, videoCount, 0, audioCount, 1, 0, 0);
                created.createdTrack = true;
                expectedCount++;
            }
            checkContext();
            if (s.videoTracks.numTracks !== expectedCount || s.audioTracks.numTracks !== audioCount || nativePreservation(s, null, videoCount, audioCount) !== preservation) throw new Error('Premiere did not preserve the existing tracks while preparing native captions.');
            var trackIndex = destination.trackIndex, track = s.videoTracks[trackIndex];
            created.trackIndex = trackIndex;
            if (!track || typeof track.isLocked !== 'function' || track.isLocked() || typeof track.isMuted === 'function' && track.isMuted() || connectionCount(track.clips && track.clips.numItems, 2000) !== 0 || typeof track.overwriteClip !== 'function') throw new Error('The native caption destination is not an empty enabled top track.');
            stage = 'clip insertion';
            checkContext();
            track.overwriteClip(item, 0);
            checkContext();
            if (connectionCount(track.clips.numItems, 2000) !== 1) throw new Error('Premiere did not expose exactly one new caption clip.');
            var clip = track.clips[0];
            if (!clip || !clip.projectItem || connectionId(clip.projectItem.nodeId) !== created.projectItemId) throw new Error('Premiere inserted an unexpected caption source.');
            created.clipNodeId = connectionId(clip.nodeId);
            setTiming(clip, 0, p.endFrame, tpf);
            var timing = connectionTiming(clip), endTicks = String(durationTicks);
            if (timing.startTicks !== '0' || timing.inTicks !== '0' || timing.endTicks !== endTicks || timing.outTicks !== endTicks) throw new Error('Premiere did not retain exact zero-origin caption timing.');
            if (nativeCaptionCarrier(clip).carrierRevision !== marker || nativePreservation(s, created.clipNodeId, videoCount, audioCount) !== preservation) throw new Error('Premiere did not preserve the native caption source and existing clips.');
            stage = 'effect insertion';
            q = qe.project.getActiveSequence();
            var qTrack = q && q.getVideoTrackAt(trackIndex), qCount = connectionCount(qTrack && qTrack.numItems, 2000), qClip = null;
            if (!qTrack || typeof qTrack.getItemAt !== 'function') throw new Error('Premiere did not expose the new effect destination.');
            for (i = 0; i < qCount; i++) {
                var candidate = qTrack.getItemAt(i);
                if (candidate && candidate.type === 'Clip') {
                    if (qClip || !candidate.start || !candidate.end || String(candidate.start.ticks) !== '0' || String(candidate.end.ticks) !== endTicks) throw new Error('Premiere exposed an ambiguous native effect destination.');
                    qClip = candidate;
                }
            }
            if (!qClip || typeof qClip.addVideoEffect !== 'function') throw new Error('Premiere did not expose a unique native effect destination.');
            checkOwnedClip();
            qClip.addVideoEffect(effect);
            checkOwnedClip();
            var componentIndex = nativeNewEffectIndex(clip), params = nativeNewParameters(clip, componentIndex), values = [geometry.position, geometry.width, geometry.height, geometry.maxChars, p.documentText];
            var displayTable = nativePropertyTable(clip.components[componentIndex].properties), widthDisplay = nativeDimensionProxy(displayTable, 'width'), heightDisplay = nativeDimensionProxy(displayTable, 'height');
            stage = 'document and geometry';
            for (i = 0; i < params.length; i++) { checkOwnedClip(); params[i].setValue(values[i], 1); }
            for (i = 0; i < params.length; i++) {
                var actual = params[i].getValue();
                if (i === 0) {
                    if (!actual || actual.length !== 2 || typeof actual[0] !== 'number' || typeof actual[1] !== 'number' || !isFinite(actual[0]) || !isFinite(actual[1]) || Math.abs(actual[0] - geometry.position[0]) > 0.000001 || Math.abs(actual[1] - geometry.position[1]) > 0.000001) throw new Error('Premiere did not retain the native caption position.');
                } else if (actual !== values[i]) throw new Error('Premiere did not retain a native caption document or dimension.');
            }
            checkOwnedClip(); nativeSyncDimensionProxy(widthDisplay, geometry.width);
            checkOwnedClip(); nativeSyncDimensionProxy(heightDisplay, geometry.height);
            if (!sameValue(params[1].getValue(), geometry.width) || !sameValue(params[2].getValue(), geometry.height)) throw new Error('Native display synchronization changed caption dimensions.');
            stage = 'final verification';
            sequence(p.sequenceId, p.projectPath);
            if (s.videoTracks.numTracks !== expectedCount || s.audioTracks.numTracks !== audioCount || track.clips.numItems !== 1 || connectionId(track.clips[0].nodeId) !== created.clipNodeId || nativePreservation(s, created.clipNodeId, videoCount, audioCount) !== preservation) throw new Error('The native caption creation could not confirm preservation of the existing timeline.');
            var connection = nativeCaptionRecord(s, track.clips[0], trackIndex, 0, componentIndex, true).record;
            if (connection.startTicks !== '0' || connection.inTicks !== '0' || connection.endTicks !== endTicks || connection.outTicks !== endTicks || connection.documentText !== p.documentText || connection.carrierRevision !== marker) throw new Error('The created native caption connection readback changed.');
            checkContext();
            if (connection.locator.projectPath !== p.projectPath || !sameSequenceId(connection.locator.sequenceId, p.sequenceId)) throw new Error('The created native caption connection context changed.');
            return reply({ ok: true, connection: connection, created: created, readbackVerified: true, renderVerified: false, retry: 'never' });
        } catch (e) {
            if (attempted) return reply({ error: 'Premiere did not confirm native caption creation during ' + stage + '. Inspect the owned source and clip before another creation.', code: 'BC_OUTPUT_UNCONFIRMED', recoverable: false, outputApplied: false, retry: 'never', created: created });
            return reply({ error: e.toString(), retry: 'never' });
        }
    }
    function knownConnectionLinks(value) {
        if (!(value instanceof Array) || value.length > 10000) throw new Error('Invalid saved caption connection links.');
        var items = {}, paths = {}, ids = {};
        for (var i = 0; i < value.length; i++) {
            var link = value[i];
            if (!link || typeof link.id !== 'string' || !link.id || link.id.length > 256 || ids['$' + link.id] || !localMediaPath(link.mediaPath)) throw new Error('Invalid saved caption connection identity.');
            ids['$' + link.id] = true;
            var itemId = connectionId(link.projectItemId), path = comparableMediaPath(link.mediaPath);
            if (items['$' + itemId] !== undefined && items['$' + itemId] !== path || paths['$' + path] !== undefined && paths['$' + path] !== itemId) throw new Error('Saved caption media identities are ambiguous.');
            items['$' + itemId] = path; paths['$' + path] = itemId;
        }
        return { items: items, paths: paths };
    }
    function generatedConnectionPath(path, root) {
        if (!localMediaPath(path)) return false;
        var candidate = comparableMediaPath(path).split('\\').join('/'), base = comparableMediaPath(root).split('\\').join('/');
        if (base.charAt(base.length - 1) === '/') base = base.slice(0, -1);
        if (candidate.slice(0, base.length + 1) !== base + '/') return false;
        var parts = candidate.slice(base.length + 1).split('/');
        return parts.length === 2 && /^caption-[a-zA-Z0-9_-]{1,200}$/.test(parts[0]) && parts[1] === 'caption.mov';
    }
    function readCaptionConnections(file) {
        try {
            var p = readPayload(file);
            if (typeof p.sequenceId !== 'string' || !p.sequenceId || !localMediaPath(p.projectPath) || !localMediaPath(p.generatedRoot) || typeof p.includeDocuments !== 'boolean') throw new Error('Invalid caption discovery context.');
            var known = knownConnectionLinks(p.knownLinks), s = sequence(p.sequenceId, p.projectPath), tracks = s.videoTracks;
            var trackCount = connectionCount(tracks && tracks.numTracks, 256), nativeEntries = [], legacy = [], selected = [], warnings = [], inspected = 0, componentsSeen = 0, textBudget = 0, seenNodes = {};
            for (var t = 0; t < trackCount; t++) {
                var clips = tracks[t].clips, clipCount = connectionCount(clips && clips.numItems, 2000);
                inspected += clipCount; if (inspected > 2000) throw new Error('Caption discovery supports at most 2000 video clips.');
                for (var c = 0; c < clipCount; c++) {
                    var clip = clips[c];
                    if (!clip) throw new Error('Premiere could not inspect every video clip for caption connections.');
                    var node = connectionId(clip.nodeId);
                    if (seenNodes['$' + node]) throw new Error('Premiere returned duplicate caption clip identities.');
                    seenNodes['$' + node] = true;
                    var isSelected = typeof clip.isSelected === 'function' && clip.isSelected() === true;
                    if (isSelected) selected.push(node);
                    var item = clip.projectItem, itemId = item ? connectionId(item.nodeId) : null, path = item && typeof item.getMediaPath === 'function' ? item.getMediaPath() : '', normalized = localMediaPath(path) ? comparableMediaPath(path) : null, matched = false;
                    var expectedPath = known.items['$' + itemId], expectedItem = normalized === null ? undefined : known.paths['$' + normalized];
                    if (expectedPath !== undefined && expectedPath !== normalized || expectedItem !== undefined && expectedItem !== itemId) throw new Error('A saved caption media identity changed. Automatic reconnection was refused.');
                    matched = expectedPath !== undefined && expectedPath === normalized;
                    if (matched || generatedConnectionPath(path, p.generatedRoot)) {
                        var timing = connectionTiming(clip);
                        legacy.push({ kind: 'generated-movie', clipNodeId: node, projectItemId: itemId, path: path, trackIndex: t, clipIndex: c,
                            startTime: Number(timing.startTicks) / TICKS, endTime: Number(timing.endTicks) / TICKS, startTicks: timing.startTicks, endTicks: timing.endTicks, inTicks: timing.inTicks, outTicks: timing.outTicks, selected: isSelected, disabled: clip.disabled === true });
                    }
                    var components = clip.components;
                    if (!components) continue;
                    var componentCount = connectionCount(components.numItems, 128), nativeIndex = -1;
                    componentsSeen += componentCount; if (componentsSeen > 20000) throw new Error('Caption discovery exceeded its component scan bound.');
                    for (var n = 0; n < componentCount; n++) if (nativeCaptionName(String(components[n].matchName))) { nativeIndex = n; break; }
                    if (nativeIndex !== -1) {
                        if (nativeEntries.length >= 64) throw new Error('Caption discovery supports at most 64 native containers.');
                        try {
                            var discovered = nativeCaptionRecord(s, clip, t, c, nativeIndex, p.includeDocuments).record;
                            textBudget += (discovered.documentText || '').length + (discovered.revision || '').length;
                            if (textBudget > 25165824) throw new Error('Native caption documents exceed the aggregate discovery budget.');
                            nativeEntries.push(discovered);
                        } catch (nativeError) {
                            if (warnings.length < 64) warnings.push('Native caption at video track ' + (t + 1) + ', clip ' + (c + 1) + ' could not be verified.');
                        }
                    }
                }
            }
            var position = s.getPlayerPosition(), ticks = position && String(position.ticks), seconds = Number(ticks) / TICKS;
            if (typeof ticks !== 'string' || !/^\d{1,21}$/.test(ticks) || !isFinite(seconds) || seconds < 0) throw new Error('Premiere did not expose its playhead during caption discovery.');
            sequence(p.sequenceId, p.projectPath);
            var response = reply({ ok: true, version: 1, readOnly: true, projectPath: String(app.project.path), sequenceId: p.sequenceId, nativeSequenceId: String(s.sequenceID), playhead: seconds, playheadTicks: ticks, selectedClipNodeIds: selected, "native": nativeEntries, legacy: legacy, warnings: warnings, undoIndex: nativeUndoIndex() });
            if (response.length > 29360128) throw new Error('Caption connection response exceeds the bounded transport size.');
            return response;
        } catch (e) { return reply({ error: e.toString() }); }
    }
    // Geometry lives on the owned native effect, independently of BCDOC.
    // Premiere ComponentParam keys are clip-source times, matching Motion's
    // verified source clock. Map the captured timeline position through the
    // 1x clip in point; do not seek, retime, recreate keys, or change animation.
    function nativeControlTicks(value) {
        if (typeof value !== 'string' || !/^(0|[1-9]\d{0,20})$/.test(value)) throw new Error('Invalid native caption control time.');
        return value;
    }
    function nativeTickCompare(a, b) { if (a.length !== b.length) return a.length < b.length ? -1 : 1; if (a === b) return 0; return a < b ? -1 : 1; }
    function nativeTickMath(a, b, subtract) {
        // Exact decimal arithmetic avoids losing source ticks above 2^53.
        var out = '', carry = 0, i = a.length - 1, j = b.length - 1;
        if (subtract && nativeTickCompare(a, b) < 0) throw new Error('The playhead is outside the native caption clip.');
        while (i >= 0 || j >= 0) {
            var n = (i >= 0 ? Number(a.charAt(i--)) : 0) + (subtract ? -1 : 1) * (j >= 0 ? Number(b.charAt(j--)) : 0) + carry;
            if (subtract) { carry = n < 0 ? -1 : 0; if (n < 0) n += 10; }
            else { carry = Math.floor(n / 10); n %= 10; }
            out = String(n) + out;
        }
        if (!subtract && carry) out = String(carry) + out;
        return nativeControlTicks(out.replace(/^0+(?=\d)/, ''));
    }
    var nativeRollUpNames = ['rollUp', 'rollUpLines', 'rollUpDuration', 'rollUpFade', 'rollUpFadePosition', 'rollUpFadeThickness', 'rollUpFadeAmount', 'rollUpFadeCurve', 'rollUpDirection', 'rollUpSpeed', 'rollUpWait', 'rollUpTransition', 'rollUpCurrentLine', 'rollUpBlankLineSeconds'];
    var nativeRollUpLabels = ['Roll-up enabled', 'Visible lines', 'Scroll duration', 'Soft fade boundary', 'Boundary position', 'Transition thickness', 'Fade amount', 'Transition curve', 'Scroll direction', 'Scroll speed', 'Wait for line to finish', 'Line transition', 'Current line position', 'Pause Line Length'];
    var nativeRollUpDefaults = [0, 2, 0.18, 1, 0, 0.35, 1, 2, 1, 1, 1, 1, 1, 0];
    function nativeRollUpIndex(name) { for (var i = 0; i < nativeRollUpNames.length; i++) if (nativeRollUpNames[i] === name) return i; return -1; }
    // Native popup streams expose zero-based values to CEP. Keep the panel's
    // named choices one-based, matching the existing scrolling controls.
    var nativeBoundaryNames = ['boundaryMode'], nativeBoundaryLabels = ['Boundary mode'], nativeBoundaryDefaults = [1];
    var nativeBoundarySides = ['Top', 'Bottom', 'Left', 'Right'];
    var nativeBoundaryFields = ['Inset', 'Fade', 'Width', 'Amount', 'Curve'];
    var nativeBoundaryFieldLabels = ['Inset, %', 'Fade enabled', 'Fade width, %', 'Fade amount, %', 'Fade curve'];
    for (var bs = 0; bs < nativeBoundarySides.length; bs++) for (var bf = 0; bf < nativeBoundaryFields.length; bf++) {
        nativeBoundaryNames.push('boundary' + nativeBoundarySides[bs] + nativeBoundaryFields[bf]);
        nativeBoundaryLabels.push(nativeBoundarySides[bs] + ' ' + nativeBoundaryFieldLabels[bf]);
        nativeBoundaryDefaults.push([0, 1, 20, 100, 2][bf]);
    }
    function nativeBoundaryIndex(name) { for (var i = 0; i < nativeBoundaryNames.length; i++) if (nativeBoundaryNames[i] === name) return i; return -1; }
    function nativeBoundaryPropertyIndex(table, name) {
        var boundaryIndex = nativeBoundaryIndex(name);
        if (boundaryIndex === 0) return nativePropertyIndex(table, 'Boundary mode', 'Ambiguous native boundary mode.');
        var side = Math.floor((boundaryIndex - 1) / 5), field = (boundaryIndex - 1) % 5;
        var group = nativePropertyIndex(table, nativeBoundarySides[side], 'Ambiguous native boundary edge group.');
        if (group < 0) return -1;
        // Repeated Inset/Fade labels are resolved only inside the discovered
        // named edge group, never by a saved registration index.
        for (var f = 0; f < 5; f++) if (table.names[group + 1 + f] !== nativeBoundaryFieldLabels[f] && !(f === 1 && table.names[group + 1 + f] === '')) throw new Error('Native boundary edge controls changed. Update the native caption effect.');
        return group + 1 + field;
    }
    function nativeBoundaryPopup(name) {
        // Explicit branches are required by Premiere's ExtendScript runtime:
        // a compound boolean expression misclassified the zero-index mode.
        var index = nativeBoundaryIndex(name);
        if (index === 0) return true;
        if (index < 1) return false;
        var field = (index - 1) % 5;
        return field === 4;
    }
    function nativeControlFromHost(value, name) {
        var index = nativeBoundaryIndex(name);
        if (index > 0 && (index - 1) % 5 === 1 && typeof value === 'boolean') value = value ? 1 : 0;
        return nativeControlValue(nativeBoundaryPopup(name) ? value + 1 : value, name);
    }
    function nativeControlToHost(value, name) { return nativeBoundaryPopup(name) ? value - 1 : value; }
    function nativeKnownControl(name) { return name === 'position' || name === 'width' || name === 'height' || name === 'groups' || name === 'alignment' || nativeRollUpIndex(name) >= 0 || nativeBoundaryIndex(name) >= 0; }
    function nativeControlValue(value, name) {
        if (name === 'position') {
            var point = motionVector(value, 'native Position');
            if (Math.abs(point[0]) > 100 || Math.abs(point[1]) > 100) throw new Error('Native Position is outside supported bounds.');
            return point;
        }
        var boundaryIndex = nativeBoundaryIndex(name);
        if (boundaryIndex >= 0) {
            var field = boundaryIndex === 0 ? -1 : (boundaryIndex - 1) % 5;
            if (typeof value !== 'number' || !isFinite(value)) throw new Error('Invalid native boundary value.');
            if (field === 1) { if (value !== 0 && value !== 1) throw new Error('Boundary fade must be zero or one.'); }
            else if (field === -1 || field === 4) { if (value !== Math.floor(value) || value < 1 || value > (field === -1 ? 2 : 4)) throw new Error('Invalid native boundary choice.'); }
            else if (value < 0 || value > 100) throw new Error('Boundary percentages must be between zero and 100.');
            return value;
        }
        var rollIndex = nativeRollUpIndex(name);
        if (rollIndex >= 0) {
            if (rollIndex === 0 || rollIndex === 3 || rollIndex === 10) return nativeToggleValue(value, nativeRollUpLabels[rollIndex]);
            var minimum = 0, maximum = 1;
            if (rollIndex === 1 || name === 'rollUpCurrentLine') { minimum = 1; maximum = 8; }
            else if (name === 'rollUpBlankLineSeconds') maximum = 30;
            else if (rollIndex === 2) maximum = 2;
            else if (rollIndex === 7 || rollIndex === 8 || rollIndex === 11) { minimum = 1; maximum = 4; }
            else if (rollIndex === 9) { minimum = 0.1; maximum = 10; }
            if (typeof value !== 'number' || !isFinite(value) || value < minimum || value > maximum) throw new Error('Invalid native ' + nativeRollUpLabels[rollIndex] + ' value.');
            return name === 'rollUpCurrentLine' || rollIndex === 1 || rollIndex === 7 || rollIndex === 8 || rollIndex === 11 ? Math.round(value) : value;
        }
        if (name === 'alignment') {
            if (typeof value !== 'number' || !isFinite(value) || value < 1 || value > 3) throw new Error('Text alignment must be between one and three.');
            return Math.round(value);
        }
        if (name === 'groups') {
            nativeInteger(value, 1, 100, 'Groups per page'); return value;
        }
        if (typeof value !== 'number' || !isFinite(value) || value < 1 || value > 8192) throw new Error('Native caption dimensions must be between 1 and 8192 pixels.');
        return value;
    }
    function nativeControlSequence(p) {
        var s = sequence(p.sequenceId, p.projectPath);
        if (p.expectedSequenceSettings) {
            var settings = p.expectedSequenceSettings;
            if (typeof settings.width !== 'number' || typeof settings.height !== 'number' || typeof settings.fps !== 'number' || !isFinite(settings.fps) ||
                s.frameSizeHorizontal !== settings.width || s.frameSizeVertical !== settings.height || Math.abs(TICKS / Number(s.timebase) - settings.fps) > 0.000001) throw new Error('The Premiere project or sequence settings changed. Refresh Better Captions.');
        }
        return s;
    }
    function nativeControlContext(p) {
        var snapshot = p.snapshot, target = snapshot && snapshot.locator;
        if (!snapshot || !target || typeof snapshot.revision !== 'string' || !snapshot.revision || snapshot.revision.length > nativeCarrierBytes || typeof p.sequenceId !== 'string' || !p.sequenceId || !localMediaPath(p.projectPath) || target.projectPath !== p.projectPath || !sameSequenceId(target.sequenceId, p.sequenceId) || typeof target.clipNodeId !== 'string' || !target.clipNodeId) throw new Error('Invalid native caption snapshot identity.');
        var fields = ['trackIndex', 'clipIndex', 'componentIndex', 'documentParamIndex'];
        for (var i = 0; i < fields.length; i++) { var bound = 128; if (fields[i] === 'clipIndex') bound = 100000; if (fields[i] === 'trackIndex') bound = 255; nativeInteger(target[fields[i]], 0, bound, 'control locator'); }
        var s = nativeControlSequence(p), trackCount = connectionCount(s.videoTracks.numTracks, 256);
        if (target.trackIndex >= trackCount) throw new Error('The native caption track changed.');
        var track = s.videoTracks[target.trackIndex], clips = track.clips, clipCount = connectionCount(clips.numItems, 100000);
        if (target.clipIndex >= clipCount) throw new Error('The native caption clip changed.');
        var clip = clips[target.clipIndex];
        if (!clip || connectionId(clip.nodeId) !== target.clipNodeId) throw new Error('The native caption clip identity changed.');
        var before = nativeCaptionRecord(s, clip, target.trackIndex, target.clipIndex, target.componentIndex, true);
        if (before.record.locator.documentParamIndex !== target.documentParamIndex || before.record.revision !== snapshot.revision) throw new Error('The native caption document or clip changed. Reconnect before editing.');
        if (typeof clip.getSpeed !== 'function' || typeof clip.isSpeedReversed !== 'function') throw new Error('Premiere did not expose the native caption source clock.');
        assertNormalSpeed(clip);
        var timing = connectionTiming(clip), at = nativeControlTicks(String(s.getPlayerPosition().ticks));
        nativeControlTicks(timing.inTicks); nativeControlTicks(timing.startTicks); nativeControlTicks(timing.endTicks); nativeControlTicks(timing.outTicks);
        var inside = nativeTickCompare(at, timing.startTicks) >= 0 && nativeTickCompare(at, timing.endTicks) < 0;
        var sourceTicks = inside ? nativeTickMath(nativeTickMath(at, timing.startTicks, true), timing.inTicks, false) : null;
        if (sourceTicks !== null && nativeTickCompare(sourceTicks, timing.outTicks) >= 0) throw new Error('The native caption source timing changed.');
        var names = ['position', 'width', 'height', 'groups', 'alignment'].concat(nativeRollUpNames, nativeBoundaryNames), labels = ['Position', 'Width', 'Height', 'Groups per page', 'Text alignment'].concat(nativeRollUpLabels, nativeBoundaryLabels), params = {}, indices = {}, descriptors = {}, table = before.propertyTable;
        for (var n = 0; n < names.length; n++) {
            var name = names[n], index = nativeBoundaryIndex(name) >= 0 ? nativeBoundaryPropertyIndex(table, name) : nativePropertyIndex(table, labels[n], 'Ambiguous native caption geometry parameters.'), param = index < 0 ? null : table.entries[index];
            // Old native builds have no page-size parameter. Keep their geometry
            // usable, but never invent a writable group count.
            if (!param && (name === 'groups' || name === 'alignment' || nativeRollUpIndex(name) >= 0 || nativeBoundaryIndex(name) >= 0)) continue;
            if (!param || typeof param.isTimeVarying !== 'function' || typeof param.areKeyframesSupported !== 'function') throw new Error('Premiere did not expose the native caption ' + labels[n] + ' control.');
            params[name] = param; indices[name] = index;
            var animated = param.isTimeVarying() === true, keys = [], nativeKeys = animated ? param.getKeys() : null;
            if (nativeKeys && nativeKeys.length > 256) throw new Error('Native caption controls support at most 256 keys per property.');
            for (var k = 0; nativeKeys && k < nativeKeys.length; k++) keys.push({ ticks: nativeControlTicks(String(nativeKeys[k].ticks)), value: nativeControlFromHost(param.getValueAtKey(nativeKeys[k]), name) });
            keys.sort(function (a, b) { return nativeTickCompare(a.ticks, b.ticks); });
            if (animated && !keys.length) throw new Error('Premiere did not expose the animated caption keys.');
            var sampleAt = sourceTicks === null ? timing.inTicks : sourceTicks;
            var value = nativeControlFromHost(animated ? param.getValueAtTime(ticksTime(sampleAt)) : param.getValue(), name), hasKey = false;
            for (var h = 0; h < keys.length; h++) if (keys[h].ticks === sourceTicks) hasKey = true;
            var defaultValue = 150; if (name === 'position') defaultValue = [0.5, 0.9]; if (name === 'width') defaultValue = nativeControlValue(s.frameSizeHorizontal * 0.9, 'width'); if (name === 'height') defaultValue = nativeControlValue(s.frameSizeVertical * 0.9, 'height'); if (name === 'groups') defaultValue = 1; if (name === 'alignment') defaultValue = 2;
            var rollIndex = nativeRollUpIndex(name); if (rollIndex >= 0) defaultValue = nativeRollUpDefaults[rollIndex];
            var boundaryIndex = nativeBoundaryIndex(name); if (boundaryIndex >= 0) defaultValue = nativeBoundaryDefaults[boundaryIndex];
            descriptors[name] = { value: value, defaultValue: defaultValue, animated: animated, keyframesSupported: param.areKeyframesSupported() === true, hasKey: hasKey, keys: keys };
        }
        var receipt = { ok: true, clipNodeId: target.clipNodeId, timelineTicks: at, sourceTicks: sourceTicks, startTicks: timing.startTicks, endTicks: timing.endTicks, inTicks: timing.inTicks, outTicks: timing.outTicks, clock: 'clip-source', insideClip: inside, position: descriptors.position, width: descriptors.width, height: descriptors.height };
        if (descriptors.groups) receipt.groups = descriptors.groups;
        if (descriptors.alignment) receipt.alignment = descriptors.alignment;
        for (var rp = 0; rp < nativeRollUpNames.length; rp++) if (descriptors[nativeRollUpNames[rp]]) receipt[nativeRollUpNames[rp]] = descriptors[nativeRollUpNames[rp]];
        for (var bp = 0; bp < nativeBoundaryNames.length; bp++) if (descriptors[nativeBoundaryNames[bp]]) receipt[nativeBoundaryNames[bp]] = descriptors[nativeBoundaryNames[bp]];
        receipt.revision = stringify({ documentRevision: snapshot.revision, timelineTicks: at, controls: descriptors });
        var sampledSequence = nativeControlSequence(p);
        if (nativeControlTicks(String(sampledSequence.getPlayerPosition().ticks)) !== at) throw new Error('The playhead moved while reading native caption controls. Read them again.');
        return { receipt: receipt, params: params, indices: indices, propertyTable: table, track: track, clip: clip, record: before.record };
    }
    function readNativeCaptionControls(file) {
        try { return reply(nativeControlContext(readPayload(file)).receipt); }
        catch (e) { return reply({ error: e.toString() }); }
    }
    function nativeControlCurves(receipt) {
        var result = {}, names = ['position', 'width', 'height', 'groups', 'alignment'].concat(nativeRollUpNames, nativeBoundaryNames);
        for (var i = 0; i < names.length; i++) {
            var descriptor = receipt[names[i]];
            if (!descriptor) continue;
            result[names[i]] = { animated: descriptor.animated, keyframesSupported: descriptor.keyframesSupported, keys: descriptor.keys, staticValue: descriptor.animated ? null : descriptor.value };
        }
        return stringify(result);
    }
    function seekNativeCaptionKeyframe(file) {
        var attempted = false;
        try {
            var p = readPayload(file), request = p.request;
            if (!request || typeof request !== 'object' || request instanceof Array) throw new Error('Invalid native caption keyframe navigation.');
            for (var field in request) if (field !== 'revision' && field !== 'parameter' && field !== 'direction' && field !== 'atTicks') throw new Error('Unknown native caption keyframe navigation field.');
            if (!nativeKnownControl(request.parameter) || request.direction !== 'previous' && request.direction !== 'next' || typeof request.revision !== 'string' || request.revision.length > nativeCarrierBytes) throw new Error('Invalid native caption keyframe navigation.');
            nativeControlTicks(request.atTicks);
            var before = nativeControlContext(p).receipt, descriptor = before[request.parameter];
            if (request.revision !== before.revision || request.atTicks !== before.timelineTicks) throw new Error('The playhead or native controls changed. Read them again before navigating.');
            if (!descriptor) throw new Error('Update the native caption effect to use this control.');
            if (!descriptor.animated || !descriptor.keyframesSupported) throw new Error('Enable animation in Effect Controls before navigating native caption keyframes.');
            var destination = null, destinationSource = null;
            for (var k = 0; k < descriptor.keys.length; k++) {
                var source = descriptor.keys[k].ticks;
                if (nativeTickCompare(source, before.inTicks) < 0 || nativeTickCompare(source, before.outTicks) >= 0) continue;
                var timeline = nativeTickMath(nativeTickMath(source, before.inTicks, true), before.startTicks, false);
                if (nativeTickCompare(timeline, before.startTicks) < 0 || nativeTickCompare(timeline, before.endTicks) >= 0) continue;
                var side = nativeTickCompare(timeline, before.timelineTicks);
                var nearer = false;
                if (request.direction === 'previous') {
                    if (side < 0) {
                        if (destination === null) nearer = true;
                        else if (nativeTickCompare(timeline, destination) > 0) nearer = true;
                    }
                } else if (side > 0) {
                    if (destination === null) nearer = true;
                    else if (nativeTickCompare(timeline, destination) < 0) nearer = true;
                }
                if (nearer) { destination = timeline; destinationSource = source; }
            }
            if (destination === null) throw new Error('There is no ' + request.direction + ' keyframe inside this caption clip.');
            var sequenceBefore = sequence(p.sequenceId, p.projectPath);
            if (typeof sequenceBefore.setPlayerPosition !== 'function') throw new Error('Premiere did not expose native playhead navigation.');
            if (nativeControlContext(p).receipt.revision !== before.revision) throw new Error('The playhead or native controls changed during navigation preparation.');
            attempted = true;
            sequenceBefore.setPlayerPosition(destination);
            var after = nativeControlContext(p).receipt;
            if (after.timelineTicks !== destination || after.sourceTicks !== destinationSource || nativeControlCurves(after) !== nativeControlCurves(before)) throw new Error('Premiere did not confirm the native keyframe navigation.');
            after.readbackVerified = true; after.retry = 'never'; return reply(after);
        } catch (e) {
            if (attempted) return reply({ error: 'Premiere did not confirm the last keyframe navigation. Inspect the playhead before trying again.', code: 'BC_OUTPUT_UNCONFIRMED', recoverable: false, outputApplied: false, retry: 'never' });
            return reply({ error: e.toString() });
        }
    }
    // Transient, non-keyframed monitor guide. The native lease expires even if
    // the visible panel goes away; CEP clears the parameter as well, invalidating
    // Premiere's cached guide frame. This registry owns only our exact leases.
    var nativeLayoutGuides = BetterCaptionsLayoutGuideLeasesV1 instanceof Array ? BetterCaptionsLayoutGuideLeasesV1 : [];
    function nativeLayoutGuide(context, snapshot) {
        var table = context.propertyTable;
        var index = nativePropertyIndex(table, 'Layout editing guide', 'Ambiguous native layout guide.');
        if (index < 0) return { active: false, reason: 'native-update-required' };
        var param = table.entries[index];
        if (typeof param.isTimeVarying !== 'function' || param.isTimeVarying() || typeof param.setValue !== 'function') return { active: false, reason: 'guide-not-static' };
        var now = new Date().getTime(), lease = (now + 1500) / 1000;
        param.setValue(lease, 1);
        var actualLease = param.getValue();
        if (typeof actualLease !== 'number' || !isFinite(actualLease) || Math.abs(actualLease - lease) > 0.01) return { active: false, reason: 'guide-readback-failed' };
        lease = actualLease;
        var locator = snapshot.locator, item = null;
        for (var i = 0; i < nativeLayoutGuides.length; i++) if (nativeLayoutGuides[i].projectPath === locator.projectPath && nativeLayoutGuides[i].sequenceId === locator.sequenceId && nativeLayoutGuides[i].clipNodeId === locator.clipNodeId && nativeLayoutGuides[i].componentIndex === locator.componentIndex) item = nativeLayoutGuides[i];
        if (!item) {
            if (nativeLayoutGuides.length >= 256) nativeLayoutGuides.shift();
            item = { projectPath: locator.projectPath, sequenceId: locator.sequenceId, clipNodeId: locator.clipNodeId, trackIndex: locator.trackIndex, clipIndex: locator.clipIndex, componentIndex: locator.componentIndex };
            nativeLayoutGuides.push(item);
        }
        item.lease = lease; item.clearAfter = now + 800;
        return { active: true, expiresAt: now + 1500 };
    }
    function clearExpiredNativeCaptionGuides() {
        var now = new Date().getTime(), remaining = [], pending = 0, cleared = 0;
        for (var i = 0; i < nativeLayoutGuides.length; i++) {
            var item = nativeLayoutGuides[i];
            if (item.clearAfter > now) { remaining.push(item); pending++; continue; }
            // Never dereference an object retained across project close/reopen.
            // Re-resolve the captured clip, component and hidden static field.
            if (String(app.project.path) !== item.projectPath) { remaining.push(item); pending++; continue; }
            try {
                var s = app.project.activeSequence;
                if (!s || !sameSequenceId(String(s.sequenceID), item.sequenceId)) {
                    s = null;
                    var sequences = app.project.sequences;
                    for (var q = 0; sequences && q < connectionCount(sequences.numSequences, 10000); q++) if (sameSequenceId(String(sequences[q].sequenceID), item.sequenceId)) { s = sequences[q]; break; }
                }
                if (!s || item.trackIndex >= connectionCount(s.videoTracks.numTracks, 256)) continue;
                var clips = s.videoTracks[item.trackIndex].clips, clip = null;
                // Clip insertion/reorder must not strand a cached guide.
                for (var c = 0; c < connectionCount(clips.numItems, 100000); c++) if (connectionId(clips[c].nodeId) === item.clipNodeId) { clip = clips[c]; break; }
                if (!clip || item.componentIndex >= connectionCount(clip.components.numItems, 128) || !nativeCaptionName(String(clip.components[item.componentIndex].matchName))) continue;
                var table = nativePropertyTable(clip.components[item.componentIndex].properties), index = nativePropertyIndex(table, 'Layout editing guide', 'Ambiguous native layout guide.');
                if (index < 0) continue;
                var param = table.entries[index];
                if (param.isTimeVarying() || param.getValue() !== item.lease) continue;
                param.setValue(0, 1);
                if (param.getValue() !== 0) { remaining.push(item); pending++; } else cleared++;
            } catch (e) { remaining.push(item); pending++; }
        }
        nativeLayoutGuides = remaining; BetterCaptionsLayoutGuideLeasesV1 = remaining;
        return reply({ ok: true, pending: pending, cleared: cleared });
    }
    function verifyNativeCaptionControl(p, request, name) {
        var receipt = request.receipt, descriptor = receipt && receipt[name];
        if (!descriptor || typeof descriptor !== 'object') throw new Error('Missing native caption control receipt.');
        var value = nativeControlValue(request.operation === 'reset' ? descriptor.defaultValue : request.value, name);
        var afterContext = nativeControlContext(p), after = afterContext.receipt;
        if (after.timelineTicks !== receipt.timelineTicks || !sameValue(after[name].value, value) || after[name].animated !== descriptor.animated) throw new Error('Native caption value readback failed.');
        for (var other in afterContext.params) if (other !== name && stringify(after[other]) !== stringify(receipt[other])) throw new Error('Another native caption control changed during the update.');
        if (descriptor.animated) {
            if (after[name].keys.length !== descriptor.keys.length + (descriptor.hasKey ? 0 : 1) || !after[name].hasKey) throw new Error('Native caption key readback failed.');
            for (var old = 0; old < descriptor.keys.length; old++) {
                var key = descriptor.keys[old];
                if (key.ticks === receipt.sourceTicks) continue;
                var found = false;
                for (var fresh = 0; fresh < after[name].keys.length; fresh++) if (key.ticks === after[name].keys[fresh].ticks && sameValue(key.value, after[name].keys[fresh].value)) found = true;
                if (!found) throw new Error('An existing native caption key changed.');
            }
        }
        var display = nativeDimensionProxy(afterContext.propertyTable, name), shown = display && display.getValue();
        if (display && (typeof shown !== 'number' || Math.abs(shown - after[name].value) > 0.0001)) throw new Error('Premiere did not confirm the native dimension display update.');
        if (name === 'position' || name === 'width' || name === 'height') {
            try { after.layoutGuide = nativeLayoutGuide(afterContext, p.snapshot); }
            catch (guideError) { after.layoutGuide = { active: false, reason: 'guide-unavailable' }; }
        }
        after.readbackVerified = true; after.retry = 'never';
        return after;
    }
    function editNativeCaptionControl(file) {
        var attempted = false;
        try {
            var p = readPayload(file), request = p.request;
            if (!request || typeof request !== 'object' || request instanceof Array) throw new Error('Invalid native caption control edit.');
            for (var field in request) if (field !== 'revision' && field !== 'parameter' && field !== 'operation' && field !== 'value' && field !== 'atTicks' && field !== 'phase' && field !== 'receipt') throw new Error('Unknown native caption control edit field.');
            if (!nativeKnownControl(request.parameter) || request.operation !== 'set' && request.operation !== 'reset' || typeof request.revision !== 'string' || request.revision.length > nativeCarrierBytes) throw new Error('Invalid native caption control operation.');
            nativeControlTicks(request.atTicks);
            var name = request.parameter;
            // UXP commits the prepared writes as one named Premiere undo step
            // between these two phases. ExtendScript setters never reach Premiere's history.
            if (request.phase === 'verify') { attempted = true; return reply(verifyNativeCaptionControl(p, request, name)); }
            if (request.phase !== 'prepare') throw new Error('Invalid native caption control phase.');
            var before = nativeControlContext(p), receipt = before.receipt, descriptor = receipt[name], param = before.params[name];
            if (request.revision !== receipt.revision || request.atTicks !== receipt.timelineTicks) throw new Error('The playhead or native controls changed. Read them again before editing.');
            if (!receipt.insideClip) throw new Error('Move the playhead inside the native caption clip before editing.');
            if (typeof before.track.isLocked !== 'function' || before.track.isLocked()) throw new Error('Unlock the native caption track before editing.');
            if (!descriptor || !param) throw new Error('Update the native caption effect to use this control.');
            if (name === 'alignment' && request.operation === 'set' && (typeof request.value !== 'number' || request.value !== Math.floor(request.value))) throw new Error('Text alignment must use a whole-number mode.');
            var rollIndex = nativeRollUpIndex(name);
            if ((rollIndex === 0 || rollIndex === 3 || rollIndex === 10) && request.operation === 'set' && request.value !== 0 && request.value !== 1) throw new Error('Native caption toggles must use numeric zero or one.');
            if ((name === 'rollUpCurrentLine' || rollIndex === 1 || rollIndex === 7 || rollIndex === 8 || rollIndex === 11) && request.operation === 'set' && (typeof request.value !== 'number' || request.value !== Math.floor(request.value))) throw new Error('Native line counts and transition curves must use whole numbers.');
            var value = nativeControlValue(request.operation === 'reset' ? descriptor.defaultValue : request.value, name);
            if (request.operation === 'reset' && request.value !== undefined) throw new Error('A reset must use the native default.');
            if (descriptor.animated && !descriptor.keyframesSupported) throw new Error('Premiere cannot edit this native caption control.');
            // Explicit plugin edits select their owned clip once so Premiere can
            // route the effect's DRAW-only Program Monitor bounds. No menus,
            // workspace changes, preference changes, or selection polling.
            var recheck = before;
            if (typeof recheck.clip.isSelected !== 'function' || recheck.clip.isSelected() !== true) {
                if (typeof recheck.clip.setSelected !== 'function') throw new Error('Select this caption clip in the Premiere timeline before editing its controls.');
                recheck.clip.setSelected(1, true);
                if (typeof recheck.clip.isSelected !== 'function' || recheck.clip.isSelected() !== true) throw new Error('Premiere did not confirm caption clip selection. Select it in the timeline first.');
                recheck = nativeControlContext(p);
                if (recheck.receipt.revision !== receipt.revision) throw new Error('Native caption controls changed during edit preparation.');
            }
            var writes = [{ index: recheck.indices[name], label: recheck.propertyTable.names[recheck.indices[name]], value: nativeControlToHost(value, name), point: name === 'position', atTicks: descriptor.animated ? receipt.sourceTicks : null }];
            // Script setters on the saved dimension streams do not reliably refresh
            // Effect Controls. Mirror the cosmetic px display in the same undo step.
            if (nativeDimensionProxy(recheck.propertyTable, name)) {
                var proxyLabel = name === 'width' ? 'Width, px' : 'Height, px';
                writes.push({ index: nativePropertyIndex(recheck.propertyTable, proxyLabel, 'Ambiguous native dimension display controls.'), label: proxyLabel, value: value, point: false, atTicks: null });
            }
            return reply({ ok: true, target: nativeUxpTarget(recheck), writes: writes, receipt: receipt });
        } catch (e) {
            if (attempted) return reply({ error: 'Native control update was not confirmed: ' + String(e).replace(/^Error:\s*/, '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240), code: 'BC_OUTPUT_UNCONFIRMED', recoverable: false, outputApplied: false, retry: 'never' });
            return reply({ error: e.toString() });
        }
    }
    var nativeExtensionAttempts = {}, nativeExtensionAttemptCount = 0;
    function nativeExtensionRemainder(value, divisor) {
        var remainder = 0;
        for (var i = 0; i < value.length; i++) remainder = (remainder * 10 + Number(value.charAt(i))) % divisor;
        return remainder;
    }
    function nativeExtensionLocate(p) {
        var snapshot = p.snapshot, target = snapshot && snapshot.locator;
        if (!snapshot || !target || typeof snapshot.revision !== 'string' || !snapshot.revision || snapshot.revision.length > nativeCarrierBytes || !localMediaPath(p.projectPath) || target.projectPath !== p.projectPath || !sameSequenceId(target.sequenceId, p.sequenceId)) throw new Error('Invalid native caption extension identity.');
        var fields = ['trackIndex', 'clipIndex', 'componentIndex', 'documentParamIndex'];
        for (var i = 0; i < fields.length; i++) {
            var locatorBound = 128;
            if (fields[i] === 'trackIndex') locatorBound = 255;
            if (fields[i] === 'clipIndex') locatorBound = 100000;
            nativeInteger(target[fields[i]], 0, locatorBound, 'extension locator');
        }
        var s = sequence(p.sequenceId, p.projectPath), trackCount = connectionCount(s.videoTracks.numTracks, 256);
        if (target.trackIndex >= trackCount) throw new Error('The caption extension track changed.');
        var track = s.videoTracks[target.trackIndex], count = connectionCount(track.clips.numItems, 2000);
        if (target.clipIndex >= count) throw new Error('The caption extension clip changed.');
        var clip = track.clips[target.clipIndex];
        if (!clip || connectionId(clip.nodeId) !== target.clipNodeId) throw new Error('The caption extension identity changed.');
        var current = nativeCaptionRecord(s, clip, target.trackIndex, target.clipIndex, target.componentIndex, true);
        if (current.record.locator.documentParamIndex !== target.documentParamIndex || current.record.carrierKind !== 'transparent-video') throw new Error('Extend captions requires the original owned native caption source.');
        if (typeof track.isLocked !== 'function' || track.isLocked() || typeof track.isMuted === 'function' && track.isMuted() || clip.disabled === true) throw new Error('Enable and unlock the native caption track before extending it.');
        if (typeof clip.getSpeed !== 'function' || typeof clip.isSpeedReversed !== 'function') throw new Error('Premiere did not expose the caption extension source clock.');
        assertNormalSpeed(clip);
        var timing = connectionTiming(clip), frameTicks = nativeControlTicks(String(s.timebase)), frame = Number(frameTicks);
        if (!frame || !isFinite(frame) || frame > 1000000000000) throw new Error('Invalid caption extension frame rate.');
        var duration = nativeTickMath(timing.endTicks, timing.startTicks, true);
        if (duration !== nativeTickMath(timing.outTicks, timing.inTicks, true)) throw new Error('The caption source speed changed.');
        for (i = 0; i < fields.length; i++) {
            var tickName = ['startTicks', 'endTicks', 'inTicks', 'outTicks'][i];
            nativeControlTicks(timing[tickName]);
            if (nativeExtensionRemainder(timing[tickName], frame)) throw new Error('Caption extension requires exact frame boundaries.');
        }
        return { sequence: s, clip: clip, track: track, current: current, timing: timing, frameTicks: frameTicks };
    }
    function nativeExtensionEffectState(clip, ignoredDocument, budget) {
        var components = clip.components, count = connectionCount(components && components.numItems, 128), result = [];
        for (var c = 0; c < count; c++) {
            var component = components[c], properties = component.properties, n = connectionCount(properties && properties.numItems, 256), values = [];
            for (var p = 0; p < n; p++) {
                var param = properties[p];
                if (ignoredDocument && c === ignoredDocument.componentIndex && p === ignoredDocument.documentParamIndex) continue;
                if (++budget.parameters > 10000 || !param || typeof param.isTimeVarying !== 'function' || typeof param.getValue !== 'function') throw new Error('Premiere could not preserve every effect parameter during caption extension.');
                var animated = param.isTimeVarying() === true, keys = [], nativeKeys = animated ? param.getKeys() : null;
                if (nativeKeys && nativeKeys.length > 256) throw new Error('Too many effect keys to verify caption extension.');
                for (var k = 0; nativeKeys && k < nativeKeys.length; k++) {
                    if (++budget.keys > 10000 || typeof param.getValueAtKey !== 'function') throw new Error('Premiere could not preserve existing caption extension keys.');
                    var entry = { ticks: String(nativeKeys[k].ticks), value: param.getValueAtKey(nativeKeys[k]) };
                    if (typeof param.getInterpolationTypeAtKey === 'function') entry.interpolation = param.getInterpolationTypeAtKey(nativeKeys[k]);
                    keys.push(entry);
                }
                values.push({ index: p, name: String(param.displayName), animated: animated, value: animated ? null : param.getValue(), keys: keys });
            }
            result.push({ matchName: String(component.matchName), parameters: values });
        }
        var encoded = stringify(result);
        if (encoded.length > nativeCarrierBytes) throw new Error('Effect preservation state exceeds the caption extension bound.');
        return encoded;
    }
    function nativeExtensionState(p, located) {
        var s = located.sequence, target = p.snapshot.locator, sets = [s.videoTracks, s.audioTracks], state = [], contentEnd = '0', budget = { parameters: 0, keys: 0 }, inspected = 0;
        for (var group = 0; group < sets.length; group++) {
            var tracks = sets[group], count = connectionCount(tracks.numTracks, 256), rows = [];
            for (var t = 0; t < count; t++) {
                var track = tracks[t], clips = track.clips, n = connectionCount(clips.numItems, 2000), entries = [], muted = typeof track.isMuted === 'function' && track.isMuted();
                if (typeof track.isLocked !== 'function') throw new Error('Premiere did not expose a caption extension track lock.');
                for (var c = 0; c < n; c++) {
                    if (++inspected > 2000) throw new Error('Caption extension supports at most 2000 timeline clips.');
                    var clip = clips[c], node = connectionId(clip && clip.nodeId), item = clip.projectItem, timing = connectionTiming(clip);
                    if (!item || typeof item.getMediaPath !== 'function') throw new Error('Premiere did not expose caption extension media identities.');
                    var path = String(item.getMediaPath()), isTarget = node === target.clipNodeId, caption = isTarget, components = clip.components, componentCount = connectionCount(components && components.numItems, 128);
                    for (var f = 0; f < componentCount; f++) if (nativeCaptionName(String(components[f].matchName))) caption = true;
                    if (/(^|[\\\/])caption-[a-zA-Z0-9_-]{1,200}[\\\/]caption\.mov$/.test(path)) caption = true;
                    if (!muted && clip.disabled !== true && !caption && nativeTickCompare(timing.endTicks, contentEnd) > 0) contentEnd = timing.endTicks;
                    entries.push({ node: node, item: connectionId(item.nodeId), path: path, name: clip.name, disabled: clip.disabled === true,
                        timing: isTarget ? null : timing, effects: nativeExtensionEffectState(clip, isTarget ? target : null, budget) });
                }
                rows.push({ name: track.name, locked: track.isLocked(), muted: muted, clips: entries });
            }
            state.push(rows);
        }
        var remainder = nativeExtensionRemainder(contentEnd, Number(located.frameTicks));
        if (remainder) contentEnd = nativeTickMath(contentEnd, String(Number(located.frameTicks) - remainder), false);
        var out = nativeTickMath(located.timing.outTicks, nativeTickCompare(contentEnd, located.timing.endTicks) > 0 ? nativeTickMath(contentEnd, located.timing.endTicks, true) : '0', false);
        if (nativeTickCompare(out, String(864000 * TICKS)) > 0) throw new Error('Caption extension exceeds the supported source duration.');
        if (nativeTickCompare(contentEnd, located.timing.endTicks) > 0) for (var x = 0; x < located.track.clips.numItems; x++) {
            var neighbor = located.track.clips[x];
            if (connectionId(neighbor.nodeId) === target.clipNodeId) continue;
            var boundary = connectionTiming(neighbor);
            if (nativeTickCompare(boundary.startTicks, contentEnd) < 0 && nativeTickCompare(boundary.endTicks, located.timing.endTicks) > 0) throw new Error('Another clip blocks the caption extension on this track. Move it before extending captions.');
        }
        var preserved = stringify({ projectPath: p.projectPath, sequenceId: p.sequenceId, timebase: located.frameTicks, width: s.frameSizeHorizontal, height: s.frameSizeVertical,
            carrierRevision: located.current.record.carrierRevision, start: located.timing.startTicks, inPoint: located.timing.inTicks, tracks: state });
        if (preserved.length > nativeCarrierBytes) throw new Error('Caption extension preservation state is too large.');
        return { preserved: preserved, targetEndTicks: contentEnd, targetOutTicks: out };
    }
    function nativeExtensionContext(p) {
        var located = nativeExtensionLocate(p);
        if (located.current.record.revision !== p.snapshot.revision) throw new Error('The caption changed before extension. Reconnect and try again.');
        var state = nativeExtensionState(p, located), revision = stringify({ documentRevision: p.snapshot.revision, preservation: state.preserved, targetEndTicks: state.targetEndTicks, targetOutTicks: state.targetOutTicks });
        if (revision.length > nativeCarrierBytes) throw new Error('The caption extension revision is too large.');
        sequence(p.sequenceId, p.projectPath);
        return { located: located, state: state, receipt: { ok: true, revision: revision, connection: located.current.record, ticksPerFrame: located.frameTicks,
            targetEndTicks: state.targetEndTicks, targetOutTicks: state.targetOutTicks, canExtend: nativeTickCompare(state.targetEndTicks, located.timing.endTicks) > 0 } };
    }
    function readNativeCaptionExtension(file) {
        try { return reply(nativeExtensionContext(readPayload(file)).receipt); }
        catch (e) { return reply({ error: e.toString() }); }
    }
    // BCAP version that appends line position styles; renumber only here.
    var nativePositionStylesVersion = 12;
    function nativeExtensionBinary(text, edgesAsBreaks) {
        boundedNativeCarrier(text);
        var offset = 7, count = 0;
        function u() {
            if (offset + 8 > text.length) throw new Error('Truncated caption extension document.');
            var value = 0;
            for (var i = 0; i < 4; i++) value += parseInt(text.substr(offset + i * 2, 2), 16) * Math.pow(256, i);
            offset += 8; return value;
        }
        function skip(bytes) { if (offset + bytes * 2 > text.length) throw new Error('Truncated caption extension words.'); offset += bytes * 2; }
        if (u() !== 1346454338) throw new Error('Invalid caption extension document magic.');
        var version = u(), n = u(), captions = [];
        if (version < 1 || version > nativePositionStylesVersion || n > 10000) throw new Error('Invalid caption extension document version or size.');
        for (var c = 0; c < n; c++) {
            var identityStart = offset, length = u();
            if (!length || length > 256) throw new Error('Invalid caption extension identity.');
            skip(length); var manual = u(); if (manual > 1) throw new Error('Invalid caption extension split flag.');
            var identity = text.substring(identityStart, offset), words = u(), wordParts = [];
            if (!words || (count += words) > 50000) throw new Error('Invalid caption extension word count.');
            for (var w = 0; w < words; w++) {
                var wordStart = offset, size = u();
                if (!size || size > 4096) throw new Error('Invalid caption extension text size.');
                skip(size + 16); if (u() > 1) throw new Error('Invalid caption extension sentence flag.');
                wordParts.push(text.substring(wordStart, offset));
                if (version >= 8) {
                    // v10 adds 3, a merge edge. Upgrading an older document turns
                    // its merges' breaks (1) into edges, so only then they compare equal.
                    var boundary = u();
                    if (boundary > (version >= 10 ? 3 : 2)) throw new Error('Invalid caption extension word line boundary.');
                    wordParts.push(['00000000', '01000000', '02000000', edgesAsBreaks ? '01000000' : '03000000'][boundary]);
                } else {
                    // Match legacy decode: storage order, with a visible break
                    // at every noninitial container, regardless of split flag.
                    wordParts.push(c > 0 && w === 0 ? '01000000' : '00000000');
                }
                if (version >= 9) {
                    var removedStart = offset;
                    if (u() > 8) throw new Error('Invalid caption extension removed pause-line count.');
                    wordParts.push(text.substring(removedStart, offset));
                } else wordParts.push('00000000');
            }
            captions.push({ identity: identity, count: words, words: wordParts.join('') });
        }
        // Walk the immutable style footer before treating it as an opaque
        // equality proof. v5 adds bubble-space flags; v6 adds six optional
        // padding axes. Malformed footers cannot reach a duration setter.
        var trailerStart = offset;
        for (var state = 0; state < 3; state++) {
            var familyLength = u();
            if (!familyLength || familyLength > 256) throw new Error('Invalid caption extension font size.');
            skip(familyLength); skip(56);
            if (u() > 1) throw new Error('Invalid caption extension bubble flag.');
            skip(144);
        }
        skip(16); if (u() > 1) throw new Error('Invalid caption extension title flag.');
        if (version >= 2) skip(8);
        if (version >= 3) {
            skip(8);
            for (var style = 0; style < 3; style++) {
                skip(8); if (u() > 2 || u() > 2) throw new Error('Invalid caption extension typography flag.');
            }
        }
        if (version >= 4 && u() > 2) throw new Error('Invalid caption extension case flag.');
        if (version >= 5) for (var fill = 0; fill < 3; fill++) if (u() > 1) throw new Error('Invalid caption extension bubble spaces flag.');
        if (version >= 6) for (var axis = 0; axis < 6; axis++) {
            var low = u(), high = u();
            // IEEE754 little-endian f64: positive encodings sort by these
            // unsigned words. Permit finite [0,4096], exact -1 sentinel, and
            // -0 (which the native numeric range also treats as zero). This
            // avoids lossy number conversion while keeping every footer byte.
            var validAxis = high < 1085276160 || high === 1085276160 && low === 0;
            if (high === 3220176896 && low === 0 || high === 2147483648 && low === 0) validAxis = true;
            if (!validAxis) throw new Error('Invalid caption extension bubble padding axis.');
        }
        if (version >= 6) for (var underline = 0; underline < 3; underline++) if (u() > 2) throw new Error('Invalid caption extension underline flag.');
        if(version>=7)for(var geometry=0;geometry<36;geometry++){var lo=u(),hi=u(),absHi=hi&2147483647;var margin=(geometry%12)>=8;if(!((margin?absHi:hi)<1085276160||(margin?absHi:hi)===1085276160&&lo===0||!margin&&hi===3220176896&&lo===0))throw new Error('Invalid caption geometry.');}
        // v11 appends the line wrap: 0 Fill, 1 Balance, 2 Pretty.
        if (version >= 11 && u() > 2) throw new Error('Invalid caption extension line wrap.');
        if (version >= nativePositionStylesVersion) {
            // Line position styles: count, then position, field mask and the
            // flagged fields in bit order (see native/core/README.md).
            var positions = u(), previousPosition = 0;
            if (positions > 8) throw new Error('Invalid caption extension line positions.');
            for (var entry = 0; entry < positions; entry++) {
                var position = u(), fields = u();
                if (position <= previousPosition || position > 8 || !fields || fields >= 2147483648) throw new Error('Invalid caption extension line position.');
                previousPosition = position;
                for (var bit = 0; bit < 31; bit++) {
                    if (!((fields >>> bit) & 1)) continue;
                    if (bit === 0) { var fontLength = u(); if (!fontLength || fontLength > 256) throw new Error('Invalid caption extension line font.'); skip(fontLength); }
                    else if (bit === 1) { skip(8); if (u() > 2) throw new Error('Invalid caption extension line weight.'); }
                    else if (bit === 2 || bit === 3 || bit === 7 || bit === 8) { if (u() > 1) throw new Error('Invalid caption extension line flag.'); }
                    else if (bit === 5 || bit === 9 || bit === 24 || bit === 29) skip(24);
                    else skip(8);
                }
            }
        }
        if (offset !== text.length) throw new Error('Trailing caption extension document bytes.');
        // Compare old layouts as the current version without rewriting the stored document.
        // Only fields absent in that layout get their exact decode defaults;
        // all existing style/origin bytes remain immutable.
        var trailer = text.substring(trailerStart), zero = '0000000000000000', absent = '000000000000f0bf';
        if (version < 2) trailer += zero;
        if (version < 3) {
            trailer += zero; // Base weight, then weight/italic/offset per state.
            for (var typography = 0; typography < 3; typography++) trailer += zero + zero;
        }
        if (version < 4) trailer += '00000000';
        if (version < 5) trailer += '000000000000000000000000';
        if (version < 6) {
            for (var padding = 0; padding < 6; padding++) trailer += absent;
            trailer += '000000000000000000000000';
        }
        if (version < 7) for (var stateGeometry = 0; stateGeometry < 36; stateGeometry++) trailer += stateGeometry % 12 < 8 ? absent : zero;
        if (version < 11) trailer += '00000000';
        if (version < nativePositionStylesVersion) trailer += '00000000'; // no line position styles
        return { version: version, captions: captions, trailer: trailer };
    }
    function nativeExtensionAppendOnly(before, after) {
        var old = nativeExtensionBinary(before, false), next = nativeExtensionBinary(after, old.version < 10), changed = 0;
        // The panel writes v11, or the line position styles version when the
        // document has them; the trailer comparison keeps those styles unchanged.
        if ((old.version !== next.version && next.version !== 11 && next.version !== nativePositionStylesVersion) || old.captions.length !== next.captions.length || old.trailer !== next.trailer) throw new Error('Caption extension must preserve every previous style and manual container.');
        for (var i = 0; i < old.captions.length; i++) {
            var a = old.captions[i], b = next.captions[i];
            if (a.identity !== b.identity || b.count < a.count || b.words.slice(0, a.words.length) !== a.words) throw new Error('Caption extension cannot replace previous caption text or timings.');
            if (b.count !== a.count && ++changed > 1) throw new Error('Caption extension must append to only one existing container.');
        }
    }
    function extendNativeCaptionDocument(file) {
        var attempted = false, stage = 'preflight';
        try {
            var p = readPayload(file), request = p.request;
            if (!request || typeof request !== 'object' || request instanceof Array || typeof request.revision !== 'string' || request.revision.length > nativeCarrierBytes) throw new Error('Invalid native caption extension request.');
            for (var field in request) if (field !== 'revision' && field !== 'documentText' && field !== 'endTicks' && field !== 'outTicks') throw new Error('Unknown native caption extension field.');
            nativeControlTicks(request.endTicks); nativeControlTicks(request.outTicks); boundedNativeCarrier(request.documentText);
            var before = nativeExtensionContext(p), located = before.located;
            if (!before.receipt.canExtend || before.receipt.revision !== request.revision || before.receipt.targetEndTicks !== request.endTicks || before.receipt.targetOutTicks !== request.outTicks) throw new Error('The footage or caption extension context changed. Refresh before extending.');
            nativeExtensionAppendOnly(located.current.record.documentText, request.documentText);
            if (typeof located.current.param.setValue !== 'function') throw new Error('Premiere did not expose the caption document setter.');
            var attemptKey = '$' + p.projectPath + '|' + request.revision;
            if (nativeExtensionAttempts[attemptKey] || nativeExtensionAttemptCount >= 100) throw new Error('This caption extension cannot be retried automatically. Inspect the clip first.');
            if (nativeExtensionContext(p).receipt.revision !== request.revision) throw new Error('The caption extension changed during preparation.');
            attempted = true; nativeExtensionAttempts[attemptKey] = true; nativeExtensionAttemptCount++;
            stage = 'duration update';
            located.clip.outPoint = ticksTime(request.outTicks);
            sequence(p.sequenceId, p.projectPath);
            // An out-point setter may also move the clip end. Permit either
            // exact acknowledged state, while checking all protected data
            // before issuing the next setter.
            var pending = nativeCaptionRecord(located.sequence, located.clip, p.snapshot.locator.trackIndex, p.snapshot.locator.clipIndex, p.snapshot.locator.componentIndex, true).record;
            if (pending.startTicks !== located.timing.startTicks || pending.inTicks !== located.timing.inTicks || pending.outTicks !== request.outTicks || pending.endTicks !== located.timing.endTicks && pending.endTicks !== request.endTicks || pending.documentText !== located.current.record.documentText || pending.carrierRevision !== located.current.record.carrierRevision || nativeExtensionState(p, located).preserved !== before.state.preserved) throw new Error('The caption or timeline changed while extending its source out point.');
            if (pending.endTicks !== request.endTicks) located.clip.end = ticksTime(request.endTicks);
            var extended = nativeExtensionLocate(p), timing = extended.timing;
            if (timing.startTicks !== located.timing.startTicks || timing.inTicks !== located.timing.inTicks || timing.endTicks !== request.endTicks || timing.outTicks !== request.outTicks || extended.current.record.documentText !== located.current.record.documentText || nativeExtensionState(p, extended).preserved !== before.state.preserved) throw new Error('Premiere did not preserve the existing caption while extending its duration.');
            stage = 'document update';
            if (request.documentText !== extended.current.record.documentText) extended.current.param.setValue(request.documentText, 1);
            var after = nativeExtensionLocate(p), expected = parseJSON(p.snapshot.revision);
            expected.end = request.endTicks; expected.outPoint = request.outTicks; expected.documentText = request.documentText;
            if (after.current.record.revision !== stringify(expected) || nativeExtensionState(p, after).preserved !== before.state.preserved) throw new Error('Premiere did not confirm the caption extension readback.');
            sequence(p.sequenceId, p.projectPath);
            return reply({ ok: true, connection: after.current.record, readbackVerified: true, renderVerified: false, retry: 'never' });
        } catch (e) {
            if (attempted) return reply({ error: 'Premiere did not confirm caption extension during ' + stage + '. Inspect the caption clip before another write.', code: 'BC_OUTPUT_UNCONFIRMED', recoverable: false, outputApplied: false, retry: 'never' });
            return reply({ error: e.toString(), retry: 'never' });
        }
    }
    function nativeUxpTarget(context) {
        var record = context.record;
        return { trackIndex: record.trackIndex, startTicks: record.startTicks, endTicks: record.endTicks, inTicks: record.inTicks, matchName: record.matchName, names: context.propertyTable.names };
    }
    // Resolves the exact native caption clip of a validated document locator.
    function nativeLocatedDocument(p, target) {
        if (!target || typeof target !== 'object' || typeof p.sequenceId !== 'string' || !p.sequenceId || typeof target.sequenceId !== 'string' || !target.sequenceId || typeof target.clipNodeId !== 'string' || !target.clipNodeId || !localMediaPath(p.projectPath) || target.projectPath !== p.projectPath || !sameSequenceId(target.sequenceId, p.sequenceId)) throw new Error('Invalid native caption snapshot identity.');
        var fields = ['trackIndex', 'clipIndex', 'componentIndex', 'documentParamIndex'];
        for (var i = 0; i < fields.length; i++) {
            var limit = 128;
            if (fields[i] === 'clipIndex') limit = 100000;
            if (fields[i] === 'trackIndex') limit = 255;
            if (typeof target[fields[i]] !== 'number' || !isFinite(target[fields[i]]) || target[fields[i]] < 0 || target[fields[i]] !== Math.floor(target[fields[i]]) || target[fields[i]] > limit) throw new Error('Invalid bounded native caption locator.');
        }
        var s = sequence(p.sequenceId, p.projectPath), trackCount = connectionCount(s.videoTracks.numTracks, 256);
        if (target.trackIndex >= trackCount) throw new Error('The native caption track changed.');
        var track = s.videoTracks[target.trackIndex], clips = track.clips, clipCount = connectionCount(clips.numItems, 100000);
        if (target.clipIndex >= clipCount) throw new Error('The native caption clip changed.');
        var clip = clips[target.clipIndex];
        if (!clip || connectionId(clip.nodeId) !== target.clipNodeId) throw new Error('The native caption clip identity changed.');
        if (typeof track.isLocked !== 'function' || track.isLocked()) throw new Error('Unlock the native caption track before editing.');
        var located = nativeCaptionRecord(s, clip, target.trackIndex, target.clipIndex, target.componentIndex, true);
        if (located.record.locator.documentParamIndex !== target.documentParamIndex) throw new Error('The native caption document parameter changed. Reconnect before editing.');
        return located;
    }
    // ExtendScript setters never reach Premiere's Undo history, and UXP cannot set
    // the arbitrary-data document. So a document edit is: prepare (validate), write
    // (document, plus a non-undoable seed of the current edit token), a UXP
    // transaction setting the next edit token and any scalar grouping as one named
    // undo step, then verify.
    function writeNativeCaptionDocument(file) {
        var attempted = false, verified = false;
        try {
            var p = readPayload(file), snapshot = p.snapshot, target = snapshot && snapshot.locator;
            if (!snapshot || typeof snapshot.revision !== 'string' || !snapshot.revision || snapshot.revision.length > nativeCarrierBytes) throw new Error('Invalid native caption snapshot identity.');
            boundedNativeCarrier(p.documentText);
            var grouping = snapshot.grouping, phase = snapshot.phase;
            if (grouping !== undefined) {
                if (!grouping || typeof grouping !== 'object') throw new Error('Invalid native caption grouping edit.');
                for (var groupingKey in grouping) if (groupingKey !== 'before' && groupingKey !== 'value') throw new Error('Unknown native caption grouping field.');
                nativeInteger(grouping.before, 1, 500, 'previous character limit'); nativeInteger(grouping.value, 1, 500, 'character limit');
            }
            if (phase === 'verify') {
                attempted = true;
                var after = nativeLocatedDocument(p, target).record, expected = parseJSON(snapshot.revision); expected.documentText = p.documentText;
                if (after.documentText !== p.documentText || after.revision !== stringify(expected) || grouping !== undefined && after.maxChars !== grouping.value) throw new Error('Premiere did not confirm the native caption document readback.');
                if (snapshot.expectedToken !== undefined && after.editToken !== snapshot.expectedToken) throw new Error('Premiere did not confirm the caption undo step.');
                verified = true;
                return reply({ ok: true, revision: after.revision, documentText: after.documentText, maxChars: after.maxChars, undoIndex: nativeUndoIndex(), readbackVerified: true, renderVerified: false, retry: 'never' });
            }
            // A typing fast step: UXP already committed the edit token stepToken as the
            // undo step. Write its document unless Premiere Undo moved the token away
            // (or a read already restored it), then verify, in one call.
            if (phase === 'step') {
                if (grouping !== undefined || typeof snapshot.stepToken !== 'number' || !isFinite(snapshot.stepToken)) throw new Error('Invalid caption typing step.');
                var current = nativeLocatedDocument(p, target);
                if (current.record.editToken !== snapshot.stepToken) return reply({ ok: false, stale: true });
                if (current.record.documentText !== p.documentText) {
                    if (current.record.revision !== snapshot.revision) throw new Error('The native caption revision changed. Read it again before editing.');
                    attempted = true;
                    current.param.setValue(p.documentText, 1);
                }
                attempted = true;
                var stepped = nativeLocatedDocument(p, target).record, stepExpected = parseJSON(snapshot.revision); stepExpected.documentText = p.documentText;
                if (stepped.documentText !== p.documentText || stepped.revision !== stringify(stepExpected) || stepped.editToken !== snapshot.stepToken) throw new Error('Premiere did not confirm the native caption document readback.');
                verified = true;
                return reply({ ok: true, revision: stepped.revision, documentText: stepped.documentText, maxChars: stepped.maxChars, undoIndex: nativeUndoIndex(), readbackVerified: true, renderVerified: false, retry: 'never' });
            }
            // Gives the layer's current document a remembered edit token before typing.
            if (phase === 'seed') {
                if (typeof snapshot.seedToken !== 'number' || !isFinite(snapshot.seedToken)) throw new Error('Invalid caption undo token.');
                var seeding = nativeLocatedDocument(p, target);
                if (seeding.record.revision !== snapshot.revision || seeding.record.editToken !== snapshot.expectToken) return reply({ ok: false, stale: true });
                seeding.guideParam.setValue(snapshot.seedToken, 1);
                if (nativeLocatedDocument(p, target).record.editToken !== snapshot.seedToken) throw new Error('Premiere did not confirm the caption undo token.');
                return reply({ ok: true, undoIndex: nativeUndoIndex() });
            }
            if (phase !== 'prepare' && phase !== 'write') throw new Error('Invalid native caption write phase.');
            var before = nativeLocatedDocument(p, target);
            if (before.record.revision !== snapshot.revision) throw new Error('The native caption revision changed. Read it again before editing.');
            if (grouping !== undefined && (before.record.maxChars !== grouping.before || !before.groupingParam)) throw new Error('The character limit changed or is animated. Reconnect before editing.');
            // A regroup alone must leave the embedded transcript bytes untouched.
            var documentChanged = !(before.record.documentText === p.documentText && grouping !== undefined);
            if (phase === 'prepare') {
                var writes = [];
                if (grouping !== undefined && grouping.value !== grouping.before) writes.push({ index: nativePropertyIndex(before.propertyTable, 'Characters per line', 'Ambiguous native caption character limits.'), label: 'Characters per line', value: grouping.value, point: false, atTicks: null });
                return reply({ ok: true, target: nativeUxpTarget(before), writes: writes, documentChanged: documentChanged, token: before.record.editToken === undefined ? null : { index: before.guideIndex, value: before.record.editToken }, undoIndex: nativeUndoIndex() });
            }
            // Premiere Undo/Redo since prepare: write nothing; the panel follows it.
            if (snapshot.expectToken !== undefined && before.record.editToken !== snapshot.expectToken || snapshot.expectUndoIndex !== undefined && nativeUndoIndex() !== snapshot.expectUndoIndex) return reply({ ok: false, stale: true });
            attempted = true;
            if (snapshot.seedToken !== undefined) {
                if (before.record.editToken === undefined || typeof snapshot.seedToken !== 'number' || !isFinite(snapshot.seedToken)) throw new Error('Invalid caption undo token.');
                before.guideParam.setValue(snapshot.seedToken, 1);
            }
            if (documentChanged) before.param.setValue(p.documentText, 1);
            return reply({ ok: true });
        } catch (e) {
            if (attempted) return reply({ error: 'Premiere did not confirm the last native caption update. Inspect it before another write.', code: 'BC_OUTPUT_UNCONFIRMED', recoverable: false, outputApplied: verified, retry: 'never' });
            return reply({ error: e.toString() });
        }
    }
    // Premiere's undo position, from the QE DOM. Null when QE is unavailable, so
    // typing steps are then never merged.
    function nativeUndoIndex() {
        try {
            if (typeof app.enableQE === 'function') app.enableQE();
            if (typeof qe === 'undefined' || !qe.project || typeof qe.project.undoStackIndex !== 'function') return null;
            var index = Number(qe.project.undoStackIndex());
            return isFinite(index) ? index : null;
        } catch (e) { return null; }
    }
    // Steps Premiere's history back over the panel's own typing steps, so they can
    // be merged into one. positions[0] is the target and the others are the known
    // undo positions above it, oldest first: { index: undo position, token }. The
    // layer must be at one of them, and every undo must land on the next lower one.
    // On any mismatch it redoes what it undid and reports without merging.
    function undoNativeCaptionSteps(file) {
        try {
            var p = readPayload(file), positions = p.positions;
            if (!(positions instanceof Array) || positions.length < 1 || positions.length > 500) throw new Error('Invalid caption undo positions.');
            for (var i = 0; i < positions.length; i++) if (!positions[i] || typeof positions[i].index !== 'number' || !isFinite(positions[i].index) || typeof positions[i].token !== 'number' || !isFinite(positions[i].token)) throw new Error('Invalid caption undo position.');
            if (p.baseDocument !== null) boundedNativeCarrier(p.baseDocument);
            var state = function () { var located = nativeLocatedDocument(p, p.locator); return { index: nativeUndoIndex(), token: located.record.editToken, located: located }; };
            var now = state();
            if (now.index === null || typeof qe.project.undo !== 'function' || typeof qe.project.redo !== 'function') return reply({ ok: true, undone: 0, reason: 'unavailable' });
            var from = -1;
            for (var f = 0; f < positions.length; f++) if (positions[f].index === now.index && positions[f].token === now.token) from = f;
            if (from < 0) return reply({ ok: true, undone: 0, reason: 'moved', undoIndex: now.index, editToken: now.token === undefined ? null : now.token });
            var undone = 0;
            for (var u = from - 1; u >= 0; u--) {
                qe.project.undo(); undone++;
                now = state();
                if (now.index !== positions[u].index || now.token !== positions[u].token) {
                    for (var r = 0; r < undone; r++) qe.project.redo();
                    now = state();
                    return reply({ ok: true, undone: 0, reason: 'mismatch', rolledBack: now.index === positions[from].index && now.token === positions[from].token });
                }
            }
            if (p.baseDocument !== null && now.located.record.documentText !== p.baseDocument) {
                now.located.param.setValue(p.baseDocument, 1);
                now = state();
                if (now.located.record.documentText !== p.baseDocument) throw new Error('Premiere did not confirm the restored caption document.');
            }
            return reply({ ok: true, undone: undone, undoIndex: now.index, revision: now.located.record.revision });
        } catch (e) { return reply({ error: e.toString() }); }
    }
    // Test hook only (scripts/agent.cjs test_history): one QE Undo or Redo, as Cmd+Z would.
    function stepNativeHistoryForTest(file) {
        try {
            var p = readPayload(file);
            if (p.direction !== 'undo' && p.direction !== 'redo') throw new Error('Invalid history direction.');
            var before = nativeUndoIndex();
            if (before === null) throw new Error('Premiere QE history is unavailable.');
            if (p.direction === 'undo') qe.project.undo(); else qe.project.redo();
            return reply({ ok: true, before: before, undoIndex: nativeUndoIndex() });
        } catch (e) { return reply({ error: e.toString() }); }
    }
    // Premiere Undo/Redo put back an earlier edit token: restore its document.
    // Never a history step of its own, and a no-op once the document matches.
    function restoreNativeCaptionDocument(file) {
        try {
            var p = readPayload(file);
            if (typeof p.token !== 'number' || !isFinite(p.token)) throw new Error('Invalid caption undo token.');
            boundedNativeCarrier(p.documentText);
            var before = nativeLocatedDocument(p, p.locator);
            var token = before.record.editToken === undefined ? null : before.record.editToken;
            if (before.record.editToken !== p.token || before.record.documentText === p.documentText) return reply({ ok: true, restored: false, editToken: token, undoIndex: nativeUndoIndex() });
            before.param.setValue(p.documentText, 1);
            if (nativeLocatedDocument(p, p.locator).record.documentText !== p.documentText) throw new Error('Premiere did not confirm the restored caption document.');
            return reply({ ok: true, restored: true, editToken: token, undoIndex: nativeUndoIndex() });
        } catch (e) { return reply({ error: e.toString() }); }
    }
    return { clearExpiredNativeCaptionGuides: clearExpiredNativeCaptionGuides, readNativeCaptionExtension: readNativeCaptionExtension, extendNativeCaptionDocument: extendNativeCaptionDocument, seekNativeCaptionKeyframe: seekNativeCaptionKeyframe, readNativeCaptionControls: readNativeCaptionControls, editNativeCaptionControl: editNativeCaptionControl, createNativeCaptionDocument: createNativeCaptionDocument, readCaptionConnections: readCaptionConnections, writeNativeCaptionDocument: writeNativeCaptionDocument, restoreNativeCaptionDocument: restoreNativeCaptionDocument, undoNativeCaptionSteps: undoNativeCaptionSteps, stepNativeHistoryForTest: stepNativeHistoryForTest, readCaptionConsolidation: readCaptionConsolidation, stageCaptionConsolidation: stageCaptionConsolidation, verifyCaptionConsolidation: verifyCaptionConsolidation, rollbackCaptionConsolidation: rollbackCaptionConsolidation, context: context, seek: seek, selectCaptionClip: selectCaptionClip, readCaptionSelection: readCaptionSelection, readCaptionGeometry: readCaptionGeometry, readCaptionMotion: readCaptionMotion, readCaptionAreaDescriptor: readCaptionAreaDescriptor, patchCaptionKeyValues: patchCaptionKeyValues, preflight: preflight, prepareCaptionTrack: prepareCaptionTrack, apply: apply, readTimeline: readTimeline };
})();
