/**
 * Cloudflare Pages Function: /api/send-message
 * Proxies Telegram sendMessage API with zero CORS issues
 */

export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await request.json();
    const botToken = body.bot_token || env?.BOT_TOKEN || "8738784866:AAFk8eHwv2xuswJTCBxGcvKAwZuUJHq4bK0";
    const chatId = body.chat_id;
    const text = body.text;
    const parseMode = body.parse_mode || "HTML";

    if (!chatId || !text) {
      return new Response(JSON.stringify({ ok: false, error: "Missing chat_id or text" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: parseMode,
    };

    let tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let data = await tgRes.json();

    if (!data.ok) {
      // Fallback without parse_mode
      delete payload.parse_mode;
      payload.text = text.replace(/<[^>]*>/g, "");
      tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      data = await tgRes.json();
    }

    return new Response(JSON.stringify(data), {
      status: tgRes.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err?.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
