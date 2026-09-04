// 首启的数据层。`design.md` §5.3（S1–S3）。
//
// 抽样与播种的**算法**在 `shared/onboarding.ts`（纯函数、有单测），这里只管：
// 读词包 → 调算法 → 存结果 → 落库 → 埋点。
//
// **先本地、后服务端**，不是图省事：S3 那一屏点完「完成」必须立刻出结果，
// 40 秒的预算里没有一次往返的位置，而地铁里那次往返还可能是 8 秒。
// 落库走 `hc_save_onboarding`（`packages/db/migrations/202609020005_hc_save_onboarding.sql`），
// 失败就留着 `syncedAt` 为空，下次进「今日」再补 —— 见 sync()。
//
// ⚠️ 为什么非得是 RPC：`wx.request` 没有 `PATCH`，而 PostgREST 的更新只走
//    `PATCH /rest/v1/<table>`，小程序**物理上写不了任何表**（`design.md` §11 ③/④）。

import * as store from './storage';
import { rpc } from './gateway';
import {
  parseBasePack,
  sampleOnboardingWords,
  seedWords,
  type BaseWord,
  type BaseWordRow,
} from '../shared/onboarding';

interface BasePack {
  count: number;
  words: BaseWordRow[];
  license: string;
  licenseUrl: string;
  authors: string;
}

export const SK_ONBOARDING = 'hc.onboarding';

export interface OnboardingResult {
  /** 仅埋点用，**不影响任何算法**（§5.3 S1 明确写了要诚实标注） */
  scenes: string[];
  levelLine: number;
  /** 播种的 20 个词，顺序 = frq 升序，服务端按这个顺序拉开 created_at */
  seeded: string[];
  isHighLevel: boolean;
  doneAt: string;
  /** 落库成功的时间。空 = 还只在本地，下次进「今日」会重试 */
  syncedAt?: string;
}

let cache: BaseWord[] | null = null;

/**
 * 读本地底座词表。93KB / 4553 词，同步读一次缓存在内存里。
 *
 * 用 `require` 而不是 `wx.getFileSystemManager`：JSON 走 require 会被打进代码包，
 * 不额外占一次 IO，也不会在真机上碰到路径问题。
 */
export function loadBasePool(): BaseWord[] {
  if (cache) return cache;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pack = require('../assets/base-words.json') as BasePack;
  cache = parseBasePack(pack.words);
  return cache;
}

/** 开源许可页要显示的署名（CC BY-SA 4.0 的义务，不是可选项） */
export function attribution(): { license: string; licenseUrl: string; authors: string } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pack = require('../assets/base-words.json') as BasePack;
  return { license: pack.license, licenseUrl: pack.licenseUrl, authors: pack.authors };
}

/** S2 的 30 道题 */
export function sampleQuestions(): BaseWord[] {
  return sampleOnboardingWords(loadBasePool());
}

/** S3：由勾选结果算出 level_line 与播种词，落本地 */
export function finish(scenes: string[], checked: BaseWord[]): OnboardingResult {
  const { words, levelLine, isHighLevel } = seedWords(loadBasePool(), checked);
  const result: OnboardingResult = {
    scenes,
    levelLine,
    seeded: words.map((w) => w.spelling),
    isHighLevel,
    doneAt: new Date().toISOString(),
  };
  store.write(SK_ONBOARDING, result);
  return result;
}

export function read(): OnboardingResult | null {
  return store.read<OnboardingResult | null>(SK_ONBOARDING, null);
}

/**
 * S1 勾的场景。词包 tab 的「推荐给你」按它出 ——
 * S1 那一屏此前只用于埋点，词包上线后它第一次真正影响界面。
 */
export function selectedScenes(): string[] {
  const r = read();
  return r ? r.scenes : [];
}

interface SaveOnboardingResponse {
  first_run: boolean;
  seeded_count: number;
  ignored_starter_count: number;
  onboarding_done_at: string;
}

/**
 * 把本地首启结果落到服务端。`hc_save_onboarding`（`0005`）。
 *
 * 幂等在**服务端**：判据是 `hc_profiles.onboarding_done_at` 而不是本地标记，
 * 所以重复调用不会播出第二批 20 个词。这里可以放心重试。
 *
 * 返回 true 表示「已经在服务端了」（本次落库成功，或之前就成功过）。
 * 失败只 warn 不抛：首启已经在本地生效，网络问题不该把用户拦在 S3。
 */
export async function sync(): Promise<boolean> {
  const local = read();
  if (!local) return false;
  if (local.syncedAt) return true;
  try {
    const res = await rpc<SaveOnboardingResponse>('hc_save_onboarding', {
      p_scenes: local.scenes,
      p_level_line: local.levelLine,
      p_seed_terms: local.seeded,
    });
    store.write(SK_ONBOARDING, { ...local, syncedAt: new Date().toISOString() });
    console.info(
      `[onboarding] 已落库：播种 ${res.seeded_count} 词，忽略新手词 ${res.ignored_starter_count} 个`
    );
    return true;
  } catch (e) {
    console.warn('[onboarding] 落库失败，下次进「今日」再补', e);
    return false;
  }
}

/** 本地视角的「首启做完了没」。服务端视角在 login.ts 的 needsOnboarding()。 */
export function isDone(): boolean {
  return read() !== null;
}

export function reset(): void {
  store.remove(SK_ONBOARDING);
}

/**
 * 路由守卫（§5.3 结尾）：首启没做完时，进任何 tab 都强制跳回首启。
 *
 * 每个 tab 页的 onShow 调一次。返回 true 表示**已经跳走了**，调用方应立刻 return，
 * 不要再往下拉数据 —— 那些请求打出去也是白打，还会在跳转途中报错。
 *
 * ⚠️ 未登录不拦：那是登录页的事，两件事不要混在一个守卫里。
 */
export function guard(): boolean {
  if (isDone()) return false;
  wx.reLaunch({ url: '/pages/onboarding/onboarding' });
  return true;
}
