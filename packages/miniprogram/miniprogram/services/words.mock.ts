// 「我的生词」页面的本地展示样例。
//
// 数据刻意分成两类：
//   1. 首启添加：刚收进 / 学习中 / 已记住各一条；
//   2. 场景收录：UI 原型里的每一种来源各一条，不重复来源。
//
// 页面仍消费 StudyCard，未来接回接口时只需关闭 words.ts 里的 mock 开关。

import type { StudyCard } from '../shared/types';
import { wordStatus } from '../shared/wordStatus';

const audio = (term: string) =>
  `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(term)}&type=2`;

function card(
  wordId: string,
  term: string,
  phonetic: string,
  pos: string,
  meaning: string,
  contextSentence: string | null,
  contextSource: string,
  repetitions: number,
  interval: number,
  activatedAt: string | null = null
): StudyCard {
  return {
    wordId,
    term,
    phonetic,
    pos,
    meaning,
    contextSentence,
    contextSource,
    exampleEn: contextSentence,
    exampleZh: null,
    audioUrl: audio(term),
    repetitions,
    interval,
    activatedAt,
  };
}

export const MOCK_WORDS: StudyCard[] = [
  // 首启添加：三个核心状态各一条。
  card('mock-base-captured', 'telemetry', '/təˈlemətri/', 'n.', '遥测数据，监控埋点指标', null, '首启添加', 0, 0),
  card('mock-base-learning', 'scaffold', '/ˈskæfəʊld/', 'v. / n.', '脚手架；快速搭建初始骨架', null, '首启添加', 1, 1),
  card('mock-base-remembered', 'immutable', '/ɪˈmjuːtəbl/', 'adj.', '不可变的，不能更改的', null, '首启添加', 3, 8),

  // 非首启添加：原型中的每一种来源只保留一条。
  card('mock-github', 'implement', '/ˈɪmplɪment/', 'v.', '实施，贯彻；实现（功能/接口）', 'We need to implement this feature before Friday.', 'GitHub · 2 小时前', 1, 1),
  card('mock-stripe-docs', 'mitigate', '/ˈmɪtɪɡeɪt/', 'v.', '减轻，缓解（风险/影响）', 'Mitigate the potential risk by adding strict rate limits.', 'Stripe Docs · 昨天', 3, 8),
  card('mock-product-hunt', 'retention', '/rɪˈtenʃn/', 'n.', '留存，保留（率）', 'The cohort retention rate improved by 14% this month.', 'Product Hunt · 3 天前', 5, 22, '2026-08-29T10:00:00Z'),
  card('mock-stripe-api', 'idempotent', '/ˌaɪdɪmˈpəʊtənt/', 'adj.', '幂等的（多次执行结果不变）', 'Ensure payment webhooks are strictly idempotent to prevent double charge.', 'Stripe API · 4 天前', 3, 8),
  card('mock-go-docs', 'concurrency', '/kənˈkɜːrənsi/', 'n.', '并发，并发性', 'Handle high concurrency safely with mutex locks and channel queues.', 'Go Docs · 5 天前', 5, 25, '2026-08-27T12:00:00Z'),
  card('mock-cloudflare', 'latency', '/ˈleɪtnsi/', 'n.', '延迟，等待时间', 'Reduce p99 API latency across regional edge servers.', 'Cloudflare Blog · 6 天前', 5, 24, '2026-08-26T09:00:00Z'),
  card('mock-aws', 'resilient', '/rɪˈzɪliənt/', 'adj.', '有弹性的，具备容灾自愈能力的', 'Design a resilient architecture that degrades gracefully during outages.', 'AWS Architecture · 1 周前', 6, 28, '2026-08-25T15:00:00Z'),
  card('mock-openapi', 'deprecate', '/ˈdeprəkeɪt/', 'v.', '废弃，声明弃用（旧接口/版本）', 'This legacy authentication endpoint will be deprecated next month.', 'OpenAPI Spec · 2 周前', 5, 21, '2026-08-18T11:00:00Z'),
  card('mock-supabase', 'granular', '/ˈɡrænjələr/', 'adj.', '细粒度的，详细的', 'Set granular access permissions for different team members.', 'Supabase RLS Guide · 2 周前', 5, 25, '2026-08-17T13:00:00Z'),
  card('mock-react', 'reconcile', '/ˈrekənsaɪl/', 'v.', '调和，对账；React 虚拟 DOM 协调比对', 'React reconciles the fiber tree to calculate minimal DOM mutations.', 'React Docs · 3 周前', 6, 35, '2026-08-10T16:00:00Z'),
  card('mock-postgresql', 'bottleneck', '/ˈbɒtlnek/', 'n.', '瓶颈，阻碍整体性能的关键限制点', 'Database write locks are the primary bottleneck under heavy load.', 'PostgreSQL Manual · 3 周前', 6, 42, '2026-08-08T12:00:00Z'),
  card('mock-fastapi', 'asynchronous', '/eɪˈsɪŋkrənəs/', 'adj.', '异步的', 'Use asynchronous task queues for time-consuming image processing.', 'FastAPI Tutorial · 1 个月前', 7, 50, '2026-08-01T11:00:00Z'),
  card('mock-kafka', 'throughput', '/ˈθruːpʊt/', 'n.', '吞吐量，单位时间处理能力', 'The message broker achieves a throughput of 50k events per second.', 'Kafka Architecture · 1 个月前', 6, 40, '2026-07-28T15:00:00Z'),
  card('mock-nextjs', 'fallback', '/ˈfɔːlbæk/', 'n. / v.', '后备方案，回退策略', 'Provide a graceful fallback when network requests timeout.', 'Next.js Routing · 1 个月前', 5, 30, '2026-07-25T11:00:00Z'),
];

export function mockWords(filter: 'recent' | 'due' | 'activated'): StudyCard[] {
  if (filter === 'due') {
    return MOCK_WORDS.filter((item) => {
      const status = wordStatus(item);
      return status === 'captured' || status === 'learning';
    });
  }
  if (filter === 'activated') {
    return MOCK_WORDS.filter((item) => {
      const status = wordStatus(item);
      return status === 'activated' || status === 'mastered';
    });
  }
  return MOCK_WORDS.slice();
}

export function mockWordsSummary(): { total: number; activated: number } {
  return {
    total: MOCK_WORDS.length,
    activated: MOCK_WORDS.filter((item) => {
      const status = wordStatus(item);
      return status === 'activated' || status === 'mastered';
    }).length,
  };
}
