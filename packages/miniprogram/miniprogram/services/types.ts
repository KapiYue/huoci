export interface Session {
  accessToken: string;
  refreshToken: string;
  /** 绝对过期时间（毫秒时间戳） */
  expiresAt: number;
  userId: string;
  email: string | null;
  displayName: string;
  /** 登录方式。绑定过词鲸账号的走 'password' */
  provider: 'wechat' | 'password';
}

export type ApiErrorKind =
  | 'network'      // 断网 / 超时 / 跨境抖动 —— 可重试，界面要说人话
  | 'unauthorized' // 401，刷新也救不回来 —— 回登录页
  | 'forbidden'    // 403，RLS 拦了
  | 'ratelimit'    // 429，网关单一 IP 的 per-IP 限流（未决项①的已知坑）
  | 'server'
  | 'client';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly body: unknown;
  constructor(kind: ApiErrorKind, status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.body = body;
  }
}
