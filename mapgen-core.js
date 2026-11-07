// Map generator core (seed -> layout), shared by the standalone page (mapgen.html) and the DM Map tab's Generator
// toolbox (dm.html). Pure: no page, canvas or storage in here — a settings object in, a map layout out.
(function (root) {
'use strict';

// ===================== Seeded RNG =====================
// Standard, widely-used public-domain hash+PRNG pair (xmur3 seed hash into
// mulberry32) — a string seed always produces the exact same sequence, so
// "same seed + same settings = same map" holds across sessions/browsers.
function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return function () {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return h >>> 0;
    };
}
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function makeRng(seedStr) { return mulberry32(xmur3(String(seedStr))()); }
// Fast deterministic per-cell hash for decorative texture (tree/rock
// glyph jitter) — independent of the sequential rng so it doesn't shift
// every other draw when only a texture tweak changes.
function cellHash(x, y, salt) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ salt;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

// Scans one straight run of cells along a room's own wall (top row,
// bottom row, left column, or right column) and turns AT MOST ONE cell
// per contiguous stretch of floor into a door, at that stretch's midpoint
// — never a whole run of them. Without this, a wide gap where a corridor
// meets a room let every ring cell in the gap roll independently, so 2-3
// adjacent cells could each become their own door — a doorway is one
// door, not a row of them (confirmed live on seed "b7ui2").
function placeDoorsAlongRun(grid, cols, rows, cells, rng, isBlocked) {
    // isBlocked (optional) marks a ring cell as "not a valid gap here" without
    // it needing to actually be a wall cell — used so a ring cell that's really
    // another room's own floor (two rooms sitting flush against each other)
    // doesn't get treated as an open run belonging to THIS room. Passed as a
    // predicate rather than pre-filtering the cells array so index-adjacency
    // (which this run-detection relies on) still matches real grid-adjacency.
    const isFloor = ([x, y]) => x >= 0 && y >= 0 && x < cols && y < rows && grid[y][x] === 'floor' && !(isBlocked && isBlocked(x, y));
    let i = 0;
    while (i < cells.length) {
        if (!isFloor(cells[i])) { i++; continue; }
        let j = i;
        while (j < cells.length && isFloor(cells[j])) j++;
        if (rng() < 0.4) {
            const mid = cells[i + Math.floor((j - i) / 2)];
            grid[mid[1]][mid[0]] = 'door';
        }
        i = j;
    }
}

// ===================== Dungeon (BSP rooms + corridors) =====================
function generateDungeon(rng, cols, rows, opts) {
    const grid = Array.from({ length: rows }, () => Array(cols).fill('wall'));
    const rooms = [];
    // Interior partition walls (two rooms sitting flush against each other)
    // are edges, not cells — same model dm.html's Map Builder uses. Only
    // BACKGROUND rock (never carved to floor at all) stays a whole-cell
    // 'wall'; that's real "unexcavated stone," not a partition, and the
    // existing floor/rock boundary trace (drawWallOutline) already draws a
    // clean line along it with no extra bookkeeping needed. See the
    // merge-prevention pass below for where these get populated.
    const edgeWalls = new Set();
    const edgeDoors = new Set();

    function Leaf(x, y, w, h) { this.x = x; this.y = y; this.w = w; this.h = h; this.left = null; this.right = null; this.room = null; }
    Leaf.prototype.split = function (minLeaf) {
        if (this.left || this.right) return false;
        let splitH = rng() < 0.5;
        if (this.w > this.h && this.w / this.h >= 1.25) splitH = false;
        else if (this.h > this.w && this.h / this.w >= 1.25) splitH = true;
        const size = splitH ? this.h : this.w;
        if (size - minLeaf <= minLeaf) return false;
        const split = minLeaf + Math.floor(rng() * (size - minLeaf * 2));
        if (splitH) {
            this.left = new Leaf(this.x, this.y, this.w, split);
            this.right = new Leaf(this.x, this.y + split, this.w, this.h - split);
        } else {
            this.left = new Leaf(this.x, this.y, split, this.h);
            this.right = new Leaf(this.x + split, this.y, this.w - split, this.h);
        }
        return true;
    };

    const root = new Leaf(1, 1, cols - 2, rows - 2);
    // Guarantee at least one split so a lucky/unlucky roll on the root
    // leaf can never leave the whole map as a single giant room with no
    // corridors at all — confirmed live that this happened on a real
    // seed before this fix (maxLeaf being looser than the root size made
    // the very first split purely a 70% coin flip).
    root.split(opts.minLeaf);
    let leaves = (root.left && root.right) ? [root.left, root.right] : [root];
    let didSplit = true, guard = 0;
    while (didSplit && guard++ < 500) {
        didSplit = false;
        const next = [];
        for (const leaf of leaves) {
            if (leaf.left || leaf.right) { next.push(leaf); continue; }
            const tooBig = leaf.w > opts.maxLeaf || leaf.h > opts.maxLeaf;
            if (tooBig || rng() < 0.7) {
                if (leaf.split(opts.minLeaf)) { didSplit = true; next.push(leaf.left, leaf.right); continue; }
            }
            next.push(leaf);
        }
        leaves = next;
    }

    const allLeaves = [];
    (function collect(leaf) {
        if (leaf.left || leaf.right) { if (leaf.left) collect(leaf.left); if (leaf.right) collect(leaf.right); }
        else allLeaves.push(leaf);
    })(root);

    for (const leaf of allLeaves) {
        // No reserved padding against the leaf's own boundary (was 1 cell
        // on every side) — since adjacent leaves tile with zero gap
        // between them, that padding was the direct cause of rooms always
        // sitting at least ~2 cells (10ft) apart at minimum (confirmed:
        // each of two neighboring rooms held back 1 cell from its own
        // shared boundary). A room can now be sized to reach its leaf's
        // edge, so two rooms in adjacent leaves can end up sharing a
        // common wall with no gap at all — real room size is still
        // randomized within the available space, so plenty of rooms still
        // end up smaller with a natural gap; this just removes the
        // artificial floor under that gap.
        const availW = Math.max(3, leaf.w), availH = Math.max(3, leaf.h);
        const rw = Math.min(availW, opts.minRoom + Math.floor(rng() * Math.max(1, availW - opts.minRoom + 1)));
        const rh = Math.min(availH, opts.minRoom + Math.floor(rng() * Math.max(1, availH - opts.minRoom + 1)));
        const rx = leaf.x + Math.floor(rng() * Math.max(1, leaf.w - rw + 1));
        const ry = leaf.y + Math.floor(rng() * Math.max(1, leaf.h - rh + 1));
        leaf.room = { x: rx, y: ry, w: rw, h: rh };
        rooms.push(leaf.room);
        for (let yy = ry; yy < ry + rh; yy++)
            for (let xx = rx; xx < rx + rw; xx++)
                if (xx >= 0 && xx < cols && yy >= 0 && yy < rows) grid[yy][xx] = 'floor';
    }

    function anyRoom(leaf) {
        if (leaf.room) return leaf.room;
        const l = leaf.left ? anyRoom(leaf.left) : null;
        const r = leaf.right ? anyRoom(leaf.right) : null;
        return rng() < 0.5 ? (l || r) : (r || l);
    }
    function carveCorridor(p1, p2) {
        let x = p1.x, y = p1.y;
        const horizontalFirst = rng() < 0.5;
        function carveAt(cx, cy) {
            if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) return;
            if (grid[cy][cx] === 'wall') grid[cy][cx] = 'floor';
        }
        if (horizontalFirst) {
            while (x !== p2.x) { x += x < p2.x ? 1 : -1; carveAt(x, y); }
            while (y !== p2.y) { y += y < p2.y ? 1 : -1; carveAt(x, y); }
        } else {
            while (y !== p2.y) { y += y < p2.y ? 1 : -1; carveAt(x, y); }
            while (x !== p2.x) { x += x < p2.x ? 1 : -1; carveAt(x, y); }
        }
    }
    (function connect(leaf) {
        if (!leaf.left || !leaf.right) return;
        connect(leaf.left); connect(leaf.right);
        const r1 = anyRoom(leaf.left), r2 = anyRoom(leaf.right);
        if (!r1 || !r2) return;
        const p1 = { x: r1.x + Math.floor(rng() * r1.w), y: r1.y + Math.floor(rng() * r1.h) };
        const p2 = { x: r2.x + Math.floor(rng() * r2.w), y: r2.y + Math.floor(rng() * r2.h) };
        carveCorridor(p1, p2);
    })(root);

    // Removing the old fixed 1-cell leaf padding (see the room-carving
    // comment above) let two rooms in adjacent leaves land flush against
    // each other with zero gap — but when BOTH happen to reach their
    // shared leaf boundary at once, the whole shared wall disappears and
    // the two "rooms" become one indistinguishable open space. Confirmed
    // live: ~49% of adjacent room pairs were fully merged like this,
    // which is exactly why Room Density stopped reading as more rooms —
    // the data said N rooms, but a wall-less shared border made pairs of
    // them look like one. Wall any FULLY open shared border down to a
    // single centered doorway gap — as EDGES sitting on the shared
    // gridline (see the edgeWalls/edgeDoors comment above), not by
    // consuming a cell of either room's own floor the way this used to
    // work. That old approach was the exact whole-cell-wall bug already
    // fixed in the real DM Map Builder — it silently ate a full row/column
    // of usable floor from whichever room happened to own the border
    // column, and made two rooms read as farther apart than their actual
    // footprints.
    for (let a = 0; a < rooms.length; a++) {
        for (let b = a + 1; b < rooms.length; b++) {
            const r1 = rooms[a], r2 = rooms[b];
            let border = null;
            if (r1.x + r1.w === r2.x || r2.x + r2.w === r1.x) {
                const bx = r1.x + r1.w === r2.x ? r2.x : r1.x;
                const ys = Math.max(r1.y, r2.y), ye = Math.min(r1.y + r1.h, r2.y + r2.h);
                if (ye > ys) border = { vertical: true, at: bx, s: ys, e: ye };
            } else if (r1.y + r1.h === r2.y || r2.y + r2.h === r1.y) {
                const by = r1.y + r1.h === r2.y ? r2.y : r1.y;
                const xs = Math.max(r1.x, r2.x), xe = Math.min(r1.x + r1.w, r2.x + r2.w);
                if (xe > xs) border = { vertical: false, at: by, s: xs, e: xe };
            }
            if (!border) continue;
            let allOpen = true;
            for (let i = border.s; i < border.e; i++) {
                const cell = border.vertical ? grid[i][border.at] : grid[border.at][i];
                if (cell === 'wall') { allOpen = false; break; }
            }
            if (!allOpen) continue;
            const gap = border.s + Math.floor((border.e - border.s - 1) / 2);
            for (let i = border.s; i < border.e; i++) {
                // border.at is on the SECOND room's side of the shared line
                // (see the bx/by picks above), so "H:col,border.at"/
                // "V:border.at,row" is exactly the edge between the two
                // rooms' own floor cells under the H/V convention (north/
                // west side of border.at) — both rooms keep every cell of
                // their own footprint; only the gridline between them
                // carries the wall (or, at the gap, a door).
                const key = border.vertical ? edgeKey('V', border.at, i) : edgeKey('H', i, border.at);
                if (i === gap) edgeDoors.add(key); else edgeWalls.add(key);
            }
        }
    }

    if (opts.doors) {
        // A ring cell that actually belongs to a DIFFERENT room (the two
        // rooms sit flush against each other) is handled entirely by the
        // edge pass above — it must not also be treated as an open corridor
        // gap here, or a room's own interior floor row could get a random
        // door-shaped marker stamped on it with no relation to the real
        // gap the edge pass already placed.
        const blockedByOtherRoom = (x, y, self) => rooms.some(r => r !== self && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
        for (const room of rooms) {
            const topRow = [], bottomRow = [], leftCol = [], rightCol = [];
            for (let xx = room.x - 1; xx <= room.x + room.w; xx++) { topRow.push([xx, room.y - 1]); bottomRow.push([xx, room.y + room.h]); }
            for (let yy = room.y - 1; yy <= room.y + room.h; yy++) { leftCol.push([room.x - 1, yy]); rightCol.push([room.x + room.w, yy]); }
            const blocked = (x, y) => blockedByOtherRoom(x, y, room);
            [topRow, bottomRow, leftCol, rightCol].forEach(run => placeDoorsAlongRun(grid, cols, rows, run, rng, blocked));
        }
        // Two different rooms placed doors independently, one per room —
        // but when two rooms sit close together their wall rings can
        // themselves end up touching, so each room's own (otherwise
        // correct) single door can still land directly next to the
        // other's (confirmed live). A global sweep afterward catches that
        // regardless of which rooms were involved: whenever two doors
        // touch, keep only the first one in reading order.
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (grid[y][x] !== 'door') continue;
                if (x + 1 < cols && grid[y][x + 1] === 'door') grid[y][x + 1] = 'floor';
                if (y + 1 < rows && grid[y + 1][x] === 'door') grid[y + 1][x] = 'floor';
            }
        }
        // Rooms can now sit close enough (see the padding-removal above)
        // that a ring cell picked as a doorway ends up with open floor
        // from a NEIGHBORING room on every side instead of the wall it was
        // meant to sit in — a door with no wall context isn't marking a
        // passage through anything, just a random floor tile in open
        // space (confirmed live on seed "cemqhq"). Demote any door left
        // with zero wall-adjacent sides back to plain floor.
        const isSolid = (x, y) => x < 0 || y < 0 || x >= cols || y >= rows || grid[y][x] === 'wall';
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (grid[y][x] !== 'door') continue;
                if (!isSolid(x, y - 1) && !isSolid(x, y + 1) && !isSolid(x - 1, y) && !isSolid(x + 1, y)) grid[y][x] = 'floor';
            }
        }
    }

    if (opts.water) {
        for (const room of rooms) {
            if (room.w * room.h < 12 || rng() >= 0.35) continue;
            const pw = 2 + Math.floor(rng() * Math.min(3, Math.max(1, room.w - 2)));
            const ph = 2 + Math.floor(rng() * Math.min(3, Math.max(1, room.h - 2)));
            const px = room.x + Math.floor(rng() * Math.max(1, room.w - pw));
            const py = room.y + Math.floor(rng() * Math.max(1, room.h - ph));
            for (let yy = py; yy < py + ph; yy++)
                for (let xx = px; xx < px + pw; xx++)
                    if (grid[yy] && grid[yy][xx] === 'floor') grid[yy][xx] = 'water';
        }
    }

    return { grid, rooms, edgeWalls, edgeDoors };
}

// ===================== Tavern (single building, whole footprint) =====================
// Unlike Dungeon, a tavern is one building — every room shares a real
// wall with its neighbors (no corridors between them), so rooms are
// carved to fill their BSP leaf completely rather than randomly sized
// within it. That guarantees every adjacent pair starts fully merged by
// construction, so every shared border always gets walled back down to a
// single doorway gap (same technique as the Dungeon generator's
// merge-prevention pass, just applied unconditionally here instead of
// only when it happens to occur).
function generateTavern(rng, cols, rows, opts) {
    const grid = Array.from({ length: rows }, () => Array(cols).fill('wall'));
    const bx = 1, by = 1, bw = cols - 2, bh = rows - 2; // 1-cell margin all around = "outside," same convention as Dungeon's rock
    // Every internal partition here is an edge, not a cell — see the same
    // note in generateDungeon. This matters even more for a Tavern: since
    // EVERY leaf pair shares a full border by construction, the old
    // whole-cell approach ate a full row/column out of one room in every
    // single wall in the building. Rooms now keep 100% of their leaf as
    // real floor.
    const edgeWalls = new Set();
    const edgeDoors = new Set();

    function Leaf(x, y, w, h) { this.x = x; this.y = y; this.w = w; this.h = h; this.left = null; this.right = null; }
    const root = new Leaf(bx, by, bw, bh);
    let leaves = [root], guard = 0;
    while (leaves.length < opts.roomCount && guard++ < 200) {
        leaves.sort((a, b) => (b.w * b.h) - (a.w * a.h)); // always split the largest remaining leaf
        let splitAny = false;
        for (const leaf of leaves) {
            if (leaf.left || leaf.right) continue;
            const canSplitH = leaf.h >= 7, canSplitW = leaf.w >= 7;
            if (!canSplitH && !canSplitW) continue;
            if (canSplitH && (!canSplitW || leaf.h >= leaf.w)) {
                const s = 3 + Math.floor(rng() * (leaf.h - 6));
                leaf.left = new Leaf(leaf.x, leaf.y, leaf.w, s);
                leaf.right = new Leaf(leaf.x, leaf.y + s, leaf.w, leaf.h - s);
            } else {
                const s = 3 + Math.floor(rng() * (leaf.w - 6));
                leaf.left = new Leaf(leaf.x, leaf.y, s, leaf.h);
                leaf.right = new Leaf(leaf.x + s, leaf.y, leaf.w - s, leaf.h);
            }
            splitAny = true;
            break;
        }
        if (!splitAny) break;
        leaves = [];
        (function collect(leaf) { if (leaf.left || leaf.right) { collect(leaf.left); collect(leaf.right); } else leaves.push(leaf); })(root);
    }

    const rooms = leaves.map(l => ({ x: l.x, y: l.y, w: l.w, h: l.h }));
    rooms.forEach(r => {
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) grid[y][x] = 'floor';
    });

    // Wall every shared border down to a centered 1-2 cell doorway, then
    // mark that gap as an actual door — every internal gap in a tavern IS
    // a real doorway (unlike Dungeon's probabilistic corridor punches).
    for (let a = 0; a < rooms.length; a++) {
        for (let b = a + 1; b < rooms.length; b++) {
            const r1 = rooms[a], r2 = rooms[b];
            let border = null;
            if (r1.x + r1.w === r2.x || r2.x + r2.w === r1.x) {
                const at = r1.x + r1.w === r2.x ? r2.x : r1.x;
                const s = Math.max(r1.y, r2.y), e = Math.min(r1.y + r1.h, r2.y + r2.h);
                if (e > s) border = { vertical: true, at, s, e };
            } else if (r1.y + r1.h === r2.y || r2.y + r2.h === r1.y) {
                const at = r1.y + r1.h === r2.y ? r2.y : r1.y;
                const s = Math.max(r1.x, r2.x), e = Math.min(r1.x + r1.w, r2.x + r2.w);
                if (e > s) border = { vertical: false, at, s, e };
            }
            if (!border) continue;
            // A 1-cell gap always — a 2-cell gap on a 2-long border left
            // NO wall at all on that border (confirmed live: the whole
            // shared edge became two doors side by side with nothing
            // between them, both flagged by the floating/adjacent-door
            // checks below). A single door is also just more realistic —
            // real doorways aren't usually a full 10ft opening.
            const gapStart = border.s + Math.floor((border.e - border.s - 1) / 2);
            for (let i = border.s; i < border.e; i++) {
                const isGap = i === gapStart;
                const key = border.vertical ? edgeKey('V', border.at, i) : edgeKey('H', i, border.at);
                if (isGap) edgeDoors.add(key); else edgeWalls.add(key);
            }
        }
    }

    // Front entrance: whichever room has a wall segment sitting on the
    // building's own outer boundary gets one door there — picking the
    // room a real patron would actually walk into first (largest floor
    // area, i.e. the common room) rather than a random one.
    rooms.sort((a, b) => (b.w * b.h) - (a.w * a.h));
    const common = rooms[0];
    // "at" is the actual exterior wall row/column (one step past the
    // building's own interior bounds), not the room's own floor edge.
    const exteriorSides = [];
    if (common.y === by) exteriorSides.push({ vertical: false, at: by - 1, s: common.x, e: common.x + common.w });
    if (common.y + common.h === by + bh) exteriorSides.push({ vertical: false, at: by + bh, s: common.x, e: common.x + common.w });
    if (common.x === bx) exteriorSides.push({ vertical: true, at: bx - 1, s: common.y, e: common.y + common.h });
    if (common.x + common.w === bx + bw) exteriorSides.push({ vertical: true, at: bx + bw, s: common.y, e: common.y + common.h });
    if (exteriorSides.length) {
        const side = exteriorSides[Math.floor(rng() * exteriorSides.length)];
        const mid = side.s + Math.floor((side.e - side.s) / 2);
        if (side.vertical) grid[mid][side.at] = 'door'; else grid[side.at][mid] = 'door';
    }

    // Same two cleanup passes Dungeon uses, for the same reasons: the
    // front entrance above could in principle land right next to an
    // internal doorway, and a door that ends up with no wall on any side
    // (possible at a building corner) isn't marking an actual passage.
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] !== 'door') continue;
            if (x + 1 < cols && grid[y][x + 1] === 'door') grid[y][x + 1] = 'floor';
            if (y + 1 < rows && grid[y + 1][x] === 'door') grid[y + 1][x] = 'floor';
        }
    }
    const isSolid = (x, y) => x < 0 || y < 0 || x >= cols || y >= rows || grid[y][x] === 'wall';
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] !== 'door') continue;
            if (!isSolid(x, y - 1) && !isSolid(x, y + 1) && !isSolid(x - 1, y) && !isSolid(x + 1, y)) grid[y][x] = 'floor';
        }
    }

    // Room roles for furniture: common room already picked above; kitchen
    // is the next-largest (a tavern's second-biggest room is almost
    // always the kitchen/storage, not another guest room); everything
    // else is a private room.
    const kitchen = rooms.length > 1 ? rooms[1] : null;
    const privateRooms = rooms.slice(kitchen ? 2 : 1);

    return { grid, rooms, tavern: { common, kitchen, privateRooms }, edgeWalls, edgeDoors };
}

