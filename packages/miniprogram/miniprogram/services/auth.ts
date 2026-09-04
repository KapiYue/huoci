// 登录与账号绑定。`design.md` §5.3 S0 + §14.1 T2/T3。
//
// 两个并列入口，不是分叉流程：
//   [微信一键登录]  新用户默认路径。wx.login 静默取 code → 网关 code2session
//                   → service_role 查/建 auth user（按 openid 派生服务端密码）→ 原生 session
//   [我有词鲸账号]  邮箱 + 密码，直打 /auth/v1/token?grant_type=password，零后端开发
//
// ⚠️ **无论走哪条路径都要先 wx.login 拿 openid 并存下**（§5.3 的红字）。
//    msgSecCheck v2 必传 openid；邮箱登录的老用户若没走过 wx.login，网关手里没有 openid，
//    一调 AI 内容就炸。这里用 attachOpenid() 兜住，**极易漏，别删**。

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
 * 路径一：微信一键登录。**S0 传空对象** —— §5.3 S0 要的是「一次点击」，
 * 插一个头像/昵称授权弹层就变成三次。昵称由网关兜底成 '微信用户'（T3），
 * 想改去「我的」（S8）。参数留着是为了 S8 那条路复用同一个函数。
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
  // 邮箱路径同样要把 openid 挂上去，否则 msgSecCheck 没得用
  await attachOpenid();
  return session;
}

/**
 * 把当前微信 openid 绑到已登录的 auth user 上（写 hc_wechat_identities）。
 * 失败**不抛**——它不该挡住登录，只该让 AI 相关功能在用到时报错。
 */
export async function attachOpenid(): Promise<void> {
  try {
    const code = await getWxCode();
    const res = await gw.wxApi<{ openid: string }>('/attach', { code });
    store.write(store.SK.OPENID, res.openid);
  } catch (e) {
    console.warn('[auth] attachOpenid 失败，AI 内容审核会不可用', e);
  }
}

export function logout(): void {
  gw.setSession(null);
  store.remove(store.SK.OPENID);
  store.remove(store.SK.PLAN_CACHE);
  store.remove(store.SK.CARDS_CACHE);
  store.remove(store.SK.HC_PROFILE);
  // ⚠️ 故意不清 REVIEW_QUEUE：没补发的复习是用户真花时间做的，留着下次登录补
}

export const isLoggedIn = gw.isLoggedIn;
export const getSession = gw.getSession;
