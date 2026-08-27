# gigiolab-form — Cloudflare Worker

Endpoint do formulário de contato do `gigiolab.dev`. Recebe POST JSON do
site, valida, rate-limita por IP e envia via Zoho ZeptoMail pra
`geovane@gigiolab.dev`.

**Arquitetura**: site 100% estático → JS mínimo faz `fetch` → Worker (grátis,
edge Cloudflare) → API ZeptoMail. A chave da API mora só dentro do Worker
(via `wrangler secret`); zero credencial no bundle público.

## Estrutura

```
worker/
├── worker.js      # endpoint (ESM Workers, sem dependências)
├── wrangler.toml  # config Cloudflare
└── README.md      # este arquivo
```

## Pré-requisitos (uma vez)

```bash
npm i -g wrangler        # CLI oficial do Cloudflare
wrangler login           # abre browser pra autorizar
```

## Setup — passo a passo (na hora que ZeptoMail liberar)

### 1. Criar o namespace KV pro rate limit

Rate limit por IP mora num KV. Cria uma vez:

```bash
cd worker/
wrangler kv namespace create RATE_LIMIT
```

O comando devolve algo como:

```toml
[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "abc123def456..."
```

**Cole o `id` retornado** dentro do `wrangler.toml` (substitui o
`REPLACE_APOS_wrangler_kv_namespace_create`).

### 2. Cadastrar o token do ZeptoMail

No console ZeptoMail, aba **Mail Agents → agent_1 → API Keys → SendMail Token**,
copia o `Zoho-enczapikey ...` (só a parte do token, sem o prefixo).

```bash
wrangler secret put ZEPTOMAIL_TOKEN
# cola o token quando pedir e ENTER
```

O secret vai pra o Cloudflare (nunca pro repo, nunca pro `wrangler.toml`).

### 3. Deploy

```bash
wrangler deploy
```

Saída informa a URL final, algo como:

```
Published gigiolab-form (X.Xs)
  https://gigiolab-form.<seuSubdominio>.workers.dev
```

**Anota essa URL.** É ela que vai no JS do site (constante `FORM_ENDPOINT`
em `../public/index.html`).

### 4. Apontar o JS do site pra essa URL

Em `../public/index.html`, procura por `FORM_ENDPOINT` e substitui pelo
seu endpoint real. Depois: commit + push + redeploy do site no Dokploy.

### 5. Testar end-to-end

Abre `https://gigiolab.dev`, rola até o form, preenche e envia. Verifica:

- A mensagem chega em `geovane@gigiolab.dev` com Reply-To = e-mail que você
  preencheu no form
- O painel Cloudflare (Workers → gigiolab-form → Logs) mostra a request
- Reenviar 4x seguidas: a 4ª deve retornar `429 muitas tentativas` (rate limit)

## Custom domain — decisão pendente

O plano original era servir em `form.gigiolab.dev`. Cloudflare Workers só
liga custom domain nativo se o **zone do domínio estiver na Cloudflare** — o
`gigiolab.dev` mora na Hostinger, então isso não funciona diretamente. Três
alternativas se algum dia quiser URL bonita:

1. **Migrar o zone inteiro pra Cloudflare** (troca de nameservers na
   Hostinger). Migração indolor, mas mexe em tudo (DNS do site, e-mail,
   etc). Requer atenção com MX/SPF/DKIM.
2. **Delegar só o subdomínio via NS**: cria registros NS pra `form.gigiolab.dev`
   apontando pros nameservers da Cloudflare, e sobe o zone parcial lá.
   Funciona, é complexo, poucas ferramentas de DNS gerenciam bem essa
   configuração híbrida.
3. **Ficar no `.workers.dev`**: a URL fica feia, mas o **usuário do site
   nunca vê** — é só o JS que chama. Zero fricção, zero custo, deploy hoje.

Por ora: **opção 3**. Descomentar as linhas de `[[routes]]` no
`wrangler.toml` quando decidir mudar.

## Desenvolvimento local (contra mock, enquanto ZeptoMail não libera)

```bash
cd worker/
wrangler dev
```

Isso sobe o Worker em `http://localhost:8787`. Sem `ZEPTOMAIL_TOKEN`
setado, a chamada à API ZeptoMail vai retornar erro — mas você vê a
requisição inteira no console (validação, rate limit, formação do payload).

Pra teste local sem consumir ZeptoMail, crie um `.dev.vars` (git-ignored)
com um token fake:

```
ZEPTOMAIL_TOKEN=fake-token-dev
```

Aí a chamada à ZeptoMail vai falhar com 401 (esperado) — mas todo o pipeline
até lá pode ser exercitado. Pra teste real com o Worker local + site local:

```bash
# terminal 1 — site
python3 -m http.server 4173 --directory ../public

# terminal 2 — worker
wrangler dev
```

E no `index.html`, temporariamente muda `FORM_ENDPOINT` pra
`http://localhost:8787`. Abre `http://localhost:4173`, submete o form,
observa o Worker recebendo no terminal 2.

## Rotinas de manutenção

- **Rotacionar o token do ZeptoMail**: `wrangler secret put ZEPTOMAIL_TOKEN`
  novamente. Deploy automático — o Worker pega a nova chave na próxima
  request.
- **Limpar rate limit de um IP travado** (raro): a chave é `rl:<IP>` no
  namespace `RATE_LIMIT`. Deleta pelo dashboard Cloudflare ou:
  ```bash
  wrangler kv key delete --binding=RATE_LIMIT "rl:<IP>"
  ```
- **Ver logs**: dashboard Cloudflare → Workers → gigiolab-form → Logs
  (streaming) ou `wrangler tail`.

## Configuração atual (2026-08-26)

- **Rate limit**: 3 mensagens/hora por IP
- **Payload max**: 4 KB
- **Origem permitida**: `gigiolab.dev`, `www.gigiolab.dev`, `localhost:4173`
- **From**: `Contato GigioLAB <contato@gigiolab.dev>` (alias existente no
  Zoho Mail Lite; ZeptoMail aceita qualquer From no domínio verificado)
- **To**: `Geovane Júnior <geovane@gigiolab.dev>`
- **Reply-To**: e-mail do visitante (responder direto)
- **Subject**: `[Site] Contato de <Nome>`
