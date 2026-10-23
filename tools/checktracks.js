// 경기장 검사: node tools/checktracks.js [id]
// 겹침(같은 높이에서 길끼리 너무 가까움), 다리 높이, 경사, 급커브, 낭떠러지 위치, 지름길 겹침을 확인
const W = require('../public/world.js');
const only = process.argv[2];
let total = 0;
const turnR = (r, i) => {
  const n = r.path.length, a = r.open ? Math.max(0, i - 2) : (i - 2 + n) % n, b = r.open ? Math.min(n - 1, i + 2) : (i + 2) % n;
  const t0 = r.tan[a], t1 = r.tan[b], ang = Math.acos(Math.max(-1, Math.min(1, t0[0] * t1[0] + t0[1] * t1[1])));
  const seg = Math.hypot(r.path[b][0] - r.path[a][0], r.path[b][1] - r.path[a][1]);
  return seg / Math.max(ang, 1e-6);
};
for (const t of W.arenas) {
  if (only && t.id !== only) continue;
  const n = t.path.length, step = t.length / n, issues = [];
  let minR = 1e9, minRi = 0;
  for (let i = 0; i < n; i++) { const R = turnR(t, i); if (R < minR) { minR = R; minRi = i; } }
  if (minR < 16) issues.push(`급커브 R=${minR.toFixed(0)} @${minRi}`);
  let maxS = 0, maxSi = 0;
  for (let i = 0; i < n; i++) { const sl = Math.abs(t.ey[(i + 1) % n] - t.ey[i]) / step; if (sl > maxS) { maxS = sl; maxSi = i; } }
  if (maxS > 0.2) issues.push(`경사 ${maxS.toFixed(2)} @${maxSi}`);
  const seen = new Set();
  const note = (k, msg) => { if (!seen.has(k)) { seen.add(k); issues.push(msg); } };
  // 본 코스끼리
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const di = Math.min(j - i, n - (j - i));
    if (di * step < 70) continue;
    const D = Math.hypot(t.path[i][0] - t.path[j][0], t.path[i][1] - t.path[j][1]);
    const de = Math.abs(t.ey[i] - t.ey[j]);
    if (D < t.wbs[i] + t.wbs[j] + 5 && de < 10) note('m' + Math.floor(i / 15) + ':' + Math.floor(j / 15), `겹침 ${i}~${j} D=${D.toFixed(0)} de=${de.toFixed(1)} @(${Math.round(t.path[i][0] - t.ox)},${Math.round(t.path[i][1])})`);
  }
  // 지름길
  t.alts.forEach((r, k) => {
    const m = r.path.length;
    for (let i = 2; i < m - 2; i++) { const R = turnR(r, i); if (R < 14) note('ar' + k, `지름길${k + 1} 급커브 R=${R.toFixed(0)} @${i}/${m}`); }
    for (let i = 0; i < m - 1; i++) { const sl = Math.abs(r.ey[i + 1] - r.ey[i]) / 5; if (sl > 0.22) note('as' + k, `지름길${k + 1} 경사 ${sl.toFixed(2)}`); }
    for (let i = Math.round(m * 0.22); i < m - Math.round(m * 0.22); i++) for (let j = 0; j < n; j++) {
      const near = Math.min(...[r.from, r.to].map(x => Math.min(Math.abs(j - x), n - Math.abs(j - x))));
      if (near < 14) continue;
      const D = Math.hypot(r.path[i][0] - t.path[j][0], r.path[i][1] - t.path[j][1]), de = Math.abs(r.ey[i] - t.ey[j]);
      if (D < r.wbs[i] + t.wbs[j] + 4 && de < 10) note('ao' + k + ':' + Math.floor(j / 15), `지름길${k + 1} 겹침 alt@${i}/${m} main@${j} D=${D.toFixed(0)}`);
    }
    const saved = (r.to - r.from + n) % n * step - r.length;
    if (saved < 30) note('sv' + k, `지름길${k + 1} 이 별로 안 짧음 (${saved.toFixed(0)}m)`);
  });
  // 낭떠러지
  t.gap.forEach((g, i) => { if (g && t.ey[i] < 8) note('g' + Math.floor(i / 20), `낮은 낭떠러지 @${i} e=${t.ey[i].toFixed(1)}`); });
  for (let i = 0; i < n; i++) if (t.gap[i] && !t.gap[(i - 1 + n) % n]) {
    let turn = 0; for (let k = -6; k < 8; k++) { const q0 = t.tan[(i + k + n) % n], q1 = t.tan[(i + k + 1 + n) % n]; turn += Math.acos(Math.max(-1, Math.min(1, q0[0] * q1[0] + q0[1] * q1[1]))); }
    if (turn > 0.3) issues.push(`낭떠러지가 커브 @${i} 회전=${turn.toFixed(2)}`);
  }
  if (t.cps.length < 10) issues.push(`체크포인트가 적음 ${t.cps.length}`);
  const shortcut = t.alts.map(r => ((r.to - r.from + n) % n * step - r.length).toFixed(0) + 'm').join(',');
  const hi = Math.max(...t.ey) - Math.min(...t.ey);
  total += issues.length;
  console.log(`${t.id.padEnd(13)} ${(t.length / 1000).toFixed(2)}km d${t.diff} R${minR.toFixed(0)} 높이차${hi.toFixed(0)} cps${t.cps.length} 지름길[${shortcut}] 터널${t.tunnels.length + t.alts.filter(r => r.tunnel).length} 섬${t.islands.length} ${issues.length ? '\n   ' + issues.join('\n   ') : 'OK'}`);
}
console.log(total ? `문제 ${total}개` : '모두 OK');
