// Shovey Island: sandy islands in clear shallow water, raised meadows and
// the things Shovey meets there. Terrain tiles are height fields seen from
// above; their shorelines sit at fixed insets so any neighbours join.
import { THREE, C, mat, box, sphere, cylinder, torus, lathe, slab, polygon, circleShape,
    roundedRectShape, starShape, group, at, turned, scaled, periodicNoise, blend, rng } from './kit.js';
import { shovey } from './shovey.js';

// ---------------------------------------------------------------- terrain

const SHORE = 0.14;
const MEADOW = 0.1;
const SAND_TOP = 0.035;
const BED = -0.07;
const MEADOW_TOP = 0.11;

const sandNoise = periodicNoise(10, 101);
const sandFine = periodicNoise(64, 102);
const grassNoise = periodicNoise(8, 201);
const grassFine = periodicNoise(48, 202);
const waterNoise = periodicNoise(6, 301);
const waterFine = periodicNoise(24, 302);

const smooth = (a, b, t) => {
    const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
    return x * x * (3 - 2 * x);
};

// Signed distance into a region whose outside lies beyond the named sides.
// Two adjacent outside sides make a rounded corner; neighbours always meet
// at the same inset, so a corner joins its edge pieces exactly.
function inside(sides, inset, x, y) {
    const n = sides.includes('n'), e = sides.includes('e'), s = sides.includes('s'), w = sides.includes('w');
    if (n && w && !s && !e) return (1 - inset) - Math.hypot(0.5 - x, 0.5 - y);
    if (n && e && !s && !w) return (1 - inset) - Math.hypot(x + 0.5, 0.5 - y);
    if (s && e && !n && !w) return (1 - inset) - Math.hypot(x + 0.5, y + 0.5);
    if (s && w && !n && !e) return (1 - inset) - Math.hypot(0.5 - x, y + 0.5);
    let d = 1;
    if (n) d = Math.min(d, y + 0.5 - inset);
    if (s) d = Math.min(d, 0.5 - y - inset);
    if (w) d = Math.min(d, x + 0.5 - inset);
    if (e) d = Math.min(d, 0.5 - x - inset);
    return d;
}

function sandColor(u, v, wet) {
    const grain = sandNoise(u, v) * 0.6 + sandFine(u, v) * 0.4;
    let color = blend('#ebdfbb', '#d9caa0', grain);
    if (sandFine(u * 0.5 + 0.3, v * 0.5) > 0.86) color = blend('#ebdfbb', '#b9a77d', 0.6);
    const damp = blend('#d6c9a2', '#cbbd95', grain);
    return color.map((value, i) => value + (damp[i] - value) * wet);
}

function grassColor(u, v) {
    const t = grassNoise(u, v) * 0.55 + grassFine(u, v) * 0.45;
    let color = blend('#8cc690', '#6fae7f', t);
    if (grassFine(u + 0.37, v + 0.11) > 0.82) color = blend('#8cc690', '#b7dfa6', 0.7);
    return color;
}

function bedColor(depth) {
    return blend('#c9bc94', '#3f7c8f', smooth(0.0, 0.07, depth));
}

// One tile of ground: `land(x, y)` gives {height, color}; water covers
// anything below sea level.
function terrain(land, { water = true } = {}) {
    const geometry = new THREE.PlaneGeometry(1, 1, 192, 192);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i += 1) {
        const x = position.getX(i), y = position.getZ(i);
        const { height, color } = land(x, y, x + 0.5, y + 0.5);
        position.setY(i, height);
        colors[i * 3] = color[0] / 255; colors[i * 3 + 1] = color[1] / 255; colors[i * 3 + 2] = color[2] / 255;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const ground = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    ground.userData.castShadow = false;
    const parts = [ground];
    if (water) parts.push(sea(land));
    return group(parts);
}

// Translucent water with light ripples and foam where it meets the shore.
function sea(land) {
    const geometry = new THREE.PlaneGeometry(1, 1, 128, 128);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i += 1) {
        const x = position.getX(i), y = position.getZ(i);
        const u = x + 0.5, v = y + 0.5;
        const ripple = waterNoise(u, v) * 0.6 + waterFine(u, v) * 0.4;
        let color = blend('#8ccbd8', '#6db3c6', ripple);
        if (waterFine(u * 0.5 + 0.21, v * 0.5 + 0.4) > 0.8) color = blend('#7cc0d0', '#cdeef3', 0.5);
        const height = land(x, y, u, v).height;
        const foam = smooth(-0.03, -0.005, height) * (1 - smooth(-0.004, 0.0, height));
        color = color.map((value, c) => value + ([238, 247, 245][c] - value) * foam * 0.85);
        colors[i * 3] = color[0] / 255; colors[i * 3 + 1] = color[1] / 255; colors[i * 3 + 2] = color[2] / 255;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const surface = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true,
        roughness: 0.55, transparent: true, opacity: 0.72 }));
    surface.userData.castShadow = false;
    surface.userData.receiveShadow = false;
    return surface;
}

// Sand rising out of the water, with damp sand at the waterline.
function beach(sides) {
    return (x, y, u, v) => {
        const d = sides === null ? -1 : inside(sides, SHORE, x, y);
        const height = BED + (SAND_TOP - BED) * smooth(-0.13, 0.04, d);
        const wet = 1 - smooth(0.0, 0.07, d);
        const color = height < 0 ? bedColor(-height) : sandColor(u, v, wet);
        return { height, color };
    };
}

// A raised meadow on dry sand, with an earthy bank around it.
function meadow(sides) {
    return (x, y, u, v) => {
        const d = inside(sides, MEADOW, x, y);
        const rise = smooth(-0.06, 0.005, d);
        const height = SAND_TOP + (MEADOW_TOP - SAND_TOP) * rise;
        let color;
        if (d > 0.004) color = grassColor(u, v);
        else if (d > -0.06) color = blend('#b89470', '#9c7a58', smooth(-0.06, 0.0, d));
        else color = sandColor(u, v, 0);
        // A soft lip of lighter grass along the edge of the meadow.
        if (d > 0.004 && d < 0.03) color = color.map((value, i) => value + ([168, 210, 150][i] - value) * 0.35);
        return { height, color };
    };
}

const SEA = beach(null);
const SAND = beach('');

function ground(land, extra = []) {
    return () => group(terrain(land), ...extra.map(part => part()));
}

// Flat pieces laid into the ground, `lift` above the sand.
function inlay(shape, tone, lift = 0, depth = 0.006, options = {}) {
    const mesh = slab(shape, depth, mat(tone, { rough: 0.85, ...options }), 0.008);
    mesh.position.y += SAND_TOP + lift;
    mesh.userData.castShadow = false;
    return mesh;
}

function stonePlate(tone = '#b5c1bd') {
    return inlay(roundedRectShape(-0.36, -0.36, 0.72, 0.72, 0.1), tone, -0.004, 0.012);
}

