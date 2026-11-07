// map-weather.js: weather drifting over the battle map (2026-10-31).
//
// Loaded by both dm.html (the DM's map builder) and index.html (the player's map view), like map-style.js and map-marks.js, so the
// party sees the same weather the DM chose. It only DRAWS: which weather a map has is stored by the pages themselves as one
// { t: 'weather', v: kind } entry beside the time-of-day entry in the map's own ink data, so it syncs the way time of day already does and
// needs no database change. Nothing here touches walls, fog, vision or any tool.
//
// Usage: MapWeather.set(canvasElement, kind). The canvas must sit inside the element that is the size of the map (position: absolute,
// top 0, left 0, pointer-events: none). It stretches to that element, keeps its own resolution modest so a huge map stays cheap to
// draw, runs at about 30 frames a second, pauses while the map is not on screen, and with "reduce motion" turned on in the
// system it draws one still frame instead of animating.
(function () {
    'use strict';
    const MW = (window.MapWeather = {});

    // [value, label]. '' means no weather.
    MW.KINDS = [['', 'Weather: none'], ['light_rain', 'Light rain'], ['rain', 'Rain'], ['thunderstorm', 'Thunderstorm'], ['snow', 'Snow'], ['blizzard', 'Blizzard'], ['hail', 'Hail'], ['fog', 'Fog'], ['wind', 'Wind and leaves'], ['embers', 'Drifting embers']];
    const VALID = {}; MW.KINDS.forEach(k => { VALID[k[0]] = true; });
    MW.label = v => (MW.KINDS.find(k => k[0] === v) || ['', 'none'])[1];
    // the Calendar's weather conditions (dm.html's WEATHER_CONDITIONS) mapped onto what can be drawn; overcast skies draw nothing
    const CAL = { clear: '', partly_cloudy: '', cloudy: '', overcast: '', fog: 'fog', light_rain: 'light_rain', rain: 'rain', thunderstorm: 'thunderstorm', snow: 'snow', blizzard: 'blizzard', windy: 'wind', hail: 'hail' };
    MW.fromCalendar = c => (CAL[c] === undefined ? '' : CAL[c]);

    const MAX_SIDE = 1800;          // longest side of the drawing, in pixels; a bigger map is drawn smaller and stretched
    const rnd = (a, b) => a + Math.random() * (b - a);
    const states = new WeakMap();

    function density(kind, area) {   // how many pieces for a map of this many pixels
        const per = { light_rain: 3.5, rain: 9, thunderstorm: 15, snow: 6, blizzard: 16, hail: 5, wind: 0.9, embers: 1.8 }[kind] || 0;
        return Math.max(12, Math.min(1500, Math.round(area / 10000 * per)));
    }
    function newPart(kind, W, H, anywhere) {
        const p = { x: rnd(0, W), y: anywhere ? rnd(0, H) : rnd(-60, 0), ph: rnd(0, 6.28) };
        if (kind === 'light_rain' || kind === 'rain' || kind === 'thunderstorm') {
            const heavy = kind === 'thunderstorm' ? 1.3 : kind === 'rain' ? 1 : 0.7;
            p.len = rnd(9, 20) * (0.7 + heavy * 0.3); p.vy = rnd(850, 1150) * heavy; p.vx = -p.vy * 0.22; p.a = rnd(0.22, 0.5);
        } else if (kind === 'hail') { p.len = rnd(4, 8); p.vy = rnd(1100, 1500); p.vx = -p.vy * 0.08; p.a = rnd(0.5, 0.85); }
        else if (kind === 'snow') { p.r = rnd(1.2, 3.2); p.vy = rnd(35, 90); p.vx = rnd(-12, 12); p.a = rnd(0.55, 0.95); }
        else if (kind === 'blizzard') { p.r = rnd(1, 2.6); p.vy = rnd(80, 190); p.vx = rnd(-420, -230); p.a = rnd(0.45, 0.9); }
        else if (kind === 'wind') { p.r = rnd(2.5, 5.5); p.vx = rnd(240, 520); p.vy = rnd(-20, 60); p.rot = rnd(0, 6.28); p.vr = rnd(-5, 5); p.hue = Math.random() < 0.5 ? 'rgba(122,92,48,' : 'rgba(96,120,58,'; p.a = rnd(0.55, 0.9); p.x = anywhere ? rnd(0, W) : rnd(-60, 0); p.y = rnd(0, H); }
        else if (kind === 'embers') { p.r = rnd(1, 2.6); p.vy = -rnd(25, 75); p.vx = rnd(-10, 14); p.a = rnd(0.5, 1); p.y = anywhere ? rnd(0, H) : H + rnd(0, 40); }
        return p;
    }
    function seed(st) {
        const W = st.w, H = st.h, kind = st.kind;
        st.parts = [];
        if (kind === 'fog') {
            const n = 9 + Math.round(Math.min(W, H) / 220);
            for (let i = 0; i < n; i++) st.parts.push({ x: rnd(0, W), y: rnd(0, H), r: rnd(0.16, 0.36) * Math.min(W, H) + 60, vx: rnd(6, 20) * (Math.random() < 0.3 ? -1 : 1), a: rnd(0.14, 0.26) });
            return;
        }
        const n = density(kind, W * H);
        for (let i = 0; i < n; i++) st.parts.push(newPart(kind, W, H, true));
        st.nextFlash = rnd(2, 6); st.flash = 0; st.clock = 0;
    }
    function fit(canvas, st) {
        const par = canvas.parentElement; if (!par) return false;
        const w = par.clientWidth, h = par.clientHeight;
        if (!w || !h) return false;
        const s = Math.min(1, MAX_SIDE / Math.max(w, h)), iw = Math.max(1, Math.round(w * s)), ih = Math.max(1, Math.round(h * s));
        canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
        if (canvas.width !== iw || canvas.height !== ih || st.w !== iw || st.h !== ih) { canvas.width = iw; canvas.height = ih; st.w = iw; st.h = ih; seed(st); }
        return true;
    }

    function draw(ctx, st, dt) {
        const W = st.w, H = st.h, kind = st.kind, parts = st.parts;
        ctx.clearRect(0, 0, W, H);
        if (kind === 'fog') {
            ctx.fillStyle = 'rgba(222,228,234,0.10)'; ctx.fillRect(0, 0, W, H);
            parts.forEach(p => {
                p.x += p.vx * dt; if (p.x - p.r > W) p.x = -p.r; else if (p.x + p.r < 0) p.x = W + p.r;
                const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
                g.addColorStop(0, 'rgba(226,231,236,' + p.a + ')'); g.addColorStop(1, 'rgba(226,231,236,0)');
                ctx.fillStyle = g; ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
            });
            return;
        }
        st.clock += dt;
        if (kind === 'thunderstorm') { ctx.fillStyle = 'rgba(24,30,52,0.22)'; ctx.fillRect(0, 0, W, H); } else if (kind === 'rain') { ctx.fillStyle = 'rgba(30,40,62,0.10)'; ctx.fillRect(0, 0, W, H); }
        else if (kind === 'blizzard') { ctx.fillStyle = 'rgba(236,242,250,0.16)'; ctx.fillRect(0, 0, W, H); }
        if (kind === 'light_rain' || kind === 'rain' || kind === 'thunderstorm') {
            ctx.lineWidth = 1.4; ctx.lineCap = 'round';
            // two passes (faint and strong streaks) so the paint colour changes only twice a frame, not once per drop
            [[0, 0.34], [0.34, 1]].forEach(([lo, hi], pass) => {
                ctx.strokeStyle = pass ? 'rgba(205,220,245,0.62)' : 'rgba(185,203,232,0.36)'; ctx.beginPath();
                parts.forEach(p => {
                    const q = (p.a - 0.22) / 0.28; if (q < lo || q >= hi + (hi === 1 ? 1 : 0)) return;
                    const mx = p.vx / p.vy; ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + mx * p.len, p.y + p.len);
                });
                ctx.stroke();
            });
            parts.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > H + 20 || p.x < -40) Object.assign(p, newPart(kind, W, H, false), { x: rnd(0, W + 0.22 * H), y: rnd(-60, -5) }); });
            if (kind === 'thunderstorm') {
                st.nextFlash -= dt;
                if (st.nextFlash <= 0) { st.flash = 1; st.nextFlash = Math.random() < 0.3 ? rnd(0.12, 0.3) : rnd(4, 11); }
                if (st.flash > 0.02) { ctx.fillStyle = 'rgba(236,241,255,' + (st.flash * 0.42) + ')'; ctx.fillRect(0, 0, W, H); st.flash *= Math.exp(-dt * 8); }
            }
        } else if (kind === 'hail') {
            ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(236,244,255,0.75)'; ctx.beginPath();
            parts.forEach(p => { ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + (p.vx / p.vy) * p.len, p.y + p.len); });
            ctx.stroke();
            parts.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > H + 10 || p.x < -20) Object.assign(p, newPart(kind, W, H, false), { x: rnd(0, W + 0.08 * H) }); });
        } else if (kind === 'snow' || kind === 'blizzard') {
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            parts.forEach(p => {
                ctx.globalAlpha = p.a; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill();
                p.x += (p.vx + (kind === 'snow' ? Math.sin(st.clock * 1.3 + p.ph) * 18 : Math.sin(st.clock * 3 + p.ph) * 40)) * dt; p.y += p.vy * dt;
                if (p.y > H + 6) { p.y = rnd(-20, -2); p.x = rnd(0, W); }
                if (p.x < -10) p.x = W + 6; else if (p.x > W + 10) p.x = -6;
            });
            ctx.globalAlpha = 1;
        } else if (kind === 'wind') {
            parts.forEach(p => {
                ctx.save(); ctx.translate(p.x, p.y + Math.sin(st.clock * 2.2 + p.ph) * 14); ctx.rotate(p.rot); ctx.fillStyle = p.hue + p.a + ')';
                ctx.beginPath(); ctx.ellipse(0, 0, p.r * 1.7, p.r * 0.8, 0, 0, 6.2832); ctx.fill(); ctx.restore();
                p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
                if (p.x > W + 20) { p.x = rnd(-60, -8); p.y = rnd(0, H); }
            });
            ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1; ctx.beginPath();
            for (let i = 0; i < 6; i++) { const y = (i * 0.17 + 0.07) * H, x = ((st.clock * 400 + i * 380) % (W + 400)) - 200; ctx.moveTo(x, y); ctx.lineTo(x + 140, y + Math.sin(i) * 6); }
            ctx.stroke();
        } else if (kind === 'embers') {
            parts.forEach(p => {
                const flick = 0.6 + 0.4 * Math.sin(st.clock * 7 + p.ph);
                ctx.fillStyle = 'rgba(255,120,30,' + (p.a * 0.22 * flick) + ')'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 2.6, 0, 6.2832); ctx.fill();
                ctx.fillStyle = 'rgba(255,' + Math.round(150 + 80 * flick) + ',60,' + (p.a * flick) + ')'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill();
                p.x += (p.vx + Math.sin(st.clock * 1.5 + p.ph) * 14) * dt; p.y += p.vy * dt;
                if (p.y < -10) { p.y = H + rnd(2, 30); p.x = rnd(0, W); }
            });
        }
    }

    function frame(canvas, st, now) {
        st.raf = requestAnimationFrame(t => frame(canvas, st, t));
        if (!canvas.isConnected) { stop(st); return; }
        if (st.last && now - st.last < 30) return;
        const dt = Math.min(0.06, st.last ? (now - st.last) / 1000 : 0.016); st.last = now;
        if (canvas.offsetParent === null) return;                 // the map is hidden: nothing to draw
        if (!st.w || (canvas.parentElement && (canvas.style.width !== canvas.parentElement.clientWidth + 'px'))) { if (!fit(canvas, st)) return; }
        draw(canvas.getContext('2d'), st, dt);
    }
    function stop(st) { if (st.raf) cancelAnimationFrame(st.raf); st.raf = 0; st.last = 0; }

    MW.set = function (canvas, kind) {
        if (!canvas) return;
        kind = VALID[kind] ? kind : '';
        let st = states.get(canvas);
        if (!st) { st = { kind: '', parts: [], raf: 0, last: 0, w: 0, h: 0, flash: 0, nextFlash: 3, clock: 0 }; states.set(canvas, st); }
        if (st.kind === kind) return;
        stop(st); st.kind = kind;
        if (!kind) { canvas.style.display = 'none'; return; }
        canvas.style.display = '';
        st.w = 0;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            // one still frame, no animation
            if (fit(canvas, st)) draw(canvas.getContext('2d'), st, 0.016);
            return;
        }
        st.raf = requestAnimationFrame(t => frame(canvas, st, t));
    };
})();
