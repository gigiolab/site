// Cloudflare Worker — endpoint do formulário de contato do gigiolab.dev
//
// Recebe POST JSON do formulário do site, valida, rate-limita por IP,
// e encaminha pra o e-mail geovane@gigiolab.dev via API do Zoho ZeptoMail.
//
// Segredo esperado: env.ZEPTOMAIL_TOKEN — configurar com:
//   wrangler secret put ZEPTOMAIL_TOKEN
// Nunca commitar o token; ele mora no Cloudflare, não no repo.

const MAX_BODY_BYTES = 4096;              // 4 KB — form de contato não precisa de mais
const MAX_NAME = 100;
const MAX_EMAIL = 254;                    // RFC 5321
const MAX_MESSAGE = 5000;
const RATE_LIMIT_MAX = 3;                 // msgs por IP por janela
const RATE_LIMIT_WINDOW_SEC = 3600;       // 1 hora

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const originAllowed = allowedOrigins.includes(origin);

    // Preflight CORS
    if (request.method === "OPTIONS") {
      if (!originAllowed) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    // Só aceita POST
    if (request.method !== "POST") {
      return json({ ok: false, error: "método não permitido" }, 405, origin, originAllowed);
    }

    if (!originAllowed) {
      return json({ ok: false, error: "origem não autorizada" }, 403, origin, false);
    }

    // Tamanho do payload
    const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
    if (contentLength > MAX_BODY_BYTES) {
      return json({ ok: false, error: "mensagem grande demais" }, 413, origin, true);
    }

    // Parse JSON
    let body;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) {
        return json({ ok: false, error: "mensagem grande demais" }, 413, origin, true);
      }
      body = JSON.parse(raw);
    } catch {
      return json({ ok: false, error: "corpo inválido" }, 400, origin, true);
    }

    // Honeypot — bot preencheu o campo escondido, aceita silenciosamente sem enviar
    if (typeof body.website === "string" && body.website.trim() !== "") {
      return json({ ok: true }, 200, origin, true);
    }

    // Validação de campos
    const name = sanitize(body.name, MAX_NAME);
    const email = sanitize(body.email, MAX_EMAIL);
    const message = sanitize(body.message, MAX_MESSAGE);

    if (!name || name.length < 2) {
      return json({ ok: false, error: "nome inválido" }, 400, origin, true);
    }
    if (!email || !EMAIL_RE.test(email)) {
      return json({ ok: false, error: "e-mail inválido" }, 400, origin, true);
    }
    if (!message || message.length < 10) {
      return json({ ok: false, error: "mensagem muito curta" }, 400, origin, true);
    }

    // Rate limit por IP
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (env.RATE_LIMIT) {
      const key = `rl:${ip}`;
      const current = parseInt((await env.RATE_LIMIT.get(key)) || "0", 10);
      if (current >= RATE_LIMIT_MAX) {
        return json(
          { ok: false, error: "muitas tentativas — tenta de novo daqui a pouco" },
          429,
          origin,
          true
        );
      }
      // TTL renova a cada put — mantemos a primeira janela via metadata pra ser exato
      // Simples: sempre extende TTL. Aceito trade-off (janela deslizante) por simplicidade.
      await env.RATE_LIMIT.put(key, String(current + 1), {
        expirationTtl: RATE_LIMIT_WINDOW_SEC,
      });
    }

    // Envio via ZeptoMail
    const toEmail = env.TO_EMAIL || "geovane@gigiolab.dev";
    const toName = env.TO_NAME || "Geovane Júnior";
    const fromEmail = env.FROM_EMAIL || "contato@gigiolab.dev";
    const fromName = env.FROM_NAME || "Contato GigioLAB";

    const payload = {
      from: { address: fromEmail, name: fromName },
      to: [{ email_address: { address: toEmail, name: toName } }],
      reply_to: [{ address: email, name }],
      subject: `[Site] Contato de ${name}`,
      htmlbody: renderHtml({ name, email, message, ip }),
      textbody: renderText({ name, email, message, ip }),
    };

    try {
      const resp = await fetch("https://api.zeptomail.com/v1.1/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Zoho-enczapikey ${env.ZEPTOMAIL_TOKEN}`,
        },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const detail = await resp.text().catch(() => "");
        console.error("ZeptoMail error", resp.status, detail);
        return json({ ok: false, error: "envio falhou" }, 502, origin, true);
      }
      return json({ ok: true }, 200, origin, true);
    } catch (err) {
      console.error("fetch err", err);
      return json({ ok: false, error: "envio falhou" }, 502, origin, true);
    }
  },
};

// ------- helpers -------

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(payload, status, origin, allowed) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (allowed) Object.assign(headers, corsHeaders(origin));
  return new Response(JSON.stringify(payload), { status, headers });
}

function sanitize(input, max) {
  if (typeof input !== "string") return "";
  // Tira tags HTML e caracteres de controle. Não é anti-XSS blindado,
  // mas o corpo é enviado como texto/htmlbody que a gente monta — o risco real
  // seria header injection (\r\n em name/email) e HTML escape no body.
  return input
    .replace(/[\x00-\x1F\x7F]/g, "")        // caracteres de controle (\r, \n, tab, DEL, etc.) — evita header injection
    .replace(/<[^>]*>/g, "")                // strip de tags HTML simples
    .trim()
    .slice(0, max);
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtml({ name, email, message, ip }) {
  const nl2br = (s) => escapeHtml(s).replace(/\n/g, "<br>");
  return `
<div style="font-family:Arial,sans-serif;color:#2D2D2D;line-height:1.5;">
  <p style="margin:0 0 12px;color:#8A8A8A;font-size:12px;">
    Novo contato pelo formulário do site.
  </p>
  <table cellpadding="6" cellspacing="0" border="0" style="font-size:14px;">
    <tr><td style="color:#8A8A8A;">Nome:</td><td>${escapeHtml(name)}</td></tr>
    <tr><td style="color:#8A8A8A;">E-mail:</td><td><a href="mailto:${escapeHtml(email)}" style="color:#D97757;">${escapeHtml(email)}</a></td></tr>
  </table>
  <div style="margin-top:16px;padding:12px 16px;background:#F7F7F5;border-left:3px solid #D97757;">
    ${nl2br(message)}
  </div>
  <p style="margin:16px 0 0;font-size:11px;color:#A8A8A8;">
    IP: ${escapeHtml(ip)} · Responda direto neste e-mail — o Reply-To aponta pro visitante.
  </p>
</div>`.trim();
}

function renderText({ name, email, message, ip }) {
  return [
    "Novo contato pelo formulário do site.",
    "",
    `Nome: ${name}`,
    `E-mail: ${email}`,
    "",
    "Mensagem:",
    message,
    "",
    `— IP: ${ip}`,
    "Responda direto neste e-mail (Reply-To aponta pro visitante).",
  ].join("\n");
}
