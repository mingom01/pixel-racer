// 월드 메쉬 + 복셀 자동차 모델
import * as THREE from './lib/three.module.min.js';
import { textCanvas, signTexture } from './tex.js';

const W = WORLD;
const lambert = (o) => new THREE.MeshLambertMaterial(o);

/* ---------- 공용 지오메트리 ---------- */
// 각 면의 UV를 실제 크기/타일 크기로 맞춘 박스
export function boxUV(sx, sy, sz, tile, raw) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    if (raw && raw.includes(f)) continue;
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
  }
  return g;
}
// 수평 사각형 (월드 좌표 x1..x2, z1..z2)
export function flatQuad(x1, z1, x2, z2, y, tile) {
  const g = new THREE.PlaneGeometry(x2 - x1, z2 - z1);
  g.rotateX(-Math.PI / 2);
  g.translate((x1 + x2) / 2, y, (z1 + z2) / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x2 - x1) / tile, uv.getY(i) * (z2 - z1) / tile);
  return g;
}
// 선분 도로: u 는 폭 방향 0..1, v 는 길이/반복
function roadStrip(s, y, vTile) {
  const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L = Math.hypot(dx, dz);
  const nx = dz / L * s.w / 2, nz = -dx / L * s.w / 2;
  const pos = [s.x1 - nx, y, s.z1 - nz, s.x1 + nx, y, s.z1 + nz, s.x2 - nx, y, s.z2 - nz, s.x2 + nx, y, s.z2 + nz];
  const uv = [0, 0, 1, 0, 0, L / vTile, 1, L / vTile];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 2, 1, 1, 2, 3]);
  g.computeVertexNormals();
  return g;
}
// 트랙 리본 (a..b 폭 구간, 닫힌 경로)
export function ribbon(t, a, b, y, vTile) {
  const n = t.path.length, pos = [], uv = [], idx = [];
  let dist = 0;
  for (let i = 0; i <= n; i++) {
    const p = t.path[i % n], tg = t.tan[i % n];
    if (i > 0) { const q = t.path[i - 1]; dist += Math.hypot(p[0] - q[0], p[1] - q[1]); }
    const nx = tg[1], nz = -tg[0];
    pos.push(p[0] + nx * a, y, p[1] + nz * a, p[0] + nx * b, y, p[1] + nz * b);
    uv.push(0, dist / vTile, 1, dist / vTile);
    if (i < n) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // 법선이 아래를 향하면 뒤집기
  if (g.attributes.normal.getY(0) < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const tmp = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = tmp; } g.computeVertexNormals(); }
  return g;
}
// 쐐기 (경사로)
export function wedgeGeo(r) {
  const L = r.len / 2, w = r.w / 2, h = r.h;
  // 로컬: z 가 올라가는 방향
  const v = [
    [-w, 0, -L], [w, 0, -L], [-w, 0, L], [w, 0, L], [-w, h, L], [w, h, L],
  ];
  const pos = [], uv = [], groups = [];
  const quad = (a, b, c, d, u, vv, mat) => {
    const start = pos.length / 3;
    for (const p of [a, b, c, a, c, d]) pos.push(...v[p]);
    const U = [[0, 0], [u, 0], [u, vv], [0, 0], [u, vv], [0, vv]];
    for (const q of U) uv.push(...q);
    groups.push([start, 6, mat]);
  };
  const tri = (a, b, c, u, vv, mat) => {
    const start = pos.length / 3;
    for (const p of [a, b, c]) pos.push(...v[p]);
    uv.push(0, 0, u, 0, u, vv);
    groups.push([start, 3, mat]);
  };
  const slope = Math.hypot(r.len, h);
  quad(0, 4, 5, 1, slope / 4, r.w / 4, 0); // 윗면 (경사)
  quad(2, 3, 5, 4, r.w / 4, h / 4, 1);     // 뒷면 (수직)
  tri(0, 2, 4, r.len / 4, h / 4, 1);        // 옆면
  tri(1, 5, 3, r.len / 4, h / 4, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  for (const [s, c, m] of groups) g.addGroup(s, c, m);
  g.computeVertexNormals();
  return g;
}

/* ---------- 월드 ---------- */
export function buildWorld(scene, T) {
  const root = new THREE.Group();
  scene.add(root);
  const add = (geo, mat, shadow) => {
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    if (shadow) m.castShadow = true;
    root.add(m);
    return m;
  };

  // 바닥
  add(flatQuad(-W.HALF - 200, -W.HALF - 200, W.HALF + 200, W.HALF + 200, 0, 4), lambert({ map: T.grass }));
  add(flatQuad(W.PARK.x1, W.PARK.z1, W.PARK.x2, W.PARK.z2, 0.02, 4), lambert({ map: T.dirt }));
  add(flatQuad(W.CITY.x1 - 4, W.CITY.z1 - 4, W.CITY.x2 + 4, W.CITY.z2 + 4, 0.02, 4), lambert({ map: T.walk }));
  for (const p of W.cityParks) add(flatQuad(p.x1 + 2, p.z1 + 2, p.x2 - 2, p.z2 - 2, 0.03, 4), lambert({ map: T.grass }));
  for (const l of W.lots) add(flatQuad(l.x1 + 1, l.z1 + 1, l.x2 - 1, l.z2 - 1, 0.03, 4), lambert({ map: T.asphalt }));

  // 도로
  const roadMat = lambert({ map: T.roadCity });
  T.roadCity.repeat.set(1, 1);
  for (const s of W.roads) add(roadStrip(s, s.city ? 0.05 : 0.04, 8), roadMat);
  // 교차로 패치
  const asMat = lambert({ map: T.asphalt });
  const patches = [];
  for (const x of W.CITY.xs) for (const z of W.CITY.zs) patches.push([x, z, W.CITY.w]);
  patches.push([W.CITY.x2 - 0.01, 320, 16], [-320, W.CITY.z1, 16], [-60, 320, 16], [-60, -300, 16], [-320, W.PARK.z2, 16]);
  for (const [x, z, w] of patches) add(flatQuad(x - w / 2, z - w / 2, x + w / 2, z + w / 2, 0.07, 4), asMat);

  // 서킷
  const circ = W.tracks[0];
  add(ribbon(circ, -circ.w / 2, circ.w / 2, 0.06, 8), lambert({ map: T.roadTrack }));
  add(ribbon(circ, circ.w / 2, circ.w / 2 + 1.6, 0.09, 4), lambert({ map: T.curb }));
  add(ribbon(circ, -circ.w / 2 - 1.6, -circ.w / 2, 0.09, 4), lambert({ map: T.curb }));
  for (const t of W.tracks) root.add(startLine(t, T));
  root.add(gantry(circ, T));

  // 부스터
  const bMat = lambert({ map: T.boost, emissive: 0x552200 });
  for (const b of W.boosts) {
    if (b.cx > 3500) continue;
    const g = new THREE.PlaneGeometry(b.w, b.len);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i) * b.len / b.w);
    const m = add(g, bMat);
    m.position.set(b.cx, W.groundHeight(b.cx, b.cz) + 0.12, b.cz);
    m.rotation.y = b.rot;
  }

  // 경사로 / 플랫폼
  const rampMats = [lambert({ map: T.plank, side: THREE.DoubleSide }), lambert({ map: T.hazard, side: THREE.DoubleSide })];
  for (const r of W.ramps) {
    if (r.cx > 3500) continue;
    const m = add(wedgeGeo(r), rampMats, true);
    m.position.set(r.cx, 0, r.cz);
    m.rotation.y = r.rot;
  }
  const conc = lambert({ map: T.concrete });
  for (const p of W.platforms) {
    const m = add(boxUV(p.sx, p.h, p.sz, 4), [rampMats[1], rampMats[1], conc, conc, rampMats[1], rampMats[1]], true);
    m.position.set(p.cx, p.h / 2, p.cz);
  }

  // 건물
  for (const b of W.buildings) buildBuilding(root, b, T);
  for (const c of W.canopies) buildCanopy(root, c, T);
  for (const p of W.pads) add(flatQuad(p.x1, p.z1, p.x2, p.z2, 0.05, 4), asMat);
  buildLamps(root);

  // 나무 (인스턴스)
  const nT = W.trees.length;
  const trunk = new THREE.InstancedMesh(boxUV(1, 4, 1, 4), lambert({ map: T.bark }), nT);
  const leaf = new THREE.InstancedMesh(boxUV(5, 4, 5, 4), lambert({ map: T.leaves }), nT);
  const leaf2 = new THREE.InstancedMesh(boxUV(3, 2, 3, 4), lambert({ map: T.leaves }), nT);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const LCOL = [0xffffff, 0xe0ffd0, 0xd8f0a0, 0xffd890, 0xc8e8c0];
  const rr = W.rng(55);
  W.trees.forEach((t, i) => {
    const s = t.s;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.floor(rr() * 4) * Math.PI / 2);
    sc.set(s, s, s);
    ps.set(t.x, 2 * s, t.z); mtx.compose(ps, q, sc); trunk.setMatrixAt(i, mtx);
    ps.set(t.x, 5.5 * s, t.z); mtx.compose(ps, q, sc); leaf.setMatrixAt(i, mtx);
    ps.set(t.x, 8.5 * s, t.z); mtx.compose(ps, q, sc); leaf2.setMatrixAt(i, mtx);
    const col = new THREE.Color(LCOL[Math.floor(rr() * LCOL.length)]);
    leaf.setColorAt(i, col); leaf2.setColorAt(i, col);
  });
  for (const m of [trunk, leaf, leaf2]) { m.castShadow = true; m.receiveShadow = true; root.add(m); }

  // 외곽 벽
  const stone = lambert({ map: T.stone });
  const H = W.HALF;
  for (const [x, z, sx, sz] of [[0, -H - 1, H * 2 + 4, 2], [0, H + 1, H * 2 + 4, 2], [-H - 1, 0, 2, H * 2 + 4], [H + 1, 0, 2, H * 2 + 4]]) {
    const m = add(boxUV(sx, 3, sz, 4), stone);
    m.position.set(x, 1.5, z);
  }

  // 구름
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, fog: false });
  const cr = W.rng(99);
  for (let i = 0; i < 26; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(30 + cr() * 60, 6, 20 + cr() * 40), cloudMat);
    m.position.set((cr() - 0.5) * 2000, 240 + cr() * 60, (cr() - 0.5) * 2000);
    root.add(m);
  }
  return root;
}

