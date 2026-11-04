-- Run in a disposable PostgreSQL/Supabase test database, after migration.
begin;
set local role service_role;
do $$
declare r jsonb; count_rows integer; current_score integer;
begin
  r := public.record_feedback('qa-user', 'n1', 'AI', 'like');
  assert (r->>'preference_score')::int = 1, 'first like';
  r := public.record_feedback('qa-user', 'n1', 'AI', 'like');
  assert (r->>'duplicate')::boolean, 'retry must be idempotent';
  r := public.record_feedback('qa-user', 'n1', 'AI', 'dislike');
  assert (r->>'duplicate')::boolean, 'second vote cannot change first vote';
  select count(*) into count_rows from public.feedback_history where user_id='qa-user';
  assert count_rows = 1, 'duplicate history';
  for i in 2..10 loop
    perform public.record_feedback('qa-user', 'n'||i, 'AI', 'like');
  end loop;
  select score into current_score from public.user_preferences where user_id='qa-user' and topic='AI';
  assert current_score = 5, 'upper score limit';
  for i in 11..25 loop
    perform public.record_feedback('qa-user', 'n'||i, 'AI', 'dislike');
  end loop;
  select score into current_score from public.user_preferences where user_id='qa-user' and topic='AI';
  assert current_score = -5, 'lower score limit';
  r := public.record_feedback('qa-other', 'n1', 'AI', 'like');
  assert (r->>'preference_score')::int = 1, 'user isolation';
  begin
    perform public.record_feedback('qa-user', '', 'AI', 'like');
    raise exception 'invalid news accepted';
  exception when check_violation then null;
  end;
  select count(*) into count_rows from public.feedback_history where user_id='qa-user';
  assert count_rows = 25, 'failed insert must not add history';
end $$;
reset role;
do $$ begin
  assert not has_table_privilege('anon', 'public.feedback_history', 'SELECT');
  assert not has_function_privilege('anon', 'public.record_feedback(text,text,text,text)', 'EXECUTE');
end $$;
rollback;
