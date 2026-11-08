// 봇 랩타임 vs 사람 물리 자동주행 랩타임 비교: node tools/botcal.js [car]
const W = require('../public/world.js'), makeGP = require('../public/gp_rules.js'), { lapTime } = require('./playersim.js');
const GP = makeGP({ W, broadcast() {}, save() {}, profileOf() {}, log() {}, records: () => ({}) });
const car = process.argv[2] || 'gtr', tracks = process.argv[3] ? process.argv[3].split(',') : W.arenas.map(a => a.id);
const sum = { easy: 0, normal: 0, hard: 0 }; let cnt = 0;
for (const tr of tracks) {
  const pl = lapTime(tr, car).time;
  if (!pl) continue;
  const row = [tr.padEnd(12), pl.toFixed(1)];
  for (const lv of ['easy', 'normal', 'hard']) { let t = 0; for (let k = 0; k < 4; k++) t += GP.botLapTest(tr, car, lv); t /= 4; sum[lv] += t / pl; row.push(t.toFixed(1) + ' (' + (t / pl).toFixed(2) + ')'); }
  cnt++; console.log(row.join('  '));
}
console.log('평균 비율', Object.entries(sum).map(([k, v]) => k + ' ' + (v / cnt).toFixed(3)).join('  '));
