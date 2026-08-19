# gigiolab.dev — site institucional

Landing de 1 página da GigioLab (Fábrica de Software). HTML + CSS puro, sem build,
sem JavaScript. Servida por Caddy em container, atrás do Traefik do Dokploy.

## Estrutura

```
public/          # o site (index.html, favicon.svg, og.png)
Caddyfile        # file server estático na porta 8080 (TLS fica com o Traefik)
Dockerfile       # caddy:2-alpine + arquivos
```

Identidade visual: brand book FINAL em
`~/Projetos_NOVOS/____GigioLAB____/identidade-visual/` (paleta Terracota/Obsidian,
Space Grotesk + Inter + JetBrains Mono via Google Fonts).

## Rodar local

```bash
# sem Docker (qualquer servidor estático serve):
python3 -m http.server 4173 --directory public

# com Docker:
docker build -t gigiolab-site .
docker run --rm -p 8080:8080 gigiolab-site
```

## Deploy (VPS GigioLAB · Dokploy)

VPS: `187.127.59.198` (srv1916490, KVM 4, São Paulo). Dokploy em `http://187.127.59.198:3000`.

1. **DNS** (hPanel Hostinger, conta `geovane.junior.ia@gmail.com`, zona `gigiolab.dev`):
   - `A @ → 187.127.59.198`
   - `A www → 187.127.59.198`
   - Remover o A de parking (2.57.91.91).
2. **Dokploy**: criar Application `gigiolab-site` a partir deste repositório
   (provider GitHub ou Git), build type **Dockerfile**.
3. **Domains** da aplicação: `gigiolab.dev` (e `www.gigiolab.dev` com redirect),
   porta do container **8080**, HTTPS **on** (Let's Encrypt via Traefik).
   Lembrete: `.dev` é HSTS-preloaded — sem certificado válido o site não abre.
4. Deploy. Autodeploy on push opcional depois.

## Pendências conhecidas

- Caixa `contato@gigiolab.dev` ainda não existe (plano: Hostinger Mail Starter) —
  o CTA do site aponta pra ela; criar antes de divulgar o link.
- OG image atual é o símbolo em PNG transparente; gerar um card 1200×630 depois.
