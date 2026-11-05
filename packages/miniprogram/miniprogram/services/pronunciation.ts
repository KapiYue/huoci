/**
 * 为缺少词库音频的新旧词条提供同一份美音地址。
 *
 * 小程序的 request 合法域名中必须包含 dict.youdao.com；播放失败由调用页的
 * InnerAudioContext.onError 负责提示，不能静默地让喇叭看似可用却没有声音。
 */
export function pronunciationUrl(audioUrl: string | null | undefined, term: string): string {
  return audioUrl || `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(term)}&type=2`;
}