// ===================== Caves (cellular automata) =====================
// Every connected floor region at least minSize cells — not just the
// largest — so a pocket the smoothing pass carved off on its own can be
// kept as a real little chamber instead of getting discarded outright.
function findFloorRegions(grid, cols, rows, minSize) {
    const visited = Array.from({ length: rows }, () => Array(cols).fill(false));
    const regions = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        if (grid[y][x] !== 'floor' || visited[y][x]) continue;
        const region = [];
        const stack = [[x, y]];
        visited[y][x] = true;
        while (stack.length) {
            const [cx, cy] = stack.pop();
            region.push([cx, cy]);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = cx + dx, ny = cy + dy;
                if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && !visited[ny][nx] && grid[ny][nx] === 'floor') {
                    visited[ny][nx] = true; stack.push([nx, ny]);
                }
            }
        }
        if (region.length >= minSize) regions.push(region);
    }
    return regions;
}

// Joins every kept chamber into one walkable network — a straight-ish,
// 2-wide carved tunnel (thickened by also opening the step's own +1
// neighbors, so it reads as a real passage rather than a single-file
// crack) from a Prim's-style minimum spanning tree (each new chamber
// joins whichever ALREADY-connected chamber is nearest it), plus a
// couple of extra connections beyond the tree so the cave has an actual
// loop in it somewhere instead of exactly one route between any two
// chambers — real cave systems double back on themselves; a strict tree
// never does.
function connectCaveRegions(grid, cols, rows, regions, rng) {
    if (regions.length <= 1) return;
    function centroid(region) {
        let sx = 0, sy = 0;
        region.forEach(([x, y]) => { sx += x; sy += y; });
        return [sx / region.length, sy / region.length];
    }
    // A region's centroid can itself land on a concave region's own hole —
    // snap to whichever of the region's real cells is actually closest to
    // it, so the tunnel's endpoint is guaranteed to be real floor.
    function nearestCellTo(region, cx, cy) {
        let best = region[0], bestD = Infinity;
        region.forEach(([x, y]) => { const d = (x - cx) ** 2 + (y - cy) ** 2; if (d < bestD) { bestD = d; best = [x, y]; } });
        return best;
    }
    const anchors = regions.map(region => { const [cx, cy] = centroid(region); return nearestCellTo(region, cx, cy); });

    function carveAt(x, y) { if (x >= 0 && y >= 0 && x < cols && y < rows && grid[y][x] === 'wall') grid[y][x] = 'floor'; }
    function carveTunnel(a, b) {
        let [x, y] = a; const [tx, ty] = b;
        const horizontalFirst = rng() < 0.5;
        function step(cx, cy) { carveAt(cx, cy); carveAt(cx + 1, cy); carveAt(cx, cy + 1); }
        if (horizontalFirst) {
            while (x !== tx) { x += x < tx ? 1 : -1; step(x, y); }
            while (y !== ty) { y += y < ty ? 1 : -1; step(x, y); }
        } else {
            while (y !== ty) { y += y < ty ? 1 : -1; step(x, y); }
            while (x !== tx) { x += x < tx ? 1 : -1; step(x, y); }
        }
    }

    const connected = [0], remaining = regions.map((_, i) => i).filter(i => i !== 0);
    while (remaining.length) {
        let bestPair = null, bestDist = Infinity;
        connected.forEach(ci => {
            remaining.forEach(ri => {
                const [ax, ay] = anchors[ci], [bx, by] = anchors[ri];
                const d = (ax - bx) ** 2 + (ay - by) ** 2;
                if (d < bestDist) { bestDist = d; bestPair = [ci, ri]; }
            });
        });
        const [ci, ri] = bestPair;
        carveTunnel(anchors[ci], anchors[ri]);
        connected.push(ri);
        remaining.splice(remaining.indexOf(ri), 1);
    }

    const extraTunnels = Math.min(2, Math.floor(regions.length / 3));
    for (let i = 0; i < extraTunnels; i++) {
        const a = Math.floor(rng() * regions.length);
        let b = Math.floor(rng() * regions.length);
        if (b === a) b = (b + 1) % regions.length;
        carveTunnel(anchors[a], anchors[b]);
    }
}

// The CA smoothing below usually converges to one dominant blob at typical
// settings (confirmed: natural fragmentation into multiple keepable
// regions happened on only ~3% of seeds at default Wall Density/Smoothing
// Passes) — leaving it to chance doesn't reliably give a cave any real
// internal structure. Hunting for a pre-existing, genuinely isolated
// pocket of solid rock big enough for a chamber was tried first and
// mostly failed outright (confirmed live: real rock islands that size
// are rare at this map scale/density, so the search came up empty on the
// large majority of seeds even after fixing two real bugs in it). Actively
// carving a short branch OUTWARD from the existing cave's own boundary —
// a winding, randomly-turning tunnel ending in a small round chamber —
// sidesteps that entirely: it doesn't need to find anything, it just
// carves new territory into whatever rock happens to be there, so it
// works regardless of how the CA settled. The branch is connected to the
// main cave by construction (every carved cell is stepped from one that
// was already floor), so this needs no separate tunneling/connection step.
function addExtraCaveChambers(grid, cols, rows, rng) {
    const boundaryCells = [];
    for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) {
        if (grid[y][x] !== 'floor') continue;
        const touchesRock = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[y + dy] && grid[y + dy][x + dx] === 'wall');
        if (touchesRock) boundaryCells.push([x, y]);
    }
    if (!boundaryCells.length) return;

    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]]; // N, S, W, E
    const branchCount = Math.max(2, Math.min(6, Math.round((cols * rows) / 130)));
    for (let i = 0; i < branchCount; i++) {
        let [x, y] = boundaryCells[Math.floor(rng() * boundaryCells.length)];
        let dir = Math.floor(rng() * dirs.length);
        const length = 3 + Math.floor(rng() * 5);
        function carveAt(cx, cy) { if (cx >= 1 && cy >= 1 && cx < cols - 1 && cy < rows - 1) grid[cy][cx] = 'floor'; }
        for (let step = 0; step < length; step++) {
            if (rng() < 0.25) dir = Math.floor(rng() * dirs.length); // occasional turn — a dead-straight shaft reads as a corridor, not a cave passage
            const [dx, dy] = dirs[dir];
            x += dx; y += dy;
            if (x < 2 || y < 2 || x > cols - 3 || y > rows - 3) break; // stop before running off the map rather than wrapping/clamping into a straight wall-hugging line
            carveAt(x, y);
            carveAt(x + (dy !== 0 ? 1 : 0), y + (dx !== 0 ? 1 : 0)); // thickened one cell to the side of travel so it reads as a passage, not a single-file crack
        }
        const radius = 1.2 + rng();
        for (let yy = Math.max(1, Math.floor(y - radius)); yy <= Math.min(rows - 2, Math.ceil(y + radius)); yy++) {
            for (let xx = Math.max(1, Math.floor(x - radius)); xx <= Math.min(cols - 2, Math.ceil(x + radius)); xx++) {
                if ((xx - x) ** 2 + (yy - y) ** 2 <= radius * radius) grid[yy][xx] = 'floor';
            }
        }
    }
}

function generateCave(rng, cols, rows, opts) {
    let grid = Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => {
        if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) return 'wall';
        return rng() < opts.fillProb ? 'wall' : 'floor';
    }));

    function wallNeighbors(g, x, y) {
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || g[ny][nx] === 'wall') count++;
        }
        return count;
    }
    for (let step = 0; step < opts.steps; step++) {
        const next = grid.map(row => row.slice());
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
            if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) { next[y][x] = 'wall'; continue; }
            next[y][x] = wallNeighbors(grid, x, y) >= 5 ? 'wall' : 'floor';
        }
        grid = next;
    }

    addExtraCaveChambers(grid, cols, rows, rng);

    // The smoothing above CAN naturally break into several disconnected
    // pockets, but usually doesn't (see addExtraCaveChambers) — either
    // way, the old approach kept only the single largest region and threw
    // every other pocket away, which is exactly why caves read as one
    // blob instead of a network of chambers. Every pocket big enough to
    // be a real little room gets kept now, and connectCaveRegions below
    // carves tunnels between them instead of discarding them — more rooms
    // AND more tunnels.
    const MIN_CAVE_ROOM_SIZE = 4; // smaller pockets are noise, not a room
    let regions = findFloorRegions(grid, cols, rows, MIN_CAVE_ROOM_SIZE);
    if (!regions.length) regions = findFloorRegions(grid, cols, rows, 1); // pathological (all noise) — keep whatever exists rather than an empty grid
    const keep = new Set();
    regions.forEach(region => region.forEach(([x, y]) => keep.add(x + ',' + y)));
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        if (grid[y][x] === 'floor' && !keep.has(x + ',' + y)) grid[y][x] = 'wall';
    }
    if (regions.length > 1) connectCaveRegions(grid, cols, rows, regions, rng);

    // Tunnels above make every kept region part of one connected mass —
    // any surviving floor cell is a valid water-pool seed now, not just
    // the pre-connection "largest" region.
    const allFloorCells = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (grid[y][x] === 'floor') allFloorCells.push([x, y]);

    [opts.water && 'water', opts.lava && 'lava'].filter(Boolean).forEach(poolKind => {
        if (!allFloorCells.length) return;
        const poolCount = poolKind === 'lava' ? 1 + Math.floor(rng() * 2) : Math.floor(rng() * 3);
        for (let p = 0; p < poolCount; p++) {
            const [sx, sy] = allFloorCells[Math.floor(rng() * allFloorCells.length)];
            let frontier = [[sx, sy]];
            const targetSize = 4 + Math.floor(rng() * 8);
            const pool = new Set();
            let guard = 0;
            while (frontier.length && pool.size < targetSize && guard++ < 500) {
                const idx = Math.floor(rng() * frontier.length);
                const [cx, cy] = frontier.splice(idx, 1)[0];
                if (grid[cy] && grid[cy][cx] === 'floor' && !pool.has(cx + ',' + cy)) {
                    pool.add(cx + ',' + cy);
                    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) frontier.push([cx + dx, cy + dy]);
                }
            }
            pool.forEach(k => { const [px, py] = k.split(',').map(Number); if (grid[py] && grid[py][px] === 'floor') grid[py][px] = poolKind; });
        }
    });
    return { grid };
}

// ===================== Wilderness (layered value noise) =====================
function valueNoise2D(rng, cols, rows, scale) {
    const lw = Math.ceil(cols / scale) + 2, lh = Math.ceil(rows / scale) + 2;
    const lattice = Array.from({ length: lh }, () => Array.from({ length: lw }, () => rng()));
    const smooth = t => t * t * (3 - 2 * t);
    const out = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const gx = x / scale, gy = y / scale;
            const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = x0 + 1, y1 = y0 + 1;
            const sx = smooth(gx - x0), sy = smooth(gy - y0);
            const v00 = lattice[y0][x0], v10 = lattice[y0][x1], v01 = lattice[y1][x0], v11 = lattice[y1][x1];
            const top = v00 + (v10 - v00) * sx, bottom = v01 + (v11 - v01) * sx;
            out[y][x] = top + (bottom - top) * sy;
        }
    }
    return out;
}
// Rejection-sampled point scatter shared by every landmark kind below —
// picks random buildable cells, skipping any too close to another point
// already placed THIS pass (own set) or an already-placed EARLIER kind
// (avoid, e.g. keeping a cave mouth off a homestead's own doorstep).
function scatterPoints(rng, cols, rows, buildable, count, minSpacing, avoid) {
    const points = [];
    let guard = 0;
    while (points.length < count && guard++ < count * 50) {
        const x = Math.floor(rng() * cols), y = Math.floor(rng() * rows);
        if (!buildable(x, y)) continue;
        const tooClose = list => list.some(b => Math.max(Math.abs(b.x - x), Math.abs(b.y - y)) < minSpacing);
        if (tooClose(points) || (avoid && tooClose(avoid))) continue;
        points.push({ x, y });
    }
    return points;
}

// Points of interest worth marking on a regional map — homesteads (common,
// buildable land only), a castle (rare — at most one, a settled region's
// seat of power), and cave mouths (need real rock, so mountain/hills
// only). Purely markers on top of whatever biome is already there (see
// drawBuildingGlyph/drawCastleGlyph/drawCaveGlyph) — Wilderness isn't tied
// to the tactical grid, so none of these are walkable structures, just
// points of interest a DM can send the party toward.
function scatterLandmarks(rng, grid, cols, rows) {
    const isPlainsHills = (x, y) => grid[y] && (grid[y][x] === 'plains' || grid[y][x] === 'hills');
    const isMountainHills = (x, y) => grid[y] && (grid[y][x] === 'mountain' || grid[y][x] === 'hills');
    const minSpacing = Math.max(3, Math.round(Math.min(cols, rows) / 8));

    const targetHouses = Math.min(14, Math.max(1, Math.round((cols * rows) / 150)));
    const houses = scatterPoints(rng, cols, rows, isPlainsHills, targetHouses, minSpacing);
    // Only worth marking a castle on a map with room for a real settlement
    // pattern in the first place — a tiny map gets houses only.
    const castles = cols * rows >= 200 ? scatterPoints(rng, cols, rows, isPlainsHills, 1, minSpacing, houses) : [];
    const targetCaves = Math.min(4, Math.max(1, Math.round((cols * rows) / 500)));
    const caves = scatterPoints(rng, cols, rows, isMountainHills, targetCaves, minSpacing, houses.concat(castles));

    return houses.map(p => Object.assign({ kind: 'building' }, p))
        .concat(castles.map(p => Object.assign({ kind: 'castle' }, p)))
        .concat(caves.map(p => Object.assign({ kind: 'cave' }, p)));
}

// How costly a biome is to route a road through — plains is free (roads
// naturally follow open ground), hills/forest add a mild penalty (real
// roads avoid dense woods and slopes where they can), and water/mountain/
// peak are heavily penalized rather than forbidden outright, so a road
// CAN cross a river or notch through a mountain pass if that's genuinely
// the only reasonable way through, but always prefers going around when
// an easy detour exists.
const ROAD_TERRAIN_COST = { plains: 0, hills: 1, forest: 2, water: 8, mountain: 6, peak: 10 };

// The one big cross-map road — starts and ends on opposite (west/east)
// edges at a random row each, arcing gradually between them so it drifts
// with real direction rather than wandering aimlessly, plus a small
// chance each step of an extra lateral nudge so it still reads as
// winding even where the terrain itself doesn't force any turns.
function traceMainRoad(grid, cols, rows, rng) {
    const margin = Math.max(2, Math.round(rows * 0.15));
    const startY = margin + Math.floor(rng() * Math.max(1, rows - margin * 2));
    const endY = margin + Math.floor(rng() * Math.max(1, rows - margin * 2));
    let x = 0, y = startY;
    const path = [[x, y]];
    while (x < cols - 1) {
        const progress = x / (cols - 1);
        const desiredY = startY + (endY - startY) * progress;
        const candidates = [[1, 0], [1, -1], [1, 1]]
            .map(([dx, dy]) => [x + dx, y + dy])
            .filter(([, ny]) => ny >= 1 && ny <= rows - 2)
            .map(([nx, ny]) => ({ nx, ny, cost: (ROAD_TERRAIN_COST[grid[ny][nx]] || 0) + Math.abs(ny - desiredY) * 0.3 + rng() * 0.5 }));
        if (rng() < 0.15 && y > 1 && y < rows - 2) {
            const ny = y + (rng() < 0.5 ? -1 : 1);
            candidates.push({ nx: x, ny, cost: 0.4 + rng() * 0.3 });
        }
        if (!candidates.length) break;
        candidates.sort((a, b) => a.cost - b.cost);
        x = candidates[0].nx; y = candidates[0].ny;
        path.push([x, y]);
    }
    return path;
}

// A smaller connector road from one point toward another — greedily
// closes the distance every step (so it always terminates) while still
// preferring whichever direction crosses the cheapest terrain, the same
// bias traceMainRoad uses, just goal-directed instead of edge-to-edge.
function traceConnectorRoad(grid, cols, rows, start, end, rng) {
    let [x, y] = start;
    const path = [[x, y]];
    let guard = 0;
    while ((x !== end[0] || y !== end[1]) && guard++ < (cols + rows) * 2) {
        const dx = Math.sign(end[0] - x), dy = Math.sign(end[1] - y);
        const moves = [[dx, 0], [0, dy], [dx, dy]].filter(([mx, my]) => mx !== 0 || my !== 0);
        const candidates = moves.map(([mx, my]) => [x + mx, y + my])
            .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < cols && ny < rows)
            .map(([nx, ny]) => ({ nx, ny, cost: (ROAD_TERRAIN_COST[grid[ny][nx]] || 0) + rng() * 0.3 }));
        if (!candidates.length) break;
        candidates.sort((a, b) => a.cost - b.cost);
        x = candidates[0].nx; y = candidates[0].ny;
        path.push([x, y]);
    }
    return path;
}

// Links every house/building/castle into the road network — closest-to-
// the-main-road landmarks connect first, and each new connector runs to
// whichever point is CURRENTLY nearest (a main-road cell, or another
// landmark already linked in) rather than always the main road itself.
// That's what naturally produces the "buildings connect to each other
// too" behavior asked for, as one emergent result of a single greedy
// nearest-connection pass instead of a separate step of its own. Each
// small road independently rolls dirt or stone — real local roads
// wouldn't all be paved the same way just because they share a region.
function connectLandmarksToRoad(grid, cols, rows, mainRoadPath, landmarks, rng) {
    if (!landmarks.length) return [];
    const connected = mainRoadPath.map(([x, y]) => ({ x, y }));
    const nearestDist = (lm, points) => points.reduce((best, p) => Math.min(best, (p.x - lm.x) ** 2 + (p.y - lm.y) ** 2), Infinity);
    const ordered = landmarks.slice().sort((a, b) => nearestDist(a, connected) - nearestDist(b, connected));
    const smallRoads = [];
    ordered.forEach(lm => {
        let best = connected[0], bestD = Infinity;
        connected.forEach(p => { const d = (p.x - lm.x) ** 2 + (p.y - lm.y) ** 2; if (d < bestD) { bestD = d; best = p; } });
        const path = traceConnectorRoad(grid, cols, rows, [lm.x, lm.y], [best.x, best.y], rng);
        smallRoads.push({ path, style: rng() < 0.5 ? 'dirt' : 'stone' });
        connected.push({ x: lm.x, y: lm.y });
    });
    return smallRoads;
}

