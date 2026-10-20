/** 生成可分发 ZIP：dist/ → release/export-rednote-emoji_<version>.zip（Chrome/Edge 均可加载）。 */
import { readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync } from 'fflate';
import { readdirSync, statSync } from 'node:fs';

const here = import.meta.dirname;
const root = resolve(here, '..');
const dist = resolve(root, 'dist');
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;

if (!statSync(dist, { throwIfNoEntry: false })) {
  console.error('dist/ 不存在，请先执行 npm run build');
  process.exit(1);
}

const files = {};
function walk(dir, prefix = '') {
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) walk(full, rel);
    else files[rel] = new Uint8Array(readFileSync(full));
  }
}
walk(dist);

mkdirSync(resolve(root, 'release'), { recursive: true });
const out = resolve(root, `release/export-rednote-emoji_${version}.zip`);
const zipped = zipSync(files, { level: 9 });
rmSync(out, { force: true });
writeFileSync(out, zipped);
console.log(`packaged -> ${out.replace(root + '/', '')} (${Object.keys(files).length} files)`);
