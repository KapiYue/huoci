// Runs real TypeScript service code with isolated storage/RPC doubles. No network or user data.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../packages/miniprogram/miniprogram');
function harness() {
  const memory = new Map(), modules = new Map(), calls = [];
  let failStorage = false;
  const gateway = {
    rpc: async (name, args) => { calls.push({name,args}); return {word:{id:args?.p_word_id},newly_activated:false}; },
    setSession: s => s ? memory.set('hc.session',s) : memory.delete('hc.session'),
    getSession: () => memory.get('hc.session'), isLoggedIn: () => memory.has('hc.session'),
  };
  const wx = {getStorageSync:k => memory.has(k) ? structuredClone(memory.get(k)) : '',
    setStorageSync:(k,v) => {if(failStorage) throw Error('storage full'); memory.set(k,structuredClone(v));},
    removeStorageSync:k=>memory.delete(k)};
  function load(relative) {
    const file = path.resolve(root, relative);
    if (file === path.join(root,'services/gateway.ts')) return gateway;
    if (modules.has(file)) return modules.get(file).exports;
    if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(file,'utf8'));
    const module = {exports:{}}; modules.set(file,module);
    const code = ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
    const localRequire = p => {
      const resolved = path.resolve(path.dirname(file),p);
      return load(fs.existsSync(resolved) ? resolved : `${resolved}.ts`);
    };
    vm.runInNewContext(code,{module,exports:module.exports,require:localRequire,wx,console:{error(){},warn(){},info(){},log(){}},Date,Math,setTimeout,clearTimeout},{filename:file});
    return module.exports;
  }
  return {load,memory,gateway,calls,failWrites:()=>{failStorage=true;}};
}
const item = {clientEventId:'event-A',wordId:'word-A',quality:4,exerciseType:'self_rating',responseTimeMs:123};
test('底座词包：4553 唯一词，频段/频率合法，本地同步副本一致',()=>{
 const file=path.resolve(root,'assets/base-words.json'); const p=JSON.parse(fs.readFileSync(file));
 assert.equal(p.count,4553); assert.equal(p.words.length,p.count); assert.equal(new Set(p.words.map(x=>x[0])).size,p.count);
 for(const [word,band,,frq] of p.words){assert.ok(word.trim()); assert.ok(band>=1&&band<=6); assert.ok(Number.isInteger(frq)&&frq>=0);}
 assert.equal(fs.readFileSync(file,'utf8'),fs.readFileSync(path.resolve(__dirname,'../dict-builder/packs/base.json'),'utf8'));
});
test('首启算法：实际完整词表抽30词/播20词',()=>{const h=harness(),s=h.load('services/onboarding.ts'); const q=s.sampleQuestions(); assert.equal(q.length,30); assert.equal(s.finish([],q).seeded.length,20);});
test('入队按 clientEventId 去重，RPC 保留原幂等键',async()=>{const h=harness(),q=h.load('services/reviewQueue.ts'); q.enqueue(item);q.enqueue(item);assert.equal(q.pendingCount(),1);assert.equal((await q.flush()).sent,1);assert.equal(h.calls[0].args.p_client_event_id,item.clientEventId);});
test('临时断网保留复习，恢复后按原顺序补发',async()=>{const h=harness(),q=h.load('services/reviewQueue.ts'),ok=h.gateway.rpc; q.enqueue(item);q.enqueue({...item,clientEventId:'B',wordId:'B'});h.gateway.rpc=async()=>{throw {kind:'network'};}; assert.equal((await q.flush()).remaining,2);h.gateway.rpc=ok;assert.equal((await q.flush()).sent,2);assert.deepEqual(h.calls.map(x=>x.args.p_word_id),['word-A','B']);});
test('401 不删除待补发复习',async()=>{const h=harness(),q=h.load('services/reviewQueue.ts');q.enqueue(item);h.gateway.rpc=async()=>{throw {kind:'unauthorized'};};await q.flush();assert.equal(q.pendingCount(),1);});
test('业务400不阻塞后续复习',async()=>{const h=harness(),q=h.load('services/reviewQueue.ts'),ok=h.gateway.rpc; q.enqueue(item);q.enqueue({...item,clientEventId:'B',wordId:'B'});h.gateway.rpc=async(n,a)=>{if(a.p_word_id==='word-A')throw {kind:'client'};return ok(n,a);};assert.equal((await q.flush()).sent,1);assert.equal(q.pendingCount(),0);});
test('D02：连续8次网络失败仍必须保留用户复习',async()=>{const h=harness(),q=h.load('services/reviewQueue.ts');q.enqueue(item);h.gateway.rpc=async()=>{throw {kind:'network'};};for(let i=0;i<8;i++)await q.flush();assert.equal(q.pendingCount(),1,'重试达到上限后复习被删除');});
test('D02：达上限后恢复网络仍使用原幂等键补发',async()=>{const h=harness(),q=h.load('services/reviewQueue.ts'),ok=h.gateway.rpc;q.enqueue(item);h.gateway.rpc=async()=>{throw {kind:'network'};};for(let i=0;i<8;i++)await q.flush();h.gateway.rpc=ok;assert.equal((await q.flush()).sent,1);assert.equal(h.calls.at(-1).args.p_client_event_id,item.clientEventId);});
test('D03：切换B账号后不能补发A账号复习',async()=>{const h=harness(),q=h.load('services/reviewQueue.ts'),auth=h.load('services/auth.ts');h.gateway.setSession({userId:'A'});q.enqueue(item);auth.logout();h.gateway.setSession({userId:'B'});await q.flush();assert.equal(h.calls.length,0,'A的复习以B的会话发出');});
test('D03：B的复习不被队首的A阻塞，A回登后可续传',async()=>{const h=harness(),q=h.load('services/reviewQueue.ts');h.gateway.setSession({userId:'A'});q.enqueue(item);h.gateway.setSession({userId:'B'});q.enqueue({...item,clientEventId:'event-B',wordId:'word-B'});assert.equal((await q.flush()).sent,1);assert.equal(h.calls[0].args.p_word_id,'word-B');h.gateway.setSession({userId:'A'});assert.equal((await q.flush()).sent,1);assert.equal(h.calls[1].args.p_word_id,'word-A');});
test('D03：退出后新账号不能读取旧账号生词',()=>{const h=harness(),s=h.load('services/storage.ts'),auth=h.load('services/auth.ts');s.writeCache('hc.cache.words.recent',[{term:'A-private-word'}]);s.write('hc.onboarding',{seeded:['A-word'],syncedAt:'yesterday'});auth.logout();assert.equal(s.readCacheStale('hc.cache.words.recent'),null,'旧账号生词仍在共享缓存');});
test('D04：存储写满时入队不能静默声称成功',()=>{const h=harness(),q=h.load('services/reviewQueue.ts');h.failWrites();assert.throws(()=>q.enqueue(item),undefined,'保存失败被吞掉，UI将继续下一张卡');});
test('额度：跨天补足3，同日不重复，50不累加',()=>{const h=harness(),m=h.load('services/membership.ts');h.memory.set('hc.membership',{credits:0,freeDate:'2000-1-1'});assert.equal(m.ensureDailyFree().credits,3);m.spend(2);assert.equal(m.ensureDailyFree().credits,1);h.memory.set('hc.membership',{credits:50,freeDate:'2000-1-1'});assert.equal(m.ensureDailyFree().credits,50);});
test('额度：不足不扣成负数，7天奖励仅一次',()=>{const h=harness(),m=h.load('services/membership.ts');m.ensureDailyFree();assert.equal(m.spend(4),null);assert.equal(m.get().credits,3);assert.equal(m.claimStreakBonus(7),10);assert.equal(m.claimStreakBonus(7),0);assert.equal(m.get().credits,13);});
test('阅读器：重建原文无损，标点不可点，来源限对应句',()=>{const h=harness(),r=h.load('services/reader.ts');const text="Hello, world! We don't stop.\nNext line.";const x=r.tokenize(text);assert.equal(x.tokens.map(t=>t.t).join(''),text);for(const t of x.tokens){if(t.w)assert.ok(x.sentences[t.s].includes(t.t));else assert.equal(t.k,'');}assert.equal(x.sentences[x.tokens.find(t=>t.k==='world').s],'Hello, world!');});
test('D05：补发成功后今日概览缓存必须失效',async()=>{const h=harness(),q=h.load('services/reviewQueue.ts'),s=h.load('services/storage.ts');s.writeCache(s.SK.PLAN_CACHE,{due_count:1,reviewed_today:0});q.enqueue(item);await q.flush();assert.equal(s.readCache(s.SK.PLAN_CACHE,300000),null,'服务端已更新，本地首页仍可命中旧概览5分钟');});
test('D06：本轮数量取实际队列且固定不超过20，积压单独标识',()=>{const h=harness(),l=h.load('services/learning.ts');const backlog=l.studyRoundInfo({due_count:35,new_count:8},20);assert.equal(backlog.roundCount,20);assert.equal(backlog.backlogTotal,43);assert.equal(backlog.hasBacklog,true);const exact=l.studyRoundInfo({due_count:3,new_count:2},5);assert.equal(exact.roundCount,5);assert.equal(exact.backlogTotal,5);assert.equal(exact.hasBacklog,false);assert.equal(l.studyRoundInfo({due_count:35,new_count:8},50).roundCount,20);});
test('临时积压开关只改概览数字，不改其他服务端字段',()=>{const h=harness(),l=h.load('services/learning.ts');const base={due_count:1,new_count:2,new_available:2,total_words:29,daily_goal:20,streak_days:3,reviewed_today:4,activated_count:5,activated_this_week:1};assert.equal(l.backlogTestSummary(base,false),base);assert.deepEqual({...l.backlogTestSummary(base,true)},{...base,due_count:35,new_count:8,new_available:8});});
test('来源展示：首启添加不在今日、学习背面或生词详情中被条件隐藏',()=>{const today=fs.readFileSync(path.join(root,'pages/today/today.wxml'),'utf8');const study=fs.readFileSync(path.join(root,'pages/study/study.wxml'),'utf8');const words=fs.readFileSync(path.join(root,'pages/words/words.wxml'),'utf8');assert.doesNotMatch(today,/contextSource\s*!==\s*['"]首启添加/);assert.match(today,/<text class="word-source">\{\{item\.contextSource\}\}<\/text>/);assert.match(study,/<view class="ctx-source"><view class="dot"><\/view><text class="source-text">\{\{card\.contextSource\}\}<\/text><\/view>/);assert.match(words,/<view class="drawer-ctx">[\s\S]*?来源：\{\{detail\.contextSource\}\}/);});
