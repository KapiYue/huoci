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
commit;
