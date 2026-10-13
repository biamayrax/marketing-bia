# Calendário de conteúdos · Franciosi Sementes

Site estático (HTML, CSS e JavaScript puro) publicado na **Vercel**, com **Supabase** para login por e-mail, banco de dados, arquivos de arte e atualização em tempo real.

```
public/            o site (é isso que a Vercel publica)
  index.html
  css/styles.css
  js/config.js     gerado no deploy a partir das variáveis da Vercel
  js/data.js       configuração: aprovadores, prazos, status, cores
  js/storage.js    conexão com o Supabase
  js/app.js        regras e interface
  assets/          logo, grafismo, fonte Redonda
supabase/          SQL para rodar uma vez no Supabase (não é publicado)
scripts/gerar-config.js
vercel.json
```

O conteúdo do calendário (pautas, legendas) **não está no site**: fica no banco e só é entregue a quem fez login com um e-mail cadastrado.

## 1. Supabase (uma vez)

1. Em [supabase.com](https://supabase.com), crie um projeto (plano gratuito, região São Paulo).
2. Em **SQL Editor › New query**, rode em ordem:
   - `supabase/01-estrutura.sql`: tabelas, permissões e regras de aprovação.
   - `supabase/02-conteudo.sql`: posts de outubro a dezembro.
   - `supabase/03-pessoas.sql`: troque antes pelos e-mails reais (Gerente, Daniel, Lucas e cada pessoa da equipe).
3. Em **Project Settings › API**, copie a **Project URL** e a chave **anon public**.

## 2. Vercel

1. Em [vercel.com](https://vercel.com), escolha **Add New › Project** e importe este repositório.
2. Deixe **Framework Preset: Other**. O resto vem do `vercel.json`.
3. Em **Environment Variables**, adicione:
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_ANON_KEY` = chave anon public
4. Clique em **Deploy**. Sem as duas variáveis o deploy falha de propósito, para o site não subir sem login.

## 3. Ligar o login ao endereço do site

No Supabase, em **Authentication › URL Configuration**:
- **Site URL:** o endereço da Vercel (ex.: `https://marketing-bia.vercel.app`) ou o domínio próprio.
- **Redirect URLs:** o mesmo endereço.

**Recomendado:** o envio gratuito de e-mails do Supabase é limitado a poucos por hora. Para uso diário, configure um SMTP próprio em **Authentication › Emails › SMTP Settings** (Google Workspace, Resend, SendGrid).

## Pessoas
- Para incluir alguém, adicione uma linha em **Table Editor › people** com o e-mail em minúsculas, o perfil (`gm`, `daniel`, `lucas` ou `mkt`) e o nome.
- Para tirar o acesso, marque `active = false`.
- O nome do histórico vem desse cadastro e não pode ser trocado por quem usa o site.

## O que o servidor garante
Mesmo editando o navegador (F12), ninguém consegue:
- ver dados sem estar logado com um e-mail cadastrado;
- aprovar sem ser o Gerente de Marketing;
- pedir ajuste sem ser aprovador, ou com motivo de menos de 20 caracteres;
- dar o "de acordo" sem ser Daniel ou Lucas;
- enviar arte, alterar prazo ou mexer nos meses sem ser da equipe;
- editar ou cancelar o ajuste de outra pessoa;
- apagar ou alterar histórico e comentários, ou assinar com o nome de outra pessoa.

Toda ação também fica na tabela `audit`, com e-mail e hora do servidor. Se duas pessoas editarem o mesmo post ao mesmo tempo, a segunda recebe um aviso e nada é sobrescrito.

## Regras de negócio
- Um ajuste pedido por Daniel ou Lucas trava o fluxo até a equipe corrigir.
- Se o texto de um post aprovado mudar, a aprovação reabre sozinha e isso entra no histórico.
- O prazo é de 7 dias antes do post para o conteúdo e 3 dias para a arte (`public/js/data.js`). A equipe pode ajustar com "Alterar prazo".
- O site abre no mês atual.

## Rodar no computador
```
cp .env.example .env    # preencha, ou deixe vazio para o modo de demonstração
npm run dev             # http://localhost:8080
```
Para o modo online local, exporte as variáveis antes (`export $(cat .env | xargs)`) e adicione `http://localhost:8080` às Redirect URLs do Supabase.

## Atualizar os posts base
Os meses novos são criados pela equipe no próprio site ("+ Adicionar mês" e "Importar conteúdos do mês"). Para corrigir os posts base de outubro a dezembro, edite em **Table Editor › settings › base** ou rode de novo `02-conteudo.sql` alterado.
