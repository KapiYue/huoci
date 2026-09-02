// 离线写队列。《执行方案》§14.1 T1-c：核心场景是通勤/地铁，纯 server-authoritative
// 瘦客户端在那里直接不可用。提交 review 一律：**先入队 → UI 立即响应 → 后台补发**。
//
// §14.4 第 4 条：每条必带 client_event_id。词鲸侧 apply_review 收到重复键直接返回
// 上一次结果、不重算调度（见 supabase/migrations 的 client_event_id 幂等改造）。
// 没有这个键，网络抖动重放会把同一次复习算两遍，interval / ease 直接算错。

import * as gw from './gateway';
import * as store from './storage';
import { ApiError } from './types';
import type { CijingWord } from '../shared/types';
import { EXERCISE_TYPE_SELF_RATING } from '../shared/rating';

export interface QueuedReview {
  clientEventId: string;
  wordId: string;
  quality: number;
  exerciseType: string;
  responseTimeMs: number | null;
  /** 入队时刻，仅用于排序与展示，不参与幂等 */
  queuedAt: number;
  /** 连续失败次数。达到上限就不再自动重试，等下次手动触发 */
  attempts: number;
}

const MAX_ATTEMPTS = 8;

export function peek(): QueuedReview[] {
  return store.read<QueuedReview[]>(store.SK.REVIEW_QUEUE, []);
}

export function pendingCount(): number {
  return peek().length;
}

function save(q: QueuedReview[]): void {
  store.write(store.SK.REVIEW_QUEUE, q);
}

export function enqueue(item: Omit<QueuedReview, 'queuedAt' | 'attempts'>): void {
  const q = peek();
  // 同一个 clientEventId 只入一次
  if (q.some((x) => x.clientEventId === item.clientEventId)) return;
  q.push({ ...item, queuedAt: Date.now(), attempts: 0 });
  save(q);
}

async function send(item: QueuedReview): Promise<CijingWord> {
  const res = await gw.rpc<CijingWord | CijingWord[]>('apply_review', {
    p_word_id: item.wordId,
    p_quality: item.quality,
    p_exercise_type: item.exerciseType,
    p_response_time_ms: item.responseTimeMs,
    p_client_event_id: item.clientEventId,
  });
  return Array.isArray(res) ? (res[0] as CijingWord) : res;
}

let flushing = false;

export interface FlushResult {
  sent: number;
  remaining: number;
  /** 因为断网停下的（不是失败，是等下次） */
  offline: boolean;
  words: CijingWord[];
}

/**
 * 串行补发。**必须串行**：同一个词的连续两次复习顺序颠倒会算出不同的 interval。
 * 遇到网络错误立刻停手，剩下的留在队列里；遇到业务错误（4xx）丢弃该条，
 * 否则一条脏数据会把整个队列永久堵死。
 */
export async function flush(): Promise<FlushResult> {
  if (flushing) return { sent: 0, remaining: pendingCount(), offline: false, words: [] };
  flushing = true;
  const words: CijingWord[] = [];
  let sent = 0;
  let offline = false;

  try {
    let q = peek();
    while (q.length > 0) {
      const head = q[0] as QueuedReview;
      try {
        words.push(await send(head));
        sent++;
        q = peek().slice(1);
        save(q);
      } catch (e) {
        const err = e as ApiError;
        if (err.kind === 'network' || err.kind === 'ratelimit' || err.kind === 'server') {
          head.attempts += 1;
          offline = err.kind === 'network';
          if (head.attempts >= MAX_ATTEMPTS) {
            console.error('[queue] 超过重试上限，丢弃', head);
            q = peek().slice(1);
          } else {
            q = peek();
            q[0] = head;
          }
          save(q);
          break; // 网络不通就别继续捶了
        }
        if (err.kind === 'unauthorized') {
          offline = true; // 当作「暂时发不出去」，登录后再补
          break;
        }
        // 4xx 业务错误：这条永远发不成功，丢掉，别堵住后面的
        console.error('[queue] 丢弃无法补发的条目', head, err.message);
        q = peek().slice(1);
        save(q);
      }
    }
  } finally {
    flushing = false;
  }

  return { sent, remaining: pendingCount(), offline, words };
}

export const SELF_RATING = EXERCISE_TYPE_SELF_RATING;
