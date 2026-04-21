-- =====================================================================
-- MYRIAD Team Hub - Initial Schema (Phase 1)
-- Supabase SQL Editor에 붙여넣고 "Run" 클릭
-- =====================================================================

-- 1) profiles: auth.users 확장 (로그인한 팀원 프로필)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  avatar_url text,
  role text not null default 'member' check (role in ('member','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 신규 로그인 시 profiles 자동 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update on auth.users
  for each row execute function public.handle_new_user();

-- 2) schedules: 개인 및 팀 일정
create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  visibility text not null default 'private' check (visibility in ('private','team')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_schedules_user on public.schedules(user_id, starts_at);
create index if not exists idx_schedules_team on public.schedules(visibility, starts_at) where visibility = 'team';

-- 3) memos: 개인 메모
create table if not exists public.memos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  body text not null default '',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_memos_user on public.memos(user_id, pinned desc, updated_at desc);

-- =====================================================================
-- Row Level Security (RLS) - 반드시 켜기
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.schedules enable row level security;
alter table public.memos enable row level security;

-- profiles: 본인 조회/수정, 같은 팀(로그인된 사용자) 전원 조회 가능
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- schedules: 본인 전체 접근 + 팀 공개는 로그인된 사용자 전원 조회 가능
drop policy if exists schedules_select on public.schedules;
create policy schedules_select on public.schedules
  for select using (
    auth.uid() = user_id
    or (visibility = 'team' and auth.role() = 'authenticated')
  );

drop policy if exists schedules_modify_self on public.schedules;
create policy schedules_modify_self on public.schedules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- memos: 본인만
drop policy if exists memos_all_self on public.memos;
create policy memos_all_self on public.memos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at 자동 갱신
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_schedules_updated on public.schedules;
create trigger trg_schedules_updated before update on public.schedules
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_memos_updated on public.memos;
create trigger trg_memos_updated before update on public.memos
  for each row execute function public.tg_set_updated_at();
