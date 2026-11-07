// Marks on the battle map that the players and the DM share: pings (a pulsing ring that fades), freehand drawings, and notes
// pinned to a spot. Used by both dm.html and index.html. Pings travel over a live Supabase channel and are never saved; drawings
// and notes are rows in map_marks (see supabase/migrations/20261028_map_marks.sql), fetched every few seconds and pushed live too.
//
// Each page attaches itself once with MapMarks.attach({...}) and then calls MapMarks.setMap(id) whenever the open map changes.
// Positions are in cell units (x = column, y = row from the top), the same units free objects use, so they sit on the right
// spot at any zoom and on a windowed map.
(function (root) {
    'use strict';
    const MM = {};
    const ROLE_HEX = { blue: '#2f7fd1', green: '#3a9d4d', amber: '#d99a1e', purple: '#8a55c9', red: '#d04545', teal: '#1fa5a0' };
    MM.roleColor = r => ROLE_HEX[r] || (/^#[0-9a-f]{3,8}$/i.test(r || '') ? r : '#4a4ba2');

    let cfg = null, mapId = null, marks = [], channel = null, chanMap = null, timer = null, mode = null, persist = true;
    let drawing = null, tmpN = 0, openCard = null;
    const ui = { layer: null, svg: null, pins: null, pings: null, cap: null, bar: null, panel: null, editor: null };

    const CSS = `
.mm-layer{position:absolute;left:0;top:0;right:0;bottom:0;z-index:6;pointer-events:none}
.mm-layer svg{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible}
.mm-cap{position:absolute;left:0;top:0;right:0;bottom:0;z-index:9;display:none;touch-action:none;user-select:none;-webkit-user-select:none}
.mm-ping{position:absolute;width:0;height:0}
.mm-ping i{position:absolute;left:-14px;top:-14px;width:28px;height:28px;border:3px solid var(--c);border-radius:50%;animation:mmPing 1.6s ease-out 3;opacity:0}
.mm-ping i+i{animation-delay:.5s}
.mm-ping b{position:absolute;left:0;top:18px;transform:translateX(-50%);font:600 11px/1.3 sans-serif;color:#fff;background:var(--c);padding:1px 7px;border-radius:9px;white-space:nowrap;text-shadow:0 1px 1px rgba(0,0,0,.4)}
@keyframes mmPing{0%{transform:scale(.3);opacity:1}100%{transform:scale(2.6);opacity:0}}
.mm-pin{position:absolute;width:20px;height:24px;margin:-24px 0 0 -10px;pointer-events:auto;cursor:pointer}
.mm-pin::before{content:'';position:absolute;left:0;top:0;width:20px;height:20px;background:var(--c);border:2px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 1px 4px rgba(0,0,0,.45);box-sizing:border-box}
.mm-pin::after{content:'';position:absolute;left:5px;top:5px;width:10px;height:2px;background:#fff;box-shadow:0 3px 0 #fff,0 6px 0 #fff}
.mm-pin.mm-private{opacity:.78}
.mm-card{position:absolute;left:14px;top:-4px;min-width:150px;max-width:230px;background:#fffdf5;color:#2a2118;border:1px solid #8a7355;border-radius:6px;padding:8px 10px;font:13px/1.4 sans-serif;box-shadow:0 3px 10px rgba(0,0,0,.35);z-index:3;white-space:normal;cursor:default;pointer-events:auto}
.mm-card .mm-who{font-size:11px;color:#7a6a50;margin-bottom:3px}
.mm-card .mm-txt{white-space:pre-wrap;word-wrap:break-word}
.mm-card .mm-acts{display:flex;gap:6px;margin-top:7px;flex-wrap:wrap}
.mm-card button,.mm-editor button{font:12px sans-serif;padding:3px 9px;border:1px solid #8a7355;border-radius:5px;background:#f3ead6;color:#2a2118;cursor:pointer}
.mm-editor{position:absolute;z-index:10;width:220px;background:#fffdf5;color:#2a2118;border:1px solid #8a7355;border-radius:6px;padding:8px;font:13px/1.4 sans-serif;box-shadow:0 3px 10px rgba(0,0,0,.4)}
.mm-editor textarea{width:100%;height:64px;box-sizing:border-box;font:13px/1.4 sans-serif;resize:vertical}
.mm-editor label{display:flex;align-items:center;gap:5px;font-size:12px;margin:5px 0}
.mm-editor .mm-acts{display:flex;gap:6px}
.mm-panel{position:absolute;z-index:50;background:#fffdf5;color:#2a2118;border:1px solid #8a7355;border-radius:6px;padding:10px 12px;font:13px/1.45 sans-serif;box-shadow:0 3px 12px rgba(0,0,0,.35);min-width:230px}
.mm-panel label{display:flex;align-items:center;gap:6px;margin:3px 0}
.mm-panel button{font:12px sans-serif;padding:3px 9px;margin:6px 6px 0 0;border:1px solid #8a7355;border-radius:5px;background:#f3ead6;color:#2a2118;cursor:pointer}
.mm-bar{display:inline-flex;gap:4px;align-items:center;position:relative;flex-wrap:wrap}
.mm-bar button.mm-on{background:#4a4ba2;color:#fff;border-color:#4a4ba2}
body.map-exporting .mm-layer,body.map-exporting .mm-cap{display:none!important}
`;

    function injectCss() {
        if (document.getElementById('mm-css')) return;
        const s = document.createElement('style'); s.id = 'mm-css'; s.textContent = CSS; document.head.appendChild(s);
    }
    const me = () => cfg.identity();
    const S = () => cfg.step();
    const off = () => cfg.offset();
    const px = (x, y) => { const o = off(), s = S(); return [(x - o.c + 1) * s, (y - o.r + 1) * s]; };
    function units(e) {
        const grid = cfg.grid(), rect = grid.getBoundingClientRect(), s = S(), o = off();
        const k = grid.offsetWidth ? rect.width / grid.offsetWidth : 1; // the map's zoom
        return { x: (e.clientX - rect.left) / (s * k) - 1 + o.c, y: (e.clientY - rect.top) / (s * k) - 1 + o.r };
    }
    function perms() { const p = cfg.getPerms ? cfg.getPerms() : null; return { ping: !p || p.ping !== false, draw: !p || p.draw !== false, note: !p || p.note !== false }; }
    function say(msg) { if (cfg && cfg.status) cfg.status(msg); }
    function isMine(row) { const m = me(); return row.owner_player_name === m.player && (m.dm || row.owner_character_name === m.character); }
    function canSee(row) { return row.kind === 'draw' || row.shared || isMine(row); }
    function canErase(row) { return me().dm || isMine(row); }
    function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

    // ---------- layers ----------
    function ensureLayers() {
        const paper = cfg.grid().parentNode;
        if (ui.layer && ui.layer.parentNode === paper) return;
        ui.layer = document.createElement('div'); ui.layer.className = 'mm-layer';
        ui.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        ui.pins = document.createElement('div'); ui.pings = document.createElement('div');
        ui.layer.appendChild(ui.svg); ui.layer.appendChild(ui.pins); ui.layer.appendChild(ui.pings);
        ui.cap = document.createElement('div'); ui.cap.className = 'mm-cap';
        paper.appendChild(ui.layer); paper.appendChild(ui.cap);
        ui.cap.addEventListener('pointerdown', onDown);
        ui.cap.addEventListener('pointermove', onMove);
        ui.cap.addEventListener('pointerup', onUp);
        ui.cap.addEventListener('pointercancel', onUp);
        ui.cap.addEventListener('contextmenu', e => e.preventDefault());
    }

    function lineHtml(pts, color, w, id) {
        if (!pts || !pts.length) return '';
        const p = pts.length === 1 ? [pts[0], [pts[0][0] + 0.01, pts[0][1]]] : pts;
        return '<polyline' + (id ? ' data-id="' + esc(id) + '"' : '') + ' points="' + p.map(q => px(q[0], q[1]).map(v => Math.round(v * 10) / 10).join(',')).join(' ') + '" fill="none" stroke="' + esc(color) + '" stroke-width="' + (w || 3) + '" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>';
    }

    MM.render = function () {
        if (!cfg) return;
        ensureLayers();
        const seen = marks.filter(canSee);
        ui.svg.innerHTML = seen.filter(r => r.kind === 'draw' && r.data && r.data.pts).map(r => lineHtml(r.data.pts, r.color, r.data.w, r.id)).join('') + (drawing ? lineHtml(drawing.pts, drawing.color, 3) : '');
        const keepCard = openCard;
        ui.pins.innerHTML = '';
        seen.filter(r => r.kind === 'note' && r.data).forEach(r => {
            const p = px(r.data.x, r.data.y), el = document.createElement('div');
            el.className = 'mm-pin' + (r.shared ? '' : ' mm-private');
            el.style.cssText = 'left:' + p[0] + 'px;top:' + p[1] + 'px;--c:' + r.color;
            el.dataset.id = r.id;
            el.title = (r.shared ? '' : 'Private note: only you can see it. ') + 'Click to read';
            el.addEventListener('click', ev => { ev.stopPropagation(); toggleCard(r.id); });
            el.addEventListener('pointerdown', ev => ev.stopPropagation());
            ui.pins.appendChild(el);
        });
        if (keepCard) toggleCard(keepCard, true);
        MM.syncBar();
    };

    function toggleCard(id, forceOpen) {
        const row = marks.find(r => r.id === id), pin = Array.from(ui.pins.children).find(q => q.dataset.id === String(id));
        ui.pins.querySelectorAll('.mm-card').forEach(c => c.remove());
        if (!row || !pin || (!forceOpen && openCard === id)) { openCard = null; return; }
        openCard = id;
        const card = document.createElement('div'); card.className = 'mm-card';
        const who = row.owner_character_name || row.owner_player_name || 'Someone';
        card.innerHTML = '<div class="mm-who">' + esc(row.owner_player_name === '__dm__' ? 'DM' : who) + (row.shared ? '' : ' (private)') + '</div><div class="mm-txt">' + esc(row.data.text) + '</div>';
        if (canErase(row)) {
            const acts = document.createElement('div'); acts.className = 'mm-acts';
            if (isMine(row)) {
                const sh = document.createElement('button'); sh.type = 'button'; sh.textContent = row.shared ? 'Make private' : 'Share';
                sh.onclick = ev => { ev.stopPropagation(); setShared(row, !row.shared); };
                acts.appendChild(sh);
            }
            const del = document.createElement('button'); del.type = 'button'; del.textContent = 'Delete';
            del.onclick = ev => { ev.stopPropagation(); openCard = null; removeRow(row); };
            acts.appendChild(del);
            card.appendChild(acts);
        }
        if (parseFloat(pin.style.left) > cfg.grid().parentNode.offsetWidth - 250) { card.style.left = 'auto'; card.style.right = '14px'; } // near the right edge: open to the left
        card.addEventListener('pointerdown', ev => ev.stopPropagation());
        card.addEventListener('click', ev => ev.stopPropagation());
        pin.appendChild(card);
    }

    // ---------- pings ----------
    function showPing(p) {
        if (!ui.pings || !p || typeof p.x !== 'number') return;
        const q = px(p.x, p.y), el = document.createElement('div');
        el.className = 'mm-ping'; el.style.cssText = 'left:' + q[0] + 'px;top:' + q[1] + 'px;--c:' + MM.roleColor(p.color);
        el.innerHTML = '<i></i><i></i><b>' + esc(p.name || '') + '</b>';
        ui.pings.appendChild(el);
        setTimeout(() => el.remove(), 5200);
    }
    function sendPing(pos) {
        const m = me(), payload = { x: Math.round(pos.x * 100) / 100, y: Math.round(pos.y * 100) / 100, color: m.color, name: m.dm ? 'DM' : (m.character || m.player || '') };
        showPing(payload);
        if (channel) { try { channel.send({ type: 'broadcast', event: 'ping', payload }); } catch (e) { /* the ring still shows here */ } }
    }
    MM.ping = sendPing;

    // ---------- saving ----------
    function tableMissing(err) { return err && (err.code === '42P01' || err.code === 'PGRST205' || /map_marks/.test(err.message || '')); }
    function noTable() {
        persist = false;
        say('Drawings and notes are not set up yet: the map_marks table is missing. Pings still work.');
    }
    async function insertRow(row) {
        if (!persist || !mapId) { noTable(); return; }
        const tmp = Object.assign({ id: 'tmp' + (++tmpN) }, row);
        marks.push(tmp); MM.render();
        const { data, error } = await cfg.sb.from('map_marks').insert(Object.assign({ map_id: mapId }, row)).select().single();
        const i = marks.indexOf(tmp);
        if (error || !data) {
            if (i >= 0) marks.splice(i, 1);
            if (tableMissing(error)) noTable(); else say('Could not save that: ' + ((error && error.message) || 'unknown error'));
            MM.render(); return;
        }
        if (i >= 0) marks[i] = data;
        MM.render();
        if (data.kind === 'draw' || data.shared) send('mark', { row: data }); // a private note is never sent to the others
    }
    async function removeRow(row) {
        const i = marks.indexOf(row);
        if (i >= 0) marks.splice(i, 1);
        MM.render();
        if (String(row.id).startsWith('tmp')) return;
        const { error } = await cfg.sb.from('map_marks').delete().eq('id', row.id);
        if (error) { say('Could not delete that: ' + error.message); MM.refresh(); return; }
        send('unmark', { id: row.id });
    }
    async function setShared(row, shared) {
        row.shared = shared; MM.render();
        const { error } = await cfg.sb.from('map_marks').update({ shared }).eq('id', row.id);
        if (error) { say('Could not change that: ' + error.message); row.shared = !shared; MM.render(); return; }
        send('mark', { row });
        if (!shared) send('unmark', { id: row.id, except: row.owner_player_name });
    }
    function send(event, payload) { if (channel) { try { channel.send({ type: 'broadcast', event, payload }); } catch (e) { /* the poll catches up */ } } }

    // ---------- live channel and polling ----------
    function ensureChannel() {
        if (chanMap === mapId) return;
        if (channel) { try { cfg.sb.removeChannel(channel); } catch (e) { /* gone */ } channel = null; }
        chanMap = mapId;
        if (!mapId || !cfg.sb.channel) return;
        try {
            channel = cfg.sb.channel('map-marks-' + mapId, { config: { broadcast: { self: false } } })
                .on('broadcast', { event: 'ping' }, m => showPing(m.payload))
                .on('broadcast', { event: 'mark' }, m => { const r = m.payload && m.payload.row; if (!r) return; const i = marks.findIndex(q => q.id === r.id); if (i >= 0) marks[i] = r; else marks.push(r); MM.render(); })
                .on('broadcast', { event: 'unmark' }, m => { const p = m.payload || {}; if (p.except && !me().dm && me().player === p.except) return; const n = marks.length; marks = marks.filter(q => q.id !== p.id); if (n !== marks.length) MM.render(); })
                .on('broadcast', { event: 'clear' }, m => { const p = m.payload || {}; marks = marks.filter(q => q.kind !== p.kind); MM.render(); })
                .subscribe();
        } catch (e) { channel = null; }
    }
    MM.refresh = async function () {
        if (!cfg || !mapId || !persist || drawing) return;
        const id = mapId;
        const { data, error } = await cfg.sb.from('map_marks').select('*').eq('map_id', id);
        if (id !== mapId) return;
        if (error) { if (tableMissing(error)) noTable(); return; }
        marks = (data || []).concat(marks.filter(r => String(r.id).startsWith('tmp')));
        MM.render();
    };
    MM.setMap = function (id) {
        if (!cfg) return;
        id = id || null;
        if (id === mapId) { MM.render(); return; }
        mapId = id; marks = []; persist = true;
        ensureChannel();
        clearInterval(timer); timer = null;
        if (id) { MM.refresh(); timer = setInterval(() => { if (!document.hidden) MM.refresh(); }, 4000); }
        MM.render();
    };
    MM.stop = function () {
        clearInterval(timer); timer = null;
        if (channel && cfg) { try { cfg.sb.removeChannel(channel); } catch (e) { /* gone */ } }
        channel = null; chanMap = null; mapId = null; marks = []; setMode(null);
        if (ui.svg) { ui.svg.innerHTML = ''; ui.pins.innerHTML = ''; ui.pings.innerHTML = ''; }
    };

    // ---------- tools ----------
    function setMode(m) {
        if (m && mode === m) m = null;
        if (m && !(m === 'erase' ? (perms().draw || perms().note || me().dm) : perms()[m] || me().dm)) m = null;
        mode = m; closeEditor();
        if (ui.cap) { ui.cap.style.display = m ? 'block' : 'none'; ui.cap.style.cursor = m === 'ping' ? 'crosshair' : m === 'draw' ? 'crosshair' : m === 'note' ? 'copy' : m === 'erase' ? 'not-allowed' : ''; }
        if (m) say({ ping: 'Ping: click or tap a spot and everyone sees a ring there.', draw: 'Draw: hold and drag to sketch on the map for everyone.', note: 'Note: click a spot to pin a note there.', erase: 'Erase: click one of ' + (me().dm ? 'the' : 'your') + ' drawings to remove it.' }[m] + ' Click the button again to stop.');
        MM.syncBar();
    }
    MM.setMode = setMode;

    function onDown(e) {
        if (!mode) return;
        e.preventDefault(); e.stopPropagation();
        const p = units(e);
        if (mode === 'ping') { sendPing(p); return; }
        if (mode === 'draw') {
            try { ui.cap.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
            drawing = { pts: [[Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]], color: me().color };
            MM.render(); return;
        }
        if (mode === 'note') { openEditor(p, e); return; }
        if (mode === 'erase') eraseAt(p);
    }
    function onMove(e) {
        if (!drawing) return;
        const p = units(e), last = drawing.pts[drawing.pts.length - 1];
        if (Math.hypot(p.x - last[0], p.y - last[1]) < 0.1 || drawing.pts.length >= 600) return;
        drawing.pts.push([Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]);
        MM.render();
    }
    function onUp() {
        if (!drawing) return;
        const d = drawing; drawing = null;
        let pts = d.pts;
        if (pts.length > 240) { const k = Math.ceil(pts.length / 240); pts = pts.filter((q, i) => i % k === 0 || i === pts.length - 1); }
        const m = me();
        insertRow({ kind: 'draw', owner_player_name: m.player, owner_character_name: m.character, color: d.color, shared: true, data: { pts, w: 3 } });
    }
    function distToLine(p, pts) {
        let best = Infinity;
        for (let i = 0; i < Math.max(1, pts.length - 1); i++) {
            const a = pts[i], b = pts[i + 1] || pts[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
            const t = l2 ? Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / l2)) : 0;
            best = Math.min(best, Math.hypot(p.x - (a[0] + t * dx), p.y - (a[1] + t * dy)));
        }
        return best;
    }
    function eraseAt(p) {
        let hit = null, best = 0.5;
        marks.forEach(r => { if (r.kind !== 'draw' || !r.data || !canErase(r)) return; const d = distToLine(p, r.data.pts); if (d < best) { best = d; hit = r; } });
        if (hit) removeRow(hit); else say('Nothing of ' + (me().dm ? 'the players\'' : 'yours') + ' there. Click right on a line.');
    }

    // ---------- note editor ----------
    function closeEditor() { if (ui.editor) { ui.editor.remove(); ui.editor = null; } }
    function openEditor(pos, e) {
        closeEditor();
        const paper = cfg.grid().parentNode, q = px(pos.x, pos.y), m = me();
        const box = document.createElement('div'); box.className = 'mm-editor';
        const flip = q[0] > paper.offsetWidth - 240;
        box.style.left = Math.max(4, flip ? q[0] - 230 : q[0] + 8) + 'px'; box.style.top = Math.max(4, q[1] - 10) + 'px';
        box.innerHTML = '<textarea maxlength="500" placeholder="Write a note for this spot"></textarea>' +
            '<label><input type="checkbox" class="mm-share"' + (m.dm ? ' checked' : '') + '> ' + (m.dm ? 'Show the players' : 'Share with the party') + '</label>' +
            '<div class="mm-acts"><button type="button" class="mm-save">Pin it</button><button type="button" class="mm-cancel">Cancel</button></div>';
        paper.appendChild(box); ui.editor = box;
        const ta = box.querySelector('textarea'); setTimeout(() => ta.focus(), 0);
        box.addEventListener('pointerdown', ev => ev.stopPropagation());
        box.querySelector('.mm-cancel').onclick = closeEditor;
        box.querySelector('.mm-save').onclick = () => {
            const text = ta.value.trim();
            if (!text) { closeEditor(); return; }
            const shared = box.querySelector('.mm-share').checked;
            closeEditor();
            insertRow({ kind: 'note', owner_player_name: m.player, owner_character_name: m.character, color: m.color, shared, data: { x: Math.round(pos.x * 100) / 100, y: Math.round(pos.y * 100) / 100, text } });
        };
    }

    // ---------- toolbar ----------
    MM.buildBar = function (el) {
        if (!cfg || !el) return;
        ui.bar = el; el.classList.add('mm-bar'); el.innerHTML = '';
        const mk = (id, label, title) => { const b = document.createElement('button'); b.type = 'button'; b.className = cfg.btnClass || 'pill-btn'; b.dataset.mm = id; b.textContent = label; b.title = title; b.onclick = () => setMode(id); el.appendChild(b); return b; };
        mk('ping', 'Ping', 'Click a spot to show everyone a pulsing ring there');
        mk('draw', 'Draw', 'Sketch on the map; everyone sees it');
        mk('note', 'Note', 'Pin a note to a spot on the map');
        mk('erase', 'Erase', me().dm ? 'Click a player\'s drawing to remove it' : 'Click one of your drawings to remove it');
        if (me().dm) { const b = document.createElement('button'); b.type = 'button'; b.className = cfg.btnClass || 'pill-btn'; b.dataset.mm = 'panel'; b.textContent = 'Player marks'; b.title = 'What players may do, and clearing their drawings'; b.onclick = togglePanel; el.appendChild(b); }
        MM.syncBar();
    };
    MM.syncBar = function () {
        if (!ui.bar || !cfg) return;
        const p = perms(), dm = me().dm;
        ui.bar.querySelectorAll('button[data-mm]').forEach(b => {
            const k = b.dataset.mm;
            if (k === 'panel') return;
            const ok = dm || (k === 'erase' ? (p.draw || p.note) : p[k]);
            b.style.display = ok ? '' : 'none';
            b.classList.toggle('mm-on', mode === k);
        });
        if (mode && !dm && !(mode === 'erase' ? (p.draw || p.note) : p[mode])) { mode = null; if (ui.cap) ui.cap.style.display = 'none'; }
    };
    function closePanel() { if (ui.panel) { ui.panel.remove(); ui.panel = null; } }
    function togglePanel() {
        if (ui.panel) { closePanel(); return; }
        const p = perms(), box = document.createElement('div'); box.className = 'mm-panel';
        const nDraw = marks.filter(r => r.kind === 'draw').length, nNote = marks.filter(r => r.kind === 'note').length;
        box.innerHTML = '<div style="font-weight:600;margin-bottom:4px;">Players may</div>' +
            ['ping|Ping the map', 'draw|Draw on the map', 'note|Pin their own notes'].map(s => { const k = s.split('|')[0]; return '<label><input type="checkbox" data-perm="' + k + '"' + (p[k] ? ' checked' : '') + '> ' + s.split('|')[1] + '</label>'; }).join('') +
            '<div style="margin-top:8px;color:#7a6a50;font-size:12px;">' + nDraw + ' drawing' + (nDraw === 1 ? '' : 's') + ', ' + nNote + ' note' + (nNote === 1 ? '' : 's') + ' on this map</div>' +
            '<button type="button" data-act="drawings">Clear all drawings</button><button type="button" data-act="notes">Clear all notes</button>';
        ui.bar.appendChild(box); ui.panel = box;
        const r = ui.bar.querySelector('[data-mm="panel"]'); box.style.right = '0'; box.style.top = ((r ? r.offsetTop + r.offsetHeight : 28) + 4) + 'px';
        box.querySelectorAll('[data-perm]').forEach(c => c.onchange = () => {
            const np = {}; box.querySelectorAll('[data-perm]').forEach(x => { np[x.dataset.perm] = x.checked; });
            cfg.setPerms(np); MM.syncBar();
        });
        box.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
            const kind = b.dataset.act === 'drawings' ? 'draw' : 'note';
            if (!confirm('Remove all the ' + (kind === 'draw' ? 'drawings' : 'notes') + ' on this map, including the players\'?')) return;
            const { error } = await cfg.sb.from('map_marks').delete().eq('map_id', mapId).eq('kind', kind);
            if (error) { say('Could not clear them: ' + error.message); return; }
            marks = marks.filter(r => r.kind !== kind); MM.render(); send('clear', { kind }); closePanel();
        });
    }

    // cfg: { sb, grid: () => element, step: () => px per cell, offset: () => {c, r}, identity: () => {player, character, color, dm},
    //        getPerms?: () => {ping, draw, note}, setPerms?: p => void, status?: msg => void, btnClass?: string }
    MM.attach = function (c) { cfg = c; injectCss(); document.addEventListener('keydown', e => { if (e.key === 'Escape' && mode) setMode(null); }); };
    MM.mode = () => mode;
    MM.marks = () => marks.slice();
    MM._ping = showPing; // for tests
    root.MapMarks = MM;
})(window);
