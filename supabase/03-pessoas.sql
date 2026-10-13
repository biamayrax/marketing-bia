-- Quem pode entrar. Troque os e-mails e rode no SQL Editor.
-- pid: 'gm' = Gerente de Marketing (aprovação principal) · 'daniel' / 'lucas' = análise da diretoria · 'mkt' = equipe de marketing.
-- Cada pessoa da equipe tem sua própria linha: o nome aparece no histórico e não pode ser trocado por quem usa o site.
-- Para tirar o acesso de alguém: update public.people set active = false where email = '...';
insert into public.people (email, pid, name) values
  ('gerente@empresa.com.br', 'gm',     'Gerente de Marketing'),
  ('daniel@empresa.com.br',  'daniel', 'Daniel'),
  ('lucas@empresa.com.br',   'lucas',  'Lucas'),
  ('pessoa1@empresa.com.br', 'mkt',    'Nome da pessoa 1'),
  ('pessoa2@empresa.com.br', 'mkt',    'Nome da pessoa 2')
on conflict (email) do update set pid = excluded.pid, name = excluded.name, active = true;
