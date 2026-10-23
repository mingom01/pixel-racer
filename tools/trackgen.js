// 레이싱 방 경기장 설계 도구 (거북이 그래픽 방식)
// node tools/trackgen.js  →  public/world.js 의 ARENA_DEFS 를 다시 씀
//
// 코스는 (0,0)에서 북쪽(+z)을 보고 출발해 조각들을 이어 붙여 만든다. 시계 방향 한 바퀴(오른쪽으로 총 360도).
//   S(길이, 옵션)          직선
//   R(각도, 반지름, 옵션)  오른쪽 커브,  L(...) 왼쪽 커브,  U('R'|'L', 반지름) 유턴
//   RB(반지름, 'straight'|'left'|'right', 옵션)  로타리 (가운데 섬 자동)
//   X(옵션)                길이를 자동으로 정하는 직선 (코스마다 2개 넣으면 시작점으로 정확히 닫힘)
// 옵션: e 끝 높이, w 끝 폭, tunnel, label, gap:[비율,길이,점프높이], jump:[비율,높이], boost:비율, item:비율,
//       oil/mud:[비율,길이], posts:[비율,개수], mover:{k,at,period,phase}
// 지름길: shortcuts: [{ from:'라벨', to:'라벨', w, e, via:[[옆으로 m, 0~1 위치]...], jump:[0~1,높이], boost:0~1, tunnel, mud }]
const fs = require('fs'), path = require('path');
const D2R = Math.PI / 180;

const S = (len, o = {}) => ({ t: 'S', len, o });
const R = (deg, r, o = {}) => ({ t: 'A', deg, r, o });
const L = (deg, r, o = {}) => ({ t: 'A', deg: -deg, r, o });
const U = (dir, r, o = {}) => (dir === 'R' ? R(180, r, o) : L(180, r, o));
const X = (o = {}) => ({ t: 'X', o });
// 로타리: 들어가며 오른쪽 90 → 섬을 왼쪽으로 돌고 → 오른쪽 90 으로 나감
function RB(r0, kind, o = {}) {
  const around = { straight: 180, left: 270, right: 90 }[kind];
  const rs = o.rs || 30;
  return [R(90, rs, { ...o.in }), L(around, r0, { island: true, ...o.mid }), R(90, rs, { ...o.out, ...o })];
}

