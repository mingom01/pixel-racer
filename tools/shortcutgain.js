// 지름길로 가면 몇 초 빨라지는지 (봇 운전 모델, 지름길 하나당): node tools/shortcutgain.js
const W = require('../public/world.js'), GP = require('../public/gp_rules.js')({ W, broadcast() {}, save() {}, profileOf() {}, log() {}, records: () => ({}) });
const lap = (t, car, alt) => { const BI = GP._bot.botInfoOf(t), b = { car, lv: 'hard', skill: 1, plain: !alt }, p = { s: 0, v: 20, lane: 0, alt: null, laps: [] }; let time = 0, now = 0; while (p.s < t.length && time < 900) { GP._bot.botMove(p, b, t, BI, 0.05, now, 0); time += 0.05; now += 50; } return time; };
const cars = (process.argv[2] || 'hatch,avante,gtr,bolide').split(',');
for (const t of W.arenas) {
  if (!t.alts.length) continue;
  console.log(t.id.padEnd(12), cars.map(c => c + ' ' + ((lap(t, c, false) - lap(t, c, true)) / t.alts.length).toFixed(1) + 's').join('  '));
}
