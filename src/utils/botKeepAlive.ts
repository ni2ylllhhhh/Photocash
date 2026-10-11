import { ref, get, update, set, push, runTransaction } from "firebase/database";
import { userDb, contentDb } from "../firebase";
import { resolveBotToken } from "./tokenVault";
import { escapeHtml, generateAvatar } from "../utils";
import { defaultSettings } from "../types";

const CLIENT_INSTANCE_ID = `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
let keepAliveStarted = false;
let standbyBusy = false;

function getSmartReplyForBot(rawText: string, firstName?: string): string {
  const cleanText = String(rawText || "").trim();
  const q = cleanText.toLowerCase();
  const name = firstName || "বন্ধু";

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

  if (
    q.includes("কিভাবে কাজ") ||
    q.includes("কাজ কি") ||
    q.includes("কিভাবে ইনকাম") ||
    q.includes("বিস্তারিত") ||
    q.includes("ডিটেলস") ||
    q.includes("নিয়ম") ||
    q.includes("নিয়ম") ||
    q.includes("অ্যাপ") ||
    q.includes("এপ") ||
    q.includes("ওয়েবসাইট") ||
    q.includes("ওয়েবসাইট") ||
    q.includes("how to") ||
    q.includes("details") ||
    q.includes("earn") ||
    q.includes("income")
  ) {
    return (
      `হ্যালো ${name}! Photo cash একটি ১০০% রিয়েল ফটো শেয়ারিং ও আর্নিং মিনি অ্যাপ। ` +
      `এখানে প্রতি ১০ মিনিটে ফটো পোস্ট করে বোনাস, পোস্টের নিচে স্টার (⭐) বাটনে ক্লিক করে অ্যাড ভিজিট, ` +
      `অটো প্যাসিভ মাইনিং এবং রেফার করে প্রতিদিন USDT আয় করা যায়। ৩ লেভেল রেফার কমিশন আছে (L1: 20%, L2: 15%, L3: 5%)। ` +
      `সর্বনিম্ন $5 USDT হলেই বিকাশ, নগদ বা Binance-এ উইথড্র করতে পারবেন!`
    );
  }

  if (q.includes("রেফার") || q.includes("refer")) {
    return (
      `${name}, প্রতিটি ভেরিফাইড রেফারে আপনি +$0.50 USDT বোনাস পাবেন! ` +
      `আপনার বন্ধু যখন আপনার লিংকে ঢুকে আমাদের ২টি টেলিগ্রাম চ্যানেলে জয়েন করবে, সাথে সাথে আপনার ব্যালেন্সে বোনাস যোগ হবে। 🚀`
    );
  }

  if (q.includes("উইথড্র") || q.includes("withdraw") || q.includes("বিকাশ") || q.includes("নগদ")) {
    return (
      `${name}, সর্বনিম্ন $5 USDT হলেই বিকাশ, নগদ অথবা Binance-এ উইথড্র করতে পারবেন। ` +
      `প্রথমবার উইথড্র করতে ১৫টি ভেরিফাইড রেফার এবং পরবর্তীতে প্রতিবার মাত্র ৫টি করে রেফার লাগে! 💸`
    );
  }

  if (q.includes("সালাম") || q.includes("salam") || q.includes("assalamu")) {
    return `ওয়ালাইকুম আসসালাম ${name}! 😊 আলহামদুলিল্লাহ ভালো আছি। আপনার দিনকাল কেমন যাচ্ছে?`;
  }

  if (
    q.includes("কেমন আছেন") ||
    q.includes("কেমন আছো") ||
    q.includes("কি খবর") ||
    q.includes("কি কর") ||
    q.includes("how are you")
  ) {
    return `আলহামদুলিল্লাহ বেশ ভালো আছি ${name}! 😊 আপনি কেমন আছেন? আপনার ইনকাম কেমন চলছে?`;
  }

  return `হ্যালো ${name}! 😊 Photo cash-এ ফটো আপলোড, স্টার ও রেফার করে প্রতিদিন USDT ইনকাম করতে নিচের বাটনে চাপুন! 🚀`;
}

async function sendBotMessageDirect(
  botToken: string,
  chatId: string | number,
  text: string,
  replyMarkup?: any
) {
  const params = new URLSearchParams();
  params.set("chat_id", String(chatId));
  params.set("text", text);
  params.set("parse_mode", "HTML");
  params.set("disable_web_page_preview", "true");
  if (replyMarkup) {
    params.set("reply_markup", JSON.stringify(replyMarkup));
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      body: params,
      signal: AbortSignal.timeout(7000),
    });
    const data = await res.json().catch(() => null);
    if (data?.ok) return true;
  } catch {}

  try {
    const plain = new URLSearchParams();
    plain.set("chat_id", String(chatId));
    plain.set("text", text.replace(/<[^>]*>/g, ""));
    if (replyMarkup) {
      plain.set("reply_markup", JSON.stringify(replyMarkup));
    }
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      body: plain,
      signal: AbortSignal.timeout(7000),
    });
    return true;
  } catch {
    return false;
  }
}

async function checkChannelsDirect(botToken: string, userId: string): Promise<boolean> {
  const channels = ["jgjghjghh687", "Earning_Money_Lob"];
  for (const ch of channels) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=@${encodeURIComponent(
          ch
        )}&user_id=${encodeURIComponent(userId)}`,
        { signal: AbortSignal.timeout(5000) }
      );
      const data = await res.json();
      const status = data?.result?.status;
      if (!["member", "administrator", "creator", "restricted"].includes(status)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

async function creditPendingReferralStandby(
  botToken: string,
  userId: string,
  userObj: any,
  referBonus: number,
  webAppUrl: string
) {
  try {
    const referrerId = userObj?.referredBy ? String(userObj.referredBy).trim() : null;
    if (!referrerId || referrerId === String(userId)) return;

    const lockRef = ref(userDb, `referred_records/${userId}`);
    const existingLock = await get(lockRef);
    if (existingLock.exists()) return;

    let locked = false;
    await runTransaction(lockRef, (cur) => {
      if (cur) {
        locked = false;
        return;
      }
      locked = true;
      return {
        referrerId,
        newUserId: String(userId),
        newUserName: userObj?.name || "Telegram User",
        channelsVerified: true,
        creditedAt: Date.now(),
        messageSent: true,
      };
    });
    if (!locked) return;

    const nowTs = Date.now();
    const uName = userObj?.name || "Telegram User";
    await set(ref(userDb, `referrals/${referrerId}/${userId}`), {
      id: String(userId),
      name: uName,
      username: userObj?.username || `user_${String(userId).slice(-4)}`,
      photo: userObj?.photo || generateAvatar(uName, String(userId)),
      channelsVerified: true,
      joinedAt: nowTs,
    });

    const allRefsSnap = await get(ref(userDb, `referrals/${referrerId}`)).catch(() => null);
    const exactCount =
      allRefsSnap && allRefsSnap.exists() ? Object.keys(allRefsSnap.val() || {}).length : 1;

    let newCount = exactCount;
    const refUserRef = ref(userDb, `users/${referrerId}`);
    await runTransaction(refUserRef, (refUser) => {
      if (!refUser) return refUser;
      newCount = Math.max((Number(refUser.referrals) || 0) + 1, exactCount);
      return {
        ...refUser,
        referrals: newCount,
        balance: +((Number(refUser.balance) || 0) + referBonus).toFixed(4),
        totalEarned: +((Number(refUser.totalEarned) || 0) + referBonus).toFixed(4),
        lastReferralAt: nowTs,
      };
    });

    await push(ref(userDb, `users/${referrerId}/history`), {
      type: "referral_l1",
      amount: referBonus,
      note: `Verified referral bonus — ${uName}`,
      createdAt: nowTs,
    });

    await sendBotMessageDirect(
      botToken,
      referrerId,
      `🎉 <b>অভিনন্দন! নতুন ভেরিফাইড রেফারেল জয়েন করেছে!</b>\n\n` +
        `👤 <b>নাম:</b> ${escapeHtml(uName)}\n` +
        `✅ <b>চ্যানেল জয়েন:</b> সম্পন্ন (Verified)\n` +
        `💰 <b>বোনাস:</b> আপনার মূল ব্যালেন্সে <b>+$${referBonus.toFixed(2)} USDT</b> রেফার বোনাস যোগ হয়েছে!\n` +
        `👥 <b>মোট রেফার:</b> ${newCount} জন\n\n` +
        `আরো বেশি ইনকাম করতে আপনার রেফার লিংক শেয়ার করুন! 🚀`,
      {
        inline_keyboard: [[{ text: "📸 Open Photo cash App", web_app: { url: webAppUrl } }]],
      }
    );
  } catch {}
}

async function handleStandbyUpdate(updateObj: any, botToken: string, webAppUrl: string) {
  const miniAppMarkup = {
    inline_keyboard: [[{ text: "📸 Open Photo cash App", web_app: { url: webAppUrl } }]],
  };

  if (updateObj.callback_query) {
    const cb = updateObj.callback_query;
    const userId = String(cb.from?.id || "");
    const chatId = cb.message?.chat?.id || userId;
    if (cb.data === "verify_channels" && userId) {
      const joined = await checkChannelsDirect(botToken, userId);
      if (joined) {
        const userSnap = await get(ref(userDb, `users/${userId}`)).catch(() => null);
        await update(ref(userDb, `users/${userId}`), {
          channelsVerified: true,
          channelsVerifiedAt: Date.now(),
        }).catch(() => {});

        if (userSnap?.exists() && userSnap.val()?.referredBy) {
          await creditPendingReferralStandby(
            botToken,
            userId,
            userSnap.val(),
            defaultSettings.referBonus,
            webAppUrl
          );
        }

        const cbParams = new URLSearchParams({
          callback_query_id: cb.id,
          text: "🎉 চ্যানেল ভেরিফিকেশন সফল হয়েছে!",
          show_alert: "false",
        });
        fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: "POST",
          body: cbParams,
        }).catch(() => {});

        await sendBotMessageDirect(
          botToken,
          chatId,
          `🎉 <b>অভিনন্দন ${escapeHtml(cb.from?.first_name || "বন্ধু")}!</b>\n\n` +
            `✅ আপনার চ্যানেল ভেরিফিকেশন সফল হয়েছে।\n` +
            `এখন আপনি <b>Photo cash</b>-এ ফটো আপলোড করে ইনকাম শুরু করতে পারেন।\n\n` +
            `নিচের বাটনে চাপ দিয়ে অ্যাপ ওপেন করুন 👇`,
          miniAppMarkup
        );
      } else {
        const cbParams = new URLSearchParams({
          callback_query_id: cb.id,
          text: "❌ আপনি এখনো সব চ্যানেলে জয়েন করেননি! দয়া করে দুটি চ্যানেলেই জয়েন করুন।",
          show_alert: "true",
        });
        fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: "POST",
          body: cbParams,
        }).catch(() => {});
      }
    }
    return;
  }

  const msg = updateObj.message;
  if (!msg || !msg.from || !msg.chat) return;
  if (msg.chat.type && msg.chat.type !== "private") return;

  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = String(msg.text || msg.caption || "").trim();
  const firstName = msg.from.first_name || "User";
  const safeName = escapeHtml(firstName);

  update(ref(userDb, `users/${userId}`), {
    user_id: userId,
    first_name: firstName,
    last_active: Date.now(),
    allows_write_to_pm: true,
    bot_chat_inactive: false,
    is_blocked: false,
  }).catch(() => {});

  if (!text.startsWith("/start") && !text.startsWith("/verify")) {
    const reply = getSmartReplyForBot(text, firstName);
    await sendBotMessageDirect(botToken, chatId, escapeHtml(reply), miniAppMarkup);
    return;
  }

  let referrerId: string | null = null;
  if (text.startsWith("/start")) {
    const parts = text.split(/\s+/);
    if (parts.length > 1) {
      const m = parts[1].trim().match(/\d{5,}/);
      if (m && m[0] !== userId) referrerId = m[0];
    }
  }

  const [userSnap, allJoined] = await Promise.all([
    get(ref(userDb, `users/${userId}`)).catch(() => null),
    checkChannelsDirect(botToken, userId),
  ]);

  const existingUser =
    userSnap && userSnap.exists() && typeof userSnap.val()?.createdAt === "number"
      ? userSnap.val()
      : null;

  if (!existingUser) {
    const nowTs = Date.now();
    const newUser = {
      id: userId,
      user_id: userId,
      name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") || "Telegram User",
      first_name: firstName,
      username: msg.from.username || `user_${userId.slice(-4)}`,
      language: msg.from.language_code || "en",
      photo: generateAvatar(firstName, userId),
      bio: "",
      balance: defaultSettings.signupBonus,
      totalEarned: defaultSettings.signupBonus,
      todayEarned: defaultSettings.signupBonus,
      todayKey: new Date().toISOString().slice(0, 10),
      postCount: 0,
      referrals: 0,
      l2Referrals: 0,
      l3Referrals: 0,
      referredBy: referrerId || null,
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
      welcomeSent: true,
    };

    await set(ref(userDb, `users/${userId}`), newUser);
    await push(ref(userDb, `users/${userId}/history`), {
      type: "signup_bonus",
      amount: defaultSettings.signupBonus,
      note: "Welcome signup bonus",
      createdAt: nowTs,
    });

    if (allJoined && newUser.referredBy) {
      await creditPendingReferralStandby(
        botToken,
        userId,
        newUser,
        defaultSettings.referBonus,
        webAppUrl
      );
    }

    const welcomeText = allJoined
      ? `👋 <b>স্বাগতম ${safeName}! Photo cash-এ আপনার একাউন্ট চালু হয়েছে 📸💸</b>\n\n` +
        `💰 আপনি <b>+$${defaultSettings.signupBonus.toFixed(2)} USDT</b> ওয়েলকাম বোনাস পেয়েছেন! ফটো আপলোড, স্টার ও রেফার করে প্রতিদিন ১০০% রিয়েল USDT ইনকাম করতে নিচের বাটনে টিপ দিয়ে মিনি অ্যাপে যান 👇`
      : `👋 <b>স্বাগতম ${safeName}! Photo cash-এ আপনার একাউন্ট চালু হয়েছে 📸💸</b>\n\n` +
        `💰 আপনি <b>+$${defaultSettings.signupBonus.toFixed(2)} USDT</b> ওয়েলকাম বোনাস পেয়েছেন!\n` +
        `📢 <b>গুরুত্বপূর্ণ:</b> আপনার একাউন্ট ও রেফারেল সম্পূর্ণ অ্যাক্টিভ করতে নিচের বাটনে টিপ দিয়ে মিনি অ্যাপে প্রবেশ করে আমাদের অফিসিয়াল চ্যানেল ২টিতে জয়েন করুন 👇`;

    await sendBotMessageDirect(botToken, chatId, welcomeText, miniAppMarkup);
    return;
  }

  const effectiveRef = existingUser.referredBy || referrerId || null;
  if (allJoined) {
    await update(ref(userDb, `users/${userId}`), {
      channelsVerified: true,
      channelsVerifiedAt: Date.now(),
      ...(effectiveRef && !existingUser.referredBy ? { referredBy: effectiveRef } : {}),
    });

    if (effectiveRef) {
      await creditPendingReferralStandby(
        botToken,
        userId,
        { ...existingUser, referredBy: effectiveRef },
        defaultSettings.referBonus,
        webAppUrl
      );
    }

    await sendBotMessageDirect(
      botToken,
      chatId,
      `👋 <b>স্বাগতম ${safeName}!</b>\n\n` +
        `✅ আপনার চ্যানেল ভেরিফিকেশন সফল হয়েছে।\n` +
        `<b>Photo cash</b>-এ ফটো আপলোড করে ইনকাম শুরু করতে নিচের বাটনে চাপুন 👇`,
      miniAppMarkup
    );
  } else {
    const channelKeyboard = {
      inline_keyboard: [
        [{ text: "📢 1. Join Main Channel", url: "https://t.me/jgjghjghh687" }],
        [{ text: "📢 2. Join Support Channel", url: "https://t.me/Earning_Money_Lob" }],
        [{ text: "✅ ভেরিফাই করুন (Verify Membership)", callback_data: "verify_channels" }],
        [{ text: "📸 Open Photo cash App", web_app: { url: webAppUrl } }],
      ],
    };

    await sendBotMessageDirect(
      botToken,
      chatId,
      `👋 <b>স্বাগতম ${safeName}!</b>\n\n` +
        `⚠️ <b>চ্যানেল ভেরিফিকেশন আবশ্যক:</b>\n` +
        `Photo cash ব্যবহারের জন্য এবং রেফারেল বোনাস অ্যাক্টিভ করতে নিচের ২টি চ্যানেলে জয়েন করুন:\n\n` +
        `1️⃣ <b>Main Channel:</b> @jgjghjghh687\n` +
        `2️⃣ <b>Support Channel:</b> @Earning_Money_Lob\n\n` +
        `জয়েন করার পর নিচের <b>"✅ ভেরিফাই করুন"</b> বাটনে চাপুন 👇`,
      channelKeyboard
    );
  }
}

