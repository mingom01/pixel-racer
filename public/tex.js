// 16x16 픽셀 텍스처 생성 (캔버스)
import * as THREE from './lib/three.module.min.js';

const R = WORLD.rng(1234);
const hex = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const pick = arr => arr[Math.floor(R() * arr.length)];

export function canvasOf(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d'), img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const col = fn(x, y);
    const i = (y * w + x) * 4;
    const rgb = typeof col === 'string' ? hex(col) : col;
    img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = rgb[3] === undefined ? 255 : rgb[3];
  }
  g.putImageData(img, 0, 0);
  return c;
}
export function tex(canvas, rx, ry) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (rx) t.repeat.set(rx, ry || rx);
  return t;
}
const noise = pal => () => pick(pal);

export const CANVAS = {};

export function makeTextures() {
  const T = {};
  const asph = ['#45464c', '#4a4b51', '#404147', '#4f5057', '#47484e'];

  CANVAS.grass = canvasOf(16, 16, noise(['#5ea83a', '#56a034', '#66b041', '#4f9530', '#5ea83a', '#6cb847', '#5ea83a']));
  T.grass = tex(CANVAS.grass);
  T.dirt = tex(canvasOf(16, 16, () => R() < 0.02 ? '#9a8e78' : pick(['#8b6a45', '#846440', '#916f48', '#7c5e3c', '#8b6a45'])));
  T.walk = tex(canvasOf(16, 16, (x, y) => (x % 8 === 0 || y % 8 === 0) ? '#98968e' : pick(['#b8b6ae', '#b2b0a8', '#bebcb4'])));
  T.asphalt = tex(canvasOf(16, 16, noise(asph)));
  T.roadCity = tex(canvasOf(32, 16, (x, y) => {
    if (x === 1 || x === 30) return pick(['#dedcd4', '#e8e6de']);
    if ((x === 15 || x === 16) && y < 8) return pick(['#e8c040', '#f0c848']);
    return pick(asph);
  }));
  T.roadTrack = tex(canvasOf(44, 16, (x, y) => {
    if (x === 1 || x === 42) return pick(['#dedcd4', '#e8e6de']);
    return pick(asph);
  }));
  T.curb = tex(canvasOf(4, 16, (x, y) => y < 8 ? pick(['#d83a3a', '#cc3434']) : pick(['#f0f0f0', '#e4e4e4'])));
  T.checker = tex(canvasOf(16, 16, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? '#1e1e22' : '#f2f2f2'));
  T.plank = tex(canvasOf(16, 16, (x, y) => {
    if (y % 4 === 3) return '#6a4a2a';
    if ((x + (y >> 2) * 5) % 16 === 0) return '#6a4a2a';
    return pick(['#b0844e', '#a67c48', '#b88c54', '#a27644']);
  }));
  T.hazard = tex(canvasOf(16, 16, (x, y) => ((x + y) >> 2) % 2 ? '#222222' : '#f2c230'));
  T.concrete = tex(canvasOf(16, 16, (x, y) => (x === 0 || y === 0) ? '#8a8a86' : pick(['#a8a8a2', '#a2a29c', '#aeaea8'])));
  T.stone = tex(canvasOf(16, 16, (x, y) => ((y % 8 === 0) || ((x + (y >> 3) * 4) % 8 === 0)) ? '#5c5c5c' : pick(['#8a8a8a', '#7e7e7e', '#949494', '#848484'])));
  T.bark = tex(canvasOf(16, 16, (x) => x % 4 === 0 ? '#4a3420' : pick(['#6b4a2c', '#634428', '#735030'])));
  T.leaves = tex(canvasOf(16, 16, () => R() < 0.08 ? '#2a5a1c' : pick(['#3e8a2c', '#4a9a34', '#36802a', '#44922f', '#529e3a'])));
  T.roof = tex(canvasOf(16, 16, noise(['#6e6e6c', '#767674', '#686866', '#7c7c78'])));
  T.boost = tex(canvasOf(16, 16, (x, y) => {
    const yy = (y + Math.abs(x - 7.5) * 1) % 8;
    if (x < 2 || x > 13) return '#2a2a2e';
    return yy < 3 ? '#ffb030' : (yy < 4 ? '#ff7020' : '#3a2a22');
  }));
  T.coin = tex(canvasOf(16, 16, (x, y) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d > 7.6) return '#a06a10';
    if (d > 6.2) return '#c8901c';
    if ((x === 5 || x === 6) && y > 3 && y < 12) return '#fff2a0';
    if (x > 6 && x < 10 && y > 4 && y < 11) return '#d8a020';
    return pick(['#f0c030', '#f4c838', '#ecbc2c']);
  }));
  T.gem = tex(canvasOf(16, 16, (x, y) => {
    if ((x + y) % 7 === 0) return '#c8fff0';
    return pick(['#30d890', '#28c880', '#3ae8a0', '#20b070']);
  }));
  T.water = tex(canvasOf(16, 16, noise(['#3a78c8', '#3a70c0', '#4480d0', '#3a78c8'])));

  // 건물 창문 텍스처 3종 (4m 한 칸)
  const wall = ['#e8e8e8', '#e0e0e0', '#ececec', '#dcdcdc'];
  T.win = [
    tex(canvasOf(16, 16, (x, y) => {
      if (y >= 2 && y <= 12 && x >= 1 && x <= 14 && x !== 7 && x !== 8) return (x + y) % 9 === 0 ? '#bcd8f0' : pick(['#3a5a7a', '#34506e', '#40648a']);
      return pick(wall);
    })),
    tex(canvasOf(16, 16, (x, y) => {
      if (y >= 4 && y <= 10 && ((x >= 2 && x <= 5) || (x >= 10 && x <= 13))) {
        if (x === 3 || x === 11) return '#a8c8e0';
        return R() < 0.15 ? '#f0d890' : pick(['#2c3c4c', '#34465a']);
      }
      if (y === 11 && ((x >= 1 && x <= 6) || (x >= 9 && x <= 14))) return '#9a9a9a';
      return pick(wall);
    })),
    tex(canvasOf(16, 16, (x, y) => {
      if (y >= 3 && y <= 11 && x >= 4 && x <= 11) return (x === 5 && y < 7) ? '#b8d4ec' : pick(['#34465a', '#2c3c4c']);
      if (y % 4 === 0 || ((x + (y >> 2) * 4) % 8 === 0)) return '#9c9c9c';
      return pick(['#d4d4d4', '#dcdcdc', '#cccccc']);
    })),
  ];

  // 유리 커튼월 (색 입힘)
  T.glass = tex(canvasOf(16, 16, (x, y) => {
    if (x % 8 === 0 || y % 5 === 0) return pick(['#8a9098', '#949aa2']);
    if ((x + y * 2) % 13 < 2) return '#f4f8fc';
    return pick(['#dde8f2', '#e6eef6', '#d4e0ec']);
  }));
  // 아파트 (발코니 줄무늬, 4m 에 한 층 + 난간)
  T.apt = tex(canvasOf(16, 16, (x, y) => {
    if (y === 15 || y === 7) return '#9a9a9a';
    if (y >= 9 && y <= 13 || (y >= 1 && y <= 5)) {
      if (x === 0 || x === 8) return '#d8d8d8';
      if (y === 5 || y === 13) return '#c8c8c8';
      return (x + y) % 11 === 0 ? '#a8c0d8' : pick(['#4a5a6a', '#42525e', '#54687a']);
    }
    return pick(['#f4f4f4', '#ececec', '#f0f0f0']);
  }));
  T.brick = tex(canvasOf(16, 16, (x, y) => {
    if (y % 4 === 3 || (x + (y >> 2) * 4) % 8 === 0) return '#b8b4ac';
    if (y >= 5 && y <= 10 && x >= 3 && x <= 12 && x !== 7 && x !== 8) return y === 5 ? '#bcd4ec' : pick(['#34465a', '#2c3c4c']);
    return pick(['#e0e0e0', '#d4d4d4', '#dadada', '#cccccc']);
  }));
  T.shopfront = tex(canvasOf(16, 16, (x, y) => {
    if (y <= 1) return '#3a3a3a';
    if (y >= 3 && y <= 14 && x >= 1 && x <= 14) {
      if (x >= 6 && x <= 9 && y >= 5) return x === 6 || x === 9 ? '#5a5a5a' : '#8ab0c8';
      if (x === 1 || x === 14 || y === 3) return '#5a5a5a';
      return (x + y) % 9 === 0 ? '#e8f4ff' : pick(['#9ec4dc', '#a8cce0', '#f0e0a0']);
    }
    return pick(['#f4f4f4', '#e8e8e8']);
  }));
  T.plaster = tex(canvasOf(16, 16, (x, y) => {
    if (y >= 5 && y <= 10 && x >= 4 && x <= 11) {
      if (x === 4 || x === 11 || y === 5 || y === 10 || x === 7 || x === 8) return '#f8f8f8';
      return pick(['#5a7a9a', '#6a8aaa']);
    }
    if (y === 15) return '#b0b0b0';
    return pick(['#ffffff', '#f4f4f4', '#f8f8f8']);
  }));
  T.roofTile = tex(canvasOf(16, 16, (x, y) => {
    if (y % 4 === 3) return '#808080';
    if ((x + (y >> 2) * 2) % 4 === 0) return '#a8a8a8';
    return pick(['#e8e8e8', '#dcdcdc', '#f0f0f0']);
  }));
  T.barn = tex(canvasOf(16, 16, (x, y) => {
    if (y === 0 || y === 15) return '#f0f0f0';
    if (x % 4 === 0) return '#6a1a14';
    return pick(['#a82a20', '#b03028', '#9c261c']);
  }));
  T.stripe = tex(canvasOf(16, 16, (x) => (x >> 2) % 2 ? '#ffffff' : pick(['#9a9a9a', '#a0a0a0'])));
  T.sand = tex(canvasOf(16, 16, () => pick(['#e6cf96', '#dcc48a', '#ecd6a0', '#d8be84'])));
  // 활주로: 양쪽 흰 선 + 가운데 긴 점선
  T.runway = tex(canvasOf(48, 32, (x, y) => {
    if (x === 2 || x === 45) return '#f2f2f2';
    if ((x === 23 || x === 24) && y < 20) return '#f2f2f2';
    return pick(['#3a3b40', '#3e3f44', '#36373c']);
  }));
  T.crowd = tex(canvasOf(16, 16, (x, y) => y % 4 === 3 ? '#6a6a6a' : pick(['#d83a3a', '#3a6fd8', '#f2c230', '#f2f2f2', '#3aa64a', '#2a2a2e', '#e0782a', '#f0c8a0'])));
  T.grate = tex(canvasOf(16, 16, (x, y) => (x % 4 === 0 || y % 4 === 0) ? '#6a6a6a' : pick(['#8a8a8a', '#909090'])));
  return T;
}

