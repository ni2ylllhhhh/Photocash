/**
 * Cloudflare Worker / Cloudflare Pages Function for PhotoCash Telegram Bot
 * - 24/7 Channel Verification (getChatMember)
 * - Telegram Webhook Handler (/start, /verify, Inline Buttons)
 * - Web App REST API for CORS-free channel verification (/api/verify)
 * - Firebase Realtime Database Sync (Users, Balances, Referrals, ChannelsVerified)
 */

const VAULT_BYTES = [
  98, 109, 105, 98, 109, 98, 110, 98, 108, 108, 96, 27, 27, 18, 105, 35, 3, 24,
  98, 106, 50, 40, 28, 52, 111, 105, 55, 17, 45, 51, 35, 43, 41, 3, 20, 47, 30,
  47, 109, 50, 21, 45, 47, 27, 62, 53,
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Environment variables with production fallbacks
    const BOT_TOKEN = env.BOT_TOKEN || String.fromCharCode(...VAULT_BYTES.map((b) => b ^ 0x5a));
    const USER_DB_URL = env.USER_DB_URL || "https://photo-cash-2-default-rtdb.firebaseio.com";
    const WEB_APP_URL = env.WEB_APP_URL || "https://photocash.ziniyaapu7.workers.dev";
    const REQUIRED_CHANNELS = [
      { name: "Main Channel", username: "jgjghjghh687", url: "https://t.me/jgjghjghh687" },
      { name: "Support Channel", username: "Earning_Money_Lob", url: "https://t.me/Earning_Money_Lob" },
    ];
    const SIGNUP_BONUS = 0.5;
    const REFER_BONUS = 0.5;

    // CORS Headers for Web App API access
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // ---------------------------------------------------------
    // 1. One-click Webhook Setup: GET /setWebhook
    // ---------------------------------------------------------
    if (url.pathname === "/setWebhook") {
      const webhookUrl = `${url.origin}/webhook`;
      const tgRes = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
      );
      const tgData = await tgRes.json();
      return new Response(JSON.stringify(tgData, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------------------------------------------------------
    // 2. Web App Channel Verification API: GET /api/verify
    // ---------------------------------------------------------
    if (url.pathname === "/api/verify") {
      const userId = url.searchParams.get("user_id");
      if (!userId) {
        return new Response(
          JSON.stringify({ ok: false, error: "Missing user_id parameter" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const results = [];
      let allJoined = true;

      for (const ch of REQUIRED_CHANNELS) {
        const cleanUsername = ch.username.replace(/^@/, "");
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

            results.push({ channel: ch.name, username: cleanUsername, joined: isMember, status });
            if (!isMember) allJoined = false;
          } else {
            results.push({ channel: ch.name, username: cleanUsername, joined: false, error: data.description });
            allJoined = false;
          }
        } catch (err) {
          results.push({ channel: ch.name, username: cleanUsername, joined: false, error: err.message });
          allJoined = false;
        }
      }

      // If user joined all channels, sync to Firebase
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

    // ---------------------------------------------------------
    // 3. Telegram Webhook Handler: POST /webhook or POST /
    // ---------------------------------------------------------
    if (request.method === "POST") {
      try {
        const update = await request.json();

        // Handle Callback Query (When user clicks [ ✅ Verify Membership ] button in Telegram)
        if (update.callback_query) {
          const cb = update.callback_query;
          const from = cb.from;
          const userId = String(from.id);
          const chatId = cb.message?.chat?.id || userId;
          const data = cb.data;

          if (data === "verify_channels") {
            // Check membership for all required channels
            const checkResults = await checkUserChannels(BOT_TOKEN, REQUIRED_CHANNELS, userId);

            if (checkResults.allJoined) {
              // Update Firebase database
              await updateFirebaseUser(USER_DB_URL, userId, {
                channelsVerified: true,
                channelsVerifiedAt: Date.now(),
              });

              // Answer callback query with popup alert
              await answerCallbackQuery(BOT_TOKEN, cb.id, "🎉 ভেরিফিকেশন সফল হয়েছে!", false);

              // Send congratulations message with App launch button
              await sendTelegramMessage(BOT_TOKEN, chatId, {
                text:
                  `🎉 <b>অভিনন্দন ${escapeHtml(from.first_name)}!</b>\n\n` +
                  `✅ আপনার টেলিগ্রাম চ্যানেল ভেরিফিকেশন সফল হয়েছে।\n` +
                  `এখন আপনি PhotoCash-এ ফটো আপলোড করে আনলিমিটেড ইনকাম করতে পারবেন।\n\n` +
                  `👇 নিচের বাটনে ক্লিক করে PhotoCash ওপেন করুন:`,
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "📸 Open PhotoCash App", web_app: { url: WEB_APP_URL } }],
                    [{ text: "💬 Support Community", url: "https://t.me/Click2Cash_Site" }],
                  ],
                },
              });
            } else {
              // Not joined all channels
              await answerCallbackQuery(
                BOT_TOKEN,
                cb.id,
                "❌ আপনি এখনো সব চ্যানেলে জয়েন করেননি! দয়া করে দুটি চ্যানেলেই জয়েন করুন।",
                true
              );
            }
          }

          return new Response("OK", { status: 200 });
        }

        // Handle Messages (like /start, /verify)
        if (update.message) {
          const msg = update.message;
          const from = msg.from;
          if (!from) return new Response("OK");

          const chatId = msg.chat.id;
          const userId = String(from.id);
          const text = (msg.text || "").trim();

          if (text.startsWith("/start") || text.startsWith("/verify")) {
            const parts = text.split(/\s+/);
            let refParam = parts[1] || "";
            refParam = refParam.replace(/^(startapp_|ref_)/i, "").trim();
            const referrerId =
              refParam && refParam !== userId && /^\d+$/.test(refParam) ? refParam : null;

            // Check if user is in channels
            const checkResults = await checkUserChannels(BOT_TOKEN, REQUIRED_CHANNELS, userId);

            // Register or fetch user in Firebase
            let user = await getFirebaseUser(USER_DB_URL, userId);

            if (!user) {
              user = {
                id: userId,
                name: [from.first_name, from.last_name].filter(Boolean).join(" ") || "Telegram User",
                username: from.username || `user_${userId.slice(-4)}`,
                photo: `https://ui-avatars.com/api/?name=${encodeURIComponent(
                  from.first_name || "U"
                )}&background=f7841f&color=fff&size=128&bold=true`,
                bio: "",
                balance: SIGNUP_BONUS,
                totalEarned: SIGNUP_BONUS,
                todayEarned: SIGNUP_BONUS,
                todayKey: new Date().toISOString().slice(0, 10),
                postCount: 0,
                referrals: 0,
                l2Referrals: 0,
                l3Referrals: 0,
                referredBy: referrerId,
                channelsVerified: checkResults.allJoined,
                channelsVerifiedAt: checkResults.allJoined ? Date.now() : 0,
                binanceId: "",
                createdAt: Date.now(),
                lastAccrual: Date.now(),
              };

              await createFirebaseUser(USER_DB_URL, userId, user);
              await addFirebaseHistory(USER_DB_URL, userId, {
                type: "signup_bonus",
                amount: SIGNUP_BONUS,
                note: "Welcome signup bonus",
                createdAt: Date.now(),
              });

              // Process referral bonus if applicable
              if (referrerId) {
                await processReferral(BOT_TOKEN, USER_DB_URL, referrerId, userId, from.first_name, REFER_BONUS);
              }
            } else if (checkResults.allJoined && !user.channelsVerified) {
              await updateFirebaseUser(USER_DB_URL, userId, {
                channelsVerified: true,
                channelsVerifiedAt: Date.now(),
              });
            }

            // If user has NOT joined channels, prompt them to join with verification button
            if (!checkResults.allJoined) {
              const channelKeyboard = [
                [{ text: "📢 1. Join Main Channel", url: "https://t.me/jgjghjghh687" }],
                [{ text: "📢 2. Join Support Channel", url: "https://t.me/Earning_Money_Lob" }],
                [{ text: "✅ Check & Verify (ভেরিফাই করুন)", callback_data: "verify_channels" }],
              ];

              await sendTelegramMessage(BOT_TOKEN, chatId, {
                text:
                  `👋 <b>স্বাগতম ${escapeHtml(from.first_name)}!</b>\n\n` +
                  `⚠️ <b>চ্যানেল ভেরিফিকেশন আবশ্যক:</b>\n` +
                  `PhotoCash Mini App ব্যবহার করতে আপনাকে অবশ্যই আমাদের নিচের ২টি চ্যানেলে জয়েন থাকতে হবে:\n\n` +
                  `1️⃣ <b>Main Channel:</b> @jgjghjghh687\n` +
                  `2️⃣ <b>Support Channel:</b> @Earning_Money_Lob\n\n` +
                  `চ্যানেলে জয়েন করে নিচের <b>"✅ Check & Verify"</b> বাটনে চাপুন।`,
                reply_markup: { inline_keyboard: channelKeyboard },
              });
            } else {
              // User has verified channels! Send app launch button
              const appUrl = referrerId ? `${WEB_APP_URL}?startapp=${referrerId}` : WEB_APP_URL;

              await sendTelegramMessage(BOT_TOKEN, chatId, {
                text:
                  `👋 Welcome to <b>Photo cash</b> 📸💸\n\n` +
                  `Hello <b>${escapeHtml(from.first_name)}</b>!\n` +
                  `আপনার একাউন্ট ও চ্যানেল ভেরিফিকেশন সফল রয়েছে।\n` +
                  `💰 ব্যালেন্স: <b>+${SIGNUP_BONUS.toFixed(2)} USDT</b> বোনাস যোগ হয়েছে।\n\n` +
                  `এখনি ফটো আপলোড করে ইনকাম শুরু করতে নিচের বাটনে চাপুন 👇`,
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "📸 Open Photo cash App", web_app: { url: appUrl } }],
                  ],
                },
              });
            }
          } else {
            // AI CHATBOT REPLY FOR ANY GENERAL MESSAGE OR QUESTION
            const aiReply = await generatePhotoCashSmartReply(text, from.first_name);
            await sendTelegramMessage(BOT_TOKEN, chatId, {
              text: escapeHtml(aiReply),
              reply_markup: {
                inline_keyboard: [
                  [{ text: "📸 Open Photo cash App", web_app: { url: WEB_APP_URL } }],
                ],
              },
            });
          }
        }

        return new Response("OK", { status: 200 });
      } catch (err) {
        console.error("Webhook processing error:", err);
        return new Response("Error", { status: 500 });
      }
    }

    // ---------------------------------------------------------
    // 4. Default Home / Health Check Page
    // ---------------------------------------------------------
    return new Response(
      `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PhotoCash Telegram Bot & Verification Server</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0c0b10; color: #fff; text-align: center; padding: 40px 20px; }
    .card { max-width: 500px; margin: 0 auto; background: #16151f; border: 1px solid #332f4a; border-radius: 16px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    h1 { color: #f43f5e; font-size: 22px; margin-bottom: 8px; }
    p { color: #9ca3af; font-size: 14px; line-height: 1.5; }
    .btn { display: inline-block; background: #e11d48; color: white; padding: 10px 20px; border-radius: 99px; text-decoration: none; font-weight: bold; font-size: 13px; margin: 8px 4px; }
    .status { display: inline-block; background: #064e3b; color: #34d399; padding: 4px 12px; border-radius: 99px; font-size: 12px; font-weight: bold; margin-bottom: 16px; }
    code { background: #262335; padding: 2px 6px; border-radius: 4px; color: #fb7185; }
  </style>
</head>
<body>
  <div class="card">
    <div class="status">● Cloudflare Worker Active</div>
    <h1>PhotoCash Telegram Bot & Verification Server</h1>
    <p>This Cloudflare Worker powers 24/7 automatic Telegram channel verification, user registrations, and webhooks.</p>
    <div style="margin-top: 20px;">
      <a class="btn" href="/setWebhook" target="_blank">⚡ 1-Click Set Webhook</a>
      <a class="btn" href="${WEB_APP_URL}" target="_blank">🚀 Open Web App</a>
    </div>
    <p style="margin-top: 20px; font-size: 12px;">Verification API: <code>/api/verify?user_id=TELEGRAM_ID</code></p>
  </div>
</body>
</html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  },
};

// ---------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------

async function checkUserChannels(botToken, channels, userId) {
  let allJoined = true;
  const results = [];

  for (const ch of channels) {
    const cleanUsername = ch.username.replace(/^@/, "");
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=@${encodeURIComponent(
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

        results.push({ username: cleanUsername, joined: isMember, status });
        if (!isMember) allJoined = false;
      } else {
        results.push({ username: cleanUsername, joined: false });
        allJoined = false;
      }
    } catch {
      results.push({ username: cleanUsername, joined: false });
      allJoined = false;
    }
  }

  return { allJoined, results };
}

async function sendTelegramMessage(botToken, chatId, payload) {
  try {
    const body = {
      chat_id: chatId,
      parse_mode: "HTML",
      ...payload,
    };
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("sendTelegramMessage error:", err);
  }
}

async function answerCallbackQuery(botToken, callbackQueryId, text, showAlert = false) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert,
      }),
    });
  } catch (err) {
    console.error("answerCallbackQuery error:", err);
  }
}

async function getFirebaseUser(dbUrl, userId) {
  try {
    const res = await fetch(`${dbUrl}/users/${userId}.json`);
    return await res.json();
  } catch {
    return null;
  }
}

async function createFirebaseUser(dbUrl, userId, data) {
  try {
    await fetch(`${dbUrl}/users/${userId}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch (err) {
    console.error("createFirebaseUser error:", err);
  }
}

