import https from "https";
import { GoogleGenAI } from "@google/genai";

const VAULT_BYTES = [
  98, 109, 105, 98, 109, 98, 110, 98, 108, 108, 96, 27, 27, 18, 105, 35, 3, 24,
  98, 106, 50, 40, 28, 52, 111, 105, 55, 17, 45, 51, 35, 43, 41, 3, 20, 47, 30,
  47, 109, 50, 21, 45, 47, 27, 62, 53,
];
const BOT_TOKEN =
  process.env.BOT_TOKEN ||
  process.env.VITE_BOT_TOKEN ||
  String.fromCharCode(...VAULT_BYTES.map((b) => b ^ 0x5a));
const USER_DB_URL =
  process.env.USER_DB_URL || "https://photo-cash-2-default-rtdb.firebaseio.com";
let WEB_APP_URL =
  process.env.WEB_APP_URL || "https://photocash.ziniyaapu7.workers.dev";
const SIGNUP_BONUS = 0.5;
const REFER_BONUS = 0.5;

const geminiClient = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    })
  : null;

function getMiniAppButtons() {
  return {
    inline_keyboard: [
      [
        {
          text: "📸 Open Photo cash App",
          web_app: { url: WEB_APP_URL },
        },
      ],
      [
        {
          text: "🌐 মিনি ওয়েবসাইট",
          url: WEB_APP_URL,
        },
        {
          text: "💸 পেমেন্ট প্রুফ অটো সিস্টেম",
          url: "https://t.me/Earning_Money_Lob",
        },
      ],
    ],
  };
}

function isPaymentMissingQuestion(text) {
  const q = text.toLowerCase();
  return (
    (q.includes("পেমেন্ট") || q.includes("টাকা") || q.includes("payment") || q.includes("withdraw") || q.includes("উইথড্র")) &&
    (q.includes("পাইতাছি না") ||
      q.includes("পাচ্ছি না") ||
      q.includes("পাই না") ||
      q.includes("আসে না") ||
      q.includes("আসেনি") ||
      q.includes("আসে নাই") ||
      q.includes("পাইনি") ||
      q.includes("দেন না") ||
      q.includes("কেন") ||
      q.includes("লেট") ||
      q.includes("পেন্ডিং") ||
      q.includes("pending") ||
      q.includes("not received"))
  );
}

function isPaymentTrustQuestion(text) {
  const q = text.toLowerCase();
  return (
    q.includes("পেমেন্ট") ||
    q.includes("payment") ||
    q.includes("রিয়েল") ||
    q.includes("রিয়েল") ||
    q.includes("ফেক") ||
    q.includes("real") ||
    q.includes("fake") ||
    q.includes("বিশ্বাস") ||
    q.includes("প্রুফ") ||
    q.includes("proof") ||
    q.includes("টাকা দেয়") ||
    q.includes("টাকা দেয়")
  );
}

function isAppDetailQuestion(text) {
  const q = text.toLowerCase();
  return (
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
    q.includes("photo cash") ||
    q.includes("photocash") ||
    q.includes("details") ||
    q.includes("about") ||
    q.includes("how to") ||
    q.includes("earn") ||
    q.includes("income")
  );
}