// 우회 커브 (지름길용): 'R' 이면 오른쪽으로 부드럽게 불룩 나갔다가 돌아옴. 지름길은 그 안쪽을 곧게 가로지름
// o.mid: 가운데 커브 옵션(높이·아이템·터널 등), o.e: 끝 높이
function BG(dir, r, o = {}) {
  const a = dir === 'R' ? R : L, b = dir === 'R' ? L : R;
  return [a(75, r, { ...(o.in || {}) }), b(150, r, { ...(o.mid || {}) }), a(75, r, { ...(o.out || {}), ...(o.e !== undefined ? { e: o.e } : {}) })];
}
function build(def) {
  const segs = def.segs.flat(Infinity);
  if (def.stretch) for (const s of segs) if (s.t === 'S') s.len = Math.round(s.len * def.stretch);
  // 길 폭 변화: 급커브/유턴은 넓게, 직선 몇 군데는 좁은 병목, 몇 군데는 아주 넓게 (직접 w 를 준 곳은 그대로)
  const base = def.w;
  segs.forEach((sg, idx) => {
    if (sg.o.w !== undefined) return;
    let w = base;
    if (idx > 0 && !def.fixedWidth) {
      if (sg.t === 'A' && sg.r < 45) w = base + 4;
      else if (sg.t === 'S' && sg.len >= 180 && idx % 5 === 2 && !sg.o.gap) w = Math.max(10, Math.round(base * 0.66));
      else if (sg.t === 'S' && sg.len >= 250 && idx % 5 === 4) w = base + 7;
      else if (sg.t === 'A' && sg.r >= 80 && idx % 3 === 0) w = base + 4;
    }
    sg.o = { ...sg.o, w };
  });
  const run = xl => {
    let x = 0, z = 0, th = 0, e = def.e0 || 0, w = def.w, xi = 0;
    const pts = [[0, 0, e, w]], info = [];
    for (const s of segs) {
      const o = s.o, e0 = e, w0 = w, e1 = o.e ?? e, w1 = o.w ?? w, start = pts.length - 1, sx = x, sz = z, sth = th;
      let len;
      if (s.t === 'S' || s.t === 'X') {
        len = s.t === 'X' ? xl[xi++] : s.len;
        const k = Math.max(1, Math.ceil(len / 90));
        for (let j = 1; j <= k; j++) {
          const f = j / k;
          pts.push([x + Math.sin(th * D2R) * len * f, z + Math.cos(th * D2R) * len * f, e0 + (e1 - e0) * f, w0 + (w1 - w0) * f]);
        }
        x += Math.sin(th * D2R) * len; z += Math.cos(th * D2R) * len;
      } else {
        const sgn = Math.sign(s.deg), tot = Math.abs(s.deg), r = s.r;
        len = tot * D2R * r;
        const k = Math.max(2, Math.ceil(tot / 30));
        let done = 0;
        for (let j = 1; j <= k; j++) {
          const target = tot * j / k;
          while (done < target - 1e-9) {
            const d = Math.min(1, target - done), mid = th + sgn * d / 2;
            x += Math.sin(mid * D2R) * r * d * D2R; z += Math.cos(mid * D2R) * r * d * D2R; th += sgn * d; done += d;
          }
          const f = j / k;
          pts.push([x, z, e0 + (e1 - e0) * f, w0 + (w1 - w0) * f]);
        }
        if (o.island) {
          // 섬 = 이 커브의 중심
          const nx = sgn > 0 ? Math.cos(sth * D2R) : -Math.cos(sth * D2R), nz = sgn > 0 ? -Math.sin(sth * D2R) : Math.sin(sth * D2R);
          info.push({ island: [sx + nx * r, sz + nz * r, Math.max(6, r - w1 / 2 - 4.5)] });
        }
      }
      e = e1; w = w1;
      info.push({ seg: s, start, end: pts.length - 1, sx, sz, ex: x, ez: z, th0: sth, th1: th, len });
    }
    return { pts, info, x, z, th };
  };
  // X 두 개의 길이를 풀어서 닫기
  const nX = segs.filter(s => s.t === 'X').length;
  let xl = new Array(nX).fill(0);
  if (nX === 2) {
    // 닫는 직선이 너무 짧으면(음수 포함) 반대 방향 직선을 그만큼 늘려서 다시 계산
    const MIN = [50, 130];
    for (let tries = 0; ; tries++) {
      const r0 = run([0, 0]);
      const xi = r0.info.filter(i => i.seg && i.seg.t === 'X');
      const xs = xi.map(i => [Math.sin(i.th0 * D2R), Math.cos(i.th0 * D2R)]);
      const [u, v] = xs, bx = -r0.x, bz = -r0.z, det = u[0] * v[1] - u[1] * v[0];
      xl = [(bx * v[1] - bz * v[0]) / det, (u[0] * bz - u[1] * bx) / det];
      const k = xl.findIndex((l, j) => l < MIN[j]);
      if (k < 0) break;
      if (tries > 6) throw new Error(`${def.id}: 닫는 직선 길이가 이상함 ${xl.map(l => l.toFixed(0))}`);
      const want = (((xi[k].th0 + 180) % 360) + 360) % 360;
      // 지름길 라벨 사이(우회로 안쪽) 직선은 늘리지 않음 → 지름길 모양 유지
      const order = segs, prot = (def.shortcuts || []).map(sc => [order.findIndex(s => s.o.label === sc.from), order.findIndex(s => s.o.label === sc.to)]);
      const cand = r0.info.filter(i => i.seg && i.seg.t === 'S' && !prot.some(([a, b]) => order.indexOf(i.seg) >= a && order.indexOf(i.seg) <= b) && Math.abs(((((i.th0 - want) % 360) + 540) % 360) - 180) < 1 && Math.abs(((((i.th1 - want) % 360) + 540) % 360) - 180) < 1);
      if (!cand.length) throw new Error(`${def.id}: ${k + 1}번째 X 가 ${xl[k].toFixed(0)} 인데 늘릴 반대 방향(${want}) 직선이 없음`);
      const add = MIN[k] + 40 - xl[k];
      cand[cand.length - 1].seg.len += add;
      console.log(`  ${def.id}: ${want}도 직선을 ${add.toFixed(0)}m 늘림`);
    }
  } else if (nX) throw new Error(def.id + ': X 는 0개 또는 2개');
  const r = run(xl);
  const heading = ((r.th % 360) + 360) % 360;
  if (Math.hypot(r.x, r.z) > 2 || (heading > 1 && heading < 359)) throw new Error(`${def.id}: 코스가 닫히지 않음 끝=(${r.x.toFixed(0)},${r.z.toFixed(0)}) 방향=${r.th.toFixed(0)}`);
  const pts = r.pts.slice(0, -1); // 마지막 점 = 시작점
  // 누적 길이 → 비율
  const cum = [0];
  for (let i = 1; i <= pts.length; i++) { const a = pts[i - 1], b = pts[i % pts.length]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const total = cum[pts.length];
  // 위치 = 컨트롤 포인트 번호 (소수 가능). world.js 가 cp: 1 이면 이렇게 읽음
  const fr = (inf, f) => +((inf.start + (inf.end - inf.start) * f) % pts.length).toFixed(3);
  const out = { jumps: [], boosts: [], items: [], gaps: [], patches: [], posts: [], movers: [], tunnels: [], islands: [], shortcuts: [] };
  const labels = {};
  for (const inf of r.info) {
    if (inf.island) { out.islands.push(inf.island.map(v => +v.toFixed(1))); continue; }
    const o = inf.seg.o;
    if (o.label) labels[o.label] = inf;
    if (o.tunnel) out.tunnels.push([fr(inf, 0.02), fr(inf, 0.98)]);
    if (o.gap) out.gaps.push([fr(inf, o.gap[0]), o.gap[1], o.gap[2] || 3]);
    for (const j of [].concat(o.jump ? [o.jump] : [], o.jumps || [])) out.jumps.push([fr(inf, j[0]), j[1]]);
    // 출발 직후 250m 안의 부스터는 빼기 (출발 부스터와 겹쳐 이상하게 튀어 나감)
    for (const b of [].concat(o.boost ?? [])) if (!(inf.start === 0 && b * inf.len < 250)) out.boosts.push(fr(inf, b));
    for (const b of [].concat(o.item ?? [])) out.items.push(fr(inf, b));
    for (const k of ['oil', 'mud']) if (o[k]) out.patches.push([fr(inf, o[k][0]), k, o[k][1]]);
    if (o.posts) out.posts.push([fr(inf, o.posts[0]), o.posts[1]]);
    for (const m of [].concat(o.mover || [])) out.movers.push({ k: m.k, f: fr(inf, m.at ?? 0.5), period: m.period || 3, phase: m.phase || 0 });
  }
  for (const sc of def.shortcuts || []) {
    const A = labels[sc.from], B = labels[sc.to];
    if (!A || !B) throw new Error(def.id + ': 지름길 라벨 없음 ' + sc.from + '/' + sc.to);
    const pa = pts[A.end % pts.length], pb = pts[B.start % pts.length];
    const dx = pb[0] - pa[0], dz = pb[1] - pa[1], dl = Math.hypot(dx, dz), nx = dz / dl, nz = -dx / dl;
    // 지름길 중간점: 기본은 직선 위 약 25m 간격 (간격이 고르지 않으면 곡선이 꼬임)
    const nv = Math.max(2, Math.round(dl / 25) - 1), via = sc.via || Array.from({ length: nv }, (_, k) => [0, (k + 1) / (nv + 1)]);
    const ctrl = via.map(([side, f]) => [+(pa[0] + dx * f + nx * side).toFixed(1), +(pa[1] + dz * f + nz * side).toFixed(1), +((sc.e ?? (pa[2] + (pb[2] - pa[2]) * f))).toFixed(1)]);
    const o = { from: fr(A, 1), to: fr(B, 0), ctrl, w: sc.w || 12 };
    for (const k of ['jumps', 'boost', 'tunnel', 'mud']) if (sc[k] !== undefined) o[k] = sc[k];
    out.shortcuts.push(o);
  }
  const ctrl = pts.map(p => p.map(v => +v.toFixed(1)));
  const res = { id: def.id, name: def.name, theme: def.theme, diff: def.diff, w: def.w, desc: def.desc, cp: 1, ctrl };
  for (const k in out) if (out[k].length) res[k] = out[k];
  return { res, length: total };
}

const TRACKS = require('./tracks_design.js')({ S, R, L, U, X, RB, BG });
let bad = 0;
const built = TRACKS.map(d => {
  try { const b = build(d); console.log(`${d.id.padEnd(13)} ${(b.length / 1000).toFixed(2)}km`); return b.res; } catch (e) { bad++; console.log('X ' + e.message); return null; }
});
if (bad) { console.log('문제가 있어서 world.js 는 그대로 둠'); process.exit(1); }
const body = built.map(o => '    ' + JSON.stringify(o).replace(/"(\w+)":/g, '$1: ').replace(/,(?=\S)/g, ', ')).join(',\n');
const wp = path.join(__dirname, '..', 'public', 'world.js');
let w = fs.readFileSync(wp, 'utf8');
const d0 = w.indexOf('  const ARENA_DEFS = ['), c0 = w.lastIndexOf('  // tools/trackgen.js 로 만든', d0), a = c0 >= 0 && d0 - c0 < 200 ? c0 : d0, b = w.indexOf('\n  ];', d0);
w = w.slice(0, a) + '  // tools/trackgen.js 로 만든 경기장 (직접 고치지 말고 tools/tracks_design.js 를 고친 뒤 node tools/trackgen.js)\n  const ARENA_DEFS = [\n' + body + ',' + w.slice(b);
fs.writeFileSync(wp, w);
console.log('world.js 에 ' + built.length + '개 경기장 기록');
