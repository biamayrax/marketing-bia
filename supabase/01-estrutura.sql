-- Calendário Franciosi: estrutura, permissões e regras de aprovação.
-- Rode uma vez no Supabase: SQL Editor > New query > cole tudo > Run.
-- As regras abaixo são verificadas NO SERVIDOR. Editar o navegador (F12) não dá permissão a ninguém.

-- ===== Pessoas com acesso =====
create table if not exists public.people (
  email  text primary key check (email = lower(email)),
  pid    text not null check (pid in ('gm', 'daniel', 'lucas', 'mkt')),
  name   text not null,
  active boolean not null default true
);

create or replace function public.my_pid() returns text language sql stable security definer set search_path = public as $$
  select pid from people where email = lower(auth.jwt() ->> 'email') and active limit 1 $$;
create or replace function public.my_name() returns text language sql stable security definer set search_path = public as $$
  select name from people where email = lower(auth.jwt() ->> 'email') and active limit 1 $$;
create or replace function public.is_member() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from people where email = lower(auth.jwt() ->> 'email') and active) $$;

-- ===== Dados =====
create table if not exists public.flow (
  anchor     text primary key,
  data       jsonb not null,
  rev        int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
create table if not exists public.audit (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  email  text,
  name   text,
  anchor text,
  action text
);

-- ===== Regras de cada etapa (conteúdo ou versão de arte) =====
create or replace function public.stage_check(o jsonb, n jsonb, p text, nm text) returns jsonb language plpgsql as $$
declare
  os text := coalesce(o ->> 'status', 'pendente');
  ns text := coalesce(n ->> 'status', 'pendente');
begin
  if n is null then return n; end if;
  if ns is distinct from os then
    if ns = 'aprovado' then
      if p <> 'gm' then raise exception 'Só o Gerente de Marketing pode aprovar.'; end if;
      n := jsonb_set(n, '{final}', coalesce(n -> 'final', '{}'::jsonb) || jsonb_build_object('by', nm, 'server_at', now()));
    elsif ns = 'ajustes' then
      if p not in ('gm', 'daniel', 'lucas') then raise exception 'Só os aprovadores podem pedir ajustes.'; end if;
      if length(coalesce(n -> 'adj' ->> 'note', '')) < 20 then raise exception 'O motivo do ajuste precisa ter pelo menos 20 caracteres.'; end if;
      n := jsonb_set(n, '{adj,by}', to_jsonb(nm));
    elsif os = 'ajustes' then
      if not (p = 'mkt' or coalesce(o -> 'adj' ->> 'by', '') = nm) then
        raise exception 'Só a equipe (ao corrigir) ou quem pediu o ajuste (ao cancelar) pode mudar este status.';
      end if;
    elsif ns = 'substituida' then
      if p <> 'mkt' then raise exception 'Só a equipe envia novas versões de arte.'; end if;
    end if;
  elsif ns = 'ajustes' and (n -> 'adj') is distinct from (o -> 'adj') then
    if coalesce(o -> 'adj' ->> 'by', '') <> nm then raise exception 'Só quem pediu o ajuste pode editá-lo.'; end if;
    if length(coalesce(n -> 'adj' ->> 'note', '')) < 20 then raise exception 'O motivo do ajuste precisa ter pelo menos 20 caracteres.'; end if;
  end if;
  if jsonb_array_length(coalesce(n -> 'dirOk', '[]')) > jsonb_array_length(coalesce(o -> 'dirOk', '[]')) and p not in ('daniel', 'lucas') then
    raise exception 'Só Daniel e Lucas dão o de acordo da diretoria.';
  end if;
  return n;
end $$;

-- ===== Guarda de cada gravação de post =====
create or replace function public.flow_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare
  p  text := my_pid();
  nm text := my_name();
  od jsonb;
  oh jsonb; nh jsonb; oc jsonb; nc jsonb; ov jsonb; nv jsonb;
  added int; i int;
begin
  if auth.uid() is null then return new; end if; -- administrador no SQL Editor
  if p is null then raise exception 'Sem permissão: seu e-mail não está cadastrado.'; end if;
  if tg_op = 'UPDATE' then
    if new.rev <> old.rev + 1 then raise exception 'Conflito de versão. Atualize a página.'; end if;
    od := old.data;
  else
    new.rev := 1;
    od := '{"content":{"status":"pendente"},"versions":[],"history":[],"comments":[]}'::jsonb;
  end if;
  oh := coalesce(od -> 'history', '[]');  nh := coalesce(new.data -> 'history', '[]');
  oc := coalesce(od -> 'comments', '[]'); nc := coalesce(new.data -> 'comments', '[]');
  ov := coalesce(od -> 'versions', '[]'); nv := coalesce(new.data -> 'versions', '[]');

  -- Histórico: só cresce (novos itens no início). Nada antigo pode ser apagado ou alterado.
  added := jsonb_array_length(nh) - jsonb_array_length(oh);
  if added < 0 then raise exception 'O histórico não pode ser apagado.'; end if;
  for i in 0 .. jsonb_array_length(oh) - 1 loop
    if nh -> (i + added) is distinct from oh -> i then raise exception 'O histórico não pode ser alterado.'; end if;
  end loop;
  for i in 0 .. added - 1 loop
    nh := jsonb_set(nh, array[i::text, 'who'], to_jsonb(nm));
    insert into audit (email, name, anchor, action) values (lower(auth.jwt() ->> 'email'), nm, new.anchor, nh -> i ->> 'what');
  end loop;

  -- Comentários: só cresce (novos no fim), assinados com o nome do cadastro.
  if jsonb_array_length(nc) < jsonb_array_length(oc) then raise exception 'Comentários não podem ser apagados.'; end if;
  for i in 0 .. jsonb_array_length(oc) - 1 loop
    if nc -> i is distinct from oc -> i then raise exception 'Comentários não podem ser alterados.'; end if;
  end loop;
  for i in jsonb_array_length(oc) .. jsonb_array_length(nc) - 1 loop
    nc := jsonb_set(nc, array[i::text, 'a'], to_jsonb(nm));
  end loop;

  -- Prazos: só a equipe altera.
  if (new.data -> 'due') is distinct from (od -> 'due') and p <> 'mkt' then raise exception 'Só a equipe de marketing altera prazos.'; end if;

  -- Conteúdo
  new.data := jsonb_set(new.data, '{content}', stage_check(od -> 'content', new.data -> 'content', p, nm));

  -- Artes
  if jsonb_array_length(nv) < jsonb_array_length(ov) then raise exception 'Versões de arte não podem ser apagadas.'; end if;
  if jsonb_array_length(nv) > jsonb_array_length(ov) and p <> 'mkt' then raise exception 'Só a equipe de marketing envia arte.'; end if;
  for i in 0 .. jsonb_array_length(nv) - 1 loop
    nv := jsonb_set(nv, array[i::text], stage_check(ov -> i, nv -> i, p, nm));
    if i >= jsonb_array_length(ov) then nv := jsonb_set(nv, array[i::text, 'by'], to_jsonb(nm)); end if;
  end loop;

  new.data := new.data || jsonb_build_object('history', nh, 'comments', nc, 'versions', nv);
  new.updated_at := now();
  new.updated_by := nm;
  return new;
end $$;

drop trigger if exists flow_guard on public.flow;
create trigger flow_guard before insert or update on public.flow for each row execute function public.flow_guard();

create or replace function public.settings_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(my_name(), 'administrador');
  return new;
end $$;
drop trigger if exists settings_guard on public.settings;
create trigger settings_guard before insert or update on public.settings for each row execute function public.settings_guard();

-- ===== Permissões (RLS): sem login cadastrado, não se lê nem grava nada =====
alter table public.people   enable row level security;
alter table public.flow     enable row level security;
alter table public.settings enable row level security;
alter table public.audit    enable row level security;
revoke all on public.people, public.flow, public.settings, public.audit from anon;

drop policy if exists people_ler on public.people;
create policy people_ler on public.people for select to authenticated using (public.is_member());

drop policy if exists flow_ler on public.flow;
drop policy if exists flow_criar on public.flow;
drop policy if exists flow_editar on public.flow;
create policy flow_ler    on public.flow for select to authenticated using (public.is_member());
create policy flow_criar  on public.flow for insert to authenticated with check (public.is_member());
create policy flow_editar on public.flow for update to authenticated using (public.is_member()) with check (public.is_member());

drop policy if exists settings_ler on public.settings;
drop policy if exists settings_criar on public.settings;
drop policy if exists settings_editar on public.settings;
create policy settings_ler    on public.settings for select to authenticated using (public.is_member());
create policy settings_criar  on public.settings for insert to authenticated with check (public.my_pid() = 'mkt' and key in ('months', 'imported', 'hidden'));
create policy settings_editar on public.settings for update to authenticated using (public.my_pid() = 'mkt' and key in ('months', 'imported', 'hidden')) with check (public.my_pid() = 'mkt' and key in ('months', 'imported', 'hidden'));

drop policy if exists audit_ler on public.audit;
create policy audit_ler on public.audit for select to authenticated using (public.is_member());

-- ===== Arquivos de arte (privados) =====
insert into storage.buckets (id, name, public) values ('artes', 'artes', false) on conflict (id) do nothing;
drop policy if exists artes_ler on storage.objects;
drop policy if exists artes_enviar on storage.objects;
create policy artes_ler    on storage.objects for select to authenticated using (bucket_id = 'artes' and public.is_member());
create policy artes_enviar on storage.objects for insert to authenticated with check (bucket_id = 'artes' and public.my_pid() = 'mkt');

-- ===== Tempo real: todos veem as mudanças na hora =====
do $$ begin
  alter publication supabase_realtime add table public.flow, public.settings;
exception when duplicate_object then null; end $$;