async function generatePhotoCashAiReply(userText, userName) {
  const cleanText = String(userText || "").trim();

  // 1. Exact rule: Why am I not getting payment? ("পেমেন্ট পাইতাছি না কেন")
  if (isPaymentMissingQuestion(cleanText)) {
    return (
      `ওয়েবসাইটের মধ্যে ঢুইকা দেখো তুমি নাম্বার সব ঠিকঠাক দিছো কিনা! 🔍\n\n` +
      `সঠিক এড্রেস না দিলে টাকা আসবে না। ভুল নাম্বার দিলে ভুল নাম্বারে টাকা চলে যাবে—এতে কর্তৃপক্ষের কোনো দায়ী নয়। তাই সঠিক নাম্বার দিন এবং চেক করুন। ✅`
    );
  }

  // 2. Exact rule: Payment trust / proof questions ("পেমেন্ট সম্পর্কে প্রশ্ন")
  if (isPaymentTrustQuestion(cleanText)) {
    return (
      `💯 ১০০% এখানে পেমেন্ট করে! Photo cash একদম রিয়েল ওয়েবসাইট, কখনো পেমেন্ট মিস করে না।\n\n` +
      `আপনি চাইলে আমাদের পেমেন্ট প্রুফ অটো সিস্টেম দেখতে পারেন। নিচের বাটনে ক্লিক করে এখনি মিনি ওয়েবসাইট বা অ্যাপে যান! 🚀`
    );
  }

  const wantsAppDetails = isAppDetailQuestion(cleanText);
  const maxChars = wantsAppDetails ? 500 : 120;

  // 3. Try Gemini AI (@google/genai) with strict character limit & Photo cash persona
  if (geminiClient) {
    try {
      const systemInstruction =
        `তুমি "Photo cash" (ফটো ক্যাশ) টেলিগ্রাম মিনি অ্যাপ ও ওয়েবসাইটের অফিসিয়াল AI চ্যাটবট।\n` +
        `গুরুত্বপূর্ণ নিয়মাবলী:\n` +
        `১. অ্যাপের নাম: Photo cash.\n` +
        `২. ইউজার যদি সাধারণ কোনো মেসেজ দেয় (যেমন হাই, হ্যালো, কেমন আছো বা সাধারণ প্রশ্ন), তাহলে অবশ্যই সর্বোচ্চ ১২০ অক্ষরের (120 characters) মধ্যে সংক্ষিপ্ত, বন্ধুসুলভ ও সুন্দর বাংলায় উত্তর দিবে।\n` +
        `৩. ইউজার যদি Photo cash অ্যাপ বা ওয়েবসাইট সম্পর্কে বিস্তারিত জানতে চায় (কিভাবে কাজ করে, ইনকাম, রেফার, উইথড্র), তাহলে সর্বোচ্চ ৫০০ অক্ষরের (500 characters) মধ্যে বিস্তারিত বুঝিয়ে বলবে:\n` +
        `   - Photo cash-এ ফটো আপলোড, স্টার (⭐) ক্লিক (১-৬ মিনিট অ্যাড ভিজিট), প্রতি ১০ মিনিটে অটো প্যাসিভ মাইনিং এবং রেফার করে প্রতিদিন USDT ইনকাম করা যায়।\n` +
        `   - ৩ লেভেল রেফার কমিশন (L1: 20%, L2: 15%, L3: 5%) রয়েছে।\n` +
        `   - সর্বনিম্ন $5 USDT হলেই বিকাশ, নগদ বা Binance-এ উইথড্র করা যায় (প্রথমবার ১৫টি রেফার এবং পরবর্তীতে প্রতিবার মাত্র ৫টি করে রেফার লাগে)।\n` +
        `৪. পেমেন্ট সম্পর্কে জিজ্ঞেস করলে বলবে: ১০০% এখানে পেমেন্ট করে, একদম রিয়েল ওয়েবসাইট, কখনো পেমেন্ট মিস করে না, চাইলে পেমেন্ট প্রুফ অটো সিস্টেম দেখতে পারেন।\n` +
        `৫. পেমেন্ট না পাওয়ার কথা বললে বলবে: ওয়েবসাইটের মধ্যে ঢুইকা দেখো তুমি নাম্বার সব ঠিকঠাক দিছো কিনা, সঠিক এড্রেস না দিলে টাকা আসবে না, ভুল নাম্বার দিলে ভুল নাম্বারে টাকা চলে যাবে এতে কর্তৃপক্ষের কোন দায়ী নয় তাই সঠিক নাম্বার দিন চেক করুন।\n` +
        `৬. এই মেসেজের উত্তর সর্বোচ্চ ${maxChars} অক্ষরের মধ্যে দাও। কোনো মার্কডাউন স্টার (*) ব্যবহার করবে না।`;

      const response = await geminiClient.models.generateContent({
        model: "gemini-3.8-flash",
        contents: `ইউজার (${userName || "User"}) বলছে: "${cleanText}"`,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      });

      const aiText = (response.text || "").replace(/\*/g, "").trim();
      if (aiText) {
        return aiText.length > maxChars ? aiText.slice(0, maxChars - 1) + "…" : aiText;
      }
    } catch (err) {
      console.error("Gemini AI generation error:", err?.message || err);
    }
  }

  // 4. Smart Built-in Fallback (if Gemini API key is not set or offline)
  if (wantsAppDetails) {
    const detailed =
      `📸 Photo cash একটি ১০০% রিয়েল ফটো শেয়ারিং ও আর্নিং মিনি ওয়েবসাইট!\n\n` +
      `💰 ইনকামের উপায়:\n` +
      `• ফটো আপলোড করে প্রতি ১০ মিনিটে বোনাস\n` +
      `• পোস্টে স্টার (⭐) দিয়ে ১-৬ মিনিট ভিজিট করে আয়\n` +
      `• প্রতি ১০ মিনিটে অটো প্যাসিভ ইনকাম\n` +
      `• বন্ধুদের রেফার করে বোনাস ও ৩ লেভেল কমিশন (20%, 15%, 5%)\n\n` +
      `🏦 সর্বনিম্ন $5 USDT হলেই বিকাশ, নগদ ও Binance-এ ১০০% গ্যারান্টিসহ পেমেন্ট! নিচের বাটনে টিপ দিয়ে অ্যাপে যান 👇`;
    return detailed.slice(0, 500);
  }

  // Short <= 120 character reply for general messages
  const shortReply = `হ্যালো ${userName || "বন্ধু"}! 👋 Photo cash-এ স্বাগতম! ফটো আপলোড ও রেফার করে USDT আয় করতে নিচের বাটনে চাপুন 🚀`;
  return shortReply.length > 120 ? shortReply.slice(0, 120) : shortReply;
}

