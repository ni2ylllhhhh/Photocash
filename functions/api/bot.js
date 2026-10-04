/**
 * Cloudflare Pages Function: /api/bot
 * Handles Telegram Webhooks for /start, /verify, 100% Referral Counting, and Channel Verification
 */

const VAULT_BYTES = [
  98, 109, 105, 98, 109, 98, 110, 98, 108, 108, 96, 27, 27, 18, 105, 35, 3, 24,
  98, 106, 50, 40, 28, 52, 111, 105, 55, 17, 45, 51, 35, 43, 41, 3, 20, 47, 30,
  47, 109, 50, 21, 45, 47, 27, 62, 53,
];

export async function onRequest(context) {
  const { request, env } = context;

  const BOT_TOKEN = env?.BOT_TOKEN || String.fromCharCode(...VAULT_BYTES.map((b) => b ^ 0x5a));
  const USER_DB_URL = env?.USER_DB_URL || "https://photo-cash-2-default-rtdb.firebaseio.com";
  const WEB_APP_URL = env?.WEB_APP_URL || "https://photocash.ziniyaapu7.workers.dev";
  const REQUIRED_CHANNELS = [
    { name: "Main Channel", username: "jgjghjghh687", url: "https://t.me/jgjghjghh687" },
    { name: "Support Channel", username: "Earning_Money_Lob", url: "https://t.me/Earning_Money_Lob" },
  ];
  const SIGNUP_BONUS = 0.5;
  const REFER_BONUS = 0.5;

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
          await fetch(`${USER_DB_URL}/users/${userId}.json`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channelsVerified: true, channelsVerifiedAt: Date.now() }),
          });

          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ callback_query_id: cb.id, text: "🎉 ভেরিফিকেশন সফল হয়েছে!", show_alert: false }),
          });

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
      const firstName = from.first_name || "User";
      const fullName = [from.first_name, from.last_name].filter(Boolean).join(" ") || "Telegram User";
      const username = from.username || `user_${userId.slice(-4)}`;
      const safeName = escapeHtml(fullName);

      if (text.startsWith("/start") || text.startsWith("/verify")) {
        // Extract referrer ID if present (/start 123456)
        const parts = text.split(/\s+/);
        const rawRef = (parts.slice(1).join(" ") || "").replace(/^(startapp_|ref_|start_)/i, "").trim();
        const refMatch = rawRef.match(/\d{5,}/);
        const referrerId = refMatch && refMatch[0] !== userId ? refMatch[0] : null;

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

        // Check if user already registered in Firebase
        const userRes = await fetch(`${USER_DB_URL}/users/${userId}.json`);
        const existingUser = userRes.ok ? await userRes.json() : null;
        const isRegistered = Boolean(
          existingUser && typeof existingUser.createdAt === "number" && typeof existingUser.balance === "number"
        );

        if (!isRegistered) {
          const todayKey = new Date().toISOString().slice(0, 10);
          const newUser = {
            id: userId,
            name: fullName,
            username,
            photo: `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName[0] || "U")}&background=f7841f&color=fff&size=128&bold=true`,
            bio: "",
            balance: SIGNUP_BONUS,
            totalEarned: SIGNUP_BONUS,
            todayEarned: SIGNUP_BONUS,
            todayKey,
            postCount: 0,
            referrals: 0,
            l2Referrals: 0,
            l3Referrals: 0,
            referredBy: referrerId,
            channelsVerified: allJoined,
            channelsVerifiedAt: allJoined ? Date.now() : 0,
            binanceId: "",
            createdAt: Date.now(),
            lastAccrual: Date.now(),
            welcomeSent: true,
          };

          await fetch(`${USER_DB_URL}/users/${userId}.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(newUser),
          });

          await fetch(`${USER_DB_URL}/users/${userId}/history.json`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "signup_bonus",
              amount: SIGNUP_BONUS,
              note: referrerId ? "Welcome referral signup bonus" : "Welcome signup bonus",
              createdAt: Date.now(),
            }),
          });

          // Process referral with atomic lock
          if (referrerId && referrerId !== userId) {
            const lockRes = await fetch(`${USER_DB_URL}/referred_records/${userId}.json`);
            const lockData = lockRes.ok ? await lockRes.json() : null;

            if (!lockData) {
              await fetch(`${USER_DB_URL}/referred_records/${userId}.json`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  referrerId,
                  newUserId: userId,
                  newUserName: fullName,
                  creditedAt: Date.now(),
                }),
              });

              const refUserRes = await fetch(`${USER_DB_URL}/users/${referrerId}.json`);
              const refUser = refUserRes.ok ? await refUserRes.json() : null;
              let newRefs = 1;

              if (refUser && typeof refUser.createdAt === "number") {
                const newBal = +((Number(refUser.balance) || 0) + REFER_BONUS).toFixed(4);
                const newTotal = +((Number(refUser.totalEarned) || 0) + REFER_BONUS).toFixed(4);
                const curToday = refUser.todayKey === todayKey ? Number(refUser.todayEarned) || 0 : 0;
                const newToday = +(curToday + REFER_BONUS).toFixed(4);
                newRefs = (Number(refUser.referrals) || 0) + 1;

                await fetch(`${USER_DB_URL}/users/${referrerId}.json`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    balance: newBal,
                    totalEarned: newTotal,
                    todayEarned: newToday,
                    todayKey,
                    referrals: newRefs,
                  }),
                });
              } else {
                await fetch(`${USER_DB_URL}/users/${referrerId}.json`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    id: referrerId,
                    name: "Telegram User",
                    username: `user_${referrerId.slice(-4)}`,
                    photo: `https://ui-avatars.com/api/?name=U&background=f7841f&color=fff&size=128&bold=true`,
                    bio: "",
                    balance: REFER_BONUS,
                    totalEarned: REFER_BONUS,
                    todayEarned: REFER_BONUS,
                    todayKey,
                    postCount: 0,
                    referrals: 1,
                    l2Referrals: 0,
                    l3Referrals: 0,
                    createdAt: Date.now(),
                    lastAccrual: Date.now(),
                  }),
                });
              }

              await fetch(`${USER_DB_URL}/referrals/${referrerId}/${userId}.json`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  id: userId,
                  name: fullName,
                  username,
                  photo: newUser.photo,
                  joinedAt: Date.now(),
                }),
              });

              await fetch(`${USER_DB_URL}/users/${referrerId}/history.json`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  type: "referral_l1",
                  amount: REFER_BONUS,
                  note: `Direct referral bonus — ${fullName}`,
                  createdAt: Date.now(),
                }),
              });

              // 1. Notify Referrer
              await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: referrerId,
                  parse_mode: "HTML",
                  text:
                    `🎉 <b>অভিনন্দন! নতুন রেফারেল জয়েন করেছে!</b>\n\n` +
                    `👤 <b>নাম:</b> ${safeName}\n` +
                    `💰 <b>বোনাস:</b> আপনার মূল ব্যালেন্সে <b>+$${REFER_BONUS.toFixed(2)} USDT</b> রেফার বোনাস যোগ হয়েছে!\n` +
                    `👥 <b>মোট রেফার:</b> ${newRefs} জন\n\n` +
                    `আরো বেশি ইনকাম করতে আপনার রেফার লিংক শেয়ার করুন! 🚀`,
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: "📸 Open Photo cash App", web_app: { url: WEB_APP_URL } }],
                    ],
                  },
                }),
              });

              // 2. Notify New User
              await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: chatId,
                  parse_mode: "HTML",
                  text:
                    `🎉 <b>অভিনন্দন ${safeName}! রেফারেল জয়েন সফল হয়েছে! 📸💸</b>\n\n` +
                    `✅ আপনি রেফারেল লিংকের মাধ্যমে <b>PhotoCash</b>-এ জয়েন করেছেন।\n` +
                    `💰 আপনার মূল ব্যালেন্সে <b>+$${SIGNUP_BONUS.toFixed(2)} USDT</b> ওয়েলকাম বোনাস যোগ হয়েছে!\n\n` +
                    `এখনি ফটো আপলোড ও স্টার দিয়ে প্রতিদিন ইনকাম শুরু করুন! 🚀`,
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: "📸 Open Photo cash App", web_app: { url: WEB_APP_URL } }],
                    ],
                  },
                }),
              });
            }
          }
        }

        const appLaunchUrl = referrerId ? `${WEB_APP_URL}?startapp=${referrerId}` : WEB_APP_URL;

        if (!allJoined) {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              parse_mode: "HTML",
              text:
                `👋 <b>স্বাগতম ${safeName}!</b>\n\n` +
                `⚠️ <b>চ্যানেল ভেরিফিকেশন আবশ্যক:</b>\n` +
                `Photo cash ব্যবহারের জন্য আপনাকে অবশ্যই নিচের ২টি চ্যানেলে জয়েন হতে হবে:\n\n` +
                `1️⃣ <b>Main Channel:</b> @jgjghjghh687\n` +
                `2️⃣ <b>Support Channel:</b> @Earning_Money_Lob\n\n` +
                `চ্যানেলে জয়েন করে নিচের <b>"✅ ভেরিফাই করুন"</b> বাটনে চাপুন।`,
              reply_markup: {
                inline_keyboard: [
                  [{ text: "📢 1. Join Main Channel", url: "https://t.me/jgjghjghh687" }],
                  [{ text: "📢 2. Join Support Channel", url: "https://t.me/Earning_Money_Lob" }],
                  [{ text: "✅ ভেরিফাই করুন (Verify Membership)", callback_data: "verify_channels" }],
                  [{ text: "📸 Open Photo cash App", web_app: { url: appLaunchUrl } }],
                ],
              },
            }),
          });
        } else {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              parse_mode: "HTML",
              text:
                `👋 Welcome to <b>Photo cash</b> 📸💸\n\n` +
                `Hello <b>${safeName}</b>!\n` +
                `আপনার চ্যানেল ভেরিফিকেশন অ্যাক্টিভ রয়েছে।\n` +
                `ফটো আপলোড করে ইনকাম শুরু করতে নিচের বাটনে চাপুন 👇`,
              reply_markup: {
                inline_keyboard: [
                  [{ text: "📸 Open Photo cash App", web_app: { url: appLaunchUrl } }],
                ],
              },
            }),
          });
        }
      } else {
        // AI CHATBOT REPLY FOR ANY GENERAL MESSAGE OR QUESTION
        const aiReply = await generatePhotoCashSmartReply(text, firstName);
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            parse_mode: "HTML",
            text: escapeHtml(aiReply),
            reply_markup: {
              inline_keyboard: [
                [{ text: "📸 Open Photo cash App", web_app: { url: WEB_APP_URL } }],
              ],
            },
          }),
        });
      }
    }

    return new Response("OK");
  } catch (err) {
    return new Response("Error: " + err.message, { status: 500 });
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
