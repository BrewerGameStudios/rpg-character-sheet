// Fog of war that is separate for each player (the DM's "Separate fog for each player" option), shared by dm.html and index.html.
//
// In the usual shared fog, whatever any player has seen is revealed for the whole party and stored on the map (grid_data.fogRevealed).
// With separate fog, that map-wide flag only means "revealed for everyone" (what the DM revealed or has been shared), and each
// player's own explored squares live in the map_fog table, one row per player and map (see supabase/migrations/20261028_map_fog.sql).
// What a player sees is: revealed for everyone + their own explored squares + whatever any party member can see right now.
//
// The pages keep their own line-of-sight code. They give this file sightOf(token) -> Set of square keys, and it caches the
// "right now" part so it is only worked out again when a token moves or the map changes.
(function (root) {
    'use strict';
    const MF = {};
    let cfg = null, mapId = null, rows = new Map(), dirty = new Set(), saveTimer = null, persist = true, pollTimer = null;
    const live = new Map(); // token id -> { sig, set }
    const names = new Map(); // owner key -> { player, character }
    MF.viewAs = null; // DM only: an owner key to see the map as one player does, or null for everyone combined

    MF.ownerKey = t => (t.owner_player_name || '') + '|' + (t.owner_character_name || '');
    MF.persistOk = () => persist;
    MF.attach = function (c) { cfg = c; };
    const changed = () => { if (cfg && cfg.onChange) cfg.onChange(); };
    const missing = e => e && (e.code === '42P01' || e.code === 'PGRST205' || /map_fog/.test(e.message || ''));

    function remember(key, tok) { if (tok && !names.has(key)) names.set(key, { player: tok.owner_player_name || '', character: tok.owner_character_name || '' }); }
    MF.noteOwner = remember;

    MF.get = key => rows.get(key) || new Set();
    // a view for the DM: everyone's explored squares together, or one player's
    MF.view = function (key) {
        if (key) return new Set(rows.get(key) || []);
        const all = new Set();
        rows.forEach(s => s.forEach(k => all.add(k)));
        return all;
    };

    MF.add = function (key, keys, opts, tok) {
        remember(key, tok);
        const cur = (opts && opts.replace) ? new Set() : (rows.get(key) || new Set());
        keys.forEach(k => cur.add(k));
        rows.set(key, cur); touch(key);
    };
    MF.remove = function (key, keys) {
        const cur = rows.get(key); if (!cur) return;
        keys.forEach(k => cur.delete(k)); touch(key);
    };
    MF.removeEverywhere = function (keys) { rows.forEach((s, key) => { let hit = false; keys.forEach(k => { if (s.delete(k)) hit = true; }); if (hit) touch(key); }); };
    MF.clearAll = async function () {
        rows = new Map(); dirty.clear(); live.clear();
        if (!mapId || !persist) return;
        const { error } = await cfg.sb.from('map_fog').delete().eq('map_id', mapId);
        if (error && missing(error)) persist = false;
    };

    function touch(key) { dirty.add(key); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 700); }
    async function flush() {
        if (!mapId || !persist) { dirty.clear(); return; }
        const todo = Array.from(dirty); dirty.clear();
        for (const key of todo) {
            const n = names.get(key) || { player: key.split('|')[0], character: key.split('|')[1] || '' };
            const set = rows.get(key) || new Set();
            const { error } = await cfg.sb.from('map_fog').upsert({ map_id: mapId, owner_player_name: n.player, owner_character_name: n.character, cells: Array.from(set), updated_at: new Date().toISOString() }, { onConflict: 'map_id,owner_player_name,owner_character_name' });
            if (error) { if (missing(error)) { persist = false; if (cfg.status) cfg.status('Separate fog needs the map_fog table, which is missing. Ask your DM to run the migration; what you explore will not be remembered until then.'); } else { dirty.add(key); } break; }
        }
    }
    MF.flush = flush;

    // fetch the rows (the DM gets everyone's, a player only their own)
    MF.refresh = async function () {
        if (!cfg || !mapId || !persist) return;
        const id = mapId;
        let q = cfg.sb.from('map_fog').select('*').eq('map_id', id);
        const me = cfg.me && cfg.me();
        if (me) q = q.eq('owner_player_name', me.player).eq('owner_character_name', me.character);
        const { data, error } = await q;
        if (id !== mapId) return;
        if (error) { if (missing(error)) persist = false; return; }
        const next = new Map();
        (data || []).forEach(r => {
            const key = (r.owner_player_name || '') + '|' + (r.owner_character_name || '');
            names.set(key, { player: r.owner_player_name || '', character: r.owner_character_name || '' });
            next.set(key, dirty.has(key) && rows.has(key) ? rows.get(key) : new Set(Array.isArray(r.cells) ? r.cells : []));
        });
        dirty.forEach(key => { if (!next.has(key) && rows.has(key)) next.set(key, rows.get(key)); }); // not saved yet
        let diff = next.size !== rows.size;
        if (!diff) next.forEach((s, key) => { const o = rows.get(key); if (!o || o.size !== s.size) diff = true; });
        rows = next;
        if (diff) changed();
    };
    MF.setMap = async function (id) {
        id = id || null;
        if (id === mapId) return;
        clearTimeout(saveTimer); if (dirty.size) await flush();
        mapId = id; rows = new Map(); dirty.clear(); live.clear(); persist = true; MF.viewAs = null;
        clearInterval(pollTimer); pollTimer = null;
        if (id) { await MF.refresh(); if (cfg.poll) pollTimer = setInterval(() => { if (!document.hidden && cfg.poll()) MF.refresh(); }, 5000); }
    };
    MF.stop = function () { clearInterval(pollTimer); pollTimer = null; mapId = null; rows = new Map(); dirty.clear(); live.clear(); };

    // what the party can see right now, joined together; recomputed only for a token that moved or when the map changed (sig)
    MF.live = function (tokens, sig) {
        const out = new Set(), seen = new Set();
        tokens.forEach(t => {
            if (!t || !t.cell) return;
            seen.add(t.id);
            const s = t.cell + '|' + (t.vision == null ? '' : t.vision) + '|' + (t.dim_vision == null ? '' : t.dim_vision) + '|' + (t.darkvision == null ? '' : t.darkvision) + '|' + sig;
            let e = live.get(t.id);
            if (!e || e.sig !== s) { e = { sig: s, set: cfg.sightOf(t) }; live.set(t.id, e); }
            e.set.forEach(k => out.add(k));
        });
        live.forEach((v, id) => { if (!seen.has(id)) live.delete(id); });
        return out;
    };
    MF.forgetLive = () => live.clear();

    root.MapFog = MF;
})(window);
