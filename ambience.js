// Ambience soundboard for the DM page (dm.html): looping weather, nature and place sounds, a few pieces of music, battle sounds and
// one-shots, made live in the browser from shaped noise and tones. It is the ambience demo (planning/ambience-demo.html) without its sound
// builder and song maker. The one exception to "made live" is the tavern, a real recording (sounds/tavern-crowd.mp3, credit in
// sounds/CREDITS.txt, Pixabay Content License) with a made-up crowd as the fallback if the file cannot be loaded.
// Every sound has Volume, Tempo and Pitch, and a More section (Tone, Distance, Pan, its own Amount slider, Regularity). Mixes,
// Morph, Drift, a fade-out timer, Hush and the one-shots sit above them. Settings and saved mixes are remembered in this browser.
// Browsers only allow sound after a click, so nothing starts until the DM presses Play.
//
//   Ambience.mount(containerElement)   builds the panel contents (once)
//   Ambience.onPlaying(fn)             fn(true|false) whenever any sound starts or the last one stops
//   Ambience.stopAll()
(function (root) {
    'use strict';
    // saved settings: { master, fade, boxes: { mixes, oneshots } (which boxes are open), sounds: { id: { level, speed, pitch, tone, dist, pan, amount, reg, crowd, len } } }
    const settings = { master: 0.7, fade: 2.5, sounds: {} };
    try {
        const j = JSON.parse(localStorage.getItem('ambience_settings') || 'null');
        if (j && typeof j === 'object') {
            if (typeof j.master === 'number') settings.master = j.master;
            if (typeof j.fade === 'number') settings.fade = Math.max(0.3, Math.min(20, j.fade));
            if (j.sounds && typeof j.sounds === 'object') settings.sounds = j.sounds;
            if (j.boxes && typeof j.boxes === 'object') settings.boxes = j.boxes;
        }
    } catch (e) { /* no storage: defaults */ }
    const save = () => { try { localStorage.setItem('ambience_settings', JSON.stringify(settings)); } catch (e) { /* fine */ } };

    // the panel the sounds are shown in, and a lookup for the parts of it the code below talks to
    let panel = null, onPlayingCb = null;
    const $q = id => panel.querySelector('[data-id="' + id + '"]');
    const notify = () => { if (onPlayingCb) onPlayingCb(Object.keys(state).some(id => state[id].on)); };
    const storeSound = s => { const o = {}; KEYS.forEach(k => { o[k] = Math.round(s[k] * 1000) / 1000; }); settings.sounds[s.def.id] = o; save(); };

    let ctx = null, master = null, hush = null, bufs = {}, impulses = {};
    const S = { master: settings.master, fade: settings.fade, hushed: false };

    function ensure() {
        if (!ctx) {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            master = ctx.createGain(); master.gain.value = S.master * S.master;
            hush = ctx.createGain(); hush.gain.value = S.hushed ? 0.15 : 1;
            const comp = ctx.createDynamicsCompressor();
            master.connect(hush); hush.connect(comp); comp.connect(ctx.destination);
            const n = ctx.sampleRate * 6;
            ['white', 'pink', 'brown'].forEach(type => {
                const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
                let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
                for (let i = 0; i < n; i++) {
                    const w = Math.random() * 2 - 1;
                    if (type === 'white') d[i] = w;
                    else if (type === 'pink') {
                        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
                        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
                        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
                    } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
                }
                bufs[type] = b;
            });
            {
                const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
                let i = 0;
                while (i < n) {
                    i += Math.floor(-Math.log(1 - Math.random()) * ctx.sampleRate / 30);
                    const amp = Math.pow(Math.random(), 2) * 0.9 + 0.1, len = 12 + Math.floor(Math.random() * 70);
                    for (let k = 0; k < len && i + k < n; k++) d[i + k] = (Math.random() * 2 - 1) * amp * (1 - k / len);
                }
                bufs.dust = b;
            }
        }
        if (ctx.state === 'suspended') ctx.resume();
    }
    const gain = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    // an amount from 0 to 1 becomes a multiplier: 1 at the middle (0.5), 1/k at 0 and k at 1
    const geo = (a, k) => Math.pow(k, 2 * a - 1);
    // the wait until the next event of a Poisson process that has one event per avg on average
    const poissonInterval = avg => -Math.log(1 - Math.random()) * avg;
    // Pitch: every tone and every filter a sound makes is shifted by the sound's Pitch slider (in semitones) through its detune
    // control. Slow modulation oscillators are left alone. Nodes made while a sound is being built are remembered so the slider can
    // move them live; short-lived ones just start at the current pitch.
    let activeRig = null;
    const pitchCents = () => (activeRig ? activeRig.P.pitch() * 100 : 0);
    function mkOsc() { const o = ctx.createOscillator(); o.detune.value = pitchCents(); if (activeRig && activeRig.building) activeRig.live.add(o); return o; }
    const filt = (type, f, q) => { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; if (q != null) x.Q.value = q; x.detune.value = pitchCents(); if (activeRig && activeRig.building) activeRig.live.add(x); return x; };
    const rawFilt = (type, f, q) => { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; if (q != null) x.Q.value = q; return x; };
    const pan = v => { if (!ctx.createStereoPanner) return null; const p = ctx.createStereoPanner(); p.pan.value = v; return p; };
    function loopSrc(type) { const s = ctx.createBufferSource(); s.buffer = bufs[type]; s.loop = true; s.start(0, Math.random() * 5); return s; }
    function burstSrc(type, when, dur, offset) { const s = ctx.createBufferSource(); s.buffer = bufs[type]; s.start(when, offset == null ? Math.random() * 3.5 : offset, dur + 0.05); s.stop(when + dur + 0.1); return s; }
    function impulse(secs, decay) {
        const key = secs + '|' + decay;
        if (impulses[key]) return impulses[key];
        const n = Math.floor(ctx.sampleRate * secs), b = ctx.createBuffer(2, n, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
        return (impulses[key] = b);
    }
    // a reverb the sound can send to: returns the node to connect to (its wet level is conv._wet)
    function reverb(out, secs, decay, wetLevel) {
        const conv = ctx.createConvolver(); conv.buffer = impulse(secs, decay);
        const w = gain(wetLevel); conv.connect(w); w.connect(out); conv._wet = w;
        return conv;
    }
    function env(g, t, attack, peak, decay) {
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }
    // keeps what a sound has started so it can be stopped cleanly. P gives the live settings:
    // speed(), pitch(), amount(), regularity(), param() (the tavern's Crowd)
    function Rig(P) {
        const r = { srcs: [], holders: [], speedHooks: [], P, live: new Set(), building: false };
        r.src = s => { r.srcs.push(s); return s; };
        r.run = fn => { const prev = activeRig; activeRig = r; try { return fn(); } finally { activeRig = prev; } };
        // run fn at random gaps between min and max milliseconds. Tempo (and the optional rate() multiplier) shortens the gaps live,
        // and Regularity pulls the gaps toward the middle value so the timing gets steadier
        // poisson (true, or a function that says so): the gaps are the waiting times of a Poisson process (exponentially spread around the
        // middle value) instead of an even spread, so events bunch and thin out the way real drops, crackles and footsteps do. A gap is kept
        // between a third of the shortest and twice the longest, so a long silence cannot swallow the sound. Regularity still steadies it.
        r.every = (fn, min, max, rate, poisson) => {
            const h = { id: 0, dead: false }, lo = typeof min === 'function' ? min : () => min, hi = typeof max === 'function' ? max : () => max;
            const po = typeof poisson === 'function' ? poisson : () => !!poisson;
            const next = () => {
                const a = lo(), b = hi(), mid = (a + b) / 2, raw = po() ? clamp(poissonInterval(mid), a / 3, b * 2) : rnd(a, b), gap = mid + (raw - mid) * (1 - 0.92 * P.regularity());
                return gap / (P.speed() * (rate ? rate() : 1));
            };
            const go = () => { if (h.dead) return; r.run(fn); h.id = setTimeout(go, next()); };
            h.id = setTimeout(go, rnd(0, lo()) / (P.speed() * (rate ? rate() : 1)));
            r.holders.push(h);
        };
        r.setPitch = () => { const c = P.pitch() * 100, now = ctx.currentTime; r.live.forEach(n => n.detune.setTargetAtTime(c + (n._off || 0), now, 0.06)); };
        r.stop = () => { r.stopped = true; r.holders.forEach(h => { h.dead = true; clearTimeout(h.id); }); r.srcs.forEach(s => { try { s.stop(); } catch (e) { /* already stopped */ } }); };
        return r;
    }

    // ---------- reusable sound pieces (the sounds and the one-shots both use these) ----------
    function drop(out, f, amp) {
        const t = ctx.currentTime, s = burstSrc('white', t, 0.04), bp = filt('bandpass', f, 2), g = gain(0);
        env(g, t, 0.002, amp, 0.035);
        s.connect(bp); bp.connect(g); g.connect(out);
    }
    // c: how close, 0 (far: dull, slow to build) to 1 (overhead: louder, brighter, builds fast). len stretches or shortens the rumble.
    // No opening crack: it is only the long, rolling rumble, with a few swells along the way.
    function thunderStrike(out, t, c, len) {
        const long = rnd(6.5, 9.5) * (len || 1), attack = Math.min(0.25 + 0.9 * (1 - c), long * 0.4), peak = rnd(0.8, 1.3) * geo(c, 1.5), top = 420 * geo(c, 1.8);
        const rb = ctx.createBufferSource(); rb.buffer = bufs.brown; rb.loop = true; rb.start(t, rnd(0, 4)); rb.stop(t + long + 0.2);
        const lp = filt('lowpass', top), g = gain(0);
        lp.frequency.setValueAtTime(top, t); lp.frequency.exponentialRampToValueAtTime(60, t + long);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + attack);
        const bumps = Math.round(rnd(2, 4));
        for (let i = 1; i <= bumps; i++) { const f = i / (bumps + 1); g.gain.linearRampToValueAtTime(peak * (1 - 0.8 * f) * rnd(0.55, 1), t + attack + (long - attack) * f); }
        g.gain.exponentialRampToValueAtTime(0.0001, t + long);
        rb.connect(lp); lp.connect(g); g.connect(out);
    }
    const BELL_PARTS = [[1, 1, 6.5], [2, 0.55, 4.5], [2.4, 0.4, 3.8], [3, 0.3, 3], [4.2, 0.2, 2.2], [5.4, 0.12, 1.6]];
    function bellToll(dry, rv, t, base) {
        BELL_PARTS.forEach(([m, a, d]) => { const o = mkOsc(), g = gain(0); o.type = 'sine'; o.frequency.value = base * m; env(g, t, 0.004, 0.09 * a, d); o.connect(g); g.connect(dry); if (rv) g.connect(rv); o.start(t); o.stop(t + d + 0.2); });
    }
    function howlTone(dest, t0, f0, dur, amp) {
        const o = mkOsc(), o2 = mkOsc(), g = gain(0), lfo = ctx.createOscillator(), dep = gain(f0 * 0.014), lp = filt('lowpass', 1600);
        lfo.frequency.value = rnd(4.6, 5.8); lfo.connect(dep); dep.connect(o.frequency); const dep2 = gain(f0 * 0.028); lfo.connect(dep2); dep2.connect(o2.frequency);
        [o, o2].forEach(x => { x.type = 'sine'; });
        const f = (x, m) => { x.frequency.setValueAtTime(f0 * m, t0); x.frequency.linearRampToValueAtTime(f0 * 1.55 * m, t0 + dur * 0.3); x.frequency.linearRampToValueAtTime(f0 * 1.4 * m, t0 + dur * 0.65); x.frequency.linearRampToValueAtTime(f0 * 0.8 * m, t0 + dur); };
        f(o, 1); f(o2, 2);
        const g2 = gain(0.3); o2.connect(g2); g2.connect(g); o.connect(g); g.connect(lp); lp.connect(dest);
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(amp, t0 + dur * 0.25); g.gain.setValueAtTime(amp, t0 + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        [o, o2, lfo].forEach(x => { x.start(t0); x.stop(t0 + dur + 0.1); });
    }
    // Laughter, as a voice: a source, a throat and a mouth, the way a real one works.
    //  - the source is a glottal pulse (a band-limited wave whose harmonics fall away steeply, softer than a saw) with the pitch wandering a
    //    little all the time, plus a stream of breath noise;
    //  - the mouth is four formant filters in parallel (the resonances that make an "a"), whose frequencies slide a little inside every "ha";
    //  - each "ha" begins with a puff of breath before the voice comes in, the voice swells fast and dies away softly, the pitch is highest at the
    //    start of the syllable and falls, and the whole run falls and fades and slows down as the laugher runs out of air, ending on an exhale.
    let glottal = null;
    function glottalWave() {
        if (glottal && glottal.ctx === ctx) return glottal.w;
        const n = 56, re = new Float32Array(n + 1), im = new Float32Array(n + 1);
        for (let k = 1; k <= n; k++) im[k] = Math.pow(k, -1.9) * (k === 1 ? 1.15 : 1);
        glottal = { ctx, w: ctx.createPeriodicWave(re, im) };
        return glottal.w;
    }

    const LAUGH_FORMS = {
        a: [[730, 7, 1], [1090, 9, 0.75], [2440, 12, 0.38], [3500, 14, 0.2]],
        e: [[560, 7, 1], [1780, 10, 0.6], [2480, 12, 0.36], [3500, 14, 0.2]]
    };

    function laughBurst(dest, t) {
        const n = Math.round(rnd(5, 9)), female = Math.random() < 0.45;
        const f0 = (female ? rnd(220, 280) : rnd(130, 175)) * rnd(0.95, 1.05);
        const p = pan(rnd(-0.8, 0.8)), out = gain(1.6), mix = gain(1), vg = gain(0), ng = gain(0);

        // Use a harsh, buzzier sawtooth combined with subharmonic vocal fry modulation
        const voice = mkOsc(); voice.type = 'sawtooth';
        const fry = mkOsc(); fry.type = 'square'; fry.frequency.value = f0 * 0.5; // sub-octave vocal fry
        const fryG = gain(0.3); fry.connect(fryG); fryG.connect(vg);

        voice.connect(vg); vg.connect(mix);

        const syl = []; let s = t + 0.01;
        for (let q = 0; q < n; q++) {
            const gap = rnd(0.11, 0.17) * (1 + 0.05 * q);
            syl.push({ s, gap, len: gap * rnd(0.5, 0.7) });
            s += gap;
        }
        const end = s + 0.2;

        // Formant mouth filter filter bank for 'ha'
        const f1 = filt('bandpass', 750, 4), f2 = filt('bandpass', 1350, 5), tone = filt('lowpass', 4000, 0.6);
        mix.connect(f1); mix.connect(f2); f1.connect(tone); f2.connect(tone); tone.connect(out);
        if (p) { out.connect(p); p.connect(dest); } else out.connect(dest);

        // Turbulent throat breath noise
        const ns = burstSrc('white', t, end - t, rnd(0, 1));
        const nFilt = filt('bandpass', 2200, 2);
        ns.connect(nFilt); nFilt.connect(ng); ng.connect(mix);

        // Dynamic pitch contour with chaotic micro-jitter per syllable
        voice.frequency.setValueAtTime(f0, t);
        fry.frequency.setValueAtTime(f0 * 0.5, t);
        syl.forEach((y, q) => {
            const pk = rnd(0.12, 0.2) * (1 - q / (n + 1));
            const sf = f0 * (1 - 0.15 * (q / n)) * rnd(0.9, 1.1);

            voice.frequency.setValueAtTime(sf * 1.2, y.s);
            voice.frequency.exponentialRampToValueAtTime(sf * 0.8, y.s + y.len);

            vg.gain.setValueAtTime(0.0001, y.s);
            vg.gain.linearRampToValueAtTime(pk, y.s + 0.012);
            vg.gain.setTargetAtTime(0.0001, y.s + y.len * 0.6, 0.04);

            ng.gain.setValueAtTime(0.0001, y.s - 0.02);
            ng.gain.linearRampToValueAtTime(pk * 0.8, y.s + 0.005);
            ng.gain.setTargetAtTime(0.0001, y.s + y.len * 0.8, 0.05);
        });

        voice.start(t); fry.start(t);
        voice.stop(end + 0.1); fry.stop(end + 0.1);
    }
    function creakOnce(dry, rv, t, amp) {
        const o = mkOsc(), bp = filt('bandpass', rnd(140, 380), 12), g = gain(0), d = rnd(0.5, 1.3), f = rnd(110, 200);
        o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * rnd(0.8, 1.4), t + d);
        const lfo = ctx.createOscillator(), dep = gain(5); lfo.frequency.value = rnd(8, 18); lfo.connect(dep); dep.connect(o.frequency);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(rnd(0.05, 0.12) * amp, t + d * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(bp); bp.connect(g); g.connect(dry); if (rv) g.connect(rv); o.start(t); lfo.start(t); o.stop(t + d + 0.1); lfo.stop(t + d + 0.1);
    }
    function thud(dest, t, f, amp) {
        const o = mkOsc(), g = gain(0); o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.08);
        env(g, t, 0.002, amp, 0.1);
        const s = burstSrc('brown', t, 0.05), lp = filt('lowpass', 500), g2 = gain(0); env(g2, t, 0.002, amp * 0.8, 0.05);
        o.connect(g); g.connect(dest); s.connect(lp); lp.connect(g2); g2.connect(dest); o.start(t); o.stop(t + 0.2);
    }

    // ---------- weather and nature ----------
    function rain(out, r) {
        const P = r.P, s = r.src(loopSrc('pink')), hp = filt('highpass', 450), lp = filt('lowpass', 9500), g = gain(0.5);
        s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out);
        r.speedHooks.push(() => g.gain.setTargetAtTime(0.5 * geo(P.amount(), 1.9), ctx.currentTime, 0.2));
        r.every(() => drop(out, rnd(2200, 6500), rnd(0.03, 0.1) * geo(P.amount(), 1.6)), 12, 45, () => geo(P.amount(), 5), true);
    }
    function wind(out, r, soft) {
        const P = r.P, s = r.src(loopSrc('pink')), bp = filt('bandpass', 450, 0.8), g = gain(0.4);
        s.connect(bp); bp.connect(g); g.connect(out);
        r.every(() => {
            const now = ctx.currentTime, k = 1 / P.speed(), A = P.amount();
            bp.frequency.setTargetAtTime(rnd(220, (soft ? 520 : 950) * geo(A, 1.5)), now, 1.6 * k);
            g.gain.setTargetAtTime(rnd(0.12, soft ? 0.4 : 0.85) * geo(A, 1.7), now, 1.4 * k);
        }, 1800, 4200);
    }
    function thunder(out, r) {
        const P = r.P, strike = () => thunderStrike(out, ctx.currentTime + rnd(0, 0.4), P.amount(), P.len());
        r.holders.push({ id: setTimeout(() => r.run(strike), 1200), dead: false }); // one soon, so it is heard straight away
        r.every(strike, 9000, 22000);
    }
    function blizzard(out, r) {
        const P = r.P, s = r.src(loopSrc('pink')), bp = filt('bandpass', 900, 0.6), g = gain(0.5);
        s.connect(bp); bp.connect(g); g.connect(out);
        const snow = r.src(loopSrc('pink')), hp = filt('highpass', 2800), sg = gain(0.1);
        snow.connect(hp); hp.connect(sg); sg.connect(out);
        const w = r.src(loopSrc('white')), wb = filt('bandpass', 750, 16), wg = gain(0.18); // the whistle
        w.connect(wb); wb.connect(wg); wg.connect(out);
        r.speedHooks.push(() => sg.gain.setTargetAtTime(0.1 * geo(P.amount(), 2.2), ctx.currentTime, 0.2));
        r.every(() => {
            const now = ctx.currentTime, k = 1 / P.speed(), A = P.amount();
            bp.frequency.setTargetAtTime(rnd(500, 1500), now, 1.1 * k);
            g.gain.setTargetAtTime(rnd(0.25, 0.8) * geo(A, 1.6), now, 1.0 * k);
            wb.frequency.setTargetAtTime(rnd(520, 1150), now, 0.8 * k);
            wg.gain.setTargetAtTime(rnd(0.04, 0.3) * geo(A, 2.4), now, 0.8 * k);
        }, 1200, 3000);
    }
    function waves(out, r, soft) {
        const P = r.P, s = r.src(loopSrc('pink')), lp = filt('lowpass', 600), g = gain(soft ? 0.35 : 0.5);
        s.connect(lp); lp.connect(g); g.connect(out);
        const foam = r.src(loopSrc('white')), hp = filt('highpass', 3500), fg = gain(0.0), fl = filt('lowpass', 9000);
        foam.connect(hp); hp.connect(fl); fl.connect(fg); fg.connect(out);
        const lfo = r.src(ctx.createOscillator()); lfo.type = 'sine';
        const d1 = gain(520); lfo.connect(d1); d1.connect(lp.frequency);
        const d2 = gain(soft ? 0.25 : 0.35); lfo.connect(d2); d2.connect(g.gain);
        const lfo2 = r.src(ctx.createOscillator()); lfo2.type = 'sine';
        const ph = gain(0.05); lfo2.connect(ph); ph.connect(fg.gain);
        const set = () => {
            const now = ctx.currentTime, f = 0.105 * P.speed(), A = P.amount();
            lfo.frequency.setTargetAtTime(f, now, 0.3); lfo2.frequency.setTargetAtTime(f, now, 0.3);
            d1.gain.setTargetAtTime(520 * geo(A, 1.8), now, 0.2); d2.gain.setTargetAtTime((soft ? 0.25 : 0.35) * geo(A, 1.7), now, 0.2); ph.gain.setTargetAtTime(0.05 * geo(A, 2.5), now, 0.2);
        };
        lfo.frequency.value = 0.105 * P.speed(); lfo2.frequency.value = 0.105 * P.speed();
        lfo.start(); lfo2.start();
        r.speedHooks.push(set);
    }
    function stream(out, r) {
        const P = r.P, hiss = r.src(loopSrc('pink')), bp = filt('bandpass', 1900, 0.6), hg = gain(0.55);
        hiss.connect(bp); bp.connect(hg); hg.connect(out);
        const low = r.src(loopSrc('brown')), lp = filt('lowpass', 420), lg = gain(0.22);
        low.connect(lp); lp.connect(lg); lg.connect(out);
        r.speedHooks.push(() => hg.gain.setTargetAtTime(0.55 * geo(P.amount(), 1.7), ctx.currentTime, 0.2));
        r.every(() => bp.frequency.setTargetAtTime(rnd(1400, 2600), ctx.currentTime, 0.4), 500, 1400);
        r.every(() => { // bubbles
            const t = ctx.currentTime, o = mkOsc(), g = gain(0), f = rnd(300, 1300);
            o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * rnd(1.4, 2.2), t + 0.05);
            env(g, t, 0.004, rnd(0.015, 0.07), 0.05);
            o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.15);
        }, 8, 38, () => geo(P.amount(), 3.5), true);
    }
    function birds(out, r) {
        const P = r.P, wet = reverb(out, 1.6, 3, 0.35), bus = gain(1); bus.connect(out); bus.connect(wet);
        const air = r.src(loopSrc('pink')), lp = filt('lowpass', 1500), ag = gain(0.018);
        air.connect(lp); lp.connect(ag); ag.connect(out);
        const kinds = [
            { lo: 2800, hi: 4200, n: [2, 5], gap: [0.09, 0.16], dur: 0.07 },
            { lo: 3600, hi: 5800, n: [4, 9], gap: [0.05, 0.085], dur: 0.04 },
            { lo: 1800, hi: 2600, n: [2, 3], gap: [0.18, 0.28], dur: 0.14 }
        ];
        r.every(() => {
            const k = pick(kinds), base = rnd(k.lo, k.hi), n = Math.round(rnd(k.n[0], k.n[1])), p = pan(rnd(-0.9, 0.9)), amp = rnd(0.02, 0.07);
            const dest = p || bus; if (p) { p.connect(bus); }
            let t = ctx.currentTime, up = Math.random() < 0.5;
            for (let i = 0; i < n; i++) {
                const o = mkOsc(), g = gain(0), f = base * rnd(0.92, 1.12);
                o.type = 'sine'; o.frequency.setValueAtTime(up ? f * 0.82 : f * 1.12, t); o.frequency.exponentialRampToValueAtTime(up ? f * 1.12 : f * 0.8, t + k.dur);
                env(g, t, 0.006, amp, k.dur);
                o.connect(g); g.connect(dest); o.start(t); o.stop(t + k.dur + 0.1);
                t += rnd(k.gap[0], k.gap[1]); if (Math.random() < 0.3) up = !up;
            }
        }, 700, 3200, () => geo(P.amount(), 4));
    }
    function crickets(out, r) {
        const P = r.P, air = r.src(loopSrc('pink')), lp = filt('lowpass', 900), ag = gain(0.045);
        air.connect(lp); lp.connect(ag); ag.connect(out);
        for (let v = 0; v < 7; v++) {
            const o = r.src(mkOsc()), g = gain(0), f = rnd(4100, 5300), p = pan(rnd(-0.8, 0.8));
            o.type = 'sine'; o.frequency.value = f; o.start();
            o.connect(g);
            if (p) { g.connect(p); p.connect(out); } else g.connect(out);
            const pulses = Math.round(rnd(3, 5)), gap = rnd(0.028, 0.04), amp = rnd(0.018, 0.04);
            r.every(() => {
                if (v >= Math.max(1, Math.round(P.amount() * 7))) return; // the Chorus slider sets how many are singing
                const t = ctx.currentTime;
                for (let q = 0; q < pulses; q++) { const s = t + q * gap; g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(amp, s + 0.008); g.gain.linearRampToValueAtTime(0, s + gap * 0.85); }
            }, 380, 1100);
        }
    }
    function frogs(out, r) {
        const P = r.P, air = r.src(loopSrc('pink')), lp = filt('lowpass', 800), ag = gain(0.04);
        air.connect(lp); lp.connect(ag); ag.connect(out);
        const cr = gain(0.4); cr.connect(out); crickets(cr, r);
        const wet = reverb(out, 1.4, 3, 0.3), bus = gain(1); bus.connect(out); bus.connect(wet);
        for (let v = 0; v < 5; v++) {
            const base = rnd(110, 210), bp = filt('bandpass', rnd(350, 650), 2.5), p = pan(rnd(-0.8, 0.8)), vg = gain(1);
            bp.connect(vg); if (p) { vg.connect(p); p.connect(bus); } else vg.connect(bus);
            r.every(() => {
                if (v >= Math.max(1, Math.ceil(P.amount() * 5))) return;
                const t = ctx.currentTime, n = Math.round(rnd(2, 6)), gap = rnd(0.03, 0.05), amp = rnd(0.06, 0.14);
                const o = mkOsc(), g = gain(0);
                o.type = 'sawtooth'; o.frequency.setValueAtTime(base, t); o.frequency.linearRampToValueAtTime(base * 1.35, t + n * gap);
                g.gain.setValueAtTime(0, t);
                for (let q = 0; q < n; q++) { const s = t + q * gap; g.gain.linearRampToValueAtTime(amp, s + 0.008); g.gain.linearRampToValueAtTime(0.0, s + gap * 0.9); }
                o.connect(g); g.connect(bp); o.start(t); o.stop(t + n * gap + 0.1);
            }, 1400, 5200);
        }
    }
    function wolves(out, r) {
        const P = r.P, wet = reverb(out, 2.8, 2.4, 0.9), bus = gain(0.8); bus.connect(out); bus.connect(wet);
        const wind = r.src(loopSrc('pink')), wb = filt('bandpass', 350, 0.7), wg = gain(0.06);
        wind.connect(wb); wb.connect(wg); wg.connect(out);
        r.every(() => {
            const t = ctx.currentTime, dur = rnd(2.6, 4.2), pack = 1 + Math.round(P.amount() * 3);
            howlTone(bus, t, rnd(330, 430), dur, 0.12);
            for (let i = 1; i < pack; i++) howlTone(bus, t + rnd(0.5, 3), rnd(300, 520), dur * rnd(0.8, 1.2), 0.1 - i * 0.012);
        }, 11000, 26000);
    }

    // ---------- places and magic ----------
    function fire(out, r) {
        const P = r.P, roar = r.src(loopSrc('brown')), lp = filt('lowpass', 260), rg = gain(0.55);
        roar.connect(lp); lp.connect(rg); rg.connect(out);
        const hiss = r.src(loopSrc('pink')), hp = filt('highpass', 2600), hg = gain(0.035);
        hiss.connect(hp); hp.connect(hg); hg.connect(out);
        let roarBase = 0.55;
        r.speedHooks.push(() => { roarBase = 0.55 * geo(P.amount(), 2); hg.gain.setTargetAtTime(0.035 * geo(P.amount(), 2), ctx.currentTime, 0.2); });
        r.every(() => rg.gain.setTargetAtTime(roarBase * rnd(0.65, 1.25), ctx.currentTime, 0.25), 200, 600);
        r.every(() => { // crackles
            const t = ctx.currentTime, big = Math.random() < 0.12, dur = big ? rnd(0.02, 0.05) : rnd(0.004, 0.014);
            const s = burstSrc('white', t, dur + 0.02), f = filt(big ? 'bandpass' : 'highpass', big ? rnd(700, 1400) : rnd(1500, 3500), big ? 1.2 : 0.7), g = gain(0);
            env(g, t, 0.001, big ? rnd(0.35, 0.7) : rnd(0.08, 0.32), dur);
            s.connect(f); f.connect(g); g.connect(out);
        }, 25, 190, () => geo(P.amount(), 2.8), true);
    }
    function cave(out, r) {
        const P = r.P, drone = r.src(loopSrc('brown')), lp = filt('lowpass', 130), dg = gain(0.3);
        drone.connect(lp); lp.connect(dg); dg.connect(out);
        const air = r.src(loopSrc('pink')), alp = filt('lowpass', 700), ag = gain(0.035);
        air.connect(alp); alp.connect(ag); ag.connect(out);
        const conv = reverb(out, 3.6, 2.6, 1.1), dry = gain(0.4); dry.connect(out);
        r.speedHooks.push(() => conv._wet.gain.setTargetAtTime(1.1 * geo(P.amount(), 3), ctx.currentTime, 0.2));
        r.every(() => {
            const t = ctx.currentTime, o = mkOsc(), g = gain(0), f0 = rnd(650, 1900);
            o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.5, t + 0.12);
            env(g, t, 0.002, rnd(0.08, 0.22), 0.22);
            o.connect(g); g.connect(dry); g.connect(conv);
            o.start(t); o.stop(t + 0.5);
        }, 600, 3400, null, true);
    }
    // vowel formants (first two), roughly a, e, i, o, u
    const VOWELS = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [300, 870], [660, 1720]];
    // CREDIT: the recording in planning/sounds/tavern-crowd.mp3 is "Busy Bar and Restaurant Ambience with Crowd and Background Chatter" by
    // jadeallencook, from Pixabay (file id 339222), used under the Pixabay Content License (free, commercial use and changes allowed, no
    // attribution required, but not to be sold or shared on its own). Downloaded 2026-11-04. See planning/sounds/CREDITS.txt.
    // The tavern is a real recording of a busy bar (planning/sounds/tavern-crowd.mp3), looped without a seam: each pass fades out while the next
    // fades in over a few seconds, and a second, slightly slower copy of it comes up as the Crowd slider rises. Rowdiness sets how loud and how
    // bright it is. If the file cannot be loaded (the page opened straight from disk, or the file is missing) the old made-up crowd plays instead.
    let tavernRec = null;
    function loadTavernRec() {
        if (!tavernRec) tavernRec = fetch('sounds/tavern-crowd.mp3').then(res => { if (!res.ok) throw new Error('missing'); return res.arrayBuffer(); }).then(ab => ctx.decodeAudioData(ab)).then(buf => {
            const d = buf.getChannelData(0); let s = 0, n = 0;
            for (let i = 0; i < d.length; i += 97) { s += d[i] * d[i]; n++; }
            buf._norm = clamp(0.12 / Math.max(0.005, Math.sqrt(s / n)), 0.2, 6); // so it sits at the same loudness as the other sounds
            return buf;
        }).catch(e => { tavernRec = null; throw e; });
        return tavernRec;
    }
    const FADE_IN = (() => { const c = new Float32Array(48); for (let i = 0; i < 48; i++) c[i] = Math.sin(Math.PI / 2 * i / 47); return c; })();
    const FADE_OUT = FADE_IN.slice().reverse();
    // plays buf in a loop with equal-power crossfades between passes into dest; startOffset is where the first pass starts
    function seamlessLoop(buf, dest, r, rateFn, startOffset) {
        const X = Math.min(3, buf.duration * 0.15), h = { id: 0, dead: false };
        let nextT = 0;
        const pass = (t, off, first) => {
            const rate = rateFn(), dur = (buf.duration - off) / rate, xf = X / rate, fin = first ? 0.4 : xf;
            const s = ctx.createBufferSource(), g = gain(0);
            s.buffer = buf; s.playbackRate.value = rate; s.detune.value = pitchCents();
            g.gain.setValueAtTime(0.0001, t); g.gain.setValueCurveAtTime(FADE_IN, t, Math.max(0.05, fin));
            g.gain.setValueAtTime(1, t + Math.max(0.05, fin)); g.gain.setValueCurveAtTime(FADE_OUT, t + dur - xf, xf);
            s.connect(g); g.connect(dest); r.srcs.push(s);
            s.start(t, off); s.stop(t + dur + 0.05);
            nextT = t + dur - xf;
        };
        pass(ctx.currentTime + 0.02, Math.min(startOffset, Math.max(0, buf.duration - 4 * X - 1)), true);
        h.id = setInterval(() => { if (!h.dead && ctx.currentTime + 1.5 > nextT) r.run(() => pass(nextT, 0, false)); }, 100);
        r.holders.push(h);
    }
    function tavern(out, r) {
        loadTavernRec().then(buf => {
            if (r.stopped) return;
            const P = r.P, lp = filt('lowpass', 8000, 0.5), bed = gain(0), layer2 = gain(0), pre = gain(buf._norm);
            r.run(() => {
                seamlessLoop(buf, pre, r, () => P.speed(), rnd(0, buf.duration));
                const second = gain(1); seamlessLoop(buf, second, r, () => P.speed() * 0.97, rnd(0, buf.duration)); second.connect(layer2); layer2.connect(lp);
            });
            pre.connect(bed); bed.connect(lp); lp.connect(out);
            const set = first => {
                const now = ctx.currentTime, a = P.amount(), crowd = clamp((P.param() - 2) / 12, 0, 1);
                const set1 = (p, v) => { if (first) p.value = v; else p.setTargetAtTime(v, now, 0.15); };
                set1(bed.gain, 0.8 * geo(a, 1.8)); set1(layer2.gain, 0.7 * crowd * geo(a, 1.8) * buf._norm);
                set1(lp.frequency, 2600 * Math.pow(6, a));
            };
            set(true); r.speedHooks.push(() => set(false));
        }).catch(() => { if (!r.stopped) r.run(() => tavernSynth(out, r)); });
    }
    function tavernSynth(out, r) {
        const P = r.P, room = r.src(loopSrc('pink')), rlp = filt('lowpass', 500), rg = gain(0.05);
        room.connect(rlp); rlp.connect(rg); rg.connect(out);
        const wet = reverb(out, 1.3, 3, 0.55), bus = gain(1); bus.connect(out); bus.connect(wet);
        const voiceOut = filt('lowpass', 3800); voiceOut.connect(bus);
        const voices = [];
        for (let v = 0; v < 14; v++) {
            const female = Math.random() < 0.4, f0 = female ? rnd(180, 250) : rnd(92, 142);
            const osc = r.src(mkOsc()); osc.type = 'sawtooth'; osc.frequency.value = f0; osc.start();
            const f1 = filt('bandpass', 600, 7), f2 = filt('bandpass', 1500, 9), f2g = gain(0.7), amp = gain(0), p = pan(rnd(-0.9, 0.9));
            osc.connect(f1); osc.connect(f2); f2.connect(f2g); f1.connect(amp); f2g.connect(amp);
            if (p) { amp.connect(p); p.connect(voiceOut); } else amp.connect(voiceOut);
            voices.push({ f0, osc, f1, f2, amp, female, hold: 0, talking: false });
        }
        const say = (v, t, level) => { // one syllable
            const vow = pick(VOWELS);
            v.f1.frequency.setTargetAtTime(vow[0] * rnd(0.92, 1.1), t, 0.02);
            v.f2.frequency.setTargetAtTime(vow[1] * rnd(0.92, 1.1), t, 0.02);
            v.osc.frequency.setTargetAtTime(v.f0 * rnd(0.88, 1.18), t, 0.03);
            v.amp.gain.cancelScheduledValues(t);
            v.amp.gain.setTargetAtTime(level, t, 0.012);
            v.amp.gain.setTargetAtTime(level * 0.1, t + 0.09, 0.04);
        };
        voices.forEach((v, i) => {
            r.every(() => {
                const t = ctx.currentTime;
                if (i >= P.param()) { v.amp.gain.setTargetAtTime(0, t, 0.05); return; }
                if (v.hold <= 0) { v.talking = Math.random() < 0.62; v.hold = Math.round(v.talking ? rnd(4, 13) : rnd(3, 11)); }
                v.hold--;
                if (v.talking) say(v, t, rnd(0.02, 0.075) * geo(P.amount(), 1.6)); else v.amp.gain.setTargetAtTime(0, t, 0.05);
            }, 125, 270);
        });
        r.every(() => laughBurst(voiceOut, ctx.currentTime), 7000, 17000, () => geo(P.amount(), 3), true);
        r.every(() => { // a glass or mug clink
            const t = ctx.currentTime, base = rnd(2400, 3600);
            [1, 1.52, 2.31].forEach((m, i) => { const o = mkOsc(), g = gain(0); o.type = 'sine'; o.frequency.value = base * m; env(g, t, 0.001, 0.05 / (i + 1), rnd(0.12, 0.3)); o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.5); });
        }, 2500, 8000, null, true);
        r.every(() => thud(bus, ctx.currentTime, 140, rnd(0.1, 0.22)), 4500, 12000, () => geo(P.amount(), 2), true); // a mug set down
        r.every(() => { // a chair scraping
            const t = ctx.currentTime, s = burstSrc('pink', t, 0.35, 0), bp = filt('bandpass', 500, 4), g = gain(0);
            bp.frequency.setValueAtTime(420, t); bp.frequency.linearRampToValueAtTime(1100, t + 0.3);
            env(g, t, 0.05, 0.07, 0.28);
            s.connect(bp); bp.connect(g); g.connect(bus);
        }, 14000, 34000);
    }
    function ship(out, r) {
        const P = r.P, w = gain(0.9); w.connect(out); waves(w, r, true);
        const wd = gain(0.5); wd.connect(out); wind(wd, r, true);
        const conv = reverb(out, 1.2, 3, 0.35), dry = gain(0.8); dry.connect(out);
        r.every(() => creakOnce(dry, conv, ctx.currentTime, geo(P.amount(), 1.5)), 900, 4200, () => geo(P.amount(), 3));
        r.every(() => { // the hull knocking
            const t = ctx.currentTime, s = burstSrc('brown', t, 0.12), lp = filt('lowpass', 260), g = gain(0);
            env(g, t, 0.004, rnd(0.2, 0.5), 0.12); s.connect(lp); lp.connect(g); g.connect(dry);
        }, 3500, 11000, () => geo(P.amount(), 2));
    }
    function magic(out, r) {
        const P = r.P, lp = filt('lowpass', 700), g = gain(0.22), conv = reverb(out, 3.2, 2.4, 0.8);
        lp.connect(g); g.connect(out); g.connect(conv);
        [110, 164.8, 220, 277.2].forEach(f => { for (let k = 0; k < 2; k++) { const o = r.src(mkOsc()); o.type = 'sawtooth'; o.frequency.value = f; o._off = rnd(-9, 9); o.detune.value = pitchCents() + o._off; const og = gain(0.06); o.connect(og); og.connect(lp); o.start(); } });
        const lfo = r.src(ctx.createOscillator()), dep = gain(320); lfo.frequency.value = 0.13; lfo.connect(dep); dep.connect(lp.frequency); lfo.start();
        const trem = r.src(ctx.createOscillator()), td = gain(0.06); trem.frequency.value = 0.4; trem.connect(td); td.connect(g.gain); trem.start();
        const scale = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3];
        r.every(() => { // sparkles
            const t = ctx.currentTime, o = mkOsc(), sg = gain(0), f = 880 * pick(scale) * pick([1, 2, 2, 4]);
            o.type = 'sine'; o.frequency.value = f; env(sg, t, 0.01, rnd(0.02, 0.05), rnd(1.2, 2.6));
            o.connect(sg); sg.connect(out); sg.connect(conv); o.start(t); o.stop(t + 3);
        }, 600, 2600, () => geo(P.amount(), 4));
    }
    function bell(out, r) {
        const P = r.P, conv = reverb(out, 3.8, 2.2, 1.2), dry = gain(0.45); dry.connect(out);
        const air = r.src(loopSrc('pink')), lp = filt('lowpass', 600), ag = gain(0.025); air.connect(lp); lp.connect(ag); ag.connect(out);
        r.every(() => { const base = rnd(170, 260), n = Math.max(1, Math.round(1 + P.amount() * 7)), gap = rnd(3.2, 4.6); for (let i = 0; i < n; i++) bellToll(dry, conv, ctx.currentTime + i * gap, base); }, 9000, 22000);
    }

    // ---------- music (simple, generated; Pitch is the key) ----------
    const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
    function lute(out, r) {
        const P = r.P, wet = reverb(out, 1.8, 3, 0.45), bus = gain(0.9); bus.connect(out); bus.connect(wet);
        const scale = [0, 2, 3, 5, 7, 9, 10]; // D dorian
        const midi = deg => 50 + scale[((deg % 7) + 7) % 7] + 12 * Math.floor(deg / 7);
        const pluck = (m, t, dur, amp) => {
            const f = mtof(m), o = mkOsc(), o2 = mkOsc(), g = gain(0), lp = filt('lowpass', f * 6, 0.8);
            o.type = 'triangle'; o2.type = 'sawtooth'; o.frequency.value = f; o2.frequency.value = f * 1.003;
            lp.frequency.setValueAtTime(f * 7, t); lp.frequency.exponentialRampToValueAtTime(f * 1.6, t + dur);
            const g2 = gain(0.25); o2.connect(g2); g2.connect(lp); o.connect(lp); lp.connect(g); g.connect(bus);
            env(g, t, 0.004, amp, dur); o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
        };
        let deg = 7, step = 0;
        r.every(() => {
            const t = ctx.currentTime;
            if (step % 8 === 0) pluck(midi(pick([-7, -7, -4, -3])), t, 2.2, 0.1); // a low note each bar
            if (Math.random() < 0.3 + 0.55 * P.amount()) {
                deg = clamp(deg + pick([-2, -1, -1, 0, 1, 1, 2]), 2, 13); if (deg > 10 && Math.random() < 0.5) deg -= 2;
                pluck(midi(deg), t, rnd(0.9, 1.6), rnd(0.08, 0.15));
            }
            step++;
        }, 330, 330);
    }
    function pad(out, r) {
        const P = r.P, wet = reverb(out, 3.4, 2.4, 0.8), bus = gain(0.7); bus.connect(out); bus.connect(wet);
        const chords = [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [48, 55, 60, 64, 67], [43, 50, 55, 59, 62]]; // Am F C G
        let i = 0;
        r.every(() => {
            const t = ctx.currentTime, chord = chords[i++ % chords.length], bright = 500 + 2400 * P.amount(), dur = 9.5;
            const lp = filt('lowpass', bright, 0.5), g = gain(0);
            g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 3); g.gain.linearRampToValueAtTime(0.35, t + 6); g.gain.linearRampToValueAtTime(0.0001, t + dur);
            lp.connect(g); g.connect(bus);
            chord.forEach(m => { for (let k = 0; k < 2; k++) { const o = mkOsc(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = pitchCents() + rnd(-8, 8); const og = gain(0.05); o.connect(og); og.connect(lp); o.start(t); o.stop(t + dur + 0.1); } });
        }, 7000, 7000);
    }
    function musicbox(out, r) {
        const P = r.P, wet = reverb(out, 2.6, 2.4, 0.8), bus = gain(0.8); bus.connect(out); bus.connect(wet);
        const notes = [72, 74, 76, 79, 81, 84, 86, 88]; // C major pentatonic, high
        let last = 3;
        r.every(() => {
            if (Math.random() > 0.25 + 0.6 * P.amount()) return;
            last = clamp(last + pick([-2, -1, -1, 1, 1, 2, 3]), 0, notes.length - 1);
            const t = ctx.currentTime, f = mtof(notes[last]);
            [[1, 1], [3, 0.18], [5.4, 0.06]].forEach(([m, a]) => { const o = mkOsc(), g = gain(0); o.type = 'sine'; o.frequency.value = f * m; env(g, t, 0.003, 0.07 * a, 1.8 / m + 0.2); o.connect(g); g.connect(bus); o.start(t); o.stop(t + 2.5); });
        }, 420, 420);
    }

    // Boss fight: a driving four-bar loop in D minor (Dm, Bb, C, A) at 150 BPM, played one sixteenth at a time.
    // Tempo changes the speed, Pitch changes the key, Intensity adds the brass stabs, the lead line and the busier hats.
    function boss(out, r) {
        const P = r.P, wet = reverb(out, 1.6, 3, 0.4), bus = gain(0.6), dry = gain(0.55);
        bus.connect(out); bus.connect(wet); dry.connect(out);
        const tone = (type, m, t, dur, amp, cut, dest) => {
            const f = mtof(m), lp = filt('lowpass', cut, 0.7), g = gain(0);
            for (let k = 0; k < 2; k++) { const o = mkOsc(); o.type = type; o.frequency.value = f; o.detune.value = pitchCents() + (k ? 7 : -7); o.connect(lp); o.start(t); o.stop(t + dur + 0.15); }
            lp.connect(g); g.connect(dest); env(g, t, 0.008, amp, dur);
        };
        const kick = (t, a) => { const o = mkOsc(), g = gain(0); o.type = 'sine'; o.frequency.setValueAtTime(135, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14); env(g, t, 0.002, a, 0.22); o.connect(g); g.connect(dry); o.start(t); o.stop(t + 0.4); };
        const snare = (t, a) => {
            const s = burstSrc('white', t, 0.2), bp = filt('bandpass', 1900, 0.8), g = gain(0), o = mkOsc(), og = gain(0);
            env(g, t, 0.001, a, 0.17); s.connect(bp); bp.connect(g); g.connect(dry);
            o.type = 'triangle'; o.frequency.setValueAtTime(230, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.08); env(og, t, 0.001, a * 0.5, 0.1); o.connect(og); og.connect(dry); o.start(t); o.stop(t + 0.25);
        };
        const hat = (t, a) => { const s = burstSrc('white', t, 0.04), hp = filt('highpass', 7500), g = gain(0); env(g, t, 0.001, a, 0.035); s.connect(hp); hp.connect(g); g.connect(dry); };
        const tom = (t, f, a) => { const o = mkOsc(), g = gain(0); o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.2); env(g, t, 0.002, a, 0.25); o.connect(g); g.connect(dry); o.start(t); o.stop(t + 0.45); };
        const crash = (t, a) => { const s = burstSrc('white', t, 1.4), hp = filt('highpass', 4500), g = gain(0); env(g, t, 0.003, a, 1.3); s.connect(hp); hp.connect(g); g.connect(bus); };
        const prog = [
            { bass: 38, ch: [50, 57, 62, 65], lead: [74, 0, 77, 0, 81, 0, 79, 77] },
            { bass: 34, ch: [46, 53, 58, 62], lead: [70, 0, 74, 0, 77, 0, 74, 70] },
            { bass: 36, ch: [48, 55, 60, 64], lead: [72, 0, 76, 0, 79, 0, 76, 72] },
            { bass: 33, ch: [45, 52, 57, 61], lead: [69, 0, 73, 0, 76, 0, 81, 0] }
        ];
        const bassPat = [0, 0, 12, 0, 0, 12, 0, 7], kicks = [0, 3, 8, 10];
        let step = 0, nextT = 0;
        const play = (t, u) => {
            const a = P.amount(), s = step % 16, bar = Math.floor(step / 16) % 4, c = prog[bar], k = 0.6 + 0.8 * a;
            if (kicks.indexOf(s) >= 0 || (bar === 3 && s === 14)) kick(t, 0.5 * k);
            if (s === 4 || s === 12) snare(t, 0.22 * k);
            if (bar === 3 && s >= 12) { tom(t, [190, 160, 135, 110][s - 12], 0.3 * k); if (s === 15) snare(t, 0.24 * k); }
            if (s % 2 === 0) hat(t, s % 4 === 0 ? 0.07 : 0.04); else if (a > 0.7) hat(t, 0.025);
            if (step % 64 === 0) crash(t, 0.1 * k);
            if (s % 2 === 0) tone('sawtooth', c.bass + bassPat[s / 2], t, 1.8 * u, 0.2, 520, bus);
            if (s === 0) c.ch.forEach(m => tone('sawtooth', m + 12, t, 16 * u + 0.2, 0.025, 1100, bus));
            if (a > 0.2 && (s === 0 || s === 6 || s === 10)) c.ch.forEach(m => tone('sawtooth', m + 12, t, 2.4 * u, 0.045 * k, 2400, bus));
            if (a > 0.3 && s % 2 === 0 && c.lead[s / 2]) tone('square', c.lead[s / 2] + 12, t, 1.9 * u, 0.035 * k, 3400, bus);
            step++;
        };
        // a quick timer places every note on an exact grid a little ahead of the clock, so a late timer does not shake the rhythm
        r.every(() => {
            const now = ctx.currentTime; if (nextT < now) nextT = now + 0.05;
            while (nextT < now + 0.12) { const u = 0.1 / P.speed(); play(nextT, u); nextT += u; }
        }, 25, 25);
    }

    // ---------- swords and shields ----------
    // Steel ringing, built like a struck metal bar: the modes of a free bar sit at 1, 2.76, 5.4, 8.93 and 13.3 times the lowest, each as
    // two slightly detuned partials so they beat and shimmer, and the higher ones die away faster. A hard click opens it, and a thin hiss of
    // high noise lingers behind. weight 0..1 is how heavy the blades are: heavy ones ring lower and longer, light ones are a bright clink.
    // A struck object as a set of modes: [ratio to the lowest, loudness, how long it lasts compared with the first]. The modes of a real plate,
    // bar or shield are not whole-number multiples of the lowest, which is what makes metal sound like metal. Each mode is two sines a hair
    // apart, so the pair beats slowly the way real metal shimmers, and the higher modes die faster (fall: how fast).
    const FREE_BAR_MODES = [[1, 0.5, 1], [2.76, 1.2, 1], [5.4, 0.8, 1], [8.93, 0.4, 1], [13.34, 0.2, 1]];
    function modalResonator(out, t, amp, baseFreq, decayTime, modes, fall, beat) {
        const fl = fall == null ? 0.4 : fall, bt = beat || [0.001, 0.005];
        modes.forEach(([m, a, dScale], i) => {
            const f = baseFreq * m; if (f > 16000) return;
            const d = decayTime * dScale / (1 + fl * i);
            [-1, 1].forEach(side => {
                const o = mkOsc(), g = gain(0); o.type = 'sine'; o.frequency.value = f * (1 + side * rnd(bt[0], bt[1]));
                env(g, t, 0.0008, amp * a * 0.4, d); o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.1);
            });
        });
    }
    function metalRing(out, t, amp, base, ring) { modalResonator(out, t, amp, base, ring, FREE_BAR_MODES, 0.55, [0.002, 0.007]); }
    // The ring of sword on sword, from two real recordings (about 80 clashes): no low bell tone, but a dense cluster of partials mostly between
    // 3.5 and 7 kHz, with a different set of them in every hit. This is how often a ring partial sat near each frequency; each clash draws its own set.
    const CLASH_BINS = [[2000, 4], [2500, 4], [3000, 4], [3500, 18], [3750, 23], [4250, 28], [4750, 41], [5250, 35], [5750, 36], [6250, 26], [6750, 16], [7500, 6], [8100, 5], [9500, 3], [11000, 3]];
    const CLASH_TOTAL = CLASH_BINS.reduce((s, b) => s + b[1], 0);
    function clashPartial() { let r = Math.random() * CLASH_TOTAL; for (const b of CLASH_BINS) { r -= b[1]; if (r <= 0) return b[0] + rnd(-125, 125); } return 5000; }
    // weight 0 to 1: light blades ring a little higher and shorter, heavy ones lower and longer
    function swordClash(out, t, amp, weight) {
        const w = weight == null ? Math.random() : weight, shift = 1.1 - 0.2 * w, ring = 0.24 + 0.3 * Math.pow(Math.random(), 1.4) + 0.15 * w;
        // the strike: a broadband click with a knock and a short thump under it
        const s = burstSrc('white', t, 0.05), hp = filt('highpass', 1200, 0.7), g = gain(0);
        env(g, t, 0.0004, amp * 0.9, 0.03); s.connect(hp); hp.connect(g); g.connect(out);
        const kn = burstSrc('white', t, 0.06), lp = filt('lowpass', 2400), kg = gain(0);
        env(kg, t, 0.0004, amp * 2.4, 0.04); kn.connect(lp); lp.connect(kg); kg.connect(out);
        thud(out, t, rnd(480, 600), amp * (0.3 + 0.3 * w));
        // the metal ringing: eight to eleven partials, each a little different in pitch and in how long it lasts
        const n = 8 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) {
            const f = clashPartial() * shift, a = rnd(0.5, 1) * (f < 3200 ? 0.6 : 1), d = ring * rnd(0.6, 0.95) * (f < 5000 ? 1.15 : 0.8);
            const o = mkOsc(), og = gain(0); o.type = 'sine'; o.frequency.value = f;
            env(og, t, 0.0008, amp * a * 0.5, d); o.connect(og); og.connect(out); o.start(t); o.stop(t + d + 0.1);
        }
        // a thin hiss of high noise that fades with the ring
        const z = burstSrc('white', t, ring * 0.5), bp = filt('bandpass', rnd(5000, 6500), 1.5), zg = gain(0);
        env(zg, t, 0.002, amp * 0.2, ring * 0.4); z.connect(bp); bp.connect(zg); zg.connect(out);
    }
    // a blade cutting the air: a short airy whoosh that swells and thins out as it passes
    function swordSwing(out, t, amp) {
        const dur = rnd(0.22, 0.34), s = burstSrc('white', t, dur, 0), bp = filt('bandpass', 900, 1.1), hp = filt('highpass', 400), g = gain(0);
        bp.frequency.setValueAtTime(rnd(500, 800), t); bp.frequency.exponentialRampToValueAtTime(rnd(3000, 4200), t + dur);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(amp * 3, t + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(bp); bp.connect(hp); hp.connect(g); g.connect(out);
    }
    // a blade leaving its scabbard: a rasping slide of crackling metal that climbs in pitch, ending in a short ring
    function swordDraw(out, t, amp) {
        const dur = 0.5, rasp = ctx.createBufferSource(), bp = filt('bandpass', 2500, 7), bp2 = filt('bandpass', 4000, 5), g = gain(0);
        rasp.buffer = bufs.dust; rasp.playbackRate.value = 9; rasp.start(t, rnd(0, 4), dur + 0.1); rasp.stop(t + dur + 0.1);
        bp.frequency.setValueAtTime(2200, t); bp.frequency.exponentialRampToValueAtTime(5200, t + dur);
        bp2.frequency.setValueAtTime(3600, t); bp2.frequency.exponentialRampToValueAtTime(8200, t + dur);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(amp * 2.2, t + 0.08); g.gain.linearRampToValueAtTime(amp * 1.8, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
        rasp.connect(bp); rasp.connect(bp2); bp.connect(g); bp2.connect(g); g.connect(out);
        metalRing(out, t + dur * 0.85, amp * 0.5, 900, 0.5);
    }
    // A shield dragged over stone or metal, from a real recording: one stroke lasts about a second, swelling in and fading out with a few surges
    // along the way. It is mostly a heavy low rumble (under 300 Hz), with a metal body of resonances at about 400, 600, 800 and 1000 Hz
    // that drift as the speed changes, a rough tremble of 10 to 18 times a second, and a faint rasp of high noise.
    function shieldScrape(out, t, amp, len) {
        const dur = len || rnd(0.8, 1.8), end = t + dur + 0.4, mix = gain(0);
        mix.gain.setValueAtTime(0.0001, t);
        mix.gain.linearRampToValueAtTime(amp, t + 0.15);
        mix.gain.setValueAtTime(amp * 0.8, t + dur * 0.5);
        mix.gain.exponentialRampToValueAtTime(0.0001, end);
        mix.connect(out);

        // Heavy body contact rumble
        const rb = burstSrc('brown', t, dur + 0.3, rnd(0, 2)), rl = filt('lowpass', 240), rg = gain(3.5);
        rb.connect(rl); rl.connect(rg); rg.connect(mix);

        // Stochastic stick-slip friction crackle (this is what was missing for realism)
        const dust = ctx.createBufferSource();
        dust.buffer = bufs.dust; dust.loop = true;
        dust.playbackRate.value = rnd(3.5, 6.0);
        dust.start(t, rnd(0, 3)); dust.stop(end);

        const df = filt('bandpass', 2800, 6), dg = gain(amp * 2.8);
        dust.connect(df); df.connect(dg); dg.connect(mix);

        // Shifting metallic plate body resonances
        const mb = burstSrc('pink', t, dur + 0.3, rnd(0, 2));
        [[420, 1.2], [750, 1.4], [1280, 0.9]].forEach(([f, a]) => {
            const bp = filt('bandpass', f, 5), bg = gain(a * 3);
            bp.frequency.setValueAtTime(f * rnd(0.9, 1.1), t);
            bp.frequency.linearRampToValueAtTime(f * rnd(0.75, 1.25), t + dur);
            mb.connect(bp); bp.connect(bg); bg.connect(mix);
        });
    }
    // a blow on a shield: a dull thud, a crack of wood and a little ring from the rim
    function shieldBlock(out, t, amp) {
        thud(out, t, rnd(110, 160), amp * 1.1);
        const s = burstSrc('pink', t, 0.06), bp = filt('bandpass', rnd(1000, 1500), 1.5), g = gain(0);
        env(g, t, 0.001, amp * 0.6, 0.05); s.connect(bp); bp.connect(g); g.connect(out);
        // the rim rings like a struck plate: uneven modes, the higher ones fading first
        modalResonator(out, t, amp * 0.55, rnd(330, 460), rnd(0.2, 0.34), FREE_BAR_MODES, 0.7);
    }
    // a heavy shove with the shield: a deep boom and splintering clatter
    function shieldBash(out, t, amp) {
        thud(out, t, 85, amp * 1.6); shieldBlock(out, t + 0.01, amp * 0.8);
        for (let i = 0; i < 4; i++) { const st = t + 0.05 + i * rnd(0.03, 0.07), s = burstSrc('white', st, 0.025), hp = filt('highpass', rnd(1800, 3200)), g = gain(0); env(g, st, 0.001, amp * rnd(0.15, 0.3), 0.02); s.connect(hp); hp.connect(g); g.connect(out); }
    }
    // Battle: two lines meeting. A far-off roar of men, with clashes, shield blows and swinging blades at random.
    function battle(out, r) {
        const P = r.P, wet = reverb(out, 1.8, 2.8, 0.5), dry = gain(0.9); dry.connect(out); dry.connect(wet);
        const roar = r.src(loopSrc('brown')), lp = filt('lowpass', 520), rg = gain(0.1);
        roar.connect(lp); lp.connect(rg); rg.connect(out);
        const swell = r.src(ctx.createOscillator()), sd = gain(0.04); swell.frequency.value = 0.11; swell.connect(sd); sd.connect(rg.gain); swell.start();
        r.every(() => swordClash(dry, ctx.currentTime, rnd(0.05, 0.12)), 450, 1700, () => geo(P.amount(), 4), true);
        r.every(() => shieldBlock(dry, ctx.currentTime, rnd(0.08, 0.18)), 900, 2800, () => geo(P.amount(), 3), true);
        r.every(() => swordSwing(dry, ctx.currentTime, rnd(0.06, 0.11)), 1200, 4200, () => geo(P.amount(), 3), true);
        r.every(() => shieldBash(dry, ctx.currentTime, rnd(0.1, 0.18)), 6000, 16000, () => geo(P.amount(), 3));
        r.every(() => shieldScrape(dry, ctx.currentTime, rnd(0.08, 0.14)), 7000, 20000, () => geo(P.amount(), 3));
    }

    // ---------- the list of sounds ----------
    // amount: what the sound-specific slider is called and where it starts (0 to 1)
    const SOUNDS = [
        { id: 'rain', group: 'n', name: 'Rain', note: 'Steady rain with individual drops', build: rain, amount: ['Intensity', 0.5] },
        { id: 'wind', group: 'n', name: 'Wind', note: 'Gusts that rise and fall', build: (o, r) => wind(o, r, false), amount: ['Gustiness', 0.5] },
        { id: 'thunder', group: 'n', name: 'Thunder', note: 'Cracks and long rolling rumbles', build: thunder, amount: ['Closeness', 0.5], length: true },
        { id: 'blizzard', group: 'n', name: 'Blizzard', note: 'Howling wind, a whistle and driven snow', build: blizzard, amount: ['Fury', 0.5] },
        { id: 'waves', group: 'n', name: 'Ocean waves', note: 'Slow swell and foam', build: (o, r) => waves(o, r, false), amount: ['Roughness', 0.5] },
        { id: 'stream', group: 'n', name: 'Stream', note: 'Running water with bubbles', build: stream, amount: ['Babble', 0.5] },
        { id: 'birds', group: 'n', name: 'Birdsong', note: 'Chirps and trills, daytime woods', build: birds, amount: ['Flock size', 0.5] },
        { id: 'crickets', group: 'n', name: 'Night crickets', note: 'Chirping in the dark', build: crickets, amount: ['Chorus', 0.85] },
        { id: 'frogs', group: 'n', name: 'Swamp', note: 'Frog croaks over crickets', build: frogs, amount: ['Chorus', 1] },
        { id: 'wolves', group: 'n', name: 'Wolves', note: 'Distant howls on the wind', build: wolves, amount: ['Pack size', 0.4] },
        { id: 'fire', group: 'p', name: 'Campfire', note: 'Roar, crackle and the odd pop', build: fire, amount: ['Heat', 0.5] },
        { id: 'cave', group: 'p', name: 'Cave', note: 'Low drone and echoing drips', build: cave, amount: ['Echo', 0.5] },
        { id: 'tavern', group: 'p', name: 'Tavern crowd', note: 'A real busy bar: chatter, laughter and clinks', build: tavern, amount: ['Rowdiness', 0.5], crowd: true },
        { id: 'ship', group: 'p', name: 'Ship at sea', note: 'Swell, creaking timber and rigging wind', build: ship, amount: ['Creaking', 0.5] },
        { id: 'magic', group: 'p', name: 'Magic hum', note: 'A glowing drone with sparkles', build: magic, amount: ['Sparkle', 0.5] },
        { id: 'bell', group: 'p', name: 'Distant bell', note: 'A slow toll across the town', build: bell, amount: ['Tolls', 0.3] },
        { id: 'battle', group: 'p', name: 'Battle', note: 'Sword clashes, shield blows and a far-off roar', build: battle, amount: ['Ferocity', 0.5] },
        { id: 'lute', group: 'm', name: 'Lute melody', note: 'A slow plucked tune in D dorian', build: lute, amount: ['Busyness', 0.5] },
        { id: 'pad', group: 'm', name: 'Ambient pad', note: 'Slow drifting chords, Am F C G', build: pad, amount: ['Brightness', 0.5] },
        { id: 'musicbox', group: 'm', name: 'Music box', note: 'Soft high notes with a long tail', build: musicbox, amount: ['Density', 0.5] },
        { id: 'boss', group: 'm', name: 'Boss fight', note: 'Driving drums, bass and brass in D minor, 150 BPM', build: boss, amount: ['Intensity', 0.75] }
    ];

    // ---------- the settings every sound has ----------
    const PROPS = {
        level: { label: 'Volume', min: 0, max: 100, scale: 100, fmt: v => v + '%' },
        speed: { label: 'Tempo', min: 40, max: 250, scale: 100, fmt: v => (v / 100).toFixed(1) + 'x' },
        pitch: { label: 'Pitch', min: -12, max: 12, scale: 1, fmt: v => (v > 0 ? '+' : '') + v + ' st' },
        tone: { label: 'Tone', min: -100, max: 100, scale: 100, fmt: v => (v === 0 ? 'neutral' : (v > 0 ? 'bright ' : 'dull ') + Math.abs(v)) },
        dist: { label: 'Distance', min: 0, max: 100, scale: 100, fmt: v => (v < 5 ? 'close' : v + '%') },
        pan: { label: 'Pan', min: -100, max: 100, scale: 100, fmt: v => (v === 0 ? 'centre' : (v < 0 ? 'L ' : 'R ') + Math.abs(v)) },
        amount: { label: 'Amount', min: 0, max: 100, scale: 100, fmt: v => v + '%' },
        reg: { label: 'Regularity', min: 0, max: 100, scale: 100, fmt: v => v + '%' },
        crowd: { label: 'Crowd', min: 2, max: 14, scale: 1, fmt: v => v + '' },
        len: { label: 'Length', min: 50, max: 200, scale: 100, fmt: v => (v / 100).toFixed(1) + 'x' }
    };
    const KEYS = ['level', 'speed', 'pitch', 'tone', 'dist', 'pan', 'amount', 'reg', 'crowd', 'len'];
    const DEFAULTS = { level: 0.7, speed: 1, pitch: 0, tone: 0, dist: 0, pan: 0, reg: 0, crowd: 8, len: 1 };
    const state = {};
    const soloOn = () => Object.keys(state).some(id => state[id].solo);

    // each sound plays through: its Tone filters, its Distance (dulling plus echo), its Pan, then its Volume
    function rawGain(v) { const g = ctx.createGain(); g.gain.value = v; return g; }
    function makeChain(dest) {
        const c = {}, ls = rawFilt('lowshelf', 250), hs = rawFilt('highshelf', 3000), lp1 = rawFilt('lowpass', 20000), lp2 = rawFilt('lowpass', 20000);
        const dry = rawGain(1), wet = rawGain(0), conv = ctx.createConvolver(), pn = ctx.createStereoPanner ? ctx.createStereoPanner() : null, last = pn || rawGain(1);
        conv.buffer = impulse(2.4, 2.4);
        c.inp = rawGain(1);
        c.inp.connect(ls); ls.connect(hs); hs.connect(lp1); lp1.connect(lp2); lp2.connect(dry); dry.connect(last); last.connect(dest);
        let wetOn = false; c.dist = 0;
        c.setTone = t => { const now = ctx.currentTime; lp1.frequency.setTargetAtTime(t < 0 ? 20000 * Math.pow(0.02, -t) : 20000, now, 0.05); hs.gain.setTargetAtTime(t * 10, now, 0.05); ls.gain.setTargetAtTime(t > 0 ? -6 * t : 0, now, 0.05); };
        c.setDist = d => {
            const now = ctx.currentTime; c.dist = d;
            lp2.frequency.setTargetAtTime(20000 * Math.pow(0.08, d), now, 0.05); dry.gain.setTargetAtTime(1 - 0.7 * d, now, 0.05); wet.gain.setTargetAtTime(1.3 * d, now, 0.05);
            if (d > 0.01 && !wetOn) { lp2.connect(conv); conv.connect(wet); wet.connect(last); wetOn = true; }
            else if (d <= 0.01 && wetOn) setTimeout(() => { if (c.dist <= 0.01 && wetOn) { try { lp2.disconnect(conv); } catch (e) { /* gone */ } wetOn = false; } }, 500);
        };
        c.setPan = p => { if (pn) pn.pan.setTargetAtTime(p, ctx.currentTime, 0.05); };
        return c;
    }
    function applyLevel(s) {
        if (!s.vol) return;
        const audible = !s.muted && (!soloOn() || s.solo);
        s.vol.gain.setTargetAtTime(audible ? s.level * s.level : 0, ctx.currentTime, 0.06);
    }
    const applyAllLevels = () => Object.keys(state).forEach(id => applyLevel(state[id]));
    function ensureChain(s) {
        if (s.vol) return;
        s.vol = rawGain(0); s.vol.connect(master);
        s.chain = makeChain(s.vol);
        s.chain.setTone(s.tone); s.chain.setDist(s.dist); s.chain.setPan(s.pan);
        applyLevel(s);
    }
    // change one setting of a sound (from a slider, a mix, the morph or Drift)
    function setProp(s, k, v, how) {
        how = how || {};
        s[k] = v;
        if (!how.fromUI && s.rows[k]) s.rows[k].set(Math.round(v * PROPS[k].scale));
        if (how.user) { s.base[k] = v; storeSound(s); }
        if (!ctx || !s.vol) return;
        if (k === 'level') applyLevel(s);
        else if (k === 'speed' || k === 'amount' || k === 'reg' || k === 'crowd') { if (s.rig) s.rig.speedHooks.forEach(f => f()); }
        else if (k === 'pitch') { if (s.rig) s.rig.setPitch(); }
        else if (k === 'tone') s.chain.setTone(v);
        else if (k === 'dist') s.chain.setDist(v);
        else if (k === 'pan') s.chain.setPan(v);
    }
    function start(id, secs) {
        ensure();
        const s = state[id]; if (!s || s.on) return;
        ensureChain(s);
        const fade = gain(0.0001); fade.connect(s.chain.inp); s.fade = fade;
        const rig = Rig({ speed: () => s.speed, pitch: () => s.pitch, amount: () => s.amount, regularity: () => s.reg, param: () => s.crowd, len: () => s.len });
        s.rig = rig; rig.building = true; activeRig = rig;
        try { s.def.build(fade, rig); rig.speedHooks.forEach(f => f()); } finally { rig.building = false; activeRig = null; }
        fade.gain.setTargetAtTime(1, ctx.currentTime, (secs || S.fade) / 4);
        s.on = true; s.card.classList.add('playing'); s.btn.classList.add('on'); s.btn.textContent = 'Stop'; notify();
    }
    function stop(id, secs) {
        const s = state[id]; if (!s || !s.on) return;
        s.on = false; s.card.classList.remove('playing'); s.btn.classList.remove('on'); s.btn.textContent = 'Play'; notify();
        const rig = s.rig, fade = s.fade, t = secs || S.fade;
        fade.gain.setTargetAtTime(0.0001, ctx.currentTime, t / 4);
        setTimeout(() => { rig.stop(); fade.disconnect(); }, t * 1000 * 1.4 + 300);
    }
    const stopAll = secs => Object.keys(state).forEach(id => stop(id, secs));

    // ---------- one-shots ----------
    const ST = { vol: 0.8, pitch: 0, dist: 0, len: 1 };
    let stChain = null, stBus = null, stRv = null;
    const stRig = { P: { pitch: () => ST.pitch }, building: false, live: new Set() };
    function stingerBus() {
        ensure();
        if (!stChain) {
            stBus = rawGain(ST.vol * ST.vol); stBus.connect(master);
            stChain = makeChain(stBus); stChain.setDist(ST.dist);
            stRv = ctx.createConvolver(); stRv.buffer = impulse(2.2, 2.6); const w = rawGain(0.4); stRv.connect(w); w.connect(stChain.inp);
        }
        const bus = rawGain(1); bus.connect(stChain.inp); bus.connect(stRv);
        return bus;
    }
    const STINGERS = [
        ['Thunder clap', (b, t) => thunderStrike(b, t, rnd(0.55, 0.95), ST.len)],
        ['Bell toll', (b, t) => { const base = rnd(170, 260); bellToll(b, null, t, base); }],
        ['Wolf howl', (b, t) => howlTone(b, t, rnd(330, 430), rnd(2.8, 4), 0.14)],
        ['Owl hoot', (b, t) => { const f = rnd(330, 420), n = pick([2, 3]); for (let i = 0; i < n; i++) { const o = mkOsc(), g = gain(0), s = t + i * 0.55; o.type = 'sine'; o.frequency.setValueAtTime(f * 1.08, s); o.frequency.exponentialRampToValueAtTime(f * 0.92, s + 0.32); env(g, s, 0.06, 0.16, 0.3); o.connect(g); g.connect(b); o.start(s); o.stop(s + 0.5); } }],
        ['Door knock', (b, t) => { const n = pick([3, 3, 4]); for (let i = 0; i < n; i++) thud(b, t + i * rnd(0.2, 0.3), 170, 0.32); }],
        ['Footsteps', (b, t) => { for (let i = 0; i < 7; i++) { const s = t + i * rnd(0.42, 0.52), tk = burstSrc('white', s, 0.02), hp = filt('highpass', 1800), g = gain(0); env(g, s, 0.001, 0.06, 0.02); tk.connect(hp); hp.connect(g); g.connect(b); thud(b, s, 120, 0.2); } }],
        ['Glass breaks', (b, t) => { const s = burstSrc('white', t, 0.3), hp = filt('highpass', 3000), g = gain(0); env(g, t, 0.001, 0.4, 0.22); s.connect(hp); hp.connect(g); g.connect(b); for (let i = 0; i < 16; i++) { const o = mkOsc(), pg = gain(0), st = t + rnd(0, 0.6); o.type = 'sine'; o.frequency.value = rnd(2500, 8500); env(pg, st, 0.001, rnd(0.03, 0.09), rnd(0.05, 0.3)); o.connect(pg); pg.connect(b); o.start(st); o.stop(st + 0.4); } }],
        ['Laughter', (b, t) => laughBurst(b, t)],
        ['Creak', (b, t) => creakOnce(b, null, t, 1.8)],
        ['Sword clash', (b, t) => swordClash(b, t, rnd(0.14, 0.2))],
        ['Light clink', (b, t) => swordClash(b, t, 0.14, 0)],
        ['Heavy clang', (b, t) => swordClash(b, t, 0.2, 1)],
        ['Sword swing', (b, t) => swordSwing(b, t, 0.12)],
        ['Sword drawn', (b, t) => swordDraw(b, t, 0.14)],
        ['Shield block', (b, t) => shieldBlock(b, t, rnd(0.2, 0.3))],
        ['Shield bash', (b, t) => shieldBash(b, t, 0.26)],
        ['Shield scrape', (b, t) => shieldScrape(b, t, 0.3)],
        ['Steel plate ring', (b, t) => modalResonator(b, t, 0.3, rnd(250, 420), 1.4, FREE_BAR_MODES, 0.5)],
        ['Duel flurry', (b, t) => { let s = t; for (let i = 0; i < 7; i++) { if (Math.random() < 0.7) swordClash(b, s, rnd(0.1, 0.18)); else shieldBlock(b, s, rnd(0.15, 0.25)); if (Math.random() < 0.5) swordSwing(b, s - 0.25, 0.1); s += rnd(0.22, 0.5); } }]
    ];
    function fireStinger(fn) {
        const bus = stingerBus();
        activeRig = stRig;
        try { fn(bus, ctx.currentTime + 0.02); } finally { activeRig = null; }
    }

    // mixes: { soundId: { level, speed, ... } }; the built-in ones only name what differs from the defaults
    const BUILTIN = {
        'Rainy tavern': { rain: { level: 0.4 }, tavern: { level: 0.7 }, fire: { level: 0.3 } },
        'Camp at night': { fire: { level: 0.7 }, crickets: { level: 0.5 }, wind: { level: 0.2 }, wolves: { level: 0.35, dist: 0.6 } },
        'Thunderstorm': { rain: { level: 0.7, speed: 1.8, amount: 0.7 }, wind: { level: 0.4, speed: 1.2 }, thunder: { level: 0.8 } },
        'Storm at sea': { rain: { level: 0.6, speed: 1.8 }, thunder: { level: 0.7, amount: 0.4 }, wind: { level: 0.3, speed: 1.2 }, waves: { level: 0.5, speed: 1.3, amount: 0.7 }, ship: { level: 0.6, speed: 1.3 } },
        'Deep cave': { cave: { level: 0.8 }, wind: { level: 0.15 } },
        'Forest morning': { birds: { level: 0.7 }, stream: { level: 0.4 }, wind: { level: 0.15, speed: 0.7 } },
        'Haunted swamp': { frogs: { level: 0.7 }, bell: { level: 0.4, dist: 0.5 }, wind: { level: 0.15, speed: 0.6 } },
        'Frozen pass': { blizzard: { level: 0.7 }, wolves: { level: 0.5, dist: 0.4 } },
        'Wizard tower': { magic: { level: 0.7 }, wind: { level: 0.12, speed: 0.6 }, cave: { level: 0.2 } },
        'Tavern evening': { tavern: { level: 0.65 }, fire: { level: 0.3 }, lute: { level: 0.4, dist: 0.3 } },
        'Lost in the fog': { pad: { level: 0.5, amount: 0.3 }, wind: { level: 0.25, speed: 0.6 }, bell: { level: 0.3, dist: 0.7 } },
        'Boss fight': { boss: { level: 0.8, amount: 0.75 }, thunder: { level: 0.25, dist: 0.3 } },
        'Battlefield': { battle: { level: 0.8, amount: 0.75 }, wind: { level: 0.22, speed: 1.1 }, wolves: { level: 0.15, dist: 0.7 } },
        'Duel': { battle: { level: 0.7, amount: 0.3 }, wind: { level: 0.15, speed: 0.7 }, fire: { level: 0.15 } },
        'Final boss': { boss: { level: 0.85, speed: 1.15, amount: 1, dist: 0.15 }, thunder: { level: 0.45 }, rain: { level: 0.3, speed: 1.6 }, wind: { level: 0.25, speed: 1.3 } }
    };
    const saved = {};
    const allMixes = () => Object.assign({}, BUILTIN, saved);
    // a full description of a mix entry, filling in defaults
    function full(id, part) { const s = state[id]; const base = {}; KEYS.forEach(k => { base[k] = (k === 'amount' && s.def.amount) ? s.def.amount[1] : (k in DEFAULTS ? DEFAULTS[k] : 0.5); }); return Object.assign(base, part || {}); }
    function applyMix(mix) {
        ensure();
        Object.keys(state).forEach(id => { if (!(id in mix) && !state[id].def.own) stop(id); });
        Object.keys(mix).forEach(id => {
            const s = state[id]; if (!s) return;
            const f = full(id, mix[id]); KEYS.forEach(k => setProp(s, k, f[k], { user: true })); start(id);
        });
    }
    function renderMixes() {
        const pre = $q('presets'); pre.innerHTML = '';
        Object.keys(BUILTIN).forEach(name => { const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.onclick = () => applyMix(BUILTIN[name]); pre.appendChild(b); });
        ['morphA', 'morphB'].forEach((id, i) => {
            const sel = $q(id), cur = sel.value, want = cur || (i === 0 ? 'Forest morning' : 'Thunderstorm'); sel.innerHTML = '';
            const none = document.createElement('option'); none.value = ''; none.textContent = 'silence'; sel.appendChild(none);
            Object.keys(allMixes()).forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
            sel.value = want; if (sel.value !== want) sel.value = '';
        });
    }

    // morph: blend two mixes; a sound present in one only fades in or out
    function morph(t) {
        ensure();
        const A = allMixes()[$q('morphA').value] || {}, B = allMixes()[$q('morphB').value] || {};
        const ids = new Set(Object.keys(A).concat(Object.keys(B)));
        Object.keys(state).forEach(id => { if (!ids.has(id) && !state[id].def.own && state[id].on) stop(id); });
        ids.forEach(id => {
            const s = state[id]; if (!s) return;
            const a = A[id] ? full(id, A[id]) : null, b = B[id] ? full(id, B[id]) : null;
            const la = a ? a.level : 0, lb = b ? b.level : 0, level = la * (1 - t) + lb * t;
            KEYS.forEach(k => { if (k === 'level') return; const v = a && b ? a[k] * (1 - t) + b[k] * t : (a || b)[k]; setProp(s, k, v, {}); });
            setProp(s, 'level', level, {});
            if (!s.on && level > 0.06) start(id);
            else if (s.on && level < 0.02) stop(id);
        });
        $q('morphStatus').textContent = Math.round(t * 100) + '% of the way to ' + ($q('morphB').value || 'silence');
    }

    // drift: playing sounds wander a little around where you set them
    let driftTimer = null;
    function driftStep() {
        Object.keys(state).forEach(id => {
            const s = state[id]; if (!s.on) return;
            const b = s.base;
            setProp(s, 'level', clamp(b.level * rnd(0.82, 1.15), 0, 1));
            setProp(s, 'speed', clamp(b.speed * rnd(0.88, 1.12), 0.4, 2.5));
            setProp(s, 'tone', clamp(b.tone + rnd(-0.2, 0.2), -1, 1));
            setProp(s, 'amount', clamp(b.amount + rnd(-0.14, 0.14), 0, 1));
        });
    }
    function setDrift(on) {
        clearInterval(driftTimer); driftTimer = null;
        const btn = $q('driftBtn');
        btn.classList.toggle('on', on); btn.textContent = 'Drift: ' + (on ? 'on' : 'off');
        if (on) { Object.keys(state).forEach(id => KEYS.forEach(k => { state[id].base[k] = state[id][k]; })); driftTimer = setInterval(driftStep, 6500); }
        else Object.keys(state).forEach(id => { const s = state[id]; ['level', 'speed', 'tone', 'amount'].forEach(k => setProp(s, k, s.base[k])); });
    }

    // fade-everything-out timer
    let sleepTimer = null, sleepEnd = 0;
    function setSleep(min) {
        clearInterval(sleepTimer); sleepTimer = null;
        const label = $q('sleepLeft'); label.textContent = '';
        if (!min) return;
        sleepEnd = Date.now() + min * 60000;
        sleepTimer = setInterval(() => {
            const left = sleepEnd - Date.now();
            if (left <= 0) { clearInterval(sleepTimer); sleepTimer = null; label.textContent = ''; $q('sleepSel').value = '0'; stopAll(Math.max(S.fade, 8)); return; }
            const m = Math.floor(left / 60000), sec = Math.floor((left % 60000) / 1000);
            label.textContent = m + ':' + String(sec).padStart(2, '0') + ' left';
        }, 500);
    }
    function setHush(on) {
        S.hushed = on; $q('hush').classList.toggle('on', on); $q('hush').textContent = on ? 'Resume' : 'Hush';
        if (hush) hush.gain.setTargetAtTime(on ? 0.15 : 1, ctx.currentTime, 0.15);
    }


    // ---------- the panel ----------
    function slider(label, min, max, value, fmt, onInput) {
        const row = document.createElement('div'); row.className = 'amb-ctl';
        row.innerHTML = '<span></span><input type="range" min="' + min + '" max="' + max + '" value="' + value + '"><output></output>';
        row.querySelector('span').textContent = label;
        const inp = row.querySelector('input'), out = row.querySelector('output');
        out.textContent = fmt(value);
        inp.setAttribute('aria-label', label);
        inp.oninput = () => { out.textContent = fmt(+inp.value); onInput(+inp.value); };
        row.set = v => { inp.value = v; out.textContent = fmt(v); };
        return row;
    }
    function makeCard(def) {
        const card = document.createElement('div'); card.className = 'amb-card';
        card.innerHTML = '<div class="amb-top"><div><b></b><small></small></div><div class="amb-btns"></div></div>';
        card.querySelector('b').textContent = def.name; card.querySelector('small').textContent = def.note;
        $q('grid-' + def.group).appendChild(card);
        const sv = settings.sounds[def.id] || {}, own = {};
        KEYS.forEach(k => { const v = k === 'crowd' && typeof sv.crowd !== 'number' && typeof sv.extra === 'number' ? sv.extra : sv[k]; if (typeof v === 'number' && isFinite(v) && v >= PROPS[k].min / PROPS[k].scale - 1e-6 && v <= PROPS[k].max / PROPS[k].scale + 1e-6) own[k] = v; });
        const s = state[def.id] = Object.assign({ def, on: false, card, vol: null, muted: false, solo: false, rows: {}, base: {} }, DEFAULTS, { amount: def.amount ? def.amount[1] : 0.5 }, own);
        KEYS.forEach(k => { s.base[k] = s[k]; });
        const btns = card.querySelector('.amb-btns');
        const mk = (text, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.title = title; b.onclick = fn; btns.appendChild(b); return b; };
        const muteB = mk('M', 'Mute this sound', () => { s.muted = !s.muted; muteB.classList.toggle('on', s.muted); applyAllLevels(); });
        const soloB = mk('S', 'Solo: hear only the soloed sounds', () => { s.solo = !s.solo; soloB.classList.toggle('on', s.solo); applyAllLevels(); });
        s.btn = mk('Play', '', () => { ensure(); s.on ? stop(def.id) : start(def.id); });
        const addRow = (k, label) => {
            const P = PROPS[k];
            const row = slider(label || P.label, P.min, P.max, Math.round(s[k] * P.scale), P.fmt, v => setProp(s, k, v / P.scale, { fromUI: true, user: true }));
            s.rows[k] = row; return row;
        };
        ['level', 'speed', 'pitch'].forEach(k => card.appendChild(addRow(k)));
        const more = document.createElement('details'), inner = document.createElement('div'); inner.className = 'amb-more';
        more.innerHTML = '<summary>More</summary>'; more.appendChild(inner); card.appendChild(more);
        ['tone', 'dist', 'pan'].forEach(k => inner.appendChild(addRow(k)));
        if (def.amount) inner.appendChild(addRow('amount', def.amount[0]));
        inner.appendChild(addRow('reg'));
        if (def.crowd) inner.appendChild(addRow('crowd'));
        if (def.length) inner.appendChild(addRow('len'));
    }
    const CSS = `
.amb { --bg:#fff; --card:#f6f6fb; --line:#d8d8e4; --ink:#2a2a3e; --dim:#6c6c80; --acc:#4a4ba2; --accInk:#fff; --warn:#c0392b; color:var(--ink); font-size:13.5px; }
body.dark-mode .amb { --bg:#2a2a3e; --card:#1e1e2e; --line:#4a4a5e; --ink:#e0e0e0; --dim:#9a9ab4; --acc:#8b9bf5; --accInk:#161628; --warn:#e0675a; }
.amb button { font:inherit; color:var(--ink); background:var(--card); border:1px solid var(--line); border-radius:6px; padding:5px 11px; cursor:pointer; }
.amb button:hover { border-color:var(--acc); }
.amb button:focus-visible, .amb input:focus-visible, .amb select:focus-visible, .amb summary:focus-visible { outline:2px solid var(--acc); outline-offset:2px; }
.amb button.on { background:var(--acc); color:var(--accInk); border-color:var(--acc); font-weight:600; }
.amb button.warn.on { background:var(--warn); border-color:var(--warn); color:#fff; }
.amb button.sm { padding:2px 8px; font-size:12px; }
.amb select, .amb input[type=text] { font:inherit; color:var(--ink); background:var(--card); border:1px solid var(--line); border-radius:6px; padding:4px 7px; max-width:100%; }
.amb input[type=text] { width:150px; }
.amb-bar { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:0 0 8px; }
.amb-bar label, .amb-bar .lab { color:var(--dim); font-size:12.5px; }
.amb-bar input[type=range] { width:120px; }
.amb-pair { display:inline-flex; align-items:center; gap:6px; white-space:nowrap; }
.amb-pair output { color:var(--dim); font-size:12px; min-width:34px; }
.amb-h { font-size:11.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--dim); font-weight:600; margin:14px 0 6px; }
.amb-status { color:var(--dim); font-size:12px; }
.amb-chip { display:inline-flex; align-items:center; gap:2px; }
.amb-chip button.x { padding:5px 7px; color:var(--dim); }
.amb-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:8px; }
.amb-card { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:10px; display:flex; flex-direction:column; gap:6px; }
.amb-card.playing { border-color:var(--acc); }
.amb-top { display:flex; gap:8px; align-items:flex-start; justify-content:space-between; }
.amb-top b { font-size:14px; display:block; }
.amb-top small { color:var(--dim); display:block; line-height:1.3; }
.amb-btns { display:flex; gap:4px; flex-shrink:0; }
.amb-btns button { padding:4px 9px; }
.amb-ctl { display:grid; grid-template-columns:62px 1fr 46px; gap:6px; align-items:center; font-size:12px; color:var(--dim); }
.amb-ctl input[type=range] { width:100%; margin:0; }
.amb-ctl output { text-align:right; font-variant-numeric:tabular-nums; }
.amb details > summary { cursor:pointer; color:var(--dim); font-size:12px; margin:2px 0 4px; }
.amb details[open] > summary { color:var(--ink); }
.amb-more { display:flex; flex-direction:column; gap:6px; }
.amb .sr { position:absolute; left:-9999px; }
.amb-note { background:var(--card); border:1px dashed var(--acc); border-radius:8px; padding:7px 10px; margin:0 0 10px; font-size:12px; line-height:1.4; color:var(--dim); }
.amb-note b { color:var(--ink); }
.amb-box { background:var(--card); border:1px solid var(--line); border-radius:8px; margin:0 0 8px; }
.amb-box > summary { cursor:pointer; padding:8px 12px; font-size:11.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--dim); font-weight:600; margin:0; }
.amb-box[open] > summary { color:var(--ink); border-bottom:1px solid var(--line); }
.amb-boxbody { padding:10px 12px 4px; }
`;
    // the page above the sounds: master, hush, timers, mixes, morph and the one-shots
    const TEMPLATE = '<div class="amb-note"><b>Experimental, in beta testing.</b> The sounds are still being tuned. They may differ from the result you want, and may not reflect the final result.</div>' +
        '<div class="amb-bar"><span class="amb-pair"><label>Master volume</label><input type="range" min="0" max="100" data-id="master" aria-label="Master volume"></span>' +
        '<button type="button" data-id="hush" title="Dips everything so you can talk">Hush</button><button type="button" data-id="stopAll">Stop everything</button></div>' +
        '<div class="amb-bar"><span class="amb-pair"><label>Fade time</label><input type="range" min="3" max="200" data-id="fadeTime" aria-label="Fade time"><output data-id="fadeOut"></output></span>' +
        '<span class="lab">Fade everything out in</span><select data-id="sleepSel" aria-label="Fade out timer"><option value="0">off</option><option value="1">1 minute</option><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="20">20 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option></select><span class="lab" data-id="sleepLeft"></span></div>' +
        '<div class="amb-bar"><button type="button" data-id="driftBtn" title="Playing sounds slowly vary their own settings so a long scene never repeats exactly">Drift: off</button><button type="button" data-id="surprise" title="A random mix of a few sounds">Surprise me</button></div>' +
        '<details class="amb-box" data-id="box-mixes"><summary>Mixes</summary><div class="amb-boxbody"><div class="amb-bar" data-id="presets"></div>' +
        '<div class="amb-bar"><span class="lab">Morph</span><select data-id="morphA" aria-label="Morph from"></select><input type="range" min="0" max="100" value="0" data-id="morph" style="width:150px" aria-label="Morph between the two mixes"><select data-id="morphB" aria-label="Morph to"></select></div><div class="amb-status" data-id="morphStatus">Slide to blend from one mix to the other.</div></div></details>' +
        '<details class="amb-box" data-id="box-oneshots"><summary>One-shots</summary><div class="amb-boxbody"><div class="amb-bar" data-id="stingers"></div>' +
        '<div class="amb-bar"><span class="amb-pair"><label>Volume</label><input type="range" min="0" max="100" value="80" data-id="stVol" aria-label="One-shot volume"></span>' +
        '<span class="amb-pair"><label>Pitch</label><input type="range" min="-12" max="12" value="0" data-id="stPitch" aria-label="One-shot pitch"><output data-id="stPitchOut">0 st</output></span>' +
        '<span class="amb-pair"><label>Distance</label><input type="range" min="0" max="100" value="0" data-id="stDist" aria-label="One-shot distance"></span>' +
        '<span class="amb-pair"><label>Length</label><input type="range" min="50" max="200" value="100" data-id="stLen" aria-label="One-shot length"><output data-id="stLenOut">1.0x</output></span></div></div></details>' +
        '<div class="amb-h">Weather and nature</div><div class="amb-grid" data-id="grid-n"></div>' +
        '<div class="amb-h">Places and magic</div><div class="amb-grid" data-id="grid-p"></div>' +
        '<div class="amb-h">Music (experimental)</div><div class="amb-grid" data-id="grid-m"></div>';
    let mounted = false;
    function mount(el) {
        if (mounted || !el) return;
        mounted = true;
        if (!document.getElementById('amb-css')) { const st = document.createElement('style'); st.id = 'amb-css'; st.textContent = CSS; document.head.appendChild(st); }
        panel = document.createElement('div'); panel.className = 'amb'; panel.innerHTML = TEMPLATE; el.appendChild(panel);
        ['mixes', 'oneshots'].forEach(k => { const box = $q('box-' + k); box.open = !!(settings.boxes && settings.boxes[k]); box.ontoggle = () => { settings.boxes = Object.assign({}, settings.boxes, { [k]: box.open }); save(); }; });
        SOUNDS.forEach(makeCard);
        renderMixes();
        STINGERS.forEach(([name, fn]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.className = 'sm'; b.onclick = () => fireStinger(fn); $q('stingers').appendChild(b); });
        $q('stVol').oninput = e => { ST.vol = e.target.value / 100; if (stBus) stBus.gain.setTargetAtTime(ST.vol * ST.vol, ctx.currentTime, 0.05); };
        $q('stPitch').oninput = e => { ST.pitch = +e.target.value; $q('stPitchOut').textContent = (ST.pitch > 0 ? '+' : '') + ST.pitch + ' st'; };
        $q('stDist').oninput = e => { ST.dist = e.target.value / 100; if (stChain) stChain.setDist(ST.dist); };
        $q('stLen').oninput = e => { ST.len = e.target.value / 100; $q('stLenOut').textContent = ST.len.toFixed(1) + 'x'; };
        const masterIn = $q('master'); masterIn.value = Math.round(settings.master * 100);
        masterIn.oninput = () => { S.master = masterIn.value / 100; settings.master = S.master; save(); if (master) master.gain.setTargetAtTime(S.master * S.master, ctx.currentTime, 0.05); };
        const fadeIn = $q('fadeTime'); fadeIn.value = Math.round(S.fade * 10); $q('fadeOut').textContent = S.fade.toFixed(1) + ' s';
        fadeIn.oninput = () => { S.fade = fadeIn.value / 10; settings.fade = S.fade; save(); $q('fadeOut').textContent = S.fade.toFixed(1) + ' s'; };
        $q('stopAll').onclick = () => stopAll();
        $q('hush').onclick = () => { ensure(); setHush(!S.hushed); };
        $q('sleepSel').onchange = e => setSleep(+e.target.value);
        $q('driftBtn').onclick = () => setDrift(!driftTimer);
        $q('surprise').onclick = () => {
            const pool = SOUNDS.filter(d => d.group !== 'm'), n = 2 + Math.floor(Math.random() * 3), chosen = {};
            while (Object.keys(chosen).length < n) { const d = pick(pool); chosen[d.id] = { level: rnd(0.35, 0.8), speed: rnd(0.75, 1.4), amount: rnd(0.3, 0.75), dist: Math.random() < 0.35 ? rnd(0.2, 0.6) : 0, pan: rnd(-0.5, 0.5) }; }
            applyMix(chosen);
        };
        ['morph', 'morphA', 'morphB'].forEach(id => { $q(id).oninput = () => morph($q('morph').value / 100); });
    }
    root.Ambience = {
        mount,
        onPlaying: fn => { onPlayingCb = fn; },
        stopAll: () => stopAll()
    };
})(window);