function generateWilderness(rng, cols, rows, opts) {
    const elevBase = valueNoise2D(rng, cols, rows, opts.scale);
    const elevDetail = valueNoise2D(rng, cols, rows, Math.max(2, opts.scale / 3));
    const moisture = valueNoise2D(rng, cols, rows, opts.scale * 1.3);
    const grid = Array.from({ length: rows }, () => Array(cols).fill('plains'));
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const e = elevBase[y][x] * 0.75 + elevDetail[y][x] * 0.25;
            const m = moisture[y][x];
            let biome;
            if (e < opts.waterLevel) biome = 'water';
            else if (e > opts.mountainLevel + 0.08) biome = 'peak';
            else if (e > opts.mountainLevel) biome = 'mountain';
            else if (e > opts.mountainLevel - 0.12 && m < 0.45) biome = 'hills';
            else if (m > 0.55) biome = 'forest';
            else biome = 'plains';
            grid[y][x] = biome;
        }
    }
    const buildings = opts.buildings ? scatterLandmarks(rng, grid, cols, rows) : [];
    // Every house/building/castle gets full road access; a cave only gets
    // a rough dirt path (see below) — it's a wild feature to explore, not
    // a settlement anyone paved a proper road to.
    let mainRoad = [], smallRoads = [];
    if (opts.buildings) {
        const roadTargets = buildings.filter(b => b.kind === 'building' || b.kind === 'castle');
        mainRoad = traceMainRoad(grid, cols, rows, rng);
        smallRoads = connectLandmarksToRoad(grid, cols, rows, mainRoad, roadTargets, rng);

        // A cave mouth ties into whichever road cell (main OR small) is
        // nearest it, as a dirt path only — never stone, and never
        // routed through the same "connect to whatever's nearest, in
        // closest-first order" network the settlements share, since a
        // cave isn't part of that settlement network at all.
        const caves = buildings.filter(b => b.kind === 'cave');
        if (caves.length) {
            const roadCells = mainRoad.map(([x, y]) => ({ x, y }))
                .concat(smallRoads.flatMap(r => r.path.map(([x, y]) => ({ x, y }))));
            if (roadCells.length) {
                caves.forEach(cave => {
                    let best = roadCells[0], bestD = Infinity;
                    roadCells.forEach(p => { const d = (p.x - cave.x) ** 2 + (p.y - cave.y) ** 2; if (d < bestD) { bestD = d; best = p; } });
                    const path = traceConnectorRoad(grid, cols, rows, [cave.x, cave.y], [best.x, best.y], rng);
                    smallRoads.push({ path, style: 'dirt' });
                });
            }
        }
    }
    return { grid, buildings, mainRoad, smallRoads };
}

// ===================== Castle =====================
// The original castle: a rectangular courtyard inside a thick curtain wall, a two-door gatehouse, corner towers, a keep and a few
// buildings along the walls.
function castleFort(rng, cols, rows, opts) {
    opts = opts || {};
    const grid = Array.from({ length: rows }, () => Array(cols).fill('wall'));
    const edgeWalls = new Set(), edgeWallsThick = new Set(), edgeDoors = new Set(), rooms = [], passage = new Set();
    const mx = 3, myTop = 3, myBottom = 4; // rock round the castle, with room under it for the gate passage
    const x0 = mx, y0 = myTop, x1 = cols - 1 - mx, y1 = rows - 1 - myBottom;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y][x] = 'floor';
    const courtW = x1 - x0 + 1, courtH = y1 - y0 + 1;
    // walls round a rectangle of cells (thick or thin), with an optional door in the middle of one side
    const box = (x, y, w, h, thick, doorSide) => {
        const set = thick ? edgeWallsThick : edgeWalls;
        for (let i = 0; i < w; i++) { set.add('H:' + (x + i) + ',' + y); set.add('H:' + (x + i) + ',' + (y + h)); }
        for (let j = 0; j < h; j++) { set.add('V:' + x + ',' + (y + j)); set.add('V:' + (x + w) + ',' + (y + j)); }
        if (doorSide === 'N') edgeDoors.add('H:' + (x + Math.floor(w / 2)) + ',' + y);
        if (doorSide === 'S') edgeDoors.add('H:' + (x + Math.floor(w / 2)) + ',' + (y + h));
        if (doorSide === 'W') edgeDoors.add('V:' + x + ',' + (y + Math.floor(h / 2)));
        if (doorSide === 'E') edgeDoors.add('V:' + (x + w) + ',' + (y + Math.floor(h / 2)));
        rooms.push({ x, y, w, h });
    };
    // the gatehouse: a two-wide passage south through the curtain wall, a door at each end
    const gx = Math.floor((x0 + x1) / 2);
    [y1 + 1, y1 + 2].forEach(y => { grid[y][gx] = 'floor'; grid[y][gx + 1] = 'floor'; passage.add(gx + ',' + y); passage.add((gx + 1) + ',' + y); });
    [gx, gx + 1].forEach(x => { edgeDoors.add('H:' + x + ',' + (y1 + 1)); edgeDoors.add('H:' + x + ',' + (y1 + 3)); });
    // corner towers
    const t = courtW >= 14 && courtH >= 14 && opts.towers !== false ? 4 : 0;
    const roundTowers = [], stairs = [];
    if (t) {
        [[x0, y0, 'E'], [x1 - t + 1, y0, 'W'], [x0, y1 - t + 1, 'E'], [x1 - t + 1, y1 - t + 1, 'W']].forEach(([tx, ty, side], q) => {
            stairs.push([tx + 1, ty + 1]);
            if (!opts.roundTowers) { box(tx, ty, t, t, true, side); return; }
            // a round tower: a circle over the same four-by-four block, outlined as a true circle with a door facing the courtyard
            const cx = tx + t / 2, cy = ty + t / 2, rad = 2.3, cells = [];
            for (let y = ty; y < ty + t; y++) for (let x = tx; x < tx + t; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= rad + 1e-6) cells.push([x, y]);
            // the door: on the side facing the courtyard, in the row nearest the middle
            const row = Math.min(ty + t - 1, Math.max(ty, Math.round(cy - 0.5) + (ty === y0 ? 1 : 0)));
            const doorKey = side === 'E' ? 'V:' + (tx + t) + ',' + row : 'V:' + tx + ',' + row;
            roundTowers.push({ id: 'ct' + q, c: [cx, cy, rad], cells, doorKey });
            rooms.push({ x: tx, y: ty, w: t, h: t });
        });
    }
    // the keep: back and centre, as wide as the setting asks for but never reaching the towers
    const keepPct = Math.max(25, Math.min(60, parseFloat(opts.keepSize) || 40)) / 100;
    const kw = Math.max(6, Math.min(courtW - 10, Math.round(courtW * keepPct)));
    const kh = Math.max(5, Math.min(courtH - 7, Math.round(courtH * 0.38)));
    if (courtW - 10 >= 6 && courtH - 7 >= 5) {
        const kx = Math.floor((x0 + x1 - kw + 1) / 2), ky = y0 + 1;
        box(kx, ky, kw, kh, true, 'S');
        // inside the keep: split it into the asked number of rooms, each split a wall with a door in it, so every room is reachable
        const want = Math.max(1, Math.min(8, Math.round(opts.rooms || 4)));
        const rects = [{ x: kx, y: ky, w: kw, h: kh }];
        while (rects.length < want) {
            let best = -1, bestArea = 0;
            rects.forEach((r, i) => { if ((r.w >= 4 || r.h >= 4) && r.w * r.h > bestArea) { best = i; bestArea = r.w * r.h; } });
            if (best < 0) break;
            const r = rects.splice(best, 1)[0], frac = 0.4 + rng() * 0.2;
            const vertical = r.w >= r.h ? r.w >= 4 : r.h < 4;
            if (vertical) {
                const p = Math.max(2, Math.min(r.w - 2, Math.round(r.w * frac)));
                for (let j = 0; j < r.h; j++) edgeWalls.add('V:' + (r.x + p) + ',' + (r.y + j));
                edgeDoors.add('V:' + (r.x + p) + ',' + (r.y + Math.floor(r.h / 2)));
                rects.push({ x: r.x, y: r.y, w: p, h: r.h }, { x: r.x + p, y: r.y, w: r.w - p, h: r.h });
            } else {
                const p = Math.max(2, Math.min(r.h - 2, Math.round(r.h * frac)));
                for (let i = 0; i < r.w; i++) edgeWalls.add('H:' + (r.x + i) + ',' + (r.y + p));
                edgeDoors.add('H:' + (r.x + Math.floor(r.w / 2)) + ',' + (r.y + p));
                rects.push({ x: r.x, y: r.y, w: r.w, h: p }, { x: r.x, y: r.y + p, w: r.w, h: r.h - p });
            }
        }
        rects.forEach(r => rooms.push({ x: r.x, y: r.y, w: r.w, h: r.h }));
    }
    // a building against each side wall, door facing the courtyard
    if (opts.buildings !== false && courtW >= 14 && courtH >= 14) {
        const by = y0 + (t || 1) + 1, bh = Math.min(4, courtH - 2 * (t || 1) - 3);
        if (bh >= 3) {
            box(x0 + 1, by, 4, bh, false, 'E');
            box(x1 - 4, by, 4, bh, false, 'W');
        }
    }
    return { grid, rooms, edgeWalls, edgeWallsThick, edgeDoors, roundTowers, stairs, furniture: [], passage };
}


