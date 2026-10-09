import https from "https";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";

// Use non-hanging agent with socket timeout protection
const keepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10000,
  maxSockets: 50,
  timeout: 15000,
});

const VAULT_BYTES = [
  98, 109, 105, 98, 109, 98, 110, 98, 108, 108, 96, 27, 27, 18, 105, 35, 3, 24,
  98, 106, 50, 40, 28, 52, 111, 105, 55, 17, 45, 51, 35, 43, 41, 3, 20, 47, 30,
  47, 109, 50, 21, 45, 47, 27, 62, 53,
];
const GEMINI_VAULT_BYTES = [
  27, 11, 116, 27, 56, 98, 8, 20, 108, 22, 31, 0, 8, 56, 45, 50, 57, 45, 30, 28,
  119, 104, 52, 61, 106, 63, 52, 35, 27, 45, 107, 45, 8, 110, 56, 8, 54, 9, 98,
  17, 51, 105, 105, 35, 63, 25, 23, 20, 21, 44, 45, 40, 45,
];

const BOT_TOKEN =
  process.env.BOT_TOKEN ||
  process.env.VITE_BOT_TOKEN ||
  String.fromCharCode(...VAULT_BYTES.map((b) => b ^ 0x5a));

const GEMINI_KEY =
  process.env.GEMINI_API_KEY ||
  String.fromCharCode(...GEMINI_VAULT_BYTES.map((b) => b ^ 0x5a));

const USER_DB_URL =
  process.env.USER_DB_URL || "https://photo-cash-2-default-rtdb.firebaseio.com";
let WEB_APP_URL =
  process.env.WEB_APP_URL || "https://photocash.ziniyaapu7.workers.dev";
const SIGNUP_BONUS = 0.5;
const REFER_BONUS = 0.5;