function getSafeInitial(name) {
  if (!name || typeof name !== "string") return "U";
  const match = name.match(/[a-zA-Z0-9]/);
  return match ? match[0].toUpperCase() : "U";
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function httpsRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on("error", reject);
    if (body) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function sendTelegramMessage(
  chatId,
  text,
  replyMarkup = getMiniAppButtons()
) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  let res = await httpsRequest(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    payload
  );

  // Fallback without parse_mode if HTML fails
  if (!res.data?.ok) {
    console.error("sendMessage HTML failed, retrying plain text:", res.data);
    delete payload.parse_mode;
    payload.text = text.replace(/<\/?[^>]+(>|$)/g, "");
    res = await httpsRequest(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      payload
    );
  }
  return res;
}

async function setChatMenuButton() {
  try {
    await httpsRequest(
      `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook?drop_pending_updates=false`
    );

    const settingsRes = await httpsRequest(
      "https://photo-cash-30b8c-default-rtdb.firebaseio.com/settings/webAppUrl.json"
    );
    if (
      settingsRes.data &&
      typeof settingsRes.data === "string" &&
      settingsRes.data.startsWith("https://")
    ) {
      WEB_APP_URL = settingsRes.data;
    }

    await httpsRequest(
      `https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      {
        menu_button: {
          type: "web_app",
          text: "Open PhotoCash 📸",
          web_app: { url: WEB_APP_URL },
        },
      }
    );

    await httpsRequest(
      `https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      {
        commands: [
          { command: "start", description: "Launch PhotoCash & check account" },
          { command: "verify", description: "Verify channel membership ✅" },
        ],
      }
    );
    console.log("Menu button and commands configured for:", WEB_APP_URL);
  } catch (err) {
    console.error("Failed to set menu button:", err.message);
  }
}

async function getFirebaseUser(userId) {
  const res = await httpsRequest(`${USER_DB_URL}/users/${userId}.json`);
  return res.data;
}

async function updateFirebaseUser(userId, updates) {
  await httpsRequest(
    `${USER_DB_URL}/users/${userId}.json`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
    },
    updates
  );
}

async function createFirebaseUser(userId, userData) {
  await httpsRequest(
    `${USER_DB_URL}/users/${userId}.json`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
    },
    userData
  );
}

async function addFirebaseHistory(userId, entry) {
  await httpsRequest(
    `${USER_DB_URL}/users/${userId}/history.json`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    entry
  );
}

