/**
 * Cloudflare Pages Function: /api/bot
 * Handles Telegram Webhooks for /start, /verify and inline channel buttons
 */

export async function onRequest(context) {
  const { request, env } = context;

  const BOT_TOKEN = env?.BOT_TOKEN || "8738784866:AAFk8eHwv2xuswJTCBxGcvKAwZuUJHq4bK0";
  const USER_DB_URL = env?.USER_DB_URL || "https://photo-cash-2-default-rtdb.firebaseio.com";
  const WEB_APP_URL = env?.WEB_APP_URL || "https://ais-pre-2cfqiwuo2yblyziu3t5py4-837591927600.asia-east1.run.app";
  const REQUIRED_CHANNELS = [
    { name: "Main Channel", username: "jgjghjghh687", url: "https://t.me/jgjghjghh687" },
    { name: "Support Channel", username: "Earning_Money_Lob", url: "https://t.me/Earning_Money_Lob" },
  ];
  const SIGNUP_BONUS = 0.5;

  if (request.method !== "POST") {
    return new Response("Telegram Bot Webhook is running on Cloudflare Pages!", { status: 200 });
  }

  try {
    const update = await request.json();

    // Channel Join Request Auto-Approval
    if (update.chat_join_request) {
      const cjr = update.chat_join_request;
      try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/approveChatJoinRequest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: cjr.chat.id, user_id: cjr.from.id }),
        });
        await fetch(`${USER_DB_URL}/users/${cjr.from.id}.json`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelsVerified: true, channelsVerifiedAt: Date.now() }),
        });
      } catch {}
      return new Response("OK");
    }

    // Callback query handling (Inline [ ✅ Verify Membership ] button)
    if (update.callback_query) {
      const cb = update.callback_query;
      const from = cb.from;
      const userId = String(from.id);
      const chatId = cb.message?.chat?.id || userId;

      if (cb.data === "verify_channels") {
        let allJoined = true;
        for (const ch of REQUIRED_CHANNELS) {
          try {
            const res = await fetch(
              `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=@${encodeURIComponent(
                ch.username
              )}&user_id=${encodeURIComponent(userId)}`
            );
            const data = await res.json();
            const status = data?.result?.status;
            const isMember = ["member", "administrator", "creator", "restricted"].includes(status);
            if (!isMember) allJoined = false;
          } catch {
            allJoined = false;
          }
        }

        if (allJoined) {
          // Update Firebase
          await fetch(`${USER_DB_URL}/users/${userId}.json`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channelsVerified: true, channelsVerifiedAt: Date.now() }),
          });

          // Answer callback
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ callback_query_id: cb.id, text: "🎉 ভেরিফিকেশন সফল হয়েছে!", show_alert: false }),
          });

          // Send confirmation message
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              parse_mode: "HTML",
              text:
                `🎉 <b>অভিনন্দন ${escapeHtml(from.first_name)}!</b>\n\n` +
                `✅ আপনার চ্যানেল ভেরিফিকেশন সফল হয়েছে।\n` +
                `এখন আপনি PhotoCash অ্যাপে ফটো আপলোড করে ইনকাম শুরু করতে পারেন।\n\n` +
                `👇 নিচের বাটনে চাপ দিয়ে অ্যাপ ওপেন করুন:`,
              reply_markup: {
                inline_keyboard: [
                  [{ text: "📸 Open PhotoCash App", web_app: { url: WEB_APP_URL } }],
                  [{ text: "💬 Support Community", url: "https://t.me/Click2Cash_Site" }],
                ],
              },
            }),
          });
        } else {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              callback_query_id: cb.id,
              text: "❌ আপনি এখনো সব চ্যানেলে জয়েন করেননি! দয়া করে দুটি চ্যানেলেই জয়েন করুন।",
              show_alert: true,
            }),
          });
        }
      }
      return new Response("OK");
    }

    // Message handling (/start, /verify)
    if (update.message) {
      const msg = update.message;
      const from = msg.from;
      if (!from) return new Response("OK");

      const chatId = msg.chat.id;
      const userId = String(from.id);
      const text = (msg.text || "").trim();

      if (text.startsWith("/start") || text.startsWith("/verify")) {
        // Check channels
        let allJoined = true;
        for (const ch of REQUIRED_CHANNELS) {
          try {
            const res = await fetch(
              `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=@${encodeURIComponent(
                ch.username
              )}&user_id=${encodeURIComponent(userId)}`
            );
            const data = await res.json();
            const status = data?.result?.status;
            if (!["member", "administrator", "creator", "restricted"].includes(status)) {
              allJoined = false;
            }
          } catch {
            allJoined = false;
          }
        }

        if (!allJoined) {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              parse_mode: "HTML",
              text:
                `👋 <b>স্বাগতম ${escapeHtml(from.first_name)}!</b>\n\n` +
                `⚠️ <b>চ্যানেল ভেরিফিকেশন আবশ্যক:</b>\n` +
                `PhotoCash ব্যবহারের জন্য আপনাকে অবশ্যই নিচের ২টি চ্যানেলে জয়েন হতে হবে:\n\n` +
                `1️⃣ <b>Main Channel:</b> @jgjghjghh687\n` +
                `2️⃣ <b>Support Channel:</b> @Earning_Money_Lob\n\n` +
                `চ্যানেলে জয়েন করে নিচের <b>"✅ ভেরিফাই করুন"</b> বাটনে চাপুন।`,
              reply_markup: {
                inline_keyboard: [
                  [{ text: "📢 1. Join Main Channel", url: "https://t.me/jgjghjghh687" }],
                  [{ text: "📢 2. Join Support Channel", url: "https://t.me/Earning_Money_Lob" }],
                  [{ text: "✅ ভেরিফাই করুন (Verify Membership)", callback_data: "verify_channels" }],
                ],
              },
            }),
          });
        } else {
          // Verified
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              parse_mode: "HTML",
              text:
                `👋 Welcome to <b>PhotoCash</b> 📸💸\n\n` +
                `Hello <b>${escapeHtml(from.first_name)}</b>!\n` +
                `আপনার চ্যানেল ভেরিফিকেশন অ্যাক্টিভ রয়েছে।\n` +
                `ফটো আপলোড করে ইনকাম শুরু করতে নিচের বাটনে চাপুন 👇`,
              reply_markup: {
                inline_keyboard: [
                  [{ text: "📸 Open PhotoCash App", web_app: { url: WEB_APP_URL } }],
                  [{ text: "💬 Support Community", url: "https://t.me/Click2Cash_Site" }],
                ],
              },
            }),
          });
        }
      }
    }

    return new Response("OK");
  } catch (err) {
    return new Response("Error: " + err.message, { status: 500 });
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
