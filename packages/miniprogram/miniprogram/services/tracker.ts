// 埋点。《执行方案》§7 + §4.5。
//
// 「没有埋点，§8 的所有指标都是空话。」
// 攒批 + 在一轮学习结束时随 hc_ RPC 一次性 flush，**不为埋点单独发请求**。

import * as gw from './gateway';
import * as store from './storage';
import { uuid } from '../utils/uuid';
import type { EventName } from '../shared/events';

interface BufferedEvent {
  name: string;
  props: Record<string, unknown>;
  client_ts: string;
  session_id: string;
  platform: 'mp';
}

const MAX_BUFFER = 200;
let sessionId = '';

export function startSession(): string {
  sessionId = uuid();
  return sessionId;
}

export function track(name: EventName, props: Record<string, unknown> = {}): void {
  if (!sessionId) startSession();
  const buf = store.read<BufferedEvent[]>(store.SK.EVENT_BUFFER, []);
  buf.push({
    name,
    props,
    client_ts: new Date().toISOString(),
    session_id: sessionId,
    platform: 'mp',
  });
  // 攒太多说明一直没 flush 成功，丢最老的，别把 storage 撑爆
  store.write(store.SK.EVENT_BUFFER, buf.slice(-MAX_BUFFER));
}

/** 埋点失败**永远不抛**——它不该影响任何用户可见的流程。 */
export async function flush(): Promise<void> {
  const buf = store.read<BufferedEvent[]>(store.SK.EVENT_BUFFER, []);
  if (buf.length === 0) return;
  if (!gw.isLoggedIn()) return;
  try {
    await gw.rpc<number>('hc_track', { p_events: buf });
    const after = store.read<BufferedEvent[]>(store.SK.EVENT_BUFFER, []);
    store.write(store.SK.EVENT_BUFFER, after.slice(buf.length));
  } catch (e) {
    console.warn('[track] flush 失败，留着下次', e);
  }
}
