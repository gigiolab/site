#!/bin/bash
# Roda NO VPS (via ssh 'bash -s' < remote_setup.sh) — sobe o gigiolab-intake,
# roteia gigiolab.dev/api/* no Traefik do Dokploy e atualiza o index.html do site.
set -euo pipefail

cd /root/gigiolab-intake

echo "== Montando .env =="
grep '^ANTHROPIC_API_KEY=' .env.key > .env
if [ ! -f .env.admin ]; then
  echo "ADMIN_TOKEN=$(openssl rand -hex 16)" > .env.admin
fi
cat .env.admin >> .env
chmod 600 .env .env.admin .env.key
echo "ADMIN_TOKEN (guarda isso): $(cut -d= -f2 .env.admin)"

echo "== Build da imagem =="
docker build -q -t gigiolab-intake .

echo "== Subindo container =="
NET=$(docker network ls --format '{{.Name}}' | grep -m1 dokploy || echo bridge)
echo "rede docker: $NET"
docker rm -f gigiolab-intake >/dev/null 2>&1 || true
docker run -d --name gigiolab-intake --restart unless-stopped \
  --network "$NET" \
  -v /root/gigiolab-intake-data:/data \
  --env-file /root/gigiolab-intake/.env \
  gigiolab-intake >/dev/null
echo "container no ar"

echo "== Rota /api no Traefik (Dokploy) =="
TRAEFIK_DIR=/etc/dokploy/traefik/dynamic
if [ ! -d "$TRAEFIK_DIR" ]; then
  echo "ERRO: $TRAEFIK_DIR não existe. Conteúdo de /etc/dokploy:"
  ls -R /etc/dokploy | head -30
  exit 1
fi
RESOLVER=$(awk '/certificatesResolvers:/{found=1; next} found && /^[[:space:]]+[a-zA-Z0-9_-]+:/{gsub(/[: ]/,""); print $0; exit}' /etc/dokploy/traefik/traefik.yml 2>/dev/null || true)
[ -z "$RESOLVER" ] && RESOLVER=letsencrypt
echo "certResolver: $RESOLVER"
cat > "$TRAEFIK_DIR/gigiolab-intake.yml" <<EOF
http:
  routers:
    gigiolab-intake:
      rule: "(Host(\`gigiolab.dev\`) || Host(\`www.gigiolab.dev\`)) && PathPrefix(\`/api/\`)"
      service: gigiolab-intake
      entryPoints:
        - websecure
      tls:
        certResolver: $RESOLVER
  services:
    gigiolab-intake:
      loadBalancer:
        servers:
          - url: "http://gigiolab-intake:8080"
EOF
echo "rota escrita"

echo "== Atualizando index.html do site no ar =="
SITE_C=""
for c in $(docker ps --format '{{.Names}}'); do
  if docker exec "$c" test -f /srv/index.html 2>/dev/null; then SITE_C=$c; break; fi
done
if [ -n "$SITE_C" ]; then
  docker cp /root/gigiolab-intake/index.html "$SITE_C":/srv/index.html
  echo "site atualizado no container: $SITE_C"
else
  echo "AVISO: container do site (Caddy com /srv/index.html) não encontrado — atualizar via Dokploy (Redeploy)"
fi

echo "== Verificação =="
sleep 3
docker logs --tail 5 gigiolab-intake
echo "-- health via HTTPS público --"
curl -s --max-time 15 https://gigiolab.dev/api/health || echo "(health ainda não respondeu — Traefik pode levar ~30s pra carregar a rota)"
echo
echo "== FIM =="
