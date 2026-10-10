// 월드 정의 (서버/클라이언트 공용). 시드 고정이라 양쪽에서 같은 맵이 만들어진다.
(function (root) {
  'use strict';

  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const HALF = 1280;          // 월드 반경 (벽)
  const INNER = 640;          // 처음 만든 중앙 지역 (도시/서킷/파크) 반경
  const SEA_X = -1222;        // 이보다 서쪽은 바다
  const CELL = 40;            // 충돌 공간 해시 셀 크기

  /* ---------- 도시 ---------- */
  const CITY = {
    xs: [-560, -480, -400, -320, -240, -160],
    zs: [160, 240, 320, 400, 480, 560],
    w: 16,
  };
  CITY.x1 = CITY.xs[0] - CITY.w / 2; CITY.x2 = CITY.xs[CITY.xs.length - 1] + CITY.w / 2;
  CITY.z1 = CITY.zs[0] - CITY.w / 2; CITY.z2 = CITY.zs[CITY.zs.length - 1] + CITY.w / 2;

  /* ---------- 스턴트 파크 (흙바닥) ---------- */
  const PARK = { x1: -560, z1: -560, x2: -140, z2: -140 };

  /* ---------- 도로 (선분) ---------- */
  const roads = [];
  for (const x of CITY.xs) roads.push({ x1: x, z1: CITY.z1, x2: x, z2: CITY.z2, w: CITY.w, city: true });
  for (const z of CITY.zs) roads.push({ x1: CITY.x1, z1: z, x2: CITY.x2, z2: z, w: CITY.w, city: true });
  roads.push({ x1: CITY.x2, z1: 320, x2: 36, z2: 320, w: 16 });      // 도시 → 서킷
  roads.push({ x1: -320, z1: CITY.z1, x2: -320, z2: PARK.z2, w: 16 }); // 도시 → 파크
  roads.push({ x1: PARK.x2, z1: -300, x2: 36, z2: -300, w: 16 });     // 파크 → 서킷
  roads.push({ x1: -60, z1: -300, x2: -60, z2: 320, w: 16 });         // 중앙 도로 (스폰)
  // 외곽 고속도로와 새 지역으로 가는 연결 도로
  roads.push({ x1: -60, z1: 320, x2: -60, z2: 792, w: 16 });          // 북쪽
  roads.push({ x1: -60, z1: -300, x2: -60, z2: -792, w: 16 });        // 남쪽
  roads.push({ x1: CITY.x1, z1: 360, x2: -792, z2: 360, w: 16 });     // 도시 → 서쪽
  roads.push({ x1: -350, z1: PARK.z1, x2: -350, z2: -792, w: 16 });   // 파크 → 남쪽
  roads.push({ x1: 808, z1: 0, x2: 872, z2: 0, w: 16 });              // 고속도로 → 스피드웨이
  roads.push({ x1: 0, z1: 808, x2: 0, z2: 893, w: 16 });              // 고속도로 → 산악 도로
  roads.push({ x1: -808, z1: 0, x2: -872, z2: 0, w: 16 });            // 고속도로 → 해안 도로
  roads.push({ x1: 0, z1: -808, x2: 0, z2: -990, w: 16 });            // 고속도로 → 공항

  /* ---------- 경사로 / 플랫폼 / 부스터 ---------- */
  // wedge: [cx, cz, rot, len, w, h]  rot: 올라가는 방향(yaw). forward = (sin rot, cos rot)
  const PI = Math.PI;
  const ramps = [
    [-320, -200, PI, 16, 12, 3],
    [-460, -260, PI / 2, 26, 14, 7],
    [-402, -260, -PI / 2, 30, 14, 7],
    [-332, -420, PI / 2, 24, 14, 6],
    [-268, -420, -PI / 2, 24, 14, 6],
    [-200, -300, PI / 2, 10, 10, 2],
    [-200, -360, -PI / 2, 10, 10, 2],
    [-180, -480, 0, 10, 10, 2.2],
    [-480, -470, 0, 40, 16, 12],
    [-230, -200, PI / 2, 14, 12, 3.5],
  ].map(([cx, cz, rot, len, w, h]) => ({ cx, cz, rot, len, w, h, fx: Math.sin(rot), fz: Math.cos(rot) }));
  // platform: [cx, cz, sx, sz, h]
  const platforms = [
    [-300, -420, 40, 14, 6],
  ].map(([cx, cz, sx, sz, h]) => ({ cx, cz, sx, sz, h }));

  /* ---------- 트랙 ---------- */
  function catmullClosed(ctrl, per) {
    const out = [], n = ctrl.length;
    for (let i = 0; i < n; i++) {
      const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
      for (let k = 0; k < per; k++) {
        const t = k / per, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    return out;
  }
  function resampleClosed(pts, step) {
    const n = pts.length, cum = [0];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[n], cnt = Math.round(total / step), out = [];
    let j = 0;
    for (let k = 0; k < cnt; k++) {
      const d = k * total / cnt;
      while (cum[j + 1] < d) j++;
      const a = pts[j], b = pts[(j + 1) % n], t = (d - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    return { pts: out, length: total };
  }

  const CIRCUIT_CTRL = [
    [40, -250], [40, -60], [40, 200], [60, 380], [140, 470], [260, 460], [320, 380], [280, 280],
    [200, 200], [220, 100], [330, 60], [440, 110], [520, 220], [590, 170], [585, 30], [520, -120], [420, -200],
    [330, -160], [260, -260], [330, -380], [480, -420], [520, -520], [380, -585], [160, -560], [60, -500],
    [40, -400],
  ];
  const DOWNTOWN_CORNERS = [
    [-160, 230], [-160, 400], [-320, 400], [-320, 560], [-560, 560], [-560, 320], [-400, 320], [-400, 160], [-160, 160],
  ];

  // 둥근 사각형 경로 (직선 + 1/4 원), seg = 모서리 하나의 분할 수
  function roundRect(cx, cz, hx, hz, r, seg) {
    const pts = [], arc = (ax, az, a0) => { for (let k = 0; k <= seg; k++) { const a = a0 + k / seg * Math.PI / 2; pts.push([ax + Math.cos(a) * r, az + Math.sin(a) * r]); } };
    arc(cx + hx - r, cz + hz - r, 0);
    arc(cx - hx + r, cz + hz - r, Math.PI / 2);
    arc(cx - hx + r, cz - hz + r, Math.PI);
    arc(cx + hx - r, cz - hz + r, Math.PI * 1.5);
    return pts;
  }
  function makeTrack(id, name, raw, w, nCp, ribbon, step) {
    const r = resampleClosed(raw, step);
    const path = r.pts, n = path.length;
    const tan = path.map((p, i) => {
      const a = path[(i - 1 + n) % n], b = path[(i + 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      return [dx / l, dz / l];
    });
    const cps = [];
    for (let k = 0; k < nCp; k++) cps.push(Math.round(k * n / nCp) % n);
    return { id, name, w, path, tan, cps, length: r.length, ribbon };
  }
  const tracks = [
    makeTrack('circuit', '그랑프리 서킷', catmullClosed(CIRCUIT_CTRL, 16), 22, 16, true, 5),
    makeTrack('downtown', '다운타운 런', DOWNTOWN_CORNERS, 16, 14, false, 5),
    makeTrack('outer', '시내 순환 레이스', [[-60, -200], [-60, 320], [-160, 320], [-160, 160], [-320, 160], [-320, -300], [-60, -300]], 16, 18, false, 5),
    makeTrack('parkrally', '스턴트 파크 랠리', [[-165, -215], [-165, -170], [-540, -170], [-540, -545], [-165, -545], [-165, -420], [-360, -420], [-360, -300], [-165, -300]], 16, 16, false, 5),
    // 넓어진 바깥 지역 코스
    makeTrack('highway', '외곽 고속도로', roundRect(0, 0, 800, 800, 200, 10), 20, 34, true, 5),
    makeTrack('oval', '스피드웨이 오벌', roundRect(990, 0, 110, 410, 110, 12), 26, 12, true, 5),
    makeTrack('mountain', '산악 와인딩', catmullClosed([[0, 900], [300, 880], [500, 940], [640, 1060], [560, 1180], [380, 1140], [260, 1220], [60, 1160], [-120, 1230], [-320, 1180], [-420, 1060], [-600, 1120], [-760, 1040], [-700, 900], [-500, 880], [-300, 940], [-150, 880]], 16), 18, 20, true, 5),
    makeTrack('coast', '해안 드라이브', catmullClosed([[-880, -500], [-880, 0], [-880, 500], [-960, 620], [-1080, 600], [-1140, 450], [-1100, 250], [-1180, 80], [-1150, -150], [-1200, -350], [-1120, -560], [-1000, -620]], 16), 18, 18, true, 5),
    makeTrack('airport', '공항 활주로', roundRect(0, -1075, 775, 75, 75, 10), 24, 18, true, 5),
  ];
  const TRACK_STYLE = { circuit: 'circuit', oval: 'circuit', highway: 'road', mountain: 'road', coast: 'road', airport: 'runway' };
  for (const t of tracks) t.style = TRACK_STYLE[t.id] || null;

  /* ---------- 레이싱 방 전용 경기장 (본 맵과 멀리 떨어진 곳, 벽으로 막힌 코스) ---------- */
  const ARENA_DEFS = [
    {
      id: 'kgp', name: '코리아 그랑프리', theme: 'grass', w: 20, desc: '긴 직선과 헤어핀, 시케인이 있는 F1 서킷',
      ctrl: [[0, -500], [0, -100], [0, 250], [20, 380], [110, 440], [220, 410], [250, 320], [190, 230], [220, 130], [330, 90], [430, 160], [540, 130], [590, 20], [560, -110], [440, -150], [400, -240], [460, -330], [440, -440], [340, -500], [250, -450], [170, -540], [70, -600], [10, -580]],
      jumps: [], boosts: [0.06, 0.52], items: [0.2, 0.55, 0.82],
    },
    {
      id: 'desert', name: '사막 점프 랠리', theme: 'desert', w: 18, desc: '모래 언덕 사이 점프대를 날아가는 랠리 코스',
      ctrl: [[0, -400], [0, 0], [0, 250], [70, 350], [210, 340], [260, 220], [200, 90], [270, -10], [400, 0], [460, 120], [570, 110], [600, -80], [510, -250], [360, -300], [260, -420], [130, -510], [40, -510], [5, -460]],
      jumps: [[0.11, 3.5], [0.66, 3]], boosts: [0.05, 0.62], items: [0.25, 0.5, 0.8],
    },
    {
      id: 'ice', name: '아이스 드리프트', theme: 'snow', w: 18, desc: '미끄러운 빙판 헤어핀. 드리프트가 필수!',
      ctrl: [[0, -250], [0, 100], [40, 210], [150, 230], [200, 150], [140, 60], [180, -30], [290, -10], [330, 100], [420, 140], [480, 50], [440, -70], [330, -110], [290, -210], [350, -290], [260, -370], [110, -370], [30, -320]],
      jumps: [], boosts: [0.06, 0.44], items: [0.22, 0.58, 0.84],
    },
    {
      id: 'neon', name: '네온 시티 나이트', theme: 'night', w: 18, desc: '밤의 도심 시가지 서킷. 직각 코너 주의',
      ctrl: [[0, -200], [0, 160], [14, 230], [60, 268], [110, 275], [250, 275], [305, 250], [325, 195], [325, 110], [345, 55], [400, 35], [505, 35], [555, 5], [570, -50], [570, -250], [545, -305], [490, -325], [400, -325], [360, -290], [300, -290], [260, -325], [120, -325], [45, -315], [8, -270]],
      jumps: [[0.13, 2.5]], boosts: [0.06, 0.6], items: [0.3, 0.52, 0.85],
    },
    {
      id: 'beach', name: '해변 서킷', theme: 'beach', w: 20, desc: '야자수 늘어선 바닷가의 빠른 고속 서킷',
      ctrl: [[0, -450], [0, 0], [0, 300], [60, 400], [180, 420], [300, 360], [340, 250], [420, 200], [540, 240], [620, 160], [600, 20], [500, -40], [440, -150], [520, -260], [540, -400], [440, -480], [300, -430], [200, -520], [80, -540]],
      jumps: [[0.09, 3]], boosts: [0.04, 0.5, 0.78], items: [0.2, 0.47, 0.75],
    },
    {
      id: 'canyon', name: '붉은 협곡', theme: 'canyon', w: 18, desc: '붉은 바위 협곡을 굽이굽이 달리는 점프 코스',
      ctrl: [[0, -350], [0, 50], [30, 180], [120, 240], [220, 200], [250, 100], [330, 60], [420, 120], [470, 240], [580, 250], [620, 120], [560, 0], [600, -120], [540, -260], [420, -280], [350, -200], [260, -260], [200, -380], [110, -460], [30, -460], [2, -410]],
      jumps: [[0.07, 3.5], [0.62, 3]], boosts: [0.03, 0.4], items: [0.22, 0.5, 0.8],
    },
  ];
  const arenas = ARENA_DEFS.map((d, k) => {
    const ox = 5000 + k * 2000, oz = 0;
    const t = makeTrack(d.id, d.name, catmullClosed(d.ctrl.map(([x, z]) => [x + ox, z + oz]), 16), d.w, 16, true, 5);
    const n = t.path.length, nCp = Math.max(12, Math.round(t.length / 150));
    t.cps = [];
    for (let i = 0; i < nCp; i++) t.cps.push(Math.round(i * n / nCp) % n);
    Object.assign(t, { arena: true, theme: d.theme, desc: d.desc, ox, oz, wb: d.w / 2 + 3, itemBoxes: [], boostSpecs: [], barriers: [] });
    const at = f => { const i = Math.floor(f * n) % n; return { p: t.path[i], tg: t.tan[i] }; };
    for (const [f, h] of d.jumps) {
      const { p, tg } = at(f), rot = Math.atan2(tg[0], tg[1]);
      ramps.push({ cx: p[0], cz: p[1], rot, len: 14, w: d.w - 1, h, fx: Math.sin(rot), fz: Math.cos(rot) });
    }
    for (const f of d.boosts) { const { p, tg } = at(f); t.boostSpecs.push({ cx: p[0], cz: p[1], rot: Math.atan2(tg[0], tg[1]), len: 10, w: 8 }); }
    for (const f of d.items) {
      const { p, tg } = at(f);
      for (const o of [-0.34, -0.17, 0, 0.17, 0.34]) t.itemBoxes.push({ x: p[0] + tg[1] * o * d.w, z: p[1] - tg[0] * o * d.w });
    }
    // 코스 양옆 벽 (선분 충돌체)
    for (let i = 0; i < n; i++) {
      const a = t.path[i], b = t.path[(i + 1) % n], ta = t.tan[i], tb = t.tan[(i + 1) % n];
      for (const s of [1, -1]) t.barriers.push([a[0] + ta[1] * s * t.wb, a[1] - ta[0] * s * t.wb, b[0] + tb[1] * s * t.wb, b[1] - tb[0] * s * t.wb, -s * ta[1], s * ta[0]]);
    }
    let x1 = Infinity, x2 = -Infinity, z1 = Infinity, z2 = -Infinity;
    for (const p of t.path) { x1 = Math.min(x1, p[0]); x2 = Math.max(x2, p[0]); z1 = Math.min(z1, p[1]); z2 = Math.max(z2, p[1]); }
    t.bounds = { x1, x2, z1, z2 };
    return t;
  });
  function arenaAt(x) { return x > 3500 ? arenas[Math.round((x - 5300) / 2000)] || null : null; }

  const trackById = {};
  for (const t of [...tracks, ...arenas]) trackById[t.id] = t;

  // 트랙 점 공간 해시 (가장 가까운 점 찾기용)
  for (const t of [...tracks, ...arenas]) {
    t.grid = new Map();
    t.path.forEach((p, i) => {
      const k = cellKey(Math.floor(p[0] / CELL), Math.floor(p[1] / CELL));
      if (!t.grid.has(k)) t.grid.set(k, []);
      t.grid.get(k).push(i);
    });
  }
  function cellKey(cx, cz) { return cx * 100003 + cz; }

  function nearestOnTrack(t, x, z, maxCells) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), m = maxCells || 1;
    let best = -1, bd = Infinity;
    for (let i = -m; i <= m; i++) for (let j = -m; j <= m; j++) {
      const arr = t.grid.get(cellKey(cx + i, cz + j));
      if (!arr) continue;
      for (const idx of arr) {
        const p = t.path[idx], d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
        if (d < bd) { bd = d; best = idx; }
      }
    }
    if (best < 0) { // 멀리 있을 때 전체 탐색
      t.path.forEach((p, idx) => { const d = (p[0] - x) ** 2 + (p[1] - z) ** 2; if (d < bd) { bd = d; best = idx; } });
    }
    return { i: best, d: Math.sqrt(bd) };
  }

  // 출발 그리드
  // 출발선 뒤로 경로를 따라 두 줄로 배치
  function gridSlot(t, k) {
    const n = t.path.length, step = t.length / n;
    const row = Math.floor(k / 2), side = (k % 2 === 0 ? 1 : -1) * t.w * 0.22;
    const back = 10 + row * 9 + (k % 2) * 3;
    const idx = ((-Math.round(back / step)) % n + n) % n;
    const p = t.path[idx], tg = t.tan[idx];
    return { x: p[0] + tg[1] * side, z: p[1] - tg[0] * side, yaw: Math.atan2(tg[0], tg[1]) };
  }

  /* ---------- 부스터 패드 ---------- */
  const boosts = [];
  {
    const c = tracks[0];
    for (const f of [0.1, 0.36, 0.62, 0.86]) {
      const i = Math.floor(f * c.path.length), p = c.path[i], tg = c.tan[i];
      boosts.push({ cx: p[0], cz: p[1], rot: Math.atan2(tg[0], tg[1]), len: 10, w: 8 });
    }
    boosts.push({ cx: -480, cz: -525, rot: 0, len: 10, w: 8 });
    boosts.push({ cx: -505, cz: -260, rot: PI / 2, len: 10, w: 8 });
    boosts.push({ cx: -60, cz: -100, rot: 0, len: 10, w: 8 });
    for (const a of arenas) boosts.push(...a.boostSpecs);
    for (const b of boosts) { b.fx = Math.sin(b.rot); b.fz = Math.cos(b.rot); }
  }

  /* ---------- 지형 높이 ---------- */
  function groundHeight(x, z) {
    let h = 0;
    for (const r of ramps) {
      const dx = x - r.cx, dz = z - r.cz;
      const u = dx * r.fx + dz * r.fz, v = dx * r.fz - dz * r.fx;
      if (u >= -r.len / 2 && u <= r.len / 2 && v >= -r.w / 2 && v <= r.w / 2) {
        const hh = r.h * (u + r.len / 2) / r.len;
        if (hh > h) h = hh;
      }
    }
    for (const p of platforms) {
      if (Math.abs(x - p.cx) <= p.sx / 2 && Math.abs(z - p.cz) <= p.sz / 2 && p.h > h) h = p.h;
    }
    return h;
  }

  function boostAt(x, z) {
    for (const b of boosts) {
      const dx = x - b.cx, dz = z - b.cz;
      const u = dx * b.fx + dz * b.fz, v = dx * b.fz - dz * b.fx;
      if (Math.abs(u) <= b.len / 2 && Math.abs(v) <= b.w / 2) return b;
    }
    return null;
  }

  function distSeg(px, pz, s) {
    const dx = s.x2 - s.x1, dz = s.z2 - s.z1, l2 = dx * dx + dz * dz;
    let t = l2 ? ((px - s.x1) * dx + (pz - s.z1) * dz) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (s.x1 + dx * t), pz - (s.z1 + dz * t));
  }

  function inPark(x, z, m) { m = m || 0; return x > PARK.x1 - m && x < PARK.x2 + m && z > PARK.z1 - m && z < PARK.z2 + m; }
  function inCity(x, z, m) { m = m || 0; return x > CITY.x1 - m && x < CITY.x2 + m && z > CITY.z1 - m && z < CITY.z2 + m; }

  // 노면: 'road' | 'dirt' | 'grass' | 'walk'
  function surfaceAt(x, z) {
    const ar = arenaAt(x);
    if (ar) { const n = nearestOnTrack(ar, x, z, 1); return n.d <= ar.w / 2 + 0.6 ? (ar.theme === 'snow' ? 'ice' : 'road') : 'runoff'; }
    if (inPark(x, z)) return 'dirt';
    for (const p of pads) if (x > p.x1 && x < p.x2 && z > p.z1 && z < p.z2) return 'road';
    for (const s of roads) if (distSeg(x, z, s) <= s.w / 2) return 'road';
    for (const t of tracks) if (t.ribbon && nearestOnTrack(t, x, z, 1).d <= t.w / 2 + 1.5) return 'road';
    if (x < SEA_X) return 'water';
    if (inCity(x, z)) return 'walk';
    return 'grass';
  }

  /* ---------- 건물 / 나무 (충돌체) ---------- */
  const R = rng(20260927);
  const pickR = a => a[Math.floor(R() * a.length)];
  const buildings = []; // {x1,z1,x2,z2,h,type,...}
  const cityParks = [];  // 공원 블록
  const lots = [];       // 주차장 블록
  const lamps = [];      // 가로등 {x,z,rot}
  const canopies = [];   // 주유소 지붕 {x1,z1,x2,z2,h}
  const pads = [];       // 포장 바닥 (도로 취급)
  const trees = [];      // {x,z,s}
  const BCOLORS = [0xc9b79c, 0xa7a9ac, 0x8f6e5a, 0xd8d0c0, 0x7b8fa6, 0xb5654a, 0x9ea37e, 0xe0c28f, 0x6f7b88, 0xc98f6a];
  const GLASS = [0x8ab8e0, 0x6a98c0, 0xa8ccd4, 0x7888a0, 0x98b8c8, 0x88a0b0, 0x70a0a8];
  const APTCOL = [0xf0ece0, 0xe8e4f0, 0xf4e8d8, 0xe0ecf0, 0xf0e0e0, 0xe8f0e0];
  const WALLCOL = [0xf4ecd8, 0xffffff, 0xf0d8c0, 0xd8e4f0, 0xe8f0d8, 0xf0e0a8];
  const ROOFCOL = [0xb84a3a, 0x3a5aa8, 0x4a8a4a, 0x7a5a3a, 0x5a5a60, 0x2a6a7a];
  const AWN = [0xd83a3a, 0x3a6fd8, 0x3aa64a, 0xf2c230, 0xe0782a, 0x9a4ad8, 0x38a8a8];
  const SHOPS = ['편의점', '치킨', '카페', '분식', 'PC방', '노래방', '약국', '빵집', '꽃집', '세탁소', '은행', '병원', '피자', '마트', '문구점', '미용실', '떡볶이', '서점'];
  let aptNo = 101;

  function tower(x1, z1, x2, z2, hMin, hMax) {
    const h = Math.round(hMin + R() * (hMax - hMin));
    const n = 1 + Math.floor(R() * 3), tiers = [];
    let left = h, inset = 0;
    for (let k = 0; k < n; k++) {
      const th = k === n - 1 ? left : Math.round(left * (0.55 + R() * 0.2));
      tiers.push({ inset, h: th });
      left -= th; inset += 2.5 + R() * 3;
    }
    buildings.push({ x1, z1, x2, z2, h, type: 'tower', color: pickR(GLASS), tiers, antenna: R() < 0.5 });
  }
  function office(x1, z1, x2, z2, h) {
    buildings.push({ x1, z1, x2, z2, h, type: 'office', color: pickR(BCOLORS), kind: Math.floor(R() * 3) });
  }

  const nBx = CITY.xs.length - 1, nBz = CITY.zs.length - 1;
  const midI = Math.floor(nBx / 2), midJ = Math.floor(nBz / 2);
  for (let i = 0; i < nBx; i++) {
    for (let j = 0; j < nBz; j++) {
      const bx1 = CITY.xs[i] + CITY.w / 2 + 3, bx2 = CITY.xs[i + 1] - CITY.w / 2 - 3;
      const bz1 = CITY.zs[j] + CITY.w / 2 + 3, bz2 = CITY.zs[j + 1] - CITY.w / 2 - 3;
      const cx = (bx1 + bx2) / 2, cz = (bz1 + bz2) / 2, bw = bx2 - bx1, bd = bz2 - bz1;
      const dist = Math.abs(i - midI) + Math.abs(j - midJ);
      const roll = R();
      if (dist === 0) { // 랜드마크 광장 + 타워
        cityParks.push({ x1: bx1, z1: bz1, x2: bx2, z2: bz2, cx, cz, landmark: true });
        buildings.push({ x1: cx - 6, z1: cz - 6, x2: cx + 6, z2: cz + 6, h: 8, type: 'ntower' });
        continue;
      }
      if (dist === 1 || (dist === 2 && roll < 0.35)) { // 도심 고층
        if (R() < 0.5) { const s = 17 + R() * 5; tower(cx - s, cz - s, cx + s, cz + s, dist === 1 ? 70 : 45, dist === 1 ? 120 : 80); }
        else if (R() < 0.5) { tower(bx1 + 1, bz1 + 6, cx - 3, bz2 - 6, 40, 90); tower(cx + 3, bz1 + 6, bx2 - 1, bz2 - 6, 40, 90); }
        else { tower(bx1 + 6, bz1 + 1, bx2 - 6, cz - 3, 40, 90); tower(bx1 + 6, cz + 3, bx2 - 6, bz2 - 1, 40, 90); }
        continue;
      }
      if (roll < 0.1) {
        cityParks.push({ x1: bx1, z1: bz1, x2: bx2, z2: bz2, cx, cz });
        buildings.push({ x1: cx - 3.5, z1: cz - 3.5, x2: cx + 3.5, z2: cz + 3.5, h: 1.2, type: 'fountain' });
        continue;
      }
      if (roll < 0.17) { lots.push({ x1: bx1, z1: bz1, x2: bx2, z2: bz2 }); continue; }
      if (roll < 0.42) { // 아파트 단지 (판상형 2동)
        const h = 3 * (8 + Math.floor(R() * 9)), col = pickR(APTCOL);
        if (R() < 0.5) {
          buildings.push({ x1: bx1 + 3, z1: bz1 + 5, x2: bx2 - 3, z2: bz1 + 16, h, type: 'apt', color: col, axis: 'x', no: aptNo++ });
          buildings.push({ x1: bx1 + 3, z1: bz2 - 16, x2: bx2 - 3, z2: bz2 - 5, h: h - 6, type: 'apt', color: col, axis: 'x', no: aptNo++ });
        } else {
          buildings.push({ x1: bx1 + 5, z1: bz1 + 3, x2: bx1 + 16, z2: bz2 - 3, h, type: 'apt', color: col, axis: 'z', no: aptNo++ });
          buildings.push({ x1: bx2 - 16, z1: bz1 + 3, x2: bx2 - 5, z2: bz2 - 3, h: h - 6, type: 'apt', color: col, axis: 'z', no: aptNo++ });
        }
        continue;
      }
      if (roll < 0.8) { // 상가 2x2
        const cw = bw / 2, rw = bd / 2;
        for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
          const x1 = bx1 + a * cw + 1.5, x2 = bx1 + (a + 1) * cw - 1.5, z1 = bz1 + b * rw + 1.5, z2 = bz1 + (b + 1) * rw - 1.5;
          if (R() < 0.2) { office(x1, z1, x2, z2, 14 + Math.round(R() * 16)); continue; }
          const face = R() < 0.5 ? (a === 0 ? 'nx' : 'px') : (b === 0 ? 'nz' : 'pz');
          buildings.push({ x1, z1, x2, z2, h: 7 + Math.floor(R() * 3) * 3, type: 'shop', color: pickR(BCOLORS), face, sign: pickR(SHOPS), awning: pickR(AWN) });
        }
        continue;
      }
      const split = R();
      const cols = split < 0.3 ? 1 : 2, rows = split < 0.55 ? 1 : 2;
      const cw = bw / cols, rw = bd / rows;
      for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
        const inset = 1 + R() * 3;
        office(bx1 + a * cw + inset, bz1 + b * rw + inset, bx1 + (a + 1) * cw - inset, bz1 + (b + 1) * rw - inset, Math.round(10 + R() * 25));
      }
    }
  }

  // 도시 가로등 + 가로수
  for (const x of CITY.xs) for (let j = 0; j < nBz; j++) {
    const z0 = CITY.zs[j];
    lamps.push({ x: x + 8.9, z: z0 + 24, rot: -PI / 2 }, { x: x - 8.9, z: z0 + 56, rot: PI / 2 });
    trees.push({ x: x + 9.8, z: z0 + 40, s: 0.55 }, { x: x - 9.8, z: z0 + 40, s: 0.55 });
  }
  for (const z of CITY.zs) for (let i = 0; i < nBx; i++) {
    const x0 = CITY.xs[i];
    lamps.push({ x: x0 + 24, z: z + 8.9, rot: PI }, { x: x0 + 56, z: z - 8.9, rot: 0 });
    trees.push({ x: x0 + 40, z: z + 9.8, s: 0.55 }, { x: x0 + 40, z: z - 9.8, s: 0.55 });
  }
  for (let z = -270; z <= 300; z += 50) lamps.push({ x: -60 + 8.9, z, rot: -PI / 2 });
  for (let x = -140; x <= 20; x += 50) lamps.push({ x, z: 320 + 8.9, rot: PI });
  for (let x = -130; x <= 20; x += 50) lamps.push({ x, z: -300 - 8.9, rot: 0 });

  // 교외: 주유소, 주택, 농장
  function canPlace(x1, z1, x2, z2) {
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2, hd = Math.hypot(x2 - x1, z2 - z1) / 2;
    if (Math.abs(cx) > INNER - 20 - hd || Math.abs(cz) > INNER - 20 - hd) return false;
    if (inCity(cx, cz, hd + 6) || inPark(cx, cz, hd + 6)) return false;
    for (const b of buildings) if (x1 < b.x2 + 4 && x2 > b.x1 - 4 && z1 < b.z2 + 4 && z2 > b.z1 - 4) return false;
    for (const p of pads) if (x1 < p.x2 + 2 && x2 > p.x1 - 2 && z1 < p.z2 + 2 && z2 > p.z1 - 2) return false;
    for (const s of roads) if (distSeg(cx, cz, s) - hd < s.w / 2 + 1) return false;
    for (const t of tracks) if (t.ribbon && nearestOnTrack(t, cx, cz, 2).d - hd < t.w / 2 + 5) return false;
    for (const r of ramps) if (Math.hypot(cx - r.cx, cz - r.cz) < hd + r.len) return false;
    return true;
  }
  // 주유소 (중앙 도로 동쪽)
  pads.push({ x1: -52, z1: 56, x2: -18, z2: 100 });
  canopies.push({ x1: -48, z1: 64, x2: -33, z2: 92, h: 5.5 });
  for (const [px, pz] of [[-46.5, 66], [-34.5, 66], [-46.5, 90], [-34.5, 90]]) buildings.push({ x1: px - 0.4, z1: pz - 0.4, x2: px + 0.4, z2: pz + 0.4, h: 5.5, type: 'pillar' });
  for (const pz of [73, 83]) buildings.push({ x1: -41.2, z1: pz - 1, x2: -39.8, z2: pz + 1, h: 1.6, type: 'pump' });
  buildings.push({ x1: -29, z1: 66, x2: -19, z2: 90, h: 4.6, type: 'shop', color: 0xf0f0f0, face: 'nx', sign: '주유소', awning: 0xd83a3a });

  function house(cx, cz, face) {
    const alongX = face === 'nz' || face === 'pz';
    const w = alongX ? 11 : 9, d = alongX ? 9 : 11;
    const x1 = cx - w / 2, x2 = cx + w / 2, z1 = cz - d / 2, z2 = cz + d / 2;
    if (!canPlace(x1, z1, x2, z2)) return;
    buildings.push({ x1, z1, x2, z2, h: 4.5, type: 'house', color: pickR(WALLCOL), roof: pickR(ROOFCOL), face, ridge: alongX ? 'x' : 'z' });
  }
  for (let z = -270; z <= 290; z += 24) for (const s of [-1, 1]) if (R() < 0.6) house(-60 + s * 18, z, s > 0 ? 'nx' : 'px');
  for (let x = -135; x <= 10; x += 24) for (const s of [-1, 1]) if (R() < 0.6) house(x, 320 + s * 18, s > 0 ? 'nz' : 'pz');
  for (let x = -125; x <= 15; x += 24) for (const s of [-1, 1]) if (R() < 0.6) house(x, -300 + s * 18, s > 0 ? 'nz' : 'pz');
  for (let z = -125; z <= 135; z += 24) for (const s of [-1, 1]) if (R() < 0.6) house(-320 + s * 18, z, s > 0 ? 'nx' : 'px');
  let farms = 0, fieldHouses = 0;
  for (let k = 0; k < 400 && (farms < 8 || fieldHouses < 22); k++) {
    const x = -INNER + 40 + R() * (INNER * 2 - 80), z = -INNER + 40 + R() * (INNER * 2 - 80);
    const roll = R();
    if (roll < 0.4) { // 농장: 헛간 + 사일로
      if (farms >= 8) continue;
      const rot = R() < 0.5;
      const w = rot ? 10 : 16, d = rot ? 16 : 10;
      if (!canPlace(x - w / 2 - 2, z - d / 2 - 2, x + w / 2 + 9, z + d / 2 + 2)) continue;
      buildings.push({ x1: x - w / 2, z1: z - d / 2, x2: x + w / 2, z2: z + d / 2, h: 6, type: 'barn', ridge: rot ? 'z' : 'x' });
      buildings.push({ x1: x + w / 2 + 2, z1: z - 2.5, x2: x + w / 2 + 7, z2: z + 2.5, h: 13, type: 'silo' });
      farms++;
    } else if (fieldHouses < 22) { const n = buildings.length; house(x, z, pickR(['nx', 'px', 'nz', 'pz'])); if (buildings.length > n) fieldHouses++; }
  }

  function clearForTree(x, z) {
    if (inCity(x, z, 6) || inPark(x, z, 6)) return false;
    for (const s of roads) if (distSeg(x, z, s) < s.w / 2 + 5) return false;
    for (const t of tracks) { if (!t.ribbon) continue; const n = nearestOnTrack(t, x, z, 1); if (n.d < t.w / 2 + 7) return false; }
    for (const b of buildings) if (x > b.x1 - 5 && x < b.x2 + 5 && z > b.z1 - 5 && z < b.z2 + 5) return false;
    for (const p of pads) if (x > p.x1 - 4 && x < p.x2 + 4 && z > p.z1 - 4 && z < p.z2 + 4) return false;
    return true;
  }
  for (let k = 0; k < 1400 && trees.length < 640; k++) {
    const x = -INNER + 12 + R() * (INNER * 2 - 24), z = -INNER + 12 + R() * (INNER * 2 - 24);
    if (clearForTree(x, z)) trees.push({ x, z, s: 0.8 + R() * 0.6 });
  }
  for (const p of cityParks) {
    for (let k = 0; k < 9; k++) {
      const x = p.x1 + 5 + R() * (p.x2 - p.x1 - 10), z = p.z1 + 5 + R() * (p.z2 - p.z1 - 10);
      if (Math.hypot(x - p.cx, z - p.cz) < (p.landmark ? 13 : 8)) continue;
      trees.push({ x, z, s: 0.7 + R() * 0.5 });
    }
  }

  /* ---------- 넓어진 바깥 지역: 산, 공항, 스피드웨이, 숲 ---------- */
  {
    const RR = rng(4096);
    const T = id => tracks.find(t => t.id === id);
    const farFromCourses = (cx, cz, hd, gap) => {
      for (const t of tracks) if (nearestOnTrack(t, cx, cz, 3).d - hd < t.w / 2 + gap) return false;
      for (const s of roads) if (distSeg(cx, cz, s) - hd < s.w / 2 + gap) return false;
      return true;
    };
    // 북쪽 산맥 (계단식 바위산, 부딪힘)
    let made = 0;
    for (let k = 0; k < 600 && made < 46; k++) {
      const sx = 30 + RR() * 60, sz = 30 + RR() * 60;
      const cx = -1250 + sx / 2 + RR() * (2500 - sx), cz = 830 + sz / 2 + RR() * (440 - sz);
      if (cz + sz / 2 > HALF - 4 || Math.abs(cx) + sx / 2 > HALF - 4) continue;
      const hd = Math.hypot(sx, sz) / 2;
      if (!farFromCourses(cx, cz, hd, 14)) continue;
      const h = Math.round(22 + RR() * 40 + (cz - 830) / 440 * 35);
      buildings.push({ x1: cx - sx / 2, z1: cz - sz / 2, x2: cx + sx / 2, z2: cz + sz / 2, h, type: 'mountain', snow: h > 70 });
      made++;
    }
    // 남쪽 공항: 터미널, 관제탑, 격납고, 비행기, 계류장
    pads.push({ x1: -260, z1: -965, x2: 470, z2: -850 }, { x1: -620, z1: -1205, x2: -300, z2: -1162 });
    buildings.push({ x1: 260, z1: -925, x2: 440, z2: -885, h: 16, type: 'tower', color: 0x9ac0d8, tiers: [{ inset: 0, h: 12 }, { inset: 4, h: 4 }], antenna: false });
    buildings.push({ x1: 555, z1: -905, x2: 565, z2: -895, h: 38, type: 'ctower' });
    for (const cx of [-560, -460, -360]) buildings.push({ x1: cx - 40, z1: -1258, x2: cx + 40, z2: -1208, h: 16, type: 'hangar' });
    for (const cx of [110, -120]) buildings.push({ x1: cx - 20, z1: -932, x2: cx + 20, z2: -927, h: 6, type: 'plane' });
    // 동쪽 스피드웨이 관중석
    buildings.push({ x1: 1125, z1: -260, x2: 1155, z2: 260, h: 14, type: 'stand' });
    // 바깥 지역 숲 (바다·공항 계류장 제외)
    let added = 0;
    for (let k = 0; k < 5000 && added < 760; k++) {
      const x = -HALF + 10 + RR() * (HALF * 2 - 20), z = -HALF + 10 + RR() * (HALF * 2 - 20);
      if (Math.max(Math.abs(x), Math.abs(z)) < INNER + 20 || x < SEA_X + 110) continue;
      if (z < -820 && x > -830 && x < 830 && z > -1170) continue; // 공항 안쪽은 비워 둠
      if (clearForTree(x, z)) { trees.push({ x, z, s: 0.8 + RR() * 0.8 }); added++; }
    }
    // 외곽 고속도로 가로등
    const hw = T('highway');
    for (let i = 0; i < hw.path.length; i += 24) {
      const p = hw.path[i], tg = hw.tan[i], o = hw.w / 2 + 2.5;
      // 바깥쪽(원점에서 먼 쪽)에 세우고 팔은 도로 쪽으로
      const nx = tg[1], nz = -tg[0], sgn = (p[0] * nx + p[1] * nz) > 0 ? 1 : -1;
      lamps.push({ x: p[0] + nx * sgn * o, z: p[1] + nz * sgn * o, rot: Math.atan2(-nx * sgn, -nz * sgn) });
    }
  }

  // 공간 해시
  const colGrid = new Map();
  function addCol(obj, x1, z1, x2, z2) {
    for (let cx = Math.floor(x1 / CELL); cx <= Math.floor(x2 / CELL); cx++)
      for (let cz = Math.floor(z1 / CELL); cz <= Math.floor(z2 / CELL); cz++) {
        const k = cellKey(cx, cz);
        if (!colGrid.has(k)) colGrid.set(k, []);
        colGrid.get(k).push(obj);
      }
  }
  for (const b of buildings) addCol({ box: b }, b.x1, b.z1, b.x2, b.z2);
  for (const t of trees) { const r = 1.1 * t.s; addCol({ circ: t, r }, t.x - r, t.z - r, t.x + r, t.z + r); }
  for (const a of arenas) for (const sg of a.barriers) addCol({ seg: sg }, Math.min(sg[0], sg[2]), Math.min(sg[1], sg[3]), Math.max(sg[0], sg[2]), Math.max(sg[1], sg[3]));

  // 원형 몸체(x,z,r) 충돌 해결. vel = {x,z} 수정. 충격량 반환
  function collide(pos, r, vel) {
    let hit = 0;
    const seen = new Set();
    const cx = Math.floor(pos.x / CELL), cz = Math.floor(pos.z / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const arr = colGrid.get(cellKey(cx + i, cz + j));
      if (!arr) continue;
      for (const o of arr) {
        if (seen.has(o)) continue; seen.add(o);
        let nx, nz, pen;
        if (o.box) {
          const b = o.box;
          const qx = Math.max(b.x1, Math.min(b.x2, pos.x)), qz = Math.max(b.z1, Math.min(b.z2, pos.z));
          let dx = pos.x - qx, dz = pos.z - qz, d = Math.hypot(dx, dz);
          if (d >= r) continue;
          if (d < 1e-4) { // 안에 파묻힘 → 가장 가까운 면으로
            const opts = [[pos.x - b.x1, -1, 0], [b.x2 - pos.x, 1, 0], [pos.z - b.z1, 0, -1], [b.z2 - pos.z, 0, 1]];
            opts.sort((a, c) => a[0] - c[0]);
            nx = opts[0][1]; nz = opts[0][2]; pen = opts[0][0] + r;
          } else { nx = dx / d; nz = dz / d; pen = r - d; }
        } else if (o.seg) {
          // 코스 벽: 항상 코스 안쪽으로 밀어냄 (빠르게 뚫고 나가도 되돌림)
          const [x1, z1, x2, z2, inx, inz] = o.seg;
          const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz;
          const tt = ((pos.x - x1) * dx + (pos.z - z1) * dz) / l2;
          if (tt < -0.05 || tt > 1.05) continue;
          const sd = (pos.x - x1) * inx + (pos.z - z1) * inz;
          if (sd >= r || sd < -4) continue;
          nx = inx; nz = inz; pen = r - sd;
        } else {
          const t = o.circ, rr = r + o.r;
          const dx = pos.x - t.x, dz = pos.z - t.z, d = Math.hypot(dx, dz);
          if (d >= rr || d < 1e-4) continue;
          nx = dx / d; nz = dz / d; pen = rr - d;
        }
        pos.x += nx * pen; pos.z += nz * pen;
        const vn = vel.x * nx + vel.z * nz;
        if (vn < 0) { vel.x -= vn * nx * 1.3; vel.z -= vn * nz * 1.3; hit = Math.max(hit, -vn); }
      }
    }
    // 월드 경계 (본 맵 안에서만)
    if (Math.abs(pos.x) > HALF + 200 || Math.abs(pos.z) > HALF + 200) return hit;
    const L = HALF - r;
    if (pos.x < -L) { pos.x = -L; if (vel.x < 0) { hit = Math.max(hit, -vel.x); vel.x *= -0.3; } }
    if (pos.x > L) { pos.x = L; if (vel.x > 0) { hit = Math.max(hit, vel.x); vel.x *= -0.3; } }
    if (pos.z < -L) { pos.z = -L; if (vel.z < 0) { hit = Math.max(hit, -vel.z); vel.z *= -0.3; } }
    if (pos.z > L) { pos.z = L; if (vel.z > 0) { hit = Math.max(hit, vel.z); vel.z *= -0.3; } }
    return hit;
  }

  /* ---------- 스폰 / 리스폰 ---------- */
  function spawnPoint(k) {
    return { x: -60 + (k % 2 ? 4 : -4), z: -40 + Math.floor(k / 2) * 10, yaw: 0 };
  }
  // 가장 가까운 도로/트랙 위 지점
  function respawnPoint(x, z) {
    const ar = arenaAt(x);
    if (ar) { const n = nearestOnTrack(ar, x, z, 2), p = ar.path[n.i], tg = ar.tan[n.i]; return { x: p[0], z: p[1], yaw: Math.atan2(tg[0], tg[1]) }; }
    let best = null, bd = Infinity;
    for (const s of roads) {
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1, l2 = dx * dx + dz * dz;
      let t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (z - s.z1) * dz) / l2));
      const px = s.x1 + dx * t, pz = s.z1 + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < bd) {
        bd = d;
        let yaw = Math.atan2(dx, dz);
        // 원래 진행 방향과 가까운 쪽으로
        best = { x: px, z: pz, yaw };
      }
    }
    for (const t of tracks) {
      const n = nearestOnTrack(t, x, z, 2);
      if (n.d < bd) { bd = n.d; const p = t.path[n.i], tg = t.tan[n.i]; best = { x: p[0], z: p[1], yaw: Math.atan2(tg[0], tg[1]) }; }
    }
    if (inPark(x, z)) best = { x, z, yaw: 0 };
    return best;
  }

  /* ---------- 코인 후보 위치 ---------- */
  const coins = []; // {id,x,y,z,big}
  {
    const C = rng(777);
    const add = (x, z, y, big) => {
      if (collidesStatic(x, z, 2)) return;
      coins.push({ id: coins.length, x, y: (y || 0) + groundHeight(x, z) + 1.3, z, big: !!big });
    };
    for (const c of tracks.filter(t => t.ribbon)) for (let i = 8; i < c.path.length; i += 9) {
      const p = c.path[i], tg = c.tan[i], off = (C() - 0.5) * c.w * 0.6;
      add(p[0] + tg[1] * off, p[1] - tg[0] * off);
    }
    for (const s of roads) {
      const L = Math.hypot(s.x2 - s.x1, s.z2 - s.z1), n = Math.floor(L / 42);
      for (let k = 1; k < n; k++) {
        const t = k / n, off = (C() - 0.5) * s.w * 0.5;
        const dx = (s.x2 - s.x1) / L, dz = (s.z2 - s.z1) / L;
        add(s.x1 + (s.x2 - s.x1) * t + dz * off, s.z1 + (s.z2 - s.z1) * t - dx * off);
      }
    }
    for (const l of lots) for (let k = 0; k < 4; k++) add(l.x1 + 8 + C() * (l.x2 - l.x1 - 16), l.z1 + 8 + C() * (l.z2 - l.z1 - 16));
    // 파크: 흙바닥 격자 + 점프 공중 코인
    for (let x = PARK.x1 + 30; x < PARK.x2 - 20; x += 55)
      for (let z = PARK.z1 + 30; z < PARK.z2 - 20; z += 55) if (C() < 0.6) add(x + C() * 10, z + C() * 10);
    add(-320, -226, 5, true);
    for (const x of [-436, -428, -420]) add(x, -260, 10, true);
    add(-300, -420, 0, true);
    for (const z of [-430, -410, -390, -370]) add(-480, z, 13, true);
    add(-230, -186, 4, true);
    // 들판 곳곳 숨은 코인
    for (let k = 0; k < 60; k++) {
      const x = -INNER + 30 + C() * (INNER * 2 - 60), z = -INNER + 30 + C() * (INNER * 2 - 60);
      if (inCity(x, z) || inPark(x, z)) continue;
      add(x, z, 0, C() < 0.25);
    }
    // 바깥 지역 들판·산기슭 숨은 코인
    for (let k = 0; k < 90; k++) {
      const x = -HALF + 30 + C() * (HALF * 2 - 60), z = -HALF + 30 + C() * (HALF * 2 - 60);
      if (Math.max(Math.abs(x), Math.abs(z)) < INNER + 20 || x < SEA_X) continue;
      add(x, z, 0, C() < 0.3);
    }
  }
  function collidesStatic(x, z, r) {
    const p = { x, z }, v = { x: 0, z: 0 };
    collide(p, r, v);
    return Math.abs(p.x - x) > 0.01 || Math.abs(p.z - z) > 0.01;
  }

  /* ---------- 자동차 ---------- */
  // maxV m/s, acc m/s², turn rad/s, grip, off: 비포장 페널티 무시, mass: 범퍼카 충돌 무게
  const CARS = [
    { id: 'hatch', name: '대우 티코', price: 0, maxV: 34, acc: 12, turn: 2.4, grip: 7, off: false, mass: 0.8, desc: '작고 귀여운 국민 경차. 첫 차!' },
    { id: 'damas', name: '대우 다마스', price: 100, maxV: 32, acc: 11, turn: 2.3, grip: 6.5, off: false, mass: 1.0, desc: '짐도 싣고 사람도 싣는 미니밴.' },
    { id: 'porter', name: '현대 포터', price: 200, maxV: 34, acc: 11, turn: 2.0, grip: 6.5, off: true, mass: 1.8, desc: '대한민국 1톤 트럭. 흙길도 문제없다.' },
    { id: 'beetle', name: '폭스바겐 비틀', price: 400, maxV: 38, acc: 14, turn: 2.4, grip: 7, off: false, mass: 1.0, desc: '동글동글 딱정벌레 클래식.' },
    { id: 'avante', name: '현대 아반떼', price: 500, maxV: 44, acc: 15, turn: 2.3, grip: 7.5, off: false, mass: 1.3, desc: '무난하고 빠른 준중형 세단.' },
    { id: 'truck', name: '포드 F-150', price: 600, maxV: 42, acc: 14, turn: 1.9, grip: 6.5, off: true, mass: 2.2, desc: '묵직한 픽업. 부딪히면 상대가 날아간다.' },
    { id: 'mini', name: '미니 쿠퍼', price: 700, maxV: 42, acc: 16, turn: 2.8, grip: 8, off: false, mass: 0.9, desc: '고카트 같은 핸들링.' },
    { id: 'coupe', name: '토요타 AE86', price: 1000, maxV: 46, acc: 17, turn: 2.6, grip: 5.4, off: false, mass: 1.0, desc: '드리프트의 전설.' },
    { id: 'buggy', name: '지프 랭글러', price: 1200, maxV: 42, acc: 17, turn: 2.3, grip: 6, off: true, mass: 1.9, desc: '점프와 비포장에 강한 오프로더.' },
    { id: 'bus', name: '시내버스', price: 1500, maxV: 32, acc: 9, turn: 1.5, grip: 7, off: true, mass: 4.5, desc: '느리지만 범퍼카 최강자.' },
    { id: 'tesla', name: '테슬라 모델 3', price: 1800, maxV: 50, acc: 24, turn: 2.4, grip: 8, off: false, mass: 1.5, desc: '전기차 특유의 순간 가속.' },
    { id: 'muscle', name: '포드 머스탱', price: 2000, maxV: 54, acc: 20, turn: 2.1, grip: 5.2, off: false, mass: 1.5, desc: '드리프트가 잘 되는 머슬카.' },
    { id: 'gwagon', name: '벤츠 G클래스', price: 2500, maxV: 48, acc: 17, turn: 2.0, grip: 7, off: true, mass: 2.4, desc: '각진 럭셔리 오프로더.' },
    { id: 'porsche', name: '포르쉐 911', price: 3000, maxV: 57, acc: 23, turn: 2.5, grip: 8.5, off: false, mass: 1.3, desc: '균형 잡힌 스포츠카의 기준.' },
    { id: 'gtr', name: '닛산 GT-R', price: 3500, maxV: 58, acc: 25, turn: 2.4, grip: 9, off: false, mass: 1.6, desc: '고질라. 코너에서도 흔들림 없다.' },
    { id: 'super', name: '람보르기니 우라칸', price: 4500, maxV: 62, acc: 26, turn: 2.5, grip: 8.5, off: false, mass: 1.4, desc: '날렵한 쐐기형 슈퍼카.' },
    { id: 'f40', name: '페라리 F40', price: 5500, maxV: 64, acc: 26, turn: 2.5, grip: 6.5, off: false, mass: 1.2, desc: '거대한 날개의 전설. 꽁무니가 잘 빠진다.' },
    { id: 'formula', name: 'F1 머신', price: 7000, maxV: 68, acc: 30, turn: 2.8, grip: 10, off: false, mass: 0.8, desc: '서킷의 왕. 잔디에선 약하다.' },
    { id: 'chiron', name: '부가티 시론', price: 9999, maxV: 74, acc: 28, turn: 2.4, grip: 9, off: false, mass: 1.8, desc: '최고 속도 266km/h 하이퍼카.' },
  ];
  const carById = {};
  for (const c of CARS) carById[c.id] = c;
  const COLORS = [0xd83a3a, 0x3a6fd8, 0xf2c230, 0x3aa64a, 0xf2f2f2, 0x2a2a2e, 0xe0782a, 0x9a4ad8, 0x38c8c8, 0xf27aa8];

  const W = {
    HALF, INNER, SEA_X, CITY, PARK, roads, ramps, platforms, boosts, tracks, trackById, buildings, trees, cityParks, lots, coins, lamps, canopies, pads, arenas, arenaAt,
    CARS, carById, COLORS,
    groundHeight, surfaceAt, boostAt, collide, nearestOnTrack, gridSlot, spawnPoint, respawnPoint, inPark, inCity, rng,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = W;
  else root.WORLD = W;
})(this);