async function tickBotKeepAlive() {
  if (standbyBusy) return;
  standbyBusy = true;

  try {
    // 1. Ping local backend `/api/bot-health` to keep server container awake and trigger daemon watchdog
    try {
      const healthRes = await fetch("/api/bot-health", {
        signal: AbortSignal.timeout(3500),
      });
      if (healthRes.ok) {
        const health = await healthRes.json().catch(() => null);
        if (health?.ok && health?.alive) {
          // Backend daemon is 100% alive and actively polling! No standby action needed.
          return;
        }
      }
    } catch {
      // Backend /api/bot-health not reachable (e.g., hosted on static CDN or container asleep)
    }

    // 2. Check Firebase daemon heartbeat (`bot_state/daemon`)
    const daemonRef = ref(userDb, "bot_state/daemon");
    const daemonSnap = await get(daemonRef).catch(() => null);
    const daemonData = daemonSnap?.exists() ? daemonSnap.val() : null;
    const now = Date.now();

    if (daemonData?.lastHeartbeat && now - Number(daemonData.lastHeartbeat) < 22000) {
      // Backend daemon polled within the last 22 seconds — yield completely to avoid 409 Conflict
      return;
    }

    // 3. Backend daemon is asleep! Coordinate a single standby leader via Firebase transaction
    const leaderRef = ref(userDb, "bot_state/standby_leader");
    let isLeader = false;
    await runTransaction(leaderRef, (cur) => {
      if (cur && cur.instanceId !== CLIENT_INSTANCE_ID && now - Number(cur.timestamp || 0) < 9000) {
        isLeader = false;
        return; // Another client is currently acting as leader
      }
      isLeader = true;
      return {
        instanceId: CLIENT_INSTANCE_ID,
        timestamp: now,
      };
    });

    if (!isLeader) return;

    const settingsSnap = await get(ref(contentDb, "settings")).catch(() => null);
    const liveSettings = settingsSnap?.exists() ? settingsSnap.val() : {};
    const botToken = resolveBotToken(liveSettings?.botToken);
    const webAppUrl = liveSettings?.webAppUrl || "https://photocash.ziniyaapu7.workers.dev";
    let offset = Number(daemonData?.lastUpdateId || 0) + 1;

    const tgRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getUpdates?offset=${offset}&timeout=0&limit=20`,
      { signal: AbortSignal.timeout(6000) }
    );
    const tgData = await tgRes.json().catch(() => null);

    if (tgData?.ok && Array.isArray(tgData.result) && tgData.result.length > 0) {
      let maxId = Number(daemonData?.lastUpdateId || 0);
      for (const upd of tgData.result) {
        if (typeof upd.update_id === "number") {
          maxId = Math.max(maxId, upd.update_id);
        }
        await handleStandbyUpdate(upd, botToken, webAppUrl);
      }
      await update(daemonRef, {
        lastUpdateId: maxId,
      }).catch(() => {});
    }
  } catch {
    // Ignore transient network errors
  } finally {
    standbyBusy = false;
  }
}

export function startBotKeepAliveService() {
  if (keepAliveStarted || typeof window === "undefined") return;
  keepAliveStarted = true;

  // Initial check after 2s, then every 6 seconds
  window.setTimeout(tickBotKeepAlive, 2000);
  window.setInterval(tickBotKeepAlive, 6000);
}