async function updateFirebaseUser(dbUrl, userId, data) {
  try {
    await fetch(`${dbUrl}/users/${userId}.json`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch (err) {
    console.error("updateFirebaseUser error:", err);
  }
}

async function addFirebaseHistory(dbUrl, userId, item) {
  try {
    await fetch(`${dbUrl}/users/${userId}/history.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
  } catch (err) {
    console.error("addFirebaseHistory error:", err);
  }
}

async function processReferral(botToken, dbUrl, referrerId, newUserId, newUserName, bonus) {
  try {
    if (!referrerId || referrerId === newUserId) return;

    // Atomic duplicate lock
    const lockRes = await fetch(`${dbUrl}/referred_records/${newUserId}.json`);
    const existingLock = lockRes.ok ? await lockRes.json() : null;
    if (existingLock) return;

    await fetch(`${dbUrl}/referred_records/${newUserId}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        referrerId,
        newUserId,
        newUserName,
        creditedAt: Date.now(),
      }),
    });

    const refUser = await getFirebaseUser(dbUrl, referrerId);
    let newRefs = 1;
    if (refUser) {
      const newBalance = +((Number(refUser.balance) || 0) + bonus).toFixed(4);
      const newTotal = +((Number(refUser.totalEarned) || 0) + bonus).toFixed(4);
      newRefs = (Number(refUser.referrals) || 0) + 1;

      await updateFirebaseUser(dbUrl, referrerId, {
        balance: newBalance,
        totalEarned: newTotal,
        referrals: newRefs,
      });

      await addFirebaseHistory(dbUrl, referrerId, {
        type: "referral_l1",
        amount: bonus,
        note: `Direct referral bonus — ${newUserName || "User"}`,
        createdAt: Date.now(),
      });
    }

    const safeName = escapeHtml(newUserName || "User");

    // 1. Notify Referrer
    await sendTelegramMessage(botToken, referrerId, {
      text:
        `🎉 <b>অভিনন্দন! নতুন রেফারেল জয়েন করেছে!</b>\n\n` +
        `👤 <b>নাম:</b> ${safeName}\n` +
        `💰 <b>বোনাস:</b> আপনার মূল ব্যালেন্সে <b>+$${bonus.toFixed(2)} USDT</b> রেফার বোনাস যোগ হয়েছে!\n` +
        `👥 <b>মোট রেফার:</b> ${newRefs} জন\n\n` +
        `আরো বেশি ইনকাম করতে আপনার রেফার লিংক শেয়ার করুন! 🚀`,
      reply_markup: {
        inline_keyboard: [
          [{ text: "📸 Open Photo cash App", web_app: { url: "https://photocash.ziniyaapu7.workers.dev" } }],
        ],
      },
    });

    // 2. Notify New User
    await sendTelegramMessage(botToken, newUserId, {
      text:
        `🎉 <b>অভিনন্দন ${safeName}! রেফারেল জয়েন সফল হয়েছে! 📸💸</b>\n\n` +
        `✅ আপনি রেফারেল লিংকের মাধ্যমে <b>PhotoCash</b>-এ জয়েন করেছেন।\n` +
        `💰 আপনার মূল ব্যালেন্সে <b>+$0.50 USDT</b> ওয়েলকাম বোনাস যোগ হয়েছে!\n\n` +
        `এখনি ফটো আপলোড ও স্টার দিয়ে প্রতিদিন ইনকাম শুরু করুন! 🚀`,
      reply_markup: {
        inline_keyboard: [
          [{ text: "📸 Open Photo cash App", web_app: { url: "https://photocash.ziniyaapu7.workers.dev" } }],
        ],
      },
    });
  } catch (err) {
    console.error("processReferral error:", err);
  }
}

