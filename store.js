// 계정 저장소
// - SUPABASE_URL + SUPABASE_SECRET_KEY 가 있으면 Supabase(Postgres) 의 accounts 표에 저장 (배포용, 서버가 재시작돼도 유지)
// - 없으면 data/accounts.json 파일에 저장 (내 컴퓨터에서 돌릴 때)
// 로그인 세션은 서명된 토큰이라 따로 저장하지 않는다.
const fs = require('fs'), path = require('path'), crypto = require('crypto');

module.exports = function makeStore({ dataDir, log }) {
  const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const SB_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const remote = !!(SB_URL && SB_KEY);
  const ACC_FILE = path.join(dataDir, 'accounts.json');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const users = {};          // uid → 계정 (메모리 캐시)
  const savedJson = {};      // uid → 마지막으로 저장한 JSON (바뀐 것만 저장)
  let legacySessions = {};   // 예전 버전 세션 토큰 호환

  if (!remote) {
    try {
      const d = JSON.parse(fs.readFileSync(ACC_FILE, 'utf8'));
      Object.assign(users, d.users || {});
      legacySessions = d.sessions || {};
    } catch (e) { /* 새로 시작 */ }
  }

  /* ---------- 세션 토큰 (HMAC 서명) ---------- */
  let secret = process.env.SESSION_SECRET || '';
  if (!secret && remote) secret = crypto.createHash('sha256').update('pixel-racer-session:' + SB_KEY).digest('hex');
  if (!secret) {
    const f = path.join(dataDir, 'secret.txt');
    try { secret = fs.readFileSync(f, 'utf8').trim(); } catch (e) { /* 없음 */ }
    if (!secret) { secret = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(f, secret); }
  }
  const sign = s => crypto.createHmac('sha256', secret).update(s).digest('base64url');
  function makeToken(uid) {
    const body = Buffer.from(uid).toString('base64url') + '.' + (Date.now() + 180 * 864e5).toString(36);
    return body + '.' + sign(body);
  }
  function readToken(tok) {
    if (typeof tok !== 'string') return null;
    if (legacySessions[tok]) return legacySessions[tok];
    const [a, b, s] = tok.split('.');
    if (!a || !b || !s) return null;
    const want = sign(a + '.' + b);
    if (s.length !== want.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want))) return null;
    if (parseInt(b, 36) < Date.now()) return null;
    return Buffer.from(a, 'base64url').toString();
  }

  /* ---------- Supabase REST ---------- */
  const H = () => ({ apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' });
  async function fetchUser(uid) {
    const r = await fetch(`${SB_URL}/rest/v1/accounts?id=eq.${encodeURIComponent(uid)}&select=data`, { headers: H() });
    if (!r.ok) throw new Error('DB 읽기 실패 ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const rows = await r.json();
    return rows[0] ? rows[0].data : null;
  }
  async function upsert(rows) {
    const r = await fetch(`${SB_URL}/rest/v1/accounts`, {
      method: 'POST',
      headers: { ...H(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    });
    if (!r.ok) throw new Error('DB 저장 실패 ' + r.status + ' ' + (await r.text()).slice(0, 200));
  }

  // 계정 하나 가져오기 (캐시 → DB)
  async function get(uid) {
    if (users[uid]) return users[uid];
    if (!remote) return null;
    const d = await fetchUser(uid);
    if (d && !users[uid]) { users[uid] = d; savedJson[uid] = JSON.stringify(d); }
    return users[uid] || null;
  }

  /* ---------- 저장 (바뀐 계정만 모아서) ---------- */
  let timer = null, saving = null;
  async function flush() {
    if (saving) await saving;
    const changed = [];
    for (const uid in users) {
      const j = JSON.stringify(users[uid]);
      if (savedJson[uid] !== j) changed.push([uid, j]);
    }
    if (!changed.length) return;
    saving = (async () => {
      try {
        if (remote) {
          const now = new Date().toISOString();
          await upsert(changed.map(([id, j]) => ({ id, data: JSON.parse(j), updated_at: now })));
        } else {
          const tmp = ACC_FILE + '.tmp';
          await fs.promises.writeFile(tmp, JSON.stringify({ users, sessions: legacySessions }));
          await fs.promises.rename(tmp, ACC_FILE);
        }
        for (const [uid, j] of changed) savedJson[uid] = j;
      } catch (e) {
        log('저장 실패: ' + e.message);
      }
    })();
    await saving;
    saving = null;
  }
  function save() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; flush(); }, 1500);
  }
  // 처음에 파일에서 읽은 건 이미 저장된 상태
  for (const uid in users) savedJson[uid] = JSON.stringify(users[uid]);

  async function check() {
    if (!remote) return 'file';
    const r = await fetch(`${SB_URL}/rest/v1/accounts?select=id&limit=1`, { headers: H() });
    if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 200));
    return 'supabase';
  }

  return { users, get, save, flush, makeToken, readToken, remote, check };
};