function rings(tones, glow = true) {
    const parts = [inlay(circleShape(0, 0, 0.4), '#8d9f9a', -0.004, 0.012)];
    tones.forEach((tone, i) => {
        parts.push(inlay(circleShape(0, 0, 0.33 - i * 0.08), tone, 0.024 + i * 0.006, 0.004,
            glow ? { glow: tone, glowStrength: 0.2 + i * 0.12 } : {}));
    });
    return group(parts);
}

function statueTarget(tone) {
    return () => {
        const plate = inlay(roundedRectShape(-0.38, -0.38, 0.76, 0.76, 0.08), tone, -0.004, 0.012);
        const carving = inlay(circleShape(0, 0, 0.2), new THREE.Color(tone).multiplyScalar(0.7).getStyle(), 0.03, 0.003);
        const center = inlay(circleShape(0, 0, 0.12), new THREE.Color(tone).lerp(new THREE.Color('#ffffff'), 0.35).getStyle(), 0.037, 0.003);
        return group(plate, carving, center);
    };
}

function flowerBed(petal) {
    return () => {
        const random = rng(petal === C.red ? 7 : 9);
        const parts = [];
        const leafMaterial = mat('#4f9a62', { side: THREE.DoubleSide });
        for (let i = 0; i < 9; i += 1) {
            const a = i / 9 * Math.PI * 2 + random() * 0.3;
            const r = 0.12 + random() * 0.16;
            const leaf = scaled(sphere(0.07, leafMaterial, 16), 1.5, 0.35, 0.8);
            leaf.position.set(Math.cos(a) * r, SAND_TOP + 0.03, Math.sin(a) * r);
            leaf.rotation.y = -a;
            parts.push(leaf);
        }
        for (const [x, z] of [[-0.14, -0.1], [0.15, -0.06], [0.0, 0.14], [0.2, 0.2], [-0.2, 0.18]]) {
            const head = group(
                ...[0, 1, 2, 3, 4].map(k => at(scaled(sphere(0.035, mat(petal), 12), 1.2, 0.5, 1.2),
                    Math.cos(k * 1.2566) * 0.04, 0, Math.sin(k * 1.2566) * 0.04)),
                at(sphere(0.025, mat(C.yellow), 10), 0, 0.012, 0));
            head.position.set(x, SAND_TOP + 0.07, z);
            parts.push(head);
        }
        return group(parts);
    };
}

function well() {
    const random = rng(31);
    const parts = [inlay(circleShape(0, 0, 0.3), '#4f97ad', -0.004, 0.006, { glow: '#4f97ad', glowStrength: 0.1 })];
    for (let i = 0; i < 11; i += 1) {
        const a = i / 11 * Math.PI * 2;
        const stone = scaled(sphere(0.07, mat(i % 2 ? '#9aa8a4' : '#b3bfbb'), 16), 1.2, 0.7, 1);
        stone.position.set(Math.cos(a) * 0.33, SAND_TOP + 0.03, Math.sin(a) * 0.33);
        stone.rotation.y = random() * 3;
        parts.push(stone);
    }
    parts.push(inlay(circleShape(-0.06, -0.06, 0.07), '#cdeef3', 0.004, 0.003));
    return group(parts);
}

function soil(planted) {
    return () => {
        const parts = [inlay(roundedRectShape(-0.36, -0.36, 0.72, 0.72, 0.12), '#6e4c36', -0.004, 0.014)];
        for (let i = 0; i < 4; i += 1) {
            const ridge = at(box(0.6, 0.035, 0.07, 0.03, mat('#7d5a40')), 0, SAND_TOP + 0.025, -0.24 + i * 0.16);
            parts.push(ridge);
        }
        if (planted) {
            parts.push(at(scaled(sphere(0.11, mat('#5e4230'), 20), 1.2, 0.45, 1.2), 0, SAND_TOP + 0.03, 0));
            parts.push(at(scaled(sphere(0.045, mat('#9a6a3f'), 16), 1, 0.7, 1.4), 0, SAND_TOP + 0.07, 0));
        }
        return group(parts);
    };
}

function spikeHoles() {
    const parts = [inlay(roundedRectShape(-0.34, -0.34, 0.68, 0.68, 0.08), '#97a3a0', -0.004, 0.012)];
    for (const [x, y] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) {
        parts.push(inlay(circleShape(x, y, 0.06), '#2b3533', 0.022, 0.002));
    }
    return group(parts);
}

function spikePlate() {
    return group(stonePlate('#a9b6b2'),
        inlay(polygon([[-0.16, 0.12], [0, -0.16], [0.16, 0.12]]), '#6f7f7b', 0.03, 0.003));
}

function eyePlate() {
    return group(stonePlate('#a9b6b2'),
        inlay(circleShape(0, 0, 0.17), '#e9f1ee', 0.03, 0.003),
        inlay(circleShape(0, 0, 0.09), C.lake, 0.034, 0.003),
        inlay(circleShape(-0.03, -0.03, 0.03), '#ffffff', 0.038, 0.002));
}

function bombField() {
    const random = rng(36);
    const parts = [inlay(circleShape(0, 0, 0.38), '#c99b6a', -0.004, 0.008)];
    parts.push(inlay(circleShape(0, 0, 0.3), '#5d554d', 0.012, 0.006));
    for (let i = 0; i < 6; i += 1) {
        const a = i / 6 * Math.PI * 2 + random() * 0.4;
        parts.push(inlay(polygon([[0, 0], [Math.cos(a - 0.08) * 0.28, Math.sin(a - 0.08) * 0.28],
            [Math.cos(a + 0.08) * 0.28, Math.sin(a + 0.08) * 0.28]]), '#3a3530', 0.02, 0.002));
    }
    return group(parts);
}

function raft() {
    const parts = [];
    for (let i = 0; i < 5; i += 1) {
        const log = turned(cylinder(0.07, 0.07, 0.78, mat(i % 2 ? C.wood : C.lightWood), 20), 0, 0, Math.PI / 2);
        log.position.set(0, 0.03, -0.28 + i * 0.14);
        log.userData.castShadow = false;
        parts.push(log);
    }
    for (const x of [-0.27, 0.27]) {
        const rope = at(box(0.05, 0.03, 0.74, 0.015, mat(C.earth)), x, 0.1, 0);
        parts.push(rope);
    }
    return group(parts);
}

function sunkenCrate() {
    const crate = at(box(0.8, 0.12, 0.8, 0.04, mat(C.wood)), 0, -0.035, 0);
    const parts = [crate];
    for (let i = 0; i < 4; i += 1) parts.push(at(box(0.76, 0.02, 0.03, 0.01, mat(C.bark)), 0, 0.026, -0.27 + i * 0.18));
    return group(parts);
}