/* ---------- 건물 종류별 ---------- */
const mcache = new Map();
function matC(map, color, extra) {
  const k = (map ? map.uuid : '-') + ':' + (color ?? '') + ':' + (extra ? JSON.stringify(extra) : '');
  if (!mcache.has(k)) mcache.set(k, lambert(Object.assign({ map, color: color ?? 0xffffff }, extra || {})));
  return mcache.get(k);
}
const basic = (color) => matC(null, null, { emissive: color, color: 0x000000 });
function mesh(parent, geo, mat, x, y, z, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  parent.add(m);
  return m;
}
// 박공지붕 (ridge 가 x 축, 길이 L, 폭 S, 높이 h) — 그룹 0: 지붕면, 1: 박공벽
function prismRoof(L, S, h, ridge, tile) {
  if (ridge === 'z') { const g = prismRoof(L, S, h, 'x', tile); g.rotateY(Math.PI / 2); return g; }
  const a = L / 2, b = S / 2, sl = Math.hypot(b, h);
  const pos = [], uv = [];
  const tri = (p, q) => { pos.push(...p); uv.push(...q); };
  // 앞 경사
  [[-a, 0, b], [a, 0, b], [a, h, 0], [-a, 0, b], [a, h, 0], [-a, h, 0]].forEach((p, i) => tri(p, [[0, 0], [L / tile, 0], [L / tile, sl / tile], [0, 0], [L / tile, sl / tile], [0, sl / tile]][i]));
  [[a, 0, -b], [-a, 0, -b], [-a, h, 0], [a, 0, -b], [-a, h, 0], [a, h, 0]].forEach((p, i) => tri(p, [[0, 0], [L / tile, 0], [L / tile, sl / tile], [0, 0], [L / tile, sl / tile], [0, sl / tile]][i]));
  [[a, 0, b], [a, 0, -b], [a, h, 0]].forEach((p, i) => tri(p, [[0, 0], [S / tile, 0], [S / tile / 2, h / tile]][i]));
  [[-a, 0, -b], [-a, 0, b], [-a, h, 0]].forEach((p, i) => tri(p, [[0, 0], [S / tile, 0], [S / tile / 2, h / tile]][i]));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.addGroup(0, 12, 0); g.addGroup(12, 6, 1);
  g.computeVertexNormals();
  return g;
}
const FACE_IDX = { px: 0, nx: 1, pz: 4, nz: 5 };
function faceInfo(b, face) {
  const cx = (b.x1 + b.x2) / 2, cz = (b.z1 + b.z2) / 2;
  switch (face) {
    case 'px': return { x: b.x2, z: cz, len: b.z2 - b.z1, rot: Math.PI / 2 };
    case 'nx': return { x: b.x1, z: cz, len: b.z2 - b.z1, rot: -Math.PI / 2 };
    case 'pz': return { x: cx, z: b.z2, len: b.x2 - b.x1, rot: 0 };
    default: return { x: cx, z: b.z1, len: b.x2 - b.x1, rot: Math.PI };
  }
}
// 면 앞에 붙는 로컬 좌표계 (+z = 바깥)
function faceGroup(parent, b, face) {
  const f = faceInfo(b, face), g = new THREE.Group();
  g.position.set(f.x, 0, f.z); g.rotation.y = f.rot;
  parent.add(g);
  return { g, len: f.len };
}
function aptEndTexture(no, color) {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#' + color.toString(16).padStart(6, '0'); g.fillRect(0, 0, 32, 64);
  g.fillStyle = 'rgba(0,0,0,.08)'; for (let y = 0; y < 64; y += 8) g.fillRect(0, y, 32, 1);
  g.font = '12px Galmuri11, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#3a5a8a'; g.fillText(String(no), 16, 9);
  g.fillText('동', 16, 21);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const SIGN_BG = ['#c82a2a', '#2a5ac8', '#2a8a3a', '#e89a1a', '#6a3ab8', '#1a1a1e', '#d84a8a'];

function buildBuilding(root, b, T) {
  const sx = b.x2 - b.x1, sz = b.z2 - b.z1, cx = (b.x1 + b.x2) / 2, cz = (b.z1 + b.z2) / 2;
  const conc = matC(T.concrete), roof = matC(T.roof);
  switch (b.type) {
    case 'tower': {
      const glass = matC(T.glass, b.color);
      let y = 0;
      for (const tr of b.tiers) {
        const w = sx - tr.inset * 2, d = sz - tr.inset * 2;
        mesh(root, boxUV(w, tr.h, d, 4), [glass, glass, roof, roof, glass, glass], cx, y + tr.h / 2, cz);
        mesh(root, boxUV(w + 0.6, 0.8, d + 0.6, 4), conc, cx, y + tr.h, cz);
        y += tr.h;
      }
      const last = b.tiers[b.tiers.length - 1];
      mesh(root, boxUV((sx - last.inset * 2) * 0.35, 3, (sz - last.inset * 2) * 0.35, 4), conc, cx, y + 1.5, cz);
      if (b.antenna) {
        mesh(root, new THREE.BoxGeometry(0.5, 16, 0.5), matC(null, 0xd0d0d0), cx, y + 11, cz);
        mesh(root, new THREE.BoxGeometry(1, 1, 1), basic(0xff2020), cx, y + 19.5, cz, false);
      }
      break;
    }
    case 'office': {
      const side = matC(T.win[b.kind], b.color);
      mesh(root, boxUV(sx, b.h, sz, 4), [side, side, roof, roof, side, side], cx, b.h / 2, cz);
      mesh(root, boxUV(sx + 0.5, 0.8, sz + 0.5, 4), conc, cx, b.h, cz);
      if (b.h > 14) mesh(root, boxUV(sx * 0.4, 2, sz * 0.4, 4), conc, cx + sx * 0.15, b.h + 1, cz - sz * 0.1);
      break;
    }
    case 'apt': {
      const long = matC(T.apt, b.color), end = matC(aptEndTexture(b.no, b.color));
      const mats = b.axis === 'x' ? [end, end, roof, roof, long, long] : [long, long, roof, roof, end, end];
      const raw = b.axis === 'x' ? [0, 1] : [4, 5];
      mesh(root, boxUV(sx, b.h, sz, 4, raw), mats, cx, b.h / 2, cz);
      mesh(root, boxUV(sx + 0.4, 1, sz + 0.4, 4), conc, cx, b.h + 0.5, cz);
      mesh(root, boxUV(4, 3, 4, 4), matC(T.concrete, 0x9ab0c8), cx + (b.axis === 'x' ? sx * 0.3 : 0), b.h + 2.5, cz + (b.axis === 'z' ? sz * 0.3 : 0));
      mesh(root, boxUV(3, 4, 3, 4), conc, cx - (b.axis === 'x' ? sx * 0.25 : 0), b.h + 3, cz - (b.axis === 'z' ? sz * 0.25 : 0));
      break;
    }
    case 'shop': {
      const brick = matC(T.brick, b.color), front = matC(T.shopfront);
      const g1 = Math.min(3.8, b.h);
      const m1 = [brick, brick, roof, roof, brick, brick];
      m1[FACE_IDX[b.face]] = front;
      mesh(root, boxUV(sx, g1, sz, 4), m1, cx, g1 / 2, cz);
      if (b.h > g1 + 0.5) mesh(root, boxUV(sx, b.h - g1, sz, 4), [brick, brick, roof, roof, brick, brick], cx, g1 + (b.h - g1) / 2, cz);
      mesh(root, boxUV(sx + 0.4, 0.6, sz + 0.4, 4), matC(T.concrete, 0xd8d8d8), cx, b.h + 0.3, cz);
      const { g, len } = faceGroup(root, b, b.face);
      const aw = mesh(g, boxUV(len * 0.85, 0.15, 1.8, 2), matC(T.stripe, b.awning), 0, 3.5, 0.9);
      aw.rotation.x = 0.35;
      const st = signTexture(b.sign, SIGN_BG[(b.sign.length + b.sign.charCodeAt(0)) % SIGN_BG.length]);
      const sw = Math.min(len * 0.75, 1.5 * st.userData.aspect);
      const sign = mesh(g, new THREE.PlaneGeometry(sw, sw / st.userData.aspect), new THREE.MeshBasicMaterial({ map: st }), 0, b.h > 6 ? 5.2 : 4.3, 0.12, false);
      sign.receiveShadow = false;
      break;
    }
    case 'house': {
      const wall = matC(T.plaster, b.color);
      mesh(root, boxUV(sx, b.h, sz, 4), [wall, wall, roof, roof, wall, wall], cx, b.h / 2, cz);
      const L = b.ridge === 'x' ? sx + 1.2 : sz + 1.2, S = b.ridge === 'x' ? sz + 1.2 : sx + 1.2;
      mesh(root, prismRoof(L, S, 3, b.ridge, 4), [matC(T.roofTile, b.roof, { side: THREE.DoubleSide }), matC(T.plaster, b.color, { side: THREE.DoubleSide })], cx, b.h, cz);
      mesh(root, boxUV(0.8, 2.5, 0.8, 4), matC(T.stone), cx + sx * 0.25, b.h + 2.2, cz + sz * 0.2);
      const { g } = faceGroup(root, b, b.face);
      mesh(g, new THREE.BoxGeometry(1.3, 2.3, 0.15), matC(null, 0x6a4a2a), 0, 1.15, 0.05);
      break;
    }
    case 'barn': {
      const wall = matC(T.barn);
      mesh(root, boxUV(sx, b.h, sz, 4), [wall, wall, roof, roof, wall, wall], cx, b.h / 2, cz);
      const L = b.ridge === 'x' ? sx + 1 : sz + 1, S = b.ridge === 'x' ? sz + 1 : sx + 1;
      mesh(root, prismRoof(L, S, 4, b.ridge, 4), [matC(T.roofTile, 0x5a5a60, { side: THREE.DoubleSide }), matC(T.barn, null, { side: THREE.DoubleSide })], cx, b.h, cz);
      const { g } = faceGroup(root, b, b.ridge === 'x' ? 'pz' : 'px');
      mesh(g, new THREE.BoxGeometry(4, 4.4, 0.2), matC(null, 0xf0f0f0), 0, 2.2, 0.05);
      mesh(g, new THREE.BoxGeometry(3.4, 3.8, 0.25), matC(null, 0x7a2018), 0, 2.2, 0.05);
      break;
    }
    case 'silo': {
      const g = new THREE.CylinderGeometry(2.5, 2.5, b.h, 8);
      mesh(root, g, matC(T.grate, 0xd8d8d0), cx, b.h / 2, cz);
      mesh(root, new THREE.ConeGeometry(2.7, 2.2, 8), matC(null, 0x8a8a90, { flatShading: true }), cx, b.h + 1.1, cz);
      break;
    }
    case 'fountain': {
      mesh(root, new THREE.CylinderGeometry(3.5, 3.7, 1, 8), matC(T.stone), cx, 0.5, cz);
      mesh(root, new THREE.CylinderGeometry(3.1, 3.1, 0.1, 8), matC(T.water, null, { emissive: 0x102040 }), cx, 1.0, cz, false);
      mesh(root, new THREE.BoxGeometry(0.8, 2.6, 0.8), matC(T.stone), cx, 1.3, cz);
      mesh(root, new THREE.BoxGeometry(1.6, 0.6, 1.6), matC(null, 0xbfe4ff, { emissive: 0x3a6a9a }), cx, 2.8, cz, false);
      break;
    }
    case 'ntower': {
      const white = matC(T.concrete, 0xf4f4f0);
      mesh(root, boxUV(12, 6, 12, 4), conc, cx, 3, cz);
      mesh(root, boxUV(3.2, 62, 3.2, 4), white, cx, 6 + 31, cz);
      mesh(root, new THREE.CylinderGeometry(7, 5, 6, 8), matC(T.glass, 0x8ab8e0), cx, 71, cz);
      mesh(root, new THREE.CylinderGeometry(7.6, 7.6, 1.4, 8), white, cx, 74.7, cz);
      mesh(root, new THREE.CylinderGeometry(4, 5, 3, 8), matC(T.glass, 0xa0c0d8), cx, 76.9, cz);
      mesh(root, boxUV(1.6, 14, 1.6, 4), white, cx, 85.4, cz);
      for (let k = 0; k < 5; k++) mesh(root, new THREE.BoxGeometry(0.7, 4, 0.7), matC(null, k % 2 ? 0xffffff : 0xd83a3a), cx, 94.4 + k * 4, cz);
      mesh(root, new THREE.BoxGeometry(1.2, 1.2, 1.2), basic(0xff3030), cx, 114.8, cz, false);
      break;
    }
    case 'pillar':
      mesh(root, boxUV(sx, b.h, sz, 4), matC(null, 0xe8e8e8), cx, b.h / 2, cz);
      break;
    case 'pump':
      mesh(root, new THREE.BoxGeometry(sx, b.h, sz), matC(null, 0xd83a3a), cx, b.h / 2, cz);
      mesh(root, new THREE.BoxGeometry(sx + 0.1, 0.4, sz * 0.6), matC(null, 0xf0f0f0), cx, b.h - 0.35, cz);
      break;
  }
}
function buildCanopy(root, c, T) {
  const w = c.x2 - c.x1, d = c.z2 - c.z1, cx = (c.x1 + c.x2) / 2, cz = (c.z1 + c.z2) / 2;
  const side = matC(T.stripe, 0xd83a3a), top = matC(null, 0xf4f4f4);
  mesh(root, boxUV(w, 1, d, 2), [side, side, top, top, side, side], cx, c.h + 0.5, cz);
  for (const z of [cz - d / 4, cz + d / 4]) mesh(root, new THREE.BoxGeometry(w * 0.6, 0.1, 1), basic(0xfff4c0), cx, c.h - 0.05, z, false);
}
function buildLamps(root) {
  const n = W.lamps.length;
  const pole = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 6.5, 0.3), matC(null, 0x5a5e66), n);
  const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.2, 1.8), matC(null, 0x5a5e66), n);
  const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.25, 0.9), basic(0xfff0b0), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  W.lamps.forEach((l, i) => {
    q.setFromAxisAngle(up, l.rot);
    const fx = Math.sin(l.rot), fz = Math.cos(l.rot);
    p.set(l.x, 3.25, l.z); m.compose(p, q, s); pole.setMatrixAt(i, m);
    p.set(l.x + fx * 0.9, 6.4, l.z + fz * 0.9); m.compose(p, q, s); arm.setMatrixAt(i, m);
    p.set(l.x + fx * 1.7, 6.2, l.z + fz * 1.7); m.compose(p, q, s); head.setMatrixAt(i, m);
  });
  pole.castShadow = true;
  root.add(pole, arm, head);
}