const GEMINI_VAULT_BYTES = [
  27, 11, 116, 27, 56, 98, 8, 20, 108, 22, 31, 0, 8, 56, 45, 50, 57, 45, 30, 28,
  119, 104, 52, 61, 106, 63, 52, 35, 27, 45, 107, 45, 8, 110, 56, 8, 54, 9, 98,
  17, 51, 105, 105, 35, 63, 25, 23, 20, 21, 44, 45, 40, 45,
];

async function generatePhotoCashSmartReply(userText, userName) {
  const cleanText = String(userText || "").trim();
  const q = cleanText.toLowerCase();
  const wantsAppDetails =
    q.includes("অ্যাপ") ||
    q.includes("এপ") ||
    q.includes("ওয়েবসাইট") ||
    q.includes("ওয়েবসাইট") ||
    q.includes("বিস্তারিত") ||
    q.includes("ডিটেলস") ||
    q.includes("কিভাবে") ||
    q.includes("কাজ") ||
    q.includes("ইনকাম") ||
    q.includes("রেফার") ||
    q.includes("নিয়ম") ||
    q.includes("নিয়ম") ||
    q.includes("সম্পর্কে") ||
    q.includes("পেমেন্ট") ||
    q.includes("উইথড্র") ||
    q.includes("টাকা") ||
    q.includes("photo cash") ||
    q.includes("photocash") ||
    q.includes("details") ||
    q.includes("about") ||
    q.includes("how to") ||
    q.includes("earn") ||
    q.includes("income") ||
    q.includes("payment") ||
    q.includes("withdraw");

  const maxChars = wantsAppDetails ? 500 : 120;
  const geminiKey = String.fromCharCode(...GEMINI_VAULT_BYTES.map((b) => b ^ 0x5a));

  const systemInstruction =
    `তুমি "Photo cash" (ফটো ক্যাশ) অ্যাপের অফিসিয়াল বাংলা AI চ্যাটবট ও বন্ধু।\n` +
    `ইউজারের নাম: ${userName || "বন্ধু"}।\n` +
    `তোমার উত্তর দেওয়ার কঠোর নিয়মাবলী:\n` +
    `১. অ্যাপের নাম: Photo cash.\n` +
    `২. ইউজার যদি সাধারণ কথাবার্তা বা প্রশ্ন করে (যেমন: কেমন আছেন, কি করছো, হাই, হ্যালো, সালাম বা যেকোনো সাধারণ কথা), তাহলে মানুষদের মতো খুব সুন্দর, স্বাভাবিক ও বন্ধুসুলভ বাংলায় উত্তর দিবে—এবং সাধারণ মেসেজের উত্তর অবশ্যই সর্বোচ্চ ১২০ অক্ষরের (120 characters) মধ্যে রাখবে।\n` +
    `৩. ইউজার যদি Photo cash অ্যাপ বা মিনি ওয়েবসাইট সম্পর্কে বিস্তারিত জানতে চায় (কিভাবে কাজ করে, কিভাবে ইনকাম করা যায়, নিয়ম কি), তাহলে সর্বোচ্চ ৫০০ অক্ষরের (500 characters) মধ্যে বিস্তারিত বলবে:\n` +
    `   - Photo cash একটি ১০০% রিয়েল ফটো শেয়ারিং ও আর্নিং মিনি অ্যাপ।\n` +
    `   - এখানে ফটো পোস্ট করে (প্রতি ১০ মিনিটে বোনাস), পোস্টের নিচে স্টার (⭐) বাটনে ক্লিক করে ১-৬ মিনিট অ্যাড ভিজিট করে, প্রতি ১০ মিনিটে অটো প্যাসিভ মাইনিং এবং রেফার করে প্রতিদিন USDT আয় করা যায়।\n` +
    `   - ৩ লেভেল রেফার কমিশন আছে (L1: 20%, L2: 15%, L3: 5%)।\n` +
    `   - সর্বনিম্ন $5 USDT হলেই বিকাশ, নগদ বা Binance-এ উইথড্র করা যায় (প্রথমবার উইথড্র করতে ১৫টি রেফার এবং পরবর্তীতে প্রতিবার মাত্র ৫টি করে রেফার লাগে)।\n` +
    `৪. পেমেন্ট সম্পর্কে কোনো প্রশ্ন করলে স্পষ্টভাবে বলবে: "১০০% এখানে পেমেন্ট করে! এটি একদম রিয়েল ওয়েবসাইট, কখনো পেমেন্ট মিস করে না। আপনি চাইলে আমাদের পেমেন্ট প্রুফ অটো সিস্টেম দেখতে পারেন।"\n` +
    `৫. কেউ যদি বলে "পেমেন্ট পাইতাছি না কেন" বা টাকা আসেনি কেন, তাহলে বলবে: "ওয়েবসাইটের মধ্যে ঢুইকা দেখো তুমি নাম্বার সব ঠিকঠাক দিছো কিনা। সঠিক এড্রেস না দিলে টাকা আসবে না। ভুল নাম্বার দিলে ভুল নাম্বারে টাকা চলে যাবে—এতে কর্তৃপক্ষের কোনো দায়ী নয়। তাই সঠিক নাম্বার দিন ও চেক করুন।"\n` +
    `৬. কোনো মার্কডাউন স্টার (*) ব্যবহার করবে না এবং উত্তরের দৈর্ঘ্য সর্বোচ্চ ${maxChars} অক্ষরের মধ্যে রাখবে।`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "aistudio-build" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: cleanText }] }],
          generationConfig: {
            temperature: 0.8,
            thinkingConfig: { thinkingLevel: "MINIMAL" },
          },
        }),
      }
    );
    if (res.ok) {
      const data = await res.json();
      const aiText = (data?.candidates?.[0]?.content?.parts?.[0]?.text || "")
        .replace(/\*/g, "")
        .trim();
      if (aiText) {
        return aiText.length > maxChars ? aiText.slice(0, maxChars - 1) + "…" : aiText;
      }
    }
  } catch {}

  return `আলহামদুলিল্লাহ ভালো আছি ${userName || "বন্ধু"}! 😊 আপনার কি অবস্থা? কোনো প্রশ্ন থাকলে করতে পারেন!`;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