function iceFloe() {
    const shape = polygon([[-0.38, -0.3], [-0.1, -0.4], [0.3, -0.36], [0.4, -0.05], [0.34, 0.33], [0.02, 0.4], [-0.36, 0.3], [-0.42, 0.02]]);
    const floe = slab(shape, 0.02, mat('#e8f4f6', { rough: 0.4 }), 0.02);
    floe.position.y = -0.01;
    floe.userData.castShadow = false;
    const crack = slab(polygon([[-0.2, -0.25], [0.02, 0.0], [0.24, 0.2], [0.22, 0.23], [0.0, 0.04], [-0.23, -0.23]]), 0.004, mat('#a9cdd6'), 0.003);
    crack.position.y = 0.045;
    return group(floe, crack);
}

function bridge() {
    const parts = [];
    for (let i = 0; i < 4; i += 1) {
        const plank = at(box(0.86, 0.04, 0.2, 0.02, mat(i % 2 ? C.lightWood : C.wood)), 0, 0.012, -0.32 + i * 0.215);
        plank.userData.castShadow = false;
        parts.push(plank);
    }
    return group(parts);
}

// A shallow packed-sand bed that coconuts roll along.
function channel(x, y, u, v) {
    return { height: SAND_TOP - 0.025, color: sandColor(u, v, 0.55).map(c => c * 0.93) };
}

function channelHole() {
    const pit = at(scaled(sphere(0.22, mat('#2f2a26'), 32), 1, 0.12, 1), 0, SAND_TOP - 0.02, 0);
    const rim = at(turned(torus(0.24, 0.035, mat('#b79c74')), Math.PI / 2, 0, 0), 0, SAND_TOP - 0.01, 0);
    return group(pit, rim);
}

function pebbles() {
    const random = rng(46);
    const parts = [];
    for (let i = 0; i < 7; i += 1) {
        const stone = scaled(sphere(0.035 + random() * 0.025, mat(random() > 0.5 ? '#b8ab8f' : '#a6a294'), 12), 1.3, 0.6, 1);
        stone.position.set(-0.38 + random() * 0.76, SAND_TOP + 0.008, -0.38 + random() * 0.76);
        stone.userData.castShadow = false;
        parts.push(stone);
    }
    return group(parts);
}

function filledHole() {
    return group(inlay(circleShape(0, 0, 0.26), '#d7c79c', -0.004, 0.004),
        inlay(circleShape(0, 0, 0.17), '#e3d5ad', 0.006, 0.003));
}

function flowerTarget(tone) {
    return () => {
        const ring = inlay(circleShape(0, 0, 0.3), tone, MEADOW_TOP - SAND_TOP, 0.004);
        const hollow = inlay(circleShape(0, 0, 0.22), '#6aa874', MEADOW_TOP - SAND_TOP + 0.004, 0.004);
        return group(ring, hollow);
    };
}

// ---------------------------------------------------------------- objects

function palm(variant) {
    return () => {
        const trunk = new THREE.Group();
        const bark = mat(variant ? '#8f6a4a' : C.bark);
        const lean = variant ? 0.16 : -0.1;
        for (let i = 0; i < 7; i += 1) {
            const ring = cylinder(0.07 - i * 0.004, 0.078 - i * 0.004, 0.085, bark, 16);
            ring.position.set(lean * i * i * 0.012, 0.045 + i * 0.082, 0);
            ring.rotation.z = -lean * i * 0.04;
            trunk.add(ring);
        }
        const top = new THREE.Vector3(lean * 36 * 0.012, 0.6, 0);
        const frond = mat(variant ? '#4f9a62' : '#5aa66a', { side: THREE.DoubleSide });
        const leaves = [];
        const count = 8;
        for (let i = 0; i < count; i += 1) {
            const shape = new THREE.Shape();
            shape.moveTo(0, -0.04);
            shape.quadraticCurveTo(0.24, -0.11, 0.44, 0.0);
            shape.quadraticCurveTo(0.24, 0.08, 0, 0.04);
            const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: false });
            const leaf = new THREE.Mesh(geometry, frond);
            const pivot = new THREE.Group();
            leaf.rotation.x = Math.PI / 2;
            leaf.rotation.y = 0.45;
            pivot.add(leaf);
            pivot.rotation.y = i / count * Math.PI * 2 + (variant ? 0.3 : 0);
            pivot.position.copy(top);
            leaves.push(pivot);
        }
        const nuts = (variant ? [[0.05, 0.03], [-0.04, 0.04], [0.0, -0.05]] : [[0.04, 0.04]]).map(([x, z]) =>
            at(sphere(0.045, mat('#6e4c36'), 16), top.x + x, top.y - 0.05, z));
        return scaled(group(trunk, leaves, nuts), 0.95);
    };
}

function rock() {
    const geometry = new THREE.IcosahedronGeometry(0.3, 2);
    const position = geometry.attributes.position;
    const random = rng(54);
    const bumps = new Map();
    for (let i = 0; i < position.count; i += 1) {
        const key = `${position.getX(i).toFixed(3)},${position.getY(i).toFixed(3)},${position.getZ(i).toFixed(3)}`;
        if (!bumps.has(key)) bumps.set(key, 0.85 + random() * 0.25);
        const k = bumps.get(key);
        position.setXYZ(i, position.getX(i) * k * 1.15, Math.max(-0.05, position.getY(i) * k * 0.8), position.getZ(i) * k);
    }
    geometry.computeVertexNormals();
    const stone = new THREE.Mesh(geometry, mat('#a3aeaa', { rough: 0.9, flat: true }));
    stone.position.y = 0.2;
    const moss = at(scaled(sphere(0.12, mat('#6fa77a', { rough: 1 }), 16), 1.6, 0.4, 1.2), -0.08, 0.42, -0.02);
    return group(stone, moss);
}

function driftCrate() {
    const wood = mat('#b08a62', { rough: 0.9 });
    const dark = mat('#7d5a40', { rough: 0.9 });
    const parts = [at(box(0.7, 0.58, 0.7, 0.05, wood), 0, 0.29, 0)];
    for (let i = 0; i < 3; i += 1) parts.push(at(box(0.72, 0.025, 0.72, 0.01, dark), 0, 0.1 + i * 0.19, 0));
    parts.push(at(box(0.08, 0.6, 0.73, 0.02, dark), -0.3, 0.29, 0));
    parts.push(at(box(0.08, 0.6, 0.73, 0.02, dark), 0.3, 0.29, 0));
    return group(parts);
}

function chest(open) {
    return () => {
        const wood = mat('#9a6f4b');
        const band = mat(C.gold, { rough: 0.5 });
        const parts = [at(box(0.66, 0.34, 0.44, 0.05, wood), 0, 0.17, 0)];
        parts.push(at(box(0.68, 0.05, 0.46, 0.02, band), 0, 0.3, 0));
        const lid = new THREE.Group();
        // A half barrel along the chest, hinged at its back edge.
        const top = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.66, 32, 1, false, 0, Math.PI), wood);
        top.rotation.z = Math.PI / 2;
        top.position.z = 0.22;
        lid.add(top);
        lid.add(at(turned(torus(0.225, 0.02, band, Math.PI), 0, Math.PI / 2, 0), 0, 0, 0.22));
        lid.position.set(0, 0.34, -0.22);
        if (open) {
            lid.rotation.x = -1.9;
            parts.push(at(scaled(sphere(0.2, mat(C.gold, { glow: '#f4cf73', glowStrength: 0.4, rough: 0.5 }), 24), 1.3, 0.35, 0.8), 0, 0.33, 0));
        } else {
            parts.push(at(box(0.09, 0.12, 0.03, 0.02, band), 0, 0.3, 0.23));
        }
        parts.push(lid);
        return group(parts);
    };
}