export function startLine(t, T) {
  const p = t.path[0], tg = t.tan[0];
  const g = new THREE.PlaneGeometry(t.w, 3);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * t.w / 4, uv.getY(i) * 0.75);
  const m = new THREE.Mesh(g, lambert({ map: T.checker }));
  m.position.set(p[0], 0.11, p[1]);
  m.rotation.y = Math.atan2(tg[0], tg[1]);
  m.receiveShadow = true;
  return m;
}

export function gantry(t, T) {
  const grp = new THREE.Group();
  const p = t.path[0], tg = t.tan[0];
  grp.position.set(p[0], 0, p[1]);
  grp.rotation.y = Math.atan2(tg[0], tg[1]);
  const post = lambert({ map: T.concrete });
  const half = t.w / 2 + 2.5;
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(boxUV(1.4, 10, 1.4, 4), post);
    m.position.set(s * half, 5, 0); m.castShadow = true; grp.add(m);
  }
  const beam = new THREE.Mesh(boxUV(half * 2 + 1.4, 2.4, 1, 4), [post, post, post, post, lambert({ map: T.checker }), lambert({ map: T.checker })]);
  beam.position.set(0, 10, 0); beam.castShadow = true; grp.add(beam);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.8), new THREE.MeshBasicMaterial({ map: signTex('START / FINISH'), side: THREE.DoubleSide }));
  sign.position.set(0, 10, -0.52); sign.rotation.y = Math.PI; grp.add(sign);
  return grp;
}
function signTex(text) {
  const c = textCanvas(text, '#ffd84a', '#1e1e22');
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------- 체크포인트 게이트 ---------- */
export function makeGate() {
  const grp = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x40e0ff, transparent: true, opacity: 0.8 });
  const bar = new THREE.MeshBasicMaterial({ color: 0x40e0ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  const l = new THREE.Mesh(new THREE.BoxGeometry(0.8, 7, 0.8), mat);
  const r = l.clone();
  const top = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 0.8), mat);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 6.2), bar);
  grp.add(l, r, top, wall);
  grp.userData = { l, r, top, wall, mat, bar };
  grp.setWidth = (w) => {
    l.position.set(-w / 2, 3.5, 0); r.position.set(w / 2, 3.5, 0);
    top.scale.x = w + 0.8; top.position.set(0, 7, 0);
    wall.scale.x = w; wall.position.set(0, 3.5, 0);
  };
  grp.setColor = (hex) => { mat.color.setHex(hex); bar.color.setHex(hex); };
  return grp;
}

