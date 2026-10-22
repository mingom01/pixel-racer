// 배포 전에 실행: node bump.js
// 브라우저가 예전 파일과 새 파일을 섞어 쓰지 않도록 모든 스크립트/스타일 주소에 ?v=버전 을 붙인다.
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'public');
const v = Date.now().toString(36);
const names = 'net-config|world|gp_rules|game|gp|models|tex|audio|local';
const fix = (file, re) => {
  const p = path.join(dir, file), s = fs.readFileSync(p, 'utf8'), out = s.replace(re, (m, a, b) => `${a}?v=${v}${b}`);
  if (out !== s) fs.writeFileSync(p, out);
};
fix('index.html', new RegExp(`((?:src|href)="(?:${names}|style)\\.(?:js|css))(?:\\?v=\\w+)?(")`, 'g'));
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fix(f, new RegExp(`(from '\\./(?:${names})\\.js)(?:\\?v=\\w+)?(')`, 'g'));
console.log('version', v);