function islandKey() {
    const brass = mat(C.gold, { rough: 0.5 });
    const bow = at(turned(torus(0.11, 0.045, brass), Math.PI / 2 - 0.4, 0, 0.3), -0.17, 0.12, 0);
    const shaft = at(turned(cylinder(0.034, 0.034, 0.42, brass), 0, 0, Math.PI / 2 - 0.3), 0.08, 0.2, 0);
    const bit = at(turned(box(0.06, 0.12, 0.05, 0.015, brass), 0, 0, -0.3), 0.24, 0.2, 0.04);
    return group(bow, shaft, bit);
}

function statue(tone, neutral) {
    return () => {
        const stone = mat(neutral ? '#a3aeaa' : tone, { rough: 0.8 });
        const shade = new THREE.Color(neutral ? '#a3aeaa' : tone).multiplyScalar(0.6).getStyle();
        const dark = mat(shade);
        const base = at(box(0.5, 0.1, 0.42, 0.04, mat('#8d9a96')), 0, 0.05, 0);
        const body = at(box(0.38, 0.26, 0.3, 0.08, stone), 0, 0.23, 0);
        const head = at(box(0.42, 0.3, 0.34, 0.12, stone), 0, 0.5, 0);
        const eyes = [-0.09, 0.09].map(x => at(scaled(sphere(0.045, mat('#f3f1e8'), 16), 1, 1, 0.4), x, 0.53, 0.17));
        const pupils = [-0.09, 0.09].map(x => at(scaled(sphere(0.02, mat(C.ink), 10), 1, 1, 0.4), x, 0.53, 0.19));
        const mouth = at(box(0.14, 0.03, 0.02, 0.01, dark), 0, 0.43, 0.17);
        const hands = [-1, 1].map(side => at(box(0.07, 0.14, 0.08, 0.03, dark), side * 0.2, 0.22, 0.08));
        return group(base, body, head, eyes, pupils, mouth, hands);
    };
}

function seed() {
    const body = scaled(sphere(0.14, mat('#8a5d3b'), 32), 0.75, 1.1, 0.75);
    body.position.y = 0.16;
    body.rotation.z = 0.5;
    const stripe = scaled(sphere(0.141, mat('#e6d0a8'), 32), 0.2, 1.08, 0.76);
    stripe.position.y = 0.16;
    stripe.rotation.z = 0.5;
    return group(body, stripe);
}

function seaStar() {
    const body = slab(starShape(0, 0, 0.36, 0.14), 0.04, mat('#ef9a68', { rough: 0.85 }), 0.04);
    const dots = [];
    for (let i = 0; i < 5; i += 1) {
        const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
        dots.push(at(sphere(0.025, mat('#fbd7b6'), 10), Math.cos(a) * 0.17, 0.1, Math.sin(a) * 0.17));
    }
    return group(body, dots);
}

function crab(size, mood = 'calm') {
    return () => {
        const shell = mat(size > 0.8 ? '#d0644a' : '#e07a5a');
        const dark = mat('#a2412f');
        const body = at(scaled(sphere(0.2, shell, 32), 1.3, 0.62, 1), 0, 0.15, 0);
        const parts = [body];
        for (const side of [-1, 1]) {
            for (let k = 0; k < 3; k += 1) {
                const leg = at(turned(cylinder(0.018, 0.022, 0.2, dark, 8), 0, 0, side * (1.1 + k * 0.15)), side * 0.26, 0.08, -0.08 + k * 0.09);
                parts.push(leg);
            }
            const arm = at(turned(cylinder(0.03, 0.03, 0.14, shell, 10), 0.4, 0, side * 0.9), side * 0.25, 0.18, 0.12);
            const claw = at(scaled(sphere(0.07, shell, 16), 1, 0.8, 1.2), side * 0.3, 0.23, 0.18);
            parts.push(arm, claw);
            const stalk = at(cylinder(0.014, 0.014, 0.1, dark, 8), side * 0.07, 0.26, 0.1);
            const eye = at(sphere(0.035, mat(C.white), 12), side * 0.07, 0.32, 0.1);
            const pupil = at(sphere(0.018, mat(C.ink), 8), side * 0.07, 0.32, 0.13);
            parts.push(stalk, eye, pupil);
        }
        if (mood === 'happy') {
            const smile = at(torus(0.06, 0.012, dark, Math.PI), 0, 0.17, 0.2);
            smile.rotation.z = Math.PI;
            parts.push(smile);
            const heart = slab(heartShape(), 0.02, mat(C.pink, { glow: C.pink, glowStrength: 0.3 }), 0.015);
            heart.rotation.x = 0;
            heart.position.set(0.2, 0.52, 0);
            heart.scale.set(0.8, -0.8, 0.8);
            parts.push(heart);
        }
        return scaled(group(parts), size);
    };
}

function heartShape() {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.08);
    shape.bezierCurveTo(-0.12, -0.02, -0.06, -0.12, 0, -0.05);
    shape.bezierCurveTo(0.06, -0.12, 0.12, -0.02, 0, 0.08);
    return shape;
}

function bottle(full) {
    return () => {
        const glass = mat('#d8ece9', { rough: 0.25, opacity: 0.7 });
        const parts = [lathe([[0, 0], [0.13, 0.01], [0.15, 0.06], [0.15, 0.3], [0.08, 0.4], [0.05, 0.46], [0.05, 0.52], [0, 0.52]], glass)];
        parts.push(at(cylinder(0.055, 0.05, 0.06, mat('#a9805a')), 0, 0.54, 0));
        if (full) parts.push(lathe([[0, 0.02], [0.13, 0.03], [0.135, 0.06], [0.135, 0.27], [0, 0.27]], mat('#4f97ad', { glow: '#4f97ad', glowStrength: 0.15 })));
        return group(parts);
    };
}

function coconut() {
    const shell = sphere(0.2, mat('#7a5638', { rough: 0.95 }));
    shell.position.y = 0.2;
    shell.scale.set(1, 0.95, 1);
    const fibres = [];
    for (let i = 0; i < 3; i += 1) fibres.push(at(sphere(0.025, mat('#4b3424'), 8), -0.05 + i * 0.05, 0.33, 0.12));
    return group(shell, fibres);
}

function coconutHole() {
    const pit = at(scaled(sphere(0.28, mat('#2f2a26'), 32), 1, 0.08, 0.9), 0, 0.005, 0);
    const rim = at(turned(torus(0.29, 0.045, mat('#c7b38c')), Math.PI / 2, 0, 0), 0, 0.02, 0);
    rim.scale.set(1, 0.9, 1);
    return group(pit, rim);
}