/* ---------- 코인 ---------- */
export function makeCoinAssets(T) {
  const g = new THREE.CylinderGeometry(1, 1, 0.3, 10);
  g.rotateX(Math.PI / 2);
  const gem = new THREE.OctahedronGeometry(1.4, 0);
  return {
    small: { geo: g, mat: lambert({ map: T.coin, emissive: 0x4a3000 }) },
    big: { geo: gem, mat: lambert({ map: T.gem, emissive: 0x0a4a30, flatShading: true }) },
  };
}

/* ---------- 자동차 ---------- */
// 박스: [x, y, z, sx, sy, sz, mat]
const MODELS = {
  hatch: { // 대우 티코
    boxes: [
      [0, 0.68, 0, 1.6, 0.56, 3.4, 'b'], [0, 1.26, -0.2, 1.5, 0.62, 2.0, 'b'],
      [0, 1.26, 0.81, 1.38, 0.5, 0.05, 'g'], [0, 1.28, -1.21, 1.3, 0.44, 0.05, 'g'],
      [0.76, 1.28, -0.2, 0.04, 0.44, 1.7, 'g'], [-0.76, 1.28, -0.2, 0.04, 0.44, 1.7, 'g'],
      [0, 0.46, 1.73, 1.64, 0.22, 0.12, 'k'], [0, 0.46, -1.73, 1.64, 0.22, 0.12, 'k'],
      [0.52, 0.76, 1.71, 0.32, 0.24, 0.05, 'l'], [-0.52, 0.76, 1.71, 0.32, 0.24, 0.05, 'l'], [0, 0.76, 1.71, 0.6, 0.14, 0.05, 'k'],
      [0.6, 0.8, -1.71, 0.28, 0.24, 0.05, 't'], [-0.6, 0.8, -1.71, 0.28, 0.24, 0.05, 't'],
    ],
    wheels: [[0.78, 1.05], [0.78, -1.05]], wr: 0.36, ww: 0.3,
  },
  damas: { // 대우 다마스
    boxes: [
      [0, 1.12, -0.05, 1.5, 1.44, 3.4, 'b'], [0, 0.72, 1.62, 1.5, 0.6, 0.3, 'b'],
      [0, 1.5, 1.66, 1.36, 0.62, 0.05, 'g'], [0.76, 1.52, 0.2, 0.04, 0.5, 2.3, 'g'], [-0.76, 1.52, 0.2, 0.04, 0.5, 2.3, 'g'],
      [0, 1.5, -1.76, 1.2, 0.5, 0.05, 'g'], [0.76, 0.9, -0.05, 0.04, 0.12, 3.3, 'w'], [-0.76, 0.9, -0.05, 0.04, 0.12, 3.3, 'w'],
      [0.5, 0.82, 1.78, 0.3, 0.22, 0.05, 'l'], [-0.5, 0.82, 1.78, 0.3, 0.22, 0.05, 'l'],
      [0, 0.46, 1.8, 1.52, 0.2, 0.12, 'k'], [0, 0.46, -1.78, 1.52, 0.2, 0.12, 'k'],
      [0.62, 0.9, -1.76, 0.2, 0.36, 0.05, 't'], [-0.62, 0.9, -1.76, 0.2, 0.36, 0.05, 't'],
    ],
    wheels: [[0.72, 1.15], [0.72, -1.15]], wr: 0.36, ww: 0.3,
  },
  porter: { // 현대 포터 (캡오버)
    boxes: [
      [0, 1.3, 1.5, 1.8, 1.5, 1.4, 'b'], [0, 1.62, 2.21, 1.66, 0.7, 0.05, 'g'],
      [0.91, 1.62, 1.55, 0.04, 0.6, 1.0, 'g'], [-0.91, 1.62, 1.55, 0.04, 0.6, 1.0, 'g'],
      [0, 0.62, -0.3, 1.1, 0.3, 4.6, 'k'], [0, 0.88, -0.9, 1.9, 0.18, 3.2, 's'],
      [0.93, 1.22, -0.9, 0.08, 0.5, 3.2, 's'], [-0.93, 1.22, -0.9, 0.08, 0.5, 3.2, 's'], [0, 1.22, -2.48, 1.9, 0.5, 0.08, 's'], [0, 1.22, 0.68, 1.9, 0.5, 0.08, 's'],
      [0.62, 0.86, 2.21, 0.36, 0.2, 0.05, 'l'], [-0.62, 0.86, 2.21, 0.36, 0.2, 0.05, 'l'], [0, 0.95, 2.21, 0.8, 0.24, 0.05, 'k'],
      [0, 0.56, 2.24, 1.84, 0.24, 0.12, 'k'],
      [0.7, 0.85, -2.53, 0.3, 0.2, 0.05, 't'], [-0.7, 0.85, -2.53, 0.3, 0.2, 0.05, 't'],
    ],
    wheels: [[0.82, 1.45], [0.85, -1.6]], wr: 0.4, ww: 0.36,
  },
  beetle: { // 폭스바겐 비틀
    boxes: [
      [0, 0.66, 0, 1.64, 0.46, 3.9, 'b'], [0.8, 0.74, 1.15, 0.4, 0.56, 1.1, 'b'], [-0.8, 0.74, 1.15, 0.4, 0.56, 1.1, 'b'],
      [0.8, 0.74, -1.2, 0.4, 0.56, 1.1, 'b'], [-0.8, 0.74, -1.2, 0.4, 0.56, 1.1, 'b'],
      [0, 0.98, 1.15, 1.3, 0.3, 1.3, 'b'], [0, 0.92, 1.85, 1.0, 0.2, 0.3, 'b'],
      [0, 1.28, -0.2, 1.56, 0.62, 1.8, 'b'], [0, 1.64, -0.3, 1.24, 0.14, 1.3, 'b'], [0, 1.06, -1.35, 1.36, 0.5, 0.9, 'b'], [0, 0.86, -1.85, 1.1, 0.3, 0.3, 'b'],
      [0, 1.32, 0.71, 1.36, 0.44, 0.05, 'g'], [0.79, 1.34, -0.2, 0.04, 0.4, 1.4, 'g'], [-0.79, 1.34, -0.2, 0.04, 0.4, 1.4, 'g'], [0, 1.32, -1.12, 1.1, 0.34, 0.05, 'g'],
      [0.8, 1.0, 1.71, 0.3, 0.3, 0.05, 'l'], [-0.8, 1.0, 1.71, 0.3, 0.3, 0.05, 'l'],
      [0, 0.5, 2.02, 1.8, 0.12, 0.1, 's'], [0, 0.5, -2.02, 1.8, 0.12, 0.1, 's'],
      [0.8, 0.95, -1.76, 0.2, 0.3, 0.05, 't'], [-0.8, 0.95, -1.76, 0.2, 0.3, 0.05, 't'],
    ],
    wheels: [[0.82, 1.2], [0.82, -1.2]], wr: 0.4, ww: 0.32,
  },
  avante: { // 현대 아반떼 (세단)
    boxes: [
      [0, 0.72, 0, 1.9, 0.58, 4.6, 'b'], [0, 1.26, -0.2, 1.72, 0.5, 2.3, 'b'],
      [0, 1.22, 1.02, 1.6, 0.4, 0.14, 'g'], [0, 1.22, -1.4, 1.6, 0.38, 0.14, 'g'],
      [0.87, 1.28, -0.2, 0.04, 0.36, 2.0, 'g'], [-0.87, 1.28, -0.2, 0.04, 0.36, 2.0, 'g'],
      [0.62, 0.86, 2.31, 0.52, 0.12, 0.05, 'l'], [-0.62, 0.86, 2.31, 0.52, 0.12, 0.05, 'l'], [0, 0.72, 2.31, 0.76, 0.24, 0.05, 'k'],
      [0, 0.46, 2.33, 1.92, 0.18, 0.1, 'k'], [0, 0.48, -2.33, 1.92, 0.2, 0.1, 'k'],
      [0, 0.9, -2.31, 1.7, 0.1, 0.05, 't'],
    ],
    wheels: [[0.9, 1.45], [0.9, -1.4]], wr: 0.42, ww: 0.36,
  },
  truck: { // 포드 F-150
    boxes: [
      [0, 0.95, 0.2, 2.2, 0.8, 4.8, 'b'], [0, 1.75, 0.75, 2.1, 0.85, 1.9, 'b'],
      [0, 1.8, 1.72, 1.9, 0.6, 0.06, 'g'], [1.06, 1.82, 0.75, 0.04, 0.55, 1.6, 'g'], [-1.06, 1.82, 0.75, 0.04, 0.55, 1.6, 'g'],
      [0, 1.8, -0.22, 1.9, 0.5, 0.06, 'g'],
      [1.05, 1.5, -1.25, 0.12, 0.35, 1.9, 'd'], [-1.05, 1.5, -1.25, 0.12, 0.35, 1.9, 'd'], [0, 1.5, -2.15, 2.2, 0.35, 0.12, 'd'],
      [0, 0.62, 2.62, 2.25, 0.35, 0.2, 's'], [0, 0.62, -2.22, 2.25, 0.3, 0.16, 'k'], [0, 1.08, 2.61, 1.0, 0.4, 0.06, 's'],
      [0.75, 1.1, 2.61, 0.4, 0.25, 0.06, 'l'], [-0.75, 1.1, 2.61, 0.4, 0.25, 0.06, 'l'],
      [0.85, 1.1, -2.21, 0.3, 0.3, 0.06, 't'], [-0.85, 1.1, -2.21, 0.3, 0.3, 0.06, 't'],
    ],
    wheels: [[1.05, 1.6], [1.05, -1.4]], wr: 0.6, ww: 0.5,
  },
  mini: { // 미니 쿠퍼
    boxes: [
      [0, 0.72, 0, 1.8, 0.6, 3.8, 'b'], [0, 1.3, -0.25, 1.7, 0.58, 2.3, 'g'], [0, 1.64, -0.25, 1.78, 0.1, 2.4, 'w'],
      [0.84, 1.3, 0.85, 0.06, 0.58, 0.1, 'k'], [-0.84, 1.3, 0.85, 0.06, 0.58, 0.1, 'k'], [0.84, 1.3, -1.36, 0.06, 0.58, 0.1, 'k'], [-0.84, 1.3, -1.36, 0.06, 0.58, 0.1, 'k'],
      [0.24, 1.03, 1.1, 0.16, 0.02, 1.5, 'w'], [-0.24, 1.03, 1.1, 0.16, 0.02, 1.5, 'w'],
      [0.6, 0.9, 1.91, 0.3, 0.3, 0.05, 'l'], [-0.6, 0.9, 1.91, 0.3, 0.3, 0.05, 'l'], [0, 0.78, 1.91, 0.56, 0.2, 0.05, 's'],
      [0, 0.46, 1.94, 1.84, 0.18, 0.1, 's'], [0, 0.46, -1.94, 1.84, 0.18, 0.1, 's'],
      [0.72, 0.9, -1.91, 0.18, 0.3, 0.05, 't'], [-0.72, 0.9, -1.91, 0.18, 0.3, 0.05, 't'],
    ],
    wheels: [[0.88, 1.25], [0.88, -1.25]], wr: 0.4, ww: 0.34,
  },
  coupe: { // 토요타 AE86
    boxes: [
      [0, 0.7, 0, 1.8, 0.5, 4.2, 'b'], [0, 0.5, 0, 1.82, 0.16, 4.22, 'k'],
      [0, 1.18, -0.4, 1.66, 0.46, 2.0, 'b'], [0, 1.15, 0.62, 1.56, 0.38, 0.14, 'g'], [0, 1.1, -1.5, 1.5, 0.34, 0.3, 'g'],
      [0.84, 1.2, -0.4, 0.04, 0.34, 1.7, 'g'], [-0.84, 1.2, -0.4, 0.04, 0.34, 1.7, 'g'],
      [0.6, 0.96, 1.85, 0.5, 0.05, 0.4, 'k'], [-0.6, 0.96, 1.85, 0.5, 0.05, 0.4, 'k'],
      [0.6, 0.78, 2.11, 0.45, 0.1, 0.05, 'l'], [-0.6, 0.78, 2.11, 0.45, 0.1, 0.05, 'l'],
      [0, 0.84, -2.11, 1.6, 0.14, 0.05, 't'],
    ],
    wheels: [[0.86, 1.3], [0.86, -1.3]], wr: 0.4, ww: 0.34,
  },
  buggy: { // 지프 랭글러
    boxes: [
      [0, 1.05, 0.1, 1.9, 0.7, 3.9, 'b'], [0, 1.75, 0.66, 1.8, 0.7, 0.08, 'g'],
      [0.9, 1.75, 0.66, 0.1, 0.7, 0.1, 'b'], [-0.9, 1.75, 0.66, 0.1, 0.7, 0.1, 'b'], [0.9, 1.75, -1.65, 0.1, 0.7, 0.1, 'k'], [-0.9, 1.75, -1.65, 0.1, 0.7, 0.1, 'k'],
      [0, 2.16, -0.5, 1.9, 0.12, 2.4, 'k'], [0.95, 1.8, -0.5, 0.04, 0.5, 2.0, 'g'], [-0.95, 1.8, -0.5, 0.04, 0.5, 2.0, 'g'],
      [0, 1.06, 2.07, 1.1, 0.46, 0.05, 'k'], [0.6, 1.12, 2.08, 0.32, 0.32, 0.05, 'l'], [-0.6, 1.12, 2.08, 0.32, 0.32, 0.05, 'l'],
      [0.98, 0.98, 1.35, 0.2, 0.18, 1.3, 'k'], [-0.98, 0.98, 1.35, 0.2, 0.18, 1.3, 'k'], [0.98, 0.98, -1.2, 0.2, 0.18, 1.3, 'k'], [-0.98, 0.98, -1.2, 0.2, 0.18, 1.3, 'k'],
      [0, 1.3, -2.02, 0.8, 0.8, 0.25, 'k'], [0, 1.3, -2.16, 0.3, 0.3, 0.05, 's'],
      [0, 0.72, 2.12, 2.0, 0.25, 0.25, 'k'], [0, 0.72, -1.9, 2.0, 0.25, 0.2, 'k'],
      [0.8, 1.05, -1.86, 0.18, 0.3, 0.05, 't'], [-0.8, 1.05, -1.86, 0.18, 0.3, 0.05, 't'],
    ],
    wheels: [[1.0, 1.35], [1.0, -1.25]], wr: 0.56, ww: 0.5,
  },
  bus: { // 시내버스
    boxes: [
      [0, 1.9, 0, 2.5, 2.6, 11, 'b'], [1.26, 2.35, -0.6, 0.04, 1.0, 9.0, 'g'], [-1.26, 2.35, -0.3, 0.04, 1.0, 7.6, 'g'],
      [0, 2.2, 5.51, 2.3, 1.6, 0.05, 'g'], [0, 2.6, -5.51, 2.0, 0.8, 0.05, 'g'],
      [-1.27, 1.7, 4.4, 0.05, 2.0, 1.1, 'g'], [-1.27, 1.7, 0.2, 0.05, 2.0, 1.1, 'g'],
      [1.26, 1.3, 0, 0.04, 0.22, 11, 'w'], [-1.26, 1.3, 0, 0.04, 0.22, 11, 'w'],
      [0, 3.35, 0, 1.6, 0.3, 3, 's'], [0, 3.02, 5.52, 1.6, 0.3, 0.05, 'o'],
      [0.9, 1.0, 5.51, 0.4, 0.22, 0.05, 'l'], [-0.9, 1.0, 5.51, 0.4, 0.22, 0.05, 'l'],
      [0, 0.66, 5.55, 2.5, 0.3, 0.12, 'k'], [0, 0.66, -5.55, 2.5, 0.3, 0.12, 'k'],
      [0.95, 1.1, -5.52, 0.3, 0.4, 0.05, 't'], [-0.95, 1.1, -5.52, 0.3, 0.4, 0.05, 't'],
    ],
    wheels: [[1.12, 3.6], [1.12, -3.2]], wr: 0.56, ww: 0.4,
  },
  tesla: { // 테슬라 모델 3
    boxes: [
      [0, 0.7, 0, 1.9, 0.54, 4.6, 'b'], [0, 1.18, -0.3, 1.7, 0.46, 2.6, 'g'], [0, 0.99, 1.45, 1.8, 0.1, 1.5, 'b'],
      [0, 1.02, -1.95, 1.72, 0.1, 0.6, 'b'], [0.86, 1.18, 0.95, 0.06, 0.46, 0.1, 'b'], [-0.86, 1.18, 0.95, 0.06, 0.46, 0.1, 'b'],
      [0.62, 0.86, 2.31, 0.46, 0.08, 0.05, 'l'], [-0.62, 0.86, 2.31, 0.46, 0.08, 0.05, 'l'],
      [0, 0.46, 2.33, 1.92, 0.16, 0.1, 'd'], [0, 0.48, -2.33, 1.92, 0.18, 0.1, 'd'],
      [0.65, 0.9, -2.31, 0.5, 0.1, 0.05, 't'], [-0.65, 0.9, -2.31, 0.5, 0.1, 0.05, 't'],
    ],
    wheels: [[0.9, 1.45], [0.9, -1.45]], wr: 0.44, ww: 0.36,
  },
  muscle: { // 포드 머스탱
    boxes: [
      [0, 0.72, 0, 2.15, 0.64, 4.7, 'b'], [0, 1.28, -0.5, 1.85, 0.5, 1.9, 'b'],
      [0, 1.25, 0.47, 1.75, 0.4, 0.2, 'g'], [0, 1.25, -1.47, 1.6, 0.38, 0.06, 'g'],
      [0.94, 1.3, -0.5, 0.04, 0.36, 1.6, 'g'], [-0.94, 1.3, -0.5, 0.04, 0.36, 1.6, 'g'],
      [0, 1.1, 1.3, 0.8, 0.18, 1.2, 'k'],
      [0.3, 1.05, 0.5, 0.3, 0.03, 4.0, 'w'], [-0.3, 1.05, 0.5, 0.3, 0.03, 4.0, 'w'],
      [0, 0.5, 2.37, 2.2, 0.3, 0.1, 's'], [0, 0.5, -2.37, 2.2, 0.3, 0.1, 's'], [0, 0.78, 2.36, 1.0, 0.26, 0.05, 'k'],
      [0.75, 0.8, 2.36, 0.32, 0.26, 0.05, 'l'], [-0.75, 0.8, 2.36, 0.32, 0.26, 0.05, 'l'],
      [0.6, 0.85, -2.36, 0.62, 0.16, 0.05, 't'], [-0.6, 0.85, -2.36, 0.62, 0.16, 0.05, 't'],
      [0, 1.15, -2.2, 1.9, 0.08, 0.35, 'd'],
    ],
    wheels: [[1.02, 1.5], [1.06, -1.45]], wr: 0.48, ww: 0.5,
  },
  gwagon: { // 벤츠 G클래스
    boxes: [
      [0, 1.15, 0, 2.0, 0.9, 4.6, 'b'], [0, 2.02, -0.4, 1.9, 0.86, 3.2, 'b'],
      [0, 2.02, 1.21, 1.7, 0.66, 0.05, 'g'], [0.96, 2.08, -0.4, 0.04, 0.56, 2.8, 'g'], [-0.96, 2.08, -0.4, 0.04, 0.56, 2.8, 'g'], [0, 2.08, -2.01, 1.5, 0.56, 0.05, 'g'],
      [0, 1.5, -2.44, 0.9, 0.9, 0.25, 'k'], [0, 1.5, -2.58, 0.3, 0.3, 0.05, 's'],
      [0.66, 1.34, 2.31, 0.34, 0.34, 0.05, 'l'], [-0.66, 1.34, 2.31, 0.34, 0.34, 0.05, 'l'], [0, 1.28, 2.31, 0.8, 0.42, 0.05, 'k'],
      [0.9, 1.63, 2.0, 0.2, 0.12, 0.22, 'o'], [-0.9, 1.63, 2.0, 0.2, 0.12, 0.22, 'o'],
      [1.01, 1.0, 0, 0.04, 0.12, 4.4, 's'], [-1.01, 1.0, 0, 0.04, 0.12, 4.4, 's'],
      [0, 0.72, 2.36, 2.0, 0.3, 0.14, 'k'], [0, 0.72, -2.34, 2.0, 0.3, 0.12, 'k'],
      [0.85, 1.25, -2.31, 0.2, 0.4, 0.05, 't'], [-0.85, 1.25, -2.31, 0.2, 0.4, 0.05, 't'],
    ],
    wheels: [[1.0, 1.5], [1.0, -1.5]], wr: 0.56, ww: 0.44,
  },
  porsche: { // 포르쉐 911
    boxes: [
      [0, 0.64, 0, 1.9, 0.48, 4.4, 'b'], [0, 1.1, -0.35, 1.6, 0.44, 1.9, 'b'], [0, 0.98, -1.55, 1.7, 0.3, 1.2, 'b'],
      [0, 0.9, 1.4, 1.2, 0.1, 1.4, 'b'], [0.68, 0.94, 1.6, 0.4, 0.24, 1.2, 'b'], [-0.68, 0.94, 1.6, 0.4, 0.24, 1.2, 'b'],
      [0, 1.06, 0.64, 1.5, 0.36, 0.14, 'g'], [0.81, 1.12, -0.35, 0.04, 0.3, 1.6, 'g'], [-0.81, 1.12, -0.35, 0.04, 0.3, 1.6, 'g'],
      [0.68, 0.96, 2.21, 0.34, 0.24, 0.05, 'l'], [-0.68, 0.96, 2.21, 0.34, 0.24, 0.05, 'l'],
      [0, 1.18, -2.08, 1.5, 0.06, 0.3, 'k'], [0, 0.82, -2.21, 1.8, 0.1, 0.05, 't'],
      [0, 0.42, 2.23, 1.9, 0.16, 0.1, 'k'], [0, 0.44, -2.23, 1.9, 0.16, 0.1, 'k'],
    ],
    wheels: [[0.92, 1.35], [0.95, -1.3]], wr: 0.44, ww: 0.42,
  },
  gtr: { // 닛산 GT-R
    boxes: [
      [0, 0.68, 0, 2.0, 0.56, 4.6, 'b'], [0, 1.2, -0.35, 1.74, 0.46, 2.1, 'b'],
      [0, 1.16, 0.76, 1.62, 0.38, 0.2, 'g'], [0, 1.16, -1.46, 1.56, 0.36, 0.2, 'g'],
      [0.88, 1.22, -0.35, 0.04, 0.32, 1.8, 'g'], [-0.88, 1.22, -0.35, 0.04, 0.32, 1.8, 'g'],
      [0, 1.32, -2.1, 1.8, 0.08, 0.4, 'b'], [0.6, 1.1, -2.1, 0.08, 0.4, 0.15, 'k'], [-0.6, 1.1, -2.1, 0.08, 0.4, 0.15, 'k'],
      [0.45, 0.85, -2.31, 0.26, 0.26, 0.05, 't'], [-0.45, 0.85, -2.31, 0.26, 0.26, 0.05, 't'], [0.8, 0.85, -2.31, 0.26, 0.26, 0.05, 't'], [-0.8, 0.85, -2.31, 0.26, 0.26, 0.05, 't'],
      [0.7, 0.86, 2.31, 0.46, 0.14, 0.05, 'l'], [-0.7, 0.86, 2.31, 0.46, 0.14, 0.05, 'l'], [0, 0.62, 2.31, 1.0, 0.3, 0.05, 'k'],
      [0.3, 0.97, 1.4, 0.2, 0.02, 0.6, 'k'], [-0.3, 0.97, 1.4, 0.2, 0.02, 0.6, 'k'],
      [0, 0.42, 2.33, 2.02, 0.16, 0.1, 'k'],
    ],
    wheels: [[0.95, 1.45], [0.98, -1.4]], wr: 0.46, ww: 0.44,
  },
  super: { // 람보르기니 우라칸
    boxes: [
      [0, 0.58, 0, 2.2, 0.45, 4.5, 'b'], [0, 0.95, -0.3, 1.9, 0.35, 1.8, 'b'],
      [0, 0.92, 0.72, 1.7, 0.3, 0.6, 'g'], [0.96, 0.98, -0.3, 0.04, 0.26, 1.5, 'g'], [-0.96, 0.98, -0.3, 0.04, 0.26, 1.5, 'g'],
      [0, 0.85, -1.55, 1.8, 0.2, 0.8, 'd'],
      [0, 1.35, -2.05, 2.1, 0.08, 0.5, 'k'], [0.8, 1.05, -2.05, 0.1, 0.55, 0.2, 'k'], [-0.8, 1.05, -2.05, 0.1, 0.55, 0.2, 'k'],
      [0, 0.35, 2.28, 2.2, 0.14, 0.14, 'k'],
      [0.7, 0.66, 2.26, 0.5, 0.1, 0.05, 'l'], [-0.7, 0.66, 2.26, 0.5, 0.1, 0.05, 'l'],
      [0, 0.7, -2.26, 1.8, 0.1, 0.05, 't'],
      [1.11, 0.62, 0.2, 0.04, 0.2, 1.2, 'k'], [-1.11, 0.62, 0.2, 0.04, 0.2, 1.2, 'k'],
    ],
    wheels: [[1.02, 1.45], [1.05, -1.4]], wr: 0.44, ww: 0.48,
  },
  f40: { // 페라리 F40
    boxes: [
      [0, 0.58, 0, 2.0, 0.44, 4.4, 'b'], [0, 0.98, -0.1, 1.5, 0.36, 1.5, 'b'], [0, 0.95, 0.72, 1.4, 0.3, 0.2, 'g'],
      [0.76, 1.0, -0.1, 0.04, 0.26, 1.2, 'g'], [-0.76, 1.0, -0.1, 0.04, 0.26, 1.2, 'g'],
      [0, 0.86, -1.35, 1.8, 0.14, 1.3, 'd'], [0, 0.94, -1.35, 1.2, 0.02, 1.1, 'k'],
      [0, 1.32, -2.08, 2.1, 0.1, 0.5, 'b'], [1.0, 1.08, -2.08, 0.08, 0.5, 0.5, 'b'], [-1.0, 1.08, -2.08, 0.08, 0.5, 0.5, 'b'],
      [0.3, 0.81, 1.3, 0.2, 0.02, 0.5, 'k'], [-0.3, 0.81, 1.3, 0.2, 0.02, 0.5, 'k'],
      [0.62, 0.7, 2.21, 0.46, 0.12, 0.05, 'l'], [-0.62, 0.7, 2.21, 0.46, 0.12, 0.05, 'l'], [0, 0.5, 2.21, 0.9, 0.16, 0.05, 'k'],
      [0.4, 0.72, -2.21, 0.22, 0.22, 0.05, 't'], [-0.4, 0.72, -2.21, 0.22, 0.22, 0.05, 't'], [0.75, 0.72, -2.21, 0.22, 0.22, 0.05, 't'], [-0.75, 0.72, -2.21, 0.22, 0.22, 0.05, 't'],
    ],
    wheels: [[0.95, 1.35], [1.0, -1.35]], wr: 0.45, ww: 0.46,
  },
  formula: { // F1
    boxes: [
      [0, 0.55, 0.2, 0.9, 0.45, 4.6, 'b'], [0, 0.45, 2.6, 0.5, 0.25, 0.8, 'b'],
      [0, 0.25, 2.95, 2.2, 0.08, 0.5, 'd'], [0, 0.9, -0.3, 0.7, 0.3, 0.9, 'k'],
      [0, 1.05, 0.2, 0.36, 0.34, 0.36, 'w'], [0, 1.1, -0.85, 0.5, 0.55, 0.7, 'b'],
      [0, 1.45, -2.05, 1.9, 0.1, 0.55, 'd'], [0.75, 1.1, -2.05, 0.08, 0.7, 0.5, 'b'], [-0.75, 1.1, -2.05, 0.08, 0.7, 0.5, 'b'],
      [0.8, 0.55, -0.6, 0.7, 0.35, 1.6, 'b'], [-0.8, 0.55, -0.6, 0.7, 0.35, 1.6, 'b'],
      [0, 0.52, -2.3, 0.3, 0.14, 0.05, 't'], [0, 0.72, 0.5, 0.92, 0.04, 1.4, 'y'],
    ],
    wheels: [[1.05, 1.7], [1.05, -1.45]], wr: 0.5, ww: 0.55,
  },
  chiron: { // 부가티 시론
    boxes: [
      [0, 0.65, 0, 2.1, 0.54, 4.6, 'b'], [0, 1.08, -0.3, 1.7, 0.4, 1.9, 'd'], [0, 1.02, 0.72, 1.6, 0.3, 0.3, 'g'],
      [0.86, 1.1, -0.3, 0.04, 0.3, 1.6, 'g'], [-0.86, 1.1, -0.3, 0.04, 0.3, 1.6, 'g'],
      [1.06, 0.82, 0.1, 0.04, 0.56, 0.16, 's'], [-1.06, 0.82, 0.1, 0.04, 0.56, 0.16, 's'],
      [0, 0.94, -1.6, 1.9, 0.12, 1.2, 'd'], [0, 1.02, -2.2, 1.8, 0.06, 0.25, 'd'],
      [0, 0.72, 2.31, 0.5, 0.42, 0.05, 's'], [0.72, 0.84, 2.31, 0.42, 0.12, 0.05, 'l'], [-0.72, 0.84, 2.31, 0.42, 0.12, 0.05, 'l'],
      [0, 0.9, -2.31, 1.9, 0.08, 0.05, 't'], [0, 0.42, 2.33, 2.1, 0.16, 0.1, 'k'],
    ],
    wheels: [[0.98, 1.45], [1.0, -1.45]], wr: 0.46, ww: 0.46,
  },
};

