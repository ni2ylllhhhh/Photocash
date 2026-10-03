/**
 * Cloudflare Pages Function: /api/verify
 * Allows the PhotoCash frontend to verify channel membership with zero CORS issues
 */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const BOT_TOKEN = env?.BOT_TOKEN || "8738784866:AAFk8eHwv2xuswJTCBxGcvKAwZuUJHq4bK0";
  const USER_DB_URL = env?.USER_DB_URL || "https://photo-cash-2-default-rtdb.firebaseio.com";

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const userId = url.searchParams.get("user_id");
  const channelParam = url.searchParams.get("channel");

  if (!userId) {
    return new Response(JSON.stringify({ ok: false, error: "user_id is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const channelsToCheck = channelParam
    ? [channelParam]
    : ["jgjghjghh687", "Earning_Money_Lob"];

  const results = [];
  let allJoined = true;

  for (const ch of channelsToCheck) {
    const cleanUsername = ch.replace(/^@/, "").replace(/https?:\/\/t\.me\//i, "");
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=@${encodeURIComponent(
          cleanUsername
        )}&user_id=${encodeURIComponent(userId)}`
      );
      const data = await res.json();

      if (data.ok && data.result) {
        const status = data.result.status;
        const isMember =
          status === "member" ||
          status === "administrator" ||
          status === "creator" ||
          status === "restricted";

        results.push({ channel: cleanUsername, joined: isMember, status });
        if (!isMember) allJoined = false;
      } else {
        results.push({ channel: cleanUsername, joined: false, error: data.description });
        allJoined = false;
      }
    } catch (err) {
      results.push({ channel: cleanUsername, joined: false, error: err.message });
      allJoined = false;
    }
  }

  // Update Firebase if all channels joined
  if (allJoined) {
    try {
      await fetch(`${USER_DB_URL}/users/${userId}.json`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelsVerified: true, channelsVerifiedAt: Date.now() }),
      });
    } catch {}
  }

  return new Response(JSON.stringify({ ok: true, all_joined: allJoined, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
