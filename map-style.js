// map-style.js — the "Parchment" look for the battle map (2026-10-26).
//
// Loaded by both dm.html (the DM's map builder) and index.html (the player's
// map view) so a map reads the same on both sides of the table. Inspired by
// the hand-inked parchment style of Dungeon Scrawl, but built on OUR grid:
// nothing here changes how a map is stored, how fog/vision work, or how any
// tool behaves. It only changes how the same data is DRAWN:
//   - warm paper with a dot grid instead of white boxed cells
//   - floors drawn as seamless procedural stone / wood / tile with a soft
//     shadow and an inked outline
//   - cross-hatching in the rock around a room (the Dungeon Scrawl signature)
//   - walls and doors drawn as slightly rough ink lines with a drop shadow
// The old look stays available: localStorage 'mapStyle' = 'classic' switches
// everything here off (see MapStyle.isOn), and every caller checks isOn()
// before using anything below, so Classic is byte-for-byte what it was.
//
// Coordinates: the map is drawn on a canvas/overlay where the cell at
// (col c, row r) — both zero-based within the area being drawn — has its
// top-left corner at pixel ((c + 1) * step, (r + 1) * step). Row/column
// labels take the first row/column. A "vertex" (i, j) is the pixel point
// (i * step, j * step), so cell (c, r) spans vertices (c+1, r+1)..(c+2, r+2).
(function () {
    'use strict';

    const STORE_KEY = 'mapStyle';
    const INK = '#2a2118';
    const MS = (window.MapStyle = {});

    MS.isOn = function () {
        return true; // the classic look was taken out for now (it did not show shapes, rugs and props properly); the parchment look is always on
    };
    MS.syncBodyClass = function () {
        if (!document.body) return;
        document.body.classList.toggle('map-parchment', MS.isOn());
        document.body.classList.toggle('map-hide-labels', !MS.labelsOn());
    };
    // Row/column labels (A, B, C... and 1, 2, 3...) can be switched off; remembered per browser.
    MS.labelsOn = function () {
        try { return localStorage.getItem('mapGridLabels') !== 'off'; } catch (e) { return true; }
    };
    MS.setLabels = function (on) {
        try { localStorage.setItem('mapGridLabels', on ? 'on' : 'off'); } catch (e) { /* private mode: just this session */ }
        MS.syncBodyClass();
    };
    MS.setOn = function (on) {
        try { localStorage.setItem(STORE_KEY, on ? 'parchment' : 'classic'); } catch (e) { /* private mode: just this session */ }
        MS.syncBodyClass();
    };

    // ---------- Paper and dots, for pages that draw the whole map on a canvas ----------
    let paperNoise = null;
    MS.paintPaper = function (ctx, w, h) {
        if (!paperNoise) {
            const c = document.createElement('canvas');
            c.width = c.height = 200;
            const g = c.getContext('2d');
            const R = rng(77);
            for (let i = 0; i < 2600; i++) { g.fillStyle = 'rgba(' + (84 + R() * 30 | 0) + ',' + (66 + R() * 24 | 0) + ',' + (42 + R() * 20 | 0) + ',' + (0.03 + R() * 0.07) + ')'; g.fillRect(R() * 200, R() * 200, 1 + R() * 1.6, 1 + R() * 1.6); }
            paperNoise = c;
        }
        ctx.save();
        ctx.fillStyle = '#efe6d2';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = ctx.createPattern(paperNoise, 'repeat');
        ctx.fillRect(0, 0, w, h);
        const cx = w / 2, cy = h * 0.45, rad = Math.max(w, h) * 0.75;
        let grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad * 0.62);
        grd.addColorStop(0, 'rgba(255,250,236,.5)'); grd.addColorStop(1, 'rgba(255,250,236,0)');
        ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
        grd = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.78);
        grd.addColorStop(0, 'rgba(96,70,36,0)'); grd.addColorStop(1, 'rgba(96,70,36,.26)');
        ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
        ctx.restore();
    };
    // Little top-down pictures for the furniture tools (same colours as the generator's tavern furniture), drawn to fill
    // one square. Returns '' for anything without a picture.
    const FURN_ART = {
        bar: '<rect x="1.5" y="3" width="21" height="18" rx="1.5" fill="#6b4a2f" stroke="#3a2818" stroke-width="1.3"/><rect x="3.5" y="5" width="17" height="4" fill="#8a6644" opacity=".7"/><circle cx="8" cy="15" r="2" fill="#d9c9a0"/><circle cx="15" cy="15" r="2" fill="#d9c9a0"/>',
        table: '<circle cx="12" cy="12" r="7.4" fill="#8a6a45" stroke="#5c4028" stroke-width="1.3"/><circle cx="12" cy="12" r="4.6" fill="none" stroke="#6b4a2f" stroke-width=".8" opacity=".7"/><g fill="#6b4423" stroke="#3a2818" stroke-width=".6"><circle cx="12" cy="2.6" r="2.2"/><circle cx="12" cy="21.4" r="2.2"/><circle cx="2.6" cy="12" r="2.2"/><circle cx="21.4" cy="12" r="2.2"/></g>',
        stove: '<rect x="2.5" y="2.5" width="19" height="19" rx="1.5" fill="#3a3a3a" stroke="#1f1f1f" stroke-width="1.3"/><circle cx="8.3" cy="8.3" r="3.2" fill="#e06a2c"/><circle cx="15.7" cy="15.7" r="3.2" fill="#e06a2c"/><circle cx="15.7" cy="8.3" r="3.2" fill="none" stroke="#6a6a6a" stroke-width="1.1"/><circle cx="8.3" cy="15.7" r="3.2" fill="none" stroke="#6a6a6a" stroke-width="1.1"/>',
        shelf: '<rect x="1.5" y="4.5" width="21" height="15" rx="1" fill="#5c4028" stroke="#3a2818" stroke-width="1.3"/><rect x="3.5" y="7" width="3.2" height="10" fill="#c9a86a"/><rect x="7.6" y="8.5" width="3" height="8.5" fill="#8a9a6a"/><rect x="11.5" y="7" width="3.2" height="10" fill="#c9a86a"/><rect x="15.6" y="9" width="3" height="8" fill="#8a9a6a"/><rect x="19.2" y="7.5" width="1.6" height="9.5" fill="#b85c4a"/>',
        bed: '<rect x="2" y="3" width="20" height="18" rx="1.5" fill="#7a5a8a" stroke="#4a3a5a" stroke-width="1.3"/><rect x="3.8" y="5" width="5.6" height="14" rx="1.2" fill="#e8ddf0" stroke="#bfb2cc" stroke-width=".7"/><path d="M12 5v14" stroke="#5e4570" stroke-width=".9" opacity=".7"/>',
        torch: '<rect x="10.4" y="13" width="3.2" height="9" rx="1" fill="#5c4028" stroke="#3a2818" stroke-width=".8"/><path d="M12 2.5c3.2 3 4.8 5.4 4.8 8a4.8 4.8 0 0 1-9.6 0c0-1.9.9-3.1 2-4.3.1 1.3.6 2 1.4 2.4-.2-2.3.3-4.3 1.4-6.1z" fill="#f5a623" stroke="#b5651d" stroke-width=".8"/><path d="M12 9c1.6 1.5 2.4 2.7 2.4 4a2.4 2.4 0 0 1-4.8 0c0-1 .7-1.8 1.4-2.6.4.7.7 1 1 1.1z" fill="#ffe08a"/>',
        'spiral-up': '<circle cx="12" cy="12" r="10" fill="#9a9384" stroke="#2a2118" stroke-width="1.4"/><path d="M14.6 12.0L20.8 15.2M13.8 13.8L16.0 20.5M12.0 14.6L8.8 20.8M10.2 13.8L3.5 16.0M9.4 12.0L3.2 8.8M10.2 10.2L8.0 3.5M12.0 9.4L15.2 3.2M13.8 10.2L20.5 8.0" stroke="#3b352c" stroke-width="1.1" fill="none"/><circle cx="12" cy="12" r="2.4" fill="#2a2118"/><path d="M12 5.2L17 12H7z" fill="#fff" stroke="#2a2118" stroke-width="1" stroke-linejoin="round"/>',
        'spiral-down': '<circle cx="12" cy="12" r="10" fill="#9a9384" stroke="#2a2118" stroke-width="1.4"/><path d="M14.6 12.0L20.8 15.2M13.8 13.8L16.0 20.5M12.0 14.6L8.8 20.8M10.2 13.8L3.5 16.0M9.4 12.0L3.2 8.8M10.2 10.2L8.0 3.5M12.0 9.4L15.2 3.2M13.8 10.2L20.5 8.0" stroke="#3b352c" stroke-width="1.1" fill="none"/><circle cx="12" cy="12" r="2.4" fill="#2a2118"/><path d="M12 18.8L7 12h10z" fill="#fff" stroke="#2a2118" stroke-width="1" stroke-linejoin="round"/>',
        'desk': '<rect x="1.5" y="5" width="21" height="14" rx="1.2" fill="#8a6a45" stroke="#3a2818" stroke-width="1.3"/><rect x="3.5" y="7" width="8" height="10" rx=".8" fill="#9b7a52" stroke="#5c4028" stroke-width=".7"/><rect x="13" y="7.4" width="6.5" height="5" rx=".5" fill="#efe6d2" stroke="#8a7a62" stroke-width=".6"/><circle cx="19" cy="15.5" r="1.3" fill="#2a2118"/><path d="M14.5 9.2h3.6M14.5 10.8h2.6" stroke="#6a5a44" stroke-width=".5"/>',
        'chair': '<rect x="4.5" y="3.5" width="15" height="4.2" rx="1.6" fill="#6b4423" stroke="#3a2818" stroke-width="1"/><rect x="5.5" y="8.5" width="13" height="12" rx="2.4" fill="#a0703c" stroke="#3a2818" stroke-width="1.1"/><rect x="8" y="11" width="8" height="7" rx="1.6" fill="#b98b52" opacity=".7"/>',
        'couch': '<rect x="1.5" y="4" width="21" height="5" rx="2.2" fill="#6e3a3a" stroke="#2f1a1a" stroke-width="1.1"/><rect x="1.5" y="8" width="4.2" height="12" rx="1.8" fill="#7e4545" stroke="#2f1a1a" stroke-width="1"/><rect x="18.3" y="8" width="4.2" height="12" rx="1.8" fill="#7e4545" stroke="#2f1a1a" stroke-width="1"/><rect x="5.7" y="8.6" width="6.2" height="11" rx="1.3" fill="#9a5555" stroke="#2f1a1a" stroke-width=".8"/><rect x="12.1" y="8.6" width="6.2" height="11" rx="1.3" fill="#9a5555" stroke="#2f1a1a" stroke-width=".8"/>',
        'end-table': '<rect x="5" y="5" width="14" height="14" rx="2.2" fill="#8a6a45" stroke="#3a2818" stroke-width="1.2"/><circle cx="12" cy="12" r="3.6" fill="#f0d78c" stroke="#a07a2a" stroke-width=".8"/><circle cx="12" cy="12" r="1.3" fill="#fff6d0"/>',
        'flower-pot': '<circle cx="12" cy="12" r="7.6" fill="#b5654a" stroke="#6a3a28" stroke-width="1.2"/><circle cx="12" cy="12" r="5.6" fill="#4a3a2a"/><g fill="#4f8f4a" stroke="#2f5a2c" stroke-width=".5"><ellipse cx="12" cy="7.8" rx="2" ry="3.2"/><ellipse cx="12" cy="16.2" rx="2" ry="3.2"/><ellipse cx="7.8" cy="12" rx="3.2" ry="2"/><ellipse cx="16.2" cy="12" rx="3.2" ry="2"/></g><circle cx="12" cy="12" r="2.2" fill="#e8c43a" stroke="#a07a10" stroke-width=".6"/>',
        'barrel': '<circle cx="12" cy="12" r="8.6" fill="#8a6234" stroke="#3a2818" stroke-width="1.3"/><circle cx="12" cy="12" r="6.2" fill="#a67a44" stroke="#5c4028" stroke-width=".8"/><circle cx="12" cy="12" r="3.4" fill="none" stroke="#5c4028" stroke-width=".8"/><path d="M12 3.4v17.2M3.4 12h17.2" stroke="#5c4028" stroke-width=".6"/>',
        'crate': '<rect x="3" y="3" width="18" height="18" rx="1" fill="#a67a44" stroke="#3a2818" stroke-width="1.3"/><rect x="5.6" y="5.6" width="12.8" height="12.8" fill="none" stroke="#5c4028" stroke-width=".9"/><path d="M5.6 5.6L18.4 18.4M18.4 5.6L5.6 18.4" stroke="#5c4028" stroke-width=".9"/>',
        'chest': '<rect x="2.5" y="6" width="19" height="12" rx="1.8" fill="#8a5a2c" stroke="#3a2818" stroke-width="1.3"/><path d="M2.5 11h19" stroke="#3a2818" stroke-width="1"/><rect x="4" y="6" width="2.4" height="12" fill="#c9a24a" opacity=".85"/><rect x="17.6" y="6" width="2.4" height="12" fill="#c9a24a" opacity=".85"/><rect x="10.4" y="9.4" width="3.2" height="3.8" rx=".7" fill="#e6c860" stroke="#7a5a10" stroke-width=".7"/>',
        'fireplace': '<rect x="2" y="3" width="20" height="9" rx="1" fill="#6a665c" stroke="#2a2118" stroke-width="1.3"/><rect x="5" y="5" width="14" height="6" fill="#2a1a10"/><path d="M12 5.4c2 1.6 3 3 3 4.4a3 3 0 0 1-6 0c0-1 .6-1.8 1.2-2.4.1.8.4 1.2.8 1.4-.1-1.2.2-2.4 1-3.4z" fill="#f5742a"/><path d="M12 8c1 .9 1.5 1.6 1.5 2.4a1.5 1.5 0 0 1-3 0c0-.6.4-1 .9-1.5z" fill="#ffd36a"/><path d="M3 14.5h18" stroke="#6a665c" stroke-width="3" stroke-linecap="round"/>',
        campfire: '<g stroke="#3a2818" stroke-width=".9" fill="#7a5230"><rect x="2.5" y="15.5" width="19" height="3.6" rx="1.6" transform="rotate(-18 12 17.3)"/><rect x="2.5" y="15.5" width="19" height="3.6" rx="1.6" transform="rotate(18 12 17.3)"/></g><path d="M12 3c3.6 3.2 5.6 6.2 5.6 9.2a5.6 5.6 0 0 1-11.2 0c0-2.2 1-3.6 2.3-5 .1 1.5.7 2.4 1.7 2.8-.3-2.6.3-5 1.6-7z" fill="#f5742a" stroke="#b5451d" stroke-width=".8"/><path d="M12 9.4c1.9 1.7 2.9 3.2 2.9 4.7a2.9 2.9 0 0 1-5.8 0c0-1.2.8-2.1 1.7-3 .4.8.8 1.1 1.2 1.3z" fill="#ffd36a"/>'
    };
    // inline: a small standalone icon (for the toolbox) instead of one that fills a map square
    MS.furnitureArt = function (kind, inline) {
        const art = FURN_ART[kind];
        if (!art) return '';
        if (inline) return '<svg viewBox="0 0 24 24" width="22" height="22" style="vertical-align:middle; margin-right:8px; flex:none;" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">' + art + '</svg>';
        return '<svg viewBox="0 0 24 24" style="position:absolute; inset:2px; width:calc(100% - 4px); height:calc(100% - 4px); overflow:visible; pointer-events:none;" xmlns="http://www.w3.org/2000/svg">' + art + '</svg>';
    };
    // the dot at every corner of the grid, in place of grid lines
    MS.paintDots = function (ctx, cols, rows, step) {
        ctx.save();
        ctx.fillStyle = 'rgba(74,54,32,.55)';
        const r = Math.max(0.9, 1.5 * step / 27);
        for (let i = 0; i <= cols; i++) for (let j = 0; j <= rows; j++) { ctx.beginPath(); ctx.arc(i * step, j * step, r, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
    };
    // Draws an svg string (from edgesSvg) onto a canvas; resolves once it is on there.
    MS.drawSvgOnCanvas = function (ctx, svg, w, h) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => { ctx.drawImage(img, 0, 0, w, h); resolve(true); };
            img.onerror = () => resolve(false);
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        });
    };

    // ---------- Page styling ----------
    const CSS = `
    body.map-parchment .map-paper {
        background-color: #efe6d2;
        background-image:
            url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' seed='4'/%3E%3CfeColorMatrix values='0 0 0 0 .35  0 0 0 0 .27  0 0 0 0 .17  0 0 0 .22 0'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)'/%3E%3C/svg%3E"),
            radial-gradient(ellipse at 50% 45%, rgba(255,250,236,.55) 0%, rgba(255,250,236,0) 62%),
            radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 58%, rgba(96,70,36,.28) 100%);
        box-shadow: inset 0 0 22px rgba(96,70,36,.35), 0 2px 8px rgba(0,0,0,.25);
        border-radius: 3px;
    }
    /* Cells become see-through so the paper (and the canvas drawn on it)
       shows; each cell keeps a small ink dot at its top-left corner, which
       is what turns the grid into Dungeon Scrawl's dot grid. */
    body.map-parchment #mapGrid .map-cell,
    body.map-parchment #mapViewGrid .map-cell { background: transparent; border: 0; }
    body.map-parchment #mapGrid .map-cell::before,
    body.map-parchment #mapViewGrid .map-cell::before {
        content: ''; position: absolute; left: -1px; top: -1px; width: 3px; height: 3px; border-radius: 50%;
        background: rgba(74,54,32,.55); pointer-events: none; z-index: 0;
    }
    body.map-parchment #mapGrid .map-cell.canvas-terrain::before,
    body.map-parchment #mapViewGrid .map-cell.canvas-terrain::before { display: none; }
    /* DM view: a cell the players can't see yet gets a light sepia veil
       instead of the old solid grey, so the DM still reads the paper
       underneath. */
    body.map-parchment #mapGrid .map-cell.dm-fogged::after {
        content: ''; position: absolute; top: 0; left: 0; right: -1px; bottom: -1px; background: rgba(88,64,36,.16); pointer-events: none;
    }
    body.map-parchment #mapGrid .map-cell.map-cell-elevated,
    body.map-parchment #mapViewGrid .map-cell.map-cell-elevated { background: rgba(120,104,84,.38); }
    /* Player view: unexplored space stays dark, just warmer than before. */
    body.map-parchment #mapViewGrid .map-cell.player-fogged { background: #231c14; border: 0; outline: 1px solid #231c14; }
    body.map-parchment #mapViewGrid .map-cell.player-fogged::before { display: none; }
    /* smooth fog (paintFog): the fog is one soft shape on a canvas, so the per-square fog colour steps aside */
    body.map-parchment.map-fog-canvas #mapGrid .map-cell.dm-fogged::after { display: none; }
    body.map-parchment.map-fog-canvas #mapViewGrid .map-cell.player-fogged { background: transparent; outline: 0; }
    body.map-parchment .map-grid-wrap .map-cell-label,
    body.map-parchment #mapViewGrid .map-cell-label { background: transparent; color: #7b6a52; font-family: Georgia, 'Times New Roman', serif; }
    body.map-parchment #mapGrid .thick-wall-cell,
    body.map-parchment #mapViewGrid .thick-wall-cell {
        background-color: #2a2118;
        background-image:
            repeating-linear-gradient(0deg, rgba(255,240,210,.10) 0, rgba(255,240,210,.10) 1px, transparent 1px, transparent 9px),
            repeating-linear-gradient(90deg, rgba(255,240,210,.07) 0, rgba(255,240,210,.07) 1px, transparent 1px, transparent 13px);
    }
    /* the compass star floats over a corner of the map and stays put while the map scrolls under it */
    .map-compass { position: absolute; z-index: 7; width: 78px; height: 78px; pointer-events: none; }
    .map-compass.tl { top: 8px; left: 32px; }
    .map-compass.tr { top: 8px; right: 24px; }
    .map-compass.bl { bottom: 26px; left: 32px; }
    .map-compass.br { bottom: 26px; right: 24px; }
    .map-compass svg { width: 100%; height: 100%; overflow: visible; filter: drop-shadow(1px 2px 1.5px rgba(27,19,10,.35)); }
    /* labels off: the strip they sit in stays (everything is positioned around it), only the text and boxes go */
    body.map-hide-labels .map-cell-label { visibility: hidden !important; }
    .map-style-toggle { font-size: 12px; padding: 4px 10px; border-radius: 14px; border: 1px solid #b9a98a; background: #efe6d2; color: #4a3a22; cursor: pointer; }
    .map-style-toggle:hover { background: #e5d8bb; }
    `;
    function injectCss() {
        if (document.getElementById('map-style-css')) return;
        const el = document.createElement('style');
        el.id = 'map-style-css';
        el.textContent = CSS;
        (document.head || document.documentElement).appendChild(el);
    }
    injectCss();
    if (document.body) MS.syncBodyClass();
    else document.addEventListener('DOMContentLoaded', MS.syncBodyClass);

    // ---------- Seeded randomness (a map must look identical every redraw) ----------
    function rng(seed) {
        let a = seed | 0;
        return function () {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function hash2(i, j, salt) {
        let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(salt | 0, 1274126177)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }
    // Small, repeatable wobble for a grid vertex — the same vertex always
    // moves the same way, so a room's floor outline and the walls drawn on
    // it (and neighbouring segments of one wall) stay joined.
    function jit(i, j, amp) {
        return [(hash2(i, j, 1) - 0.5) * amp, (hash2(i, j, 2) - 0.5) * amp];
    }

    // ---------- Procedural floor textures (seamless tiles) ----------
    const tileCache = {};
    function makeCanvas(w, h) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        return c;
    }
    // Irregular flagstones: a jittered 6x6 lattice wrapped on a torus so the
    // 4x4-cell tile repeats with no seam.
    function makeStone(step) {
        const S = step * 4, c = makeCanvas(S, S), g = c.getContext('2d');
        const R = rng(11), n = 6, cell = S / n;
        const pts = [];
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
            pts.push([i * cell + (R() - 0.5) * cell * 0.55, j * cell + (R() - 0.5) * cell * 0.55]);
        }
        function P(i, j) {
            const ii = ((i % n) + n) % n, jj = ((j % n) + n) % n, p = pts[jj * n + ii];
            return [p[0] + ((i - ii) / n) * S, p[1] + ((j - jj) / n) * S];
        }
        g.fillStyle = '#d6ccb8';
        g.fillRect(0, 0, S, S);
        g.lineJoin = 'round';
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
            const q = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
            const light = 74 + (R() - 0.5) * 9, hue = 36 + (R() - 0.5) * 8;
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                g.save();
                g.translate(dx * S, dy * S);
                g.beginPath();
                g.moveTo(q[0][0], q[0][1]);
                for (let k = 1; k < 4; k++) g.lineTo(q[k][0], q[k][1]);
                g.closePath();
                g.fillStyle = 'hsl(' + hue + ',16%,' + light + '%)';
                g.fill();
                // soft top-left highlight and bottom-right shade give each stone a little body
                g.strokeStyle = 'rgba(255,250,236,.35)'; g.lineWidth = 1.2;
                g.beginPath(); g.moveTo(q[3][0] + 1, q[3][1] - 1); g.lineTo(q[0][0] + 1, q[0][1] + 1); g.lineTo(q[1][0] - 1, q[1][1] + 1); g.stroke();
                g.strokeStyle = 'rgba(70,56,40,.55)'; g.lineWidth = 1.3;
                g.stroke();
                g.restore();
            }
        }
        for (let k = 0; k < 90; k++) {
            g.fillStyle = 'rgba(60,48,32,' + (0.04 + R() * 0.05) + ')';
            g.fillRect(R() * S, R() * S, 1 + R() * 1.5, 1 + R() * 1.5);
        }
        return c;
    }
    function makeWood(step) {
        const S = step * 4, c = makeCanvas(S, S), g = c.getContext('2d');
        const R = rng(23), h = step / 2, rows = Math.round(S / h);
        for (let r = 0; r < rows; r++) {
            const y = r * h;
            let x = -R() * step * 1.5;
            while (x < S) {
                const len = step * (1.7 + R() * 1.4), light = 54 + (R() - 0.5) * 9;
                g.fillStyle = 'hsl(' + (30 + (R() - 0.5) * 6) + ',36%,' + light + '%)';
                g.fillRect(x, y, len, h);
                g.strokeStyle = 'rgba(70,44,20,.14)'; g.lineWidth = 1;
                for (let k = 0; k < 3; k++) {
                    const gy = y + 2 + R() * (h - 4);
                    g.beginPath(); g.moveTo(x + 1, gy); g.lineTo(x + len - 1, gy + (R() - 0.5) * 1.5); g.stroke();
                }
                g.strokeStyle = 'rgba(52,32,14,.6)'; g.lineWidth = 1;
                g.beginPath(); g.moveTo(x + 0.5, y); g.lineTo(x + 0.5, y + h); g.stroke();
                x += len;
            }
            g.strokeStyle = 'rgba(52,32,14,.6)'; g.lineWidth = 1;
            g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(S, y + 0.5); g.stroke();
        }
        return c;
    }
    function makeTile(step) {
        const S = step * 2, c = makeCanvas(S, S), g = c.getContext('2d');
        for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
            g.fillStyle = (i + j) % 2 === 0 ? '#e4dccb' : '#d3c8b0';
            g.fillRect(i * step, j * step, step, step);
        }
        g.strokeStyle = 'rgba(80,66,48,.45)'; g.lineWidth = 1;
        for (let k = 0; k <= 2; k++) {
            g.beginPath(); g.moveTo(k * step + 0.5, 0); g.lineTo(k * step + 0.5, S); g.stroke();
            g.beginPath(); g.moveTo(0, k * step + 0.5); g.lineTo(S, k * step + 0.5); g.stroke();
        }
        return c;
    }
    // packed earth: warm brown with darker patches, light grit and the odd small stone
    function makeDirt(step) {
        const S = step * 4, c = makeCanvas(S, S), g = c.getContext('2d');
        const R = rng(41);
        g.fillStyle = '#9a7a54';
        g.fillRect(0, 0, S, S);
        const blob = (x, y, rx, ry, fill) => {
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                g.fillStyle = fill;
                g.beginPath(); g.ellipse(x + dx * S, y + dy * S, rx, ry, R() * Math.PI, 0, Math.PI * 2); g.fill();
            }
        };
        for (let k = 0; k < 26; k++) blob(R() * S, R() * S, step * (0.35 + R() * 0.55), step * (0.2 + R() * 0.35), 'rgba(' + (R() < 0.5 ? '70,48,26' : '176,146,104') + ',' + (0.14 + R() * 0.14) + ')');
        for (let k = 0; k < 170; k++) {
            g.fillStyle = R() < 0.6 ? 'rgba(54,36,18,' + (0.18 + R() * 0.2) + ')' : 'rgba(214,188,148,' + (0.2 + R() * 0.25) + ')';
            const x = R() * S, y = R() * S, w = 0.8 + R() * 1.6;
            g.fillRect(x, y, w, w);
        }
        for (let k = 0; k < 9; k++) blob(R() * S, R() * S, 1.4 + R() * 1.6, 1 + R() * 1.2, 'rgba(120,102,80,0.8)');
        return c;
    }
    // pebble stone: a bed of rounded grey and tan pebbles packed over dark mortar
    function makePebble(step) {
        const S = step * 4, c = makeCanvas(S, S), g = c.getContext('2d');
        const R = rng(57);
        g.fillStyle = '#5f594f';
        g.fillRect(0, 0, S, S);
        const n = Math.round(S / (step * 0.34));
        for (let k = 0; k < n * n * 1.15; k++) {
            const x = R() * S, y = R() * S, rx = step * (0.12 + R() * 0.12), ry = rx * (0.65 + R() * 0.3), a = R() * Math.PI;
            const hue = 28 + R() * 14, sat = 6 + R() * 14, light = 52 + R() * 26;
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                g.save();
                g.translate(x + dx * S, y + dy * S); g.rotate(a);
                g.fillStyle = 'hsl(' + hue + ',' + sat + '%,' + light + '%)';
                g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.fill();
                g.strokeStyle = 'rgba(40,34,26,.55)'; g.lineWidth = 0.9; g.stroke();
                g.fillStyle = 'rgba(255,250,236,.28)';
                g.beginPath(); g.ellipse(-rx * 0.28, -ry * 0.3, rx * 0.4, ry * 0.3, 0, 0, Math.PI * 2); g.fill();
                g.restore();
            }
        }
        return c;
    }
    const FLOOR_BASE = { stone: '#d6ccb8', wood: '#a98458', tile: '#dcd2bc', dirt: '#9a7a54', pebble: '#8b8478' };
    function floorTile(kind, step) {
        const key = kind + ':' + step;
        if (!tileCache[key]) tileCache[key] = kind === 'wood' ? makeWood(step) : kind === 'tile' ? makeTile(step) : kind === 'dirt' ? makeDirt(step) : kind === 'pebble' ? makePebble(step) : makeStone(step);
        return tileCache[key];
    }

    // ---------- Outline smoothing (round rooms only) ----------
    // Walls and floor edges live on the square grid, so a round room is a
    // staircase of cells. Edges that belong to a ROUND room (flagged when it
    // was drawn) are traced into continuous runs and drawn with rounded
    // corners and straight diagonals; everything else — square rooms,
    // overlaps of square rooms, hand-placed walls — keeps hard square
    // corners. Pure drawing: stored walls and floors are untouched, so
    // vision and fog still use the real cell edges.
    //
    // Loops/chains are lattice vertices [[i, j], ...] plus rnd[k] = whether
    // the segment from vertex k to vertex k+1 belongs to a round room.
    function simplifyLoop(lat, rnd, closed) {
        const n = lat.length, outP = [], outR = [];
        for (let k = 0; k < n; k++) {
            if (!closed && (k === 0 || k === n - 1)) { outP.push(lat[k]); outR.push(rnd[k]); continue; }
            const pk = (k + n - 1) % n, a = lat[pk], b = lat[k], c = lat[(k + 1) % n];
            const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
            const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
            // straight through, and both halves belong to the same kind of room: not a corner
            if (cross === 0 && dot > 0 && (rnd[pk] | 0) === (rnd[k] | 0)) continue;
            outP.push(b); outR.push(rnd[k]);
        }
        return { pts: outP, rnd: outR };
    }
    function roundedCommands(latIn, rndIn, closed, V, step) {
        const simp = simplifyLoop(latIn, rndIn, closed), pts = simp.pts, rnd = simp.rnd, n = pts.length;
        if (n < 2) return [];
        const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
        const sgn = v => (Math.abs(v) < 1e-9 ? 0 : v > 0 ? 1 : -1);
        // Smoothing levels per segment: 0 = square, 1 = single-cell steps become straight diagonals
        // (polygon / freehand rooms: corners stay sharp), 2 = round room (diagonals AND curved corners).
        // vertex k is a ROUND corner only when both segments meeting there are level 2
        const vr0 = pts.map((_, k) => (closed || (k > 0 && k < n - 1)) ? (rnd[(k + n - 1) % n] === 2 && rnd[k] === 2) : false);
        let L = [], P = [], VR = [];
        if (n >= 5 && rnd.some(Boolean)) {
            const T = pts.map((b, k) => (!closed && (k === 0 || k === n - 1)) ? 0 : sgn(cross(pts[(k + n - 1) % n], b, pts[(k + 1) % n])));
            const segs = closed ? n : n - 1;
            const riser = [];
            for (let k = 0; k < segs; k++) {
                const p = pts[k], q = pts[(k + 1) % n], t0 = T[k], t1 = T[(k + 1) % n];
                riser.push(!!rnd[k] && Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) === 1 && t0 !== 0 && t1 !== 0 && t0 !== t1);
            }
            const rAt = k => (closed ? riser[(k + segs) % segs] : (k >= 0 && k < segs && riser[k]));
            const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
            // where two lines (p1-p2 and p3-p4) cross, or null if (nearly) parallel
            const cross2 = (p1, p2, p3, p4) => {
                const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
                if (Math.abs(d) < 1e-9) return null;
                const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
                return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
            };
            const at = k => pts[(k + n) % n];
            const pxAt = k => V(at(k)[0], at(k)[1]);
            const pxMid = k => mid(pxAt(k), pxAt(k + 1)); // pixel midpoint of segment k
            for (let k = 0; k < n; k++) {
                const interior = rAt(k - 1) && rAt(k);
                if (!interior) {
                    // The vertex where a flat wall meets a run of single steps moves to where the
                    // flat line meets the diagonal, so the two join as one wide, easily rounded corner.
                    let li = pts[k], pi = V(pts[k][0], pts[k][1]);
                    const startsRun = rAt(k) && !rAt(k - 1) && rAt(k + 1) && (closed || k > 0);
                    const endsRun = rAt(k - 1) && !rAt(k) && rAt(k - 2) && (closed || k < n - 1);
                    let hitL = null, hitP = null;
                    if (startsRun) {
                        hitL = cross2(at(k - 1), at(k), mid(at(k), at(k + 1)), mid(at(k + 1), at(k + 2)));
                        hitP = cross2(pxAt(k - 1), pxAt(k), pxMid(k), pxMid(k + 1));
                    } else if (endsRun) {
                        hitL = cross2(mid(at(k - 2), at(k - 1)), mid(at(k - 1), at(k)), at(k), at(k + 1));
                        hitP = cross2(pxMid(k - 2), pxMid(k - 1), pxAt(k), pxAt(k + 1));
                    }
                    if (hitL && hitP && Math.hypot(hitL[0] - li[0], hitL[1] - li[1]) < 2) { li = hitL; pi = hitP; }
                    L.push(li); P.push(pi); VR.push(vr0[k] || (startsRun && rnd[k] === 2) || (endsRun && rnd[(k + n - 1) % n] === 2));
                }
                if (k < segs && rAt(k) && (rAt(k - 1) || rAt(k + 1))) {
                    const p = pts[k], q = pts[(k + 1) % n], pp = V(p[0], p[1]), qq = V(q[0], q[1]);
                    L.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
                    P.push([(pp[0] + qq[0]) / 2, (pp[1] + qq[1]) / 2]);
                    VR.push(rnd[k] === 2);
                }
            }
        } else {
            L = pts.slice(); P = pts.map(v => V(v[0], v[1])); VR = vr0.slice();
        }
        // drop points that sit on a straight line between their neighbours
        const keepL = [], keepP = [], keepV = [];
        const m0 = L.length;
        for (let k = 0; k < m0; k++) {
            if (closed || (k > 0 && k < m0 - 1)) {
                const p = L[(k + m0 - 1) % m0], q = L[k], r = L[(k + 1) % m0];
                const dot = (q[0] - p[0]) * (r[0] - q[0]) + (q[1] - p[1]) * (r[1] - q[1]);
                if (sgn(cross(p, q, r)) === 0 && dot > 0) continue;
            }
            keepL.push(L[k]); keepP.push(P[k]); keepV.push(VR[k]);
        }
        L = keepL; P = keepP; VR = keepV;
        const m = L.length;
        if (m < 2) return [];
        if (m === 2) return [['M', P[0][0], P[0][1]], ['L', P[1][0], P[1][1]]];
        const cmds = [];
        function corner(k, first) {
            const pk = (k + m - 1) % m, nk = (k + 1) % m;
            const prev = P[pk], cur = P[k], next = P[nk];
            const d1 = Math.hypot(prev[0] - cur[0], prev[1] - cur[1]) || 1;
            const d2 = Math.hypot(next[0] - cur[0], next[1] - cur[1]) || 1;
            // round-room corners curve; every other corner keeps a crisp square look
            const r = Math.min(d1 / 2, d2 / 2, VR[k] ? step * 2.4 : 2.5);
            const A = [cur[0] + (prev[0] - cur[0]) / d1 * r, cur[1] + (prev[1] - cur[1]) / d1 * r];
            const B = [cur[0] + (next[0] - cur[0]) / d2 * r, cur[1] + (next[1] - cur[1]) / d2 * r];
            cmds.push([first ? 'M' : 'L', A[0], A[1]]);
            cmds.push(['Q', cur[0], cur[1], B[0], B[1]]);
        }
        if (closed) {
            for (let k = 0; k < m; k++) corner(k, k === 0);
            cmds.push(['Z']);
        } else {
            cmds.push(['M', P[0][0], P[0][1]]);
            for (let k = 1; k < m - 1; k++) corner(k, false);
            cmds.push(['L', P[m - 1][0], P[m - 1][1]]);
        }
        return cmds;
    }
    function cmdsToPath2D(cmds, path) {
        cmds.forEach(c => {
            if (c[0] === 'M') path.moveTo(c[1], c[2]);
            else if (c[0] === 'L') path.lineTo(c[1], c[2]);
            else if (c[0] === 'Q') path.quadraticCurveTo(c[1], c[2], c[3], c[4]);
            else path.closePath();
        });
    }
    function cmdsToSvg(cmds) {
        const f = n => n.toFixed(1);
        return cmds.map(c => c[0] === 'Z' ? 'Z' : c[0] === 'Q' ? 'Q' + f(c[1]) + ' ' + f(c[2]) + ' ' + f(c[3]) + ' ' + f(c[4]) : c[0] + f(c[1]) + ' ' + f(c[2])).join('');
    }
    // Directed unit edges [ax, ay, bx, by, round] (clockwise around the filled side) -> closed loops.
    function traceLoops(edges) {
        const out = new Map();
        edges.forEach((e, idx) => { const k = e[0] + ',' + e[1]; if (!out.has(k)) out.set(k, []); out.get(k).push(idx); });
        const used = new Array(edges.length).fill(false), loops = [];
        for (let s0 = 0; s0 < edges.length; s0++) {
            if (used[s0]) continue;
            const pts = [], rnd = [];
            let cur = s0, guard = 0;
            while (cur !== undefined && !used[cur] && guard++ < 200000) {
                used[cur] = true;
                pts.push([edges[cur][0], edges[cur][1]]);
                rnd.push(edges[cur][4] | 0);
                const list = out.get(edges[cur][2] + ',' + edges[cur][3]) || [];
                cur = list.find(i => !used[i]);
            }
            if (pts.length >= 4) loops.push({ pts, rnd });
        }
        return loops;
    }
    // Undirected wall segments [i1, j1, i2, j2, round] -> runs through plain two-way
    // vertices. Round and non-round segments never share a run, so a square
    // wall touching a round room stays square.
    function chainSegments(segs) {
        const adj = new Map();
        const vk = (sg, which) => (which ? sg[2] + ',' + sg[3] : sg[0] + ',' + sg[1]) + 'L' + (sg[4] | 0);
        segs.forEach((sg, idx) => [vk(sg, 0), vk(sg, 1)].forEach(k => { if (!adj.has(k)) adj.set(k, []); adj.get(k).push(idx); }));
        const used = new Array(segs.length).fill(false), chains = [];
        const other = (sg, key) => ((vk(sg, 0) === key) ? [sg[2], sg[3]] : [sg[0], sg[1]]);
        segs.forEach((s0, idx0) => {
            if (used[idx0]) return;
            used[idx0] = true;
            const flag = 'L' + (s0[4] | 0);
            const pts = [[s0[0], s0[1]], [s0[2], s0[3]]];
            function extend(atEnd) {
                for (let guard = 0; guard < 200000; guard++) {
                    const tip = atEnd ? pts[pts.length - 1] : pts[0], key = tip[0] + ',' + tip[1] + flag;
                    const list = adj.get(key);
                    if (!list || list.length !== 2) return;
                    const nxt = list.find(i => !used[i]);
                    if (nxt === undefined) return;
                    used[nxt] = true;
                    const o = other(segs[nxt], key);
                    if (atEnd) pts.push(o); else pts.unshift(o);
                }
            }
            extend(true); extend(false);
            const closed = pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
            if (closed) pts.pop();
            chains.push({ pts, closed, round: s0[4] | 0 });
        });
        return chains;
    }

    // ---------- The under-layer: hatching, floors, outlines ----------
    // g = { cols, rows, step, ox, oy, cell(c, r), rcOffset }
    //   cell(c, r) -> null, or { floor: 'stone'|'wood'|'tile'|'dirt'|'pebble'|null, solid: bool, round: bool, rc: [cx, cy, r] }
    //   rc: this cell belongs to a TRUE-circle room (center cx, cy and radius r, in cell units)
    //   — drawn as a perfect circle instead of following the cell staircase.
    //   rs: this cell belongs to a drawn room (circle, polygon or freehand). g.shapes[rs] is its
    //   definition { c: [cx, cy, r] } or { p: [[x, y], ...] } (cell units), plus cells: ['c,R', ...], the
    //   cells it covered when drawn; g.shapeOrder lists the ids oldest-first so newer rooms paint on top.
    //   rcOffset [dx, dy]: added to a circle's center / a shape's points to get this area's cell units.
    // ox/oy are the absolute map index of this area's (0, 0), only used so
    // the wobble stays put while a scrolling view recentres.
    // The look is designed at 27px squares (the builder's size). For any other square size (the map generator's
    // preview draws smaller or larger ones) it is drawn at 27 and scaled, so hatching, outlines and textures keep
    // their proportions.
    MS.paintUnder = function (ctx, g) {
        const sc = g.step / 27;
        if (Math.abs(sc - 1) < 1e-6) return paintUnderBase(ctx, g);
        ctx.save();
        ctx.scale(sc, sc);
        paintUnderBase(ctx, Object.assign({}, g, { step: 27, shadowScale: sc }));
        ctx.restore();
    };
    function paintUnderBase(ctx, g) {
        const cols = g.cols, rows = g.rows, step = g.step, ox = g.ox || 0, oy = g.oy || 0, SS = g.shadowScale || 1;
        const F = [], X = [], RD = [], RC = [], circles = new Map(), fholes = [], WT = [], LQ = [];
        const rco = g.rcOffset || [0, 0];
        for (let r = 0; r < rows; r++) {
            F.push(new Array(cols).fill(null)); X.push(new Array(cols).fill(false)); RD.push(new Array(cols).fill(0)); RC.push(new Array(cols).fill(null)); WT.push(new Array(cols).fill(-1)); LQ.push(new Array(cols).fill(null));
            for (let c = 0; c < cols; c++) {
                const s = g.cell(c, r);
                if (!s) continue;
                if (s.floor) {
                    F[r][c] = s.floor;
                    if (s.fh) fholes.push({ c, r, holes: s.fh });
                    if (s.round) RD[r][c] = s.round | 0;
                    if (s.rc) {
                        const key = 'c:' + s.rc.join(',');
                        RC[r][c] = key;
                        if (!circles.has(key)) circles.set(key, { rc: s.rc, kind: s.floor });
                    } else if (s.rs && g.shapes && g.shapes[s.rs]) {
                        const def = g.shapes[s.rs], key = 's:' + s.rs;
                        RC[r][c] = key;
                        if (!circles.has(key)) circles.set(key, def.c ? { rc: def.c, kind: s.floor, id: s.rs } : { pts: def.p, kind: s.floor, id: s.rs });
                    }
                }
                if (s.solid) X[r][c] = true;
                if (s.water) { WT[r][c] = s.round | 0; LQ[r][c] = s.liquid || 'water'; } // water or lava: -1 = none, else its smoothing level
            }
        }
        const isFloor = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows && !!F[r][c];
        // Colour and tiled pattern for each terrain drawn as a shape (same look as the painted squares)
        function terrainFill(kind) {
            const T = MS._terrainFills || (MS._terrainFills = {});
            if (T[kind]) return T[kind];
            const mk = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')); return c; };
            const tri = (g2, col, a) => { g2.globalAlpha = a; g2.fillStyle = col; g2.beginPath(); g2.moveTo(8, 3); g2.lineTo(13, 13); g2.lineTo(3, 13); g2.closePath(); g2.fill(); };
            const defs = {
                water: { bg: '#2e86de', alpha: 0.78, tile: mk(16, 16, g2 => { g2.fillStyle = 'rgba(0,0,0,.12)'; g2.fillRect(0, 0, 8, 8); g2.fillRect(8, 8, 8, 8); }) },
                forest: { bg: '#3f6b3f', alpha: 0.9, tile: mk(12, 12, g2 => { g2.fillStyle = 'rgba(0,0,0,.3)'; g2.beginPath(); g2.arc(6, 6, 2, 0, Math.PI * 2); g2.fill(); }) },
                mountain: { bg: '#8f8f8f', alpha: 0.9, tile: mk(16, 16, g2 => tri(g2, '#fff', 0.55)) },
                peak: { bg: '#f0f0f0', alpha: 0.9, tile: mk(16, 16, g2 => tri(g2, '#444', 0.5)) },
                plains: { bg: '#c9c17a', alpha: 0.85, tile: null },
                lava: { bg: '#d9480f', alpha: 0.92, tile: mk(16, 16, g2 => { g2.strokeStyle = 'rgba(255,209,102,.75)'; g2.lineWidth = 1.3; g2.beginPath(); g2.moveTo(0, 3); g2.quadraticCurveTo(4, 0, 8, 3); g2.quadraticCurveTo(12, 6, 16, 3); g2.moveTo(0, 11); g2.quadraticCurveTo(4, 8, 8, 11); g2.quadraticCurveTo(12, 14, 16, 11); g2.stroke(); g2.fillStyle = 'rgba(122,31,6,.35)'; g2.beginPath(); g2.arc(11, 7, 2.4, 0, Math.PI * 2); g2.fill(); }) },
                sky: { bg: '#9fd2f2', alpha: 0.9, tile: mk(16, 16, g2 => { g2.fillStyle = 'rgba(255,255,255,.55)'; g2.beginPath(); g2.ellipse(6, 6, 5, 2.4, 0, 0, Math.PI * 2); g2.fill(); g2.fillStyle = 'rgba(255,255,255,.45)'; g2.beginPath(); g2.ellipse(12, 13, 4, 2, 0, 0, Math.PI * 2); g2.fill(); }) },
                hills: { bg: '#8a7355', alpha: 0.9, tile: mk(16, 10, g2 => { g2.fillStyle = 'rgba(255,255,255,.22)'; g2.beginPath(); g2.moveTo(0, 10); g2.quadraticCurveTo(8, 0, 16, 10); g2.closePath(); g2.fill(); }) }
            };
            return (T[kind] = defs[kind] || defs.water);
        }
        function drawWaterShapes() {
            if (!waterIds.length) return;
            // every shape goes onto one layer at full strength, in the order drawn, so the last one drawn covers the
            // ones under it; the whole layer then goes over the paper slightly soft
            const layer = document.createElement('canvas');
            layer.width = ctx.canvas.width; layer.height = ctx.canvas.height;
            const L = layer.getContext('2d');
            L.setTransform(ctx.getTransform());
            waterIds.forEach(id => {
                const def = g.shapes[id], path = new Path2D();
                const tf = terrainFill(def.terrain || 'water');
                let bx0, by0, bx1, by1;
                if (def.c) {
                    const cx = (def.c[0] + rco[0] + 1) * step, cy = (def.c[1] + rco[1] + 1) * step, rad = def.c[2] * step;
                    path.arc(cx, cy, rad, 0, Math.PI * 2);
                    bx0 = cx - rad; by0 = cy - rad; bx1 = cx + rad; by1 = cy + rad;
                } else if (Array.isArray(def.p) && def.p.length > 2) {
                    bx0 = by0 = Infinity; bx1 = by1 = -Infinity;
                    def.p.forEach((p, q) => {
                        const x = (p[0] + rco[0] + 1) * step, y = (p[1] + rco[1] + 1) * step;
                        if (q) path.lineTo(x, y); else path.moveTo(x, y);
                        bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
                    });
                    path.closePath();
                } else return;
                const pad = 6, tw = Math.max(1, Math.ceil(bx1 - bx0) + pad * 2), th = Math.max(1, Math.ceil(by1 - by0) + pad * 2);
                const tmp = document.createElement('canvas');
                tmp.width = tw; tmp.height = th;
                const t = tmp.getContext('2d');
                t.translate(pad - bx0, pad - by0);
                t.fillStyle = tf.bg;
                t.fill(path);
                if (tf.tile) {
                    t.save(); t.clip(path);
                    t.fillStyle = t.createPattern(tf.tile, 'repeat');
                    t.fillRect(bx0 - 1, by0 - 1, bx1 - bx0 + 2, by1 - by0 + 2);
                    t.restore();
                }
                if (def.holes && def.holes.length) { // parts erased with the box eraser
                    t.globalCompositeOperation = 'destination-out';
                    def.holes.forEach(h => t.fillRect((h[0] + rco[0] + 1) * step, (h[1] + rco[1] + 1) * step, (h[2] - h[0]) * step, (h[3] - h[1]) * step));
                    t.globalCompositeOperation = 'source-over';
                }
                L.drawImage(tmp, bx0 - pad, by0 - pad);
                if (def.border === 'shore') { // a thin inked shoreline, no wall
                    L.save();
                    L.lineJoin = 'round'; L.strokeStyle = INK; L.lineWidth = 1.7;
                    L.stroke(path);
                    L.restore();
                }
            });
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 0.86;
            ctx.drawImage(layer, 0, 0);
            ctx.restore();
        }
        // Water squares become one smoothed shape, filled soft over the paper (the same blue and chequer as a painted water tile)
        // mode 'floor': only water squares that sit on a floor (drawn inside the floor's edge); 'bare': only those that do not
        function drawWater(mode) { drawLiquid('water', mode); drawLiquid('lava', mode); }
        function drawLiquid(kind, mode) {
            const edgesW = [];
            const use = (cc, rr) => cc >= 0 && rr >= 0 && cc < cols && rr < rows && WT[rr][cc] >= 0 && LQ[rr][cc] === kind && (!mode || (mode === 'floor') === !!F[rr][cc]);
            for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
                if (!use(c, r)) continue;
                const i = c + 1, j = r + 1, lv = WT[r][c], w = use;
                if (!w(c, r - 1)) edgesW.push([i, j, i + 1, j, lv]);
                if (!w(c + 1, r)) edgesW.push([i + 1, j, i + 1, j + 1, lv]);
                if (!w(c, r + 1)) edgesW.push([i + 1, j + 1, i, j + 1, lv]);
                if (!w(c - 1, r)) edgesW.push([i, j + 1, i, j, lv]);
            }
            const Vw = (i, j) => { const q = jit(i + ox, j + oy, 1.6); return [i * step + q[0], j * step + q[1]]; };
            if (!edgesW.length) return;
            const pool = new Path2D(), tf = terrainFill(kind);
            traceLoops(edgesW).forEach(loop => cmdsToPath2D(roundedCommands(loop.pts, loop.rnd, true, Vw, step), pool));
            ctx.save();
            ctx.globalAlpha = kind === 'lava' ? 0.92 : 0.78;
            ctx.fillStyle = tf.bg;
            ctx.fill(pool);
            ctx.clip(pool);
            if (tf.tile) {
                ctx.fillStyle = ctx.createPattern(tf.tile, 'repeat');
                ctx.fillRect(step, step, cols * step, rows * step);
            }
            if (kind === 'lava') { // a darker crust round the edge, like cooled rock
                ctx.globalAlpha = 0.55; ctx.lineJoin = 'round'; ctx.strokeStyle = '#5a1a05'; ctx.lineWidth = 3;
                ctx.stroke(pool);
            }
            ctx.restore();
        }
        let anyFloor = false;
        for (let r = 0; r < rows && !anyFloor; r++) for (let c = 0; c < cols; c++) if (F[r][c]) { anyFloor = true; break; }
        const anyWater = WT.some(row => row.some(v => v >= 0));
        // water drawn with the room tools (Rooms > Water): shapes flagged water, filled in order, no squares involved
        const waterIds = Object.keys(g.shapes || {}).filter(id => g.shapes[id] && (g.shapes[id].terrain || g.shapes[id].water));
        if (g.shapeOrder) waterIds.sort((a, b) => g.shapeOrder.indexOf(a) - g.shapeOrder.indexOf(b));
        if (!anyFloor && !anyWater && !waterIds.length) return;
        if (!anyFloor) { drawWater(); drawWaterShapes(); return; }

        // 1. Hatching in the rock around floors: dense within one cell of a
        //    room, a lighter scatter at two cells, so the edge fades out.
        const hatch = new Path2D(), cross = new Path2D();
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            if ((F[r][c] && !RC[r][c]) || X[r][c] || g.noHatch) continue;
            // nearest floor, by king-move distance, looking out two cells
            let dist = RC[r][c] ? 1 : 0; // a circle room's cells are hatched underneath, then covered by the disc
            for (let d = 1; d <= 2 && !dist; d++) {
                for (let dr = -d; dr <= d && !dist; dr++) for (let dc = -d; dc <= d; dc++) {
                    if (Math.max(Math.abs(dr), Math.abs(dc)) === d && isFloor(c + dc, r + dr)) { dist = d; break; }
                }
            }
            if (!dist) continue;
            const x0 = (c + 1) * step, y0 = (r + 1) * step;
            const R = rng(hash2(c + ox, r + oy, 9) * 1e9);
            if (dist === 1) {
                ctx.fillStyle = 'rgba(108,86,56,.16)';
                ctx.fillRect(x0, y0, step, step);
            } else {
                ctx.fillStyle = 'rgba(108,86,56,.07)';
                ctx.fillRect(x0, y0, step, step);
            }
            const n = dist === 1 ? 24 : 7, nCross = dist === 1 ? 8 : 0;
            for (let k = 0; k < n + nCross; k++) {
                const isCross = k >= n, ang = (isCross ? -0.25 : -1.0) + (R() - 0.5) * 0.22;
                const len = 5 + R() * 5, cx = x0 + R() * step, cy = y0 + R() * step;
                const dx = Math.cos(ang) * len / 2, dy = Math.sin(ang) * len / 2, P = isCross ? cross : hatch;
                P.moveTo(cx - dx, cy - dy); P.lineTo(cx + dx, cy + dy);
            }
        }
        ctx.save();
        ctx.beginPath(); ctx.rect(step, step, cols * step, rows * step); ctx.clip(); // never hatch over the row/column labels
        ctx.lineCap = 'round';
        ctx.lineWidth = 0.9; ctx.strokeStyle = 'rgba(42,33,24,.72)'; ctx.stroke(hatch);
        ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(42,33,24,.5)'; ctx.stroke(cross);
        ctx.restore();

        // 2. Floors: trace the room's outline into one smooth region (so the
        //    shadow is cast once around the whole room, and a round room is
        //    round), then lay the texture on top, clipped to that region.
        const V = (i, j) => { const w = jit(i + ox, j + oy, 1.6); return [i * step + w[0], j * step + w[1]]; };
        const boundary = [], byKind = {};
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const k = F[r][c];
            if (!k || RC[r][c]) continue;
            const i = c + 1, j = r + 1;
            (byKind[k] || (byKind[k] = new Path2D())).rect(i * step, j * step, step, step);
            const rd = RD[r][c];
            // Next to a drawn (circle / polygon / freehand) room's cells counts as the edge of THIS floor too: those cells
            // are drawn by their own shape, so leaving them out of this outline is what keeps it a closed loop.
            const plain = (cc, rr) => cc >= 0 && rr >= 0 && cc < cols && rr < rows && !!F[rr][cc] && !RC[rr][cc];
            if (!plain(c, r - 1)) boundary.push([i, j, i + 1, j, rd]);
            if (!plain(c + 1, r)) boundary.push([i + 1, j, i + 1, j + 1, rd]);
            if (!plain(c, r + 1)) boundary.push([i + 1, j + 1, i, j + 1, rd]);
            if (!plain(c - 1, r)) boundary.push([i, j + 1, i, j, rd]);
        }
        const region = new Path2D();
        traceLoops(boundary).forEach(loop => cmdsToPath2D(roundedCommands(loop.pts, loop.rnd, true, V, step), region));
        ctx.save();
        ctx.shadowColor = 'rgba(28,20,10,.55)'; ctx.shadowBlur = 9 * SS; ctx.shadowOffsetX = 2 * SS; ctx.shadowOffsetY = 3 * SS;
        ctx.fillStyle = '#d6ccb8';
        ctx.fill(region);
        ctx.restore();
        ctx.save();
        ctx.clip(region);
        Object.keys(byKind).forEach(kind => {
            ctx.fillStyle = ctx.createPattern(floorTile(kind, step), 'repeat') || FLOOR_BASE[kind] || FLOOR_BASE.stone;
            ctx.fill(byKind[kind]);
        });
        ctx.restore();

        // Floor squares that were only partly erased: cut the erased bits out of what is drawn so far (rooms drawn
        // later are not affected, and a drawn room's own floor has its own holes).
        if (fholes.length) {
            ctx.save();
            ctx.globalCompositeOperation = 'destination-out';
            fholes.forEach(f => {
                if (RC[f.r][f.c]) return;
                f.holes.forEach(h => ctx.fillRect((h[0] + rco[0] + 1) * step, (h[1] + rco[1] + 1) * step, (h[2] - h[0]) * step, (h[3] - h[1]) * step));
            });
            ctx.restore();
        }

        // 3. Ink outline around the whole room.
        ctx.save();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = INK; ctx.lineWidth = 2.4;
        ctx.stroke(region);
        ctx.restore();

        // 4. Drawn rooms (circle / polygon / freehand): the exact shape with the same shadow and texture,
        //    oldest first so a newer room sits on top of an older one.
        const order = g.shapeOrder || [];
        Array.from(circles.values()).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)).forEach(ci => {
            const disc = new Path2D();
            let bx0, by0, bx1, by1;
            if (ci.rc) {
                const cx = (ci.rc[0] + rco[0] + 1) * step, cy = (ci.rc[1] + rco[1] + 1) * step, rad = ci.rc[2] * step;
                disc.arc(cx, cy, rad, 0, Math.PI * 2);
                bx0 = cx - rad; by0 = cy - rad; bx1 = cx + rad; by1 = cy + rad;
            } else {
                bx0 = by0 = Infinity; bx1 = by1 = -Infinity;
                ci.pts.forEach((p, q) => {
                    const x = (p[0] + rco[0] + 1) * step, y = (p[1] + rco[1] + 1) * step;
                    if (q) disc.lineTo(x, y); else disc.moveTo(x, y);
                    bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
                });
                disc.closePath();
            }
            const holes = (ci.id && g.shapes && g.shapes[ci.id] && g.shapes[ci.id].holes) || null;
            if (holes && holes.length) {
                // part of this room's floor was erased: draw it on its own layer, cut the erased boxes out, then lay it down
                const pad = 12, tw = Math.max(1, Math.ceil(bx1 - bx0) + pad * 2), th = Math.max(1, Math.ceil(by1 - by0) + pad * 2);
                const tmp = document.createElement('canvas');
                tmp.width = tw; tmp.height = th;
                const t = tmp.getContext('2d');
                t.translate(pad - bx0, pad - by0);
                t.fillStyle = '#d6ccb8';
                t.fill(disc);
                t.save();
                t.clip(disc);
                t.fillStyle = t.createPattern(floorTile(ci.kind, step), 'repeat') || FLOOR_BASE[ci.kind] || FLOOR_BASE.stone;
                t.fillRect(bx0 - 1, by0 - 1, bx1 - bx0 + 2, by1 - by0 + 2);
                t.restore();
                t.globalCompositeOperation = 'destination-out';
                holes.forEach(h => t.fillRect((h[0] + rco[0] + 1) * step, (h[1] + rco[1] + 1) * step, (h[2] - h[0]) * step, (h[3] - h[1]) * step));
                ctx.save();
                ctx.shadowColor = 'rgba(28,20,10,.55)'; ctx.shadowBlur = 9 * SS; ctx.shadowOffsetX = 2 * SS; ctx.shadowOffsetY = 3 * SS;
                ctx.drawImage(tmp, bx0 - pad, by0 - pad);
                ctx.restore();
                return;
            }
            ctx.save();
            ctx.shadowColor = 'rgba(28,20,10,.55)'; ctx.shadowBlur = 9 * SS; ctx.shadowOffsetX = 2 * SS; ctx.shadowOffsetY = 3 * SS;
            ctx.fillStyle = '#d6ccb8';
            ctx.fill(disc);
            ctx.restore();
            ctx.save();
            ctx.clip(disc);
            ctx.fillStyle = ctx.createPattern(floorTile(ci.kind, step), 'repeat') || FLOOR_BASE[ci.kind] || FLOOR_BASE.stone;
            ctx.fillRect(bx0 - 1, by0 - 1, bx1 - bx0 + 2, by1 - by0 + 2);
            ctx.restore();
            // no outline here: the walls (drawn by edgesSvg) ink the shape, so an erased wall or a door leaves a real gap
        });
        // A plain floor painted over part of a drawn room AFTER it (a square room, say) wins in the overlap:
        // put those cells back on top of the shape, and ink the plain floor's outline again.
        if (circles.size && g.shapes) {
            const refill = {};
            Object.keys(g.shapes).forEach(id => {
                const def = g.shapes[id];
                (def && def.cells || []).forEach(k => {
                    const p = k.split(','), c = parseInt(p[0], 10) + rco[0], r = parseInt(p[1], 10) - 1 + rco[1];
                    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
                    if (F[r][c] && !RC[r][c]) (refill[F[r][c]] || (refill[F[r][c]] = new Path2D())).rect((c + 1) * step, (r + 1) * step, step, step);
                });
            });
            Object.keys(refill).forEach(kind => {
                ctx.fillStyle = ctx.createPattern(floorTile(kind, step), 'repeat') || FLOOR_BASE[kind] || FLOOR_BASE.stone;
                ctx.fill(refill[kind]);
            });
            ctx.save();
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.strokeStyle = INK; ctx.lineWidth = 2.4;
            ctx.stroke(region);
            ctx.restore();
        }
        if (anyWater) {
            drawWater('bare');
            // water on a floor stays inside the floor's edge (a cave pool that touches the rock does not poke past it)
            ctx.save();
            ctx.clip(region);
            drawWater('floor');
            ctx.restore();
            ctx.save();
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.strokeStyle = INK; ctx.lineWidth = 2.4;
            ctx.stroke(region);
            ctx.restore();
        }
        drawWaterShapes();
    }

    // ---------- Freehand ink walls and polygon geometry ----------
    // A freehand wall is a list of points [[x, y], ...] in CELL units
    // (x = column, y = row measured from the top, so cell (c, r) with a
    // 1-based key row R covers x in [c, c+1), y in [R-1, R)). They can sit
    // anywhere on the grid, not just on cell edges.
    function ccw(ax, ay, bx, by, cx, cy) { return (cy - ay) * (bx - ax) - (by - ay) * (cx - ax); }
    MS.segCross = function (ax, ay, bx, by, cx, cy, dx, dy) {
        const d1 = ccw(ax, ay, bx, by, cx, cy), d2 = ccw(ax, ay, bx, by, dx, dy);
        const d3 = ccw(cx, cy, dx, dy, ax, ay), d4 = ccw(cx, cy, dx, dy, bx, by);
        return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
    };
    // The points of a drawn wall: a freehand wall is the list itself, a castle (thick) wall keeps them in .p; rooms have none
    MS.inkPts = function (w) { return Array.isArray(w) ? w : (w && w.t === 'wall' && Array.isArray(w.p) ? w.p : null); };
    // Does the straight line (x0,y0)-(x1,y1) cross any freehand wall?
    MS.inkBlocks = function (strokes, x0, y0, x1, y1) {
        const minX = Math.min(x0, x1) - 0.01, maxX = Math.max(x0, x1) + 0.01, minY = Math.min(y0, y1) - 0.01, maxY = Math.max(y0, y1) + 0.01;
        for (let k = 0; k < strokes.length; k++) {
            const pts = MS.inkPts(strokes[k]);
            if (!pts) continue;
            for (let i = 0; i + 1 < pts.length; i++) {
                const a = pts[i], b = pts[i + 1];
                if (Math.max(a[0], b[0]) < minX || Math.min(a[0], b[0]) > maxX || Math.max(a[1], b[1]) < minY || Math.min(a[1], b[1]) > maxY) continue;
                if (MS.segCross(x0, y0, x1, y1, a[0], a[1], b[0], b[1])) return true;
            }
        }
        return false;
    };
    // Smooth a closed outline by cutting its corners (Chaikin), `iterations` times.
    MS.smoothClosed = function (pts, iterations) {
        let cur = pts.slice();
        for (let it = 0; it < iterations; it++) {
            const next = [];
            for (let i = 0; i < cur.length; i++) {
                const p = cur[i], q = cur[(i + 1) % cur.length];
                next.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25], [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
            }
            cur = next;
        }
        return cur;
    };
    // Index of the freehand wall passing within `radius` cells of a point, or -1.
    MS.inkNear = function (strokes, x, y, radius) {
        let best = -1, bestD = radius;
        strokes.forEach((raw, k) => {
            const pts = MS.inkPts(raw);
            if (!pts) return;
            for (let i = 0; i + 1 < pts.length; i++) {
                const a = pts[i], b = pts[i + 1], vx = b[0] - a[0], vy = b[1] - a[1];
                const len2 = vx * vx + vy * vy;
                const t = len2 ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / len2)) : 0;
                const d = Math.hypot(x - (a[0] + t * vx), y - (a[1] + t * vy));
                if (d < bestD) { bestD = d; best = k; }
            }
        });
        return best;
    };
    // Drop points closer than minDist to the previous kept one (keeps the end).
    MS.simplifyPath = function (pts, minDist) {
        if (pts.length < 3) return pts.slice();
        const out = [pts[0]];
        for (let i = 1; i < pts.length - 1; i++) {
            const last = out[out.length - 1];
            if (Math.hypot(pts[i][0] - last[0], pts[i][1] - last[1]) >= minDist) out.push(pts[i]);
        }
        out.push(pts[pts.length - 1]);
        return out;
    };
    MS.pointInPolygon = function (x, y, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
    };
    // A freehand wall as a smooth SVG path through pixel points.
    function smoothPathD(pts) {
        if (pts.length < 2) return '';
        const f = n => n.toFixed(1);
        let d = 'M' + f(pts[0][0]) + ' ' + f(pts[0][1]);
        if (pts.length === 2) return d + 'L' + f(pts[1][0]) + ' ' + f(pts[1][1]);
        for (let k = 1; k < pts.length - 1; k++) {
            const mx = (pts[k][0] + pts[k + 1][0]) / 2, my = (pts[k][1] + pts[k + 1][1]) / 2;
            d += 'Q' + f(pts[k][0]) + ' ' + f(pts[k][1]) + ' ' + f(mx) + ' ' + f(my);
        }
        const last = pts[pts.length - 1];
        return d + 'L' + f(last[0]) + ' ' + f(last[1]);
    }
    // Plain (non-parchment) rendering of freehand walls, for the classic look.
    // The castle-wall brick, as an svg pattern (stone with mortar lines); colours differ between the two looks
    function brickPattern(id, stone, mortar) {
        return '<pattern id="' + id + '" width="12" height="8" patternUnits="userSpaceOnUse"><rect width="12" height="8" fill="' + stone + '"/>' +
            '<path d="M0 .5H12M0 4.5H12M0 .5V4.5M6 4.5V8.5" fill="none" stroke="' + mortar + '" stroke-width="1"/></pattern>';
    }
    MS.inkClassicSvg = function (strokesPx, w, h, thickPx) {
        thickPx = thickPx || [];
        if (!strokesPx.length && !thickPx.length) return '';
        const d = strokesPx.map(smoothPathD).join(''), dt = thickPx.map(smoothPathD).join('');
        return '<svg width="' + w + '" height="' + h + '" style="position:absolute; left:0; top:0; overflow:visible; pointer-events:none;" xmlns="http://www.w3.org/2000/svg">' +
            (dt ? '<defs>' + brickPattern('msBrickC', '#5d574c', '#2f2b25') + '</defs><path d="' + dt + '" fill="none" stroke="#2b2b2b" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/><path d="' + dt + '" fill="none" stroke="url(#msBrickC)" stroke-width="8" stroke-linecap="butt" stroke-linejoin="round"/>' : '') +
            (d ? '<path d="' + d + '" fill="none" stroke="#2b2b2b" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>' : '') + '</svg>';
    };

    // ---------- Closing a drawn line against existing walls into a room ----------
    // Douglas-Peucker on a closed polygon (points [[x, y], ...]): thins it to the points that matter.
    function dpOpen(pts, eps) {
        if (pts.length < 3) return pts.slice();
        const a = pts[0], b = pts[pts.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
        let worst = -1, worstD = 0;
        for (let i = 1; i < pts.length - 1; i++) {
            const d = Math.abs((pts[i][0] - a[0]) * dy - (pts[i][1] - a[1]) * dx) / len;
            if (d > worstD) { worstD = d; worst = i; }
        }
        if (worstD <= eps) return [a, b];
        return dpOpen(pts.slice(0, worst + 1), eps).slice(0, -1).concat(dpOpen(pts.slice(worst), eps));
    }
    MS.simplifyPolygon = function (pts, eps) {
        if (pts.length < 4) return pts.slice();
        let far = 0, farD = -1;
        for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > farD) { farD = d; far = i; } }
        const h1 = dpOpen(pts.slice(0, far + 1), eps), h2 = dpOpen(pts.slice(far).concat([pts[0]]), eps);
        return h1.slice(0, -1).concat(h2.slice(0, -1));
    };
    // Finds the area a drawn line closes off together with existing walls, and returns its outline as a
    // polygon in cell units — or null if the line doesn't seal anything off. Works on a fine raster of the
    // map: every wall is drawn into it as a barrier, then the squares on each side of the line are flood-filled.
    // A side that reaches the edge of the map is open ground, not a room; if both sides run into each other the
    // line doesn't divide anything. Of the sealed-off areas, the smaller one is the room.
    //   o = { cols, rows, segments: [[x0, y0, x1, y1], ...] (walls, cell units), solidCells: [[c, r0], ...],
    //         stroke: [[x, y], ...] (the new line, cell units) }
    MS.enclosedRegion = function (o) {
        const cols = o.cols, rows = o.rows;
        const res = Math.max(3, Math.min(8, Math.floor(3600 / Math.max(cols, rows))));
        const W = cols * res, H = rows * res;
        const barrier = new Uint8Array(W * H);
        const mark = (x, y) => {
            const px = Math.floor(x * res), py = Math.floor(y * res);
            for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) { const xx = px + dx, yy = py + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) barrier[yy * W + xx] = 1; }
        };
        const line = (x0, y0, x1, y1) => {
            const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * res * 1.5));
            for (let i = 0; i <= n; i++) mark(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n);
        };
        o.segments.forEach(sg => line(sg[0], sg[1], sg[2], sg[3]));
        for (let i = 0; i + 1 < o.stroke.length; i++) line(o.stroke[i][0], o.stroke[i][1], o.stroke[i + 1][0], o.stroke[i + 1][1]);
        (o.solidCells || []).forEach(cr => {
            for (let y = cr[1] * res; y < (cr[1] + 1) * res; y++) for (let x = cr[0] * res; x < (cr[0] + 1) * res; x++) if (x >= 0 && y >= 0 && x < W && y < H) barrier[y * W + x] = 1;
        });
        // seeds either side of the new line
        const st = o.stroke, left = [], right = [];
        const sample = 9;
        for (let k = 1; k <= sample; k++) {
            const i = Math.min(st.length - 2, Math.max(0, Math.round((st.length - 1) * k / (sample + 1))));
            const a = st[i], b = st[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
            if (!len) continue;
            const nx = -dy / len, ny = dx / len, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, off = 0.42;
            left.push([mx + nx * off, my + ny * off]); right.push([mx - nx * off, my - ny * off]);
        }
        const label = new Int32Array(W * H);
        const stack = new Int32Array(W * H);
        const regions = []; // { id, area, open }
        const fill = (sx, sy) => {
            const id = regions.length + 1;
            let sp = 0, area = 0, open = false;
            stack[sp++] = sy * W + sx; label[sy * W + sx] = id;
            while (sp) {
                const idx = stack[--sp], x = idx % W, y = (idx - x) / W;
                area++;
                if (x === 0 || y === 0 || x === W - 1 || y === H - 1) open = true;
                if (x > 0) { const n = idx - 1; if (!barrier[n] && !label[n]) { label[n] = id; stack[sp++] = n; } }
                if (x < W - 1) { const n = idx + 1; if (!barrier[n] && !label[n]) { label[n] = id; stack[sp++] = n; } }
                if (y > 0) { const n = idx - W; if (!barrier[n] && !label[n]) { label[n] = id; stack[sp++] = n; } }
                if (y < H - 1) { const n = idx + W; if (!barrier[n] && !label[n]) { label[n] = id; stack[sp++] = n; } }
            }
            regions.push({ id, area, open });
            return id;
        };
        const regionAt = pt => {
            const x = Math.floor(pt[0] * res), y = Math.floor(pt[1] * res);
            if (x < 0 || y < 0 || x >= W || y >= H || barrier[y * W + x]) return 0;
            return label[y * W + x] || fill(x, y);
        };
        const leftIds = new Set(left.map(regionAt).filter(Boolean)), rightIds = new Set(right.map(regionAt).filter(Boolean));
        for (const id of leftIds) if (rightIds.has(id)) return null; // both sides are one area: the line divides nothing
        const minArea = 0.5 * res * res;
        let best = null;
        regions.forEach(r => { if (!r.open && r.area >= minArea && (leftIds.has(r.id) || rightIds.has(r.id)) && (!best || r.area < best.area)) best = r; });
        if (!best) return null;
        // the area's outline: its squares, grown one step into the barrier so it reaches the middle of the walls
        const inReg = new Uint8Array(W * H);
        let x0 = W, y0 = H, x1 = 0, y1 = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (label[y * W + x] === best.id) {
            inReg[y * W + x] = 1;
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        const grown = inReg.slice();
        for (let y = Math.max(0, y0 - 1); y <= Math.min(H - 1, y1 + 1); y++) for (let x = Math.max(0, x0 - 1); x <= Math.min(W - 1, x1 + 1); x++) {
            const idx = y * W + x;
            if (!inReg[idx] && barrier[idx] && ((x > 0 && inReg[idx - 1]) || (x < W - 1 && inReg[idx + 1]) || (y > 0 && inReg[idx - W]) || (y < H - 1 && inReg[idx + W]))) grown[idx] = 1;
        }
        const inG = (x, y) => x >= 0 && y >= 0 && x < W && y < H && grown[y * W + x] === 1;
        const edges = [];
        for (let y = Math.max(0, y0 - 1); y <= Math.min(H - 1, y1 + 1); y++) for (let x = Math.max(0, x0 - 1); x <= Math.min(W - 1, x1 + 1); x++) {
            if (!inG(x, y)) continue;
            if (!inG(x, y - 1)) edges.push([x, y, x + 1, y, 0]);
            if (!inG(x + 1, y)) edges.push([x + 1, y, x + 1, y + 1, 0]);
            if (!inG(x, y + 1)) edges.push([x + 1, y + 1, x, y + 1, 0]);
            if (!inG(x - 1, y)) edges.push([x, y + 1, x, y, 0]);
        }
        const loops = traceLoops(edges);
        if (!loops.length) return null;
        const area2 = pts => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a); };
        let outer = loops[0].pts;
        loops.forEach(l => { if (area2(l.pts) > area2(outer)) outer = l.pts; });
        let poly = MS.simplifyPolygon(simplifyLoop(outer, outer.map(() => 0), true).pts, 0.8).map(p => [p[0] / res, p[1] / res]);
        if (poly.length < 3) return null;
        poly = MS.simplifyPolygon(MS.smoothClosed(poly, 1), 0.03);
        return poly.length >= 3 ? poly : null;
    };

    // ---------- Walls and doors (SVG, ink style) ----------
    // edges: [{ i1, j1, i2, j2, kind: 'wall'|'door', secret, hidden, material }]
    // in VERTEX coordinates (see the header). Returns an <svg> string meant
    // to be the whole innerHTML of the wall overlay.
    MS.edgesSvg = function (edges, g, opts) {
        const sc = g.step / 27, step = 27, ox = g.ox || 0, oy = g.oy || 0, w = g.width / sc, h = g.height / sc;
        opts = opts || {};
        const V = (i, j) => { const q = jit(i + ox, j + oy, 1.6); return [i * step + q[0], j * step + q[1]]; };
        let wallD = '', secretD = '', doors = '', thickD = '';
        const wallSegs = [], thickSegs = [];
        // Rooms drawn as true shapes — a circle (rc = [cx, cy, r]) or a polygon / freehand outline
        // (rs = id into opts.shapes) — are collected per shape and drawn after the loop as one clean
        // outline with gaps where a door or a missing wall is. Their stair-step cell edges are not drawn.
        const rco = opts.rcOffset || [0, 0];
        const shapes = opts.shapes || {};
        const circ = new Map();
        const groupKey = x => (x.rc ? 'c:' + x.rc.join(',') : (x.rs && shapes[x.rs] ? 's:' + x.rs : null));
        // A room remembers the cells it was drawn with (shapes[id].cells), so its outline never depends on who
        // owns those cells now: drawing another room across it can't open gaps. Only a door, or a wall piece that
        // was actually erased, leaves an opening. Older rooms without that list fall back to the cells' own flags.
        const groupFor = (key, x) => {
            if (!circ.has(key)) {
                const def = x.rc ? null : shapes[x.rs];
                circ.set(key, { thick: !!(def && def.thick), rc: x.rc || (def && def.c) || null, pts: x.rc ? null : (def && !def.c ? def.p : null), cells: new Set(def && def.cells ? def.cells : []), stored: !!(def && def.cells), present: new Map(), cuts: (def && def.cuts) || null });
            }
            return circ.get(key);
        };
        (opts.rcCells || []).forEach(cc => { const k = groupKey(cc); if (!k) return; const gr = groupFor(k, cc); if (!gr.stored) gr.cells.add(cc.c + ',' + cc.r); });
        Object.keys(shapes).forEach(id => { if (shapes[id] && shapes[id].cells) groupFor('s:' + id, { rs: id }); });
        // every wall/door by its stored key, whoever it belongs to — a wall counts as present if ANY room or plain wall is there
        const allEdges = new Map();
        edges.forEach(e => allEdges.set((e.j1 === e.j2 ? 'H:' : 'V:') + (e.i1 - 1 - rco[0]) + ',' + (e.j1 - rco[1]), e));
        const doorsDone = new Set();
        edges.forEach(e => {
            const gk = groupKey(e);
            if (gk) {
                const horizontal = e.j1 === e.j2;
                groupFor(gk, e).present.set((horizontal ? 'H:' : 'V:') + (e.i1 - 1 - rco[0]) + ',' + (e.j1 - rco[1]), e);
                return;
            }
            const a = V(e.i1, e.j1), b = V(e.i2, e.j2);
            if (e.kind === 'wall') {
                (e.thick ? thickSegs : wallSegs).push([e.i1, e.j1, e.i2, e.j2, e.round | 0]);
                if (e.secret && opts.showSecret) secretD += 'M' + a[0].toFixed(1) + ' ' + a[1].toFixed(1) + 'L' + b[0].toFixed(1) + ' ' + b[1].toFixed(1);
                return;
            }
            // door: a slim plank across the gap, inked like everything else (a window is the same slim frame with glass in it)
            const horizontal = e.j1 === e.j2;
            const mat = e.material || 'wood';
            const win = e.kind === 'window';
            const fill = win ? '#cfe3ec' : mat === 'metal' ? '#9aa1a8' : mat === 'jail' ? '#d9cfb9' : '#b98b52';
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]) - 4, thick = 7;
            const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
            const rx = horizontal ? mx - len / 2 : mx - thick / 2, ry = horizontal ? my - thick / 2 : my - len / 2;
            const rw = horizontal ? len : thick, rh = horizontal ? thick : len;
            let inner = '';
            if (win) {
                // a pane: a line down the middle and a short glint at each end
                inner = horizontal
                    ? '<line x1="' + (rx + 2) + '" y1="' + my + '" x2="' + (rx + rw - 2) + '" y2="' + my + '" stroke-width=".9"/><line x1="' + (mx - 1) + '" y1="' + (ry + 1.5) + '" x2="' + (mx - 1) + '" y2="' + (ry + rh - 1.5) + '" stroke-width=".7" opacity=".7"/>'
                    : '<line x1="' + mx + '" y1="' + (ry + 2) + '" x2="' + mx + '" y2="' + (ry + rh - 2) + '" stroke-width=".9"/><line x1="' + (rx + 1.5) + '" y1="' + (my - 1) + '" x2="' + (rx + rw - 1.5) + '" y2="' + (my - 1) + '" stroke-width=".7" opacity=".7"/>';
            } else if (mat === 'jail') {
                const bars = Math.max(3, Math.round(len / 5));
                for (let k = 1; k < bars; k++) {
                    const t = k / bars;
                    inner += horizontal
                        ? '<line x1="' + (rx + rw * t).toFixed(1) + '" y1="' + ry + '" x2="' + (rx + rw * t).toFixed(1) + '" y2="' + (ry + rh) + '"/>'
                        : '<line x1="' + rx + '" y1="' + (ry + rh * t).toFixed(1) + '" x2="' + (rx + rw) + '" y2="' + (ry + rh * t).toFixed(1) + '"/>';
                }
            } else {
                inner = horizontal
                    ? '<line x1="' + (rx + 2) + '" y1="' + my + '" x2="' + (rx + rw - 2) + '" y2="' + my + '" stroke-width=".8" opacity=".6"/><circle cx="' + (rx + rw * 0.78).toFixed(1) + '" cy="' + my + '" r="1.3" fill="' + INK + '" stroke="none"/>'
                    : '<line x1="' + mx + '" y1="' + (ry + 2) + '" x2="' + mx + '" y2="' + (ry + rh - 2) + '" stroke-width=".8" opacity=".6"/><circle cx="' + mx + '" cy="' + (ry + rh * 0.78).toFixed(1) + '" r="1.3" fill="' + INK + '" stroke="none"/>';
            }
            if (e.open) { // open: the leaf swung back, hinged at one end, standing across the doorway (a window too)
                doors += '<g transform="translate(' + mx.toFixed(1) + ' ' + my.toFixed(1) + ') rotate(' + (horizontal ? 0 : 90) + ')"' + (e.hidden ? ' opacity=".45"' : '') + '><rect x="' + (-len / 2 - thick / 2).toFixed(1) + '" y="0" width="' + thick + '" height="' + len.toFixed(1) + '" rx="1.5" fill="' + fill + '" stroke="' + INK + '" stroke-width="1.5"/></g>';
                return;
            }
            doors += '<g' + (e.hidden ? ' opacity=".45"' : '') + '><rect x="' + rx.toFixed(1) + '" y="' + ry.toFixed(1) + '" width="' + rw.toFixed(1) + '" height="' + rh.toFixed(1) + '" rx="1.5" fill="' + fill + '" stroke="' + INK + '" stroke-width="1.5"/>' +
                '<g stroke="' + INK + '" stroke-width="1" fill="none">' + inner + '</g></g>';
            const mark = opts.showState && (e.state === 'locked' ? '#b3261e' : e.state === 'stuck' ? '#d98a00' : null); // DM only: locked is red, stuck is amber
            if (mark) doors += '<circle cx="' + (horizontal ? rx + rw * 0.78 : mx).toFixed(1) + '" cy="' + (horizontal ? my : ry + rh * 0.78).toFixed(1) + '" r="3" fill="' + mark + '" stroke="' + INK + '" stroke-width=".8"/>';
        });
        // walls drawn as continuous runs; staircase corners (a round room) are rounded
        chainSegments(wallSegs).forEach(ch => { wallD += cmdsToSvg(roundedCommands(ch.pts, ch.pts.map(() => ch.round), ch.closed, V, step)); });
        chainSegments(thickSegs).forEach(ch => { thickD += cmdsToSvg(roundedCommands(ch.pts, ch.pts.map(() => ch.round), ch.closed, V, step)); });
        thickD += (opts.thick || []).map(smoothPathD).join('');
        const inkD = (opts.ink || []).map(smoothPathD).join('');
        circ.forEach(ci => {
            // the outline, in cell units: a sampled circle, or the drawn polygon itself
            let perim;
            if (ci.rc) {
                const n = Math.max(96, Math.ceil(2 * Math.PI * ci.rc[2] * 14));
                perim = [];
                for (let q = 0; q < n; q++) { const th = (q / n) * 2 * Math.PI; perim.push([ci.rc[0] + Math.cos(th) * ci.rc[2], ci.rc[1] + Math.sin(th) * ci.rc[2]]); }
            } else perim = ci.pts;
            if (!perim || perim.length < 3) return;
            // distance from a point to the closed outline (and where on it / which way it runs there)
            const nearest = pt => {
                let best = { d: Infinity, x: 0, y: 0, ang: 0 };
                for (let q = 0; q < perim.length; q++) {
                    const a = perim[q], b = perim[(q + 1) % perim.length], vx = b[0] - a[0], vy = b[1] - a[1], len2 = vx * vx + vy * vy;
                    const t = len2 ? Math.max(0, Math.min(1, ((pt[0] - a[0]) * vx + (pt[1] - a[1]) * vy) / len2)) : 0;
                    const x = a[0] + t * vx, y = a[1] + t * vy, d = Math.hypot(pt[0] - x, pt[1] - y);
                    if (d < best.d) best = { d, x, y, ang: Math.atan2(vy, vx) };
                }
                return best;
            };
            // expected boundary edges: every side of a shape cell that faces a cell outside the shape — but only
            // the ones lying on this outline (a smaller room drawn inside has edges of its own, far from it)
            const expect = [];
            ci.cells.forEach(k => {
                const p = k.split(','), c = parseInt(p[0], 10), r = parseInt(p[1], 10);
                const has = (cc, rr) => ci.cells.has(cc + ',' + rr);
                if (!has(c, r - 1)) expect.push(['H:' + c + ',' + r, c + 0.5, r - 1]);
                if (!has(c, r + 1)) expect.push(['H:' + c + ',' + (r + 1), c + 0.5, r]);
                if (!has(c - 1, r)) expect.push(['V:' + c + ',' + r, c, r - 0.5]);
                if (!has(c + 1, r)) expect.push(['V:' + (c + 1) + ',' + r, c + 1, r - 0.5]);
            });
            const gapMids = [];
            let anyEdge = false;
            expect.forEach(ex => {
                const near = nearest([ex[1], ex[2]]);
                if (near.d > 0.9) return;
                const present = allEdges.get(ex[0]);
                if (present) anyEdge = true;
                if (!present || present.kind === 'door' || present.kind === 'window') gapMids.push([ex[1], ex[2]]);
                if (present && (present.kind === 'door' || present.kind === 'window') && !doorsDone.has(ex[0])) {
                    doorsDone.add(ex[0]);
                    const mat = present.material || 'wood';
                    const win = present.kind === 'window';
                    const fill = win ? '#cfe3ec' : mat === 'metal' ? '#9aa1a8' : mat === 'jail' ? '#d9cfb9' : '#b98b52';
                    const px = (near.x + rco[0] + 1) * step, py = (near.y + rco[1] + 1) * step, deg = near.ang * 180 / Math.PI;
                    const len = step - 6, thick = 7;
                    let inner = '';
                    if (win) {
                        inner = '<line x1="' + (-len / 2 + 2) + '" y1="0" x2="' + (len / 2 - 2) + '" y2="0" stroke-width=".9"/><line x1="-1" y1="' + (-thick / 2 + 1.5) + '" x2="-1" y2="' + (thick / 2 - 1.5) + '" stroke-width=".7" opacity=".7"/>';
                    } else if (mat === 'jail') {
                        const bars = Math.max(3, Math.round(len / 5));
                        for (let q = 1; q < bars; q++) { const x = -len / 2 + len * q / bars; inner += '<line x1="' + x.toFixed(1) + '" y1="' + (-thick / 2) + '" x2="' + x.toFixed(1) + '" y2="' + (thick / 2) + '"/>'; }
                    } else {
                        inner = '<line x1="' + (-len / 2 + 2) + '" y1="0" x2="' + (len / 2 - 2) + '" y2="0" stroke-width=".8" opacity=".6"/><circle cx="' + (len * 0.28).toFixed(1) + '" cy="0" r="1.3" fill="' + INK + '" stroke="none"/>';
                    }
                    const rmark = opts.showState && (present.state === 'locked' ? '#b3261e' : present.state === 'stuck' ? '#d98a00' : null);
                    if (present.open) {
                        doors += '<g transform="translate(' + px.toFixed(1) + ' ' + py.toFixed(1) + ') rotate(' + deg.toFixed(1) + ')"' + (present.hidden ? ' opacity=".45"' : '') + '><rect x="' + (-len / 2 - thick / 2) + '" y="0" width="' + thick + '" height="' + len + '" rx="1.5" fill="' + fill + '" stroke="' + INK + '" stroke-width="1.5"/></g>';
                    } else {
                        doors += '<g transform="translate(' + px.toFixed(1) + ' ' + py.toFixed(1) + ') rotate(' + deg.toFixed(1) + ')"' + (present.hidden ? ' opacity=".45"' : '') + '>' +
                            '<rect x="' + (-len / 2) + '" y="' + (-thick / 2) + '" width="' + len + '" height="' + thick + '" rx="1.5" fill="' + fill + '" stroke="' + INK + '" stroke-width="1.5"/>' +
                            '<g stroke="' + INK + '" stroke-width="1" fill="none">' + inner + '</g>' + (rmark ? '<circle cx="' + (len * 0.28).toFixed(1) + '" cy="0" r="3" fill="' + rmark + '" stroke="' + INK + '" stroke-width=".8"/>' : '') + '</g>';
                    }
                }
            });
            if ((!ci.cells.size && !ci.present.size) || !anyEdge) return; // nothing of this room is on show
            // walk the outline in small steps (corners kept exactly), skipping the stretch near a gap
            const dense = [];
            for (let q = 0; q < perim.length; q++) {
                const a = perim[q], b = perim[(q + 1) % perim.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.12));
                for (let t = 0; t < n; t++) dense.push([a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n]);
            }
            // a part of the outline that was erased with the box eraser is simply not inked
            const inCut = pt => !!ci.cuts && ci.cuts.some(b => pt[0] >= b[0] - 0.093 && pt[0] <= b[2] + 0.093 && pt[1] >= b[1] - 0.093 && pt[1] <= b[3] + 0.093);
            const inGap = pt => inCut(pt) || gapMids.some(m => Math.hypot(pt[0] - m[0], pt[1] - m[1]) < 0.75);
            const flags = dense.map(inGap);
            const toPx = pt => [(pt[0] + rco[0] + 1) * step, (pt[1] + rco[1] + 1) * step];
            const fmt = pt => pt[0].toFixed(1) + ' ' + pt[1].toFixed(1);
            const firstGap = flags.indexOf(true);
            const addWall = str => { if (ci.thick) thickD += str; else wallD += str; };
            if (firstGap < 0) {
                addWall('M' + dense.map(p => fmt(toPx(p))).join('L') + 'Z');
            } else {
                // start just after a gap so no run is split across the start of the list
                const n = dense.length, runs = []; let cur = null;
                for (let q = 1; q <= n; q++) {
                    const idx = (firstGap + q) % n;
                    if (flags[idx]) { cur = null; continue; }
                    if (!cur) { cur = []; runs.push(cur); }
                    cur.push(toPx(dense[idx]));
                }
                runs.forEach(run => { if (run.length > 1) addWall('M' + run.map(fmt).join('L')); });
            }
        });
        return '<svg width="' + g.width + '" height="' + g.height + '" viewBox="0 0 ' + w + ' ' + h + '" style="position:absolute; left:0; top:0; overflow:visible; pointer-events:none;" xmlns="http://www.w3.org/2000/svg">' +
            '<defs>' + brickPattern('msBrick', '#5b4e3d', 'rgba(255,240,210,.38)') + '<filter id="msInk" filterUnits="userSpaceOnUse" x="0" y="0" width="' + w + '" height="' + h + '">' +
            '<feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="2" seed="3" result="n"/>' +
            '<feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G" result="d"/>' +
            '<feDropShadow in="d" dx="1" dy="2" stdDeviation="1.3" flood-color="#1b130a" flood-opacity=".38"/></filter></defs>' +
            '<g filter="url(#msInk)">' +
            (wallD ? '<path d="' + wallD + '" fill="none" stroke="' + INK + '" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>' : '') +
            (inkD ? '<path d="' + inkD + '" fill="none" stroke="' + INK + '" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>' : '') +
            (thickD ? '<path d="' + thickD + '" fill="none" stroke="' + INK + '" stroke-width="11.5" stroke-linecap="round" stroke-linejoin="round"/><path d="' + thickD + '" fill="none" stroke="url(#msBrick)" stroke-width="8" stroke-linecap="butt" stroke-linejoin="round"/>' : '') +
            doors + '</g>' +
            (secretD ? '<path d="' + secretD + '" fill="none" stroke="#9b6bd6" stroke-width="1.6" stroke-dasharray="3 3" stroke-linecap="butt"/>' : '') +
            '</svg>';
    };

    // ---------- Zoom ----------
    // The whole map (grid, drawing layers, tokens) is shown larger or smaller with CSS zoom on its paper; the pointer maths
    // that needs real pixels divides the zoom back out (see mapPointerCellPos in dm.html). Remembered per browser.
    const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3];
    let zoom = 1;
    try { const z = parseFloat(localStorage.getItem('mapZoom')); if (z >= 0.25 && z <= 3) zoom = z; } catch (e) { /* no storage: stays 100% */ }
    MS.zoom = () => zoom;
    MS.applyZoom = function () {
        document.querySelectorAll('.map-paper').forEach(p => { p.style.zoom = zoom === 1 ? '' : String(zoom); });
        document.querySelectorAll('.map-zoom-label').forEach(l => { l.textContent = Math.round(zoom * 100) + '%'; });
        document.dispatchEvent(new Event('mapzoomchange'));
    };
    MS.setZoom = function (z) {
        zoom = Math.max(0.25, Math.min(3, z));
        try { localStorage.setItem('mapZoom', String(zoom)); } catch (e) { /* fine */ }
        MS.applyZoom();
    };
    MS.zoomStep = function (dir) {
        let i = 0;
        ZOOM_STEPS.forEach((s, k) => { if (Math.abs(s - zoom) < Math.abs(ZOOM_STEPS[i] - zoom)) i = k; });
        MS.setZoom(ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + dir))]);
    };
    MS.zoomReset = () => MS.setZoom(1);
    window.addEventListener('DOMContentLoaded', MS.applyZoom);
    window.addEventListener('load', MS.applyZoom);
    // Ctrl + mouse wheel over the map zooms it (instead of the whole page)
    document.addEventListener('wheel', e => {
        if (!e.ctrlKey || !e.target.closest || !e.target.closest('.map-grid-wrap')) return;
        e.preventDefault();
        MS.zoomStep(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });

    // ---------- Compass star ----------
    // An eight-point star with the north point picked out in red; `rot` is the direction north points on the map, in degrees
    // clockwise from straight up.
    MS.compassSvg = function (rot) {
        rot = ((parseFloat(rot) || 0) % 360 + 360) % 360;
        const pts = [];
        for (let i = 0; i < 16; i++) {
            const a = i * Math.PI / 8;
            const r = i % 2 ? 9.5 : (i % 4 === 0 ? 44 : 27);
            pts.push([Math.sin(a) * r, -Math.cos(a) * r]);
        }
        const f = n => n.toFixed(1), star = pts.map(p => f(p[0]) + ',' + f(p[1])).join(' ');
        const tip = pts[0], l = pts[15], r2 = pts[1];
        const lx = 50 * Math.sin(rot * Math.PI / 180), ly = -50 * Math.cos(rot * Math.PI / 180);
        return '<svg viewBox="-62 -62 124 124" xmlns="http://www.w3.org/2000/svg">' +
            '<circle r="36" fill="rgba(239,226,196,.55)" stroke="#2a2118" stroke-width="1" opacity=".8"/>' +
            '<g transform="rotate(' + f(rot) + ')">' +
            '<polygon points="' + star + '" fill="#efe2c4" stroke="#2a2118" stroke-width="2" stroke-linejoin="round"/>' +
            '<path d="M0 0L' + f(pts[2][0]) + ' ' + f(pts[2][1]) + 'M0 0L' + f(pts[6][0]) + ' ' + f(pts[6][1]) + 'M0 0L' + f(pts[10][0]) + ' ' + f(pts[10][1]) + 'M0 0L' + f(pts[14][0]) + ' ' + f(pts[14][1]) + '" stroke="#2a2118" stroke-width=".8" opacity=".6"/>' +
            '<polygon points="' + f(tip[0]) + ',' + f(tip[1]) + ' ' + f(l[0]) + ',' + f(l[1]) + ' 0,0 ' + f(r2[0]) + ',' + f(r2[1]) + '" fill="#8b2d1e" stroke="#2a2118" stroke-width="1.6" stroke-linejoin="round"/>' +
            '<circle r="2.6" fill="#2a2118"/></g>' +
            '<text x="' + f(lx) + '" y="' + f(ly + 5) + '" text-anchor="middle" font-family="Georgia, serif" font-weight="bold" font-size="15" fill="#2a2118" stroke="#efe6d2" stroke-width="3" paint-order="stroke">N</text></svg>';
    };


    // ---------- Light: how strong the warm glow of a torch, campfire or fireplace is at a distance (in squares) ----------
    // Bright light to 4 squares (20 ft), dim light for 4 more (another 20 ft): strongest by the flame, fading as it goes.
    // The glow of the lights and the dark circle of Darkness spells, drawn smoothly (true circles and wedges, not squares), cut off by walls.
    // o: S (pixels a square), ox/oy (the map square drawn at the canvas's first column / row, so the canvas square of map square c, r
    // is c - ox + 1, r - oy + 1), sources [[col, row, bright, dim, dir]], zones [[col, row, radius]], usable(c, r), los(c0, r0, c1, r1),
    // darkCell(c, r) (where a dark circle may be drawn), darkAlpha.
    MS.paintLights = function (cv, o) {
        const S = o.S, SUB = 4, wc = Math.round(cv.width / S), hc = Math.round(cv.height / S), W = wc * SUB, H = hc * SUB;
        const data = new Uint8ClampedArray(W * H * 4), zones = o.zones || [];
        const zs = zones.map(z => [z[0] - o.ox + 1.5, z[1] - o.oy + 1.5, z[2] + 0.5]);
        (o.sources || []).forEach(src => {
            const sc = src[0], sr = src[1], lb = src[2], ld = src[3], dir = src[4], reach = lb + ld;
            const cx = sc - o.ox + 1.5, cy = sr - o.oy + 1.5, span = Math.ceil(reach) + 1;
            for (let dc = -span; dc <= span; dc++) for (let dr = -span; dr <= span; dr++) {
                const c = sc + dc, r = sr + dr, d = Math.hypot(dc, dr);
                if (d > reach + 1.5 || !o.usable(c, r)) continue;
                const xi = c - o.ox + 1, yi = r - o.oy + 1;
                if (xi < 0 || yi < 0 || xi >= wc || yi >= hc) continue;
                if (dir != null && d > 1.5 && Math.abs(((Math.atan2(dc, -dr) * 180 / Math.PI - dir + 540) % 360) - 180) > 30 + Math.asin(Math.min(1, 0.75 / d)) * 180 / Math.PI) continue;
                if ((dc || dr) && !o.los(sc, sr, c, r)) continue;
                for (let j = 0; j < SUB; j++) for (let i = 0; i < SUB; i++) {
                    const ux = xi + (i + 0.5) / SUB, uy = yi + (j + 0.5) / SUB, dx = ux - cx, dy = uy - cy, dist = Math.hypot(dx, dy);
                    const a = MS.lightAlpha(dist, lb, ld);
                    if (a <= 0) continue;
                    if (dir != null && dist > 0.8 && Math.abs(((Math.atan2(dx, -dy) * 180 / Math.PI - dir + 540) % 360) - 180) > 30) continue;
                    if (zs.some(z => Math.hypot(ux - z[0], uy - z[1]) <= z[2])) continue;
                    const k = ((yi * SUB + j) * W + xi * SUB + i) * 4, av = a * 255;
                    if (av > data[k + 3]) { data[k] = 255; data[k + 1] = 168; data[k + 2] = 64; data[k + 3] = av; }
                }
            }
        });
        const ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, cv.width, cv.height);
        const off = document.createElement('canvas');
        off.width = W; off.height = H;
        off.getContext('2d').putImageData(new ImageData(data, W, H), 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(off, 0, 0, W, H, 0, 0, cv.width, cv.height);
        zones.forEach((z, zi) => {
            const R = zs[zi][2] * S, zx = zs[zi][0] * S, zy = zs[zi][1] * S;
            ctx.save();
            if (o.darkCell) {
                ctx.beginPath();
                for (let c = Math.floor(z[0] - z[2] - 1); c <= Math.ceil(z[0] + z[2] + 1); c++) for (let r = Math.floor(z[1] - z[2] - 1); r <= Math.ceil(z[1] + z[2] + 1); r++) {
                    if (o.darkCell(c, r)) ctx.rect((c - o.ox + 1) * S, (r - o.oy + 1) * S, S, S);
                }
                ctx.clip();
            }
            const g = ctx.createRadialGradient(zx, zy, R * 0.8, zx, zy, R);
            g.addColorStop(0, 'rgba(10,8,28,' + o.darkAlpha + ')'); g.addColorStop(1, 'rgba(10,8,28,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(zx, zy, R, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        });
    };
    // Fog of war as one soft shape: squares are drawn, then the SVG filter #mapFogGoo blurs and sharpens them into rounded edges.
    // o: S, cols, rows (the map's squares), color, opacity, fogged(c, r) for the square at column c, row r counted from 0.
    MS.paintFog = function (cv, o) {
        const S = o.S, M = 10, w = o.cols * S + 2 * M, h = o.rows * S + 2 * M;
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
        cv.style.left = (S - M) + 'px'; cv.style.top = (S - M) + 'px'; cv.style.clipPath = 'inset(' + M + 'px)';
        cv.style.filter = 'url(#mapFogGoo)'; cv.style.opacity = o.opacity == null ? 1 : o.opacity;
        const ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = o.color;
        for (let r = 0; r < o.rows; r++) {
            let c = 0;
            while (c < o.cols) {
                if (!o.fogged(c, r)) { c++; continue; }
                let c2 = c;
                while (c2 < o.cols && o.fogged(c2, r)) c2++;
                const x0 = M + c * S - (c === 0 ? M : 0), x1 = M + c2 * S + (c2 === o.cols ? M : 0), y0 = M + r * S - (r === 0 ? M : 0), y1 = M + (r + 1) * S + (r === o.rows - 1 ? M : 0);
                ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
                c = c2;
            }
        }
    };
    // The squares a creature can reach, with the steps it takes to get there ("c,r" -> squares of movement).
    // o: cols, rows, start [c, r] (r is the row of the square's key, 1 at the top), max (squares of movement), diag ('simple': every step
    // is 1 square, or 'alt': the 5-10-5 rule, diagonals cost 1 then 2 then 1...), blocked(c0, r0, c1, r1) for a step, passable(c, r).
    MS.moveRange = function (o) {
        const alt = o.diag === 'alt', out = new Map(), best = new Map(), buckets = [[[o.start[0], o.start[1], 0]]];
        const sk = (c, r, p) => c + ',' + r + ',' + p;
        best.set(sk(o.start[0], o.start[1], 0), 0);
        for (let cost = 0; cost <= o.max; cost++) {
            const list = buckets[cost];
            if (!list) continue;
            for (let i = 0; i < list.length; i++) {
                const c = list[i][0], r = list[i][1], p = list[i][2];
                if (best.get(sk(c, r, p)) !== cost) continue;
                if (!out.has(c + ',' + r)) out.set(c + ',' + r, cost);
                for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
                    if (!dc && !dr) continue;
                    const nc = c + dc, nr = r + dr;
                    if (nc < 0 || nc >= o.cols || nr < 1 || nr > o.rows || !o.passable(nc, nr) || o.blocked(c, r, nc, nr)) continue;
                    const diag = dc && dr, np = alt && diag ? 1 - p : p, nco = cost + (alt && diag && p === 1 ? 2 : 1);
                    if (nco > o.max) continue;
                    const nk = sk(nc, nr, np);
                    if (best.has(nk) && best.get(nk) <= nco) continue;
                    best.set(nk, nco);
                    (buckets[nco] = buckets[nco] || []).push([nc, nr, np]);
                }
            }
        }
        return out;
    };
    // glow at a distance of d squares from a light with the given bright and dim radius (in squares; a torch is 4 and 4)
    MS.lightAlpha = (d, bright, dim) => {
        bright = bright == null ? 4 : bright; dim = dim == null ? 4 : dim;
        return d <= bright ? (bright > 0 ? 0.55 - 0.2 * (d / bright) : 0.55) : d <= bright + dim + 0.2 ? 0.3 * (1 - (d - bright) / (dim + 0.2)) : 0;
    };

    // ---------- Props and rugs: pictures for the free-standing objects (see the Props group of the DM Map tab) ----------
    // An object is { t: 'obj', kind, x, y, w, h, rot, color, round }: x, y, w, h in squares (x, y = top-left, in the same units as
    // freehand walls), rot a quarter-turn count. A rug is stretched to any size; the others keep their picture's shape.
    const circ = (cx, cy, r, fill, extra) => '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + fill + '"' + (extra || '') + '/>';
    const star = (cx, cy, ro, ri, n) => { const p = []; for (let i = 0; i < n * 2; i++) { const a = i * Math.PI / n - Math.PI / 2, r = i % 2 ? ri : ro; p.push((cx + Math.cos(a) * r).toFixed(1) + ',' + (cy + Math.sin(a) * r).toFixed(1)); } return p.join(' '); };
    const OBJ = {
        darkness: { label: 'Darkness', w: 1, h: 1, art: () =>
            '<circle cx="10" cy="10" r="8.6" fill="#1a1633" fill-opacity=".75" stroke="#6b5fa8" stroke-width="1" stroke-dasharray="2 2"/><circle cx="10" cy="10" r="4.6" fill="#0c0a1c"/><path d="M10 4.6a5.4 5.4 0 1 0 0 10.8a4.2 4.2 0 0 1 0-10.8z" fill="#8f86c8" fill-opacity=".8"/>' },
        light: { label: 'Light', w: 1, h: 1, art: () =>
            '<circle cx="10" cy="10" r="8.6" fill="#ffd36b" fill-opacity=".35"/><path d="M10 .8v2.4M10 16.8v2.4M.8 10h2.4M16.8 10h2.4M3.5 3.5l1.7 1.7M14.8 14.8l1.7 1.7M16.5 3.5l-1.7 1.7M5.2 14.8l-1.7 1.7" stroke="#c98a1a" stroke-width="1.1" stroke-linecap="round"/><circle cx="10" cy="10" r="5" fill="#ffcf5a" stroke="#8a5a14" stroke-width="1"/><circle cx="10" cy="10" r="2.1" fill="#fff4c4"/>' },
        trapdoor: { label: 'Trap door', w: 1, h: 1, art: () =>
            '<rect x="1.5" y="1.5" width="17" height="17" rx="1" fill="#4a3220" stroke="#1c120a" stroke-width="1.3"/><rect x="3" y="3" width="14" height="14" fill="#8a6234" stroke="#3a2818" stroke-width=".8"/><path d="M6.5 3v14M10 3v14M13.5 3v14" stroke="#4a3220" stroke-width=".8"/><path d="M3 6.5h14M3 13.5h14" stroke="#3a3a3a" stroke-width="1.8"/><rect x="3" y="5" width="2.4" height="3" rx=".6" fill="#2a2a2a"/><rect x="3" y="12" width="2.4" height="3" rx=".6" fill="#2a2a2a"/><circle cx="14" cy="10" r="2.1" fill="none" stroke="#3a3a3a" stroke-width="1.2"/><circle cx="14" cy="10" r=".7" fill="#3a3a3a"/>' },
        'cellar-hatch': { label: 'Cellar hatch', w: 2, h: 2, art: () =>
            '<rect x="1.5" y="1.5" width="37" height="37" rx="1.5" fill="#4a3220" stroke="#1c120a" stroke-width="1.4"/><rect x="3.5" y="3.5" width="16" height="33" fill="#8a6234" stroke="#3a2818" stroke-width=".9"/><rect x="20.5" y="3.5" width="16" height="33" fill="#8a6234" stroke="#3a2818" stroke-width=".9"/><path d="M8 3.5v33M12 3.5v33M16 3.5v33M24.5 3.5v33M28.5 3.5v33M32.5 3.5v33" stroke="#4a3220" stroke-width=".8"/><path d="M3.5 11h33M3.5 29h33" stroke="#3a3a3a" stroke-width="2.4"/><circle cx="16.5" cy="20" r="2.6" fill="none" stroke="#3a3a3a" stroke-width="1.4"/><circle cx="23.5" cy="20" r="2.6" fill="none" stroke="#3a3a3a" stroke-width="1.4"/>' },
        horse: { label: 'Horse', w: 1, h: 2, art: () =>
            '<g fill="#5a3820"><rect x="3.5" y="12" width="3" height="6" rx="1"/><rect x="13.5" y="12" width="3" height="6" rx="1"/><rect x="3.5" y="23" width="3" height="6" rx="1"/><rect x="13.5" y="23" width="3" height="6" rx="1"/></g>' +
            '<ellipse cx="10" cy="21" rx="6.5" ry="11.5" fill="#8a5a32" stroke="#2a1a0e" stroke-width="1.1"/><ellipse cx="10" cy="6" rx="3.8" ry="5.4" fill="#7a4c28" stroke="#2a1a0e" stroke-width="1.1"/><path d="M10 8.5v15" stroke="#2f1a0c" stroke-width="2.2" stroke-linecap="round"/><path d="M10 32c-2.4 2.6-2.4 5-.8 7" fill="none" stroke="#2f1a0c" stroke-width="1.8"/><circle cx="8" cy="4.6" r=".7" fill="#1a0e06"/><circle cx="12" cy="4.6" r=".7" fill="#1a0e06"/>' },
        'horse-buggy': { label: 'Horse and buggy', w: 2, h: 5, art: () =>
            '<path d="M14 46V28M26 46V28" stroke="#5c4028" stroke-width="2.2"/>' +
            '<g fill="#5a3820"><rect x="10" y="14" width="3" height="7" rx="1"/><rect x="27" y="14" width="3" height="7" rx="1"/><rect x="10" y="26" width="3" height="7" rx="1"/><rect x="27" y="26" width="3" height="7" rx="1"/></g>' +
            '<ellipse cx="20" cy="23" rx="8.5" ry="14" fill="#8a5a32" stroke="#2a1a0e" stroke-width="1.2"/><ellipse cx="20" cy="7" rx="4.6" ry="6.5" fill="#7a4c28" stroke="#2a1a0e" stroke-width="1.2"/><path d="M20 10v18" stroke="#2f1a0c" stroke-width="2.4" stroke-linecap="round"/><path d="M20 38c-3 3-3 6-1 9" fill="none" stroke="#2f1a0c" stroke-width="2"/>' +
            '<g fill="#2a2118"><rect x="1" y="50" width="4" height="13" rx="1.4"/><rect x="35" y="50" width="4" height="13" rx="1.4"/><rect x="1" y="76" width="4" height="13" rx="1.4"/><rect x="35" y="76" width="4" height="13" rx="1.4"/></g>' +
            '<rect x="5" y="46" width="30" height="50" rx="4" fill="#7a5230" stroke="#2a1a0e" stroke-width="1.3"/><rect x="9" y="50" width="22" height="20" rx="3" fill="#9b7448" stroke="#4a3018" stroke-width=".8"/><rect x="9" y="73" width="22" height="19" rx="3" fill="#e8dcc0" stroke="#4a3018" stroke-width=".8"/><path d="M9 79h22M9 85h22" stroke="#b8a888" stroke-width=".8"/>' },
        wagon: { label: 'Covered wagon', w: 3, h: 4, art: () =>
            '<path d="M30 14V2" stroke="#5c4028" stroke-width="2.4"/><g fill="#2a2118"><rect x="2" y="20" width="5" height="16" rx="1.6"/><rect x="53" y="20" width="5" height="16" rx="1.6"/><rect x="2" y="50" width="5" height="16" rx="1.6"/><rect x="53" y="50" width="5" height="16" rx="1.6"/></g>' +
            '<rect x="7" y="12" width="46" height="62" rx="4" fill="#7a5230" stroke="#2a1a0e" stroke-width="1.3"/><rect x="10" y="16" width="40" height="54" rx="9" fill="#ece1c6" stroke="#6a5a3a" stroke-width="1.1"/><path d="M10 26h40M10 36h40M10 46h40M10 56h40M10 66h40" stroke="#b9a984" stroke-width=".9"/>' },
        cart: { label: 'Hand cart', w: 2, h: 3, art: () =>
            '<path d="M12 12V0M28 12V0" stroke="#5c4028" stroke-width="2.4"/><g fill="#2a2118"><rect x="1" y="26" width="4" height="14" rx="1.4"/><rect x="35" y="26" width="4" height="14" rx="1.4"/></g><rect x="5" y="12" width="30" height="42" rx="3" fill="#8a6234" stroke="#2a1a0e" stroke-width="1.3"/><rect x="8" y="15" width="24" height="36" rx="2" fill="#6a4a24"/><path d="M8 27h24M8 39h24" stroke="#4a3018" stroke-width=".8"/>' },
        trough: { label: 'Water trough', w: 1, h: 3, art: () =>
            '<rect x="2" y="2" width="16" height="56" rx="3" fill="#8a6234" stroke="#2a1a0e" stroke-width="1.3"/><rect x="5" y="5" width="10" height="50" rx="2" fill="#4a90d9" stroke="#2b5f9a" stroke-width=".8"/><path d="M7 14q3-2 6 0M7 26q3-2 6 0M7 38q3-2 6 0M7 48q3-2 6 0" fill="none" stroke="#cfe6fa" stroke-width=".9"/>' },
        tree: { label: 'Tree', w: 3, h: 3, art: () =>
            circ(32, 36, 25, 'rgba(0,0,0,.2)') + '<g stroke="#1f3a1c" stroke-width="1.3">' + circ(30, 30, 17, '#3f7a3a') + circ(18, 22, 11.5, '#4a8a44') + circ(43, 21, 11.5, '#4a8a44') + circ(16, 38, 11.5, '#468640') + circ(45, 38, 11.5, '#468640') + circ(30, 47, 11.5, '#468640') + '</g>' +
            circ(27, 26, 10, '#5aa052') + circ(21, 19, 4.2, '#72bb66') + circ(37, 31, 5, '#66ae5a') + circ(30, 30, 2.4, '#2f5a2c') },
        pine: { label: 'Pine tree', w: 2, h: 2, art: () =>
            circ(22, 24, 17, 'rgba(0,0,0,.18)') + '<polygon points="' + star(20, 20, 18.5, 9, 10) + '" fill="#2f6a3a" stroke="#14301c" stroke-width="1.2"/><polygon points="' + star(20, 20, 13, 6.5, 10) + '" fill="#3f8a4a" stroke="#1d4a28" stroke-width=".9"/><polygon points="' + star(20, 20, 7, 3.6, 10) + '" fill="#58a860"/>' + circ(20, 20, 1.6, '#1f4a28') },
        bush: { label: 'Bush', w: 1, h: 1, art: () =>
            '<g stroke="#1f3a1c" stroke-width="1">' + circ(10, 11, 7.5, '#3f7a3a') + circ(6.5, 8, 4.6, '#4a8a44') + circ(14, 7.5, 4.6, '#4a8a44') + circ(6, 13.5, 4.2, '#468640') + circ(14.5, 13.5, 4.2, '#468640') + '</g>' + circ(9, 8.5, 3, '#6fb865') },
        rock: { label: 'Boulder', w: 2, h: 2, art: () =>
            '<polygon points="8,26 11,12 22,6 33,10 36,23 28,34 14,34" fill="#8d8d88" stroke="#2f2f2c" stroke-width="1.3"/><polygon points="11,12 22,6 24,17 14,20" fill="#a8a8a2"/><polygon points="24,17 33,10 36,23 29,25" fill="#7c7c77"/><path d="M14 20l-6 6M24 17l5 8M28 34l1-9" stroke="#55554f" stroke-width=".9" fill="none"/>' },
        haystack: { label: 'Haystack', w: 2, h: 2, art: () =>
            circ(21, 22, 17, 'rgba(0,0,0,.16)') + circ(20, 20, 17, '#d9b84a', ' stroke="#7a5a10" stroke-width="1.3"') + '<path d="M20 4a16 16 0 0 1 16 16M20 8a12 12 0 0 1 12 12M20 12a8 8 0 0 1 8 8M20 16a4 4 0 0 1 4 4" fill="none" stroke="#a8841c" stroke-width="1"/><path d="M6 14l5 3M9 28l6-2M30 30l-5-4M32 12l-6 3" stroke="#f0d878" stroke-width="1.2"/>' },
        well: { label: 'Well', w: 2, h: 2, art: () =>
            circ(20, 20, 17.5, '#8f8b80', ' stroke="#2a2118" stroke-width="1.4"') + circ(20, 20, 12, '#5f5b52') + circ(20, 20, 9, '#4a90d9', ' stroke="#2b5f9a" stroke-width=".8"') + '<path d="M4 20h32" stroke="#5c4028" stroke-width="3"/><path d="M20 4v32" stroke="#5c4028" stroke-width="1.2"/>' + circ(20, 20, 2.2, '#2a2118') },
        fountain: { label: 'Fountain', w: 3, h: 3, art: () =>
            circ(30, 30, 27, '#a39f94', ' stroke="#2a2118" stroke-width="1.5"') + circ(30, 30, 22, '#4a90d9', ' stroke="#2b5f9a" stroke-width="1"') + '<circle cx="30" cy="30" r="15" fill="none" stroke="#cfe6fa" stroke-width=".9"/><circle cx="30" cy="30" r="9" fill="none" stroke="#cfe6fa" stroke-width=".9"/>' + circ(30, 30, 6, '#b9b5a8', ' stroke="#2a2118" stroke-width="1.2"') + circ(30, 30, 2.4, '#e8f3ff') },
        stall: { label: 'Market stall', w: 2, h: 3, art: () => {
            let st = ''; for (let i = 0; i < 8; i++) st += '<rect x="' + (2 + i * 4.5) + '" y="2" width="4.5" height="56" fill="' + (i % 2 ? '#efe6d2' : '#b8403a') + '"/>';
            return '<rect x="2" y="2" width="36" height="56" fill="#efe6d2"/>' + st + '<rect x="2" y="2" width="36" height="56" fill="none" stroke="#2a2118" stroke-width="1.3"/><rect x="4" y="46" width="32" height="10" rx="1" fill="#8a6a45" stroke="#3a2818" stroke-width="1"/><circle cx="12" cy="51" r="2.4" fill="#d9a23a"/><circle cx="20" cy="51" r="2.4" fill="#c0392b"/><circle cx="28" cy="51" r="2.4" fill="#5aa052"/>';
        } },
        fence: { label: 'Fence', w: 1, h: 4, stretch: true, art: (w, h) => {
            let p = '<path d="M' + (w * 10) + ' 1V' + (h * 20 - 1) + '" stroke="#6b4423" stroke-width="2.6"/>';
            for (let y = 2; y <= h * 20 - 2; y += 20) p += circ(w * 10, y, 3, '#8a6234', ' stroke="#3a2818" stroke-width="1"');
            return p;
        } }
    };
    MS.objectKinds = () => Object.keys(OBJ).map(k => ({ id: k, label: OBJ[k].label, w: OBJ[k].w, h: OBJ[k].h }));
    // what a placed object is called, e.g. "Hand cart", "Rug", "End table"
    MS.objectName = kind => {
        if (OBJ[kind]) return OBJ[kind].label;
        const s = String(kind || '').replace(/^furn:/, '').replace(/-/g, ' ');
        return s.charAt(0).toUpperCase() + s.slice(1);
    };
    MS.RUG_COLORS = {
        red: { base: '#8a2f2f', mid: '#a83c34', trim: '#e8c070' }, blue: { base: '#2f4a7e', mid: '#3d5f9c', trim: '#e8d9a0' }, green: { base: '#2f6a43', mid: '#3d8556', trim: '#e8d9a0' },
        brown: { base: '#6b4a2c', mid: '#8a6238', trim: '#e0c58a' }, purple: { base: '#5a3a7a', mid: '#74509a', trim: '#e8d0a0' }
    };
    // a small picture of a kind for the toolbox
    MS.objectIcon = function (kind) {
        if (kind === 'rug') return '<svg viewBox="0 0 24 24" width="22" height="22" style="vertical-align:middle; margin-right:8px; flex:none;" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="1" fill="#8a2f2f" stroke="#2a2118" stroke-width="1"/><rect x="5.5" y="8.5" width="13" height="7" fill="#a83c34" stroke="#e8c070" stroke-width=".8"/></svg>';
        const k = OBJ[kind]; if (!k) return '';
        return '<svg viewBox="0 0 ' + k.w * 20 + ' ' + k.h * 20 + '" width="22" height="22" style="vertical-align:middle; margin-right:8px; flex:none;" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' + k.art(k.w, k.h) + '</svg>';
    };
    // the inside of an object's box (the page positions and sizes the box itself): a rug is stretched, a prop keeps its shape and may be turned
    MS.furnitureHasArt = piece => !!FURN_ART[piece];
    // an object may also be turned to any angle (o.ang, degrees clockwise) about its middle, on top of its quarter turns
    MS.objectHtml = function (o, step) {
        const inner = objectHtmlBase(o, step);
        return o.ang && inner ? '<div style="position:absolute; inset:0; transform:rotate(' + o.ang + 'deg);">' + inner + '</div>' : inner;
    };
    // ---------- Pictures the DM uploaded (kept with the map, see dm.html "Your pictures") ----------
    let IMGS = {};
    MS.setImages = list => { IMGS = {}; (list || []).forEach(e => { if (e && e.id) IMGS[e.id] = e; }); };
    MS.imgInfo = id => IMGS[id] || null;
    const imgDefault = id => { // 2 squares along its longer side, in half squares
        const e = IMGS[id];
        if (!e) return { w: 2, h: 2 };
        const r = (e.w || 1) / (e.h || 1);
        return r >= 1 ? { w: 2, h: Math.max(0.5, Math.round(2 / r * 2) / 2) } : { w: Math.max(0.5, Math.round(2 * r * 2) / 2), h: 2 };
    };
    const objectHtmlBase = function (o, step) {
        if (o.kind.indexOf('img:') === 0) {
            const e = IMGS[o.kind.slice(4)], rot = ((o.rot || 0) % 4 + 4) % 4, odd = rot % 2 === 1, iw = odd ? o.h : o.w, ih = odd ? o.w : o.h;
            if (!e) return '<div style="position:absolute; inset:0; border:1px dashed #a33; display:flex; align-items:center; justify-content:center; font:10px sans-serif; color:#a33; text-align:center;">picture missing</div>';
            return '<img src="' + e.src + '" alt="" style="position:absolute; left:50%; top:50%; width:' + (iw * step) + 'px; height:' + (ih * step) + 'px; transform:translate(-50%,-50%) rotate(' + rot * 90 + 'deg); object-fit:contain; filter:drop-shadow(1px 2px 1.5px rgba(27,19,10,.4)); pointer-events:none;">';
        }
        // a piece of furniture placed free of the squares: the same picture, turned a quarter at a time
        if (o.kind.indexOf('furn:') === 0) {
            const art = FURN_ART[o.kind.slice(5)];
            if (!art) return '';
            const rot = ((o.rot || 0) % 4 + 4) % 4, odd = rot % 2 === 1, iw = odd ? o.h : o.w, ih = odd ? o.w : o.h;
            return '<div style="position:absolute; left:50%; top:50%; width:' + (iw * step) + 'px; height:' + (ih * step) + 'px; transform:translate(-50%,-50%) rotate(' + rot * 90 + 'deg);">' +
                '<svg viewBox="0 0 24 24" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="overflow:visible; filter:drop-shadow(1px 2px 1.5px rgba(27,19,10,.4));" xmlns="http://www.w3.org/2000/svg">' + art + '</svg></div>';
        }
        // a freehand rug: its outline (points 0..1 across its box) filled with the rug stripes
        if (o.kind === 'rug' && o.pts) {
            const c = MS.RUG_COLORS[o.color] || MS.RUG_COLORS.red, W = Math.max(1, o.w * step), H = Math.max(1, o.h * step), id = 'rg' + String(o.z || 0) + Math.round(o.x * 10) + Math.round(o.y * 10);
            const pts = o.pts.map(p => (p[0] * W).toFixed(1) + ',' + (p[1] * H).toFixed(1)).join(' ');
            const inner = o.pts.map(p => ((0.5 + (p[0] - 0.5) * 0.86) * W).toFixed(1) + ',' + ((0.5 + (p[1] - 0.5) * 0.86) * H).toFixed(1)).join(' ');
            return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="position:absolute; left:0; top:0; overflow:visible; filter:drop-shadow(1px 2px 1.5px rgba(27,19,10,.35));" xmlns="http://www.w3.org/2000/svg">' +
                '<defs><pattern id="' + id + '" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="' + c.base + '"/><rect width="5" height="10" fill="' + c.mid + '"/></pattern></defs>' +
                '<polygon points="' + pts + '" fill="url(#' + id + ')" stroke="#2a2118" stroke-width="5.5" stroke-linejoin="round"/><polygon points="' + pts + '" fill="none" stroke="' + c.trim + '" stroke-width="3" stroke-linejoin="round"/>' +
                '<polygon points="' + inner + '" fill="none" stroke="' + c.trim + '" stroke-width="1.4" stroke-linejoin="round" opacity=".9"/></svg>';
        }
        if (o.kind === 'rug' && MS.exporting) { // the same rug as vector shapes: the picture library cannot draw the striped CSS fill
            const c = MS.RUG_COLORS[o.color] || MS.RUG_COLORS.red, W = Math.max(1, o.w * step), H = Math.max(1, o.h * step), id = 'rx' + String(o.z || 0) + Math.round(o.x * 10) + Math.round(o.y * 10);
            const shape = (pad, extra) => o.round
                ? '<ellipse cx="' + (W / 2) + '" cy="' + (H / 2) + '" rx="' + Math.max(1, W / 2 - pad) + '" ry="' + Math.max(1, H / 2 - pad) + '"' + extra + '/>'
                : '<rect x="' + pad + '" y="' + pad + '" width="' + Math.max(1, W - 2 * pad) + '" height="' + Math.max(1, H - 2 * pad) + '" rx="3"' + extra + '/>';
            return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="position:absolute; left:0; top:0; overflow:visible;" xmlns="http://www.w3.org/2000/svg">' +
                '<defs><pattern id="' + id + '" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="' + c.base + '"/><rect width="5" height="10" fill="' + c.mid + '"/></pattern></defs>' +
                shape(2, ' fill="url(#' + id + ')" stroke="#2a2118" stroke-width="5"') + shape(2, ' fill="none" stroke="' + c.trim + '" stroke-width="3"') + shape(7, ' fill="none" stroke="' + c.trim + '" stroke-width="1.2" opacity=".9"') + '</svg>';
        }
        if (o.kind === 'rug') {
            const c = MS.RUG_COLORS[o.color] || MS.RUG_COLORS.red;
            return '<div style="position:absolute; inset:0; box-sizing:border-box; border-radius:' + (o.round ? '50%' : '3px') + '; background:repeating-linear-gradient(45deg, ' + c.mid + ' 0, ' + c.mid + ' 5px, ' + c.base + ' 5px, ' + c.base + ' 10px); ' +
                'border:3px solid ' + c.trim + '; outline:2px solid #2a2118; outline-offset:-1px; box-shadow:inset 0 0 0 5px ' + c.base + ', inset 0 0 0 7px ' + c.trim + ', 1px 2px 3px rgba(27,19,10,.35);"></div>';
        }
        const k = OBJ[o.kind]; if (!k) return '';
        const rot = ((o.rot || 0) % 4 + 4) % 4, odd = rot % 2 === 1, iw = odd ? o.h : o.w, ih = odd ? o.w : o.h;
        const vbw = k.stretch ? iw : k.w, vbh = k.stretch ? ih : k.h;
        return '<div style="position:absolute; left:50%; top:50%; width:' + (iw * step) + 'px; height:' + (ih * step) + 'px; transform:translate(-50%,-50%) rotate(' + rot * 90 + 'deg); filter:drop-shadow(1px 2px 1.5px rgba(27,19,10,.4));">' +
            '<svg viewBox="0 0 ' + vbw * 20 + ' ' + vbh * 20 + '" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' + k.art(iw, ih) + '</svg></div>';
    };
    // ---------- Labels and pins: text and numbered markers the DM puts on the map ----------
    // { t: 'obj', kind: 'label', text, fs, x, y, w, h, dm } — fs is the letter height in squares; w, h fit the text.
    // { t: 'obj', kind: 'pin', n, title, note, x, y, w: 1, h: 1, dm } — a numbered marker; the note is for the DM.
    // dm: true keeps it off the players' map.
    MS.labelSize = function (o) { // the box a label's text needs, in squares
        const fs = o.fs || 0.8, text = String(o.text || ''), lines = text.split('\n');
        return { w: Math.max(0.6, Math.max.apply(null, lines.map(l => l.length)) * fs * 0.56 + 0.3), h: Math.max(0.6, lines.length * fs * 1.25 + 0.1) };
    };
    MS.noteHtml = function (o, step) {
        if (o.kind === 'pin') {
            const d = Math.min(o.w, o.h) * step * 0.86;
            return '<div title="' + String(o.title || '').replace(/"/g, '&quot;') + '" style="position:absolute; left:50%; top:50%; width:' + d + 'px; height:' + d + 'px; margin:' + (-d / 2) + 'px 0 0 ' + (-d / 2) + 'px; border-radius:50%; box-sizing:border-box; ' +
                'background:radial-gradient(circle at 35% 30%, #c9553f, #8b2d1e 70%); border:2px solid #efe6d2; outline:1.5px solid #2a2118; color:#fff; font:700 ' + Math.max(8, d * 0.52) + 'px Georgia, serif; display:flex; align-items:center; justify-content:center; box-shadow:1px 2px 3px rgba(27,19,10,.5);">' + (o.n || '') + '</div>';
        }
        const fs = (o.fs || 0.8) * step;
        return '<div style="position:absolute; left:0; top:0; white-space:pre; font:italic 600 ' + fs + 'px/1.25 Georgia, \'Times New Roman\', serif; color:#2a2118; ' +
            'text-shadow:0 0 3px #efe6d2, 0 0 3px #efe6d2, 0 0 5px #efe6d2, 1px 1px 0 #efe6d2, -1px -1px 0 #efe6d2;">' + String(o.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</div>';
    };
    MS.objectDefault = kind => (kind === 'rug' ? { w: 4, h: 3 } : kind === 'label' ? { w: 3, h: 1 } : kind === 'pin' ? { w: 1, h: 1 } : (kind.indexOf('furn:') === 0 && FURN_ART[kind.slice(5)] ? { w: 1, h: 1 } : (OBJ[kind] ? { w: OBJ[kind].w, h: OBJ[kind].h } : null)));

    const _objectDefault = MS.objectDefault;
    MS.objectDefault = kind => (kind.indexOf('img:') === 0 ? imgDefault(kind.slice(4)) : _objectDefault(kind));
    const _objectName = MS.objectName;
    MS.objectName = kind => { if (kind.indexOf('img:') === 0) { const e = IMGS[kind.slice(4)]; return e ? e.name : 'Picture'; } return _objectName(kind); };
    // ---------- What a token carries: a picture, health and conditions ({ t: 'tokx', tok: token id, img, hp, max, cond: [], share } in the map's list) ----------
    MS.CONDITIONS = [['blinded', 'Bl', '#6b7280'], ['charmed', 'Ch', '#d946a8'], ['deafened', 'De', '#8b7355'], ['frightened', 'Fr', '#7c3aed'], ['grappled', 'Gr', '#b45309'], ['incapacitated', 'In', '#475569'], ['invisible', 'Iv', '#0ea5e9'],
        ['paralyzed', 'Pa', '#ca8a04'], ['petrified', 'Pe', '#78716c'], ['poisoned', 'Po', '#16a34a'], ['prone', 'Pr', '#92400e'], ['restrained', 'Re', '#dc2626'], ['stunned', 'St', '#f59e0b'], ['unconscious', 'Un', '#1e293b'], ['concentrating', 'Co', '#2563eb']];
    // its picture, drawn over the coloured disc
    MS.tokenImgHtml = x => (x && x.img ? '<span style="position:absolute; inset:2px; border-radius:50%; background:url(\'' + x.img + '\') center/cover no-repeat;"></span>' : '');
    // the health bar and the condition chips (only when show is true)
    MS.tokenBarsHtml = (x, show) => {
        if (!x || !show) return '';
        let out = '';
        if (x.max > 0 && x.hp != null) {
            const p = Math.max(0, Math.min(1, x.hp / x.max)), col = p > 0.5 ? '#4caf50' : p > 0.25 ? '#e6a817' : '#d9534f';
            out += '<div title="' + x.hp + ' of ' + x.max + ' health" style="position:absolute; left:1px; right:1px; bottom:-5px; height:4px; background:#222; border-radius:2px; overflow:hidden; box-shadow:0 0 0 1px rgba(255,255,255,.6);"><div style="width:' + (p * 100) + '%; height:100%; background:' + col + ';"></div></div>';
        }
        const conds = (x.cond || []).map(c => MS.CONDITIONS.find(q => q[0] === c)).filter(Boolean);
        if (x.max > 0 && x.hp === 0) conds.unshift(['down', 'Dn', '#111111']);
        if (conds.length) {
            out += '<div style="position:absolute; left:50%; top:-8px; transform:translateX(-50%); display:flex; gap:1px; pointer-events:auto;">' + conds.slice(0, 3).map(c => '<span title="' + c[0].charAt(0).toUpperCase() + c[0].slice(1) + '" style="width:9px; height:9px; border-radius:50%; background:' + c[2] + '; color:#fff; font:700 5.5px/9px sans-serif; text-align:center; box-shadow:0 0 0 1px rgba(255,255,255,.7);">' + c[1] + '</span>').join('') +
                (conds.length > 3 ? '<span title="' + (conds.length - 3) + ' more" style="font:700 7px/9px sans-serif; color:#fff; background:#333; border-radius:4px; padding:0 2px;">+' + (conds.length - 3) + '</span>' : '') + '</div>';
        }
        return out;
    };
    // A little button the map toolbars can drop in to flip between styles.
    MS.toggleButtonHtml = function (extraOnclick) {
        return '<button type="button" class="map-style-toggle" title="Switch between the parchment map look and the classic grid" onclick="MapStyle.setOn(!MapStyle.isOn()); this.textContent = MapStyle.isOn() ? \'Style: Parchment\' : \'Style: Classic\';' + (extraOnclick || '') + '">' +
            (MS.isOn() ? 'Style: Parchment' : 'Style: Classic') + '</button>';
    };
})();