// ===================== Castle floor plans =====================
// A castle is built the way the reference plans are drawn: wings of rooms with a corridor along one side, a great hall, round or
// square towers at the corners with a spiral stair, a gatehouse through the front, a courtyard or an inner hall in the middle.
// The seed picks the layout (courtyard castle, compact keep, U-shaped palace, or the old walled fort), the sizes, the rooms and
// what is in them, and which way round it faces. Everything is built facing south, then turned/mirrored to its final side.
function generateCastle(rng, cols, rows, opts) {
    opts = opts || {};
    const names = ['courtyard', 'keep', 'wings', 'sprawl', 'maze', 'fort'];
    // Surprise me picks one of the five floor plans; the plain walled fort only when asked for
    const layout = names.includes(opts.layout) ? opts.layout : names[Math.floor(rng() * 5)];
    const transpose = rng() < 0.5, fx = rng() < 0.5, fy = rng() < 0.5;
    const W = transpose ? rows : cols, H = transpose ? cols : rows;
    let st = layout === 'fort' ? null : castlePlan(rng, W, H, opts, layout);
    if (!st) st = castleFort(rng, W, H, opts);
    // a moat: water two squares wide round the walls, with the gate passage left as a bridge
    const moat = [];
    if (opts.moat) {
        const floor = (x, y) => y >= 0 && y < H && x >= 0 && x < W && st.grid[y][x] !== 'wall' && !st.passage.has(x + ',' + y);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            if (st.grid[y][x] !== 'wall') continue;
            let near = false;
            for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) if (floor(x + dx, y + dy)) { near = true; break; }
            if (near) moat.push([x, y]);
        }
    }
    st.moat = moat;
    return castleTurn(st, transpose, fx, fy, cols, rows);
}
// Turn / mirror a finished castle: transpose first (swapping across the diagonal), then flip across and down.
function castleTurn(st, transpose, fx, fy, cols, rows) {
    const cell = (x, y) => { if (transpose) { const t = x; x = y; y = t; } if (fx) x = cols - 1 - x; if (fy) y = rows - 1 - y; return [x, y]; };
    const key = k => {
        const p = k.split(':'), xy = p[1].split(',').map(Number);
        let type = p[0], x = xy[0], y = xy[1];
        if (transpose) { type = type === 'H' ? 'V' : 'H'; const t = x; x = y; y = t; }
        if (fx) x = type === 'V' ? cols - x : cols - 1 - x;
        if (fy) y = type === 'H' ? rows - y : rows - 1 - y;
        return type + ':' + x + ',' + y;
    };
    const point = (cx, cy) => { if (transpose) { const t = cx; cx = cy; cy = t; } if (fx) cx = cols - cx; if (fy) cy = rows - cy; return [cx, cy]; };
    const grid = Array.from({ length: rows }, () => Array(cols).fill('wall'));
    for (let y = 0; y < st.grid.length; y++) for (let x = 0; x < st.grid[y].length; x++) { const c = cell(x, y); grid[c[1]][c[0]] = st.grid[y][x]; }
    const rect = r => { const a = cell(r.x, r.y), b = cell(r.x + r.w - 1, r.y + r.h - 1); return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: transpose ? r.h : r.w, h: transpose ? r.w : r.h }; };
    const keys = set => new Set(Array.from(set).map(key));
    return {
        grid, rooms: st.rooms.map(rect),
        edgeWalls: keys(st.edgeWalls), edgeWallsThick: keys(st.edgeWallsThick), edgeDoors: keys(st.edgeDoors),
        roundTowers: st.roundTowers.map(t => { const c = point(t.c[0], t.c[1]); return Object.assign({}, t, { c: [c[0], c[1], t.c[2]], cells: t.cells.map(q => cell(q[0], q[1])), doorKey: t.doorKey ? key(t.doorKey) : null }); }),
        stairs: st.stairs.map(q => cell(q[0], q[1])),
        furniture: (st.furniture || []).map(f => { const c = cell(f.x, f.y); return { x: c[0], y: c[1], piece: f.piece }; }),
        moat: (st.moat || []).map(q => cell(q[0], q[1]))
    };
}
function castlePlan(rng, W, H, opts, layout) {
    const R = (a, b) => a + Math.floor(rng() * (b - a + 1));
    const grid = Array.from({ length: H }, () => Array(W).fill('wall'));
    const edgeWalls = new Set(), edgeWallsThick = new Set(), edgeDoors = new Set();
    const rooms = [], furniture = [], stairs = [], roundTowers = [], passage = new Set(), plans = [];
    const moatW = opts.moat ? 2 : 0, m = 2 + moatW, mB = 4;
    const AW = W - 2 * m, AH = H - m - mB;
    const fill = (x, y, w, h) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid[j][i] = 'floor'; };
    const hEdge = (set, x0, x1, y) => { for (let x = x0; x <= x1; x++) set.add('H:' + x + ',' + y); };
    const vEdge = (set, x, y0, y1) => { for (let y = y0; y <= y1; y++) set.add('V:' + x + ',' + y); };
    const boxEdges = (set, x, y, w, h) => { hEdge(set, x, x + w - 1, y); hEdge(set, x, x + w - 1, y + h); vEdge(set, x, y, y + h - 1); vEdge(set, x + w, y, y + h - 1); };
    // a door through the side of cell (x, y)
    const door = (x, y, side) => edgeDoors.add(side === 'N' ? 'H:' + x + ',' + y : side === 'S' ? 'H:' + x + ',' + (y + 1) : side === 'W' ? 'V:' + x + ',' + y : 'V:' + (x + 1) + ',' + y);
    const want = Math.max(1, Math.min(8, Math.round(opts.rooms || 4)));
    const keepPct = Math.max(25, Math.min(60, parseFloat(opts.keepSize) || 40)) / 100;

    // rooms along a band: split into rooms of 4-7 squares (a longer one in the middle for the hall), thin walls between them,
    // the wall along the corridor side, and a door from each room to the corridor
    let rw0 = 4, rw1 = 7; // the size range of a room (smaller in a maze)
    const split = len => { const out = []; let rem = len; while (rem > 0) { let w = rem <= rw1 + 1 ? rem : R(rw0, rw1); if (rem - w > 0 && rem - w < rw0) w = rem; out.push(w); rem -= w; } return out; };
    const band = (x, y, w, h, vertical, doorSide, hallLen, kinds) => {
        const L = vertical ? h : w;
        if (L < 3) return;
        const segs = [];
        if (hallLen && L >= hallLen + 8) {
            let left = Math.floor((L - hallLen) / 2) + R(-1, 1);
            left = Math.max(4, Math.min(L - hallLen - 4, left));
            split(left).forEach(n => segs.push({ n, kind: null }));
            segs.push({ n: hallLen, kind: 'hall' });
            split(L - left - hallLen).forEach(n => segs.push({ n, kind: null }));
        } else split(L).forEach(n => segs.push({ n, kind: null }));
        // the wall along the corridor
        if (doorSide === 'S') hEdge(edgeWalls, x, x + w - 1, y + h); else if (doorSide === 'N') hEdge(edgeWalls, x, x + w - 1, y);
        else if (doorSide === 'E') vEdge(edgeWalls, x + w, y, y + h - 1); else vEdge(edgeWalls, x, y, y + h - 1);
        let at = 0;
        segs.forEach((sg, i) => {
            const r = vertical ? { x, y: y + at, w, h: sg.n } : { x: x + at, y, w: sg.n, h };
            rooms.push(r);
            const mid = at + Math.floor(sg.n / 2);
            const dx = vertical ? (doorSide === 'E' ? x + w - 1 : x) : x + mid, dy = vertical ? y + mid : (doorSide === 'S' ? y + h - 1 : y);
            door(dx, dy, doorSide);
            if (i < segs.length - 1) { if (vertical) hEdge(edgeWalls, x, x + w - 1, y + at + sg.n); else vEdge(edgeWalls, x + at + sg.n, y, y + h - 1); }
            const ks = kinds || ['bed', 'bed', 'store', 'study', 'armory', 'kitchen'];
            plans.push({ r, kind: sg.kind || ks[R(0, ks.length - 1)] });
            at += sg.n;
        });
    };
    // a tower filling a size x size block, door toward the middle of the castle on its \`side\`, with a spiral stair
    const tower = (tx, ty, size, side) => {
        const mid = Math.floor(size / 2), row = ty + mid;
        stairs.push([tx + Math.floor((size - 1) / 2), ty + Math.floor((size - 1) / 2)]);
        rooms.push({ x: tx, y: ty, w: size, h: size });
        if (!opts.roundTowers) {
            boxEdges(edgeWallsThick, tx, ty, size, size);
            if (side === 'E') door(tx + size - 1, row, 'E'); else if (side === 'W') door(tx, row, 'W'); else if (side === 'N') door(tx + mid, ty, 'N'); else door(tx + mid, ty + size - 1, 'S');
            return;
        }
        const cx = tx + size / 2, cy = ty + size / 2, rad = size / 2 + 0.3, cells = [];
        for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= rad + 1e-6) cells.push([x, y]);
        const doorKey = side === 'E' ? 'V:' + (tx + size) + ',' + row : side === 'W' ? 'V:' + tx + ',' + row : side === 'N' ? 'H:' + (tx + mid) + ',' + ty : 'H:' + (tx + mid) + ',' + (ty + size);
        roundTowers.push({ id: 'ct' + roundTowers.length, c: [cx, cy, rad], cells, doorKey });
    };
    // gate passage south through the front, two squares wide, a door at each end
    const gate = (gx, gw, yTop, yBottom) => {
        for (let y = yTop; y <= yBottom; y++) for (let x = gx; x < gx + gw; x++) { grid[y][x] = 'floor'; if (y > yBottom - 3) passage.add(x + ',' + y); }
    };
    let result;
    if (layout === 'wings') result = wings(); else if (layout === 'sprawl' || layout === 'maze') result = sprawl(layout === 'maze'); else result = ring();
    if (!result) return null;
    furnishPlans((a, b) => a + Math.floor((opts.irng || rng)() * (b - a + 1)), plans, edgeDoors, furniture);
    return { grid, rooms, edgeWalls, edgeWallsThick, edgeDoors, roundTowers, stairs, furniture, passage };

    // ---- corridors with wings: a main corridor from the gate, branch corridors off it (and off those), rooms in bands along both
    // sides of every corridor, a great hall at the end of the main one, towers at the ends of the others. A maze: the same with
    // many more, shorter branches and smaller rooms. ----
    function sprawl(maze) {
        rw0 = maze ? 3 : 4; rw1 = maze ? 5 : 7;
        const D = () => (maze ? 3 : R(4, 5));
        const lo = m, hiX = W - 1 - m, y1 = H - 1 - mB;
        if (AW < 18 || AH < 18) return null;
        const occ = Array.from({ length: H }, () => new Uint8Array(W)); // 0 free, 1 corridor, 2 room
        const inB = (x, y) => x >= lo && x <= hiX && y >= lo && y <= y1;
        // is the rectangle free, with a one-square gap round it? (squares of \`ignoreSeg\`'s corridor do not count)
        const clear = (x, y, w, h, ignoreSeg) => {
            for (let j = y - 1; j <= y + h; j++) for (let i = x - 1; i <= x + w; i++) {
                const inside = i >= x && i < x + w && j >= y && j < y + h;
                if (inside && !inB(i, j)) return false;
                if (!inB(i, j) || occ[j][i] === 0) continue;
                if (ignoreSeg && occ[j][i] === 1 && ignoreSeg.has(i + ',' + j)) continue;
                return false;
            }
            return true;
        };
        const mark = (x, y, w, h, v) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (j >= 0 && j < H && i >= 0 && i < W) occ[j][i] = v; };
        const cellsOf = sg => { const set = new Set(); for (let k = 0; k < sg.len; k++) for (let t = 0; t < 2; t++) set.add(sg.vertical ? (sg.x + t) + ',' + (sg.y + k) : (sg.x + k) + ',' + (sg.y + t)); return set; };
        const segs = [];
        // the main corridor, north from the gate
        const gx = R(m + Math.floor(AW * 0.3), m + Math.floor(AW * 0.7) - 2);
        const L0 = R(Math.floor(AH * 0.5), AH - 8);
        const main = { x: gx, y: y1 - L0 + 1, len: L0, vertical: true, end: 'N' };
        segs.push(main); mark(main.x, main.y, 2, main.len, 1); fill(main.x, main.y, 2, main.len);
        // branches
        const wantBr = maze ? R(18, 30) : R(3, 6);
        for (let tries = 0, made = 0; tries < 2500 && made < wantBr; tries++) {
            // a maze keeps growing off the newest corridors, so it twists; the others branch off anywhere
            const p = (maze && R(0, 1)) ? segs[Math.max(0, segs.length - R(1, 5))] : segs[R(0, segs.length - 1)];
            if (p.len < 8) continue;
            const k = R(3, p.len - 5), back = maze ? R(5, 11) : R(9, 18), dep = maze ? 1 : 5;
            const side = R(0, 1) ? 1 : -1;
            let b;
            if (p.vertical) b = side > 0 ? { x: p.x + 2, y: p.y + k, len: back, vertical: false, end: 'E' } : { x: p.x - back, y: p.y + k, len: back, vertical: false, end: 'W' };
            else b = side > 0 ? { x: p.x + k, y: p.y + 2, len: back, vertical: true, end: 'S' } : { x: p.x + k, y: p.y - back, len: back, vertical: true, end: 'N' };
            const bw = b.vertical ? 2 : b.len, bh = b.vertical ? b.len : 2;
            if (!clear(b.x, b.y, bw, bh, cellsOf(p))) continue;
            // room for the rooms either side of it (no other corridor close by)
            const zx = b.vertical ? b.x - dep - 1 : b.x, zy = b.vertical ? b.y : b.y - dep - 1, zw = b.vertical ? bw + 2 * (dep + 1) : bw, zh = b.vertical ? bh : bh + 2 * (dep + 1);
            let crowded = false;
            for (let j = zy; j < zy + zh && !crowded; j++) for (let i = zx; i < zx + zw; i++) if (i >= 0 && j >= 0 && i < W && j < H && occ[j][i] === 1 && !cellsOf(p).has(i + ',' + j)) { crowded = true; break; }
            if (crowded) continue;
            segs.push(b); mark(b.x, b.y, bw, bh, 1); fill(b.x, b.y, bw, bh); made++;
        }
        // the gate, at the south end of the main corridor
        const gw = 2;
        gate(gx, gw, y1 + 1, y1 + 3);
        for (let x = gx; x < gx + gw; x++) { edgeDoors.add('H:' + x + ',' + (y1 + 1)); edgeDoors.add('H:' + x + ',' + (y1 + 4)); }
        // the end of each corridor: the great hall at the end of the main one, a tower or a dead end on the others
        segs.forEach((sg, idx) => {
            const own = cellsOf(sg);
            const endTower = () => {
                const S = maze ? R(3, 4) : R(4, 5), mid = Math.floor(S / 2);
                let tx, ty, side;
                if (sg.end === 'N') { tx = sg.x - mid; ty = sg.y - S; side = 'S'; }
                else if (sg.end === 'S') { tx = sg.x - mid; ty = sg.y + sg.len; side = 'N'; }
                else if (sg.end === 'E') { tx = sg.x + sg.len; ty = sg.y - mid; side = 'W'; }
                else { tx = sg.x - S; ty = sg.y - mid; side = 'E'; }
                if (!clear(tx, ty, S, S, own)) return false;
                fill(tx, ty, S, S); mark(tx, ty, S, S, 2); tower(tx, ty, S, side); return true;
            };
            if (idx === 0) {
                const hw = R(9, 13), hh = R(7, 9), hx = sg.x - Math.floor(hw / 2), hy = sg.y - hh;
                if (clear(hx, hy, hw, hh, own)) {
                    fill(hx, hy, hw, hh); mark(hx, hy, hw, hh, 2); boxEdges(edgeWallsThick, hx, hy, hw, hh); door(sg.x, hy + hh - 1, 'S');
                    const r = { x: hx, y: hy, w: hw, h: hh }; rooms.push(r); plans.push({ r, kind: 'hall' });
                    return;
                }
                endTower();
            } else if (R(0, 99) < (maze ? 55 : 80)) endTower();
        });
        // the rooms: bands along both sides of every corridor wherever there is room
        segs.forEach(sg => {
            [-1, 1].forEach(side => {
                const dep = D();
                const strip = (k, d) => sg.vertical ? [side < 0 ? sg.x - 1 - d : sg.x + 2 + d, sg.y + k] : [sg.x + k, side < 0 ? sg.y - 1 - d : sg.y + 2 + d];
                const valid = k => {
                    if (k < 0 || k >= sg.len) return false; // keep rooms off the very ends of a corridor
                    for (let d = 0; d <= dep; d++) { const c = strip(k, d); if (!inB(c[0], c[1])) { if (d < dep) return false; continue; } if (occ[c[1]][c[0]] !== 0) return false; }
                    return true;
                };
                let k = 0;
                while (k < sg.len) {
                    if (!(valid(k - 1) && valid(k) && valid(k + 1)) || k >= sg.len) { k++; continue; }
                    let k1 = k;
                    while (k1 + 1 < sg.len && valid(k1) && valid(k1 + 1) && valid(k1 + 2)) k1++;
                    const run = k1 - k + 1;
                    if (run >= (maze ? 4 : 5)) {
                        const a = strip(k, 0), b = strip(k1, dep - 1);
                        const bx = Math.min(a[0], b[0]), by = Math.min(a[1], b[1]), bw = sg.vertical ? dep : run, bh = sg.vertical ? run : dep;
                        fill(bx, by, bw, bh); mark(bx, by, bw, bh, 2);
                        band(bx, by, bw, bh, sg.vertical, sg.vertical ? (side < 0 ? 'E' : 'W') : (side < 0 ? 'S' : 'N'), run >= 20 && R(0, 2) === 0 ? R(9, 12) : 0, null);
                    }
                    k = k1 + 1;
                }
            });
        });
        return true;
    }
    // ---- a ring of rooms round a courtyard (courtyard) or a great hall (keep), corridor ring between ----
    function ring() {
        const hall = layout === 'keep';
        let T = hall ? R(5, 6) : R(6, 7);
        T = Math.min(T, Math.floor((Math.min(AW, AH) - 6) / 2));
        if (T < 5) return null;
        const cw = AW >= 2 * T + 14 ? R(Math.max(2 * T + 8, Math.round(AW * 0.8)), AW) : AW, ch = AH >= 2 * T + 12 ? R(Math.max(2 * T + 8, Math.round(AH * 0.8)), AH) : AH;
        if (cw < 2 * T + 6 || ch < 2 * T + 6) return null;
        const X0 = m + R(0, AW - cw), Y0 = m + R(0, AH - ch), X1 = X0 + cw - 1, Y1 = Y0 + ch - 1, bs = T - 2;
        fill(X0, Y0, cw, ch);
        const cx0 = X0 + bs, cx1 = X1 - bs, cy0 = Y0 + bs, cy1 = Y1 - bs, ix0 = X0 + T, ix1 = X1 - T, iy0 = Y0 + T, iy1 = Y1 - T;
        // corridor ring: wall along its outer edge is each band's own; the wall between it and the inner space is here
        boxEdges(hall ? edgeWalls : edgeWallsThick, ix0, iy0, ix1 - ix0 + 1, iy1 - iy0 + 1);
        // the gate, in the front (south) band, away from the corner towers
        const gw = 2, gx = R(cx0 + 4, cx1 - 4 - gw + 1);
        gate(gx, gw, cy1 + 1, Y1 + 3);
        vEdge(edgeWallsThick, gx, cy1 + 1, Y1); vEdge(edgeWallsThick, gx + gw, cy1 + 1, Y1);
        for (let x = gx; x < gx + gw; x++) { edgeDoors.add('H:' + x + ',' + (cy1 + 1)); edgeDoors.add('H:' + x + ',' + (Y1 + 4)); edgeDoors.add('H:' + x + ',' + (iy1 + 1)); }
        // doors from the corridor ring into the inner space: one in the middle of each other side (and sometimes a second)
        const mx = Math.floor((ix0 + ix1) / 2), my = Math.floor((iy0 + iy1) / 2);
        door(mx, iy0, 'N'); door(ix0, my, 'W'); door(ix1, my, 'E');
        if (ix1 - ix0 > 12) { door(R(ix0 + 2, mx - 2), iy0, 'N'); }
        if (iy1 - iy0 > 12) { door(ix0, R(iy0 + 2, my - 2), 'W'); door(ix1, R(my + 2, iy1 - 2), 'E'); }
        // the rooms: back band with the great hall, side bands, front band either side of the gate
        const back = R(9, 13);
        band(cx0, Y0, cx1 - cx0 + 1, bs, false, 'S', hall ? 0 : back, null);
        band(X0, cy0, bs, cy1 - cy0 + 1, true, 'E', 0, null);
        band(cx1 + 1, cy0, bs, cy1 - cy0 + 1, true, 'W', 0, null);
        band(cx0, cy1 + 1, gx - cx0, bs, false, 'N', 0, ['barracks', 'store', 'armory', 'kitchen']);
        band(gx + gw, cy1 + 1, cx1 - (gx + gw) + 1, bs, false, 'N', 0, ['barracks', 'store', 'armory', 'kitchen']);
        // towers in the four corners
        tower(X0, Y0, bs, 'E'); tower(X1 - bs + 1, Y0, bs, 'W'); tower(X0, Y1 - bs + 1, bs, 'E'); tower(X1 - bs + 1, Y1 - bs + 1, bs, 'W');
        // inside: a hall, or an open courtyard with a well
        const inner = { x: ix0, y: iy0, w: ix1 - ix0 + 1, h: iy1 - iy0 + 1 };
        rooms.push(inner);
        if (hall) plans.push({ r: inner, kind: 'hall' });
        else if (inner.w >= 8 && inner.h >= 8) {
            const cx = (ix0 + ix1 + 1) / 2, cy = (iy0 + iy1 + 1) / 2, cells = [];
            for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= 1.6) cells.push([x, y]);
            roundTowers.push({ id: 'cw0', c: [cx, cy, 1.6], cells, doorKey: null, thin: true });
        }
        return true;
    }
    // ---- a palace: a back block with the great hall and one or two wings running forward round a walled courtyard (U or L) ----
    function wings() {
        const Tw = R(5, 6), Tb = R(7, 9), variant = R(0, 3), hasL = variant !== 2, hasR = variant !== 1; // mostly U, sometimes an L either way
        if (AW < 2 * Tw + 10 || AH < Tb + 10) return null;
        const cw = AW >= 2 * Tw + 14 ? R(Math.max(2 * Tw + 10, Math.round(AW * 0.8)), AW) : AW;
        const X0 = m + R(0, AW - cw), Y0 = m, X1 = X0 + cw - 1, Y1 = Y0 + AH - 1;
        const tsb = Tb - 2, tsw = Tw - 2, yc = Y0 + Tb, courtL = hasL ? X0 + Tw : X0, courtR = hasR ? X1 - Tw : X1;
        fill(X0, Y0, cw, Tb); fill(courtL, yc, courtR - courtL + 1, Y1 - yc + 1);
        if (hasL) fill(X0, yc, Tw, Y1 - yc + 1);
        if (hasR) fill(X1 - Tw + 1, yc, Tw, Y1 - yc + 1);
        // walls between the corridors and the courtyard
        hEdge(edgeWallsThick, courtL, courtR, yc);
        if (hasL) { vEdge(edgeWallsThick, courtL, yc, Y1); hEdge(edgeWalls, X0, X0 + Tw - 3, yc); door(courtL, R(yc + 2, Y1 - tsw - 2), 'W'); }
        if (hasR) { vEdge(edgeWallsThick, courtR + 1, yc, Y1); hEdge(edgeWalls, X1 - Tw + 3, X1, yc); door(courtR, R(yc + 2, Y1 - tsw - 2), 'E'); }
        door(Math.floor((courtL + courtR) / 2), yc, 'N');
        // gate in the front of the courtyard
        const gw = 2, gx = Math.floor((courtL + courtR - gw + 1) / 2);
        gate(gx, gw, Y1 + 1, Y1 + 3);
        for (let x = gx; x < gx + gw; x++) { edgeDoors.add('H:' + x + ',' + (Y1 + 1)); edgeDoors.add('H:' + x + ',' + (Y1 + 4)); }
        // rooms: back block with the great hall in the middle, a band down each wing
        band(X0 + tsb, Y0, cw - 2 * tsb, tsb, false, 'S', R(9, 13), null);
        if (hasL) band(X0, yc, tsw, Y1 - tsw + 1 - yc, true, 'E', 0, null);
        if (hasR) band(X1 - tsw + 1, yc, tsw, Y1 - tsw + 1 - yc, true, 'W', 0, null);
        // towers: the two back corners (big) and the wing ends
        tower(X0, Y0, tsb, 'E'); tower(X1 - tsb + 1, Y0, tsb, 'W');
        if (hasL) tower(X0, Y1 - tsw + 1, tsw, 'E');
        if (hasR) tower(X1 - tsw + 1, Y1 - tsw + 1, tsw, 'W');
        const courtW = courtR - courtL + 1, courtH = Y1 - yc + 1;
        rooms.push({ x: courtL, y: yc, w: courtW, h: courtH });
        // outbuildings against the front corners, and a well in the middle
        if (courtW >= 14 && courtH >= 9) {
            [[courtL + 1, 'E'], [courtR - 3, 'W']].forEach(([sx, side]) => {
                const sy = Y1 - 4, r = { x: sx, y: sy, w: 4, h: 4 };
                boxEdges(edgeWalls, sx, sy, 4, 4); rooms.push(r); door(side === 'E' ? sx + 3 : sx, sy + 1, side);
                plans.push({ r, kind: R(0, 1) ? 'barracks' : 'store' });
            });
        }
        if (courtW >= 8 && courtH >= 8) {
            const cx = (courtL + courtR + 1) / 2, cy = yc + 3.5, cells = [];
            for (let y = yc + 2; y <= yc + 5; y++) for (let x = courtL; x <= courtR; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= 1.6) cells.push([x, y]);
            roundTowers.push({ id: 'cw0', c: [cx, cy, 1.6], cells, doorKey: null, thin: true });
        }
        return true;
    }
}


// ===================== Furnishing =====================
// Puts furniture in rooms by what each one is for; \`plans\` is [{ r: {x, y, w, h}, kind }]. Never on a square beside a door.
function furnishPlans(R, plans, edgeDoors, furniture) {
    const doorCells = new Set();
    edgeDoors.forEach(k => { const p = k.split(':'), xy = p[1].split(',').map(Number); if (p[0] === 'H') { doorCells.add(xy[0] + ',' + (xy[1] - 1)); doorCells.add(xy[0] + ',' + xy[1]); } else { doorCells.add((xy[0] - 1) + ',' + xy[1]); doorCells.add(xy[0] + ',' + xy[1]); } });
    const used = new Set();
    const put = (r, piece, edgeOnly) => {
        const cells = [];
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
            if (doorCells.has(x + ',' + y) || used.has(x + ',' + y)) continue;
            if (edgeOnly && !(x === r.x || x === r.x + r.w - 1 || y === r.y || y === r.y + r.h - 1)) continue;
            cells.push([x, y]);
        }
        if (!cells.length) return;
        const c = cells[R(0, cells.length - 1)];
        used.add(c[0] + ',' + c[1]); furniture.push({ x: c[0], y: c[1], piece });
    };
    plans.forEach(p => {
        const r = p.r, area = r.w * r.h;
        if (p.kind === 'hall') { const n = Math.max(2, Math.min(5, Math.floor(area / 12))); for (let i = 0; i < n; i++) put(r, 'table'); put(r, 'stove', true); }
        else if (p.kind === 'bed') { put(r, 'bed', true); if (area >= 14) put(r, 'bed', true); if (area >= 12) put(r, 'table'); }
        else if (p.kind === 'kitchen') { put(r, 'stove', true); put(r, 'table'); put(r, 'shelf', true); }
        else if (p.kind === 'armory') { put(r, 'shelf', true); put(r, 'shelf', true); if (area >= 14) put(r, 'shelf', true); }
        else if (p.kind === 'study') { put(r, 'table'); put(r, 'shelf', true); }
        else if (p.kind === 'store') { put(r, 'shelf', true); put(r, 'shelf', true); put(r, 'table'); }
        else if (p.kind === 'barracks') { const n = Math.min(6, Math.max(2, Math.floor(area / 6))); for (let i = 0; i < n; i++) put(r, 'bed', true); }
        else if (p.kind === 'tavern') { put(r, 'bar', true); put(r, 'bar', true); const n = Math.max(2, Math.min(5, Math.floor(area / 8))); for (let i = 0; i < n; i++) put(r, 'table'); put(r, 'stove', true); }
        else if (p.kind === 'smithy') { put(r, 'stove', true); put(r, 'stove', true); put(r, 'shelf', true); put(r, 'table'); }
        else if (p.kind === 'temple') { for (let i = 0; i < 4; i++) put(r, 'shelf', true); put(r, 'table'); put(r, 'table'); }
        else if (p.kind === 'house') { put(r, 'bed', true); if (area >= 15) put(r, 'bed', true); put(r, 'table'); put(r, 'stove', true); }
        else if (p.kind === 'shop') { put(r, 'shelf', true); put(r, 'shelf', true); put(r, 'shelf', true); put(r, 'table'); }
    });
}