const geminiClient = new GoogleGenAI({
  apiKey: GEMINI_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// Rate-limit guard & response cache to prevent 429 RESOURCE_EXHAUSTED errors
const aiReplyCache = new Map();
let geminiCooldownUntil = 0;
let geminiWindowStart = Date.now();
let geminiRequestsInWindow = 0;
const MAX_GEMINI_RPM = 10; // Safely below the 15 RPM free-tier limit

function canCallGeminiNow() {
  const now = Date.now();
  if (now < geminiCooldownUntil) return false;
  if (now - geminiWindowStart >= 60000) {
    geminiWindowStart = now;
    geminiRequestsInWindow = 0;
  }
  if (geminiRequestsInWindow >= MAX_GEMINI_RPM) {
    return false;
  }
  geminiRequestsInWindow++;
  return true;
}

// ONLY ONE BUTTON under every message: Mini App button
function getMiniAppButtons() {
  return {
    inline_keyboard: [
      [
        {
          text: "📸 Open Photo cash App",
          web_app: { url: WEB_APP_URL },
        },
      ],
    ],
  };
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
    q.includes("withdraw")
  );
}

/**
 * Instant, natural Bengali replies for high-frequency messages so thousands of users
 * can chat simultaneously after a broadcast without hitting Gemini 429 rate limits or delays.
 */
function getSmartInstantReply(cleanText, userName) {
  const q = cleanText.toLowerCase().trim();
  const name = userName || "বন্ধু";

  // 1. Missing / delayed payment complaint
  if (
    (q.includes("পেমেন্ট") || q.includes("টাকা") || q.includes("payment") || q.includes("withdraw")) &&
    (q.includes("পাইনি") ||
      q.includes("পাইতাছি না") ||
      q.includes("আসেনি") ||
      q.includes("আসে নাই") ||
      q.includes("পাই না") ||
      q.includes("কেন") ||
      q.includes("পেন্ডিং") ||
      q.includes("pending") ||
      q.includes("late"))
  ) {
    return (
      "ওয়েবসাইটের মধ্যে ঢুইকা দেখো তুমি নাম্বার সব ঠিকঠাক দিছো কিনা। সঠিক এড্রেস না দিলে টাকা আসবে না। " +
      "ভুল নাম্বার দিলে ভুল নাম্বারে টাকা চলে যাবে—এতে কর্তৃপক্ষের কোনো দায়ী নয়। তাই সঠিক নাম্বার দিন ও চেক করুন।"
    );
  }

  // 2. Is payment real / payment proof question
  if (
    q.includes("পেমেন্ট দেয়") ||
    q.includes("পেমেন্ট করে") ||
    q.includes("রিয়েল") ||
    q.includes("রিয়েল") ||
    q.includes("সত্যি") ||
    q.includes("ফেক") ||
    q.includes("real") ||
    q.includes("legit") ||
    q.includes("proof") ||
    q === "পেমেন্ট" ||
    q === "payment"
  ) {
    return (
      "১০০% এখানে পেমেন্ট করে! এটি একদম রিয়েল ওয়েবসাইট, কখনো পেমেন্ট মিস করে না। " +
      "আপনি চাইলে অ্যাপের ভেতরে আমাদের পেমেন্ট প্রুফ অটো সিস্টেম দেখতে পারেন। 🚀"
    );
  }

  // 3. How to work / earn / details about Photo cash
  if (
    q.includes("কিভাবে কাজ") ||
    q.includes("কাজ কি") ||
    q.includes("কিভাবে ইনকাম") ||
    q.includes("বিস্তারিত") ||
    q.includes("ডিটেলস") ||
    q.includes("নিয়ম") ||
    q.includes("নিয়ম") ||
    q.includes("how to work") ||
    q.includes("how to earn") ||
    q.includes("details")
  ) {
    return (
      `হ্যালো ${name}! Photo cash একটি ১০০% রিয়েল ফটো শেয়ারিং ও আর্নিং মিনি অ্যাপ। ` +
      `এখানে প্রতি ১০ মিনিটে ফটো পোস্ট করে বোনাস, পোস্টের নিচে স্টার (⭐) বাটনে ক্লিক করে অ্যাড ভিজিট, ` +
      `অটো প্যাসিভ মাইনিং এবং রেফার করে প্রতিদিন USDT আয় করা যায়। ৩ লেভেল রেফার কমিশন আছে (L1: 20%, L2: 15%, L3: 5%)। ` +
      `সর্বনিম্ন $5 USDT হলেই বিকাশ, নগদ বা Binance-এ উইথড্র করতে পারবেন!`
    );
  }

  // 4. Referral questions
  if (q.includes("রেফার") || q.includes("refer")) {
    return (
      `${name}, প্রতিটি ভেরিফাইড রেফারে আপনি +$0.50 USDT বোনাস পাবেন! ` +
      `আপনার বন্ধু যখন আপনার লিংকে ঢুকে আমাদের ২টি টেলিগ্রাম চ্যানেলে জয়েন করবে, সাথে সাথে আপনার ব্যালেন্সে বোনাস যোগ হবে। 🚀`
    );
  }

  // 5. Withdraw / minimum withdraw questions
  if (q.includes("উইথড্র") || q.includes("withdraw") || q.includes("বিকাশ") || q.includes("নগদ")) {
    return (
      `${name}, সর্বনিম্ন $5 USDT হলেই বিকাশ, নগদ অথবা Binance-এ উইথড্র করতে পারবেন। ` +
      `প্রথমবার উইথড্র করতে ১৫টি ভেরিফাইড রেফার এবং পরবর্তীতে প্রতিবার মাত্র ৫টি করে রেফার লাগে! 💸`
    );
  }

  // 6. Greetings (Salam / Hi / Hello / How are you)
  if (
    q.includes("সালাম") ||
    q.includes("salam") ||
    q.includes("assalamu")
  ) {
    return `ওয়ালাইকুম আসসালাম ${name}! 😊 আলহামদুলিল্লাহ ভালো আছি। আপনার দিনকাল কেমন যাচ্ছে?`;
  }

  if (
    /^(hi+|hello+|hey+|hlw+|হাই+|হ্যালো+|হেলো+|ঐ|ওই|ভাই|ভাইয়া|আপু|ok|okay|হুম|হ্যাঁ|জি|আচ্ছা)$/i.test(q)
  ) {
    const greetings = [
      `হ্যালো ${name}! 😊 কেমন আছেন? Photo cash-এ ফটো আপলোড ও ইনকাম কেমন চলছে?`,
      `হাই ${name}! 👋 আপনার দিনটি কেমন যাচ্ছে? কোনো সাহায্য লাগলে বলুন!`,
      `স্বাগতম ${name}! 😊 কোনো প্রশ্ন থাকলে নির্দ্বিধায় করতে পারেন।`,
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  if (
    q.includes("কেমন আছেন") ||
    q.includes("কেমন আছো") ||
    q.includes("কি খবর") ||
    q.includes("কি কর") ||
    q.includes("kemon aso") ||
    q.includes("kmn acen") ||
    q.includes("how are you")
  ) {
    return `আলহামদুলিল্লাহ বেশ ভালো আছি ${name}! 😊 আপনি কেমন আছেন? আপনার ইনকাম কেমন চলছে?`;
  }

  return null;
}

async function generatePhotoCashAiReply(userText, userName) {
  const cleanText = String(userText || "").trim();
  const instant = getSmartInstantReply(cleanText, userName);
  if (instant) return instant;

  const wantsAppDetails = isAppDetailQuestion(cleanText);
  const maxChars = wantsAppDetails ? 500 : 120;

  const cacheKey = `${wantsAppDetails ? "D" : "S"}:${cleanText.toLowerCase().slice(0, 120)}`;
  if (aiReplyCache.has(cacheKey)) {
    return aiReplyCache.get(cacheKey);
  }

  const systemInstruction =
    `তুমি "Photo cash" (ফটো ক্যাশ) অ্যাপের অফিসিয়াল বাংলা AI চ্যাটবট ও বন্ধু।\n` +
    `ইউজারের নাম: ${userName || "বন্ধু"}।\n` +
    `তোমার উত্তর দেওয়ার কঠোর নিয়মাবলী:\n` +
    `১. অ্যাপের নাম: Photo cash.\n` +
    `২. ইউজার যদি সাধারণ কথাবার্তা বা প্রশ্ন করে (যেমন: কেমন আছেন, কি করছো, হাই, হ্যালো, সালাম বা যেকোনো সাধারণ কথা), তাহলে মানুষদের মতো খুব সুন্দর, স্বাভাবিক ও বন্ধুসুলভ বাংলায় উত্তর দিবে—এবং সাধারণ মেসেজের উত্তর অবশ্যই সর্বোচ্চ ১২০ অক্ষরের (120 characters) মধ্যে রাখবে। কখনোই একই রোবটিক কথা বারবার বলবে না।\n` +
    `৩. ইউজার যদি Photo cash অ্যাপ বা মিনি ওয়েবসাইট সম্পর্কে বিস্তারিত জানতে চায় (কিভাবে কাজ করে, কিভাবে ইনকাম করা যায়, নিয়ম কি), তাহলে সর্বোচ্চ ৫০০ অক্ষরের (500 characters) মধ্যে বিস্তারিত বলবে:\n` +
    `   - Photo cash একটি ১০০% রিয়েল ফটো শেয়ারিং ও আর্নিং মিনি অ্যাপ।\n` +
    `   - এখানে ফটো পোস্ট করে (প্রতি ১০ মিনিটে বোনাস), পোস্টের নিচে স্টার (⭐) বাটনে ক্লিক করে ১-৬ মিনিট অ্যাড ভিজিট করে, প্রতি ১০ মিনিটে অটো প্যাসিভ মাইনিং এবং রেফার করে প্রতিদিন USDT আয় করা যায়।\n` +
    `   - ৩ লেভেল রেফার কমিশন আছে (L1: 20%, L2: 15%, L3: 5%)।\n` +
    `   - সর্বনিম্ন $5 USDT হলেই বিকাশ, নগদ বা Binance-এ উইথড্র করা যায় (প্রথমবার উইথড্র করতে ১৫টি রেফার এবং পরবর্তীতে প্রতিবার মাত্র ৫টি করে রেফার লাগে)।\n` +
    `৪. পেমেন্ট সম্পর্কে কোনো প্রশ্ন করলে (যেমন পেমেন্ট দেয় কিনা, রিয়েল কিনা) স্পষ্টভাবে বলবে: "১০০% এখানে পেমেন্ট করে! এটি একদম রিয়েল ওয়েবসাইট, কখনো পেমেন্ট মিস করে না। আপনি চাইলে আমাদের পেমেন্ট প্রুফ অটো সিস্টেম দেখতে পারেন।"\n` +
    `৫. কেউ যদি বলে "পেমেন্ট পাইতাছি না কেন" বা টাকা আসেনি কেন, তাহলে বলবে: "ওয়েবসাইটের মধ্যে ঢুইকা দেখো তুমি নাম্বার সব ঠিকঠাক দিছো কিনা। সঠিক এড্রেস না দিলে টাকা আসবে না। ভুল নাম্বার দিলে ভুল নাম্বারে টাকা চলে যাবে—এতে কর্তৃপক্ষের কোনো দায়ী নয়। তাই সঠিক নাম্বার দিন ও চেক করুন।"\n` +
    `৬. কোনো মার্কডাউন স্টার (*) ব্যবহার করবে না এবং উত্তরের দৈর্ঘ্য সর্বোচ্চ ${maxChars} অক্ষরের মধ্যে রাখবে।`;

  // 1. Primary Engine: Gemini with strict 6s timeout & rate-limit protection so it NEVER hangs or throws 429
  if (canCallGeminiNow()) {
    try {
      const geminiPromise = geminiClient.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: cleanText,
        config: {
          systemInstruction,
          temperature: 0.8,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("GEMINI_TIMEOUT")), 6000)
      );

      const response = await Promise.race([geminiPromise, timeoutPromise]);
      const aiText = (response?.text || "").replace(/\*/g, "").trim();
      if (aiText) {
        const finalReply =
          aiText.length > maxChars ? aiText.slice(0, maxChars - 1) + "…" : aiText;
        if (aiReplyCache.size > 400) aiReplyCache.clear();
        aiReplyCache.set(cacheKey, finalReply);
        return finalReply;
      }
    } catch (err) {
      const msg = String(err?.message || err || "");
      if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota")) {
        geminiCooldownUntil = Date.now() + 65000;
      }
    }
  }

  // 2. Secondary AI Engine fallback with strict 5s AbortSignal timeout so it NEVER hangs!
  try {
    const pollRes = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai",
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: cleanText },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (pollRes.ok) {
      const pollData = await pollRes.json();
      const reply = (pollData?.choices?.[0]?.message?.content || "")
        .replace(/\*/g, "")
        .trim();
      if (reply) {
        const finalReply =
          reply.length > maxChars ? reply.slice(0, maxChars - 1) + "…" : reply;
        if (aiReplyCache.size > 400) aiReplyCache.clear();
        aiReplyCache.set(cacheKey, finalReply);
        return finalReply;
      }
    }
  } catch {}

  if (wantsAppDetails) {
    return (
      `Photo cash একটি ১০০% রিয়েল ফটো শেয়ারিং ও আর্নিং মিনি অ্যাপ। ` +
      `এখানে ফটো পোস্ট করে, স্টার (⭐) বাটনে ক্লিক করে, অটো মাইনিং এবং রেফার করে প্রতিদিন USDT আয় করা যায়। ` +
      `সর্বনিম্ন $5 USDT হলেই বিকাশ, নগদ বা Binance-এ ১০০% পেমেন্ট তোলা যায়!`
    );
  }

  return `হ্যালো ${userName || "বন্ধু"}! 😊 Photo cash-এ ফটো আপলোড ও রেফার করে প্রতিদিন USDT ইনকাম করতে নিচের বাটনে চাপুন!`;
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

