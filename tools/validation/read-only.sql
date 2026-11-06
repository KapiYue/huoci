-- Aggregate checks only. No user identifiers, credentials, word text or writes.
begin read only;
select 'base_words_count' as check_name, count(*) as actual from public.hc_base_words
union all select 'base_words_missing_meaning', count(*) from public.hc_base_words where nullif(btrim(primary_meaning),'') is null
union all select 'activation_owner_mismatch', count(*) from public.hc_word_status s join public.words w on w.id=s.word_id where s.user_id<>w.user_id
union all select 'duplicate_review_event_keys', count(*) from (select user_id,client_event_id from public.review_events where client_event_id is not null group by 1,2 having count(*)>1) d
union all select 'invalid_profile_goal', count(*) from public.hc_profiles where daily_goal not between 1 and 100
union all select 'activation_rows', count(*) from public.hc_word_status
union all select 'rls_enabled_hc_tables', count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('hc_profiles','hc_word_status','hc_wechat_identities','hc_events') and c.relrowsecurity
union all select 'review_idempotency_index', count(*) from pg_indexes where schemaname='public' and indexname='review_events_client_event_uidx';

-- 权限核验：只汇总权限，绝不显示用户行或写入数据。预期三个 direct_write_* 均为 0，
-- 四个 RPC 的 authenticated_execute_* 均为 1。
select 'direct_write_hc_profiles' as check_name, count(*)::bigint as actual
from information_schema.role_table_grants
where grantee = 'authenticated' and table_schema = 'public' and table_name = 'hc_profiles'
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
union all
select 'direct_write_hc_word_status', count(*)::bigint from information_schema.role_table_grants
where grantee = 'authenticated' and table_schema = 'public' and table_name = 'hc_word_status'
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
union all
select 'direct_write_hc_events', count(*)::bigint from information_schema.role_table_grants
where grantee = 'authenticated' and table_schema = 'public' and table_name = 'hc_events'
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
union all
select 'authenticated_execute_hc_apply_review', has_function_privilege('authenticated', 'public.hc_apply_review(uuid,integer,text,integer,uuid)', 'execute')::int
union all
select 'authenticated_execute_hc_update_profile', has_function_privilege('authenticated', 'public.hc_update_profile(integer)', 'execute')::int
union all
select 'authenticated_execute_hc_save_onboarding', has_function_privilege('authenticated', 'public.hc_save_onboarding(text[],integer,text[])', 'execute')::int
union all
select 'authenticated_execute_hc_track', has_function_privilege('authenticated', 'public.hc_track(jsonb)', 'execute')::int;
commit;