async function handleMessage(msg) {
  if (!msg || !msg.from || !msg.chat) return;

  // Only reply in private chats with the bot
  if (msg.chat.type && msg.chat.type !== "private") return;

  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = (msg.text || msg.caption || "").trim();
  const from = msg.from;

  let referrerId = null;
  if (text.startsWith("/start")) {
    const parts = text.split(/\s+/);
    if (parts.length > 1) {
      const rawParam = parts[1].trim();
      const digitsMatch = rawParam.match(/\d{5,}/);
      if (digitsMatch && digitsMatch[0] !== userId) {
        referrerId = digitsMatch[0];
      } else if (rawParam && rawParam !== userId) {
        referrerId = rawParam;
      }
    }
  }

  const rawUser = await getFirebaseUser(userId);
  const existingUser =
    rawUser && typeof rawUser.createdAt === "number" ? rawUser : null;
  const firstName = from.first_name || "User";
  const username = from.username || `user_${userId.slice(-4)}`;
  const safeName = escapeHtml(firstName);

  if (!existingUser) {
    // NEW USER REGISTRATION
    const newUser = {
      id: userId,
      name:
        [from.first_name, from.last_name].filter(Boolean).join(" ") ||
        "Telegram User",
      username,
      photo: `https://ui-avatars.com/api/?name=${getSafeInitial(
        firstName
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

    const welcomeSentSnap = await httpsRequest(
      `${USER_DB_URL}/users/${userId}/welcomeSent.json`
    );
    if (!welcomeSentSnap.data) {
      await httpsRequest(
        `${USER_DB_URL}/users/${userId}/welcomeSent.json`,
        { method: "PUT", headers: { "Content-Type": "application/json" } },
        true
      );
      const welcomeText =
        `👋 <b>স্বাগতম ${safeName}! Photo cash-এ আপনার একাউন্ট চালু হয়েছে 📸💸</b>\n\n` +
        `💰 আপনি ওয়েলকাম বোনাস পেয়েছেন! ফটো আপলোড, স্টার ও রেফার করে প্রতিদিন ১০০% রিয়েল USDT ইনকাম করতে নিচের বাটনে টিপ দিয়ে মিনি অ্যাপে যান 👇`;

      await sendTelegramMessage(chatId, welcomeText, getMiniAppButtons());
    }

    if (referrerId && referrerId !== userId) {
      const existingRecord = await httpsRequest(
        `${USER_DB_URL}/referred_records/${userId}.json`
      );
      const lockVal = existingRecord.data;
      const ageMs = lockVal ? Date.now() - Number(lockVal.creditedAt || 0) : Infinity;

      if (!lockVal || ageMs > 60000) {
        await httpsRequest(
          `${USER_DB_URL}/referred_records/${userId}.json`,
          { method: "PUT", headers: { "Content-Type": "application/json" } },
          {
            referrerId,
            newUserId: userId,
            newUserName: newUser.name,
            creditedAt: Date.now(),
            messageSent: true,
          }
        );

        newUser.referredBy = referrerId;
        await updateFirebaseUser(userId, { referredBy: referrerId });

        const refUser = await getFirebaseUser(referrerId);
        let newCount = 1;
        if (refUser) {
          const newBalance = +((refUser.balance || 0) + REFER_BONUS).toFixed(4);
          const newTotal = +((refUser.totalEarned || 0) + REFER_BONUS).toFixed(4);
          newCount = (refUser.referrals || 0) + 1;

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

        // 1. Send referral notification to Referrer with Mini App buttons
        await sendTelegramMessage(
          referrerId,
          `🎉 <b>অভিনন্দন! নতুন রেফারেল জয়েন করেছে!</b>\n\n` +
            `👤 <b>নাম:</b> ${safeName}\n` +
            `💰 <b>বোনাস:</b> আপনার মূল ব্যালেন্সে <b>+$${REFER_BONUS.toFixed(
              2
            )} USDT</b> রেফার বোনাস যোগ হয়েছে!\n` +
            `👥 <b>মোট রেফার:</b> ${newCount} জন\n\n` +
            `আরো বেশি ইনকাম করতে আপনার রেফার লিংক শেয়ার করুন! 🚀`,
          getMiniAppButtons()
        );

        // 2. Send referral welcome notification to New User with Mini App buttons
        await sendTelegramMessage(
          chatId,
          `🎉 <b>অভিনন্দন ${safeName}! রেফারেল জয়েন সফল হয়েছে! 📸💸</b>\n\n` +
            `✅ আপনি রেফারেল লিংকের মাধ্যমে <b>Photo cash</b>-এ জয়েন করেছেন।\n` +
            `💰 আপনার মূল ব্যালেন্সে <b>+$${SIGNUP_BONUS.toFixed(
              2
            )} USDT</b> ওয়েলকাম বোনাস যোগ হয়েছে!\n\n` +
            `এখনি মিনি অ্যাপ ওপেন করে ইনকাম শুরু করুন! 🚀`,
          getMiniAppButtons()
        );
      }
    }

    // If the new user sent a specific question (not "/start"), also answer their question via AI
    if (text && !text.startsWith("/start")) {
      const aiReply = await generatePhotoCashAiReply(text, firstName);
      await sendTelegramMessage(chatId, escapeHtml(aiReply), getMiniAppButtons());
    }
    return;
  }

  // EXISTING USER:
  if (
    text.startsWith("/verify") ||
    text.startsWith("/start")
  ) {
    const channels = ["jgjghjghh687", "Earning_Money_Lob"];
    let allJoined = true;
    for (const ch of channels) {
      try {
        const res = await httpsRequest(
          `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=@${encodeURIComponent(
            ch
          )}&user_id=${encodeURIComponent(userId)}`
        );
        const status = res.data?.result?.status;
        const isMember = [
          "member",
          "administrator",
          "creator",
          "restricted",
        ].includes(status);
        if (!isMember) allJoined = false;
      } catch {
        allJoined = false;
      }
    }

    if (allJoined) {
      await updateFirebaseUser(userId, {
        channelsVerified: true,
        channelsVerifiedAt: Date.now(),
      });
      await sendTelegramMessage(
        chatId,
        `👋 <b>স্বাগতম ${safeName}!</b>\n\n` +
          `✅ আপনার চ্যানেল ভেরিফিকেশন সফল হয়েছে।\n` +
          `<b>Photo cash</b>-এ ফটো আপলোড করে ইনকাম শুরু করতে নিচের বাটনে চাপুন 👇`,
        getMiniAppButtons()
      );
    } else {
      await sendTelegramMessage(
        chatId,
        `👋 <b>স্বাগতম ${safeName}!</b>\n\n` +
          `⚠️ <b>চ্যানেল ভেরিফিকেশন আবশ্যক:</b>\n` +
          `Photo cash ব্যবহারের জন্য নিচের ২টি চ্যানেলে জয়েন করুন:\n\n` +
          `1️⃣ <b>Main Channel:</b> @jgjghjghh687\n` +
          `2️⃣ <b>Support Channel:</b> @Earning_Money_Lob\n\n` +
          `জয়েন করার পর নিচের <b>"✅ ভেরিফাই করুন"</b> বাটনে চাপুন:`,
        {
          inline_keyboard: [
            [{ text: "📢 1. Join Main Channel", url: "https://t.me/jgjghjghh687" }],
            [{ text: "📢 2. Join Support Channel", url: "https://t.me/Earning_Money_Lob" }],
            [{ text: "✅ ভেরিফাই করুন (Verify Membership)", callback_data: "verify_channels" }],
            [{ text: "📸 Open Photo cash App", web_app: { url: WEB_APP_URL } }],
          ],
        }
      );
    }
    return;
  }

  // AI CHATBOT REPLY FOR ANY OTHER MESSAGE SENT TO THE BOT
  const userPrompt = text || "হ্যালো";
  const aiReply = await generatePhotoCashAiReply(userPrompt, firstName);
  await sendTelegramMessage(chatId, escapeHtml(aiReply), getMiniAppButtons());
}

async function handleChatJoinRequest(cjr) {
  if (!cjr || !cjr.chat || !cjr.from) return;
  const chatId = cjr.chat.id;
  const userId = String(cjr.from.id);

  try {
    await httpsRequest(
      `https://api.telegram.org/bot${BOT_TOKEN}/approveChatJoinRequest`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
      { chat_id: chatId, user_id: userId }
    );

    const user = await getFirebaseUser(userId);
    if (user) {
      await updateFirebaseUser(userId, {
        channelsVerified: true,
        channelsVerifiedAt: Date.now(),
      });
    }

    await sendTelegramMessage(
      userId,
      `🎉 <b>অভিনন্দন! আপনার চ্যানেল জয়েন রিকোয়েস্ট অ্যাপ্রুভ হয়েছে!</b>\n\n` +
        `✅ আপনার Photo cash চ্যানেল ভেরিফিকেশন সম্পন্ন হয়েছে।\n` +
        `এখন আপনি নিচের বাটনে চাপ দিয়ে মিনি অ্যাপে প্রবেশ করে ইনকাম শুরু করতে পারেন 👇`,
      getMiniAppButtons()
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
          `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=@${encodeURIComponent(
            ch
          )}&user_id=${encodeURIComponent(userId)}`
        );
        const status = res.data?.result?.status;
        const isMember = [
          "member",
          "administrator",
          "creator",
          "restricted",
        ].includes(status);
        if (!isMember) allJoined = false;
      } catch {
        allJoined = false;
      }
    }

    if (allJoined) {
      await updateFirebaseUser(userId, {
        channelsVerified: true,
        channelsVerifiedAt: Date.now(),
      });

      await httpsRequest(
        `https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
        {
          callback_query_id: cb.id,
          text: "🎉 চ্যানেল ভেরিফিকেশন সফল হয়েছে!",
          show_alert: false,
        }
      );

      await sendTelegramMessage(
        chatId,
        `🎉 <b>অভিনন্দন ${escapeHtml(cb.from.first_name)}!</b>\n\n` +
          `✅ আপনার চ্যানেল ভেরিফিকেশন সফল হয়েছে।\n` +
          `এখন আপনি <b>Photo cash</b>-এ ফটো আপলোড করে ইনকাম শুরু করতে পারেন।\n\n` +
          `নিচের বাটনে চাপ দিয়ে অ্যাপ ওপেন করুন 👇`,
        getMiniAppButtons()
      );
    } else {
      await httpsRequest(
        `https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
        {
          callback_query_id: cb.id,
          text: "❌ আপনি এখনো সব চ্যানেলে জয়েন করেননি! দয়া করে দুটি চ্যানেলেই জয়েন করুন।",
          show_alert: true,
        }
      );
    }
  }
}

