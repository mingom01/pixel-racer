// 구간 레이스: 자유 주행 맵 곳곳의 초록 게이트를 지나면 타임어택 시작 → 체크 게이트 → 도착
import * as THREE from './lib/three.module.min.js';
import { signTexture } from './tex.js';

const W = WORLD;
const $ = id => document.getElementById(id);
let X = null;
let SEC = null;        // 진행 중인 구간 { s, k(다음 체크 번호), t0 }
let cool = 0;          // 끝난 직후 바로 다시 시작되지 않게
const hinted = {};
let lastHtml = '';

export function initSections(ctx) {
  X = ctx;
  for (const s of W.sections) {
    X.worldRoot.add(arch(s, 0, true));
    X.worldRoot.add(arch(s, s.path.length - 1, false));
  }
  $('resClose').addEventListener('click', () => clearTimeout(resTimer));
}

// 시작(초록, 이름 간판) / 도착(체크무늬) 아치
function arch(s, i, start) {
  const p = s.path[i], tg = s.tan[i], g = new THREE.Group();
  g.position.set(p[0], W.groundHeight(p[0], p[1]), p[1]);
  g.rotation.y = Math.atan2(tg[0], tg[1]);
  const half = s.w / 2 + 1.5, w = half * 2 + 0.8;
  const post = new THREE.MeshLambertMaterial({ color: start ? 0x3aa64a : 0xf2f2f2 });
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 6.5, 0.8), post);
    m.position.set(sx * half, 3.25, 0); m.castShadow = true;
    g.add(m);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, 0.6), post);
  bar.position.y = 6.5; bar.castShadow = true;
  g.add(bar);
  if (start) {
    const tex = signTexture('구간: ' + s.name, '#2a7a2a');
    const h = Math.min(2.2, (w - 1) / tex.userData.aspect);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(h * tex.userData.aspect, h), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    sign.position.y = 6.5 + 0.3 + h / 2;
    g.add(sign);
  } else {
    const fin = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.4), new THREE.MeshBasicMaterial({ map: X.T.checker, side: THREE.DoubleSide }));
    fin.position.y = 7.5;
    g.add(fin);
  }
  return g;
}

function hud(show) {
  $('racebox').classList.toggle('hidden', !show);
  if (!show) { lastHtml = ''; $('racebox').innerHTML = ''; }
}
function start(s, now) {
  SEC = { s, k: 0, t0: now };
  X.sfx.go();
  X.bigText(s.name, 1300, true);
  X.toast('구간 시작! 게이트를 따라 도착까지 달려요');
  hud(true);
}
function finish(now) {
  const s = SEC.s, time = now - SEC.t0;
  SEC = null; cool = now + 4000;
  X.send({ t: 'secDone', id: s.id, time });
  X.sfx.finish();
  X.bigText('도착! ' + X.fmtTime(time), 2000, true);
  X.gate.visible = false;
  hud(false);
}
function cancel(msg) {
  if (!SEC) return;
  SEC = null; cool = performance.now() + 3000;
  X.gate.visible = false;
  hud(false);
  if (msg) X.toast(msg, true);
}
export function cancelSection() { cancel('구간 도전을 포기했어요'); }
export function inSection() { return !!SEC; }