function bomb() {
    const shell = at(sphere(0.22, mat('#3b4442', { rough: 0.6 })), 0, 0.22, 0);
    const cap = at(cylinder(0.07, 0.08, 0.07, mat('#6f7f7b')), 0, 0.45, 0);
    const fuse = at(turned(cylinder(0.014, 0.014, 0.12, mat(C.earth), 8), 0, 0, 0.6), 0.05, 0.52, 0);
    const spark = at(new THREE.Mesh(new THREE.OctahedronGeometry(0.04), mat(C.orange, { glow: C.orange, glowStrength: 1 })), 0.09, 0.58, 0);
    return group(shell, cap, fuse, spark);
}

function hut() {
    const wall = mat('#c4a079');
    const thatch = mat('#9db36f', { rough: 0.95 });
    const parts = [at(cylinder(0.27, 0.29, 0.32, wall, 32), 0, 0.16, 0)];
    parts.push(at(new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.36, 32), thatch), 0, 0.5, 0));
    parts.push(at(box(0.15, 0.22, 0.05, 0.04, mat(C.orange, { glow: C.orange, glowStrength: 0.4 })), 0, 0.12, 0.27));
    parts.push(at(sphere(0.04, mat(C.earth), 10), 0, 0.69, 0));
    return group(parts);
}

function spring(pressed) {
    return () => {
        const stem = mat('#6aa874');
        const coil = [];
        const turns = pressed ? 3 : 4;
        for (let i = 0; i < turns; i += 1) {
            const ring = at(turned(torus(0.12, 0.025, stem), Math.PI / 2, 0, 0), 0, 0.05 + i * (pressed ? 0.04 : 0.075), 0);
            coil.push(ring);
        }
        const padY = pressed ? 0.2 : 0.36;
        const pad = at(scaled(sphere(0.24, mat('#e78f7a'), 32), 1, 0.32, 1), 0, padY, 0);
        const spots = [[-0.1, 0.04], [0.08, -0.06], [0.06, 0.1]].map(([x, z]) =>
            at(scaled(sphere(0.035, mat('#fbe7da'), 10), 1, 0.5, 1), x, padY + 0.06, z));
        return group(coil, pad, spots);
    };
}

function puff() {
    const parts = [];
    for (const [x, y, r] of [[-0.12, 0.2, 0.13], [0.1, 0.22, 0.15], [0, 0.34, 0.14], [0.05, 0.14, 0.1]]) {
        parts.push(at(sphere(r, mat('#dfe5e2', { rough: 1 }), 24), x, y, 0));
    }
    return group(parts);
}

function shot() {
    const stone = mat('#8f9a97');
    return group(
        at(scaled(sphere(0.12, stone, 20), 1.1, 0.85, 1), -0.13, 0.1, 0.06),
        at(scaled(sphere(0.12, stone, 20), 1.1, 0.85, 1), 0.13, 0.1, 0.04),
        at(scaled(sphere(0.12, stone, 20), 1.1, 0.85, 1), 0.0, 0.1, -0.12),
        at(scaled(sphere(0.12, mat('#a3aeaa'), 20), 1.1, 0.85, 1), 0.0, 0.27, -0.01));
}

function pearl() {
    return group(
        at(scaled(sphere(0.2, mat('#e9eef6', { rough: 0.3, metal: 0.1 })), 1, 0.9, 1), 0, 0.2, 0),
        at(sphere(0.05, mat('#ffffff', { glow: '#ffffff', glowStrength: 0.4 })), -0.07, 0.29, 0.12));
}

function coin() {
    const disc = cylinder(0.22, 0.22, 0.05, mat(C.gold, { rough: 0.5 }));
    disc.rotation.x = Math.PI / 2 - 0.15;
    disc.position.y = 0.24;
    const mark = slab(starShape(0, 0, 0.1, 0.045), 0.006, mat('#f6dd8f'), 0.004);
    mark.rotation.x = -0.15;
    mark.position.set(0, 0.24, 0.03);
    return group(disc, mark);
}

function slingshot(loaded) {
    return () => {
        const wood = mat('#8a6446');
        const parts = [at(cylinder(0.07, 0.09, 0.32, wood), 0, 0.16, 0)];
        for (const side of [-1, 1]) {
            parts.push(at(turned(cylinder(0.055, 0.065, 0.34, wood), 0, 0, -side * 0.45), side * 0.1, 0.44, 0));
        }
        const band = at(box(0.36, 0.04, 0.03, 0.015, mat('#c4614f')), 0, 0.58, loaded ? 0.07 : 0.02);
        parts.push(band);
        if (loaded) parts.push(at(sphere(0.09, mat('#8f9a97'), 16), 0, 0.58, 0.12));
        return group(parts);
    };
}

// A broad leaf lying on the ground, its tip pointing one way.
function leafPointing(angle) {
    return () => {
        const shape = new THREE.Shape();
        shape.moveTo(0, -0.4);
        shape.quadraticCurveTo(0.34, -0.12, 0.2, 0.18);
        shape.quadraticCurveTo(0.08, 0.3, 0, 0.26);
        shape.quadraticCurveTo(-0.08, 0.3, -0.2, 0.18);
        shape.quadraticCurveTo(-0.34, -0.12, 0, -0.4);
        const leaf = slab(shape, 0.015, mat('#5aa66a'), 0.015);
        const vein = slab(polygon([[-0.014, 0.4], [0.014, 0.4], [0.006, -0.34], [-0.006, -0.34]]), 0.004, mat('#a7d496'), 0.003);
        vein.position.y = 0.04;
        const stem = slab(polygon([[-0.02, 0.26], [0.02, 0.26], [0.02, 0.44], [-0.02, 0.44]]), 0.012, mat('#7d5a40'), 0.006);
        const g = group(leaf, vein, stem);
        g.rotation.y = angle;
        return g;
    };
}

function spikes() {
    const metal = mat('#a7b2b0', { rough: 0.45, metal: 0.4 });
    const parts = [at(box(0.7, 0.05, 0.7, 0.02, mat('#7d8986')), 0, 0.025, 0)];
    for (const [x, z] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18], [0, 0]]) {
        parts.push(at(new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.32, 16), metal), x, 0.21, z));
    }
    return group(parts);
}

function pirate() {
    const coat = mat('#2f5f73');
    const skin = mat('#e8c4a2');
    const parts = [
        at(scaled(sphere(0.2, coat, 32), 1, 1.1, 0.9), 0, 0.2, 0),
        at(sphere(0.15, skin, 32), 0, 0.45, 0.02),
        at(scaled(sphere(0.13, mat('#6e4c36'), 24), 1.1, 0.7, 0.6), 0, 0.37, 0.09),
        at(scaled(new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.12, 3), mat('#2b2724')), 1, 1, 0.7), 0, 0.6, 0),
        at(sphere(0.02, mat(C.ink), 8), -0.05, 0.48, 0.15),
        at(sphere(0.02, mat(C.ink), 8), 0.05, 0.48, 0.15),
        at(box(0.3, 0.04, 0.24, 0.02, mat(C.gold)), 0, 0.14, 0.02),
    ];
    parts[3].rotation.y = Math.PI / 6;
    return group(parts);
}