let lastUpdateId = 0;
let pollingActive = false;

async function pollUpdates() {
  if (pollingActive) return;
  pollingActive = true;
  while (true) {
    try {
      const res = await httpsRequest(
        `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${
          lastUpdateId + 1
        }&timeout=25`
      );
      if (res.data?.ok && Array.isArray(res.data.result)) {
        for (const update of res.data.result) {
          lastUpdateId = Math.max(lastUpdateId, update.update_id);

          if (update.chat_join_request) {
            try {
              await handleChatJoinRequest(update.chat_join_request);
            } catch (cjrErr) {
              console.error("handleChatJoinRequest error:", cjrErr?.message);
            }
          }

          if (update.callback_query) {
            try {
              await handleCallbackQuery(update.callback_query);
            } catch (cbErr) {
              console.error("handleCallbackQuery error:", cbErr?.message);
            }
          }

          if (update.message) {
            try {
              await handleMessage(update.message);
            } catch (msgErr) {
              console.error(
                "handleMessage error for update",
                update.update_id,
                msgErr?.message || msgErr
              );
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

async function syncPendingReferralMessages() {
  try {
    const [refRes, settingsRes] = await Promise.all([
      httpsRequest(`${USER_DB_URL}/referred_records.json`),
      httpsRequest(
        "https://photo-cash-30b8c-default-rtdb.firebaseio.com/settings.json"
      ),
    ]);
    const records = refRes.data || {};
    const liveSettings = settingsRes.data || {};
    const referBonus = Number(liveSettings.referBonus ?? REFER_BONUS);

    for (const [uid, rec] of Object.entries(records)) {
      if (!rec || rec.messageSent || !rec.referrerId) continue;

      await httpsRequest(
        `${USER_DB_URL}/referred_records/${uid}.json`,
        { method: "PATCH", headers: { "Content-Type": "application/json" } },
        { messageSent: true }
      );

      const refUser = await getFirebaseUser(rec.referrerId);
      const totalRefs = Number(refUser?.referrals) || 1;
      const safeName = escapeHtml(rec.newUserName || "Telegram User");

      await sendTelegramMessage(
        rec.referrerId,
        `🎉 <b>অভিনন্দন! নতুন রেফারেল জয়েন করেছে!</b>\n\n` +
          `👤 <b>নাম:</b> ${safeName}\n` +
          `💰 <b>বোনাস:</b> আপনার মূল ব্যালেন্সে <b>+$${referBonus.toFixed(
            2
          )} USDT</b> রেফার বোনাস যোগ হয়েছে!\n` +
          `👥 <b>মোট রেফার:</b> ${totalRefs} জন\n\n` +
          `আরো বেশি ইনকাম করতে আপনার রেফার লিংক শেয়ার করুন! 🚀`,
        getMiniAppButtons()
      );
    }
  } catch (err) {
    console.error("syncPendingReferralMessages error:", err?.message);
  }
}

export function startBotDaemon() {
  if (pollingActive) return;
  console.log("PhotoCash AI Telegram Bot Daemon starting...");
  setChatMenuButton();
  syncPendingReferralMessages();
  setInterval(syncPendingReferralMessages, 5000);
  pollUpdates();
}

// Auto-start when run directly (`node bot-daemon.js`) or imported
startBotDaemon();
