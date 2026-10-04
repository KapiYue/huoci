/**
 * 微信首发版功能边界。
 *
 * 未完成能力只关闭入口，不删除页面与服务代码。后续版本必须在真实链路、隐私
 * 和审核文案都通过验收后，才可以逐项改为 true。
 */
export const RELEASE_FEATURES = {
  membership: false,
  payment: false,
  aiPractice: false,
  aiQuota: false,
  leaderboard: false,
  friendPk: false,
  wordPacks: false,
  lookup: true,
  savedWords: true,
  review: true,
  reader: true,
} as const;

export type ReleaseFeature = keyof typeof RELEASE_FEATURES;

/** 隐藏功能即使被旧分享链接或开发工具直接打开，也回到首发版首页。 */
export function guardReleaseFeature(feature: ReleaseFeature): boolean {
  if (RELEASE_FEATURES[feature]) return false;
  wx.reLaunch({ url: '/pages/today/today' });
  return true;
}