/**
 * Timeout-protected HTTPS request helper!
 * Guarantees that no hung TCP socket can EVER freeze the bot daemon.
 */
function httpsRequest(url, options = {}, body = null, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      fn(val);
    };

    const req = https.request(
      url,
      { agent: keepAliveAgent, timeout: timeoutMs, ...options },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("error", (err) => done(reject, err));
        res.on("end", () => {
          try {
            done(resolve, { status: res.statusCode, data: JSON.parse(data) });
          } catch {
            done(resolve, { status: res.statusCode, data });
          }
        });
      }
    );

    const hardTimer = setTimeout(() => {
      try {
        req.destroy(new Error(`HTTPS_TIMEOUT_${timeoutMs}MS`));
      } catch {}
      done(reject, new Error(`HTTPS_TIMEOUT_${timeoutMs}MS`));
    }, timeoutMs);

    req.on("timeout", () => {
      try {
        req.destroy(new Error("SOCKET_TIMEOUT"));
      } catch {}
      done(reject, new Error("SOCKET_TIMEOUT"));
    });

    req.on("error", (err) => done(reject, err));

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
    payload,
    10000
  );

  if (!res.data?.ok) {
    delete payload.parse_mode;
    payload.text = text.replace(/<\/?[^>]+(>|$)/g, "");
    res = await httpsRequest(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      payload,
      10000
    );
  }
  return res;
}

