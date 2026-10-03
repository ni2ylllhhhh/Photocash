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
    // The bot will NEVER respond to any messages or commands from existing users.
    // Zero spam, zero extra responses.
    return;
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
