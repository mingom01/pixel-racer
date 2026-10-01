// 픽셀 레이서 온라인 서버 (의존성 없음, Node 18+)
// 실행: node server.js  →  http://localhost:8160
// 정적 파일 서빙 + WebSocket 방/계정/코인/레이스 관리
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const W = require('./public/world.js');
const makeGP = require('./public/gp_rules.js');
const makeStore = require('./store.js');

const ROOT = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONFIG_FILE = path.join(__dirname, 'config.json');

if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, JSON.stringify({ port: 8160, googleClientId: '' }, null, 2));
const CONFIG = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const PORT = process.env.PORT || CONFIG.port || 8160;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || CONFIG.googleClientId || '';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

/* ---------- 계정 저장소 (store.js: Supabase 또는 로컬 파일) ---------- */
const STORE = makeStore({ dataDir: DATA_DIR, log: s => log(s) });
const DB = { users: STORE.users };
const save = () => STORE.save();
function cleanName(s) {
  s = String(s || '').replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
  return s || '드라이버' + Math.floor(Math.random() * 900 + 100);
}
function newUser(name, google) {
  return { name: cleanName(name), coins: 0, owned: ['hatch'], car: 'hatch', color: Math.floor(Math.random() * W.COLORS.length), google: !!google, created: Date.now(), races: 0, wins: 0 };
}
function newSession(uid) { return STORE.makeToken(uid); }
function profileOf(uid) {
  const u = DB.users[uid];
  return { id: uid, name: u.name, coins: u.coins, owned: u.owned, car: u.car, color: u.color, google: u.google, races: u.races || 0, wins: u.wins || 0 };
}

async function verifyGoogle(idToken) {
  if (!GOOGLE_CLIENT_ID) throw new Error('서버에 구글 클라이언트 ID가 설정되지 않았습니다');
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken));
  if (!r.ok) throw new Error('구글 토큰 확인 실패');
  const info = await r.json();
  if (info.aud !== GOOGLE_CLIENT_ID) throw new Error('다른 앱의 토큰입니다');
  if (Number(info.exp) * 1000 < Date.now()) throw new Error('만료된 토큰입니다');
  return info;
}

/* ---------- HTTP ---------- */
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (p === '/config.json') {
    // GitHub Pages 같은 다른 주소의 페이지에서도 읽을 수 있게 (CORS)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ googleClientId: GOOGLE_CLIENT_ID }));
  }
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

/* ---------- 최소 WebSocket 구현 ---------- */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function encodeFrame(str) {
  const payload = Buffer.from(str, 'utf8'), len = payload.length;
  let head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = 0x81;
  return Buffer.concat([head, payload]);
}

let nextId = 1;
let GP = null; // broadcast 등이 정의된 뒤 초기화
class Client {
  constructor(socket) {
    this.socket = socket; this.buf = Buffer.alloc(0); this.alive = true;
    this.id = String(nextId++);
    this.uid = null; this.room = null;
    this.st = null; this.pos = { x: 0, y: 0, z: 0 };
    this.chatAt = 0;
    socket.on('data', d => this.onData(d));
    socket.on('close', () => this.onClose());
    socket.on('error', () => this.onClose());
  }
  get user() { return this.uid ? DB.users[this.uid] : null; }
  send(obj) {
    if (!this.alive) return;
    try { this.socket.write(encodeFrame(typeof obj === 'string' ? obj : JSON.stringify(obj))); } catch (e) { /* ignore */ }
  }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    if (this.buf.length > 1 << 20) { this.close(); return; }
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1], opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      const maskLen = masked ? 4 : 0;
      if (this.buf.length < off + maskLen + len) return;
      const mask = masked ? this.buf.slice(off, off + 4) : null;
      let payload = this.buf.slice(off + maskLen, off + maskLen + len);
      if (masked) { payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]; }
      this.buf = this.buf.slice(off + maskLen + len);
      if (opcode === 8) { this.close(); return; }
      if (opcode === 9) { const h = Buffer.alloc(2); h[0] = 0x8a; h[1] = payload.length; this.socket.write(Buffer.concat([h, payload])); continue; }
      if (opcode === 1) {
        let msg; try { msg = JSON.parse(payload.toString('utf8')); } catch (e) { continue; }
        try { handle(this, msg); } catch (e) { console.error(e); }
      }
    }
  }
  close() {
    if (!this.alive) return;
    try { this.socket.end(Buffer.from([0x88, 0x00])); } catch (e) { /* ignore */ }
    this.onClose();
  }
  onClose() {
    if (!this.alive) return;
    this.alive = false;
    leaveRoom(this);
    lobby.delete(this);
    try { this.socket.destroy(); } catch (e) { /* ignore */ }
  }
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  new Client(socket);
});

