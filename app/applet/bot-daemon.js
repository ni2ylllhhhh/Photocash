// Background Telegram Bot Polling Worker for PhotoCash12_bot
import https from "https";

const BOT_TOKEN = "8738784866:AAHQvVRZBjvT5aJRgHXtlvJC6ZqAF0FeLDU";
const USER_DB_URL = "https://photo-cash-2-default-rtdb.firebaseio.com";
const WEB_APP_URL = "https://ais-pre-2cfqiwuo2yblyziu3t5py4-837591927600.asia-east1.run.app";
const SIGNUP_BONUS = 0.5;
const REFER_BONUS = 0.5;

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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

  if (text.startsWith("/start")) {
    const parts = text.split(/\s+/);
    let refParam = parts[1] || "";
    refParam = refParam.replace(/^(startapp_|ref_)/i, "").trim();
    const referrerId = refParam && refParam !== userId && /^\d+$/.test(refParam) ? refParam : null;

    const existingUser = await getFirebaseUser(userId);
    const firstName = from.first_name || "User";
    const username = from.username || `user_${userId.slice(-4)}`;
    const safeName = escapeHtml(firstName);

    const inlineKeyboard = {
      inline_keyboard: [
        [
          {
            text: "📸 Open PhotoCash Mini App",
            web_app: {
              url: referrerId
                ? `${WEB_APP_URL}?startapp=${referrerId}`
                : WEB_APP_URL,
            },
          },
        ],
        [
          {
            text: "💬 Support Community",
            url: "https://t.me/Click2Cash_Site",
          },
        ],
      ],
    };

    if (!existingUser) {
      // NEW USER REGISTRATION
      const newUser = {
        id: userId,
        name: [from.first_name, from.last_name].filter(Boolean).join(" ") || "Telegram User",
        username,
        photo: `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName.charAt(0))}&background=f7841f&color=fff&size=128&bold=true`,
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

      // Welcome message to new user
      await sendTelegramMessage(
        chatId,
        `Welcome to PhotoCash 📸💸\n\n` +
          `Hello <b>${safeName}</b>! You received +${SIGNUP_BONUS.toFixed(2)} USDT welcome bonus !\n\n` +
          `এখনি ইনকাম সুরু করেন /start ক্লিক করুন।\n` +
          `🎌 ফটো আপলোড করে ইনকাম করুন 🤡`,
        inlineKeyboard
      );

      // If referred, credit referrer
      if (referrerId) {
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

          // Send message to referrer
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
      // EXISTING USER
      if (!existingUser.referredBy && referrerId && referrerId !== userId) {
        // First-time referral attribution for existing user
        await updateFirebaseUser(userId, { referredBy: referrerId });
        const refUser = await getFirebaseUser(referrerId);
        if (refUser) {
          await updateFirebaseUser(referrerId, {
            balance: +((refUser.balance || 0) + REFER_BONUS).toFixed(4),
            totalEarned: +((refUser.totalEarned || 0) + REFER_BONUS).toFixed(4),
            referrals: (refUser.referrals || 0) + 1,
          });

          await addFirebaseHistory(referrerId, {
            type: "referral_l1",
            amount: REFER_BONUS,
            note: `Direct referral bonus — ${firstName}`,
            createdAt: Date.now(),
          });

          await sendTelegramMessage(
            referrerId,
            `🎉 <b>New Referral Joined!</b>\n\n` +
              `👤 <b>${safeName}</b> has joined PhotoCash using your link.\n` +
              `💰 <b>+${REFER_BONUS.toFixed(2)} USDT</b> referral bonus added to your balance!\n\n` +
              `Keep sharing your link to earn more! 🚀`
          );
        }
      }

      await sendTelegramMessage(
        chatId,
        `Welcome back to PhotoCash 📸💸\n\n` +
          `Hello <b>${safeName}</b>! Your account is active.\n` +
          `Tap below to open your Mini App and earn USDT:`,
        inlineKeyboard
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
          if (update.message) {
            await handleMessage(update.message);
          }
        }
      }
    } catch (err) {
      console.error("pollUpdates error:", err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

process.on("uncaughtException", (err) => {
  console.error("Bot Worker UncaughtException:", err.message);
});
process.on("unhandledRejection", (err) => {
  console.error("Bot Worker UnhandledRejection:", err);
});

console.log("PhotoCash Telegram Bot Worker starting...");
pollUpdates();
