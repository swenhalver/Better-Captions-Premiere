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
    function motionProfile(clip, firstFrame, count, tpf) {
        assertNormalSpeed(clip);
        var params = motionParameters(clip), height = copyCurve(parameterCurve(params.height), 'height'), width = copyCurve(parameterCurve(params.width), 'width'), uniform = copyCurve(parameterCurve(params.uniform), 'uniform'), samples = [], values = [], fps = TICKS / tpf;
        var sourceIn = Number(clip.inPoint.ticks);
        if (!isFinite(sourceIn) || sourceIn < 0) throw new Error('The caption has an invalid source in point.');
        for (var frame = 0; frame < count; frame++) {
            // Effect keys use the clip's source clock, independent of its
            // position on the sequence or the current playhead.
            var at = height.animated || width.animated || uniform.animated ? ticksTime(Math.round(sourceIn + (frame + 0.5) * tpf)) : null;
            var locked = parameterAt(params.uniform, uniform, at), sy = Number(parameterAt(params.height, height, at)) / 100;
            if (!(locked === true || locked === false || locked === 0 || locked === 1)) throw new Error('Premiere returned an invalid Uniform Scale value.');
            var sx = locked ? sy : Number(parameterAt(params.width, width, at)) / 100;
            if (!isFinite(sx) || !isFinite(sy) || sx < 0.01 || sy < 0.01 || sx > 100 || sy > 100) throw new Error('Caption box width and height must remain between 1% and 10000%.');
            samples.push({ time: (firstFrame + frame + 0.5) / fps, scaleX: sx, scaleY: sy }); values.push([sx, sy]);
        }
        // ExtendScript has no interpolation-mode getter. Evaluating every
        // output frame captures interpolation changes affecting the video.
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
    function fragmentProfile(parts, firstFrame, count, tpf) {
        assertFragmentRange(parts, firstFrame, count, tpf);
        var samples = [], signatures = [];
        for (var i = 0; i < parts.length; i++) {
            var clip = parts[i].clip, first = Math.round(Number(clip.start.ticks) / tpf), frames = Math.round((Number(clip.end.ticks) - Number(clip.start.ticks)) / tpf), profile = motionProfile(clip, first, frames, tpf);
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
                var requestedStart = typeof caption.startTime === 'number' ? caption.startTime : fragments ? fragments[0].clip.start.seconds : clip.start.seconds, requestedEnd = typeof caption.endTime === 'number' ? caption.endTime : fragments ? fragments[fragments.length - 1].clip.end.seconds : clip.end.seconds;
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
        try {
            var p = readPayload(file);
            if (!p.sequenceId || !p.projectPath || !p.cues || !p.cues.length || p.cues.length > 10000) throw new Error('Invalid caption Motion request.');
            var s = sequence(p.sequenceId, p.projectPath), tpf = Number(s.timebase), fps = TICKS / tpf, out = [], totalFrames = 0;
            if (!isFinite(tpf) || tpf <= 0) throw new Error('The sequence has an invalid frame rate.');
            for (var i = 0; i < p.cues.length; i++) {
                var caption = p.cues[i], found = caption.clipNodeId ? findClip(s, caption.clipNodeId) : null;
                if (!found || !caption.id || !caption.projectItemId || !sameNode(found.clip.projectItem.nodeId, caption.projectItemId) || found.clip.projectItem.getMediaPath() !== caption.mediaPath) throw new Error('The caption timeline link changed. Sync timing from Premiere before reading its box size.');
                var clip = found.clip, fragments = captionFragments(s, caption, caption.mediaPath, found);
                var requestedStart = typeof caption.startTime === 'number' ? caption.startTime : fragments ? fragments[0].clip.start.seconds : clip.start.seconds, requestedEnd = typeof caption.endTime === 'number' ? caption.endTime : fragments ? fragments[fragments.length - 1].clip.end.seconds : clip.end.seconds;
                if (!isFinite(requestedStart) || !isFinite(requestedEnd) || requestedStart < 0 || requestedEnd <= requestedStart) throw new Error('The caption has invalid box-animation timing.');
                var firstFrame = Math.floor(requestedStart * fps + 0.0000001), endFrame = Math.ceil(requestedEnd * fps - 0.0000001), count = endFrame - firstFrame;
                totalFrames += count;
                if (count < 1 || totalFrames > 100000) throw new Error('Read caption box animation in smaller batches of at most 100000 frames.');
                var result = { id: caption.id, clipNodeId: String(clip.nodeId), projectItemId: String(clip.projectItem.nodeId), path: clip.projectItem.getMediaPath(), motionProfile: fragments ? fragmentProfile(fragments, firstFrame, count, tpf) : motionProfile(clip, firstFrame, count, tpf) };
                if (fragments) result.bundleFragments = fragmentReceipt(fragments);
                if (p.includeDiagnostics === true) {
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
            return reply({ ok: true, cues: out });
        } catch (e) { return reply({ error: e.toString() }); }
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
            var clip = found.clip, b = renderBounds(cue.renderBounds, s), motion = motionState(clip);
            ids[String(clip.nodeId)] = true; assertNormalSpeed(clip);
            if (s.videoTracks[found.track].isLocked() || s.videoTracks[found.track].transitions && s.videoTracks[found.track].transitions.numItems) throw new Error('Unlock the legacy caption track and remove its transitions before combining clips.');
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
    function linkIdentity(cue) {
        function identity(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f]/.test(value); }
        if (!cue || !identity(cue.id) || !identity(cue.clipNodeId) || !identity(cue.projectItemId) || typeof cue.mediaPath !== 'string' || cue.mediaPath.length > 4096 || !/^(?:\/(?!\/)|[a-z]:[\\/])/i.test(cue.mediaPath) || /[\u0000-\u001f]/.test(cue.mediaPath) || /(?:^|[\\/])\.{1,2}(?:[\\/]|$)/.test(cue.mediaPath)) throw new Error('A caption timeline link is incomplete. Sync timing from Premiere before updating it.');
    }
    function comparableMediaPath(path) {
        // Drive paths are case-insensitive on supported Windows installs;
        // macOS/POSIX paths retain case to avoid identifying unrelated media.
        return /^[a-z]:[\\/]/i.test(path) ? path.replace(/\\/g, '/').toLowerCase() : path;
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
            planned.push({ cue: cue, located: found, track: trackIndex, startFrame: cue.startFrame, endFrame: cue.endFrame, geometry: geometry, bounds: bounds, fragments: fragments, fragmentReceipt: fragments ? fragmentReceipt(fragments) : null, bundleReceipt: cue.captionBundle === true && found ? fragmentReceipt(fragments || [found]) : null, fragmentMotions: fragmentMotions, fragmentGeometry: fragmentGeometryPlans });
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
    return { readCaptionConsolidation: readCaptionConsolidation, stageCaptionConsolidation: stageCaptionConsolidation, verifyCaptionConsolidation: verifyCaptionConsolidation, rollbackCaptionConsolidation: rollbackCaptionConsolidation, context: context, seek: seek, selectCaptionClip: selectCaptionClip, readCaptionSelection: readCaptionSelection, readCaptionGeometry: readCaptionGeometry, readCaptionMotion: readCaptionMotion, readCaptionAreaDescriptor: readCaptionAreaDescriptor, patchCaptionKeyValues: patchCaptionKeyValues, preflight: preflight, prepareCaptionTrack: prepareCaptionTrack, apply: apply, readTimeline: readTimeline };
})();
