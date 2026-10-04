const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../miniprogram');

function makeWord(payload) {
  const now = new Date().toISOString();
  return {
    id: 'word-persisted',
    user_id: 'user-1',
    term: payload.term,
    normalized_term: payload.term.toLowerCase(),
    lemma: payload.lemma,
    phonetic: payload.phonetic || null,
    audio_url: payload.audio_url || null,
    parts: payload.parts || [],
    primary_meaning: payload.primary_meaning,
    contextual_meaning: null,
    english_definition: payload.english_definition || null,
    example_en: payload.example_en || null,
    example_zh: payload.example_zh || null,
    first_context: payload.context || null,
    first_source_url: payload.source_url || null,
    first_source_title: payload.source_title || null,
    notes: '',
    custom_meaning: null,
    status: 'new',
    strength: 0,
    ease_factor: 2.5,
    interval_days: 0,
    repetitions: 0,
    lapses: 0,
    lookup_count: 1,
    error_count: 0,
    due_at: now,
    last_reviewed_at: null,
    mastered_at: null,
    created_at: now,
    updated_at: now,
    activated_at: null,
    is_capture: true,
  };
}

function harness(database = { words: [] }) {
  const memory = new Map();
  const modules = new Map();
  const calls = [];
  const session = { userId: 'user-1' };
  const gateway = {
    getSession: () => session,
    rpc: async (name, args = {}) => {
      calls.push({ name, args });
      if (name === 'save_word') {
        const existing = database.words.find((word) => word.normalized_term === args.p_payload.term.toLowerCase());
        if (existing) return existing;
        const word = makeWord(args.p_payload);
        database.words.push(word);
        return word;
      }
      if (name === 'hc_list_words' || name === 'hc_get_study_queue') return database.words;
      if (name === 'hc_home_summary') {
        return {
          due_count: 0,
          new_count: database.words.length,
          new_available: database.words.length,
          total_words: database.words.length,
          daily_goal: 20,
          streak_days: 0,
          reviewed_today: 0,
          activated_count: 0,
          activated_this_week: 0,
        };
      }
      if (name === 'hc_apply_review') {
        return { word: database.words.find((word) => word.id === args.p_word_id), activated_at: null, newly_activated: false };
      }
      throw new Error(`unexpected rpc: ${name}`);
    },
    select: async () => [],
  };
  const wx = {
    getStorageSync: (key) => (memory.has(key) ? structuredClone(memory.get(key)) : ''),
    setStorageSync: (key, value) => memory.set(key, structuredClone(value)),
    removeStorageSync: (key) => memory.delete(key),
  };

  function load(relative) {
    const file = path.isAbsolute(relative) ? relative : path.resolve(root, relative);
    if (file === path.join(root, 'services/gateway.ts')) return gateway;
    if (modules.has(file)) return modules.get(file).exports;
    if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(file, 'utf8'));
    const module = { exports: {} };
    modules.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const localRequire = (request) => {
      const resolved = path.resolve(path.dirname(file), request);
      return load(fs.existsSync(resolved) ? resolved : `${resolved}.ts`);
    };
    vm.runInNewContext(code, {
      module,
      exports: module.exports,
      require: localRequire,
      wx,
      console,
      Date,
      Math,
      Promise,
      Number,
      Error,
      setTimeout,
      clearTimeout,
      encodeURIComponent,
    }, { filename: file });
    return module.exports;
  }

  return { calls, database, load, memory };
}

const lookupResult = {
  term: 'benchmark',
  lemma: 'benchmark',
  phonetic: '/ˈbentʃmɑːrk/',
  parts: [{ partOfSpeech: 'n.', meaning: '基准' }],
  primaryMeaning: '基准',
  contextualMeaning: '基准',
  englishDefinition: 'a standard used for comparison',
  exampleEnglish: 'This result is our benchmark.',
  exampleChinese: '这个结果是我们的基准。',
  sentence: '',
  audioUrl: null,
};

test('发布包不再包含我的生词 Mock 数据路径', () => {
  const service = fs.readFileSync(path.join(root, 'services/words.ts'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'pages/words/words.ts'), 'utf8');
  assert.doesNotMatch(service, /words\.mock|USING_LOCAL_MOCK|mockWords/);
  assert.doesNotMatch(page, /USING_LOCAL_MOCK|localMockSummary/);
  assert.equal(fs.existsSync(path.join(root, 'services/words.mock.ts')), false);
});

test('查词收词后，重进仍从服务端读取同一 wordId 并交给复习', async () => {
  const database = { words: [] };
  const firstRun = harness(database);
  const storage = firstRun.load('services/storage.ts');
  storage.writeCache(storage.SK.WORDS_CACHE + '.recent', [{ wordId: 'stale-word' }]);
  storage.writeCache(storage.SK.PLAN_CACHE, { total_words: 0 });
  storage.writeCache(storage.SK.CARDS_CACHE, [{ wordId: 'stale-word' }]);

  const saved = await firstRun.load('services/lookup.ts').addWord(lookupResult);
  assert.equal(saved.id, 'word-persisted');
  assert.equal(storage.readCacheStale(storage.SK.WORDS_CACHE + '.recent'), null);
  assert.equal(storage.readCacheStale(storage.SK.PLAN_CACHE), null);
  assert.equal(storage.readCacheStale(storage.SK.CARDS_CACHE), null);

  // 新建运行环境模拟关闭小程序后重进：本地内存为空，只有服务端事实保留。
  const reopened = harness(database);
  const words = reopened.load('services/words.ts');
  const learning = reopened.load('services/learning.ts');
  const listed = await words.fetchWords('recent');
  const queue = await learning.fetchStudyQueue();

  assert.equal(listed.data[0].wordId, saved.id);
  assert.equal(listed.data[0].pos, 'n.');
  assert.equal(queue.data[0].wordId, saved.id);
  assert.equal(queue.data[0].pos, 'n.');
  learning.submitReview(queue.data[0], 2, 800);
  await learning.flushReviews();

  const rpcNames = reopened.calls.map((call) => call.name);
  assert.deepEqual(rpcNames, ['hc_list_words', 'hc_get_study_queue', 'hc_apply_review']);
  assert.equal(reopened.calls[2].args.p_word_id, saved.id);
});
