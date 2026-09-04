-- 跑 0005 / 0006 之前的**只读**体检。`dev-todo.md` T2。
--
-- 为什么需要它：0005 / 0006 里有三处依赖**词鲸现有 schema 的事实**，
-- 而 plpgsql 的函数体在 CREATE 时只做语法检查、不做语义检查 ——
-- 这三处如果猜错了，迁移会**创建成功、第一次被调用时才炸**，
-- 而 `onboarding.sync()` 是后台 fire-and-forget 且 catch 住不抛的：
-- 表现是「用户一切正常，但首启结果永远没落库」，最难查的那种。
--
-- 怎么用：Supabase Dashboard → SQL Editor，整份贴进去跑，对着「期望」看四个结果。
-- **全绿再贴 0005 / 0006。** 任何一条不符，先来改迁移，别硬跑。

-- ① words 上有没有 (user_id, normalized_term) 的唯一约束？
--    0005 的播种用了 `on conflict (user_id, normalized_term) do nothing`，
--    PostgreSQL 要求冲突目标**必须有匹配的唯一索引**，没有就报
--    "there is no unique or exclusion constraint matching the ON CONFLICT specification"。
--    期望：至少 1 行，且 cols 恰好是 {user_id, normalized_term}。
select i.relname as index_name,
       ix.indisunique as is_unique,
       array_agg(a.attname order by a.attnum) as cols
from pg_index ix
join pg_class t  on t.oid  = ix.indrelid
join pg_class i  on i.oid  = ix.indexrelid
join pg_attribute a on a.attrelid = t.oid and a.attnum = any(ix.indkey)
where t.relname = 'words' and ix.indisunique
group by i.relname, ix.indisunique;

-- ② words.status 认不认 'ignored'？
--    0005 把词鲸送的 8 个新手词置为 'ignored'（§11 ⑤）。
--    如果 status 是 enum 且没有这个值，或有 check 约束不含它，UPDATE 会炸。
--    期望：data_type 是 text/varchar 且无 check 约束，或者枚举值里含 'ignored'。
select c.column_name, c.data_type, c.udt_name
from information_schema.columns c
where c.table_schema = 'public' and c.table_name = 'words' and c.column_name = 'status';

select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.words'::regclass and contype = 'c';

-- 如果上面 udt_name 显示是自定义枚举类型，用这句看它的取值：
-- select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = '<上面的 udt_name>';

-- ③ 新手词的 first_source_title 到底写的是什么字符串？
--    0005 靠 `first_source_title = '词鲸新手词库'` 精确匹配来认出它们。
--    差一个字，8 个新手词就不会被 ignored，用户首启后第一轮学的是
--    resilient / subtle，而不是自己刚勾的词（§11 ⑤）。
--    期望：出现一行 count = 8 左右、title 与迁移里写死的字符串**逐字相同**。
select first_source_title, count(*) as n
from public.words
group by first_source_title
order by n desc
limit 20;

-- ④ 0005 / 0006 读写到的 words 列是不是都在？
--    期望：14 行全部命中（缺哪列，下面的结果里就少哪行）。
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'words'
  and column_name in (
    'id','user_id','term','normalized_term','lemma','phonetic','primary_meaning',
    'custom_meaning','status','created_at','due_at','interval_days','repetitions',
    'last_reviewed_at','first_context','first_source_url','first_source_title',
    'audio_url','example_en','example_zh','parts'
  )
order by column_name;

-- ─────────────────────────────────────────────────────────────
-- 跑完 0005 / 0006 之后，用这三句验收
-- ─────────────────────────────────────────────────────────────
-- select proname, pg_get_function_identity_arguments(oid)
--   from pg_proc where proname in
--   ('hc_save_onboarding','hc_list_words','hc_update_profile');
--   -- 期望三行：(text[], integer, text[]) / (text, integer, integer) / (integer)
--
-- select count(*) as total, count(primary_meaning) as with_meaning from public.hc_base_words;
--   -- 灌完导入脚本后期望 4553 / 4553；刚跑完迁移时是 0 / 0（正常，两件事互不阻塞）
--
-- select tablename, policyname, cmd from pg_policies
--   where tablename in ('hc_base_words','hc_profiles','hc_word_status');