const matCache = new Map();
function mat(key, color) {
  const k = key + ':' + (key === 'b' || key === 'd' ? color : '');
  if (matCache.has(k)) return matCache.get(k);
  let m;
  const c = new THREE.Color(color);
  switch (key) {
    case 'b': m = lambert({ color: c }); break;
    case 'd': m = lambert({ color: c.clone().multiplyScalar(0.55) }); break;
    case 'g': m = lambert({ color: 0x2c3e58, emissive: 0x0a1424 }); break;
    case 'k': m = lambert({ color: 0x1e1e22 }); break;
    case 'w': m = lambert({ color: 0xf0f0f0 }); break;
    case 's': m = lambert({ color: 0xb8bcc4 }); break;
    case 'y': m = lambert({ color: 0x1e1e22 }); break;
    case 'l': m = new THREE.MeshBasicMaterial({ color: 0xfff4c0 }); break;
    case 't': m = new THREE.MeshBasicMaterial({ color: 0xb01818 }); break;
    case 'o': m = new THREE.MeshBasicMaterial({ color: 0xf09020 }); break;
  }
  matCache.set(k, m);
  return m;
}
const wheelGeoCache = new Map();
function wheelGeo(r, w) {
  const k = r + ':' + w;
  if (!wheelGeoCache.has(k)) {
    const g = new THREE.CylinderGeometry(r, r, w, 8);
    g.rotateZ(Math.PI / 2);
    wheelGeoCache.set(k, g);
  }
  return wheelGeoCache.get(k);
}
const rimGeo = new THREE.BoxGeometry(0.06, 0.4, 0.4);

