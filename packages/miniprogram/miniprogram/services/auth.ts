// 登录与账号绑定。`design.md` §5.3 S0 + §14.1 T2/T3。
//
// 两个并列入口，不是分叉流程：
//   [微信一键登录]  新用户默认路径。wx.login 静默取 code → 网关 code2session
//                   → service_role 查/建 auth user（按 openid 派生服务端密码）→ 原生 session
//   [我有词鲸账号]  邮箱 + 密码，直打 /auth/v1/token?grant_type=password，零后端开发
//
// 微信身份映射仅由网关维护；客户端不保存 openid / unionid 等身份凭据。

import * as gw from './gateway';
import * as store from './storage';
import { ApiError } from './types';
import type { Session } from './types';

interface SupabaseTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: {
    id: string;
    email: string | null;
    user_metadata?: { display_name?: string; avatar_url?: string };
  };
}

interface WxLoginResponse { session: SupabaseTokenResponse; }
interface AccountLinkResponse { session: SupabaseTokenResponse; linked: boolean; }

export const ACCOUNT_LINK_CONFIRMATION_VERSION = '2026-11-06';

function toSession(r: SupabaseTokenResponse, provider: Session['provider']): Session {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: Date.now() + r.expires_in * 1000,
    userId: r.user.id,
    email: r.user.email,
    // T3 的实现约束：建 user 时网关必须把昵称塞进 raw_user_meta_data.display_name，
    // 否则 handle_new_user 的兜底 split_part(NULL,'@',1) 会让昵称为空。
    displayName: r.user.user_metadata?.display_name || '微信用户',
    avatarUrl: r.user.user_metadata?.avatar_url || null,
    provider,
  };
}

/** 切换账号时先清除上一账号的可缓存数据；同一账号刷新会话时不动缓存。 */
function saveSession(session: Session): void {
  const previous = gw.getSession();
  if (previous && previous.userId !== session.userId) store.clearAccountData();
  gw.setSession(session);
}

/** wx.login 拿一次性 code。code 五分钟有效且只能用一次。 */
function getWxCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (res.code) resolve(res.code);
        else reject(new ApiError('client', 0, '微信登录失败，请重试'));
      },
      fail: () => reject(new ApiError('network', 0, '微信登录失败，请检查网络')),
    });
  });
}

/**
 * 路径一：微信快捷登录。S0 先按 React 原型收集用户选择的展示昵称，
 * 再把昵称随真实 wx.login code 交给网关；头像仍由服务端/后续账号设置处理。
 */
export async function loginWithWeChat(profile: {
  nickname?: string;
  avatarUrl?: string;
}): Promise<Session> {
  const code = await getWxCode();
  const res = await gw.wxApi<WxLoginResponse>(
    '/login',
    { code, nickname: profile.nickname, avatar_url: profile.avatarUrl },
    true
  );
  const session = toSession(res.session, 'wechat');
  saveSession(session);
  return session;
}

/** 路径二：老词鲸用户用邮箱 + 密码登录。**不提供注册**（词鲸强制邮箱验证，转化必死）。 */
export async function loginWithPassword(email: string, password: string): Promise<Session> {
  const res = await gw.request<SupabaseTokenResponse>('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
    anonymous: true,
  });
  const session = toSession(res, 'password');
  saveSession(session);
  // 正式关联必须由“关联词鲸账号”入口完成双重验证。不得在普通邮箱登录时
  // 自动调用旧版 /wx/attach，否则一个已有微信独立账号会被误判为第三方冲突。
  return session;
}

/**
 * 以新的微信 code 为当前已登录账号补齐服务端身份映射。
 * 失败不抛：旧客户端的兼容映射不应阻断邮箱登录。
 */
export async function attachOpenid(): Promise<void> {
  try {
    const code = await getWxCode();
    await gw.wxApi<{ idempotent: boolean }>('/attach', { code });
  } catch (e) {
    console.warn('[auth] attachOpenid 失败，微信身份映射暂未补齐', e);
  }
}

/** 当前会话是否处于微信与词鲸账号的已关联状态。 */
export async function getAccountLinkStatus(): Promise<{ linked: boolean }> {
  return gw.wxApi<{ linked: boolean }>('/account-link/status', {});
}

/**
 * 主动关联：同一请求内使用新的微信 code 和词鲸密码完成双重控制权验证。
 * 密码只交给认证端点，不写入存储、日志或错误消息。
 */
export async function confirmAccountLink(email: string, password: string): Promise<Session> {
  const code = await getWxCode();
  const response = await gw.wxApi<AccountLinkResponse>('/account-link/confirm', {
    code,
    email,
    password,
    confirmed: true,
    confirmation_version: ACCOUNT_LINK_CONFIRMATION_VERSION,
  });
  const session = toSession(response.session, 'wechat');
  saveSession(session);
  return session;
}

/** 解绑会复制当前规范账号数据回微信账号，并切换到解绑后的微信账号会话。 */
export async function unlinkAccount(): Promise<Session> {
  const code = await getWxCode();
  const response = await gw.wxApi<AccountLinkResponse>('/account-link/unlink', {
    code,
    confirmed: true,
    confirmation_version: ACCOUNT_LINK_CONFIRMATION_VERSION,
  });
  const session = toSession(response.session, 'wechat');
  saveSession(session);
  return session;
}

export function logout(): void {
  gw.setSession(null);
  store.clearAccountData();
  // ⚠️ 故意不清 REVIEW_QUEUE：条目已带 userId，下一账号不会补发；
  // 原账号再登录时仍能继续。
}

export const isLoggedIn = gw.isLoggedIn;
export const getSession = gw.getSession;
