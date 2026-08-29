#!/bin/bash
# Deploy do gigiolab-intake — roda NO MAC. Envia os arquivos pro KVM 4 e
# executa o remote_setup.sh lá dentro.
set -euo pipefail

VPS="root@187.127.59.198"
KEY="$HOME/.ssh/gigiolab_vps"
SITE_DIR="$HOME/Projetos_NOVOS/____GigioLAB____/site"
SSH_OPTS=(-i "$KEY" -o StrictHostKeyChecking=accept-new)

if ! grep -q '^ANTHROPIC_API_KEY=sk-ant-' "$SITE_DIR/intake/.env.deploy"; then
  echo "ERRO: $SITE_DIR/intake/.env.deploy sem ANTHROPIC_API_KEY válida"; exit 1
fi

echo "== 1/3 Enviando arquivos pro VPS =="
ssh "${SSH_OPTS[@]}" "$VPS" "mkdir -p /root/gigiolab-intake"
scp "${SSH_OPTS[@]}" -q \
  "$SITE_DIR/intake/server.js" \
  "$SITE_DIR/intake/Dockerfile" \
  "$SITE_DIR/public/index.html" \
  "$VPS:/root/gigiolab-intake/"
scp "${SSH_OPTS[@]}" -q "$SITE_DIR/intake/.env.deploy" "$VPS:/root/gigiolab-intake/.env.key"

echo "== 2/3 Executando setup remoto =="
ssh "${SSH_OPTS[@]}" "$VPS" 'bash -s' < "$SITE_DIR/intake/remote_setup.sh"

echo "== 3/3 Teste do endpoint a partir do Mac =="
sleep 5
curl -s --max-time 20 https://gigiolab.dev/api/health && echo || echo "health não respondeu ainda — espera ~30s e tenta: curl -s https://gigiolab.dev/api/health"