// 충돌/카메라용 차 크기 (박스 경계에서 계산)
const shapeCache = {};
export function carShape(id) {
  if (shapeCache[id]) return shapeCache[id];
  const def = MODELS[id] || MODELS.hatch;
  let x1 = 0, x2 = 0, z1 = 0, z2 = 0, top = 0;
  for (const [x, y, z, sx, sy, sz] of def.boxes) {
    x1 = Math.min(x1, x - sx / 2); x2 = Math.max(x2, x + sx / 2);
    z1 = Math.min(z1, z - sz / 2); z2 = Math.max(z2, z + sz / 2); top = Math.max(top, y + sy / 2);
  }
  const len = z2 - z1, wid = x2 - x1, r = wid / 2 * 0.95;
  const n = Math.max(2, Math.round(len / (r * 2.2)));
  const offs = [];
  for (let i = 0; i < n; i++) offs.push((z1 + z2) / 2 + (-(len / 2 - r) + i * (len - 2 * r) / (n - 1)));
  return (shapeCache[id] = { len, wid, r, offs, top, cz: (z1 + z2) / 2, hw: wid / 2, hl: len / 2 });
}

// 반환: { root, body, wheels:[{m, front}], tail } root.position=바닥 중심, body 는 기울기용
export function makeCar(id, colorIdx) {
  const def = MODELS[id] || MODELS.hatch;
  const color = W.COLORS[colorIdx] ?? W.COLORS[0];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  let tail = null;
  for (const [x, y, z, sx, sy, sz, k] of def.boxes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat(k, color));
    m.position.set(x, y, z);
    m.castShadow = k !== 'g' && k !== 'l' && k !== 't';
    body.add(m);
    if (k === 't') { tail = tail || []; tail.push(m); }
  }
  const wheels = [];
  const tire = mat('k', 0), rim = mat('s', 0);
  for (const [wx, wz] of def.wheels) for (const s of [-1, 1]) {
    const piv = new THREE.Group();
    piv.position.set(wx * s, def.wr, wz);
    const spin = new THREE.Group();
    const t = new THREE.Mesh(wheelGeo(def.wr, def.ww), tire);
    t.castShadow = true;
    const rm = new THREE.Mesh(rimGeo, rim);
    rm.position.x = s * (def.ww / 2 + 0.01);
    rm.scale.set(1, def.wr / 0.4 * 0.9, def.wr / 0.4 * 0.9);
    spin.add(t, rm);
    piv.add(spin);
    root.add(piv);
    wheels.push({ piv, spin, front: wz > 0, r: def.wr });
  }
  return { root, body, wheels, tail, def };
}

export function makeNameTag(text, color) {
  const c = textCanvas(text, color || '#ffffff');
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(c.width / 18 * 1.1, 1.1, 1);
  s.renderOrder = 10;
  return s;
}
