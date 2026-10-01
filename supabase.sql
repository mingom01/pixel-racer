-- Supabase → SQL Editor 에 붙여넣고 Run. 계정(코인, 차, 색, 기록)을 저장할 표를 만듭니다.
create table if not exists public.accounts (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
-- 브라우저(anon 키)로는 못 읽고 쓰게 막음. 게임 서버는 secret 키로 접근하므로 상관없음.
alter table public.accounts enable row level security;
