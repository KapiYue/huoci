/** 「2 小时前」这类相对时间。§6.3 要求来源比释义更需要被看见，时间是来源的一半。 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day === 1) return '昨天';
  if (day < 30) return `${day} 天前`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} 个月前`;
  return `${Math.floor(month / 12)} 年前`;
}

/** 从 URL 抽一个人类可读的站点名，作为 source_title 缺失时的兜底 */
export function hostLabel(url: string | null | undefined): string {
  if (!url) return '';
  const m = /^https?:\/\/([^/:?#]+)/i.exec(url);
  if (!m || !m[1]) return '';
  return m[1].replace(/^www\./, '');
}
