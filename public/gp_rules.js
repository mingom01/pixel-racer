// 레이싱 방 (그랑프리) 규칙: 대기실 → (예선) → 결승 → 결과/포인트 → 대기실
// 서버(server.js)와 오프라인 혼자 하기(local.js)가 같이 쓴다.
(function (root) {
const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]; // F1 포인트
const QUALI_ENV = (typeof process !== 'undefined' && +process.env.GP_QUALI_MS) || 0;
// 예선 시간: 코스가 길수록 길게 (대략 두 바퀴 이상 돌 수 있게)
function qualiMs(t) { return QUALI_ENV || Math.round(Math.max(75000, Math.min(240000, t.length / 40 * 1000 * 1.9 + 15000)) / 1000) * 1000; }

function makeGP({ W, broadcast, save, profileOf, log, records }) {
  const ARENA_IDS = W.arenas.map(a => a.id);
  // 랜덤 선택지: random 전체, random:easy 난이도 1~2, random:mid 3, random:hard 4~5
  const RANDOM = { random: [1, 5], 'random:easy': [1, 2], 'random:mid': [3, 3], 'random:hard': [4, 5] };
  const pickTrack = set => {
    const rg = RANDOM[set.track];
    if (!rg) return set.track;
    const ids = W.arenas.filter(a => a.diff >= rg[0] && a.diff <= rg[1]).map(a => a.id);
    return ids[Math.floor(Math.random() * ids.length)] || ARENA_IDS[0];
  };
  // 트랙 기록 { 코스 id: { time, name, car, at } } (서버가 계정 저장소에 같이 저장)
  const RAW = () => (records ? records() : null) || {};
  // 코스 모양이 바뀌면(길이가 달라지면) 예전 기록은 무효
  const lenOf = id => Math.round((W.trackById[id] || {}).length || 0);
  const REC = () => { const R = RAW(); for (const k in R) { const v = R[k]; if (!v || (v.len ? v.len !== lenOf(k) : (W.trackById[k] && W.trackById[k].alts.length))) delete R[k]; } return R; };
  const recView = () => { const o = {}, R = REC(); for (const k in R) o[k] = { time: R[k].time, name: R[k].name, car: R[k].car }; return o; };
  let objSeq = 0;

  /* ---------- AI 봇: 서버(또는 혼자 하기)에서 코스를 따라 달리는 운전 ----------
     사람 차와 같은 물리 한계(조향으로 돌 수 있는 커브 속도, 가속, 진흙, 부스터 발판)를 쓰고
     지름길, 니트로(드리프트 게이지), 레이싱 라인(커브 안쪽)도 쓴다. */
  const BOT_LV = {
    // corner: 커브 한계, top: 최고속, alt: 지름길 탈 확률, pad: 발판/출발 부스터, nitro: 니트로 충전, miss: 실수, cars: 사람 평균 속도 기준 차 범위
    easy: { name: '쉬움', corner: 0.76, top: 0.93, acc: 0.8, brake: 26, alt: 0.25, pad: 0.35, nitro: 0.35, miss: 0.035, cars: [-8, 0] },
    normal: { name: '보통', corner: 0.95, top: 1.0, acc: 1.0, brake: 30, alt: 0.65, pad: 0.75, nitro: 0.75, miss: 0.012, cars: [-4, 3] },
    hard: { name: '어려움', corner: 1.06, top: 1.02, acc: 1.08, brake: 34, alt: 1, pad: 0.97, nitro: 1.05, miss: 0, cars: [-1, 5] },
  };
  const BOT_NAMES = ['번개', '질주', '드리프트', '터보', '로켓', '바람', '혜성', '천둥', '스피드', '불꽃', '카이', '썬더', '레오', '제트'];
  const isBot = id => typeof id === 'string' && id.startsWith('bot');
  // 사람 플레이어 조향으로 낼 수 있는 커브 속도 (game.js: 회전 = turn * (1 - 0.42 v/maxV))
  const cornerV = (car, r) => { const a = r * car.turn; return a / (1 + 0.42 * a / car.maxV); };
  // 점별 회전 반지름 / 커브 방향
  function curveInfo(path, tan, open) {
    const n = path.length, R = new Array(n), side = new Array(n);
    const at = i => (open ? Math.max(0, Math.min(n - 1, i)) : ((i % n) + n) % n);
    for (let i = 0; i < n; i++) {
      const a = tan[at(i - 3)], b = tan[at(i + 3)], pa = path[at(i - 3)], pb = path[at(i + 3)];
      const ang = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])));
      R[i] = Math.min(2000, Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / Math.max(ang, 1e-4));
      side[i] = Math.sign(a[0] * b[1] - a[1] * b[0]);
    }
    return { R, side };
  }
  // 코스별 봇 정보 (한 번만 계산): 커브, 레이싱 라인, 부스터 발판, 지름길
  function botInfoOf(t) {
    if (t._bot) return t._bot;
    const n = t.path.length, ci = curveInfo(t.path, t.tan, false);
    const hwAt = i => (t.hw ? t.hw[i] : t.w / 2);
    // 레이싱 라인: 커브 안쪽으로 (부드럽게), 직선에선 가운데 근처
    let line = new Array(n).fill(0);
    for (let i = 0; i < n; i++) line[i] = ci.R[i] < 260 ? -ci.side[i] * Math.min(0.7, 60 / ci.R[i]) : 0;
    for (let pass = 0; pass < 4; pass++) { const nl = line.slice(); for (let i = 0; i < n; i++) nl[i] = (line[(i - 2 + n) % n] + line[(i - 1 + n) % n] + line[i] * 2 + line[(i + 1) % n] + line[(i + 2) % n]) / 6; line = nl; }
    // 본길 부스터 발판: 어느 쪽(옆 위치)으로 가면 밟는지
    const pads = new Map();
    for (let i = 0; i < n; i++) {
      const p = t.path[i], tg = t.tan[i], hw = hwAt(i);
      for (const f of [0, -0.3, 0.3, -0.6, 0.6]) {
        const b = W.boostAt(p[0] + tg[1] * f * hw, p[1] - tg[0] * f * hw, t.ey[i]);
        if (b && b.fx * tg[0] + b.fz * tg[1] > 0.5) { pads.set(i, f); break; }
      }
    }
    const alts = (t.alts || []).map(al => {
      const m = al.path.length, aci = curveInfo(al.path, al.tan, true), mud = new Array(m).fill(false), boost = new Array(m).fill(false);
      for (let j = 0; j < m; j++) {
        mud[j] = !!(al.patch && al.patch[j] === 'mud');
        boost[j] = !!W.boostAt(al.path[j][0], al.path[j][1], al.ey[j]);
      }
      const mainLen = ((al.to - al.from + n) % n) * (t.length / n);
      return { al, R: aci.R, mud, boost, mainLen, step: al.length / Math.max(1, m - 1) };
    });
    const altAt = new Map();
    alts.forEach((a, k) => altAt.set(a.al.from, k));
    return (t._bot = { R: ci.R, line, pads, alts, altAt });
  }
  // 이 코스에서 차마다 한 바퀴 시간 (보통 실력 봇 기준, 코스별로 한 번만 계산)
  function carLap(t, id) {
    const c = (t._carLap = t._carLap || {});
    if (c[id] == null) c[id] = botLapTest(t.id, id, 'normal', true);
    return c[id];
  }
  // 봇 차: 같은 방 사람들 차와 이 코스에서 랩타임이 비슷한 차로, 서로 다른 차로
  function makeBots(g, humanCars, track) {
    const lv = BOT_LV[g.set.botLv] || BOT_LV.normal, cnt = Math.max(0, Math.min(7, g.set.bots | 0));
    if (!cnt) { g.bots = []; return; }
    const t = W.trackById[track] || W.arenas[0];
    const ok = c => c.mass < 3 && c.turn >= 1.7;
    const cands = W.CARS.filter(ok);
    const hl = (humanCars.length ? humanCars : ['avante']).map(id => carLap(t, W.carById[id] ? id : 'avante')).sort((a, b) => a - b);
    const target = hl[Math.floor(hl.length / 2)];
    // 사람 차 랩타임 대비 범위 (어려움은 같거나 조금 빠른 차, 쉬움은 조금 느린 차)
    const rng = { easy: [1.0, 1.05], normal: [0.985, 1.025], hard: [0.965, 1.01] }[g.set.botLv] || [0.985, 1.025];
    // 범위 안의 차 전부, 모자라면 범위에 가장 가까운 차부터
    const mid = (rng[0] + rng[1]) / 2, dist = c => { const r = carLap(t, c.id) / target; return r < rng[0] ? rng[0] - r : (r > rng[1] ? r - rng[1] : 0); };
    const sorted = cands.map(c => [c, dist(c), Math.abs(carLap(t, c.id) / target - mid)]).sort((x, y) => x[1] - y[1] || x[2] - y[2]);
    const inside = sorted.filter(x => x[1] === 0).length;
    let pool = sorted.slice(0, Math.max(cnt, inside)).map(x => x[0]).sort(() => Math.random() - 0.5);
    // 종류(일반/스포츠/슈퍼...)가 골고루 섞이게
    const byCls = {};
    for (const c of pool) (byCls[c.cls] = byCls[c.cls] || []).push(c);
    const picks = [], keys = Object.keys(byCls);
    for (let k = 0; picks.length < cnt && k < 200; k++) { const arr = byCls[keys[k % keys.length]]; if (arr.length) picks.push(arr.shift()); }
    while (picks.length < cnt) picks.push(pool[picks.length % pool.length]);
    const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    const cols = [...Array(W.COLORS.length).keys()].sort(() => Math.random() - 0.5);
    g.bots = [];
    for (let k = 0; k < cnt; k++) {
      // 같은 난이도라도 봇마다 실력이 조금씩 다르게
      const skill = 1 + (Math.random() - 0.5) * 0.025;
      // 맞는 차가 모자라 범위 밖 차를 탔으면 그만큼 실력으로 보정 (사람 차와 비슷한 속도가 되게)
      const want = target * mid, perf = Math.max(0.93, Math.min(1.08, carLap(t, picks[k].id) / want));
      g.bots.push({ id: 'bot' + (k + 1), name: '봇 ' + names[k % names.length], car: picks[k].id, color: cols[k % cols.length], lv: g.set.botLv || 'normal', skill: skill * (Math.abs(perf - 1) > 0.02 ? perf : 1) });
    }
  }
  const botInfo = b => ({ id: b.id, name: b.name, car: b.car, color: b.color, ver: '' });
  function showBots(r) { for (const b of r.gp.bots || []) broadcast(r, { t: 'pu', p: botInfo(b) }); }
  function hideBots(r) { for (const b of r.gp.bots || []) broadcast(r, { t: 'pl', id: b.id }); r.gp.bots = []; }

  // 봇 한 대 진행 (dt 초). 사람과 같은 '본길 기준 진행 거리' p.s 로 바퀴/순위를 센다.
  // ahead: 가장 앞선 사람이 이 봇보다 얼마나 앞에 있는지 (m)
  function botMove(p, b, t, BI, dt, now, ahead) {
    const lv = BOT_LV[b.lv] || BOT_LV.normal, car = W.carById[b.car] || W.CARS[0];
    const n = t.path.length, L = t.length, step = L / n;
    const ice = t.theme === 'snow' ? 0.82 : 1;
    const ck = lv.corner * (b.skill || 1) * ice;
    // 사람보다 너무 뒤처지면 조금 힘을 내고, 너무 앞서면 살짝 늦춤
    const band = ahead > 150 ? 1.03 : (ahead < -300 ? 0.97 : 1);
    const top = car.maxV * lv.top * (b.skill || 1) * band;
    p.boostT = Math.max(0, (p.boostT || 0) - dt);
    let want = top, mud = false, curR;
    if (p.alt != null) {
      const A = BI.alts[p.alt], m = A.al.path.length, j = Math.min(m - 1, Math.floor(p.u / A.step));
      mud = A.mud[j];
      for (let k = 0; k < 20; k++) {
        const jj = Math.min(m - 1, j + k), vc = cornerV(car, A.R[jj]) * ck;
        want = Math.min(want, Math.sqrt(vc * vc + 2 * lv.brake * k * A.step));
      }
      if (A.boost[j] && p.lastPad !== 'a' + j) { p.lastPad = 'a' + j; p.v = Math.max(p.v, car.maxV * 1.35); p.boostT = 1.4; }
      curR = A.R[j];
    } else {
      const sm = ((p.s % L) + L) % L, i = Math.floor(sm / step) % n;
      for (let k = 0; k < 30; k++) {
        const j = (i + k) % n, vc = cornerV(car, BI.R[j]) * ck;
        want = Math.min(want, Math.sqrt(vc * vc + 2 * lv.brake * k * step));
      }
      curR = BI.R[i];
      // 부스터 발판: 앞에 있으면 그쪽으로 붙어서 밟기
      if (p.padI !== i) {
        p.padI = i;
        if (p.padFor === i) { if (p.padGo) { p.v = Math.max(p.v, car.maxV * 1.35); p.boostT = 1.4; } p.padFor = -1; p.padLane = null; }
        for (let k = 1; k < 10; k++) {
          const j = (i + k) % n;
          if (BI.pads.has(j)) { if (p.padFor !== j) { p.padFor = j; p.padGo = b.plain || Math.random() < lv.pad; } p.padLane = p.padGo ? BI.pads.get(j) : null; break; }
        }
      }
    }
    // 니트로: 커브를 빠르게 돌면(드리프트) 게이지가 차고, 직선에서 씀
    if (!b.noNitro && curR < 120 && p.v > 14) p.gauge = (p.gauge || 0) + dt * 30 * lv.nitro * Math.min(1.5, 60 / curR);
    if ((p.gauge || 0) >= 100 && curR > 250 && !mud && p.boostT <= 0 && now > (p.stunUntil || 0)) { p.gauge = 0; p.v = Math.max(p.v, car.maxV * 1.35); p.boostT = 1.8; }
    // 실수: 가끔 커브에서 미끄러져 속도를 잃음
    if (lv.miss && !b.plain && curR < 150 && Math.random() < lv.miss * dt * 10) p.v *= 0.75;
    if (mud) want = Math.min(want, car.maxV * 0.5);
    if (now < (p.stunUntil || 0)) want = Math.min(want, car.maxV * 0.15);
    if (now < (p.slowUntil || 0)) want = Math.min(want, car.maxV * 0.55);
    if (p.boostT > 0 && !mud && now >= (p.stunUntil || 0)) want = Math.max(want, Math.min(p.v, car.maxV * 1.35));
    const accel = car.acc * lv.acc * Math.max(0.15, 1 - (p.v / Math.max(1, top)) ** 2);
    if (p.v < want) p.v = Math.min(want, p.v + accel * dt);
    else p.v = Math.max(want, p.v - (p.boostT > 0 ? 6 : lv.brake) * dt);
    const ds = p.v * dt;
    if (p.alt != null) {
      const A = BI.alts[p.alt];
      p.u += ds;
      p.s += ds * A.mainLen / A.al.length;
      if (p.u >= A.al.length) { p.s = p.altBase + A.mainLen; p.alt = null; p.padI = -1; }
    } else {
      const i0 = Math.floor((((p.s % L) + L) % L) / step) % n;
      p.s += ds;
      const i1 = Math.floor((((p.s % L) + L) % L) / step) % n;
      // 지름길 입구를 지나면: 난이도만큼 확률로 지름길로
      if (p.s > 0 && i0 !== i1) for (let i = (i0 + 1) % n, c = 0; c < 40; i = (i + 1) % n, c++) {
        const k = BI.altAt.get(i);
        if (k != null && !b.plain && Math.random() < lv.alt * (b.skill || 1)) {
          const sm = ((p.s % L) + L) % L, base = p.s - sm + i * step + (i * step > sm + L / 2 ? -L : 0);
          p.alt = k; p.u = Math.max(0, p.s - base); p.altBase = base; p.padLane = null; p.padFor = -1;
          break;
        }
        if (i === i1) break;
      }
    }
  }
  // 화면용 위치 (본길: 레이싱 라인, 지름길: 지름길 길 위)
  function botPose(p, t, BI, now) {
    const n = t.path.length, L = t.length, step = L / n;
    let a0, a1, tg, hw, y0, y1, u, lane, gap = false;
    if (p.alt != null) {
      const A = BI.alts[p.alt], al = A.al, m = al.path.length, f = Math.max(0, Math.min(m - 1.001, p.u / A.step)), j = Math.floor(f);
      a0 = al.path[j]; a1 = al.path[j + 1]; tg = al.tan[j]; hw = al.hw[j]; y0 = al.ey[j]; y1 = al.ey[j + 1]; u = f - j;
      lane = p.lane * 0.4;
    } else {
      const sm = ((p.s % L) + L) % L, f = sm / step, i0 = Math.floor(f) % n, i1 = (i0 + 1) % n;
      a0 = t.path[i0]; a1 = t.path[i1]; tg = t.tan[i0]; hw = t.hw ? t.hw[i0] : t.w / 2; y0 = t.ey[i0]; y1 = t.ey[i1]; u = f - Math.floor(f);
      gap = !!(t.gap && t.gap[i0]);
      // 출발 직후엔 자기 줄, 이후엔 레이싱 라인 + 봇마다 조금씩 다른 위치(겹치지 않게)
      const race = Math.min(1, Math.max(0, p.s / 150));
      const target = p.padLane != null ? p.padLane : BI.line[i0] + p.lane * 0.3;
      lane = p.lane * (1 - race) + target * race;
    }
    p.offL = p.offL == null ? lane : p.offL + (lane - p.offL) * 0.2;
    // 부딪혀서 옆으로 밀린 만큼 (m), 길 끝(벽)에 닿으면 멈춤
    let off = (p.offL + Math.sin(now / 2300 + p.wob) * 0.04) * hw + (p.pushOff || 0);
    if (Math.abs(off) > hw * 0.9) { off = Math.sign(off) * hw * 0.9; p.pushOff = off - p.offL * hw; p.pushV = 0; }
    const x = a0[0] + (a1[0] - a0[0]) * u + tg[1] * off, z = a0[1] + (a1[1] - a0[1]) * u - tg[0] * off;
    let y = y0 + (y1 - y0) * u;
    if (gap) y += 3; // 끊어진 다리는 붕 날아서
    p.tg = tg;
    p.pos = { x, y, z };
    return { x, y, z, yaw: Math.atan2(tg[0], tg[1]) + (p.yawOff || 0) };
  }
  /* ---------- 봇 아이템 (아이템전) ---------- */
  // 봇이 공격을 맞음 (실드/천사면 막음)
  function botHit(p, kind, now) {
    if (now < (p.shieldUntil || 0)) { if (!p.angel) p.shieldUntil = 0; return false; }
    if (kind === 'zap') { p.slowUntil = now + 2800; return true; }
    const st = { banana: 900, water: 1800, ice: 1700, missile: 1700, ufo: 3200 }[kind] || 1000;
    p.stunUntil = now + st; p.v *= kind === 'banana' ? 0.45 : 0.2;
    if (kind === 'banana' || kind === 'missile') p.spinV = (Math.random() < 0.5 ? -1 : 1) * 9;
    return true;
  }
  const progOf = (t, id, p) => (p.done ? 1e9 : (isBot(id) ? p.s : ((p.c || 0) - 1) * (t.length / t.cps.length)));
  const orderOf = (run, t) => [...run.racers.entries()].map(([id, q]) => [id, progOf(t, id, q), q.done]).sort((a, c) => c[1] - a[1]);
  function botRoll(f) {
    const tbl = f < 0.34 ? { banana: 28, water: 16, shield: 14, boost: 12, ice: 16, angel: 10, ink: 4 }
      : f < 0.67 ? { boost: 18, banana: 10, water: 12, missile: 14, shield: 8, magnet: 8, ice: 10, ink: 10, devil: 6, angel: 4 }
        : { boost: 22, missile: 18, magnet: 14, ufo: 12, zap: 10, ink: 10, devil: 8, water: 6 };
    let sum = 0; for (const k in tbl) sum += tbl[k];
    let x = Math.random() * sum;
    for (const k in tbl) { x -= tbl[k]; if (x <= 0) return k; }
    return 'boost';
  }
  function botItems(r, run, t, p, b, now) {
    const n = t.path.length, step = t.length / n, idx = Math.floor((((p.s % t.length) + t.length) % t.length) / step) % n;
    p.items = p.items || [];
    // 아이템 박스 줄을 지나가면 하나 줍기 (본길만)
    if (p.alt == null && p.lastIdx != null && idx !== p.lastIdx && t.itemRows) {
      for (const row of t.itemRows) {
        const passed = p.lastIdx < idx ? (row > p.lastIdx && row <= idx) : (row > p.lastIdx || row <= idx);
        if (passed && p.items.length < 2 && Math.random() < 0.85) {
          const order = orderOf(run, t).map(e => e[0]), rk = order.indexOf(b.id), f = order.length > 1 ? rk / (order.length - 1) : 0.5;
          let it = botRoll(f);
          if (rk === 0 && it === 'ufo') it = 'boost';
          p.items.push(it);
          if (!p.useAt || p.useAt < now) p.useAt = now + 800 + Math.random() * 3200;
        }
      }
    }
    p.lastIdx = idx;
    if (!p.items.length || now < (p.useAt || 0) || now < (p.stunUntil || 0) || !p.pos || !p.tg) return;
    const it = p.items.shift();
    p.useAt = p.items.length ? now + 1500 + Math.random() * 3000 : 0;
    const car = W.carById[b.car] || W.CARS[0], { x, y, z } = p.pos, tg = p.tg;
    const r2 = v => Math.round(v * 100) / 100;
    const selfBoost = () => { p.v = Math.max(p.v, car.maxV * 1.35); p.boostT = 1.6; };
    if (it === 'boost' || it === 'magnet') { selfBoost(); return; }
    if (it === 'shield' || it === 'angel') { p.shieldUntil = now + 6000; p.angel = it === 'angel'; return; }
    if (it === 'banana' || it === 'water' || it === 'ice') {
      let o;
      if (it === 'banana') { const bx = x - tg[0] * 4, bz = z - tg[1] * 4; o = { x: bx, z: bz, y, x2: bx, z2: bz, y2: y }; }
      else { const d = 30 + p.v * 0.4, x2 = x + tg[0] * d, z2 = z + tg[1] * d; o = { x, z, y, x2, z2, y2: W.groundHeight(x2, z2, y + 3) }; }
      const m = { t: 'gi', k: 'obj', id: ++objSeq, kind: it, by: b.id, x: r2(o.x), z: r2(o.z), y: r2(o.y), x2: r2(o.x2), z2: r2(o.z2), y2: r2(o.y2) };
      broadcast(r, m);
      (run.objs = run.objs || []).push({ ...m, t0: now, hit: new Set() });
      return;
    }
    // 앞 차에 미사일 / 1등에게 UFO
    const order = orderOf(run, t).filter(e => !e[2]).map(e => e[0]), rk = order.indexOf(b.id);
    if (it === 'missile' || it === 'ufo') {
      const to = it === 'ufo' ? order[0] : order[rk - 1];
      if (!to || to === b.id) { selfBoost(); return; }
      broadcast(r, { t: 'gi', k: it, from: b.id, to });
      const q = run.racers.get(to);
      if (q && isBot(to)) botHit(q, it, now + (it === 'ufo' ? 1500 : 700));
      return;
    }
    if (it === 'zap' || it === 'ink' || it === 'devil') {
      broadcast(r, { t: 'gi', k: it, from: b.id });
      if (it === 'zap') for (const [id, q] of run.racers) if (isBot(id) && id !== b.id) botHit(q, 'zap', now);
    }
  }
  // 바닥의 바나나 / 물폭탄 / 얼음 에 봇이 닿으면
  function botObjHits(r, run, p, b, now) {
    if (!p.pos) return;
    for (let i = run.objs.length - 1; i >= 0; i--) {
      const o = run.objs[i], age = (now - o.t0) / 1000;
      if (o.kind === 'banana') {
        if (age > 60) { run.objs.splice(i, 1); continue; }
        if (age > 0.4 && Math.hypot(p.pos.x - o.x, p.pos.z - o.z) < 2.4 && Math.abs(p.pos.y - o.y) < 2.5) {
          botHit(p, 'banana', now); run.objs.splice(i, 1); broadcast(r, { t: 'gi', k: 'rm', id: o.id, by: b.id });
        }
      } else {
        if (age > 0.7 + (o.kind === 'ice' ? 5 : 3.5)) { run.objs.splice(i, 1); continue; }
        if (age > 0.7 && o.by !== b.id && !o.hit.has(b.id) && Math.hypot(p.pos.x - o.x2, p.pos.z - o.z2) < 5.2 && Math.abs(p.pos.y - o.y2) < 4) { o.hit.add(b.id); botHit(p, o.kind, now); }
      }
    }
  }
  function botStep(r, now) {
    const g = r.gp, run = g.run;
    if (!run || !g.bots || !g.bots.length) return;
    const t = W.trackById[run.track];
    if (!t) return;
    const n = t.path.length, L = t.length, ncp = t.cps.length, step = L / n, BI = botInfoOf(t);
    const dt = Math.min(0.2, Math.max(0, (now - (run.botT || now)) / 1000));
    run.botT = now;
    // 사람 중 가장 앞선 진행 거리 (따라잡기 기준)
    let lead = null;
    for (const [id, p] of run.racers) if (!isBot(id) && !p.done) lead = Math.max(lead ?? -1e9, ((p.c || 0) - 1) * (L / ncp));
    const ps = {};
    for (const b of g.bots) {
      const p = run.racers.get(b.id);
      if (!p) continue;
      if (p.s === undefined) { p.s = -(9 + p.slot * 5.5); p.v = 0; p.lane = [0.6, -0.6, 0][p.slot % 3]; p.wob = Math.random() * 6; p.alt = null; }
      if (now >= run.startAt && !p.done) {
        // 출발 부스터: 난이도가 높을수록 잘 맞춤
        if (!p.started) { p.started = true; const lv = BOT_LV[b.lv] || BOT_LV.normal; if (Math.random() < lv.pad) { p.v = (W.carById[b.car] || W.CARS[0]).maxV * 0.55; p.boostT = 1; } }
        botMove(p, b, t, BI, dt, now, lead == null ? 0 : lead - p.s);
        b.noNitro = run.mode === 'item';
        if (run.mode === 'item') botItems(r, run, t, p, b, now);
        // 바퀴 / 체크포인트 (사람과 같은 규칙: 출발선 통과 = 1)
        const lapNo = Math.floor(p.s / L);
        if (p.s >= 0) {
          const inLap = p.s - lapNo * L;
          let k2 = 0; while (k2 + 1 < ncp && t.cps[k2 + 1] * step <= inLap) k2++;
          const c = 1 + lapNo * ncp + k2;
          if (p.c < c) {
            if (lapNo > (p.lapNo ?? 0)) { const lt = now - (p.lapStart || run.startAt); p.laps.push(lt); if (!p.best || lt < p.best) p.best = lt; p.lapStart = now; }
            p.lapNo = lapNo; p.c = c;
            if (!p.lapStart) p.lapStart = run.startAt;
          }
          if (run.phase === 'race' && p.s >= run.laps * L) {
            p.done = true;
            const place = run.finished.length + 1, time = now - run.startAt;
            run.finished.push({ id: b.id, name: b.name, time, place, best: p.best });
            if (!run.firstFin) { run.firstFin = now; run.endAt = now + 10000; }
            broadcast(r, { t: 'gpFin', id: b.id, name: b.name, place, time, endIn: run.endAt - now });
          }
        }
      }
      // 부딪힌 뒤 옆 밀림/회전이 서서히 풀림
      p.pushOff = ((p.pushOff || 0) + (p.pushV || 0) * dt) * Math.exp(-0.6 * dt);
      p.pushV = (p.pushV || 0) * Math.exp(-2.5 * dt);
      p.yawOff = ((p.yawOff || 0) + (p.spinV || 0) * dt) * Math.exp(-2.5 * dt);
      p.spinV = (p.spinV || 0) * Math.exp(-3 * dt);
      const q = botPose(p, t, BI, now);
      if (run.objs && run.objs.length) botObjHits(r, run, p, b, now);
      const segN = p.c > 0 ? (p.s - Math.floor(p.s / L) * L) : 0;
      const prog = p.done ? run.laps * ncp + 1 : (p.c || 0) + Math.min(0.99, (segN % (L / ncp)) / (L / ncp));
      const r2 = v => Math.round(v * 100) / 100;
      ps[b.id] = [r2(q.x), r2(q.y), r2(q.z), r2(q.yaw), 0, 0, r2(p.v), 0, 0, r2(prog), r2(Math.sin(q.yaw) * p.v), r2(Math.cos(q.yaw) * p.v)];
    }
    broadcast(r, { t: 'st', ps });
  }
  // 테스트용: 봇 한 대가 한 바퀴 도는 시간 (초)
  function botLapTest(track, carId, lvName, plain) {
    const t = W.trackById[track], BI = botInfoOf(t), L = t.length;
    const b = { car: carId, lv: lvName, skill: 1, plain }, p = { s: 0, v: W.carById[carId].maxV * 0.8, lane: 0, alt: null, laps: [] };
    let time = 0, now = 0;
    const dt = 0.05;
    while (p.s < L && time < 600) { botMove(p, b, t, BI, dt, now, 0); time += dt; now += 50; }
    return time;
  }

  function init(r) {
    r.kind = 'gp';
    r.gp = {
      phase: 'lobby', races: 0, run: null, phaseEnd: 0, qres: null,
      set: { track: ARENA_IDS[0], mode: 'speed', team: false, laps: 3, quali: false, bots: 0, botLv: 'normal' },
      bots: [],
      pl: new Map(), // id → { ready, team, pts, wins, spec }
    };
  }
  function autoTeam(r) {
    let red = 0, blue = 0;
    for (const p of r.gp.pl.values()) p.team === 'red' ? red++ : blue++;
    return red <= blue ? 'red' : 'blue';
  }
  function state(r) {
    const g = r.gp;
    return {
      phase: g.phase, set: g.set, host: r.hostId, races: g.races, cur: g.curTrack || null, records: recView(),
      players: [...r.clients.values()].filter(c => g.pl.has(c.id)).map(c => {
        const p = g.pl.get(c.id), u = c.user;
        return { id: c.id, name: u.name, car: u.car, color: u.color, ready: p.ready, team: p.team, pts: p.pts, wins: p.wins, spec: p.spec };
      }),
    };
  }
  function push(r) { broadcast(r, { t: 'gpRoom', room: state(r) }); }
  function runInfo(r, now) {
    const run = r.gp.run;
    return {
      phase: run.phase, track: run.track, laps: run.laps, mode: run.mode, team: run.team,
      startIn: run.startAt - now, endIn: run.endAt ? run.endAt - now : null,
      grid: Object.fromEntries([...run.racers.entries()].map(([id, p]) => [id, p.slot])),
      finished: run.finished, fastest: run.fastest,
    };
  }

  function join(r, c) {
    r.gp.pl.set(c.id, { ready: false, team: autoTeam(r), pts: 0, wins: 0, spec: r.gp.phase !== 'lobby' });
    push(r);
    for (const b of r.gp.bots || []) c.send({ t: 'pu', p: botInfo(b) });
    if (r.gp.run) c.send({ t: 'gpRun', run: runInfo(r, Date.now()), late: true });
  }
  function leave(r, c) {
    const g = r.gp;
    g.pl.delete(c.id);
    if (g.run) { g.run.racers.delete(c.id); checkEnd(r); }
    if (r.clients.size) push(r);
  }

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function begin(r, phase, order) {
    const g = r.gp, now = Date.now();
    const racers = new Map();
    order.forEach((id, k) => racers.set(id, { slot: k, c: 0, done: false, lapStart: 0, laps: [], best: null }));
    const track = g.curTrack || pickTrack(g.set);
    const qms = qualiMs(W.trackById[track]);
    g.run = {
      phase, track, laps: g.set.laps, mode: g.set.mode, team: g.set.team,
      startAt: now + (phase === 'quali' ? 3500 : 5000), endAt: phase === 'quali' ? now + 3500 + qms : 0,
      racers, finished: [], firstFin: 0, fastest: null, size: racers.size,
    };
    g.phase = phase;
    broadcast(r, { t: 'gpRun', run: runInfo(r, now) });
    push(r);
    log(`방 ${r.code} ${phase === 'quali' ? '예선' : '결승'} 시작 (${track}, ${racers.size}명)`);
  }

  function start(r) {
    const g = r.gp;
    const ids = [...r.clients.keys()].filter(id => g.pl.has(id));
    for (const id of ids) g.pl.get(id).spec = false;
    g.curTrack = pickTrack(g.set);
    hideBots(r); makeBots(g, ids.map(id => { const c = r.clients.get(id); return c && c.user ? c.user.car : null; }).filter(Boolean), g.curTrack); showBots(r);
    const order = shuffle(ids);
    begin(r, g.set.quali ? 'quali' : 'race', g.set.quali ? order : [...order, ...g.bots.map(b => b.id)]);
  }

  function onCp(r, c, i, x, z) {
    const run = r.gp.run;
    if (!run) return;
    const p = run.racers.get(c.id);
    if (!p || p.done) return;
    const now = Date.now();
    if (now < run.startAt) return;
    const t = W.trackById[run.track], n = t.cps.length, cp = t.path[t.cps[i]];
    if (i !== p.c % n || !(Math.hypot(x - cp[0], z - cp[1]) < 60)) { c.send({ t: 'gpSync', c: p.c }); return; }
    p.c++;
    if (i === 0) {
      if (p.c === 1) p.lapStart = run.phase === 'race' ? run.startAt : now;
      else {
        const lt = now - p.lapStart;
        p.lapStart = now;
        p.laps.push(lt);
        if (!p.best || lt < p.best) p.best = lt;
        if (!run.fastest || lt < run.fastest.time) run.fastest = { id: c.id, name: c.user.name, time: lt };
        // 트랙 신기록 (이 코스 역대 최고 랩)
        let record = false;
        const R = REC(), old = R[run.track];
        if (lt > 5000 && (!old || lt < old.time)) {
          R[run.track] = { time: lt, name: c.user.name, car: W.carById[c.user.car]?.name || '', at: Date.now(), len: lenOf(run.track) };
          record = true; p.record = true; save();
          broadcast(r, { t: 'gpRecord', track: run.track, time: lt, name: c.user.name, id: c.id, prev: old ? old.time : null });
        }
        broadcast(r, { t: 'gpLap', id: c.id, lap: p.laps.length, time: lt, best: p.best, fastest: run.fastest, record });
      }
    }
    if (run.phase === 'race' && p.c >= run.laps * n + 1) {
      p.done = true;
      const place = run.finished.length + 1, time = now - run.startAt;
      run.finished.push({ id: c.id, name: c.user.name, time, place, best: p.best });
      if (!run.firstFin) { run.firstFin = now; run.endAt = now + 10000; } // 1등 골인 후 10초 뒤 리타이어
      broadcast(r, { t: 'gpFin', id: c.id, name: c.user.name, place, time, endIn: run.endAt - now });
      checkEnd(r);
    }
  }

  function checkEnd(r) {
    const g = r.gp, run = g.run;
    if (!run) return;
    const now = Date.now();
    if (![...run.racers.keys()].some(id => !isBot(id))) { g.run = null; g.phase = 'lobby'; g.curTrack = null; hideBots(r); broadcast(r, { t: 'gpEnd', cancelled: true }); push(r); return; }
    if (run.phase === 'quali') { if (now >= run.endAt) endQuali(r); return; }
    const allDone = [...run.racers.values()].every(p => p.done); // 봇이 남아 있어도 1등 골인 10초 뒤 끝남
    if (allDone || (run.endAt && now >= run.endAt)) endRace(r);
  }

  function endQuali(r) {
    const g = r.gp, run = g.run;
    const order = [...run.racers.entries()].sort((a, b) => {
      const ba = a[1].best ?? Infinity, bb = b[1].best ?? Infinity;
      return ba !== bb ? ba - bb : b[1].c - a[1].c;
    });
    g.qres = order.map(([id, p]) => ({ id, name: r.clients.get(id)?.user.name || '?', best: p.best }));
    g.run = null; g.phase = 'qres'; g.phaseEnd = Date.now() + 6000;
    broadcast(r, { t: 'gpQres', order: g.qres, startIn: 6000 });
    push(r);
  }

  function endRace(r) {
    const g = r.gp, run = g.run, now = Date.now();
    const results = run.finished.map(f => ({ ...f, dnf: false }));
    const dnf = [...run.racers.entries()].filter(([, p]) => !p.done).sort((a, b) => b[1].c - a[1].c);
    const nm = id => r.clients.get(id)?.user.name || (g.bots || []).find(b => b.id === id)?.name || '?';
    for (const [id, p] of dnf) results.push({ id, name: nm(id), time: null, place: null, best: p.best, dnf: true });
    const mult = (0.25 + run.laps * 0.25) * Math.max(1, Math.min(2.5, W.trackById[run.track].length / 2600));
    for (const res of results) {
      res.rec = !!run.racers.get(res.id)?.record;
      res.pts = res.place ? (POINTS[res.place - 1] || 0) : 0;
      res.fl = !!(run.fastest && run.fastest.id === res.id && res.place && res.place <= 10);
      if (res.fl) res.pts += 1;
      let coins = 0;
      if (res.place) coins = run.size >= 2 ? ([200, 140, 100, 70, 50][res.place - 1] || 30) : 40;
      if (res.fl && run.size >= 2) coins += 20;
      res.coins = Math.round(coins * mult);
      const c = r.clients.get(res.id), pl = g.pl.get(res.id);
      if (pl) { pl.pts += res.pts; if (res.place === 1 && run.size >= 2) pl.wins++; }
      if (c) {
        const u = c.user;
        u.coins += res.coins; u.races = (u.races || 0) + 1;
        if (res.place === 1 && run.size >= 2) u.wins = (u.wins || 0) + 1;
        c.send({ t: 'prof', p: profileOf(c.uid) });
      }
    }
    let teams = null;
    if (run.team) {
      teams = { red: 0, blue: 0 };
      for (const res of results) { const pl = g.pl.get(res.id); if (pl) teams[pl.team] += res.pts; res.team = pl?.team; }
    }
    save();
    g.races++;
    g.run = null; g.phase = 'results'; g.phaseEnd = now + 14000; g.curTrack = null;
    broadcast(r, { t: 'gpEnd', results, teams, fastest: run.fastest, laps: run.laps });
    push(r);
    log(`방 ${r.code} 결승 종료: ${results.map(x => x.name + (x.place ? x.place : 'DNF')).join(', ')}`);
  }

  function tick(r, now) {
    const g = r.gp;
    if (g.run) botStep(r, now);
    if (g.run) checkEnd(r);
    if (g.phase === 'qres' && now >= g.phaseEnd) {
      const ids = g.qres.map(q => q.id).filter(id => r.clients.has(id));
      if (ids.length) begin(r, 'race', [...ids, ...(g.bots || []).map(b => b.id)]);
      else { g.phase = 'lobby'; push(r); }
    }
    if (g.phase === 'results' && now >= g.phaseEnd) {
      g.phase = 'lobby';
      for (const p of g.pl.values()) p.ready = false;
      hideBots(r);
      broadcast(r, { t: 'gpLobby' });
      push(r);
    }
  }

  const num = v => (Number.isFinite(+v) ? +v : 0);
  function handle(c, r, msg) {
    const g = r.gp, host = r.hostId === c.id, me = g.pl.get(c.id);
    if (!me) return;
    switch (msg.t) {
      case 'gpSet': {
        if (!host || g.phase !== 'lobby' || !msg.set) return;
        const s = msg.set;
        if (ARENA_IDS.includes(s.track) || RANDOM[s.track]) g.set.track = s.track;
        if (s.mode === 'speed' || s.mode === 'item') g.set.mode = s.mode;
        if (typeof s.team === 'boolean') g.set.team = s.team;
        if (typeof s.quali === 'boolean') g.set.quali = s.quali;
        if (Number.isInteger(s.laps)) g.set.laps = Math.max(1, Math.min(5, s.laps));
        if (Number.isInteger(s.bots)) g.set.bots = Math.max(0, Math.min(7, s.bots));
        if (BOT_LV[s.botLv]) g.set.botLv = s.botLv;
        push(r);
        break;
      }
      case 'gpReady': if (g.phase === 'lobby') { me.ready = !me.ready; push(r); } break;
      case 'gpTeam': if (g.phase === 'lobby' && (msg.team === 'red' || msg.team === 'blue')) { me.team = msg.team; push(r); } break;
      case 'gpStart': {
        if (!host || g.phase !== 'lobby') return;
        const notReady = [...g.pl.entries()].filter(([id, p]) => id !== c.id && !p.ready);
        if (notReady.length) { c.send({ t: 'err', msg: '아직 준비 안 한 사람이 있어요' }); return; }
        start(r);
        break;
      }
      case 'gpReset': if (host && g.phase === 'lobby') { for (const p of g.pl.values()) { p.pts = 0; p.wins = 0; } g.races = 0; push(r); } break;
      case 'gpCp': onCp(r, c, msg.i | 0, num(msg.x), num(msg.z)); break;
      case 'gi': { // 아이템 이벤트 중계
        const k = msg.k;
        if (k === 'obj' && (msg.kind === 'banana' || msg.kind === 'water' || msg.kind === 'ice')) {
          const m = { t: 'gi', k, id: ++objSeq, kind: msg.kind, by: c.id, x: num(msg.x), z: num(msg.z), y: num(msg.y), x2: num(msg.x2), z2: num(msg.z2), y2: num(msg.y2) };
          broadcast(r, m);
          if (g.run && g.bots && g.bots.length) (g.run.objs = g.run.objs || []).push({ ...m, t0: Date.now(), hit: new Set() });
        } else if (k === 'rm') {
          broadcast(r, { t: 'gi', k, id: msg.id | 0, by: c.id });
          if (g.run && g.run.objs) g.run.objs = g.run.objs.filter(o => o.id !== (msg.id | 0));
        }
        else if ((k === 'missile' || k === 'ufo') && (r.clients.has(String(msg.to)) || isBot(String(msg.to)))) {
          broadcast(r, { t: 'gi', k, from: c.id, to: String(msg.to) });
          const bp = g.run && g.run.racers.get(String(msg.to));
          if (bp && isBot(String(msg.to))) botHit(bp, k, Date.now());
        } else if (k === 'zap' || k === 'ink' || k === 'devil') {
          broadcast(r, { t: 'gi', k, from: c.id });
          if (k === 'zap' && g.run) for (const [id, bp] of g.run.racers) if (isBot(id)) botHit(bp, 'zap', Date.now());
        }
        else if (k === 'fx') broadcast(r, { t: 'gi', k, from: c.id, kind: String(msg.kind).slice(0, 12), to: msg.to ? String(msg.to) : null }, c);
        break;
      }
      case 'bump': { // 사람이 봇을 들이받음 → 봇도 밀림
        const bp = g.run && isBot(String(msg.to)) && g.run.racers.get(String(msg.to));
        if (!bp || !bp.tg || !Array.isArray(msg.dv)) break;
        const lim = v => Math.max(-40, Math.min(40, +v || 0)), dx = lim(msg.dv[0]), dz = lim(msg.dv[1]), tg = bp.tg;
        const along = dx * tg[0] + dz * tg[1], lat = dx * tg[1] - dz * tg[0];
        bp.v = Math.max(0, (bp.v || 0) + along * 0.8);
        bp.pushV = (bp.pushV || 0) + lat * 0.9;
        bp.spinV = (bp.spinV || 0) + Math.max(-6, Math.min(6, +msg.w || 0)) * 0.6;
        break;
      }
    }
  }

  // 대기실 연습 주행/입장 위치용 코스 (랜덤이면 진행 중인 코스 또는 첫 코스)
  const lobbyTrack = r => r.gp.curTrack || (RANDOM[r.gp.set.track] ? ARENA_IDS[0] : r.gp.set.track);
  return { init, join, leave, handle, tick, push, lobbyTrack, botLapTest, _bot: { botMove, botInfoOf, makeBots, carLap } };
}

if (typeof module !== 'undefined' && module.exports) module.exports = makeGP;
else root.makeGP = makeGP;
})(this);