// ===================== City =====================
// A walled town on a plain: streets out from a market square and round it, blocks of simple buildings along them (a temple, taverns,
// a smithy and shops among the houses), an optional citadel inside its own wall, a river or a coast with bridges, a wall with gates
// where the roads leave, and fields and woods outside. The ground inside the town is left as bare paper so it reads like the maps
// it is modelled on; the fields, woods and water outside are painted terrain.
function generateCity(rng, cols, rows, opts) {
    opts = opts || {};
    const R = (a, b) => a + Math.floor(rng() * (b - a + 1)), chance = p => rng() < p;
    const irng = opts.irng || rng, IR = (a, b) => a + Math.floor(irng() * (b - a + 1)), ichance = p => irng() < p; // the inside seed: what each building is, what is in it, and the names
    const W = cols, H = rows;
    const grid = Array.from({ length: H }, () => Array(W).fill('wall'));
    const edgeWalls = new Set(), edgeWallsThick = new Set(), edgeDoors = new Set();
    const rooms = [], furniture = [], roundTowers = [], plans = [], stairs = [];
    const water = Array.from({ length: H }, () => new Uint8Array(W));
    const road = Array.from({ length: H }, () => new Uint8Array(W)); // 1 street, 2 road outside the walls, 3 bridge
    const reserved = Array.from({ length: H }, () => new Uint8Array(W));
    const city = Array.from({ length: H }, () => new Uint8Array(W)), foot = Array.from({ length: H }, () => new Uint8Array(W));
    const n1 = valueNoise2D(rng, W, H, 7), n2 = valueNoise2D(rng, W, H, 5);
    const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
    const fill = (x, y, w, h) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (inMap(i, j)) grid[j][i] = 'floor'; };
    const hEdge = (set, x0, x1, y) => { for (let x = x0; x <= x1; x++) set.add('H:' + x + ',' + y); };
    const vEdge = (set, x, y0, y1) => { for (let y = y0; y <= y1; y++) set.add('V:' + x + ',' + y); };
    const boxEdges = (set, x, y, w, h) => { hEdge(set, x, x + w - 1, y); hEdge(set, x, x + w - 1, y + h); vEdge(set, x, y, y + h - 1); vEdge(set, x + w, y, y + h - 1); };
    const door = (x, y, side) => edgeDoors.add(side === 'N' ? 'H:' + x + ',' + y : side === 'S' ? 'H:' + x + ',' + (y + 1) : side === 'W' ? 'V:' + x + ',' + y : 'V:' + (x + 1) + ',' + y);

    // ---- water: a river, a coast, or none
    const kind = ['river', 'coast', 'none'].includes(opts.water) ? opts.water : ['river', 'river', 'coast', 'none'][R(0, 3)];
    if (kind === 'coast') {
        const side = R(0, 3), depth = R(5, Math.max(6, Math.round(Math.min(W, H) * 0.2)));
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const d = side === 0 ? y : side === 1 ? H - 1 - y : side === 2 ? x : W - 1 - x;
            if (d < depth + (n1[y][x] - 0.5) * 9) water[y][x] = 1;
        }
    } else if (kind === 'river') {
        const vert = chance(0.5), len = vert ? H : W, span = vert ? W : H;
        const hw = R(2, 3) / 2 + 0.5, amp = R(2, 5), fr = 0.1 + rng() * 0.1, ph = rng() * 6.28, base = R(Math.round(span * 0.22), Math.round(span * 0.78));
        for (let t = 0; t < len; t++) {
            const c = base + Math.sin(t * fr + ph) * amp + Math.sin(t * fr * 2.3 + ph * 2) * amp * 0.4;
            for (let p = Math.floor(c - hw - 1); p <= Math.ceil(c + hw + 1); p++) {
                if (Math.abs(p - c) > hw) continue;
                const x = vert ? p : t, y = vert ? t : p;
                if (inMap(x, y)) water[y][x] = 1;
            }
        }
    }
    // ---- the town's outline: an irregular blob, never on water
    const ccx = W / 2 + R(-Math.round(W * 0.05), Math.round(W * 0.05)), ccy = H / 2 + R(-Math.round(H * 0.05), Math.round(H * 0.05));
    const rx = W * (0.35 + rng() * 0.08), ry = H * (0.35 + rng() * 0.08);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const d = Math.pow((x + 0.5 - ccx) / rx, 2) + Math.pow((y + 0.5 - ccy) / ry, 2);
        foot[y][x] = d < 0.9 + (n1[y][x] - 0.5) * 0.45 ? 1 : 0;
        city[y][x] = foot[y][x] && !water[y][x] ? 1 : 0;
    }
    // ---- streets: a square in the middle, roads out from it (some leave through the wall), and one or two rings
    const mark = (px, py, w, v) => {
        for (let dy = 0; dy < w; dy++) for (let dx = 0; dx < w; dx++) {
            const x = Math.round(px) + dx, y = Math.round(py) + dy;
            if (!inMap(x, y)) continue;
            if (water[y][x]) { water[y][x] = 0; road[y][x] = 3; city[y][x] = foot[y][x]; continue; } // a bridge
            if (road[y][x] === 0 || road[y][x] > v) road[y][x] = v;
        }
    };
    const plazaR = opts.village ? R(2, 3) : R(3, 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x + 0.5 - ccx, y + 0.5 - ccy) <= plazaR && !water[y][x]) { road[y][x] = 1; city[y][x] = 1; }
    const village = !!opts.village;
    const spokes = village ? R(3, 4) : R(4, 6), a0 = rng() * 6.28, gates = [];
    for (let i = 0; i < spokes; i++) {
        let ang = a0 + i * 6.2832 / spokes + (rng() - 0.5) * 0.5, px = ccx, py = ccy;
        const leaves = chance(0.55) || i < 2;
        for (let step = 0; step < 400; step++) {
            px += Math.cos(ang) * 0.6; py += Math.sin(ang) * 0.6; ang += (rng() - 0.5) * 0.1;
            const gx = Math.round(px), gy = Math.round(py);
            if (gx < 0 || gy < 0 || gx >= W - 1 || gy >= H - 1) break;
            const inside = foot[gy][gx] === 1;
            if (!inside && !leaves) break;
            mark(px, py, 2, inside ? 1 : 2);
        }
    }
    [0.46, 0.74].forEach(f => {
        if (village || !chance(f < 0.5 ? 0.9 : 0.6)) return;
        const ph2 = rng() * 6.28;
        for (let t = 0; t < 360; t += 2) {
            const a = t * Math.PI / 180, wob = 1 + Math.sin(a * 3 + ph2) * 0.06;
            const px = ccx + Math.cos(a) * rx * f * wob, py = ccy + Math.sin(a) * ry * f * wob, gx = Math.round(px), gy = Math.round(py);
            if (inMap(gx, gy) && city[gy][gx] === 1) mark(px, py, 1, 1);
        }
    });
    // a bridge is part of the town
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (road[y][x] === 3) { grid[y][x] = 'floor'; }
    // ---- the citadel: a walled yard in the town with a keep and towers
    let cit = null;
    if (opts.citadel !== false && chance(0.7)) {
        for (let tries = 0; tries < 40 && !cit; tries++) {
            const ang = rng() * 6.28, dist = 0.5 * Math.min(rx, ry), cw = R(12, 16), ch = R(10, 13);
            const x0 = Math.round(ccx + Math.cos(ang) * dist * (rx / Math.min(rx, ry)) - cw / 2), y0 = Math.round(ccy + Math.sin(ang) * dist * (ry / Math.min(rx, ry)) - ch / 2);
            let ok = x0 >= 1 && y0 >= 1 && x0 + cw < W - 1 && y0 + ch < H - 1 && Math.hypot(x0 + cw / 2 - ccx, y0 + ch / 2 - ccy) > plazaR + Math.max(cw, ch) / 2 - 2;
            for (let y = y0 - 1; y <= y0 + ch && ok; y++) for (let x = x0 - 1; x <= x0 + cw && ok; x++) if (!inMap(x, y) || !city[y][x] || water[y][x] || road[y][x] === 3) ok = false;
            if (ok) cit = { x: x0, y: y0, w: cw, h: ch };
        }
    }
    if (cit) {
        for (let y = cit.y - 1; y <= cit.y + cit.h; y++) for (let x = cit.x - 1; x <= cit.x + cit.w; x++) { reserved[y][x] = 1; if (y >= cit.y && y < cit.y + cit.h && x >= cit.x && x < cit.x + cit.w) road[y][x] = 0; }
        fill(cit.x, cit.y, cit.w, cit.h); boxEdges(edgeWallsThick, cit.x, cit.y, cit.w, cit.h);
        const toward = Math.abs(ccx - (cit.x + cit.w / 2)) > Math.abs(ccy - (cit.y + cit.h / 2)) ? (ccx > cit.x + cit.w / 2 ? 'E' : 'W') : (ccy > cit.y + cit.h / 2 ? 'S' : 'N');
        door(toward === 'E' ? cit.x + cit.w - 1 : toward === 'W' ? cit.x : cit.x + Math.floor(cit.w / 2), toward === 'S' ? cit.y + cit.h - 1 : toward === 'N' ? cit.y : cit.y + Math.floor(cit.h / 2), toward);
        rooms.push({ x: cit.x, y: cit.y, w: cit.w, h: cit.h });
        // towers in the two back corners, a keep between them
        const roundT = !!opts.roundTowers;
        const back = toward === 'S' ? 'N' : toward === 'N' ? 'S' : toward === 'E' ? 'W' : 'E';
        const corner = (cx, cy) => {
            const mid = 1, rcx = cx + 1.5, rcy = cy + 1.5; stairs.push([cx + 1, cy + 1]); rooms.push({ x: cx, y: cy, w: 3, h: 3 });
            if (!roundT) { boxEdges(edgeWallsThick, cx, cy, 3, 3); door(toward === 'E' ? cx + 2 : toward === 'W' ? cx : cx + 1, toward === 'S' ? cy + 2 : toward === 'N' ? cy : cy + 1, toward); return; }
            const cells = [];
            for (let y = cy; y < cy + 3; y++) for (let x = cx; x < cx + 3; x++) if (Math.hypot(x + 0.5 - rcx, y + 0.5 - rcy) <= 1.8) cells.push([x, y]);
            roundTowers.push({ id: 'cc' + roundTowers.length, c: [rcx, rcy, 1.8], cells, doorKey: toward === 'E' ? 'V:' + (cx + 3) + ',' + (cy + 1) : toward === 'W' ? 'V:' + cx + ',' + (cy + 1) : toward === 'S' ? 'H:' + (cx + 1) + ',' + (cy + 3) : 'H:' + (cx + 1) + ',' + cy });
        };
        const corners = back === 'N' ? [[cit.x, cit.y], [cit.x + cit.w - 3, cit.y]] : back === 'S' ? [[cit.x, cit.y + cit.h - 3], [cit.x + cit.w - 3, cit.y + cit.h - 3]] : back === 'W' ? [[cit.x, cit.y], [cit.x, cit.y + cit.h - 3]] : [[cit.x + cit.w - 3, cit.y], [cit.x + cit.w - 3, cit.y + cit.h - 3]];
        corners.forEach(c => corner(c[0], c[1]));
        const kw = Math.min(cit.w - 4, R(5, 7)), kh = Math.min(cit.h - 4, R(4, 6));
        const kx = back === 'E' ? cit.x + cit.w - kw - 1 : back === 'W' ? cit.x + 1 : cit.x + Math.floor((cit.w - kw) / 2);
        const ky = back === 'S' ? cit.y + cit.h - kh - 1 : back === 'N' ? cit.y + 1 : cit.y + Math.floor((cit.h - kh) / 2);
        boxEdges(edgeWallsThick, kx, ky, kw, kh);
        const kd = toward;
        door(kd === 'E' ? kx + kw - 1 : kd === 'W' ? kx : kx + Math.floor(kw / 2), kd === 'S' ? ky + kh - 1 : kd === 'N' ? ky : ky + Math.floor(kh / 2), kd);
        const keep = { x: kx, y: ky, w: kw, h: kh }; rooms.push(keep); plans.push({ r: keep, kind: 'hall' });
    }
    // ---- the buildings: packed along the streets
    const buildings = [];
    const cityCells = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (city[y][x]) cityCells.push([x, y]);
    const attempts = cityCells.length * (village ? 3 : 9);
    for (let n = 0; n < attempts && cityCells.length; n++) {
        const c = cityCells[R(0, cityCells.length - 1)];
        let w = R(3, 5) + (chance(0.15) ? 1 : 0), h = R(3, 5); if (chance(0.5)) { const t = w; w = h; h = t; }
        const x = c[0], y = c[1], gap = chance(village ? 0.8 : 0.3) ? 1 : 0;
        let ok = true;
        for (let j = y - gap; j < y + h + gap && ok; j++) for (let i = x - gap; i < x + w + gap && ok; i++) {
            const inside = i >= x && i < x + w && j >= y && j < y + h;
            if (!inMap(i, j)) { if (inside) ok = false; continue; }
            if (inside) { if (!city[j][i] || water[j][i] || road[j][i] !== 0 || reserved[j][i] || grid[j][i] !== 'wall') ok = false; }
            else if (grid[j][i] === 'floor' && road[j][i] !== 3) ok = false;
        }
        if (!ok) continue;
        // it must reach a street: straight out from the middle of one side, directly onto one or along a short alley to one
        let best = null;
        [['N', x + Math.floor(w / 2), y - 1, 0, -1], ['S', x + Math.floor(w / 2), y + h, 0, 1], ['W', x - 1, y + Math.floor(h / 2), -1, 0], ['E', x + w, y + Math.floor(h / 2), 1, 0]].forEach(([sd, sx, sy, dx, dy]) => {
            for (let i = 0; i <= 6; i++) {
                const px = sx + dx * i, py = sy + dy * i;
                if (!inMap(px, py) || !city[py][px] || reserved[py][px] || water[py][px] || grid[py][px] === 'floor') return;
                if (road[py][px] === 1) { if (!best || i < best.len) best = { side: sd, len: i, sx, sy, dx, dy }; return; }
                if (road[py][px] !== 0) return;
            }
        });
        if (!best) continue;
        const side = best.side;
        for (let i = 0; i < best.len; i++) road[best.sy + best.dy * i][best.sx + best.dx * i] = 1; // the alley
        fill(x, y, w, h); boxEdges(edgeWalls, x, y, w, h);
        door(side === 'E' ? x + w - 1 : side === 'W' ? x : x + Math.floor(w / 2), side === 'S' ? y + h - 1 : side === 'N' ? y : y + Math.floor(h / 2), side);
        const r = { x, y, w, h }; rooms.push(r); buildings.push(r);
    }
    // what each building is: the biggest a temple, then taverns, a smithy, shops, and houses
    const byArea = buildings.slice().sort((a, b) => b.w * b.h - a.w * a.h);
    byArea.forEach((r, i) => {
        let k;
        if (village) k = i === 0 ? 'tavern' : i === 1 ? 'smithy' : i === 2 ? 'shop' : ichance(0.85) ? 'house' : null;
        else if (i === 0 && r.w * r.h >= 16) k = 'temple';
        else if (i >= 1 && i <= 3) k = 'tavern';
        else if (i === 4 || i === 5) k = 'smithy';
        else k = ichance(0.22) ? 'shop' : ichance(0.65) ? 'house' : null;
        if (k) plans.push({ r, kind: k });
    });
    furnishPlans(IR, plans, edgeDoors, furniture);
    // ---- a name over each building that is more than a house
    const labels = [];
    if (opts.labels !== false) {
        const taverns = ['The Gilded Boar', 'The Tipsy Goat', 'The Rusty Anchor', 'The Golden Stag', 'The Laughing Crow', 'The Sleeping Bear', 'The Copper Kettle'];
        const shops = ['Baker', 'Tailor', 'Herbalist', 'Chandler', 'General store', 'Cobbler', 'Butcher', 'Potter', 'Scribe'];
        let ti = IR(0, taverns.length - 1), si = IR(0, shops.length - 1);
        plans.forEach(p => {
            const text = p.kind === 'temple' ? 'Temple' : p.kind === 'tavern' ? taverns[ti++ % taverns.length] : p.kind === 'smithy' ? 'Smithy' : p.kind === 'shop' ? shops[si++ % shops.length] : p.kind === 'hall' ? 'Keep' : null;
            if (text) labels.push({ x: p.r.x + p.r.w / 2, y: p.r.y + p.r.h / 2, text, maxW: p.r.w - 0.4 });
        });
    }
    // ---- a village: a well in the square, a cart, haystacks and trees round the edge
    const objects = [];
    if (village) {
        objects.push({ kind: 'well', x: Math.round(ccx) - 1, y: Math.round(ccy) - 1, w: 2, h: 2 });
        if (chance(0.7)) objects.push({ kind: 'cart', x: Math.round(ccx) + plazaR, y: Math.round(ccy) - 1, w: 2, h: 3 });
        const taken = [];
        for (let n = 0; n < W * H / 6 && taken.length < Math.round(W * H / 40); n++) {
            const x = R(1, W - 4), y = R(1, H - 4);
            let ok = true;
            for (let j = y; j < y + 3 && ok; j++) for (let i = x; i < x + 3 && ok; i++) if (!inMap(i, j) || water[j][i] || grid[j][i] === 'floor' || road[j][i] !== 0 || (city[j][i] && !(n2[j][i] > 0.55))) ok = false;
            if (ok && taken.some(t => Math.abs(t[0] - x) < 3 && Math.abs(t[1] - y) < 3)) ok = false;
            if (!ok) continue;
            taken.push([x, y]);
            objects.push(chance(0.18) ? { kind: 'haystack', x, y, w: 2, h: 2 } : { kind: chance(0.6) ? 'tree' : 'pine', x, y, w: 3, h: 3 });
        }
    }
    // ---- the wall, with a gate wherever a road leaves
    const gateCells = [];
    if (opts.walls !== false) {
        const dirs = [[0, -1, 'H', 0, 0], [0, 1, 'H', 0, 1], [-1, 0, 'V', 0, 0], [1, 0, 'V', 1, 0]];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            if (!city[y][x]) continue;
            dirs.forEach(([dx, dy, type, ox, oy]) => {
                const nx = x + dx, ny = y + dy;
                if (!inMap(nx, ny) || city[ny][nx] || water[ny][nx]) return;
                const key = type + ':' + (x + ox) + ',' + (y + oy);
                if (road[y][x] !== 0 && road[ny][nx] === 2) { edgeDoors.add(key); gateCells.push([x, y]); } else edgeWallsThick.add(key);
            });
        }
    }
    // ---- towers on the wall: either side of each gate, and every so often along it
    if (opts.walls !== false && opts.towers !== false) {
        const cand = [];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            if (!city[y][x] || road[y][x] !== 0 || grid[y][x] !== 'wall') continue;
            [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([dx, dy]) => {
                const nx = x + dx, ny = y + dy;
                if (!inMap(nx, ny) || city[ny][nx] || water[ny][nx] || grid[ny][nx] !== 'wall' || road[ny][nx] !== 0) return;
                const px = dy ? x + 1 : x, py = dy ? y : y + 1, qx = dy ? x + 1 : nx, qy = dy ? ny : y + 1; // the neighbour along the wall, and its outside partner
                if (!inMap(px, py) || !inMap(qx, qy) || !city[py][px] || road[py][px] !== 0 || grid[py][px] !== 'wall' || city[qy][qx] || water[qy][qx] || grid[qy][qx] !== 'wall' || road[qy][qx] !== 0) return;
                const wk = dy ? 'H:' + x + ',' + Math.max(y, ny) : 'V:' + Math.max(x, nx) + ',' + y, wk2 = dy ? 'H:' + (x + 1) + ',' + Math.max(y, ny) : 'V:' + Math.max(x, nx) + ',' + (y + 1);
                if (!edgeWallsThick.has(wk) || !edgeWallsThick.has(wk2)) return;
                const near = gateCells.some(c => Math.max(Math.abs(c[0] - x), Math.abs(c[1] - y)) <= 4);
                cand.push({ x, y, dx, dy, nx, ny, wk, wk2, near });
            });
        }
        const chosen = [];
        const taken = (c, gap) => chosen.some(t => Math.max(Math.abs(t.x - c.x), Math.abs(t.y - c.y)) < gap);
        for (let i = cand.length - 1; i > 0; i--) { const j = R(0, i), t = cand[i]; cand[i] = cand[j]; cand[j] = t; }
        cand.filter(c => c.near).forEach(c => { if (!taken(c, 5)) chosen.push(c); });
        cand.filter(c => !c.near).forEach(c => { if (!taken(c, 11)) chosen.push(c); });
        chosen.forEach((c, n) => {
            const horiz = !!c.dy, bx = horiz ? c.x : Math.min(c.x, c.nx), by = horiz ? Math.min(c.y, c.ny) : c.y;
            fill(bx, by, 2, 2);
            edgeWallsThick.delete(c.wk); edgeWallsThick.delete(c.wk2);
            const side = horiz ? (c.y < c.ny ? 'N' : 'S') : (c.x < c.nx ? 'W' : 'E'); // the side facing into the town
            stairs.push([c.x, c.y]);
            if (opts.roundTowers) {
                const cells = [[bx, by], [bx + 1, by], [bx, by + 1], [bx + 1, by + 1]];
                const dk = side === 'N' ? 'H:' + c.x + ',' + c.y : side === 'S' ? 'H:' + c.x + ',' + (c.y + 1) : side === 'W' ? 'V:' + c.x + ',' + c.y : 'V:' + (c.x + 1) + ',' + c.y;
                roundTowers.push({ id: 'cw' + n, c: [bx + 1, by + 1, 1.5], cells, doorKey: dk, thin: false });
            } else { boxEdges(edgeWallsThick, bx, by, 2, 2); door(c.x, c.y, side); }
            rooms.push({ x: bx, y: by, w: 2, h: 2 });
        });
    }
    // ---- outside: fields and woods, the water, and the roads out
    const terrain = [], roads = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (grid[y][x] === 'floor') continue;
        if (water[y][x]) terrain.push([x, y, 'water']);
        else if (!city[y][x]) terrain.push([x, y, n2[y][x] > 0.64 && Math.hypot(x - ccx, y - ccy) > Math.max(rx, ry) * 1.15 ? 'forest' : 'plains']);
        if (road[y][x] === 1) roads.push([x, y, 'stone']); else if (road[y][x] === 2) roads.push([x, y, 'dirt']);
    }
    return { grid, rooms, edgeWalls, edgeWallsThick, edgeDoors, roundTowers, stairs, furniture, passage: new Set(), terrain, roads, objects, labels };
}