// 매 프레임 (자유 주행 방에서만). 진행 중이면 true
export function sectionStep(now) {
  const car = X.car, G = X.G;
  if (G.screen !== 'play' || X.GP.active || G.race || !car.model) {
    if (SEC) cancel(G.race ? '레이스가 시작돼서 구간 도전이 취소됐어요' : '');
    return false;
  }
  if (!SEC) {
    if (now < cool) return false;
    for (const s of W.sections) {
      const p = s.path[0], tg = s.tan[0], d = Math.hypot(car.x - p[0], car.z - p[1]);
      if (d < 45 && d > 18 && !(hinted[s.id] > now)) { hinted[s.id] = now + 90000; X.toast(`구간 레이스 '${s.name}' — 초록 게이트를 지나면 시작!`); }
      if (d < s.w * 0.6 && car.vx * tg[0] + car.vz * tg[1] > 3) { start(s, now); break; }
    }
    return false;
  }
  const s = SEC.s, cp = s.path[s.cps[SEC.k]];
  const d = Math.hypot(car.x - cp[0], car.z - cp[1]);
  if (d < s.w * 0.85) {
    SEC.k++;
    if (SEC.k >= s.cps.length) { finish(now); return false; }
    X.sfx.cp();
  } else if (d > 320 || now - SEC.t0 > 300000) { cancel('코스를 너무 벗어나서 구간 도전이 취소됐어요'); return false; }
  const idx = s.cps[SEC.k], np = s.path[idx], tg = s.tan[idx], last = SEC.k === s.cps.length - 1;
  const gate = X.gate;
  gate.visible = true;
  gate.position.set(np[0], W.groundHeight(np[0], np[1]), np[1]);
  gate.rotation.y = Math.atan2(tg[0], tg[1]);
  gate.setWidth(s.w + 3);
  gate.setColor(last ? 0xffd84a : 0x7aff7a);
  const best = X.G.me.sec && X.G.me.sec[s.id];
  const html = `<div><span class="k">구간</span>${X.esc(s.name)}</div>
    <div><span class="k">시간</span>${X.fmtTime(now - SEC.t0).slice(0, -1)}</div>
    <div><span class="k">체크</span>${SEC.k}/${s.cps.length}</div>
    <div><span class="k">내 기록</span>${best ? X.fmtTime(best) : '-'}</div>`;
  if (html !== lastHtml) { $('racebox').innerHTML = html; lastHtml = html; }
  return true;
}

/* ---------- 서버 응답 ---------- */
let resTimer = null;
function showTable(title, rowsHtml, autoHide) {
  $('resTitle').textContent = title;
  $('resTable').innerHTML = rowsHtml;
  $('results').classList.remove('hidden');
  clearTimeout(resTimer);
  if (autoHide) resTimer = setTimeout(() => $('results').classList.add('hidden'), autoHide);
}
export function onSecMsg(m) {
  if (m.t === 'secRes') {
    const s = W.sectionById[m.id];
    X.gainPop('+' + m.coins);
    if (m.record) { X.bigText('구간 신기록!', 2500, true); X.sfx.lap(); }
    else if (m.pb) X.toast('개인 최고 기록!');
    const rows = m.top.map((r, i) => `<tr class="${r.name === X.G.me.name && r.time === m.best ? 'me' : ''}"><td>${i + 1}위</td><td>${X.esc(r.name)}</td><td>${X.fmtTime(r.time)}</td></tr>`).join('');
    const mine = `<tr><td colspan="3" style="border:0;padding-top:8px">이번 기록 <b>${X.fmtTime(m.time)}</b> · 내 최고 ${X.fmtTime(m.best)} · <b>+${m.coins} 코인</b>${m.record ? ' (신기록 보너스!)' : (m.pb ? ' (개인 최고 보너스)' : '')}</td></tr>`;
    showTable(`구간 기록 · ${s ? s.name : ''}`, rows + mine, 9000);
  } else if (m.t === 'secAll') {
    const rows = W.sections.map(s => {
      const top = (m.top[s.id] || [])[0], mine = m.mine[s.id];
      return `<tr><td>${X.esc(s.name)}<br><span class="muted">${(s.length / 1000).toFixed(2)}km · 보상 ${s.reward}</span></td><td>${top ? '1위 ' + X.esc(top.name) + '<br>' + X.fmtTime(top.time) : '<span class="muted">기록 없음</span>'}</td><td>${mine ? '내 기록<br>' + X.fmtTime(mine) : '<span class="muted">도전 전</span>'}</td></tr>`;
    }).join('');
    showTable('구간 레이스 기록 (지도에서 체크무늬 깃발)', rows, 0);
  }
}
