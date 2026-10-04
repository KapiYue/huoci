// 内置阅读器（R1–R4）。还原对象：`docs/prototype/src/components/ReaderModal.tsx`。
//
// 它解决什么：微信新用户的 capture 恒为空 → 卡片只有拼写和音标 → 活词退化成普通背单词小程序。
// 阅读器与查词页是微信首发版的两个生词收录来源。
//
// 三条形态约束（不要做成别的样子）：
//   · 输入 = **粘贴文本**，不做「输入链接自动抓正文」
//   · 取词 = **点词，不是划词** —— 小程序拿不到选区，正文逐词渲染成可点元素
//   · 存储 = 只把**句子级片段**写云端；**正文留在本地**，不上传、不进云端的历史文章列表

import * as store from './storage';

export const MAX_CHARS = 5000;

export interface Token {
  /** 显示文本 */
  t: string;
  /** 可点 = 是个英文单词 */
  w: boolean;
  /** 归一化后的词（小写去标点），用于高亮匹配 */
  k: string;
  /** 所属句子的下标 —— 释义接口的入参是 {word, sentence} */
  s: number;
}

/**
 * 切成 token，**一次切完写进 data**；点词只改 selectedIndex，不重建数组（§14.3）。
 * 标点与空白也切成不可点 token，否则拼不回原文。
 * ⚠️ 词组（take on / carry out）点不了 —— 这是点词的固有损失，P3 认了。
 */
export function tokenize(text: string): { tokens: Token[]; sentences: string[] } {
  const sentences: string[] = [];
  const tokens: Token[] = [];

  let sentenceStart = 0;
  let sentenceIdx = 0;
  const re = /[A-Za-z][A-Za-z'’-]*|\s+|[^A-Za-z\s]+/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const piece = m[0];
    const isWord = /^[A-Za-z]/.test(piece);
    tokens.push({
      t: piece,
      w: isWord,
      k: isWord ? piece.toLowerCase().replace(/['’-]+$/, '') : '',
      s: sentenceIdx,
    });
    // 句号 / 问号 / 感叹号 / 换行收尾，就翻到下一句
    if (/[.!?。！？]/.test(piece) || /\n/.test(piece)) {
      sentences.push(text.slice(sentenceStart, m.index + piece.length).trim());
      sentenceStart = m.index + piece.length;
      sentenceIdx = sentences.length;
    }
  }
  if (sentenceStart < text.length) sentences.push(text.slice(sentenceStart).trim());

  return { tokens, sentences };
}

export interface ReadingRecord {
  title: string;
  /** 正文**只**存本地，用来「继续上次那篇」。云端一个字都不写 */
  text: string;
  capturedCount: number;
  at: number;
}

const SK_LAST = store.SK.READER_LAST;

export function lastReading(): ReadingRecord | null {
  return store.read<ReadingRecord | null>(SK_LAST, null);
}

export function saveReading(r: ReadingRecord): void {
  store.write(SK_LAST, r);
}
