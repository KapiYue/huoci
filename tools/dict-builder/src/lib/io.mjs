import { createWriteStream, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const ROOT = resolve(new URL('../..', import.meta.url).pathname);
export const P = (...s) => resolve(ROOT, ...s);

export function ensureDir(p) { mkdirSync(dirname(p), { recursive: true }); }
export function ensureDirSelf(p) { mkdirSync(p, { recursive: true }); }

// 攒批写。**必须 await 它返回的 Promise**，否则背压形同虚设：
// 340 万行不 await 的话，整份 word-lite 会先在内存里堆成几个 GB 再慢慢落盘。
// 攒批的第二个收益是 write() 调用次数降到 1/BATCH，syscall 开销随之下降。
const BATCH = 2000;

export class NdjsonWriter {
  constructor(file) {
    ensureDir(file);
    this.file = file;
    this.s = createWriteStream(file);
    this.n = 0;
    this.buf = [];
  }

  write(obj) {
    this.n++;
    this.buf.push(JSON.stringify(obj));
    if (this.buf.length >= BATCH) return this.flush();
  }

  flush() {
    if (this.buf.length === 0) return;
    const chunk = this.buf.join('\n') + '\n';
    this.buf.length = 0;
    if (!this.s.write(chunk)) return new Promise((r) => this.s.once('drain', r));
  }

  async close() {
    await this.flush();
    return new Promise((r) => this.s.end(r));
  }
}

export async function readNdjson(file, onRow) {
  const { createReadStream } = await import('node:fs');
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) { if (line) { onRow(JSON.parse(line), ++n); } }
  return n;
}

export function readJson(file) { return JSON.parse(readFileSync(file, 'utf8')); }
export function writeJson(file, obj, pretty = true) {
  ensureDir(file);
  writeFileSync(file, JSON.stringify(obj, null, pretty ? 2 : 0));
}
export function exists(p) { return existsSync(p); }

export const log = (...a) => console.log('  ', ...a);
export const step = (s) => console.log('\n\x1b[1m▶ ' + s + '\x1b[0m');
export const warn = (...a) => console.log('  \x1b[33m⚠\x1b[0m', ...a);
export const ok = (...a) => console.log('  \x1b[32m✓\x1b[0m', ...a);
export const fail = (...a) => console.log('  \x1b[31m✗\x1b[0m', ...a);
export const fmt = (n) => n.toLocaleString('en-US');
export const pct = (a, b) => (b === 0 ? '0.0%' : ((a / b) * 100).toFixed(1) + '%');
