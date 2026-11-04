-- Run once on a NEW demo database. Existing tables: inspect/back up schema first.
begin;
create table public.user_preferences (
  user_id text not null check (length(user_id) between 1 and 100),
  topic text not null check (length(btrim(topic)) between 1 and 100),
  score integer not null default 0 check (score between -5 and 5),
  updated_at timestamptz not null default now(),
  primary key (user_id, topic)
);
create table public.feedback_history (
  id bigint generated always as identity primary key,
  user_id text not null,
  news_id text not null check (length(news_id) between 1 and 200),
  topic text not null,
  feedback_type text not null check (feedback_type in ('like', 'dislike')),
  previous_score integer not null check (previous_score between -5 and 5),
  new_score integer not null check (new_score between -5 and 5),
  created_at timestamptz not null default now(),
  unique (user_id, news_id, topic),
  foreign key (user_id, topic) references public.user_preferences(user_id, topic)
);
create index feedback_history_user_date on public.feedback_history (user_id, created_at desc);
alter table public.user_preferences enable row level security;
alter table public.feedback_history enable row level security;
revoke all on public.user_preferences, public.feedback_history from anon, authenticated;
grant select, insert, update, delete on public.user_preferences, public.feedback_history to service_role;
grant usage, select on sequence public.feedback_history_id_seq to service_role;

create function public.record_feedback(p_user_id text, p_news_id text, p_topic text, p_feedback_type text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  old_score integer;
  next_score integer;
  existing public.feedback_history%rowtype;
begin
  if p_feedback_type is null or p_feedback_type not in ('like', 'dislike') then
    raise exception 'Invalid feedback type';
  end if;
  -- Serialize first insertion and all subsequent updates per user/topic.
  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_user_id, p_topic)::text, 0));
  select * into existing from public.feedback_history
    where user_id = p_user_id and news_id = p_news_id and topic = p_topic;
  if found then
    return jsonb_build_object('user_id', p_user_id, 'topic', p_topic,
      'previous_score', existing.previous_score, 'preference_score', existing.new_score, 'duplicate', true);
  end if;
  insert into public.user_preferences(user_id, topic) values(p_user_id, p_topic)
    on conflict(user_id, topic) do nothing;
  select score into old_score from public.user_preferences
    where user_id = p_user_id and topic = p_topic for update;
  next_score := greatest(-5, least(5, old_score + case when p_feedback_type = 'like' then 1 else -1 end));
  update public.user_preferences set score = next_score, updated_at = now()
    where user_id = p_user_id and topic = p_topic;
  insert into public.feedback_history(user_id, news_id, topic, feedback_type, previous_score, new_score)
    values(p_user_id, p_news_id, p_topic, p_feedback_type, old_score, next_score);
  return jsonb_build_object('user_id', p_user_id, 'topic', p_topic,
    'previous_score', old_score, 'preference_score', next_score, 'duplicate', false);
end;
$$;
revoke all on function public.record_feedback(text,text,text,text) from public, anon, authenticated;
grant execute on function public.record_feedback(text,text,text,text) to service_role;
commit;
