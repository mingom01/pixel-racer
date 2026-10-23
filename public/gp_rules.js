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
  const REC = () => (records ? records() : null) || {};
  const recView = () => { const o = {}, R = REC(); for (const k in R) o[k] = { time: R[k].time, name: R[k].name, car: R[k].car }; return o; };
  let objSeq = 0;

  function init(r) {
    r.kind = 'gp';
    r.gp = {
      phase: 'lobby', races: 0, run: null, phaseEnd: 0, qres: null,
      set: { track: ARENA_IDS[0], mode: 'speed', team: false, laps: 3, quali: false },
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
    begin(r, g.set.quali ? 'quali' : 'race', shuffle(ids));
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
          R[run.track] = { time: lt, name: c.user.name, car: W.carById[c.user.car]?.name || '', at: Date.now() };
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
      if (!run.firstFin) { run.firstFin = now; run.endAt = now + Math.round(Math.max(12000, Math.min(40000, t.length / 40 * 1000 * 0.3))); }
      broadcast(r, { t: 'gpFin', id: c.id, name: c.user.name, place, time, endIn: run.endAt - now });
      checkEnd(r);
    }
  }

  function checkEnd(r) {
    const g = r.gp, run = g.run;
    if (!run) return;
    const now = Date.now();
    if (run.racers.size === 0) { g.run = null; g.phase = 'lobby'; g.curTrack = null; broadcast(r, { t: 'gpEnd', cancelled: true }); push(r); return; }
    if (run.phase === 'quali') { if (now >= run.endAt) endQuali(r); return; }
    const allDone = [...run.racers.values()].every(p => p.done);
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
    for (const [id, p] of dnf) results.push({ id, name: r.clients.get(id)?.user.name || '?', time: null, place: null, best: p.best, dnf: true });
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
    if (g.run) checkEnd(r);
    if (g.phase === 'qres' && now >= g.phaseEnd) {
      const ids = g.qres.map(q => q.id).filter(id => r.clients.has(id));
      if (ids.length) begin(r, 'race', ids);
      else { g.phase = 'lobby'; push(r); }
    }
    if (g.phase === 'results' && now >= g.phaseEnd) {
      g.phase = 'lobby';
      for (const p of g.pl.values()) p.ready = false;
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
          broadcast(r, { t: 'gi', k, id: ++objSeq, kind: msg.kind, by: c.id, x: num(msg.x), z: num(msg.z), y: num(msg.y), x2: num(msg.x2), z2: num(msg.z2), y2: num(msg.y2) });
        } else if (k === 'rm') broadcast(r, { t: 'gi', k, id: msg.id | 0, by: c.id });
        else if ((k === 'missile' || k === 'ufo') && r.clients.has(String(msg.to))) broadcast(r, { t: 'gi', k, from: c.id, to: String(msg.to) });
        else if (k === 'zap' || k === 'ink' || k === 'devil') broadcast(r, { t: 'gi', k, from: c.id });
        else if (k === 'fx') broadcast(r, { t: 'gi', k, from: c.id, kind: String(msg.kind).slice(0, 12), to: msg.to ? String(msg.to) : null }, c);
        break;
      }
    }
  }

  // 대기실 연습 주행/입장 위치용 코스 (랜덤이면 진행 중인 코스 또는 첫 코스)
  const lobbyTrack = r => r.gp.curTrack || (RANDOM[r.gp.set.track] ? ARENA_IDS[0] : r.gp.set.track);
  return { init, join, leave, handle, tick, push, lobbyTrack };
}

if (typeof module !== 'undefined' && module.exports) module.exports = makeGP;
else root.makeGP = makeGP;
})(this);