// ===================== Castle upper floors =====================
// An upper floor of a finished castle: the wall walk (two squares wide round the outside) joining every tower, and the towers
// themselves, with a spiral stair down in each tower; a second extra floor is the tower tops, reached by a second spiral.
function castleUpperLevels(gr, cols, rows, floors, rng, irng) {
    const R = (a, b) => a + Math.floor(rng() * (b - a + 1));
    const stairs = gr.stairs || [];
    if (!stairs.length) return [];
    const open = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && gr.grid[y][x] !== 'wall';
    const inRing = (x, y) => {
        if (!open(x, y)) return false;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (!open(x + dx, y + dy)) return true;
        return false;
    };
    const roundCells = new Set();
    (gr.roundTowers || []).forEach(t => t.cells.forEach(c => roundCells.add(c[0] + ',' + c[1])));
    const squareRects = [];
    stairs.forEach(([sx, sy]) => (gr.rooms || []).forEach(r => {
        if (sx >= r.x && sx < r.x + r.w && sy >= r.y && sy < r.y + r.h && r.w <= 5 && r.h <= 5 && !roundCells.has(sx + ',' + sy)) squareRects.push(r);
    }));
    const towerCells = new Set(roundCells);
    squareRects.forEach(r => { for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) towerCells.add(i + ',' + j); });
    const next = ([sx, sy]) => [[sx + 1, sy], [sx - 1, sy], [sx, sy + 1], [sx, sy - 1]].find(c => towerCells.has(c[0] + ',' + c[1])) || [sx, sy];
    // the keep: the biggest room that is not a tower, if it stands clear of the wall walk; a stair up to it is added on the ground floor
    let keep = null;
    (gr.rooms || []).forEach(r => { if (r.w > 5 || r.h > 5) { if (!keep || r.w * r.h > keep.w * keep.h) keep = r; } });
    if (keep) { for (let j = keep.y - 1; keep && j <= keep.y + keep.h; j++) for (let i = keep.x - 1; i <= keep.x + keep.w; i++) if (inRing(i, j)) { keep = null; break; } }
    let keepStair = null;
    if (keep && floors > 0) {
        const taken = new Set((gr.furniture || []).map(f => f.x + ',' + f.y));
        const cands = [];
        for (let j = keep.y + 1; j < keep.y + keep.h - 1; j++) for (let i = keep.x + 1; i < keep.x + keep.w - 1; i++) if (!taken.has(i + ',' + j) && open(i, j)) cands.push([i, j]);
        const mid = [keep.x + keep.w / 2, keep.y + keep.h / 2];
        cands.sort((a, b) => Math.hypot(a[0] - mid[0], a[1] - mid[1]) - Math.hypot(b[0] - mid[0], b[1] - mid[1]));
        keepStair = cands[0] || null;
        if (keepStair) (gr.furniture || (gr.furniture = [])).push({ x: keepStair[0], y: keepStair[1], piece: 'stairs-up' });
    }
    const dk = (x, y, side) => side === 'N' ? 'H:' + x + ',' + y : side === 'S' ? 'H:' + x + ',' + (y + 1) : side === 'W' ? 'V:' + x + ',' + y : 'V:' + (x + 1) + ',' + y;
    const make = (name, walk, furniture, links, withKeep) => {
        const grid = Array.from({ length: rows }, () => Array(cols).fill('wall'));
        const edgeWalls = new Set(), edgeWallsThick = new Set(), edgeDoors = new Set(), rooms = [], plans = [];
        let fl = furniture.slice();
        const fillRect = r => { for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) if (grid[j] && grid[j][i] !== undefined) grid[j][i] = 'floor'; };
        const box = (set, x, y, w, h) => { for (let i = 0; i < w; i++) { set.add('H:' + (x + i) + ',' + y); set.add('H:' + (x + i) + ',' + (y + h)); } for (let j = 0; j < h; j++) { set.add('V:' + x + ',' + (y + j)); set.add('V:' + (x + w) + ',' + (y + j)); } };
        if (walk) for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (inRing(x, y)) grid[y][x] = 'floor';
        towerCells.forEach(k => { const p = k.split(',').map(Number); if (grid[p[1]] && grid[p[1]][p[0]] !== undefined) grid[p[1]][p[0]] = 'floor'; });
        // square towers: walled, with a door onto the wall walk
        squareRects.forEach(r => {
            box(edgeWallsThick, r.x, r.y, r.w, r.h);
            if (!walk) return;
            const sides = [['N', r.x + Math.floor(r.w / 2), r.y - 1], ['S', r.x + Math.floor(r.w / 2), r.y + r.h], ['W', r.x - 1, r.y + Math.floor(r.h / 2)], ['E', r.x + r.w, r.y + Math.floor(r.h / 2)]];
            const s = sides.find(([sd, nx, ny]) => grid[ny] && grid[ny][nx] === 'floor');
            if (s) { const mx = s[0] === 'W' ? r.x : s[0] === 'E' ? r.x + r.w - 1 : s[1], my = s[0] === 'N' ? r.y : s[0] === 'S' ? r.y + r.h - 1 : s[2]; edgeDoors.add(dk(mx, my, s[0])); }
        });
        // round towers keep their circle outline, with a door onto the wall walk
        const rts = (gr.roundTowers || []).map(t => {
            let doorKey = null;
            if (walk) {
                const inside = new Set(t.cells.map(c => c[0] + ',' + c[1]));
                for (const [x, y] of t.cells) {
                    const nb = [[1, 0, 'E'], [-1, 0, 'W'], [0, 1, 'S'], [0, -1, 'N']].find(([dx, dy]) => !inside.has((x + dx) + ',' + (y + dy)) && grid[y + dy] && grid[y + dy][x + dx] === 'floor');
                    if (nb) { doorKey = dk(x, y, nb[2]); break; }
                }
            }
            return Object.assign({}, t, { doorKey });
        });
        // the keep's upper floor: a few rooms with doors between them, a stair down
        if (withKeep && keep && keepStair) {
            fillRect(keep); box(edgeWallsThick, keep.x, keep.y, keep.w, keep.h);
            const rects = [{ x: keep.x, y: keep.y, w: keep.w, h: keep.h }], want = R(3, 4);
            while (rects.length < want) {
                let best = -1, area = 0;
                rects.forEach((r, i) => { if ((r.w >= 6 || r.h >= 6) && r.w * r.h > area) { best = i; area = r.w * r.h; } });
                if (best < 0) break;
                const r = rects.splice(best, 1)[0], frac = 0.4 + rng() * 0.2, vertical = r.w >= r.h;
                if (vertical) {
                    const p = Math.max(3, Math.min(r.w - 3, Math.round(r.w * frac)));
                    for (let j = 0; j < r.h; j++) edgeWalls.add('V:' + (r.x + p) + ',' + (r.y + j));
                    edgeDoors.add('V:' + (r.x + p) + ',' + (r.y + Math.floor(r.h / 2)));
                    rects.push({ x: r.x, y: r.y, w: p, h: r.h }, { x: r.x + p, y: r.y, w: r.w - p, h: r.h });
                } else {
                    const p = Math.max(3, Math.min(r.h - 3, Math.round(r.h * frac)));
                    for (let i = 0; i < r.w; i++) edgeWalls.add('H:' + (r.x + i) + ',' + (r.y + p));
                    edgeDoors.add('H:' + (r.x + Math.floor(r.w / 2)) + ',' + (r.y + p));
                    rects.push({ x: r.x, y: r.y, w: r.w, h: p }, { x: r.x, y: r.y + p, w: r.w, h: r.h - p });
                }
            }
            rects.sort((a, b) => b.w * b.h - a.w * a.h).forEach((r, i) => { rooms.push(r); plans.push({ r, kind: i === 0 ? 'hall' : 'bed' }); });
            furnishPlans((a, b) => a + Math.floor((irng || rng)() * (b - a + 1)), plans, edgeDoors, fl);
            fl = fl.filter(f => !(f.x === keepStair[0] && f.y === keepStair[1]));
            fl.push({ x: keepStair[0], y: keepStair[1], piece: 'stairs-down' });
        }
        return { name, mode: 'castle', links, res: { grid, rooms, edgeWalls, edgeWallsThick, edgeDoors, roundTowers: rts, stairs: [], furniture: fl, moat: gr.moat || [], terrain: [], roads: [], objects: [], labels: [] } };
    };
    const upperFurn = [], upperLinks = [], topFurn = [], topLinks = [];
    stairs.forEach(s => {
        upperFurn.push({ x: s[0], y: s[1], piece: 'spiral-down' });
        upperLinks.push({ kind: 'cell', x: s[0], y: s[1], here: 'spiral-up', there: 'spiral-down' });
        if (floors > 1) { const n = next(s); upperFurn.push({ x: n[0], y: n[1], piece: 'spiral-up' }); topFurn.push({ x: n[0], y: n[1], piece: 'spiral-down' }); topLinks.push({ kind: 'cell', x: n[0], y: n[1], here: 'spiral-up', there: 'spiral-down' }); }
    });
    if (keepStair) upperLinks.push({ kind: 'cell', x: keepStair[0], y: keepStair[1], here: 'stairs-up', there: 'stairs-down' });
    const out = [make('Upper floor', true, upperFurn, upperLinks, true)];
    if (floors > 1) out.push(make('Tower tops', false, topFurn, topLinks, false));
    return out;
}

// ===================== Shared helpers for the smaller maps below =====================
function genKit(rng, cols, rows) {
    const R = (a, b) => a + Math.floor(rng() * (b - a + 1)), chance = p => rng() < p;
    const grid = Array.from({ length: rows }, () => Array(cols).fill('wall'));
    const edgeWalls = new Set(), edgeWallsThick = new Set(), edgeDoors = new Set();
    const inMap = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
    const fill = (x, y, w, h) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (inMap(i, j)) grid[j][i] = 'floor'; };
    const hEdge = (set, x0, x1, y) => { for (let x = x0; x <= x1; x++) set.add('H:' + x + ',' + y); };
    const vEdge = (set, x, y0, y1) => { for (let y = y0; y <= y1; y++) set.add('V:' + x + ',' + y); };
    const boxEdges = (set, x, y, w, h) => { hEdge(set, x, x + w - 1, y); hEdge(set, x, x + w - 1, y + h); vEdge(set, x, y, y + h - 1); vEdge(set, x + w, y, y + h - 1); };
    const door = (x, y, side) => edgeDoors.add(side === 'N' ? 'H:' + x + ',' + y : side === 'S' ? 'H:' + x + ',' + (y + 1) : side === 'W' ? 'V:' + x + ',' + y : 'V:' + (x + 1) + ',' + y);
    return { R, chance, grid, edgeWalls, edgeWallsThick, edgeDoors, inMap, fill, hEdge, vEdge, boxEdges, door };
}
const shipNames = ['The Salted Gull', 'The Crimson Tide', 'The Wandering Star', 'The Iron Kraken', 'The Silver Heron', 'The Black Pearl', 'The Dawn Treader', 'The Grey Albatross'];

// ===================== Forest and river (trees seen from above) =====================
function generateWoods(rng, cols, rows, o) {
    const k = genKit(rng, cols, rows), R = k.R, chance = k.chance, W = cols, H = rows;
    const n1 = valueNoise2D(rng, W, H, 6), n2 = valueNoise2D(rng, W, H, 3.5);
    const water = Array.from({ length: H }, () => new Uint8Array(W)), onPath = Array.from({ length: H }, () => new Uint8Array(W));
    const objects = [], furniture = [], roads = [];
    const vert = chance(0.5), ph = rng() * 6.28;
    let cross = null;
    if (o.river) {
        const len = vert ? H : W, span = vert ? W : H, hw = R(2, 3) / 2 + 0.6, amp = R(2, 4), fr = 0.12 + rng() * 0.1, base = R(Math.round(span * 0.3), Math.round(span * 0.7));
        const centre = t => base + Math.sin(t * fr + ph) * amp + Math.sin(t * fr * 2.1 + ph * 2) * amp * 0.35;
        for (let t = 0; t < len; t++) {
            const c = centre(t);
            for (let p = Math.floor(c - hw - 1); p <= Math.ceil(c + hw + 1); p++) if (Math.abs(p - c) <= hw) { const x = vert ? p : t, y = vert ? t : p; if (k.inMap(x, y)) water[y][x] = 1; }
        }
        // a path across the river on a plank bridge
        const bt = R(Math.round(len * 0.3), Math.round(len * 0.7)), c = centre(bt), bw = Math.round(hw * 2 + 3);
        cross = { t: bt, c, hw };
        objects.push(vert ? { kind: 'rug', color: 'brown', x: Math.round(c - bw / 2), y: bt - 1, w: bw, h: 2 } : { kind: 'rug', color: 'brown', x: bt - 1, y: Math.round(c - bw / 2), w: 2, h: bw });
    }
    // a dirt path along the other way (crossing the bridge), wandering a little
    const plen = vert ? W : H, pt = cross ? cross.t : R(Math.round((vert ? H : W) * 0.3), Math.round((vert ? H : W) * 0.7));
    for (let q = 0; q < plen; q++) {
        const off = Math.round(Math.sin(q * 0.35 + ph) * 1.2), x = vert ? q : pt + off, y = vert ? pt + off : q;
        if (!k.inMap(x, y)) continue;
        if (!water[y][x]) roads.push([x, y, 'dirt']);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (k.inMap(x + dx, y + dy)) onPath[y + dy][x + dx] = 1;
    }
    // a clearing with a campfire
    let cc = null;
    for (let tries = 0; tries < 60 && !cc; tries++) {
        const x = R(5, W - 6), y = R(5, H - 6);
        let ok = true;
        for (let j = y - 4; j <= y + 4 && ok; j++) for (let i = x - 4; i <= x + 4 && ok; i++) if (k.inMap(i, j) && (water[j][i] || onPath[j][i])) ok = false;
        if (ok) cc = [x, y];
    }
    if (cc) { furniture.push({ x: cc[0], y: cc[1], piece: 'campfire' }); [[-2, 1], [2, -1], [1, 2]].forEach(([dx, dy]) => { if (chance(0.8)) objects.push({ kind: 'rock', x: cc[0] + dx - 1, y: cc[1] + dy - 1, w: 2, h: 2 }); }); }
    // trees where the woods are thick, bushes round them, a few boulders
    const dens = Math.max(0.2, Math.min(0.9, o.density));
    const placed = [];
    const free = (x, y, gap) => !placed.some(t => Math.hypot(t.x - x, t.y - y) < gap);
    const target = Math.round(W * H * 0.085 * dens);
    for (let n = 0; n < target * 25 && placed.length < target; n++) {
        const x = R(0, W - 1), y = R(0, H - 1);
        if (water[y][x] || onPath[y][x] || (cc && Math.hypot(x - cc[0], y - cc[1]) < 4.2)) continue;
        if (n1[y][x] < 0.58 - dens * 0.3) continue;
        const pine = n2[y][x] > 0.52, size = pine ? 2 : 3;
        if (!free(x, y, pine ? 2.3 : 2.8)) continue;
        const ox = Math.max(0, Math.min(W - size, x - Math.floor(size / 2))), oy = Math.max(0, Math.min(H - size, y - Math.floor(size / 2)));
        placed.push({ x, y }); objects.push({ kind: pine ? 'pine' : 'tree', x: ox, y: oy, w: size, h: size });
    }
    for (let n = 0; n < target * 2 && objects.filter(q => q.kind === 'bush').length < Math.round(target * 0.7); n++) {
        const x = R(0, W - 1), y = R(0, H - 1);
        if (water[y][x] || onPath[y][x] || !free(x, y, 1.3) || n1[y][x] < 0.4) continue;
        placed.push({ x, y }); objects.push({ kind: 'bush', x, y, w: 1, h: 1 });
    }
    for (let n = 0; n < 40 && objects.filter(q => q.kind === 'rock').length < 4 + (cc ? 3 : 0); n++) {
        const x = R(0, W - 2), y = R(0, H - 2);
        if (water[y][x] || onPath[y][x] || !free(x, y, 3)) continue;
        placed.push({ x, y }); objects.push({ kind: 'rock', x, y, w: 2, h: 2 });
    }
    const terrain = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) terrain.push([x, y, water[y][x] ? 'water' : (n1[y][x] > 0.5 && !onPath[y][x] ? 'forest' : 'plains')]);
    return { grid: k.grid, rooms: [], edgeWalls: k.edgeWalls, edgeWallsThick: k.edgeWallsThick, edgeDoors: k.edgeDoors, furniture, objects, terrain, roads, labels: [] };
}

// ===================== Islands (in the sea, or floating in the sky) =====================
function generateIslands(rng, cols, rows, o) {
    const k = genKit(rng, cols, rows), R = k.R, chance = k.chance, W = cols, H = rows, sky = !!o.sky;
    const n1 = valueNoise2D(rng, W, H, 4), n2 = valueNoise2D(rng, W, H, 3);
    const land = Array.from({ length: H }, () => new Uint8Array(W)); // 0 none, 1 rim, 2 plains, 3 forest, 4 hills
    const isl = [];
    const maxR = Math.max(3, Math.min(Math.floor(W / 4), Math.floor(H / 3)));
    const want = Math.max(2, Math.min(14, o.count || 6));
    for (let tries = 0; tries < want * 80 && isl.length < want; tries++) {
        const big = isl.length === 0, rx = big ? R(Math.max(4, maxR - 1), maxR + 1) : R(3, maxR), ry = big ? R(Math.max(4, maxR - 1), maxR) : R(2, Math.max(3, maxR - 1));
        const cx = R(rx + 2, W - rx - 3), cy = R(ry + 2, H - ry - 3);
        if (cx - rx < 1 || cy - ry < 1 || cx + rx > W - 2 || cy + ry > H - 2) continue;
        if (isl.some(q => Math.hypot((q.cx - cx), (q.cy - cy) * (W / H)) < (Math.max(q.rx, q.ry) + Math.max(rx, ry)) * 0.95 + 2)) continue;
        isl.push({ cx, cy, rx, ry });
    }
    isl.forEach((q, qi) => {
        for (let y = Math.max(0, Math.floor(q.cy - q.ry - 2)); y <= Math.min(H - 1, Math.ceil(q.cy + q.ry + 2)); y++) for (let x = Math.max(0, Math.floor(q.cx - q.rx - 2)); x <= Math.min(W - 1, Math.ceil(q.cx + q.rx + 2)); x++) {
            const d = Math.pow((x + 0.5 - q.cx) / q.rx, 2) + Math.pow((y + 0.5 - q.cy) / q.ry, 2) + (n1[y][x] - 0.5) * 0.6;
            if (d >= 1) continue;
            q.cells = q.cells || [];
            const v = d > 0.66 ? 1 : n2[y][x] > 0.64 && d < 0.4 ? 4 : n2[y][x] < 0.42 ? 3 : 2;
            land[y][x] = v; q.cells.push([x, y, d]);
        }
    });
    const objects = [], furniture = [], rooms = [], plans = [], taken = [];
    // a hut on the bigger islands
    isl.forEach((q, qi) => {
        if (!q.cells || q.rx < 5 || (qi > 0 && !chance(0.6))) return;
        for (let tries = 0; tries < 30; tries++) {
            const c = q.cells[R(0, q.cells.length - 1)], hw = R(4, 5), hh = 3;
            let ok = true;
            for (let j = c[1] - 1; j <= c[1] + hh && ok; j++) for (let i = c[0] - 1; i <= c[0] + hw && ok; i++) if (!k.inMap(i, j) || land[j][i] < 2) ok = false;
            if (!ok) continue;
            k.fill(c[0], c[1], hw, hh); k.boxEdges(k.edgeWalls, c[0], c[1], hw, hh); k.door(c[0] + Math.floor(hw / 2), c[1] + hh - 1, 'S');
            const r = { x: c[0], y: c[1], w: hw, h: hh }; rooms.push(r); plans.push({ r, kind: 'house' });
            for (let j = c[1] - 1; j <= c[1] + hh; j++) for (let i = c[0] - 1; i <= c[0] + hw; i++) taken.push([i, j]);
            q.hut = r; break;
        }
    });
    furnishPlans(R, plans, k.edgeDoors, furniture);
    const inHut = (x, y) => taken.some(t => t[0] === x && t[1] === y);
    // trees, boulders, and (on sea islands) a pier
    const placed = [];
    isl.forEach(q => {
        (q.cells || []).forEach(([x, y, d]) => {
            if (land[y][x] < 2 || inHut(x, y)) return;
            const forest = land[y][x] === 3, p = forest ? 0.5 : land[y][x] === 4 ? 0.1 : 0.12;
            if (!chance(p) || placed.some(t => Math.hypot(t[0] - x, t[1] - y) < 2.6)) return;
            const big = chance(0.55) && x < W - 3 && y < H - 3;
            if (land[y][x] === 4 && chance(0.5)) objects.push({ kind: 'rock', x: Math.min(x, W - 2), y: Math.min(y, H - 2), w: 2, h: 2 });
            else if (big) objects.push({ kind: sky || forest ? 'tree' : 'pine', x, y, w: 3, h: 3 });
            else objects.push({ kind: 'bush', x, y, w: 1, h: 1 });
            placed.push([x, y]);
        });
    });
    if (sky) {
        // rope bridges between islands that are close: straight, along a row or column that has land on both sides of a short gap
        isl.forEach(q => { q.br = 0; });
        for (let a = 0; a < isl.length; a++) for (let b = a + 1; b < isl.length; b++) {
            const A = isl[a], B = isl[b];
            if (A.br >= 2 || B.br >= 2) continue;
            const hor = Math.abs(A.cx - B.cx) >= Math.abs(A.cy - B.cy);
            const first = (hor ? A.cx <= B.cx : A.cy <= B.cy) ? A : B;
            let done = false;
            for (let off = 0; off <= 5 && !done; off++) for (const sg of [1, -1]) {
                if (done) break;
                const line = Math.round(hor ? (A.cy + B.cy) / 2 : (A.cx + B.cx) / 2) + off * sg;
                const at = t => hor ? [t, line] : [line, t];
                let t0 = Math.floor(hor ? first.cx : first.cy);
                let [x, y] = at(t0);
                if (!k.inMap(x, y) || !land[y][x]) continue;
                for (;;) { [x, y] = at(t0 + 1); if (!k.inMap(x, y) || !land[y][x]) break; t0++; }
                let t1 = -1;
                for (let t = t0 + 2; t <= t0 + 10; t++) { [x, y] = at(t); if (!k.inMap(x, y)) break; if (land[y][x]) { t1 = t; break; } }
                if (t1 < 0) continue;
                objects.push(hor ? { kind: 'rug', color: 'brown', x: t0 + 1, y: line, w: t1 - t0 - 1, h: 1 } : { kind: 'rug', color: 'brown', x: line, y: t0 + 1, w: 1, h: t1 - t0 - 1 });
                A.br++; B.br++; done = true;
            }
        }
    } else {
        // a short pier into the water on the biggest island, with a rowing boat's worth of barrels at the end
        const q = isl[0];
        if (q && q.cells) {
            const cy = Math.round(q.cy);
            for (let x = Math.floor(q.cx); x < W; x++) if (!land[cy][x]) { if (x - 1 > q.cx) { objects.push({ kind: 'rug', color: 'brown', x: x - 2, y: cy, w: 5, h: 1 }); furniture.push({ x: Math.min(W - 1, x + 2), y: cy, piece: 'barrel' }); } break; }
        }
    }
    const terrain = [];
    const names = [null, 'plains', 'plains', 'forest', 'hills'];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const v = land[y][x];
        terrain.push([x, y, v === 0 ? (sky ? 'sky' : 'water') : v === 1 ? (sky ? 'mountain' : 'plains') : names[v]]);
    }
    return { grid: k.grid, rooms, edgeWalls: k.edgeWalls, edgeWallsThick: k.edgeWallsThick, edgeDoors: k.edgeDoors, furniture, objects, terrain, roads: [], labels: [] };
}