async function setChatMenuButton() {
  try {
    await httpsRequest(
      `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook?drop_pending_updates=false`,
      {},
      null,
      8000
    );

    const settingsRes = await httpsRequest(
      "https://photo-cash-30b8c-default-rtdb.firebaseio.com/settings/webAppUrl.json",
      {},
      null,
      8000
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
      },
      8000
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
      },
      8000
    );
    console.log("Menu button and commands configured for:", WEB_APP_URL);
  } catch {}
}

async function getFirebaseUser(userId) {
  const res = await httpsRequest(`${USER_DB_URL}/users/${userId}.json`, {}, null, 8000);
  return res.data;
}

async function updateFirebaseUser(userId, updates) {
  await httpsRequest(
    `${USER_DB_URL}/users/${userId}.json`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
    },
    updates,
    8000
  );
}

async function createFirebaseUser(userId, userData) {
  await httpsRequest(
    `${USER_DB_URL}/users/${userId}.json`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
    },
    userData,
    8000
  );
}

async function addFirebaseHistory(userId, entry) {
  await httpsRequest(
    `${USER_DB_URL}/users/${userId}/history.json`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    entry,
    8000
  );
}

async function checkAllRequiredChannelsJoined(userId) {
  const channels = ["jgjghjghh687", "Earning_Money_Lob"];
  for (const ch of channels) {
    try {
      const res = await httpsRequest(
        `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=@${encodeURIComponent(
          ch
        )}&user_id=${encodeURIComponent(userId)}`,
        {},
        null,
        8000
      );
      const status = res.data?.result?.status;
      const isMember = [
        "member",
        "administrator",
        "creator",
        "restricted",
      ].includes(status);
      if (!isMember) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Credits a referral ONLY AFTER the referred user has joined the required channels!
 * Synchronized with UserContext.tsx (`referred_records/{userId}` + `referrals/{referrerId}/{userId}`).
 */
async function creditVerifiedReferralIfPending(userId, userObj, liveReferBonus = REFER_BONUS) {
  try {
    const referrerId = userObj?.referredBy ? String(userObj.referredBy).trim() : null;
    if (!referrerId || referrerId === String(userId)) return false;

    const [existingRecord, existingRefEntry, refUser] = await Promise.all([
      httpsRequest(`${USER_DB_URL}/referred_records/${userId}.json`, {}, null, 8000),
      httpsRequest(`${USER_DB_URL}/referrals/${referrerId}/${userId}.json`, {}, null, 8000),
      getFirebaseUser(referrerId),
    ]);

    if (existingRecord?.data || existingRefEntry?.data) {
      return false;
    }

    const uName = String(userObj?.name || "Telegram User");
    const isFarmName =
      /SEED/i.test(uName) ||
      uName.includes("🪱") ||
      (refUser?.name && String(refUser.name).includes("🪱"));

    if (refUser?.banned || isFarmName) {
      return false;
    }

    const nowTs = Date.now();
    await httpsRequest(
      `${USER_DB_URL}/referred_records/${userId}.json`,
      { method: "PUT", headers: { "Content-Type": "application/json" } },
      {
        referrerId,
        newUserId: String(userId),
        newUserName: uName,
        channelsVerified: true,
        creditedAt: nowTs,
        messageSent: true,
      },
      8000
    );

    await httpsRequest(
      `${USER_DB_URL}/referrals/${referrerId}/${userId}.json`,
      { method: "PUT", headers: { "Content-Type": "application/json" } },
      {
        id: String(userId),
        name: uName,
        username: userObj?.username || `user_${String(userId).slice(-4)}`,
        photo:
          userObj?.photo ||
          `https://ui-avatars.com/api/?name=${getSafeInitial(
            uName
          )}&background=f7841f&color=fff&size=128&bold=true`,
        channelsVerified: true,
        joinedAt: nowTs,
      },
      8000
    );

    const allRefsSnap = await httpsRequest(
      `${USER_DB_URL}/referrals/${referrerId}.json`,
      {},
      null,
      8000
    );
    const exactListCount =
      allRefsSnap?.data && typeof allRefsSnap.data === "object"
        ? Object.keys(allRefsSnap.data).length
        : 1;

    let newCount = exactListCount;
    if (refUser && typeof refUser.createdAt === "number") {
      const newBalance = +((Number(refUser.balance) || 0) + liveReferBonus).toFixed(4);
      const newTotal = +((Number(refUser.totalEarned) || 0) + liveReferBonus).toFixed(4);
      newCount = Math.max((Number(refUser.referrals) || 0) + 1, exactListCount);

      await updateFirebaseUser(referrerId, {
        balance: newBalance,
        totalEarned: newTotal,
        referrals: newCount,
        lastReferralAt: nowTs,
      });

      await addFirebaseHistory(referrerId, {
        type: "referral_l1",
        amount: liveReferBonus,
        note: `Verified referral bonus — ${uName}`,
        createdAt: nowTs,
      });
    } else {
      await createFirebaseUser(referrerId, {
        id: referrerId,
        user_id: referrerId,
        name: "Telegram User",
        first_name: "Telegram",
        username: `user_${referrerId.slice(-4)}`,
        language: "en",
        photo: `https://ui-avatars.com/api/?name=U&background=f7841f&color=fff&size=128&bold=true`,
        bio: "",
        balance: liveReferBonus,
        totalEarned: liveReferBonus,
        todayEarned: liveReferBonus,
        todayKey: new Date().toISOString().slice(0, 10),
        postCount: 0,
        referrals: exactListCount,
        l2Referrals: 0,
        l3Referrals: 0,
        createdAt: nowTs,
        joined_at: nowTs,
        last_active: nowTs,
        is_blocked: false,
        lastAccrual: nowTs,
      });

      await addFirebaseHistory(referrerId, {
        type: "referral_l1",
        amount: liveReferBonus,
        note: `Verified referral bonus — ${uName}`,
        createdAt: nowTs,
      });
    }

    const safeName = escapeHtml(uName);
    await sendTelegramMessage(
      referrerId,
      `🎉 <b>অভিনন্দন! নতুন ভেরিফাইড রেফারেল জয়েন করেছে!</b>\n\n` +
        `👤 <b>নাম:</b> ${safeName}\n` +
        `✅ <b>চ্যানেল জয়েন:</b> সম্পন্ন (Verified)\n` +
        `💰 <b>বোনাস:</b> আপনার মূল ব্যালেন্সে <b>+$${liveReferBonus.toFixed(
          2
        )} USDT</b> রেফার বোনাস যোগ হয়েছে!\n` +
        `👥 <b>মোট রেফার:</b> ${newCount} জন\n\n` +
        `আরো বেশি ইনকাম করতে আপনার রেফার লিংক শেয়ার করুন! 🚀`,
      getMiniAppButtons()
    );

    return true;
  } catch {
    return false;
  }
}

async function handleMessage(msg) {
  if (!msg || !msg.from || !msg.chat) return;
  if (msg.chat.type && msg.chat.type !== "private") return;

  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = (msg.text || msg.caption || "").trim();
  const from = msg.from;
  const firstName = from.first_name || "User";
  const username = from.username || `user_${userId.slice(-4)}`;
  const language = from.language_code || "en";
  const safeName = escapeHtml(firstName);

  // Mark user as bot-reachable in background whenever they message the bot
  updateFirebaseUser(userId, {
    user_id: userId,
    first_name: firstName,
    username,
    language,
    last_active: Date.now(),
    allows_write_to_pm: true,
    bot_chat_inactive: false,
    is_blocked: false,
  }).catch(() => {});

  // FAST PATH: Regular chat messages (not /start or /verify) reply IMMEDIATELY via AI
  if (!text.startsWith("/start") && !text.startsWith("/verify")) {
    const userPrompt = text || "হ্যালো";
    const aiReply = await generatePhotoCashAiReply(userPrompt, firstName);
    await sendTelegramMessage(chatId, escapeHtml(aiReply), getMiniAppButtons());
    return;
  }

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

  const [rawUser, settingsRes, allJoined] = await Promise.all([
    getFirebaseUser(userId).catch(() => null),
    httpsRequest(
      "https://photo-cash-30b8c-default-rtdb.firebaseio.com/settings.json",
      {},
      null,
      8000
    ).catch(() => ({ data: null })),
    checkAllRequiredChannelsJoined(userId),
  ]);

  const liveSettings = settingsRes?.data || {};
  const liveSignupBonus = Number(liveSettings.signupBonus ?? SIGNUP_BONUS);
  const liveReferBonus = Number(liveSettings.referBonus ?? REFER_BONUS);
  const existingUser =
    rawUser && typeof rawUser.createdAt === "number" ? rawUser : null;

  if (!existingUser) {
    const nowTs = Date.now();
    const newUser = {
      id: userId,
      user_id: userId,
      name:
        [from.first_name, from.last_name].filter(Boolean).join(" ") ||
        "Telegram User",
      first_name: firstName,
      username,
      language,
      photo: `https://ui-avatars.com/api/?name=${getSafeInitial(
        firstName
      )}&background=f7841f&color=fff&size=128&bold=true`,
      bio: "",
      balance: liveSignupBonus,
      totalEarned: liveSignupBonus,
      todayEarned: liveSignupBonus,
      todayKey: new Date().toISOString().slice(0, 10),
      postCount: 0,
      referrals: 0,
      l2Referrals: 0,
      l3Referrals: 0,
      referredBy: referrerId || rawUser?.referredBy || null,
      channelsVerified: allJoined,
      channelsVerifiedAt: allJoined ? nowTs : 0,
      binanceId: "",
      createdAt: nowTs,
      joined_at: nowTs,
      last_active: nowTs,
      allows_write_to_pm: true,
      bot_chat_inactive: false,
      is_blocked: false,
      lastAccrual: nowTs,
    };

    await createFirebaseUser(userId, newUser);
    await addFirebaseHistory(userId, {
      type: "signup_bonus",
      amount: liveSignupBonus,
      note: "Welcome signup bonus",
      createdAt: nowTs,
    });

    // Credit referral ONLY if user has joined the required channels!
    if (allJoined && newUser.referredBy) {
      await creditVerifiedReferralIfPending(userId, newUser, liveReferBonus);
    }

    const welcomeSentSnap = await httpsRequest(
      `${USER_DB_URL}/users/${userId}/welcomeSent.json`,
      {},
      null,
      8000
    ).catch(() => ({ data: null }));
    if (!welcomeSentSnap.data) {
      await httpsRequest(
        `${USER_DB_URL}/users/${userId}/welcomeSent.json`,
        { method: "PUT", headers: { "Content-Type": "application/json" } },
        true,
        8000
      ).catch(() => {});
      const welcomeText = allJoined
        ? `👋 <b>স্বাগতম ${safeName}! Photo cash-এ আপনার একাউন্ট চালু হয়েছে 📸💸</b>\n\n` +
          `💰 আপনি <b>+$${liveSignupBonus.toFixed(2)} USDT</b> ওয়েলকাম বোনাস পেয়েছেন! ফটো আপলোড, স্টার ও রেফার করে প্রতিদিন ১০০% রিয়েল USDT ইনকাম করতে নিচের বাটনে টিপ দিয়ে মিনি অ্যাপে যান 👇`
        : `👋 <b>স্বাগতম ${safeName}! Photo cash-এ আপনার একাউন্ট চালু হয়েছে 📸💸</b>\n\n` +
          `💰 আপনি <b>+$${liveSignupBonus.toFixed(2)} USDT</b> ওয়েলকাম বোনাস পেয়েছেন!\n` +
          `📢 <b>গুরুত্বপূর্ণ:</b> আপনার একাউন্ট ও রেফারেল সম্পূর্ণ অ্যাক্টিভ করতে নিচের বাটনে টিপ দিয়ে মিনি অ্যাপে প্রবেশ করে আমাদের অফিসিয়াল চ্যানেল ২টিতে জয়েন করুন 👇`;

      await sendTelegramMessage(chatId, welcomeText, getMiniAppButtons());
    }
    return;
  }

  // EXISTING USER:
  const effectiveRef = existingUser.referredBy || referrerId || null;
  if (referrerId && !existingUser.referredBy && referrerId !== userId) {
    await updateFirebaseUser(userId, { referredBy: referrerId });
    existingUser.referredBy = referrerId;
  }

  if (allJoined) {
    await updateFirebaseUser(userId, {
      channelsVerified: true,
      channelsVerifiedAt: Date.now(),
      allows_write_to_pm: true,
      bot_chat_inactive: false,
      is_blocked: false,
    });

    if (effectiveRef) {
      await creditVerifiedReferralIfPending(
        userId,
        { ...existingUser, referredBy: effectiveRef },
        liveReferBonus
      );
    }

    await sendTelegramMessage(
      chatId,
      `👋 <b>স্বাগতম ${safeName}!</b>\n\n` +
        `✅ আপনার চ্যানেল ভেরিফিকেশন সফল হয়েছে।\n` +
        `<b>Photo cash</b>-এ ফটো আপলোড করে ইনকাম শুরু করতে নিচের বাটনে চাপুন 👇`,
      getMiniAppButtons()
    );
  } else {
    const channelKeyboard = {
      inline_keyboard: [
        [{ text: "📢 1. Join Main Channel", url: "https://t.me/jgjghjghh687" }],
        [{ text: "📢 2. Join Support Channel", url: "https://t.me/Earning_Money_Lob" }],
        [{ text: "✅ ভেরিফাই করুন (Verify Membership)", callback_data: "verify_channels" }],
        [{ text: "📸 Open Photo cash App", web_app: { url: WEB_APP_URL } }],
      ],
    };

    await sendTelegramMessage(
      chatId,
      `👋 <b>স্বাগতম ${safeName}!</b>\n\n` +
        `⚠️ <b>চ্যানেল ভেরিফিকেশন আবশ্যক:</b>\n` +
        `Photo cash ব্যবহারের জন্য এবং রেফারেল বোনাস অ্যাক্টিভ করতে নিচের ২টি চ্যানেলে জয়েন করুন:\n\n` +
        `1️⃣ <b>Main Channel:</b> @jgjghjghh687\n` +
        `2️⃣ <b>Support Channel:</b> @Earning_Money_Lob\n\n` +
        `জয়েন করার পর নিচের <b>"✅ ভেরিফাই করুন"</b> বাটনে চাপুন অথবা মিনি অ্যাপ ওপেন করুন 👇`,
      channelKeyboard
    );
  }
}

async function handleChatJoinRequest(cjr) {
  if (!cjr || !cjr.chat || !cjr.from) return;
  const chatId = cjr.chat.id;
  const userId = String(cjr.from.id);

  try {
    await httpsRequest(
      `https://api.telegram.org/bot${BOT_TOKEN}/approveChatJoinRequest`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
      { chat_id: chatId, user_id: userId },
      8000
    );

    const user = await getFirebaseUser(userId);
    if (user) {
      await updateFirebaseUser(userId, {
        channelsVerified: true,
        channelsVerifiedAt: Date.now(),
      });
      if (user.referredBy) {
        await creditVerifiedReferralIfPending(userId, user, REFER_BONUS);
      }
    }

    await sendTelegramMessage(
      userId,
      `🎉 <b>অভিনন্দন! আপনার চ্যানেল জয়েন রিকোয়েস্ট অ্যাপ্রুভ হয়েছে!</b>\n\n` +
        `✅ আপনার Photo cash চ্যানেল ভেরিফিকেশন সম্পন্ন হয়েছে।\n` +
        `এখন আপনি নিচের বাটনে চাপ দিয়ে মিনি অ্যাপে প্রবেশ করে ইনকাম শুরু করতে পারেন 👇`,
      getMiniAppButtons()
    );
  } catch {}
}

async function handleCallbackQuery(cb) {
  if (!cb || !cb.from) return;
  const userId = String(cb.from.id);
  const chatId = cb.message?.chat?.id || userId;
  const data = cb.data;

  if (data === "verify_channels") {
    const allJoined = await checkAllRequiredChannelsJoined(userId);

    if (allJoined) {
      const user = await getFirebaseUser(userId);
      await updateFirebaseUser(userId, {
        channelsVerified: true,
        channelsVerifiedAt: Date.now(),
      });

      if (user?.referredBy) {
        await creditVerifiedReferralIfPending(userId, user, REFER_BONUS);
      }

      await httpsRequest(
        `https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
        {
          callback_query_id: cb.id,
          text: "🎉 চ্যানেল ভেরিফিকেশন সফল হয়েছে!",
          show_alert: false,
        },
        8000
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
        },
        8000
      );
    }
  }
}

export async function processTelegramUpdate(update) {
  if (!update || typeof update.update_id !== "number") return;

  if (processedUpdateIds.has(update.update_id)) return;
  processedUpdateIds.add(update.update_id);
  if (processedUpdateIds.size > 500) {
    const first = processedUpdateIds.values().next().value;
    processedUpdateIds.delete(first);
  }

  lastUpdateId = Math.max(lastUpdateId, update.update_id);

  if (update.chat_join_request) {
    handleChatJoinRequest(update.chat_join_request).catch(() => {});
  }
  if (update.callback_query) {
    handleCallbackQuery(update.callback_query).catch(() => {});
  }
  if (update.message) {
    handleMessage(update.message).catch(() => {});
  }
}

let lastUpdateId = 0;
let lastPollTickAt = 0;
let lastFirebaseSyncAt = 0;
let totalProcessedUpdates = 0;
let activePollGeneration = 0;
let currentAbortController = null;
const processedUpdateIds = new Set();

async function syncDaemonHeartbeatToFirebase(force = false) {
  const now = Date.now();
  if (!force && now - lastFirebaseSyncAt < 8000) return;
  lastFirebaseSyncAt = now;
  try {
    await httpsRequest(
      `${USER_DB_URL}/bot_state/daemon.json`,
      { method: "PATCH", headers: { "Content-Type": "application/json" } },
      {
        lastHeartbeat: now,
        lastUpdateId,
        status: "online",
      },
      5000
    );
  } catch {}
}

async function loadInitialOffsetFromFirebase() {
  try {
    const res = await httpsRequest(
      `${USER_DB_URL}/bot_state/daemon.json`,
      {},
      null,
      5000
    );
    if (res.data && typeof res.data.lastUpdateId === "number") {
      lastUpdateId = Math.max(lastUpdateId, res.data.lastUpdateId);
    }
  } catch {}
}

/**
 * Self-Healing Polling Loop with short 8-second poll intervals and 14-second hard AbortSignal timeout.
 * If any socket stalls, the watchdog or AbortSignal immediately recovers it without ever stopping!
 */
async function runPollingGeneration(genId) {
  while (genId === activePollGeneration) {
    lastPollTickAt = Date.now();
    const controller = new AbortController();
    currentAbortController = controller;
    const hardTimeout = setTimeout(() => controller.abort(), 14000);

    try {
      const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${
        lastUpdateId + 1
      }&timeout=8&allowed_updates=${encodeURIComponent(
        JSON.stringify(["message", "callback_query", "chat_join_request"])
      )}`;

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(hardTimeout);

      const data = await response.json().catch(() => null);
      lastPollTickAt = Date.now();

      if (data?.ok && Array.isArray(data.result)) {
        if (data.result.length > 0) {
          for (const update of data.result) {
            totalProcessedUpdates++;
            await processTelegramUpdate(update);
          }
          syncDaemonHeartbeatToFirebase(true).catch(() => {});
        } else {
          syncDaemonHeartbeatToFirebase(false).catch(() => {});
        }
      } else {
        // Handle non-OK responses gracefully so we NEVER spin in a 0ms loop!
        const errCode = data?.error_code || response.status;
        const desc = String(data?.description || "");

        if (errCode === 409) {
          if (desc.toLowerCase().includes("webhook")) {
            await httpsRequest(
              `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook?drop_pending_updates=false`,
              {},
              null,
              6000
            ).catch(() => {});
          }
          // Wait 3.5 seconds on 409 Conflict
          await new Promise((r) => setTimeout(r, 3500));
        } else if (errCode === 429) {
          const retryAfter = Number(data?.parameters?.retry_after || 5);
          await new Promise((r) => setTimeout(r, retryAfter * 1000));
        } else {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    } catch {
      clearTimeout(hardTimeout);
      lastPollTickAt = Date.now();
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

export function ensureBotPollingAlive() {
  const now = Date.now();
  if (activePollGeneration === 0 || now - lastPollTickAt > 18000) {
    try {
      if (currentAbortController) {
        currentAbortController.abort();
      }
    } catch {}
    activePollGeneration++;
    lastPollTickAt = now;
    const gen = activePollGeneration;
    runPollingGeneration(gen).catch(() => {});
    return { restarted: true, generation: gen };
  }
  return { restarted: false, generation: activePollGeneration };
}

export function getBotHealth() {
  const now = Date.now();
  return {
    ok: true,
    alive: now - lastPollTickAt < 20000,
    lastPollAgoMs: lastPollTickAt ? now - lastPollTickAt : null,
    lastUpdateId,
    totalProcessedUpdates,
    generation: activePollGeneration,
  };
}

export async function startBotDaemon() {
  // Global process-wide singleton guard so multiple imports (e.g. Vite + Express) never start duplicate pollers
  if (globalThis.__PHOTOCASH_BOT_DAEMON_STARTED__) {
    ensureBotPollingAlive();
    return;
  }
  globalThis.__PHOTOCASH_BOT_DAEMON_STARTED__ = true;

  console.log("PhotoCash 24/7 Self-Healing AI Telegram Bot Daemon starting...");
  await loadInitialOffsetFromFirebase();
  await setChatMenuButton();
  await syncDaemonHeartbeatToFirebase(true);
  ensureBotPollingAlive();

  // Watchdog Timer: checks every 8 seconds and automatically restarts polling if any socket ever hangs!
  setInterval(() => {
    ensureBotPollingAlive();
    syncDaemonHeartbeatToFirebase(false).catch(() => {});
  }, 8000);
}

startBotDaemon();
