// 서버 없이 혼자 하기 (GitHub Pages 등): 서버와 같은 메시지를 브라우저 안에서 흉내 낸다.
// 진행상황(코인, 차, 색, 기록)은 이 브라우저의 localStorage 에 저장.
const W = window.WORLD;
const KEY = 'pr_offline_profile';

function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
function store(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* 저장 불가 */ } }
function cleanName(s) {
  s = String(s || '').replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
  return s || '드라이버' + Math.floor(Math.random() * 900 + 100);
}

// 반환값은 WebSocket 처럼 send / readyState 를 가진 객체
export function makeLocalServer(onMsg) {
  let prof = load();
  const me = {
    id: 'me', uid: 'local', pos: { x: 0, y: 0, z: 0 }, room: null,
    get user() { return prof; },
    send(o) { const m = typeof o === 'string' ? JSON.parse(o) : o; setTimeout(() => onMsg(m), 0); },
  };
  const save = () => store(prof);
  const profileOf = () => ({ id: 'local', name: prof.name, coins: prof.coins, owned: prof.owned, car: prof.car, color: prof.color, google: false, races: prof.races || 0, wins: prof.wins || 0 });
  const broadcast = (r, obj, except) => { if (except !== me) me.send(obj); };
  const GP = window.makeGP({ W, broadcast, save, profileOf, log: () => {} });
  let room = null;

  function roomInfo(r) { return { code: r.code, name: r.name, pub: false, max: 1, n: 1, racing: !!r.race, host: 'me', kind: r.kind || 'free' }; }
  function join(r) {
    room = r; me.room = r;
    const sp = r.kind === 'gp' ? W.gridSlot(W.trackById[r.gp.set.track], 0) : W.spawnPoint(0);
    me.pos = { x: sp.x, y: 0, z: sp.z };
    me.send({ t: 'joined', room: roomInfo(r), you: 'me', spawn: sp, players: [], coinsDown: [...r.coinsDown.keys()], race: null });
    if (r.kind === 'gp') GP.join(r, me);
  }
  function create(kind) {
    const r = { code: 'SOLO', name: kind === 'gp' ? '혼자 레이싱' : '혼자 자유 주행', hostId: 'me', clients: new Map([['me', me]]), coinsDown: new Map(), race: null };
    if (kind === 'gp') GP.init(r);
    join(r);
  }

  /* ---------- 자유 주행 방의 레이스 (서버와 같은 규칙) ---------- */
  function startRace(trackId, laps) {
    const t = W.trackById[trackId] || W.tracks[0];
    laps = Math.max(1, Math.min(5, laps | 0 || 3));
    const now = Date.now();
    room.race = { track: t.id, laps, startAt: now + 4500, racers: new Map([['me', { slot: 0, c: 0, done: false }]]), finished: [] };
    me.send({ t: 'raceStart', race: { track: t.id, laps, startIn: 4500, grid: { me: 0 }, finished: [] } });
  }
  function onCheckpoint(i, x, z) {
    const rc = room && room.race, p = rc && rc.racers.get('me');
    if (!p || p.done || Date.now() < rc.startAt) return;
    const t = W.trackById[rc.track], n = t.cps.length, cp = t.path[t.cps[i]];
    if (i !== p.c % n || !(Math.hypot(x - cp[0], z - cp[1]) < 60)) { me.send({ t: 'cpSync', c: p.c }); return; }
    p.c++;
    if (p.c >= rc.laps * n + 1) {
      p.done = true;
      const time = Date.now() - rc.startAt, reward = Math.round(40 * (0.25 + rc.laps * 0.25));
      prof.coins += reward; prof.races = (prof.races || 0) + 1; save();
      const fin = { id: 'me', name: prof.name, time, place: 1, reward };
      rc.finished.push(fin);
      me.send({ t: 'fin', ...fin });
      me.send({ t: 'prof', p: profileOf() });
      room.race = null;
      me.send({ t: 'raceEnd', results: [fin] });
    }
  }

  function handle(m) {
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'ping') { me.send({ t: 'pong', n: m.n }); return; }
    if (m.t === 'auth') {
      if (m.guest) {
        if (!prof) prof = { name: cleanName(m.name), coins: 0, owned: ['hatch'], car: 'hatch', color: Math.floor(Math.random() * W.COLORS.length), races: 0, wins: 0 };
        else if (m.name) prof.name = cleanName(m.name);
        save();
      }
      if (!prof) { me.send({ t: 'authFail', msg: '' }); return; }
      me.send({ t: 'authed', session: 'offline', profile: profileOf() });
      me.send({ t: 'rooms', list: [] });
      return;
    }
    if (!prof) return;
    const r = room;
    switch (m.t) {
      case 's': if (Array.isArray(m.d)) { me.pos.x = +m.d[0] || 0; me.pos.y = +m.d[1] || 0; me.pos.z = +m.d[2] || 0; } break;
      case 'rooms': me.send({ t: 'rooms', list: [] }); break;
      case 'create': create(m.kind === 'gp' ? 'gp' : 'free'); break;
      case 'quick': create('free'); break;
      case 'join': me.send({ t: 'err', msg: '오프라인(혼자 하기)에서는 친구 방에 들어갈 수 없어요' }); break;
      case 'leave': room = null; me.room = null; me.send({ t: 'rooms', list: [] }); break;
      case 'coin': {
        const id = m.id | 0, coin = W.coins[id];
        if (!r || r.kind === 'gp' || !coin || r.coinsDown.has(id)) return;
        const val = coin.big ? 25 : 5;
        r.coinsDown.set(id, Date.now() + (coin.big ? 60000 : 25000));
        prof.coins += val; save();
        me.send({ t: 'coinGone', id, by: 'me' });
        me.send({ t: 'coins', coins: prof.coins, gain: val });
        break;
      }
      case 'buy': {
        const car = W.carById[m.car];
        if (!car) return;
        if (prof.owned.includes(car.id)) { me.send({ t: 'err', msg: '이미 가진 차예요' }); return; }
        if (prof.coins < car.price) { me.send({ t: 'err', msg: '코인이 부족해요' }); return; }
        prof.coins -= car.price; prof.owned.push(car.id); prof.car = car.id; save();
        me.send({ t: 'prof', p: profileOf(), bought: car.id });
        if (r && r.kind === 'gp') GP.push(r);
        break;
      }
      case 'select':
        if (m.car && prof.owned.includes(m.car)) prof.car = m.car;
        if (Number.isInteger(m.color) && m.color >= 0 && m.color < W.COLORS.length) prof.color = m.color;
        save(); me.send({ t: 'prof', p: profileOf() });
        if (r && r.kind === 'gp') GP.push(r);
        break;
      case 'name': prof.name = cleanName(m.name); save(); me.send({ t: 'prof', p: profileOf() }); break;
      case 'chat': { const text = String(m.msg || '').replace(/[<>]/g, '').trim().slice(0, 80); if (text) me.send({ t: 'chat', id: 'me', name: prof.name, msg: text }); break; }
      case 'race': if (r && r.kind !== 'gp' && !r.race) startRace(m.track, m.laps); break;
      case 'raceCancel': if (r && r.race) { r.race = null; me.send({ t: 'raceEnd', results: [], cancelled: true }); } break;
      case 'cp': onCheckpoint(m.i | 0, +m.x, +m.z); break;
      default:
        if (r && r.kind === 'gp' && (m.t.startsWith('gp') || m.t === 'gi')) GP.handle(me, r, m);
    }
  }

  // 코인 다시 생기기 / 레이싱 방 진행
  setInterval(() => {
    const r = room;
    if (!r) return;
    const now = Date.now(), up = [];
    for (const [id, at] of r.coinsDown) if (now >= at) { r.coinsDown.delete(id); up.push(id); }
    if (up.length) me.send({ t: 'coinUp', ids: up });
    if (r.kind === 'gp') GP.tick(r, now);
  }, 200);

  const sock = { readyState: 1, offline: true, send: s => handle(typeof s === 'string' ? JSON.parse(s) : s), close() {} };
  setTimeout(() => {
    if (prof) handle({ t: 'auth', session: 'offline' });
    else onMsg({ t: 'authFail', msg: '' });
  }, 0);
  return sock;
}