function buoy() {
    const float = at(scaled(sphere(0.2, mat('#e98a5e'), 32), 1, 0.8, 1), 0, 0.12, 0);
    const band = at(turned(torus(0.19, 0.03, mat(C.white)), Math.PI / 2, 0, 0), 0, 0.13, 0);
    const pole = at(cylinder(0.02, 0.02, 0.3, mat('#6f7f7b')), 0, 0.35, 0);
    const flag = at(box(0.14, 0.09, 0.01, 0.005, mat(C.jade)), 0.08, 0.45, 0);
    const ripple = at(turned(torus(0.27, 0.012, mat('#d7eef2', { opacity: 0.8 })), Math.PI / 2, 0, 0), 0, 0.01, 0);
    return group(float, band, pole, flag, ripple);
}

function stall() {
    const wood = mat(C.wood);
    const parts = [at(box(0.6, 0.26, 0.4, 0.03, wood), 0, 0.13, 0.05)];
    for (const x of [-0.27, 0.27]) parts.push(at(cylinder(0.025, 0.025, 0.52, mat(C.bark)), x, 0.26, -0.12));
    const awning = at(box(0.7, 0.04, 0.38, 0.02, mat('#e98a5e')), 0, 0.52, 0.0);
    awning.rotation.x = 0.35;
    parts.push(awning);
    for (let i = 0; i < 3; i += 1) parts.push(at(box(0.08, 0.042, 0.39, 0.01, mat(C.white)), -0.2 + i * 0.2, 0.522, 0.0));
    parts[parts.length - 1].rotation.x = parts[parts.length - 2].rotation.x = parts[parts.length - 3].rotation.x = 0.35;
    parts.push(at(sphere(0.05, mat(C.gold, { metal: 0.3, rough: 0.5 }), 12), -0.12, 0.29, 0.12));
    parts.push(at(sphere(0.06, mat('#7a5638'), 12), 0.1, 0.3, 0.1));
    return group(parts);
}

// A small round stone tower with a dish on top; a pearl makes it glow.
function lantern(lit) {
    return () => {
        const stone = mat('#a9b4b0');
        const parts = [
            at(cylinder(0.26, 0.29, 0.08, mat('#8d9a96')), 0, 0.04, 0),
            lathe([[0.22, 0.08], [0.2, 0.3], [0.21, 0.42], [0.25, 0.46], [0.25, 0.5], [0, 0.5]], stone),
            at(box(0.08, 0.12, 0.02, 0.03, mat('#5d6a67')), 0, 0.2, 0.205),
            at(lathe([[0.0, 0.0], [0.18, 0.01], [0.24, 0.08], [0.2, 0.09], [0, 0.04]], mat('#c0c9c6')), 0, 0.5, 0),
        ];
        if (lit) {
            parts.push(at(sphere(0.1, mat('#eef3fb', { glow: '#cfe6ff', glowStrength: 0.9 }), 24), 0, 0.62, 0));
        }
        return group(parts);
    };
}

function clam(state) {
    return () => {
        const shell = mat('#e7c9b8');
        const ridge = mat('#cfa48f');
        const lower = at(scaled(sphere(0.24, shell, 32, ), 1, 0.35, 0.85), 0, 0.07, 0);
        const parts = [lower];
        const upper = scaled(sphere(0.24, shell, 32), 1, 0.35, 0.85);
        if (state === 'closed') {
            upper.position.set(0, 0.13, 0);
            for (let i = -2; i <= 2; i += 1) parts.push(at(turned(box(0.02, 0.02, 0.36, 0.008, ridge), 0, i * 0.3, 0), i * 0.06, 0.2, 0));
        } else {
            upper.position.set(0, 0.26, -0.16);
            upper.rotation.x = -1.1;
        }
        parts.push(upper);
        if (state === 'pearl') parts.push(at(sphere(0.08, mat('#f3f6fb', { rough: 0.3 })), 0, 0.15, 0.03));
        return group(parts);
    };
}

// Snail shells that change mood: only the happy yellow one is done.
function moodShell(tone, mood) {
    return () => {
        const shell = mat(tone);
        const dark = mat(new THREE.Color(tone).multiplyScalar(0.6).getStyle());
        const body = at(scaled(sphere(0.16, mat('#e8d7c4'), 24), 1.6, 0.5, 0.9), 0.04, 0.06, 0.05);
        const coil = at(scaled(sphere(0.2, shell, 32), 1, 1, 0.75), -0.04, 0.25, -0.02);
        const swirl = at(turned(torus(0.1, 0.02, dark), 0, 0, 0), -0.04, 0.25, 0.13);
        const eyes = [-0.04, 0.04].map(x => at(sphere(0.03, mat(C.white), 10), 0.2 + x, 0.15, 0.12));
        const pupils = [-0.04, 0.04].map(x => at(sphere(0.015, mat(C.ink), 8), 0.2 + x, 0.15, 0.145));
        const mouth = at(torus(0.035, 0.008, mat(C.ink), Math.PI), 0.2, mood === 'happy' ? 0.11 : 0.085, 0.14);
        if (mood === 'happy') mouth.rotation.z = Math.PI;
        const parts = [body, coil, swirl, eyes, pupils];
        if (mood !== 'plain') parts.push(mouth);
        return group(parts);
    };
}

// Stones whose number shows only after they are pushed in order.
function numberStone(count) {
    return () => {
        const stone = at(box(0.62, 0.42, 0.62, 0.14, mat('#77b296')), 0, 0.21, 0);
        const parts = [stone];
        const spots = [[], [[0, 0]], [[-0.12, 0], [0.12, 0]], [[-0.15, 0.1], [0, -0.06], [0.15, 0.1]],
            [[-0.12, -0.1], [0.12, -0.1], [-0.12, 0.12], [0.12, 0.12]],
            [[-0.15, -0.12], [0.15, -0.12], [0, 0], [-0.15, 0.12], [0.15, 0.12]]][count];
        for (const [x, z] of spots) {
            parts.push(at(scaled(sphere(0.055, mat('#f4f1e2', { glow: '#fff6d8', glowStrength: 0.5 }), 16), 1, 0.4, 1), x, 0.43, z));
        }
        return group(parts);
    };
}