/* ---------- 방 ---------- */
const rooms = new Map();
const lobby = new Set();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
function roomInfo(r) {
  return { code: r.code, name: r.name, pub: r.pub, max: r.max, n: r.clients.size, racing: !!r.race || !!(r.gp && r.gp.phase !== 'lobby'), host: r.hostId, kind: r.kind || 'free' };
}
function playerInfo(c) {
  const u = c.user;
  return { id: c.id, name: u.name, car: u.car, color: u.color };
}
function broadcast(r, obj, except) {
  const s = JSON.stringify(obj);
  for (const c of r.clients.values()) if (c !== except) c.send(s);
}
let lobbyDirty = false;
function pushLobby() { lobbyDirty = true; }
function sendRooms(c) {
  const list = [...rooms.values()].filter(r => r.pub).map(roomInfo);
  c.send({ t: 'rooms', list });
}

function joinRoom(c, r) {
  leaveRoom(c);
  lobby.delete(c);
  r.clients.set(c.id, c);
  c.room = r;
  const sp = r.kind === 'gp' ? W.gridSlot(W.trackById[r.gp.set.track], (r.clients.size - 1) % 12) : W.spawnPoint(r.clients.size - 1);
  c.pos = { x: sp.x, y: 0, z: sp.z };
  c.st = null;
  const now = Date.now();
  c.send({
    t: 'joined', room: roomInfo(r), you: c.id, spawn: sp,
    players: [...r.clients.values()].filter(o => o !== c).map(playerInfo),
    coinsDown: [...r.coinsDown.keys()],
    race: r.race ? raceInfo(r, now) : null,
  });
  broadcast(r, { t: 'pj', p: playerInfo(c) }, c);
  if (r.kind === 'gp') GP.join(r, c);
  broadcast(r, { t: 'sys', msg: c.user.name + ' 님이 들어왔습니다' }, c);
  pushLobby();
  log(`${c.user.name} → 방 ${r.code} (${r.clients.size}명)`);
}

function leaveRoom(c) {
  const r = c.room;
  if (!r) return;
  r.clients.delete(c.id);
  c.room = null;
  if (r.kind === 'gp') GP.leave(r, c);
  if (r.race) {
    r.race.racers.delete(c.id);
    checkRaceEnd(r);
  }
  if (r.clients.size === 0) { rooms.delete(r.code); log(`방 ${r.code} 삭제`); }
  else {
    broadcast(r, { t: 'pl', id: c.id });
    if (c.user) broadcast(r, { t: 'sys', msg: c.user.name + ' 님이 나갔습니다' });
    if (r.hostId === c.id) {
      r.hostId = r.clients.keys().next().value;
      broadcast(r, { t: 'host', id: r.hostId });
      if (r.kind === 'gp') GP.push(r);
    }
  }
  pushLobby();
}