// ===================== A ship (at sea, or an airship in the clouds) =====================
function generateShip(rng, cols, rows, o) {
    const k = genKit(rng, cols, rows), R = k.R, chance = k.chance, W = cols, H = rows, sky = !!o.sky;
    const irng = o.irng || rng, IR = (a, b) => a + Math.floor(irng() * (b - a + 1)), ichance = p => irng() < p; // what is aboard
    const furniture = [], plans = [], objects = [], labels = [], rooms = [];
    const cx = Math.floor(W / 2), maxHalf = Math.max(3, Math.min(9, Math.floor((W - (sky ? 14 : 6)) / 2)));
    const y0 = 4, L = Math.max(16, H - 9), yEnd = y0 + L - 1;
    const half = y => {
        const t = (y - y0) / (L - 1);
        const h = t < 0.3 ? Math.round(maxHalf * Math.sqrt(1 - Math.pow(1 - t / 0.3, 2))) : t > 0.84 ? Math.round(maxHalf * (1 - Math.pow((t - 0.84) / 0.16, 2) * 0.4)) : maxHalf;
        return Math.max(0, Math.min(maxHalf, h));
    };
    const at = f => y0 + Math.round(L * f);
    for (let y = y0; y <= yEnd; y++) for (let x = cx - half(y); x <= cx + half(y); x++) k.grid[y][x] = 'floor';
    rooms.push({ x: cx - maxHalf, y: y0, w: maxHalf * 2 + 1, h: L });
    // an airship has side platforms amidships
    if (sky) {
        const wy = at(0.42), wh = Math.max(5, Math.round(L * 0.14));
        for (let y = wy; y < wy + wh; y++) for (let i = 1; i <= 4; i++) { k.grid[y][cx - maxHalf - i] = 'floor'; k.grid[y][cx + maxHalf + i] = 'floor'; }
    }
    // the forecastle at the bow: crew bunks, a door onto the deck
    const fy = at(0.09), fh = Math.max(3, Math.round(L * 0.12)), fw = half(fy) * 2 + 1, fx = cx - half(fy);
    k.boxEdges(k.edgeWalls, fx, fy, fw, fh); k.door(cx, fy + fh - 1, 'S');
    plans.push({ r: { x: fx, y: fy, w: fw, h: fh }, kind: 'barracks' });
    // a room each side amidships (the galley and the stores), doors onto the deck
    const sy = at(0.58), sh = Math.max(4, Math.round(L * 0.13));
    const port = { x: cx - maxHalf, y: sy, w: 4, h: sh }, star = { x: cx + maxHalf - 3, y: sy, w: 4, h: sh };
    k.boxEdges(k.edgeWalls, port.x, port.y, port.w, port.h); k.door(port.x + 3, sy + Math.floor(sh / 2), 'E'); plans.push({ r: port, kind: 'kitchen' });
    k.boxEdges(k.edgeWalls, star.x, star.y, star.w, star.h); k.door(star.x, sy + Math.floor(sh / 2), 'W'); plans.push({ r: star, kind: 'store' });
    // the great cabin at the stern
    const gy = at(0.76), gh = yEnd - gy + 1, gw = half(yEnd) * 2 + 1, gx = cx - half(yEnd);
    k.boxEdges(k.edgeWalls, gx, gy, gw, gh); k.door(cx, gy, 'N');
    plans.push({ r: { x: gx, y: gy, w: gw, h: gh }, kind: 'bed' }, { r: { x: gx, y: gy, w: gw, h: gh }, kind: 'study' });
    furnishPlans(IR, plans, k.edgeDoors, furniture);
    // masts: a post with a thick ring round it; the helm in front of the cabin; a hatch to the hold; barrels and crates along the rails
    const masts = Math.max(1, Math.min(3, o.masts || 2));
    for (let m = 0; m < masts; m++) { const my = at(masts === 1 ? 0.32 : 0.22 + (0.26 / (masts - 1)) * m); k.boxEdges(k.edgeWallsThick, cx, my, 1, 1); }
    objects.push({ kind: 'cellar-hatch', x: cx - 1, y: at(0.4), w: 2, h: 2 });
    furniture.push({ x: cx, y: at(0.7), piece: 'desk' });
    furniture.push({ x: cx, y: y0 + 1, piece: 'chest' });
    for (let y = fy + fh + 1; y < sy + sh; y++) {
        if (y >= sy && y < sy + sh) continue;
        [-1, 1].forEach(sg => { if (ichance(0.34)) furniture.push({ x: cx + sg * (half(y) - 1), y, piece: ichance(0.55) ? 'barrel' : 'crate' }); });
    }
    if (sky) { furniture.push({ x: cx - maxHalf - 2, y: at(0.46), piece: 'barrel' }); furniture.push({ x: cx + maxHalf + 2, y: at(0.46), piece: 'crate' }); }
    const name = shipNames[IR(0, shipNames.length - 1)];
    labels.push({ x: cx, y: yEnd + 2.4, text: name, maxW: W - 4, size: 0.9 });
    const terrain = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (k.grid[y][x] !== 'floor') terrain.push([x, y, sky ? 'sky' : 'water']);
    // the hold, one deck down: the same hull, crew quarters in the bow, officers and a brig, a cargo hold, a powder store aft, a hatch up
    const levels = [];
    if (o.hold) {
        const hk = genKit(rng, cols, rows), hf = [], hp = [];
        for (let y = y0; y <= yEnd; y++) for (let x = cx - half(y); x <= cx + half(y); x++) hk.grid[y][x] = 'floor';
        const qy = at(0.14), qh = Math.max(4, Math.round(L * 0.2)), qw = half(qy) * 2 + 1, qx = cx - half(qy);
        hk.boxEdges(hk.edgeWalls, qx, qy, qw, qh); hk.door(cx, qy + qh - 1, 'S'); hp.push({ r: { x: qx, y: qy, w: qw, h: qh }, kind: 'barracks' });
        const my = at(0.34), off = { x: cx - maxHalf, y: my, w: 4, h: 4 }, brig = { x: cx + maxHalf - 3, y: my, w: 4, h: 4 };
        hk.boxEdges(hk.edgeWalls, off.x, off.y, off.w, off.h); hk.door(off.x + 3, my + 1, 'E'); hp.push({ r: off, kind: 'bed' });
        hk.boxEdges(hk.edgeWalls, brig.x, brig.y, brig.w, brig.h); hk.door(brig.x, my + 1, 'W'); hf.push({ x: brig.x + 2, y: my + 2, piece: 'chair' }, { x: brig.x + 3, y: my + 3, piece: 'bed' });
        const py = at(0.86), ph = yEnd - py + 1, pw = half(yEnd) * 2 + 1, px = cx - half(yEnd);
        hk.boxEdges(hk.edgeWalls, px, py, pw, ph); hk.door(cx, py, 'N'); hp.push({ r: { x: px, y: py, w: pw, h: ph }, kind: 'store' });
        furnishPlans(IR, hp, hk.edgeDoors, hf);
        for (let y = at(0.46); y < py - 1; y++) for (let x = cx - half(y) + 1; x <= cx + half(y) - 1; x++) {
            if (Math.abs(x - cx) <= 1 || (y >= at(0.38) && y <= at(0.44))) continue;
            if (ichance(0.4)) hf.push({ x, y, piece: ichance(0.5) ? 'barrel' : ichance(0.7) ? 'crate' : 'chest' });
        }
        const hterrain = [];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (hk.grid[y][x] !== 'floor') hterrain.push([x, y, sky ? 'sky' : 'water']);
        levels.push({ name: 'Hold', mode: 'ship', links: [{ kind: 'obj', x: cx - 1, y: at(0.4), w: 2, h: 2, here: 'cellar-hatch', there: 'cellar-hatch' }],
            res: { grid: hk.grid, rooms: [{ x: cx - maxHalf, y: y0, w: maxHalf * 2 + 1, h: L }], edgeWalls: hk.edgeWalls, edgeWallsThick: hk.edgeWallsThick, edgeDoors: hk.edgeDoors, furniture: hf, objects: [{ kind: 'cellar-hatch', x: cx - 1, y: at(0.4), w: 2, h: 2 }], labels: [], terrain: hterrain, roads: [] } });
    }
    return { grid: k.grid, rooms, edgeWalls: k.edgeWalls, edgeWallsThick: k.edgeWallsThick, edgeDoors: k.edgeDoors, furniture, objects, labels, terrain, roads: [], levels };
}

// ===================== A mine =====================
function generateMine(rng, cols, rows, o) {
    const k = genKit(rng, cols, rows), R = k.R, chance = k.chance, W = cols, H = rows;
    const furniture = [], objects = [], roads = [], chambers = [];
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const carve = (x, y, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + 0.5) { const i = x + dx, j = y + dy; if (i >= 1 && j >= 1 && i <= W - 2 && j <= H - 1) k.grid[j][i] = 'floor'; } };
    let x = R(Math.floor(W * 0.35), Math.floor(W * 0.65)), y = H - 1;
    const mouth = x, shaft = [];
    while (y > 4) {
        shaft.push([x, y]);
        carve(x, y, y > H - 4 ? 0 : 1);
        y--;
        if (chance(0.2)) x = clamp(x + (chance(0.5) ? 1 : -1), 5, W - 6);
    }
    chambers.push({ x, y: Math.max(4, y), r: R(3, 4) });
    // side tunnels left and right, each ending in a chamber
    const nBranch = Math.max(3, Math.min(6, Math.round(H / 7)));
    for (let b = 0; b < nBranch; b++) {
        const at = shaft[clamp(Math.round((b + 1) * shaft.length / (nBranch + 1)) + R(-1, 1), 4, shaft.length - 5)];
        if (!at) continue;
        const dir = b % 2 ? 1 : -1, len = R(6, Math.max(7, Math.floor(W * 0.38)));
        let bx = at[0], by = at[1];
        for (let s = 0; s < len; s++) { bx = clamp(bx + dir, 3, W - 4); if (chance(0.28)) by = clamp(by + (chance(0.5) ? 1 : -1), 4, H - 3); carve(bx, by, 1); }
        chambers.push({ x: bx, y: by, r: R(2, 3) });
    }
    chambers.forEach(c => carve(c.x, c.y, c.r));
    // pools of lava and water in the chambers (never the one with the way down)
    const deep = chambers.slice().sort((a, b) => a.y - b.y)[0];
    const pool = (c, kind, rad) => { for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) if (dx * dx + dy * dy <= rad * rad + rad * 0.9 && k.grid[c.y + dy] && k.grid[c.y + dy][c.x + dx] === 'floor') k.grid[c.y + dy][c.x + dx] = kind; };
    const rest = chambers.filter(c => c !== deep);
    if (o.lava && rest.length) { const c = rest[R(0, rest.length - 1)]; pool(c, 'lava', Math.max(1, c.r - 1)); }
    if (o.water && rest.length) { const c = rest[R(0, rest.length - 1)]; pool(c, 'water', 1); }
    // the way down, ore, supplies, torches and a cart or two
    furniture.push({ x: deep.x, y: deep.y, piece: 'stairs-down' });
    chambers.forEach((c, i) => {
        if (c === deep) return;
        if (chance(0.7)) objects.push({ kind: 'rock', x: clamp(c.x - c.r, 1, W - 3), y: clamp(c.y + c.r - 1, 1, H - 3), w: 2, h: 2 });
        if (chance(0.5)) furniture.push({ x: clamp(c.x + 1, 1, W - 2), y: clamp(c.y - 1, 1, H - 2), piece: 'chest' });
    });
    for (let i = 5; i < shaft.length; i += 7) if (k.grid[shaft[i][1]][shaft[i][0] + 1] === 'floor') furniture.push({ x: shaft[i][0] + 1, y: shaft[i][1], piece: 'torch' });
    for (let i = 3; i < shaft.length; i += 4) roads.push([shaft[i][0], shaft[i][1], 'dirt']);
    for (let n = 0; n < 2; n++) { const s = shaft[R(6, Math.max(7, shaft.length - 6))]; if (s) objects.push({ kind: 'cart', x: s[0] - 1, y: s[1] - 1, w: 2, h: 3 }); }
    furniture.push({ x: mouth, y: H - 3, piece: 'barrel' }, { x: mouth, y: H - 4, piece: 'crate' });
    k.edgeDoors.add('H:' + mouth + ',' + H); // the timbered mouth
    // a deeper level: natural caverns with lava and water, the stair up at the floor square nearest the way down
    const levels = [];
    if (o.deep) {
        const cr = generateCave(rng, cols, rows, { fillProb: 0.46, steps: 4, water: true, lava: true });
        let best = null, bd = 1e9;
        const floors = [];
        for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) if (cr.grid[yy][xx] === 'floor') { floors.push([xx, yy]); const d = (xx - deep.x) * (xx - deep.x) + (yy - deep.y) * (yy - deep.y); if (d < bd) { bd = d; best = [xx, yy]; } }
        if (best) {
            const df = [{ x: best[0], y: best[1], piece: 'stairs-up' }], dobj = [], used = new Set([best[0] + ',' + best[1]]);
            const pick = n => { for (let t = 0; t < 60; t++) { const c = floors[R(0, floors.length - 1)]; if (!used.has(c[0] + ',' + c[1])) { used.add(c[0] + ',' + c[1]); return c; } } return null; };
            for (let n = 0; n < 4; n++) { const c = pick(); if (c) df.push({ x: c[0], y: c[1], piece: n < 2 ? 'chest' : 'torch' }); }
            for (let n = 0; n < 6; n++) { const c = pick(); if (c && c[0] < W - 2 && c[1] < H - 2 && cr.grid[c[1]][c[0] + 1] === 'floor' && cr.grid[c[1] + 1][c[0]] === 'floor' && cr.grid[c[1] + 1][c[0] + 1] === 'floor') dobj.push({ kind: 'rock', x: c[0], y: c[1], w: 2, h: 2 }); }
            levels.push({ name: 'Deep mine', mode: 'cave', links: [{ kind: 'cell', x: deep.x, y: deep.y, tx: best[0], ty: best[1], here: 'stairs-down', there: 'stairs-up' }],
                res: { grid: cr.grid, rooms: [], edgeWalls: new Set(), edgeWallsThick: new Set(), edgeDoors: new Set(), furniture: df, objects: dobj, labels: [], terrain: [], roads: [] } });
        }
    }
    return { grid: k.grid, rooms: [], edgeWalls: k.edgeWalls, edgeWallsThick: k.edgeWallsThick, edgeDoors: k.edgeDoors, furniture, objects, roads, labels: [], levels };
}

// ===================== A temple =====================
function generateTemple(rng, cols, rows, o) {
    const k = genKit(rng, cols, rows), R = k.R, chance = k.chance, W = cols, H = rows;
    const furniture = [], plans = [], rooms = [], stairs = [];
    let stair = null;
    const cx = Math.floor(W / 2);
    const nh = Math.max(2, Math.min(4, Math.floor((W - (o.aisles ? 10 : 6)) / 2))), hw = o.aisles ? nh + 3 : nh;
    let tw = o.transept ? Math.min(4, Math.floor((W - 2 * hw - 3) / 2)) : 0;
    if (tw < 2) tw = 0;
    const top = 2, bottom = H - 3, apseH = 5, narthexH = 3, naveTop = top + apseH, naveBot = bottom - narthexH;
    k.fill(cx - nh, top, 2 * nh + 1, apseH);
    k.fill(cx - hw, naveTop, 2 * hw + 1, naveBot - naveTop + 1);
    k.fill(cx - hw, naveBot + 1, 2 * hw + 1, narthexH);
    const tY = naveTop + Math.floor((naveBot - naveTop) * 0.28);
    if (tw) k.fill(cx - hw - tw, tY, 2 * (hw + tw) + 1, 4);
    rooms.push({ x: cx - hw, y: naveTop, w: 2 * hw + 1, h: naveBot - naveTop + 1 });
    // the porch: a wall across with a door in it, and the great door in the front
    k.hEdge(k.edgeWalls, cx - hw, cx + hw, naveBot + 1); k.edgeDoors.add('H:' + cx + ',' + (naveBot + 1));
    k.edgeDoors.add('H:' + cx + ',' + (bottom + 1));
    // the chancel arch: a wall with a wide opening
    for (let x = cx - nh; x <= cx + nh; x++) if (Math.abs(x - cx) > 1) k.edgeWallsThick.add('H:' + x + ',' + naveTop);
    // pillars down both sides of the nave, pews between them, an aisle down the middle
    for (let y = naveTop + 2; y <= naveBot - 1; y += 3) if (o.aisles) { k.boxEdges(k.edgeWallsThick, cx - nh - 1, y, 1, 1); k.boxEdges(k.edgeWallsThick, cx + nh + 1, y, 1, 1); }
    for (let y = naveTop + 2; y <= naveBot - 2; y += 2) for (let x = cx - nh; x <= cx + nh; x++) if (Math.abs(x - cx) > 1) furniture.push({ x, y, piece: 'couch' });
    // the altar, candles and flowers in the chancel, a lectern
    furniture.push({ x: cx, y: top + 1, piece: 'table' }, { x: cx - nh, y: top, piece: 'torch' }, { x: cx + nh, y: top, piece: 'torch' }, { x: cx - 2, y: top + 2, piece: 'flower-pot' }, { x: cx + 2, y: top + 2, piece: 'flower-pot' }, { x: cx - nh + 1, y: naveTop + 1, piece: 'desk' });
    if (tw) { furniture.push({ x: cx - hw - tw + 1, y: tY + 1, piece: 'chest' }, { x: cx + hw + tw - 1, y: tY + 1, piece: 'shelf' }, { x: cx - hw - tw + 1, y: tY + 3, piece: 'torch' }, { x: cx + hw + tw - 1, y: tY + 3, piece: 'torch' }); }
    // the vestry beside the chancel, with the stair down to the crypt
    if (cx + nh + 5 < W - 1) {
        const v = { x: cx + nh + 1, y: top, w: 4, h: apseH };
        k.fill(v.x, v.y, v.w, v.h); k.boxEdges(k.edgeWalls, v.x, v.y, v.w, v.h); k.door(v.x, v.y + 2, 'W');
        rooms.push(v); plans.push({ r: v, kind: 'study' });
        furniture.push({ x: v.x + v.w - 1, y: v.y + v.h - 1, piece: 'stairs-down' }); stair = [v.x + v.w - 1, v.y + v.h - 1];
    } else { furniture.push({ x: cx - nh + 1, y: top + 3, piece: 'stairs-down' }); stair = [cx - nh + 1, top + 3]; }
    const irng = o.irng || rng, IR = (a, b) => a + Math.floor(irng() * (b - a + 1));
    furnishPlans(IR, plans, k.edgeDoors, furniture);
    // the crypt below: a pillared hall of tombs, a shrine, an ossuary and a locked vault, the stair up where the stair down is
    const levels = [];
    if (o.crypt && stair) {
        const ck = genKit(rng, cols, rows), cf = [], cp = [];
        const hh = Math.max(nh + 1, Math.abs(stair[0] - cx) + 1, 5), hx0 = Math.max(2, cx - hh), hx1 = Math.min(W - 3, cx + hh);
        const hy0 = Math.min(top + 3, stair[1] - 1), hy1 = Math.max(hy0 + 8, bottom - 8);
        ck.fill(hx0, hy0, hx1 - hx0 + 1, hy1 - hy0 + 2); // the hall and a passage across its foot
        for (let y = hy0 + 2; y <= hy1 - 2; y += 3) {
            [-1, 1].forEach(sg => { ck.boxEdges(ck.edgeWallsThick, cx + sg * 3, y, 1, 1); cf.push({ x: cx + sg * 6, y, piece: 'chest' }); });
            cf.push({ x: hx0 + 1, y, piece: 'chest' }, { x: hx1 - 1, y, piece: 'chest' });
        }
        cf.push({ x: cx, y: hy0 + 1, piece: 'table' }, { x: cx - 2, y: hy0, piece: 'torch' }, { x: cx + 2, y: hy0, piece: 'torch' }, { x: hx0, y: hy1, piece: 'torch' }, { x: hx1, y: hy1, piece: 'torch' });
        const vy = hy1 + 2, vh = Math.max(3, Math.min(4, H - 2 - vy)), midx = Math.floor((hx0 + hx1) / 2);
        const oss = { x: hx0, y: vy, w: midx - hx0 - 0, h: vh }, vault = { x: midx + 2, y: vy, w: hx1 - midx - 1, h: vh };
        [oss, vault].forEach(r => { if (r.w >= 3 && vy + vh <= H - 1) { ck.fill(r.x, r.y, r.w, r.h); ck.boxEdges(ck.edgeWalls, r.x, r.y, r.w, r.h); ck.door(r.x + Math.floor(r.w / 2), r.y, 'N'); } });
        if (oss.w >= 3) { cp.push({ r: oss, kind: 'store' }); cf.push({ x: oss.x + 1, y: oss.y + 1, piece: 'crate' }, { x: oss.x + oss.w - 2, y: oss.y + oss.h - 1, piece: 'barrel' }); }
        if (vault.w >= 3) cf.push({ x: vault.x + 1, y: vault.y + 1, piece: 'chest' }, { x: vault.x + vault.w - 2, y: vault.y + 1, piece: 'chest' }, { x: vault.x + Math.floor(vault.w / 2), y: vault.y + vault.h - 1, piece: 'table' });
        furnishPlans(IR, cp, ck.edgeDoors, cf);
        const cfl = cf.filter(f => !(f.x === stair[0] && f.y === stair[1]));
        cfl.push({ x: stair[0], y: stair[1], piece: 'stairs-up' });
        levels.push({ name: 'Crypt', mode: 'temple', links: [{ kind: 'cell', x: stair[0], y: stair[1], here: 'stairs-down', there: 'stairs-up' }],
            res: { grid: ck.grid, rooms: [{ x: hx0, y: hy0, w: hx1 - hx0 + 1, h: hy1 - hy0 + 2 }], edgeWalls: ck.edgeWalls, edgeWallsThick: ck.edgeWallsThick, edgeDoors: ck.edgeDoors, furniture: cfl, objects: [], labels: [], terrain: [], roads: [] } });
    }
    return { grid: k.grid, rooms, edgeWalls: k.edgeWalls, edgeWallsThick: k.edgeWallsThick, edgeDoors: k.edgeDoors, furniture, stairs, objects: [], labels: [], roads: [], levels };
}