function flower(tone) {
    return () => {
        const stem = at(cylinder(0.02, 0.025, 0.38, mat('#4f9a62'), 10), 0, 0.19, 0);
        const leaves = [-1, 1].map(side => at(turned(scaled(sphere(0.07, mat('#5aa66a'), 16), 1.8, 0.3, 0.8), 0, 0, side * 0.5), side * 0.08, 0.16, 0));
        const petals = [];
        for (let i = 0; i < 8; i += 1) {
            const a = i / 8 * Math.PI * 2;
            petals.push(at(scaled(sphere(0.06, mat(tone), 16), 1.6, 0.9, 0.5), Math.cos(a) * 0.1, 0.42 + Math.sin(a) * 0.1, 0.02));
            petals[i].rotation.z = a;
        }
        const heart = at(scaled(sphere(0.06, mat(tone === C.yellow ? '#8a6446' : '#f4d070'), 16), 1, 1, 0.6), 0, 0.42, 0.05);
        return group(stem, leaves, petals, heart);
    };
}

function octopus(small) {
    return () => {
        const skin = mat('#b78bc9');
        const parts = [at(scaled(sphere(0.2, skin, 32), 1, 1.05, 0.95), 0, 0.3, 0)];
        for (let i = 0; i < 6; i += 1) {
            const a = i / 6 * Math.PI * 2;
            const arm = at(scaled(sphere(0.07, skin, 16), 1, 0.6, 2.2), Math.cos(a) * 0.17, 0.08, Math.sin(a) * 0.17);
            arm.rotation.y = -a + Math.PI / 2;
            parts.push(arm);
        }
        for (const x of [-0.07, 0.07]) {
            parts.push(at(sphere(0.045, mat(C.white), 12), x, 0.33, 0.17));
            parts.push(at(sphere(0.022, mat(C.ink), 8), x, 0.33, 0.205));
        }
        return scaled(group(parts), small ? 0.7 : 1);
    };
}

function barrel() {
    const wood = mat('#a3784f');
    const hoop = mat('#6f7f7b', { metal: 0.3, rough: 0.5 });
    const body = lathe([[0, 0], [0.22, 0.0], [0.26, 0.15], [0.27, 0.27], [0.26, 0.39], [0.22, 0.54], [0, 0.54]], wood);
    const hoops = [0.08, 0.46].map(y => at(turned(torus(0.245, 0.018, hoop), Math.PI / 2, 0, 0), 0, y, 0));
    const lid = at(cylinder(0.21, 0.21, 0.01, mat('#8a6446')), 0, 0.545, 0);
    return group(body, hoops, lid);
}

// Stone discs that turn a leaf to face the way they point.
function leafTurner(angle) {
    return () => {
        const disc = at(cylinder(0.32, 0.34, 0.06, mat('#a9b6b2')), 0, 0.03, 0);
        const leaf = leafPointing(angle)();
        leaf.scale.set(0.6, 0.6, 0.6);
        leaf.position.y = 0.05;
        const arrow = slab(polygon([[-0.07, -0.26], [0.07, -0.26], [0, -0.36]]), 0.01, mat(C.orange), 0.006);
        const holder = group(arrow);
        holder.position.y = 0.06;
        holder.rotation.y = angle;
        return group(disc, leaf, holder);
    };
}

function stake(withRope) {
    return () => {
        const post = at(cylinder(0.05, 0.06, 0.42, mat(C.bark), 12), 0, 0.21, 0);
        const cap = at(sphere(0.07, mat(C.orange), 16), 0, 0.44, 0);
        const parts = [post, cap];
        if (withRope) parts.push(at(turned(torus(0.1, 0.025, mat('#d9c39b')), Math.PI / 2, 0, 0), 0, 0.2, 0));
        return group(parts);
    };
}

function rope(knot) {
    return () => {
        const cord = mat('#d9c39b', { rough: 0.95 });
        const parts = [at(turned(torus(0.16, 0.035, cord), Math.PI / 2, 0, 0), 0, 0.04, 0),
            at(turned(torus(0.09, 0.035, cord), Math.PI / 2, 0, 0), 0.02, 0.09, 0.01)];
        if (knot) parts.push(at(sphere(0.07, mat('#c9ad7f'), 16), 0, 0.14, 0.02));
        return group(parts);
    };
}

function snail() {
    return moodShell('#d98aa6', 'plain')();
}

// ---------------------------------------------------------------- list

function sprite(id, depicts, build, extra = {}) {
    return { path: `assets/shovey-island/tiles/${id}.png`, group: 'island', depicts, build, ...extra };
}

const FACE = { camera: { pitch: 24, lift: 0.3 } };
const flat = (id, depicts, land, extras) => sprite(id, depicts, ground(land, extras), { view: 'top' });
const thing = (id, depicts, build, extra) => sprite(id, depicts, build, { view: 'tilt', ...extra });
const onSand = (id, depicts, build, extra) => sprite(id, depicts, build, { view: 'tilt', base: ground(SAND), ...extra });