/* ---------- 레이스 ---------- */
function raceInfo(r, now) {
  const rc = r.race;
  return {
    track: rc.track, laps: rc.laps, startIn: rc.startAt - now,
    grid: Object.fromEntries([...rc.racers.entries()].map(([id, p]) => [id, p.slot])),
    finished: rc.finished,
  };
}
function startRace(r, trackId, laps) {
  const t = W.trackById[trackId] || W.tracks[0];
  laps = Math.max(1, Math.min(5, laps | 0 || 3));
  const now = Date.now();
  const racers = new Map();
  let k = 0;
  for (const id of r.clients.keys()) racers.set(id, { slot: k++, c: 0, done: false });
  r.race = { track: t.id, laps, startAt: now + 4500, racers, finished: [], firstFinish: 0, size: racers.size };
  broadcast(r, { t: 'raceStart', race: raceInfo(r, now) });
  pushLobby();
  log(`방 ${r.code} 레이스 시작 (${t.name}, ${laps}랩, ${racers.size}명)`);
}
function rewardFor(place, size, laps) {
  const mult = 0.25 + laps * 0.25;
  let base = 40;
  if (size >= 2) base = [200, 120, 80][place - 1] || 40;
  return Math.round(base * mult);
}
function checkRaceEnd(r) {
  const rc = r.race;
  if (!rc) return;
  const now = Date.now();
  const allDone = [...rc.racers.values()].every(p => p.done);
  if (allDone || (rc.firstFinish && now - rc.firstFinish > 45000)) {
    const results = rc.finished.slice();
    for (const [id, p] of rc.racers) if (!p.done) {
      const c = r.clients.get(id);
      results.push({ id, name: c ? c.user.name : '?', time: null, place: null, reward: 0 });
    }
    r.race = null;
    broadcast(r, { t: 'raceEnd', results });
    pushLobby();
  }
}
function onCheckpoint(c, i, x, z) {
  const r = c.room, rc = r && r.race;
  if (!rc) return;
  const p = rc.racers.get(c.id);
  if (!p || p.done) return;
  const now = Date.now();
  if (now < rc.startAt) return;
  const t = W.trackById[rc.track], n = t.cps.length;
  // 순서/위치가 안 맞으면 서버 기준 진행도로 되돌림
  const cp = t.path[t.cps[i]];
  if (i !== p.c % n || !(Math.hypot(x - cp[0], z - cp[1]) < 60)) { c.send({ t: 'cpSync', c: p.c }); return; }
  c.pos.x = x; c.pos.z = z;
  p.c++;
  if (p.c >= rc.laps * n + 1) {
    p.done = true;
    const place = rc.finished.length + 1;
    const time = now - rc.startAt;
    const reward = rewardFor(place, rc.size, rc.laps);
    const u = c.user;
    u.coins += reward; u.races = (u.races || 0) + 1;
    if (place === 1 && rc.size >= 2) u.wins = (u.wins || 0) + 1;
    save();
    rc.finished.push({ id: c.id, name: u.name, time, place, reward });
    if (!rc.firstFinish) rc.firstFinish = now;
    broadcast(r, { t: 'fin', id: c.id, name: u.name, place, time, reward });
    c.send({ t: 'prof', p: profileOf(c.uid) });
    checkRaceEnd(r);
  }
}

/* ---------- 메시지 처리 ---------- */
async function handleAuth(c, msg) {
  try { await doAuth(c, msg); }
  catch (e) { log('로그인 오류: ' + e.message); c.send({ t: 'authFail', msg: '서버 저장소에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.' }); }
}
async function doAuth(c, msg) {
  let uid = null;
  const sid = msg.session ? STORE.readToken(msg.session) : null;
  if (sid && await STORE.get(sid)) {
    uid = sid;
    c.uid = uid;
    c.send({ t: 'authed', session: msg.session, profile: profileOf(uid) });
  } else if (msg.google) {
    let info;
    try { info = await verifyGoogle(String(msg.google)); }
    catch (e) { c.send({ t: 'authFail', msg: e.message }); return; }
    uid = 'G' + info.sub;
    if (!(await STORE.get(uid))) {
      DB.users[uid] = newUser(info.given_name || info.name || '드라이버', true);
      // 이 브라우저의 게스트 진행상황을 옮겨줌
      const gid = msg.guest ? 'U' + crypto.createHash('sha256').update(String(msg.guest)).digest('hex').slice(0, 20) : null;
      const g = gid && await STORE.get(gid);
      if (g && !g.merged) {
        const nu = DB.users[uid];
        nu.coins += g.coins; nu.owned = [...new Set([...nu.owned, ...g.owned])]; nu.car = g.car; nu.color = g.color;
        g.coins = 0; g.merged = uid;
      }
    }
    c.uid = uid;
    c.send({ t: 'authed', session: newSession(uid), profile: profileOf(uid) });
  } else if (msg.guest) {
    uid = 'U' + crypto.createHash('sha256').update(String(msg.guest)).digest('hex').slice(0, 20);
    if (!(await STORE.get(uid))) DB.users[uid] = newUser(msg.name, false);
    else if (msg.name) DB.users[uid].name = cleanName(msg.name);
    c.uid = uid;
    c.send({ t: 'authed', session: newSession(uid), profile: profileOf(uid) });
  } else {
    c.send({ t: 'authFail', msg: '로그인 정보가 없습니다' });
    return;
  }
  save();
  lobby.add(c);
  sendRooms(c);
  log(`로그인: ${DB.users[uid].name} (${uid.slice(0, 8)})`);
}