// 간판 텍스처 (픽셀 글씨)
export function signTexture(text, bg, fg) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = '12px Galmuri11, monospace';
  const w = Math.max(40, Math.ceil(g.measureText(text).width) + 14);
  c.width = w; c.height = 18;
  g.fillStyle = bg; g.fillRect(0, 0, w, 18);
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 16, w, 2);
  g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(0, 0, w, 1);
  g.font = '12px Galmuri11, monospace';
  g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillStyle = 'rgba(0,0,0,.5)'; g.fillText(text, w / 2 + 1, 10);
  g.fillStyle = fg || '#ffffff'; g.fillText(text, w / 2, 9);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  t.userData = { aspect: w / 18 };
  return t;
}

// 텍스트 스프라이트용 캔버스 (픽셀 폰트)
export function textCanvas(text, color, bg) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = '12px Galmuri11, monospace';
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 10;
  c.width = w; c.height = 18;
  g.font = font;
  g.imageSmoothingEnabled = false;
  g.fillStyle = bg || 'rgba(0,0,0,0.55)';
  g.fillRect(0, 0, w, 18);
  g.textBaseline = 'middle';
  g.fillStyle = '#000';
  g.fillText(text, 6, 10);
  g.fillStyle = color || '#fff';
  g.fillText(text, 5, 9);
  return c;
}