export function islandSprites() {
    const list = [
        flat(0, 'open water', SEA),
        flat(1, 'sand', SAND),
        flat(2, 'sand, rounded top-left shore', beach('nw')),
        flat(3, 'sand, rounded top-right shore', beach('ne')),
        flat(4, 'sand, rounded bottom-right shore', beach('se')),
        flat(5, 'sand, rounded bottom-left shore', beach('sw')),
        flat(6, 'narrow sand bar, water above and below', beach('ns')),
        flat(7, 'narrow sand bar, water left and right', beach('ew')),
        flat(8, 'sand, shore along the top', beach('n')),
        flat(9, 'sand, shore along the right', beach('e')),
        onSand(10, 'flower bed with jade flowers', flowerBed('#6fc3a8'), { outline: false, shadowStrength: 0.25 }),
        flat(11, 'sand, shore along the bottom', beach('s')),
        flat(12, 'sand, shore along the left', beach('w')),
        flat(13, 'raised meadow', meadow('')),
        flat(14, 'meadow, rounded top-left bank', meadow('nw')),
        flat(15, 'meadow, rounded top-right bank', meadow('ne')),
        flat(16, 'meadow, rounded bottom-right bank', meadow('se')),
        flat(17, 'meadow, rounded bottom-left bank', meadow('sw')),
        flat(18, 'narrow meadow, banks above and below', meadow('ns')),
        flat(19, 'narrow meadow, banks left and right', meadow('ew')),
        flat(20, 'meadow, bank along the top', meadow('n')),
        flat(21, 'meadow, bank along the right', meadow('e')),
        flat(22, 'meadow, bank along the bottom', meadow('s')),
        flat(23, 'meadow, bank along the left', meadow('w')),
        flat(24, 'sand where something was filled in', SAND, [filledHole]),
        flat(25, 'barrel spot: a wooden ring in the sand', SAND, [() => group(
            inlay(circleShape(0, 0, 0.32), '#8a6446', -0.004, 0.01), inlay(circleShape(0, 0, 0.25), '#e3d5ad', 0.016, 0.003))]),
        flat(26, 'red statue spot', SAND, [statueTarget(C.red)]),
        flat(27, 'blue statue spot', SAND, [statueTarget(C.blue)]),
        flat(28, 'green statue spot', SAND, [statueTarget(C.green)]),
        flat(29, 'sunken crate: a wooden floor in the water', SEA, [sunkenCrate]),
        flat(30, 'spike plate: a stone plate with a spike mark', SAND, [spikePlate]),
        onSand(31, 'well: a little pool ringed with stones', well, { outline: false, shadowStrength: 0.25, camera: { pitch: 70, lift: 0.0 } }),
        flat(32, 'farm field: tilled soil', SAND, [soil(false)]),
        flat(33, 'planted field: soil with a seed', SAND, [soil(true)]),
        flat(34, 'lowered spikes: a plate with holes', SAND, [spikeHoles]),
        onSand(35, 'flower bed with red flowers', flowerBed(C.red), { outline: false, shadowStrength: 0.25 }),
        flat(36, 'blast spot: cracked stone', SAND, [bombField]),
        flat(37, 'teleporter: jade rings', SAND, [() => rings(['#1e6b57', '#2e8f72', '#58b896', '#bfe8d8'])]),
        flat(38, 'raft on the water', SEA, [raft]),
        flat(39, 'item teleporter: light orange rings', SAND, [() => rings(['#b9663c', '#d9834f', C.orange, '#fbe0c2'])]),
        flat(40, 'thin ice on the water', SEA, [iceFloe]),
        flat(41, 'watch plate: a stone plate with an eye', SAND, [eyePlate]),
        flat(42, 'hidden path: looks like open water', SEA),
        flat(43, 'revealed path: planks across the water', SEA, [bridge]),
        flat(44, 'coconut channel', channel),
        flat(45, 'coconut channel end: a hole', channel, [channelHole]),
        flat(46, 'pebbly sand beside a channel', SAND, [pebbles]),
        flat(47, 'meadow with a yellow flower ring', meadow(''), [flowerTarget(C.yellow)]),
        flat(48, 'meadow with a red flower ring', meadow(''), [flowerTarget(C.red)]),
        thing(49, 'nothing', () => group(), { shadow: false, outline: false }),
        thing(51, 'palm tree', palm(false), { camera: { lift: 0.32, zoom: 0.92 } }),
        thing(52, 'stone lantern, empty', lantern(false)),
        thing(53, 'pink snail', snail),
        thing(54, 'boulder', rock),
        thing(55, 'palm tree with coconuts', palm(true), { camera: { lift: 0.32, zoom: 0.92 } }),
        thing(56, 'Shovey', () => shovey('down'), FACE),
        thing(57, 'crate (pushable)', driftCrate),
        thing(58, 'treasure chest, closed', chest(false)),
        thing(59, 'treasure chest, open', chest(true)),
        thing(60, 'key', islandKey),
        thing(61, 'red statue (pushable)', statue(C.red)),
        thing(62, 'blue statue (pushable)', statue(C.blue)),
        thing(63, 'green statue (pushable)', statue(C.green)),
        thing(64, 'seed', seed),
        thing(65, 'sea star', seaStar),
        thing(66, 'baby crab', crab(0.62)),
        thing(67, 'empty bottle (pushable)', bottle(false)),
        thing(68, 'bottle of water (pushable)', bottle(true)),
        thing(69, 'grey statue, waiting for its group', statue(C.stone, true)),
        thing(70, 'coconut', coconut),
        thing(71, 'coconut hole', coconutHole, { outline: false, shadow: false, camera: { lift: 0 } }),
        thing(72, 'bomb (pushable)', bomb),
        thing(73, 'mother crab', crab(1)),
        thing(74, 'mother crab, happy', crab(1, 'happy')),
        thing(75, 'home: a round hut with a lit door', hut, { camera: { lift: 0.3 } }),
        thing(76, 'spring flower', spring(false)),
        thing(77, 'spring flower, pressed', spring(true)),
        thing(78, 'puff of smoke', puff, { shadow: false }),
        thing(80, 'ammunition: a few round stones', shot),
        thing(81, 'pearl', pearl),
        thing(82, 'coin', coin),
        thing(83, 'slingshot', slingshot(false)),
        thing(84, 'slingshot, loaded', slingshot(true)),
        thing(85, 'leaf pointing up (pushable)', leafPointing(0), { camera: { lift: 0.05 } }),
        thing(86, 'leaf pointing right (pushable)', leafPointing(-Math.PI / 2), { camera: { lift: 0.05 } }),
        thing(87, 'leaf pointing down (pushable)', leafPointing(Math.PI), { camera: { lift: 0.05 } }),
        thing(88, 'leaf pointing left (pushable)', leafPointing(Math.PI / 2), { camera: { lift: 0.05 } }),
        thing(89, 'raised spikes', spikes),
        thing(90, 'pirate', pirate, FACE),
        thing(91, 'buoy', buoy),
        thing(92, 'pirate stall', stall),
        thing(93, 'stone lantern with a glowing pearl', lantern(true)),
        thing(94, 'clam, closed (pushable)', clam('closed')),
        thing(95, 'clam, open with a pearl', clam('pearl')),
        thing(96, 'clam, open and empty', clam('empty')),
        thing(97, 'grumpy red shell (pushable)', moodShell(C.red, 'sad')),
        thing(98, 'sleepy blue shell (pushable)', moodShell(C.blue, 'calm')),
        thing(99, 'happy yellow shell (pushable)', moodShell(C.yellow, 'happy')),
        thing(100, 'shell changing colour', moodShell('#f3efe4', 'calm')),
    ];
    for (let n = 1; n <= 5; n += 1) list.push(thing(100 + n, `numbered stone ${n}, number hidden (pushable)`, numberStone(0)));
    for (let n = 1; n <= 5; n += 1) list.push(thing(105 + n, `numbered stone showing ${n}`, numberStone(n)));
    list.push(
        thing(111, 'yellow flower (pushable)', flower(C.yellow)),
        thing(112, 'red flower (pushable)', flower(C.red)),
        thing(113, 'yellow shell turning', moodShell('#f1d98a', 'calm')),
        thing(114, 'octopus', octopus(false)),
        thing(115, 'octopus resting', octopus(true)),
        thing(116, 'barrel (pushable)', barrel),
        thing(117, 'leaf turner pointing up', leafTurner(0)),
        thing(118, 'leaf turner pointing right', leafTurner(-Math.PI / 2)),
        thing(119, 'leaf turner pointing down', leafTurner(Math.PI)),
        thing(120, 'leaf turner pointing left', leafTurner(Math.PI / 2)),
        thing(121, 'leaf turner turning', leafTurner(-Math.PI / 4)),
        thing(122, 'string post', stake(true)),
        thing(123, 'string laid on the ground', rope(false), { shadow: false, camera: { lift: 0 } }),
        thing(124, 'string tied over a flower', rope(true), { shadow: false, camera: { lift: 0 } }),
    );
    // Facing sprites: 1 up, 2 right, 3 down, 4 left.
    ['up', 'right', 'down', 'left'].forEach((direction, index) => {
        list.push({ path: `assets/shovey-island/player/${index + 1}.png`, group: 'island', view: 'tilt',
            depicts: `Shovey looking ${direction}`, build: () => shovey(direction), ...FACE });
    });
    return list;
}
