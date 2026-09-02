// 网关请求层。**所有**请求都经这里，业务代码不许直接调 wx.request。
//
// 《执行方案》§14.1 T8：nginx 唯一入口 + location 分流
//   /auth/v1  /rest/v1  → 无状态透传到词鲸 Supabase
//   /wx/*                → 本机 Flask（AppSecret、openid 映射、msgSecCheck）
//
// §14.4 自律清单第 1 条：**禁止裸 REST 写 words**，写操作一律走 rpc()。

import { ENV } from '../config/env';
import { ApiError } from './types';
import type { ApiErrorKind } from './types';
import * as store from './storage';
import type { Session } from './types';

const TIMEOUT_MS = 20000;

// ⚠️ **小程序的 wx.request 不支持 PATCH**（方法白名单里根本没有）。
// 这意味着 PostgREST 的 `PATCH /rest/v1/<table>` 这条更新路径在小程序端**用不了**，
// 所有更新必须走 RPC —— 与 §14.4 第 1 条「禁止裸 REST 写 words」正好同向，
// 但适用面更广：连 hc_ 自己的表也得给个 RPC，不能指望 PATCH。
type Method = 'GET' | 'POST' | 'DELETE';

interface RequestOptions {
  method?: Method;
  body?: unknown;
  /** 不带 Authorization（登录、刷新 token 这类请求） */
  anonymous?: boolean;
  /** 内部用：401 刷新后重放时置 true，避免无限递归 */
  _retried?: boolean;
  timeout?: number;
}

function kindOf(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'ratelimit';
  if (status >= 500) return 'server';
  return 'client';
}

function messageOf(status: number, body: unknown): string {
  const b = body as { message?: string; error_description?: string; msg?: string } | null;
  const raw = b?.message || b?.error_description || b?.msg;
  if (raw) return raw;
  if (status === 429) return '请求太频繁了，缓一下再试';
  if (status >= 500) return '服务暂时不可用';
  return `请求失败（${status}）`;
}

/** 刷新 token 的单飞锁：一次断网恢复会有一堆请求同时 401，不能各刷各的 */
let refreshing: Promise<Session | null> | null = null;

export function getSession(): Session | null {
  return store.read<Session | null>(store.SK.SESSION, null);
}

export function setSession(s: Session | null): void {
  if (s) store.write(store.SK.SESSION, s);
  else store.remove(store.SK.SESSION);
}

export function isLoggedIn(): boolean {
  return getSession() !== null;
}

async function refreshSession(): Promise<Session | null> {
  const current = getSession();
  if (!current) return null;

  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await request<{
          access_token: string;
          refresh_token: string;
          expires_in: number;
          user: { id: string; email: string | null; user_metadata?: { display_name?: string } };
        }>('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          body: { refresh_token: current.refreshToken },
          anonymous: true,
        });
        const next: Session = {
          accessToken: res.access_token,
          refreshToken: res.refresh_token,
          expiresAt: Date.now() + res.expires_in * 1000,
          userId: res.user.id,
          email: res.user.email,
          displayName: res.user.user_metadata?.display_name || current.displayName,
          provider: current.provider,
        };
        setSession(next);
        return next;
      } catch {
        setSession(null);
        return null;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

export function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, anonymous = false, timeout = TIMEOUT_MS } = opts;
  const session = anonymous ? null : getSession();
  const started = Date.now();

  const header: Record<string, string> = {
    'content-type': 'application/json',
    apikey: ENV.SUPABASE_ANON_KEY,
  };
  if (session) header['Authorization'] = `Bearer ${session.accessToken}`;

  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: ENV.GATEWAY_BASE_URL + path,
      method,
      header,
      data: body as WechatMiniprogram.IAnyObject | undefined,
      timeout,
      enableHttp2: true,
      success: (res) => {
        if (ENV.DEBUG_TIMING) {
          console.log(`[gw] ${method} ${path} ${res.statusCode} ${Date.now() - started}ms`);
        }
        const status = res.statusCode;
        if (status >= 200 && status < 300) {
          resolve(res.data as T);
          return;
        }
        if (status === 401 && !anonymous && !opts._retried) {
          refreshSession()
            .then((next) => {
              if (!next) {
                reject(new ApiError('unauthorized', 401, '登录已失效，请重新登录', res.data));
                return;
              }
              resolve(request<T>(path, { ...opts, _retried: true }));
            })
            .catch(reject);
          return;
        }
        reject(new ApiError(kindOf(status), status, messageOf(status, res.data), res.data));
      },
      fail: (err) => {
        if (ENV.DEBUG_TIMING) {
          console.warn(`[gw] ${method} ${path} FAIL ${Date.now() - started}ms`, err.errMsg);
        }
        reject(new ApiError('network', 0, '网络不给力，已为你保留进度', err));
      },
    });
  });
}

/**
 * 调 Postgres RPC。**所有写操作走这里**（§14.4 第 1 条）。
 * Supabase 的 RPC 一律是 POST /rest/v1/rpc/<name>。
 */
export function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  return request<T>(`/rest/v1/rpc/${name}`, { method: 'POST', body: args });
}

/** 只读的 REST 查询。写操作**不许**用它。 */
export function select<T>(path: string): Promise<T> {
  return request<T>(`/rest/v1/${path}`, { method: 'GET' });
}

/** 打本机 Flask 的 /wx/* —— AppSecret、openid 映射、内容审核都在那边 */
export function wxApi<T>(path: string, body: unknown, anonymous = false): Promise<T> {
  return request<T>(`/wx${path}`, { method: 'POST', body, anonymous });
}
