// 길끼리 겹치는 곳(지름길 입구/출구 등)의 높이 차 검사: node tools/checkjunctions.js
const W = require('../public/world.js');
let bad = 0;
for (const t of W.arenas) {
  const roads = [t, ...t.alts];
  for (const r of roads) for (const o of roads) {
    if (r === o) continue;
    const m = r.path.length, n = o.path.length;
    let worst = 0, wi = -1;
    for (let j = 0; j < m; j++) {
      const p = r.path[j];
      let bd = 1e9, bi = 0;
      for (let i = 0; i < n; i++) { const q = o.path[i], dd = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (dd < bd) { bd = dd; bi = i; } }
      const d = Math.sqrt(bd);
      if (d > o.hw[bi] + r.hw[j]) continue; // 노면이 안 겹침
      const de = Math.abs(r.ey[j] - o.ey[bi]);
      if (de > 4) continue; // 다리 위/아래 (서로 다른 층)
      if (de > worst) { worst = de; wi = j; }
    }
    if (worst > 0.35) { bad++; console.log(t.id, r === t ? 'main' : 'alt' + t.alts.indexOf(r), 'vs', o === t ? 'main' : 'alt' + t.alts.indexOf(o), '높이차', worst.toFixed(2), '@', wi); }
  }
}
console.log(bad ? bad + '곳 높이 어긋남' : '겹치는 곳 높이 OK');
