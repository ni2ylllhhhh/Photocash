// Background Telegram Bot Polling Worker for PhotoCash12_bot
import https from "https";

const BOT_TOKEN = "8738784866:AAFk8eHwv2xuswJTCBxGcvKAwZuUJHq4bK0";
const USER_DB_URL = "https://photo-cash-2-default-rtdb.firebaseio.com";
let WEB_APP_URL = "https://photocash.ziniyaapu7.workers.dev";
const SIGNUP_BONUS = 0.5;
const REFER_BONUS = 0.5;

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getSafeInitial(name) {
  try {
    const trimmed = (name || "U").trim();
    const ascii = trimmed.match(/[a-zA-Z0-9]/);
    if (ascii) return ascii[0].toUpperCase();
    const firstChar = Array.from(trimmed)[0] || "U";
    return encodeURIComponent(firstChar);
  } catch {
    return "U";
  }
}

function httpsRequest(url, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on("error", reject);
    if (postData) {
      req.write(typeof postData === "string" ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  try {
    const res = await httpsRequest(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      payload
    );
    if (res.data?.ok) return true;

    // Plain text fallback
    delete payload.parse_mode;
    payload.text = text.replace(/<[^>]*>/g, "");
    const res2 = await httpsRequest(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      payload
    );
    return res2.data?.ok;
  } catch (err) {
    console.error("sendTelegramMessage error:", err.message);
    return false;
  }
}

async function setChatMenuButton(chatId = null) {
  try {
    const payload = {
      menu_button: {
        type: "web_app",
        text: "🌐 Open App",
        web_app: { url: WEB_APP_URL },
      },
    };
    if (chatId) {
      payload.chat_id = chatId;
    }
    await httpsRequest(
      `https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
      payload
    );
  } catch (err) {
    console.error("setChatMenuButton error:", err.message);
  }
}

async function getFirebaseUser(userId) {
  try {
    const res = await httpsRequest(`${USER_DB_URL}/users/${userId}.json`);
    return res.data;
  } catch {
    return null;
  }
}

async function updateFirebaseUser(userId, data) {
  try {
    await httpsRequest(
      `${USER_DB_URL}/users/${userId}.json`,
      { method: "PATCH", headers: { "Content-Type": "application/json" } },
      data
    );
  } catch (err) {
    console.error("updateFirebaseUser error:", err.message);
  }
}

async function createFirebaseUser(userId, userObj) {
  try {
    await httpsRequest(
      `${USER_DB_URL}/users/${userId}.json`,
      { method: "PUT", headers: { "Content-Type": "application/json" } },
      userObj
    );
  } catch (err) {
    console.error("createFirebaseUser error:", err.message);
  }
}

async function addFirebaseHistory(userId, historyItem) {
  try {
    await httpsRequest(
      `${USER_DB_URL}/users/${userId}/history.json`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
      historyItem
    );
  } catch (err) {
    console.error("addFirebaseHistory error:", err.message);
  }
}

async function handleMessage(msg) {
  if (!msg || !msg.chat || !msg.from) return;
  const chatId = msg.chat.id;
  const from = msg.from;
  const userId = String(from.id);
  const text = (msg.text || "").trim();

  // Extract referrer ID from text (/start 123456, startapp_123456, ?startapp=123456, etc.)
  const parts = text.split(/\s+/);
  let refParam = parts.slice(1).join(" ") || "";
  refParam = refParam.replace(/^(startapp_|ref_|start_|\?startapp=|\?start=)/i, "").trim();
  const match = refParam.match(/\d{5,}/);
  const referrerId = match && match[0] !== userId ? match[0] : null;

  const existingUser = await getFirebaseUser(userId);
  const firstName = from.first_name || "User";
  const username = from.username || `user_${userId.slice(-4)}`;
  const safeName = escapeHtml(firstName);

  if (!existingUser) {
    // NEW USER REGISTRATION (Send message only once upon joining)
    const newUser = {
      id: userId,
      name: [from.first_name, from.last_name].filter(Boolean).join(" ") || "Telegram User",
      username,
      photo: `https://ui-avatars.com/api/?name=${getSafeInitial(firstName)}&background=f7841f&color=fff&size=128&bold=true`,
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
      binanceId: "",
      createdAt: Date.now(),
      lastAccrual: Date.now(),
    };

    await createFirebaseUser(userId, newUser);
    await addFirebaseHistory(userId, {
      type: "signup_bonus",
      amount: SIGNUP_BONUS,
      note: "Welcome signup bonus",
      createdAt: Date.now(),
    });

    // Welcome message to new user (Strictly ONCE upon signup, no buttons, no duplicates)
    const welcomeSentSnap = await httpsRequest(`${USER_DB_URL}/users/${userId}/welcomeSent.json`);
    if (!welcomeSentSnap.data) {
      await httpsRequest(
        `${USER_DB_URL}/users/${userId}/welcomeSent.json`,
        { method: "PUT", headers: { "Content-Type": "application/json" } },
        true
      );
      const welcomeText =
        `Welcome back to PhotoCash 📸💸\n\n` +
        `Hello <b>${safeName}</b>! Your account is active.\n` +
        `এখানে ক্লিক করুন👉 /income .. \n` +
        `Please open mini app and earn USDT...`;

      await sendTelegramMessage(chatId, welcomeText);
    }

    // 100% Strict Referral Verification & Anti-Double Referral Protection
    if (referrerId && referrerId !== userId) {
      // Check if this new user was EVER credited in referred_records
      const existingRecord = await httpsRequest(`${USER_DB_URL}/referred_records/${userId}.json`);
      if (!existingRecord.data) {
        // Lock this user ID immediately so they can NEVER be double-referred
        await httpsRequest(
          `${USER_DB_URL}/referred_records/${userId}.json`,
          { method: "PUT", headers: { "Content-Type": "application/json" } },
          { referrerId, creditedAt: Date.now() }
        );

        newUser.referredBy = referrerId;
        await updateFirebaseUser(userId, { referredBy: referrerId });

        const refUser = await getFirebaseUser(referrerId);
        if (refUser) {
          const newBalance = +((refUser.balance || 0) + REFER_BONUS).toFixed(4);
          const newTotal = +((refUser.totalEarned || 0) + REFER_BONUS).toFixed(4);
          const newCount = (refUser.referrals || 0) + 1;

          await updateFirebaseUser(referrerId, {
            balance: newBalance,
            totalEarned: newTotal,
            referrals: newCount,
          });

          await addFirebaseHistory(referrerId, {
            type: "referral_l1",
            amount: REFER_BONUS,
            note: `Direct referral bonus — ${firstName}`,
            createdAt: Date.now(),
          });
        } else {
          // Initialize referrer if they haven't launched app yet
          await createFirebaseUser(referrerId, {
            id: referrerId,
            name: "Telegram User",
            username: `user_${referrerId.slice(-4)}`,
            photo: `https://ui-avatars.com/api/?name=U&background=f7841f&color=fff&size=128&bold=true`,
            bio: "",
            balance: REFER_BONUS,
            totalEarned: REFER_BONUS,
            todayEarned: REFER_BONUS,
            todayKey: new Date().toISOString().slice(0, 10),
            postCount: 0,
            referrals: 1,
            l2Referrals: 0,
            l3Referrals: 0,
            createdAt: Date.now(),
            lastAccrual: Date.now(),
          });

          await addFirebaseHistory(referrerId, {
            type: "referral_l1",
            amount: REFER_BONUS,
            note: `Direct referral bonus — ${firstName}`,
            createdAt: Date.now(),
          });
        }

        // Add to referrals collection
        await httpsRequest(
          `${USER_DB_URL}/referrals/${referrerId}/${userId}.json`,
          { method: "PUT", headers: { "Content-Type": "application/json" } },
          {
            id: userId,
            name: newUser.name,
            username,
            photo: newUser.photo,
            joinedAt: Date.now(),
          }
        );

        // Send ONLY referral notification to referrer
        await sendTelegramMessage(
          referrerId,
          `🎉 <b>New Referral Joined!</b>\n\n` +
            `👤 <b>${safeName}</b> has joined PhotoCash using your link.\n` +
            `💰 <b>+${REFER_BONUS.toFixed(2)} USDT</b> referral bonus added to your balance!\n\n` +
            `Keep sharing your link to earn more! 🚀`
        );
      }
    }
  } else {
    // EXISTING USER:
    // If they ask to verify or start, check their channels or send verify buttons
    if (text.startsWith("/verify") || text.startsWith("/start") || text.includes("verify") || text.includes("চ্যানেল")) {
      const channels = ["jgjghjghh687", "Earning_Money_Lob"];
      let allJoined = true;
      for (const ch of channels) {
        try {
          const res = await httpsRequest(
            `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=@${encodeURIComponent(ch)}&user_id=${encodeURIComponent(userId)}`
          );
          const status = res.data?.result?.status;
          const isMember = ["member", "administrator", "creator", "restricted"].includes(status);
          if (!isMember) allJoined = false;
        } catch {
          allJoined = false;
        }
      }

      if (allJoined) {
        await updateFirebaseUser(userId, { channelsVerified: true, channelsVerifiedAt: Date.now() });
        await sendTelegramMessage(
          chatId,
          `👋 <b>স্বাগতম ${safeName}!</b>\n\n` +
          `✅ আপনার চ্যানেল ভেরিফিকেশন সফল হয়েছে।\n` +
          `ফটো আপলোড করে ইনকাম শুরু করতে নিচের বাটনে চাপুন 👇`,
          {
            inline_keyboard: [
              [{ text: "📸 Open PhotoCash App", web_app: { url: WEB_APP_URL } }],
            ],
          }
        );
      } else {
        await sendTelegramMessage(
          chatId,
          `👋 <b>স্বাগতম ${safeName}!</b>\n\n` +
          `⚠️ <b>চ্যানেল ভেরিফিকেশন আবশ্যক:</b>\n` +
          `PhotoCash ব্যবহারের জন্য নিচের ২টি চ্যানেলে জয়েন বা রিকোয়েস্ট পাঠান:\n\n` +
          `1️⃣ <b>Main Channel:</b> @jgjghjghh687\n` +
          `2️⃣ <b>Support Channel:</b> @Earning_Money_Lob\n\n` +
          `জয়েন করার পর নিচের <b>"✅ ভেরিফাই করুন"</b> বাটনে চাপুন:`,
          {
            inline_keyboard: [
              [{ text: "📢 1. Join Main Channel", url: "https://t.me/jgjghjghh687" }],
              [{ text: "📢 2. Join Support Channel", url: "https://t.me/Earning_Money_Lob" }],
              [{ text: "✅ ভেরিফাই করুন (Verify Membership)", callback_data: "verify_channels" }],
            ],
          }
        );
      }
    }
    return;
  }
}

async function handleChatJoinRequest(cjr) {
  if (!cjr || !cjr.chat || !cjr.from) return;
  const chatId = cjr.chat.id;
  const userId = String(cjr.from.id);

  try {
    // 1. Auto-approve channel join request!
    await httpsRequest(
      `https://api.telegram.org/bot${BOT_TOKEN}/approveChatJoinRequest`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
      { chat_id: chatId, user_id: userId }
    );
    console.log(`Auto-approved join request for user ${userId} in chat ${chatId}`);

    // 2. Mark verified in Firebase if user exists
    const user = await getFirebaseUser(userId);
    if (user) {
      await updateFirebaseUser(userId, { channelsVerified: true, channelsVerifiedAt: Date.now() });
    }

    // 3. Send confirmation to user
    await sendTelegramMessage(
      userId,
      `🎉 <b>অভিনন্দন! আপনার চ্যানেল জয়েন রিকোয়েস্ট অ্যাপ্রুভ হয়েছে!</b>\n\n` +
      `✅ আপনার PhotoCash চ্যানেল ভেরিফিকেশন সম্পন্ন হয়েছে।\n` +
      `এখন আপনি অ্যাপে প্রবেশ করে কাজ শুরু করতে পারেন। 👇`,
      {
        inline_keyboard: [
          [{ text: "📸 Open PhotoCash App", web_app: { url: WEB_APP_URL } }],
        ],
      }
    );
  } catch (err) {
    console.error("handleChatJoinRequest error:", err.message);
  }
}

async function handleCallbackQuery(cb) {
  if (!cb || !cb.from) return;
  const userId = String(cb.from.id);
  const chatId = cb.message?.chat?.id || userId;
  const data = cb.data;

  if (data === "verify_channels") {
    const channels = ["jgjghjghh687", "Earning_Money_Lob"];
    let allJoined = true;

    for (const ch of channels) {
      try {
        const res = await httpsRequest(
          `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=@${encodeURIComponent(ch)}&user_id=${encodeURIComponent(userId)}`
        );
        const status = res.data?.result?.status;
        const isMember = ["member", "administrator", "creator", "restricted"].includes(status);
        if (!isMember) allJoined = false;
      } catch {
        allJoined = false;
      }
    }

    if (allJoined) {
      await updateFirebaseUser(userId, { channelsVerified: true, channelsVerifiedAt: Date.now() });

      await httpsRequest(
        `https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
        { callback_query_id: cb.id, text: "🎉 চ্যানেল ভেরিফিকেশন সফল হয়েছে!", show_alert: false }
      );

      await sendTelegramMessage(
        chatId,
        `🎉 <b>অভিনন্দন ${escapeHtml(cb.from.first_name)}!</b>\n\n` +
        `✅ আপনার চ্যানেল ভেরিফিকেশন সফল হয়েছে।\n` +
        `এখন আপনি PhotoCash-এ ফটো আপলোড করে ইনকাম শুরু করতে পারেন।\n\n` +
        `নিচের বাটনে চাপ দিয়ে অ্যাপ ওপেন করুন 👇`,
        {
          inline_keyboard: [
            [{ text: "📸 Open PhotoCash App", web_app: { url: WEB_APP_URL } }],
          ],
        }
      );
    } else {
      await httpsRequest(
        `https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
        { callback_query_id: cb.id, text: "❌ আপনি এখনো সব চ্যানেলে জয়েন করেননি! দয়া করে দুটি চ্যানেলেই জয়েন করুন।", show_alert: true }
      );
    }
  }
}

let lastUpdateId = 0;

async function pollUpdates() {
  while (true) {
    try {
      const res = await httpsRequest(
        `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=25`
      );
      if (res.data?.ok && Array.isArray(res.data.result)) {
        for (const update of res.data.result) {
          lastUpdateId = Math.max(lastUpdateId, update.update_id);

          // 1. Chat Join Request Auto-Approval
          if (update.chat_join_request) {
            try {
              await handleChatJoinRequest(update.chat_join_request);
            } catch (cjrErr) {
              console.error("handleChatJoinRequest error:", cjrErr?.message);
            }
          }

          // 2. Callback Query ([ ✅ ভেরিফাই করুন ] Button)
          if (update.callback_query) {
            try {
              await handleCallbackQuery(update.callback_query);
            } catch (cbErr) {
              console.error("handleCallbackQuery error:", cbErr?.message);
            }
          }

          // 3. Regular Messages (/start, /verify)
          if (update.message) {
            try {
              await handleMessage(update.message);
            } catch (msgErr) {
              console.error("handleMessage error for update", update.update_id, msgErr?.message || msgErr);
            }
          }
        }
      }
    } catch (err) {
      console.error("pollUpdates error:", err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

console.log("PhotoCash Telegram Bot Worker starting...");
setChatMenuButton();
pollUpdates();
