# Portal CETI Maria Neusa de Sousa

Site institucional agora preparado para Next.js, mantendo a base visual e o portal legado.

## Como abrir no Next

O projeto precisa de `Node.js` e `npm` instalados para rodar o Next localmente.

### Instalação

Na raiz do projeto, execute:

```powershell
npm install
```

Depois copie `.env.local.example` para `.env.local` e ajuste as chaves se necessario.

### Execução

Depois rode:

```powershell
npm run dev
```

E abra:

```text
http://localhost:3000
```

### VS Code

Use a configuracao de depuracao `Open site on localhost`.

## Login do admin

- Usuario: `admin`
- Senha: `cetimns26`

## Banco de dados

Execute o script `supabase-init.sql` no editor SQL do Supabase para criar as tabelas e inserir o admin inicial.

Se o banco ja existia antes dos campos de conteudo e anexos, execute tambem
`supabase-add-attachments.sql`. Essa migracao adiciona as colunas usadas por noticias,
atividades e conquistas e corrige as permissoes de salvamento do painel.

Se quiser reexecutar a criacao do admin manualmente no navegador, use `setup-admin.js`.

## Como a sincronizacao funciona

- O GitHub guarda o codigo do site.
- O Supabase guarda os dados do portal: noticias, eventos, atividades, conquistas, alunos, professores, notas e configuracao da escola.
- Para abrir em qualquer lugar, basta usar o mesmo repositorio no GitHub e o mesmo projeto do Supabase.
- Se voce trocar o projeto do Supabase, precisa atualizar `supabase.js` com a URL e a chave anon corretas.
- Tambem e possivel sobrescrever esses valores definindo `window.CETI_SUPABASE_URL` e `window.CETI_SUPABASE_ANON_KEY` antes de carregar `app.js`.
- A versao Next usa `lib/supabase.js` com `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

## Observacao sobre a migracao

O arquivo `app/page.jsx` funciona como um wrapper Next para carregar o portal legado em `/legacy/index.html`. Isso deixa o projeto em Next agora e permite uma migracao gradual para componentes React depois.

## Observacoes

- O site carrega dados do Supabase para noticias, eventos, atividades, conquistas, alunos, professores e notas.
- O admin pode acessar o painel administrativo, cadastrar usuarios e manter o conteudo escolar.
- O logo usado no app fica em `logo-ceti.png`.