function handle(c, msg) {
  if (!msg || typeof msg.t !== 'string') return;
  if (msg.t === 'auth') { handleAuth(c, msg); return; }
  if (msg.t === 'ping') { c.send({ t: 'pong', n: msg.n }); return; }
  if (!c.uid) return;
  const u = c.user, r = c.room;
  switch (msg.t) {
    case 's': {
      if (!r || !Array.isArray(msg.d)) return;
      const d = msg.d.slice(0, 12).map(v => +v || 0);
      c.st = d; c.pos.x = d[0]; c.pos.y = d[1]; c.pos.z = d[2];
      break;
    }
    case 'rooms': sendRooms(c); break;
    case 'create': {
      const code = genCode();
      const room = {
        code, name: cleanName(msg.name || (u.name + '의 방')).slice(0, 16), pub: !!msg.pub,
        max: Math.max(2, Math.min(12, msg.max | 0 || 8)), hostId: c.id, clients: new Map(), coinsDown: new Map(), race: null,
      };
      if (msg.kind === 'gp') { GP.init(room); if (!msg.name) room.name = cleanName(u.name + '의 레이싱').slice(0, 16); }
      rooms.set(code, room);
      joinRoom(c, room);
      break;
    }
    case 'join': {
      const code = String(msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { c.send({ t: 'err', msg: '방을 찾을 수 없어요 (코드: ' + code + ')' }); return; }
      if (room.clients.size >= room.max) { c.send({ t: 'err', msg: '방이 꽉 찼어요' }); return; }
      joinRoom(c, room);
      break;
    }
    case 'quick': {
      const list = [...rooms.values()].filter(x => x.pub && x.clients.size < x.max).sort((a, b) => b.clients.size - a.clients.size);
      if (list.length) joinRoom(c, list[0]);
      else handle(c, { t: 'create', pub: true, name: u.name + '의 방' });
      break;
    }
    case 'leave': leaveRoom(c); lobby.add(c); sendRooms(c); break;
    case 'coin': {
      if (!r || r.kind === 'gp') return;
      const id = msg.id | 0, coin = W.coins[id];
      if (!coin || r.coinsDown.has(id)) return;
      if (Math.hypot(c.pos.x - coin.x, c.pos.z - coin.z) > 30) { c.send({ t: 'coinUp', ids: [id] }); return; }
      const val = coin.big ? 25 : 5;
      r.coinsDown.set(id, Date.now() + (coin.big ? 60000 : 25000));
      u.coins += val; save();
      broadcast(r, { t: 'coinGone', id, by: c.id });
      c.send({ t: 'coins', coins: u.coins, gain: val });
      break;
    }
    case 'buy': {
      const car = W.carById[msg.car];
      if (!car) return;
      if (u.owned.includes(car.id)) { c.send({ t: 'err', msg: '이미 가진 차예요' }); return; }
      if (u.coins < car.price) { c.send({ t: 'err', msg: '코인이 부족해요' }); return; }
      u.coins -= car.price; u.owned.push(car.id); u.car = car.id; save();
      c.send({ t: 'prof', p: profileOf(c.uid), bought: car.id });
      if (r) broadcast(r, { t: 'pu', p: playerInfo(c) }, c);
      if (r && r.kind === 'gp') GP.push(r);
      break;
    }
    case 'select': {
      if (msg.car && u.owned.includes(msg.car)) u.car = msg.car;
      if (Number.isInteger(msg.color) && msg.color >= 0 && msg.color < W.COLORS.length) u.color = msg.color;
      save();
      c.send({ t: 'prof', p: profileOf(c.uid) });
      if (r) broadcast(r, { t: 'pu', p: playerInfo(c) }, c);
      if (r && r.kind === 'gp') GP.push(r);
      break;
    }
    case 'name': {
      u.name = cleanName(msg.name); save();
      c.send({ t: 'prof', p: profileOf(c.uid) });
      if (r) broadcast(r, { t: 'pu', p: playerInfo(c) }, c);
      if (r && r.kind === 'gp') GP.push(r);
      break;
    }
    case 'chat': {
      if (!r) return;
      const now = Date.now();
      if (now - c.chatAt < 400) return;
      c.chatAt = now;
      const text = String(msg.msg || '').replace(/[<>]/g, '').trim().slice(0, 80);
      if (text) broadcast(r, { t: 'chat', id: c.id, name: u.name, msg: text });
      break;
    }
    case 'honk': if (r) broadcast(r, { t: 'honk', id: c.id }, c); break;
    case 'bump': {
      // 범퍼카: 들이받은 쪽이 맞은 차에 밀림 전달
      const o = r && r.clients.get(String(msg.to));
      if (!o || o === c || !Array.isArray(msg.dv)) return;
      const lim = v => Math.max(-40, Math.min(40, +v || 0));
      o.send({ t: 'bump', from: c.id, dv: [lim(msg.dv[0]), lim(msg.dv[1])], w: Math.max(-4, Math.min(4, +msg.w || 0)) });
      break;
    }
    case 'race': {
      if (!r || r.kind === 'gp' || r.hostId !== c.id || r.race) return;
      startRace(r, msg.track, msg.laps);
      break;
    }
    case 'raceCancel': {
      if (!r || r.hostId !== c.id || !r.race) return;
      r.race = null;
      broadcast(r, { t: 'raceEnd', results: [], cancelled: true });
      pushLobby();
      break;
    }
    case 'cp': onCheckpoint(c, msg.i | 0, +msg.x, +msg.z); break;
    default:
      if (r && r.kind === 'gp' && (msg.t.startsWith('gp') || msg.t === 'gi')) GP.handle(c, r, msg);
  }
}

/* ---------- 틱: 상태 방송 / 코인 리스폰 ---------- */
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    const ps = {};
    let any = false;
    for (const c of r.clients.values()) if (c.st) { ps[c.id] = c.st; any = true; }
    if (any) broadcast(r, { t: 'st', ps });
    const up = [];
    for (const [id, at] of r.coinsDown) if (now >= at) { r.coinsDown.delete(id); up.push(id); }
    if (up.length) broadcast(r, { t: 'coinUp', ids: up });
    if (r.race) checkRaceEnd(r);
    if (r.kind === 'gp') GP.tick(r, now);
  }
}, 66);

