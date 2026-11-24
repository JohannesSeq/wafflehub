import { build } from 'esbuild';
import { readFile, readdir, mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
const assets = {};
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json' };
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await scan(filename);
    else assets['/' + path.relative('dist/client', filename).split(path.sep).join('/')] = { data: (await readFile(filename)).toString('base64'), type: mime[path.extname(filename)] || 'application/octet-stream' };
  }
}
await scan('dist/client');
await mkdir('dist/server', { recursive: true });
await build({ entryPoints: ['server/worker.ts'], outfile: 'dist/server/index.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, plugins: [{ name: 'embedded-assets', setup(builder) { builder.onResolve({ filter: /worker-assets$/ }, () => ({ path: 'assets', namespace: 'embed' })); builder.onLoad({ filter: /.*/, namespace: 'embed' }, () => ({ contents: 'export const assets = ' + JSON.stringify(assets), loader: 'js' })); } }] });
await mkdir('dist/.openai', { recursive: true });
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
await writeFile('dist/server/wrangler.json', JSON.stringify({ name: 'waffle-companion', main: 'index.js', compatibility_date: '2026-11-01' }));
console.log('Built portable Worker with ' + Object.keys(assets).length + ' embedded assets.');
