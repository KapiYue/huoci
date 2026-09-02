// 流式 CSV 解析器。零依赖。
// ECDICT 的 definition/translation 字段带引号且内含逗号与转义换行，
// 必须按字符状态机解析，不能 split(',')。
//
// ⚠️ 性能约束（2026-09-01 重写）：输入是 241MB / 约 340 万行。
// 原实现用 `for (i...) field += chunk[i]` 逐字符拼串，在这个体量上是**不可完成**的
// ——每个字符都要新建一个单字符字符串再做 rope 拼接，实测跑到 40% 就 GC 抖死。
// 现在改成「扫到分隔符再整段 slice」：分配次数从 O(字符数) 降到 O(字段数)。
import { createReadStream } from 'node:fs';

const COMMA = 44;   // ,
const QUOTE = 34;   // "
const LF = 10;      // \n
const CR = 13;      // \r

/**
 * 逐行读 CSV，回调每一行（已按表头映射成对象）。
 * onRow **可以返回 Promise**——返回了就会被 await，用来传递写入端的背压。
 * @param {string} file
 * @param {(row: Record<string,string>, lineNo: number) => void | Promise<void>} onRow
 * @returns {Promise<{header: string[], count: number}>}
 */
export async function readCsv(file, onRow) {
  const stream = createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 });

  let header = null;
  let field = '';
  let row = [];
  let inQuotes = false;
  // 引号正好落在 chunk 末尾时，要看下一个 chunk 的首字符才知道是 `""` 转义还是引号结束
  let pendingQuote = false;
  let count = 0;

  const push = (s) => {
    // \r 只会出现在 CRLF 的行尾，逐字符判太贵，整段查一次便宜得多
    field += s.indexOf('\r') === -1 ? s : s.replace(/\r/g, '');
  };

  const endField = () => {
    row.push(field);
    field = '';
  };

  const endRow = async () => {
    endField();
    if (row.length === 1 && row[0] === '') { row = []; return; }  // 空行
    if (!header) {
      header = row.map((h) => h.trim().replace(/^﻿/, ''));
      row = [];
      return;
    }
    const obj = {};
    for (let i = 0; i < header.length; i++) obj[header[i]] = row[i] ?? '';
    count++;
    const r = onRow(obj, count);
    if (r && typeof r.then === 'function') await r;   // 背压
    row = [];
  };

  for await (const chunk of stream) {
    const n = chunk.length;
    let i = 0;

    if (pendingQuote) {
      pendingQuote = false;
      if (chunk.charCodeAt(0) === QUOTE) { field += '"'; i = 1; }
      else { inQuotes = false; }
    }

    while (i < n) {
      if (inQuotes) {
        const j = chunk.indexOf('"', i);
        if (j === -1) { push(chunk.slice(i)); i = n; break; }
        push(chunk.slice(i, j));
        if (j + 1 >= n) { pendingQuote = true; i = n; break; }
        if (chunk.charCodeAt(j + 1) === QUOTE) { field += '"'; i = j + 2; }
        else { inQuotes = false; i = j + 1; }
        continue;
      }

      // 字段开头的引号才是「带引号字段」的开始；字段中间的引号是普通字符
      if (field === '' && row.length >= 0 && chunk.charCodeAt(i) === QUOTE) {
        inQuotes = true;
        i++;
        continue;
      }

      // 扫到下一个 , 或 \n。charCodeAt 不分配，比 chunk[i] 快一个数量级
      let j = i;
      while (j < n) {
        const c = chunk.charCodeAt(j);
        if (c === COMMA || c === LF) break;
        j++;
      }

      if (j > i) push(chunk.slice(i, j));
      if (j >= n) { i = n; break; }

      if (chunk.charCodeAt(j) === COMMA) { endField(); i = j + 1; }
      else { await endRow(); i = j + 1; }
    }
  }

  if (field !== '' || row.length) await endRow();
  return { header: header ?? [], count };
}
