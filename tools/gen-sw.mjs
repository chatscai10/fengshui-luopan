// tools/gen-sw.mjs  用法: node tools/gen-sw.mjs [--check] [根目錄] [sw.js 路徑]
// 掃描 index.html / manifest / icons / css / src,重寫 sw.js 的 VERSION(內容雜湊)與 PRECACHE。
// --check 只比對不寫入,過期就 exit 1(可掛進 npm test,避免漏更新導致線上卡舊版或安裝失敗)。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const check = args[0] === '--check';
if (check) args.shift();
const root = path.resolve(args[0] || '.');
const swPath = path.resolve(args[1] || path.join(root, 'sw.js'));

const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
const files = [
  'index.html', 'manifest.webmanifest',
  ...walk('icons').filter((f) => f.endsWith('.png')),
  ...walk('css').filter((f) => f.endsWith('.css')),
  ...walk('src').filter((f) => f.endsWith('.js')),
].sort();

const hash = crypto.createHash('sha1');
for (const f of files) {
  hash.update(f);
  // 換行統一成 LF,Windows 與 CI 算出同一個版本號
  hash.update(fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n'));
}
const version = hash.digest('hex').slice(0, 10);

const before = fs.readFileSync(swPath, 'utf8');
const list = ['./', ...files].map((f) => `  '${f}',`).join('\n');
const after = before
  .replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`)
  .replace(/(\/\/ <PRECACHE>)[\s\S]*?(\n\s*\/\/ <\/PRECACHE>)/, `$1\n${list}$2`);

if (after === before) { console.log(`sw.js 已是最新(${files.length + 1} 個檔案,版本 ${version})`); process.exit(0); }
if (check) { console.error('sw.js 過期:請執行 node tools/gen-sw.mjs'); process.exit(1); }
fs.writeFileSync(swPath, after);
console.log(`sw.js 已更新(${files.length + 1} 個檔案,版本 ${version})`);