// ===================== Shared helpers =====================
function edgeKey(type, x, y) { return type + ':' + x + ',' + y; }
// Columns run A-Z, then AA, AB, ... (same as the DM Map tab)
function mapColLabel(i) { let n = i + 1, s = ''; while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); } return s; }
const MIXED_FLOOR_TEXTURES = ['stone', 'tile', 'wood'];
function roomTextureFor(room) {
    const idx = Math.floor(cellHash(room.x, room.y, 61) * MIXED_FLOOR_TEXTURES.length);
    return MIXED_FLOOR_TEXTURES[Math.min(idx, MIXED_FLOOR_TEXTURES.length - 1)];
}
function resolveFloorTexture(texture, x, y, rooms) {
    if (texture !== 'mixed') return texture;
    const room = (rooms || []).find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    return room ? roomTextureFor(room) : 'none';
}
function isOpenCell(grid, cols, rows, x, y) {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
    const t = grid[y][x];
    return t === 'floor' || t === 'water' || t === 'lava' || t === 'door';
}
function parseEdgeKey(key) {
    const [type, coords] = key.split(':');
    const [x, y] = coords.split(',').map(Number);
    return { type, x, y };
}

// ===================== Settings -> map =====================
// The settings blob is the same one the generator page saves with a map (captureGeneratorSettings in mapgen.html):
// mode, seed, cols, rows, density, minRoom, doors, dungeonWater, fill, steps, caveWater, tavernRooms, scale, waterLevel,
// mountainLevel, wildBuildings, floorTexture. Same seed + same settings always gives the same map.
function clampSide(v) { return Math.max(10, Math.min(100, parseInt(v, 10) || 20)); }
function generate(s) {
    const mode = s.mode || 'dungeon', cols = clampSide(s.cols), rows = clampSide(s.rows);
    const seed = (s.seed === undefined || s.seed === null || s.seed === '') ? 'seed' : String(s.seed);
    const density = Math.max(1, Math.min(5, parseInt(s.density, 10) || 3));
    // sparse -> a few big rooms, maze-like -> many small ones (same mapping as the generator page)
    const minLeaf = [8, 7, 6, 5, 4][density - 1] || 6;
    const num = (v, d) => { const n = parseFloat(v); return isNaN(n) ? d : n; };
    const opts = {
        keepSize: num(s.keepSize, 40), castleRooms: num(s.castleRooms, 4), castleRound: !!s.castleRound, castleLayout: s.castleLayout || 'auto', castleMoat: !!s.castleMoat, towers: s.castleTowers !== false && s.castleTowers !== 0, castleBuildings: s.castleBuildings !== false && s.castleBuildings !== 0,
        cols, rows, minLeaf, maxLeaf: minLeaf * 2 + 2,
        minRoom: num(s.minRoom, 4),
        doors: s.doors !== false && s.doors !== 0,
        water: !!s.dungeonWater,
        fillProb: num(s.fill, 45) / 100,
        steps: num(s.steps, 4),
        caveWater: !!s.caveWater,
        roomCount: num(s.tavernRooms, 4),
        furniture: !!s.tavernFurniture,
        scale: num(s.scale, 8),
        waterLevel: num(s.waterLevel, 36) / 100,
        mountainLevel: num(s.mountainLevel, 72) / 100,
        buildings: s.wildBuildings !== false && s.wildBuildings !== 0,
        caveLava: !!s.caveLava
    };
    const rng = makeRng(seed + '|' + mode);
    const irng = makeRng(seed + '|' + mode + '|inner|' + (s.innerSeed || '')); // rerolled by changing the inside seed alone
    opts.irng = irng;
    let result;
    if (mode === 'dungeon') result = generateDungeon(rng, cols, rows, opts);
    else if (mode === 'tavern') {
        result = generateTavern(rng, cols, rows, opts);
        // the bar and tables in the common room, a stove and shelves in the kitchen, beds in the private rooms (the inside seed only moves these)
        const keep = new Set(result.edgeDoors);
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (result.grid[y][x] === 'door') { keep.add('H:' + x + ',' + y); keep.add('H:' + x + ',' + (y + 1)); keep.add('V:' + x + ',' + y); keep.add('V:' + (x + 1) + ',' + y); }
        const t = result.tavern, plans = [];
        if (t.common) plans.push({ r: t.common, kind: 'tavern' });
        if (t.kitchen) plans.push({ r: t.kitchen, kind: 'kitchen' });
        (t.privateRooms || []).forEach(r => plans.push({ r, kind: 'bed' }));
        result.furniture = [];
        furnishPlans((a, b) => a + Math.floor(irng() * (b - a + 1)), plans, keep, result.furniture);
    }
    else if (mode === 'cave') result = generateCave(rng, cols, rows, { fillProb: opts.fillProb, steps: opts.steps, water: opts.caveWater, lava: opts.caveLava });
    else if (mode === 'village') result = generateCity(rng, cols, rows, { water: s.cityWater || 'auto', irng, walls: false, citadel: false, village: true, labels: s.cityLabels !== false && s.cityLabels !== 0 });
    else if (mode === 'woods') result = generateWoods(rng, cols, rows, { river: s.woodsRiver !== false && s.woodsRiver !== 0, density: num(s.woodsDensity, 50) / 100 });
    else if (mode === 'islands') result = generateIslands(rng, cols, rows, { sky: !!s.islandSky, count: num(s.islandCount, 6) });
    else if (mode === 'ship') result = generateShip(rng, cols, rows, { sky: !!s.shipSky, masts: num(s.shipMasts, 2), hold: s.shipHold !== false && s.shipHold !== 0, irng });
    else if (mode === 'mine') result = generateMine(rng, cols, rows, { lava: s.mineLava !== false && s.mineLava !== 0, water: !!s.mineWater, deep: s.mineDeep !== false && s.mineDeep !== 0 });
    else if (mode === 'temple') result = generateTemple(rng, cols, rows, { aisles: s.templeAisles !== false && s.templeAisles !== 0, transept: s.templeTransept !== false && s.templeTransept !== 0, crypt: s.templeCrypt !== false && s.templeCrypt !== 0, irng });
    else if (mode === 'city') result = generateCity(rng, cols, rows, { water: s.cityWater || 'auto', walls: s.cityWalls !== false && s.cityWalls !== 0, citadel: s.cityCitadel !== false && s.cityCitadel !== 0, irng, roundTowers: !!s.castleRound, towers: s.cityTowers !== false && s.cityTowers !== 0, labels: s.cityLabels !== false && s.cityLabels !== 0 });
    else if (mode === 'castle') result = generateCastle(rng, cols, rows, { keepSize: opts.keepSize, towers: opts.towers, buildings: opts.castleBuildings, rooms: opts.castleRooms, roundTowers: opts.castleRound, layout: opts.castleLayout, moat: opts.castleMoat, irng });
    else result = generateWilderness(rng, cols, rows, opts);
    if (mode === 'castle' && num(s.castleFloors, 0) > 0) result.levels = castleUpperLevels(result, cols, rows, Math.min(2, Math.round(num(s.castleFloors, 0))), makeRng(seed + '|castle-upper'), irng);
    const wrap = (result, mode) => ({
        grid: result.grid, rooms: result.rooms || [], tavern: result.tavern || null, showFurniture: !!opts.furniture,
        buildings: result.buildings || [], mainRoad: result.mainRoad || [], smallRoads: result.smallRoads || [],
        edgeWalls: result.edgeWalls || new Set(), edgeWallsThick: result.edgeWallsThick || new Set(), edgeDoors: result.edgeDoors || new Set(),
        roundTowers: result.roundTowers || [], stairs: result.stairs || [], furniture: result.furniture || [], moat: result.moat || [],
        terrain: result.terrain || [], roads: result.roads || [], objects: result.objects || [], labels: result.labels || [],
        wallStyle: s.wallStyle === 'castle' || mode === 'castle' ? 'castle' : 'normal',
        cols, rows, mode, seed
    });
    const out = wrap(result, mode);
    // extra floors (a castle's upper floors, a ship's hold): each is its own map, linked to the one before by paired stairs or a hatch
    out.levels = (result.levels || []).map(l => ({ name: l.name, links: l.links, res: wrap(l.res, l.mode || mode) }));
    return out;
}

// A generated result as DM Map tab data: cells (floors with texture, water, biomes), and every wall and door as an edge.
// `res` is what generate() returns; floorTexture is none | stone | tile | wood | mixed.
function buildLayout(res, floorTexture) {
    const { grid, cols, rows, rooms, mode } = res;
    const cells = {}, edges = {};
    if (mode === 'wild') {
        // every cell gets its biome; roads and landmarks ride on top as furniture (landmarks win over a road under them)
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells[mapColLabel(x) + (y + 1)] = { terrain: grid[y][x], hidden: false, fogRevealed: false };
        (res.mainRoad || []).forEach(([x, y]) => { const k = mapColLabel(x) + (y + 1); if (cells[k]) cells[k].furniture = 'road-stone'; });
        (res.smallRoads || []).forEach(r => (r.path || []).forEach(([x, y]) => { const k = mapColLabel(x) + (y + 1); if (cells[k]) cells[k].furniture = r.style === 'dirt' ? 'road-dirt' : 'road-stone'; }));
        (res.buildings || []).forEach(b => { const k = mapColLabel(b.x) + (b.y + 1); if (cells[k]) cells[k].furniture = b.kind; });
        return { cells, edges };
    }
    const cave = mode === 'cave' || mode === 'mine' || mode === 'ship'; // the outline of a cave, a mine and a ship's hull is smoothed
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const t = grid[y][x];
        if (t === 'wall') continue; // unexcavated rock stays blank paper; the hatching draws it
        const key = mapColLabel(x) + (y + 1);
        if (t === 'water' || t === 'lava') { cells[key] = cave ? { terrain: t, floorTexture: 'stone', round: true, hidden: false, fogRevealed: false } : { terrain: t, floorTexture: 'stone', hidden: false, fogRevealed: false }; continue; }
        const tex = resolveFloorTexture(floorTexture, x, y, rooms);
        const cell = { floorTexture: (tex === 'none' || !tex) ? 'stone' : tex, hidden: false, fogRevealed: false };
        if (cave) cell.round = true; // caves keep their curved, organic outline
        cells[key] = cell;
    }
    const open = (x, y) => isOpenCell(grid, cols, rows, x, y);
    // Castle walls (the Walls: Castle option, and the curtain wall and keep of a castle) are drawn twice as thick
    const castleAll = res.wallStyle === 'castle' || mode === 'castle';
    const wall = (round, thick) => {
        const w = round ? { type: 'wall', hidden: false, secret: false, round: true } : { type: 'wall', hidden: false, secret: false };
        if (thick) w.thick = true;
        return w;
    };
    const put = (type, x, row, def) => { edges[type + ':' + x + ',' + row] = def; };
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        if (!open(x, y)) continue;
        if (!open(x, y - 1)) put('H', x, y + 1, wall(cave, castleAll));
        if (!open(x, y + 1)) put('H', x, y + 2, wall(cave, castleAll));
        if (!open(x - 1, y)) put('V', x, y + 1, wall(cave, castleAll));
        if (!open(x + 1, y)) put('V', x + 1, y + 1, wall(cave, castleAll));
    }
    (res.edgeWalls || []).forEach(k => { const e = parseEdgeKey(k); put(e.type, e.x, e.y + 1, wall(false, res.wallStyle === 'castle')); });
    (res.edgeWallsThick || []).forEach(k => { const e = parseEdgeKey(k); put(e.type, e.x, e.y + 1, wall(false, true)); });
    const door = { type: 'door', hidden: false, secret: false, material: 'wood' };
    (res.edgeDoors || []).forEach(k => { const e = parseEdgeKey(k); put(e.type, e.x, e.y + 1, Object.assign({}, door)); });
    // round towers: a circle shape (kept in the map's ink list), its cells and outline walls pointing at it, a door in it
    const ink = [];
    (res.roundTowers || []).forEach(tw => {
        const inside = new Set(tw.cells.map(c => c[0] + ',' + c[1]));
        const shape = { t: 'room', id: tw.id, c: [tw.c[0], tw.c[1], tw.c[2]], cells: tw.cells.map(c => c[0] + ',' + (c[1] + 1)) };
        if (!tw.thin) shape.thick = true;
        ink.push(shape);
        tw.cells.forEach(([x, y]) => {
            const cell = cells[mapColLabel(x) + (y + 1)];
            if (cell) cell.rs = tw.id;
            [[0, -1, 'H', x, y + 1], [0, 1, 'H', x, y + 2], [-1, 0, 'V', x, y + 1], [1, 0, 'V', x + 1, y + 1]].forEach(([dx, dy, type, ex, ey]) => {
                if (!inside.has((x + dx) + ',' + (y + dy))) put(type, ex, ey, Object.assign(wall(false, !tw.thin), { rs: tw.id }));
            });
        });
        if (tw.doorKey) { const e = parseEdgeKey(tw.doorKey); put(e.type, e.x, e.y + 1, { type: 'door', hidden: false, secret: false, material: 'wood', rs: tw.id }); }
    });
    // a spiral staircase up in the middle of each tower
    (res.stairs || []).forEach(([x, y]) => { const cell = cells[mapColLabel(x) + (y + 1)]; if (cell) cell.furniture = 'spiral-up'; });
    // a city's fields, woods and water, and its streets and roads
    (res.terrain || []).forEach(([x, y, t]) => { const k = mapColLabel(x) + (y + 1); if (!cells[k]) cells[k] = t === 'water' ? { terrain: t, round: true, hidden: false, fogRevealed: false } : { terrain: t, hidden: false, fogRevealed: false }; });
    (res.roads || []).forEach(([x, y, kind]) => { const k = mapColLabel(x) + (y + 1); if (!cells[k]) cells[k] = { hidden: false, fogRevealed: false }; if (!cells[k].furniture) cells[k].furniture = kind === 'dirt' ? 'road-dirt' : 'road-stone'; });
    // furniture the generator placed, and a moat of water round the walls
    (res.furniture || []).forEach(f => { const cell = cells[mapColLabel(f.x) + (f.y + 1)]; if (cell && !cell.furniture) cell.furniture = f.piece; });
    (res.moat || []).forEach(([x, y]) => { const k = mapColLabel(x) + (y + 1); if (!cells[k]) cells[k] = { terrain: 'water', hidden: false, fogRevealed: false }; });
    // a door square (a doorway cut through rock) puts its door across the opening
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        if (grid[y][x] !== 'door') continue;
        const wallN = !open(x, y - 1), wallS = !open(x, y + 1), wallW = !open(x - 1, y), wallE = !open(x + 1, y);
        const candidates = [];
        if ((wallN || wallS) && !wallW) candidates.push('W');
        if ((wallN || wallS) && !wallE) candidates.push('E');
        if ((wallE || wallW) && !wallN) candidates.push('N');
        if ((wallE || wallW) && !wallS) candidates.push('S');
        const side = candidates[0] || (!wallN && 'N') || (!wallS && 'S') || (!wallW && 'W') || 'E';
        if (side === 'N') put('H', x, y + 1, Object.assign({}, door));
        else if (side === 'S') put('H', x, y + 2, Object.assign({}, door));
        else if (side === 'W') put('V', x, y + 1, Object.assign({}, door));
        else put('V', x + 1, y + 1, Object.assign({}, door));
    }
    // props (trees, a well, a hatch, a plank bridge...) and the names over buildings, as free objects on the map
    let z = 1;
    (res.objects || []).forEach(ob => {
        const o = { t: 'obj', kind: ob.kind, x: ob.x, y: ob.y, w: ob.w, h: ob.h, rot: ob.rot || 0, z: z++ };
        if (ob.color) o.color = ob.color;
        ink.push(o);
    });
    (res.labels || []).forEach(lb => {
        const len = Math.max(1, String(lb.text).length);
        const fs = Math.max(0.35, Math.min(lb.size || 0.75, ((lb.maxW || 12) / (len * 0.56 + 0.3)) * 0.98));
        const w = Math.max(0.6, len * fs * 0.56 + 0.3), h = Math.max(0.6, fs * 1.25 + 0.1);
        ink.push({ t: 'obj', kind: 'label', text: lb.text, fs: Math.round(fs * 100) / 100, x: Math.max(0, Math.round((lb.x - w / 2) * 100) / 100), y: Math.max(0, Math.round((lb.y - h / 2) * 100) / 100), w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100, rot: 0, z: z++ });
    });
    return { cells, edges, ink };
}

root.MapGen = { generateCastle, edgeKey, xmur3, mulberry32, makeRng, cellHash, placeDoorsAlongRun, generateDungeon, generateTavern, findFloorRegions, connectCaveRegions, addExtraCaveChambers, generateCave, valueNoise2D, scatterPoints, scatterLandmarks, ROAD_TERRAIN_COST, traceMainRoad, traceConnectorRoad, connectLandmarksToRoad, generateWilderness, castleUpperLevels, generateWoods, generateIslands, generateShip, generateMine, generateTemple, mapColLabel, roomTextureFor, resolveFloorTexture, isOpenCell, parseEdgeKey, MIXED_FLOOR_TEXTURES, generate, buildLayout, clampSide };
})(window);
