// 登录与账号绑定。`design.md` §5.3 S0 + §14.1 T2/T3。
//
// 两个并列入口，不是分叉流程：
//   [微信一键登录]  新用户默认路径。wx.login 静默取 code → 网关 code2session
//                   → service_role 查/建 auth user（按 openid 派生服务端密码）→ 原生 session
//   [我有词鲸账号]  邮箱 + 密码，直打 /auth/v1/token?grant_type=password，零后端开发
//
// 两条登录路径都记录微信 openid，保证账号身份映射完整。

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

interface WxLoginResponse {
  openid: string;
  unionid: string | null;
  session: SupabaseTokenResponse;
}

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

export function getOpenid(): string | null {
  return store.read<string | null>(store.SK.OPENID, null);
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
  store.write(store.SK.OPENID, res.openid);
  const session = toSession(res.session, 'wechat');
  gw.setSession(session);
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
  gw.setSession(session);
  // 邮箱路径同样补齐微信身份映射。
  await attachOpenid();
  return session;
}

/**
 * 把当前微信 openid 绑到已登录的 auth user 上（写 hc_wechat_identities）。
 * 失败不抛：补充微信身份映射不应阻断邮箱登录。
 */
export async function attachOpenid(): Promise<void> {
  try {
    const code = await getWxCode();
    const res = await gw.wxApi<{ openid: string }>('/attach', { code });
    store.write(store.SK.OPENID, res.openid);
  } catch (e) {
    console.warn('[auth] attachOpenid 失败，微信身份映射暂未补齐', e);
  }
}

export function logout(): void {
  gw.setSession(null);
  store.remove(store.SK.OPENID);
  store.clearAccountData();
  // ⚠️ 故意不清 REVIEW_QUEUE：条目已带 userId，下一账号不会补发；
  // 原账号再登录时仍能继续。
}

export const isLoggedIn = gw.isLoggedIn;
export const getSession = gw.getSession;