setInterval(() => {
  if (!lobbyDirty) return;
  lobbyDirty = false;
  for (const c of lobby) sendRooms(c);
}, 500);

GP = makeGP({ W, broadcast, save, profileOf, log });

function log(s) { console.log(new Date().toLocaleTimeString() + '  ' + s); }

// 배포 서버가 꺼질 때(재배포 등) 마지막 변경사항 저장
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { log('종료 중... 저장'); await STORE.flush(); process.exit(0); });
setInterval(() => STORE.flush(), 15000);

server.listen(PORT, () => {
  const nets = require('os').networkInterfaces();
  const ips = Object.values(nets).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
  console.log(`픽셀 레이서 서버: http://localhost:${PORT}`);
  if (ips.length) console.log('같은 와이파이의 친구는: ' + ips.map(ip => `http://${ip}:${PORT}`).join('  '));
  console.log(GOOGLE_CLIENT_ID ? '구글 로그인: 켜짐' : '구글 로그인: 꺼짐 (config.json 에 googleClientId 를 넣으면 켜집니다)');
  STORE.check().then(k => console.log('계정 저장소: ' + (k === 'supabase' ? 'Supabase (DB)' : 'data/accounts.json (이 컴퓨터)'))).catch(e => console.log('계정 저장소 연결 실패: ' + e.message));
});
