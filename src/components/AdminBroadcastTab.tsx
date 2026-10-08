import React, { useState, useEffect, useMemo, useRef } from "react";
import { ref, onValue, push, set, update, remove, get } from "firebase/database";
import { userDb } from "../firebase";
import {
  BroadcastButton,
  BroadcastJob,
  BroadcastMessageType,
  BroadcastTargetType,
  Settings,
  User,
} from "../types";
import { resolveBotToken, encryptBotToken } from "../utils/tokenVault";
import { uploadImageToImgbb } from "../utils";
import {
  Megaphone,
  Send,
  Square,
  Play,
  Plus,
  Trash2,
  Image as ImageIcon,
  Video,
  FileText,
  Type,
  CheckCircle2,
  Clock,
  RefreshCw,
  Copy,
  Upload,
  LayoutGrid,
  Rows,
  Layers,
} from "lucide-react";

const BATCH_SIZE = 25; // গ্রুপ ভিত্তিক ২৫ জন করে ১টি ব্যাচ

interface AdminBroadcastTabProps {
  settings: Settings;
}

function formatBroadcastDate(ts: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Builds Telegram InlineKeyboardMarkup from BroadcastButton[] and column layout (1 or 2 columns)
 */
function buildReplyMarkup(
  buttons: BroadcastButton[],
  columns: 1 | 2
): { inline_keyboard: any[][] } | undefined {
  const valid = (buttons || []).filter(
    (b) => b.text && b.text.trim() && b.url && b.url.trim()
  );
  if (valid.length === 0) return undefined;

  const formatted = valid.map((b) => {
    const cleanUrl = b.url.trim();
    if (b.isWebApp && cleanUrl.startsWith("https://")) {
      return {
        text: b.text.trim(),
        web_app: { url: cleanUrl },
      };
    }
    return {
      text: b.text.trim(),
      url: cleanUrl,
    };
  });

  const rows: any[][] = [];
  if (columns === 2) {
    for (let i = 0; i < formatted.length; i += 2) {
      rows.push(formatted.slice(i, i + 2));
    }
  } else {
    for (const btn of formatted) {
      rows.push([btn]);
    }
  }

  return { inline_keyboard: rows };
}

/**
 * 3-Layer Telegram Delivery Engine (POST -> Plain Text Fallback -> Server Proxy Fallback)
 * Strictly follows Telegram Bot API Rules with 429 Flood-Wait Retry & Smart Status Detection:
 * - status: "sent" -> Message delivered to user
 * - status: "not_started" -> User opened Mini App link without starting bot chat (`chat not found`)
 * - status: "blocked" -> User blocked the bot or deactivated Telegram account
 * - status: "failed" -> Other error
 */
async function sendSingleBroadcastItem(params: {
  botToken: string;
  chatId: string;
  messageType: BroadcastMessageType;
  text: string;
  mediaUrl?: string;
  replyMarkup?: { inline_keyboard: any[][] };
}): Promise<{
  status: "sent" | "not_started" | "blocked" | "failed";
  error?: string;
}> {
  const { botToken, chatId, messageType, text, mediaUrl, replyMarkup } = params;
  if (!botToken || !chatId) return { status: "failed", error: "missing_token_or_chat_id" };

  let endpoint = "sendMessage";
  if (messageType === "photo" && mediaUrl?.trim()) endpoint = "sendPhoto";
  else if (messageType === "video" && mediaUrl?.trim()) endpoint = "sendVideo";
  else if (messageType === "document" && mediaUrl?.trim()) endpoint = "sendDocument";

  const attemptDirectPost = async (useHtml: boolean): Promise<{ httpStatus: number; data: any }> => {
    const form = new URLSearchParams();
    form.set("chat_id", String(chatId));

    const cleanText = useHtml ? text : text.replace(/<[^>]*>/g, "");
    if (endpoint === "sendMessage") {
      form.set("text", cleanText || " ");
    } else {
      const mediaKey =
        endpoint === "sendPhoto"
          ? "photo"
          : endpoint === "sendVideo"
          ? "video"
          : "document";
      form.set(mediaKey, (mediaUrl || "").trim());
      if (cleanText.trim()) {
        form.set("caption", cleanText);
      }
    }

    if (useHtml) {
      form.set("parse_mode", "HTML");
    }
    if (replyMarkup) {
      form.set("reply_markup", JSON.stringify(replyMarkup));
    }

    const res = await fetch(`https://api.telegram.org/bot${botToken}/${endpoint}`, {
      method: "POST",
      body: form,
    });
    const data = await res.json().catch(() => ({ ok: false, status: res.status }));
    return { httpStatus: res.status, data };
  };

  for (let retry = 0; retry < 3; retry++) {
    try {
      let result = await attemptDirectPost(true);

      // Layer 2: If HTML tag parsing failed, retry immediately as plain text
      if (
        !result.data?.ok &&
        result.httpStatus === 400 &&
        String(result.data?.description || "")
          .toLowerCase()
          .includes("parse")
      ) {
        result = await attemptDirectPost(false);
      }

      if (result.data?.ok) {
        return { status: "sent" };
      }

      // Handle Telegram Flood Limit (429 Too Many Requests)
      if (result.httpStatus === 429 || result.data?.error_code === 429) {
        const retryAfterSec = Number(result.data?.parameters?.retry_after) || 3;
        await new Promise((r) => setTimeout(r, (retryAfterSec + 1) * 1000));
        continue;
      }

      const desc = String(result.data?.description || "").toLowerCase();

      // User hasn't pressed /start in bot chat yet (opened direct link only)
      if (desc.includes("chat not found") || desc.includes("peer_id_invalid")) {
        return { status: "not_started", error: result.data?.description };
      }

      // User blocked the bot or deactivated account (403 Forbidden)
      if (
        result.httpStatus === 403 ||
        result.data?.error_code === 403 ||
        desc.includes("blocked") ||
        desc.includes("deactivated") ||
        desc.includes("user is deactivated") ||
        desc.includes("bot can't initiate conversation")
      ) {
        return { status: "blocked", error: result.data?.description };
      }

      return { status: "failed", error: result.data?.description || "send_failed" };
    } catch (err: any) {
      // Layer 3: Browser network hiccup fallback -> try Server Proxy (/api/send-message) for text messages
      if (endpoint === "sendMessage") {
        try {
          const proxyRes = await fetch("/api/send-message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              bot_token: encryptBotToken(botToken),
              chat_id: chatId,
              text,
              parse_mode: "HTML",
              reply_markup: replyMarkup,
            }),
          });
          if (proxyRes.ok) {
            const pData = await proxyRes.json().catch(() => null);
            if (pData?.ok) return { status: "sent" };
          }
        } catch {}
      }

      if (retry < 2) {
        await new Promise((r) => setTimeout(r, 700));
        continue;
      }
      return { status: "failed", error: err?.message || "network_error" };
    }
  }

  return { status: "failed", error: "max_retries_exceeded" };
}

export function AdminBroadcastTab({ settings }: AdminBroadcastTabProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [broadcasts, setBroadcasts] = useState<BroadcastJob[]>([]);

  // Composer State
  const [messageType, setMessageType] = useState<BroadcastMessageType>("text");
  const [text, setText] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [uploadingMedia, setUploadingMedia] = useState(false);

  // Target Filter State (Default to "active" / verified & reachable users so failure rate is minimal!)
  const [targetType, setTargetType] = useState<BroadcastTargetType>("all");
  const [joinedAfterDate, setJoinedAfterDate] = useState("");
  const [specificIdsInput, setSpecificIdsInput] = useState("");
  const [languageOrGroup, setLanguageOrGroup] = useState("verified");
  const [skipBlockedAndInactive, setSkipBlockedAndInactive] = useState(true);

  // Inline Buttons State
  const [enableButtons, setEnableButtons] = useState(true);
  const [buttonColumns, setButtonColumns] = useState<1 | 2>(1);
  const [buttons, setButtons] = useState<BroadcastButton[]>([
    {
      text: "📸 Open Photo cash App",
      url: settings.webAppUrl || "https://photocash.ziniyaapu7.workers.dev",
      isWebApp: true,
    },
  ]);

  // Active Broadcast & 25-User Batch Execution State
  const [activeJob, setActiveJob] = useState<BroadcastJob | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [batchCooldownActive, setBatchCooldownActive] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const stopRequestedRef = useRef(false);

  // Load all real users from userDb (excluding fake Guest/SEED/🪱 entries)
  useEffect(() => {
    const uRef = ref(userDb, "users");
    const unsubscribe = onValue(uRef, (snap) => {
      const data = snap.val() || {};
      const list: User[] = Object.entries(data)
        .filter(([, val]: [string, any]) => {
          if (!val || (!val.id && !val.name)) return false;
          const uName = String(val.name || "");
          if (/^Guest \d+$/i.test(uName) || /SEED/i.test(uName) || uName.includes("🪱")) {
            return false;
          }
          return true;
        })
        .map(([key, val]: [string, any]) => ({
          ...val,
          id: String(val.id || key),
        }));

      // Sort so Bot-Reachable, Channel-Verified, and Most Recently Active users come FIRST!
      list.sort((a, b) => {
        const scoreA =
          (a.allows_write_to_pm ? 100 : 0) +
          (a.channelsVerified ? 50 : 0) +
          ((a.referrals || 0) > 0 ? 25 : 0);
        const scoreB =
          (b.allows_write_to_pm ? 100 : 0) +
          (b.channelsVerified ? 50 : 0) +
          ((b.referrals || 0) > 0 ? 25 : 0);
        if (scoreB !== scoreA) return scoreB - scoreA;
        return (b.last_active || b.createdAt || 0) - (a.last_active || a.createdAt || 0);
      });

      setUsers(list);
    });
    return () => unsubscribe();
  }, []);

  // Load broadcast history from userDb
  useEffect(() => {
    const bRef = ref(userDb, "broadcasts");
    const unsubscribe = onValue(bRef, (snap) => {
      const data = snap.val() || {};
      const all: BroadcastJob[] = Object.entries(data).map(([key, val]: [string, any]) => ({
        ...val,
        id: val.id || key,
      }));
      all.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      const numbered = all.map((item, idx) => ({
        ...item,
        serialNumber: item.serialNumber || idx + 1,
      }));
      numbered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setBroadcasts(numbered);

      setActiveJob((prev) => {
        if (!prev) {
          const resumable = numbered.find(
            (b) => b.status === "running" || b.status === "paused"
          );
          return resumable || null;
        }
        const updated = numbered.find((b) => b.id === prev.id);
        return updated || prev;
      });
    });
    return () => unsubscribe();
  }, []);

  // Compute user database statistics
  const userStats = useMemo(() => {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    let activeCount = 0;
    let blockedCount = 0;
    let verifiedCount = 0;
    let reachableCount = 0;

    for (const u of users) {
      if (u.is_blocked || u.banned) {
        blockedCount++;
      } else if (!u.bot_chat_inactive) {
        reachableCount++;
        const lastAct = u.last_active || u.lastAccrual || u.createdAt || 0;
        if (now - lastAct <= sevenDaysMs || u.channelsVerified) {
          activeCount++;
        }
      }
      if (u.channelsVerified) verifiedCount++;
    }

    return {
      total: users.length,
      reachableCount,
      activeCount,
      blockedCount,
      verifiedCount,
    };
  }, [users]);

  // Compute target user IDs based on selected filters
  const targetUsersList = useMemo(() => {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    if (targetType === "specific_ids") {
      const rawIds = specificIdsInput
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter((s) => /^\d{6,}$/.test(s));
      return Array.from(new Set(rawIds));
    }

    let filtered = users.filter((u) => {
      if (!u.id || !/^\d{6,}$/.test(String(u.id))) return false;
      if (u.banned) return false;
      if (skipBlockedAndInactive && (u.is_blocked || u.bot_chat_inactive)) return false;
      return true;
    });

    if (targetType === "active") {
      filtered = filtered.filter((u) => {
        const lastAct = u.last_active || u.lastAccrual || u.createdAt || 0;
        return Boolean(u.channelsVerified) || now - lastAct <= sevenDaysMs;
      });
    } else if (targetType === "joined_after" && joinedAfterDate) {
      const minTs = new Date(joinedAfterDate).getTime();
      if (!isNaN(minTs)) {
        filtered = filtered.filter((u) => {
          const joinedTs = u.joined_at || u.createdAt || 0;
          return joinedTs >= minTs;
        });
      }
    } else if (targetType === "language_group") {
      if (languageOrGroup === "verified") {
        filtered = filtered.filter((u) => Boolean(u.channelsVerified));
      } else if (languageOrGroup === "unverified") {
        filtered = filtered.filter((u) => !u.channelsVerified);
      } else if (languageOrGroup === "referrers") {
        filtered = filtered.filter((u) => (Number(u.referrals) || 0) > 0);
      } else if (languageOrGroup !== "all") {
        filtered = filtered.filter(
          (u) => (u.language || "en").toLowerCase() === languageOrGroup.toLowerCase()
        );
      }
    }

    return filtered.map((u) => String(u.id));
  }, [
    users,
    targetType,
    joinedAfterDate,
    specificIdsInput,
    languageOrGroup,
    skipBlockedAndInactive,
  ]);

  const totalBatchesCount = Math.max(1, Math.ceil(targetUsersList.length / BATCH_SIZE));

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingMedia(true);
    try {
      const uploadedUrl = await uploadImageToImgbb(
        file,
        settings.imgbbKeys && settings.imgbbKeys.length > 0
          ? settings.imgbbKeys
          : settings.imgbbKey
      );
      setMediaUrl(uploadedUrl);
      setStatusBanner("✅ ছবি সফলভাবে আপলোড হয়েছে!");
      setTimeout(() => setStatusBanner(null), 3000);
    } catch {
      setStatusBanner("❌ ছবি আপলোড ব্যর্থ হয়েছে। সরাসরি ইমেজ লিংক দিতে পারেন।");
    } finally {
      setUploadingMedia(false);
    }
  };

  const addButton = () => {
    setButtons((prev) => [
      ...prev,
      { text: "", url: "https://t.me/PhotoCash12_bot", isWebApp: false },
    ]);
  };

  const updateButton = (idx: number, patch: Partial<BroadcastButton>) => {
    setButtons((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };

  const removeButton = (idx: number) => {
    setButtons((prev) => prev.filter((_, i) => i !== idx));
  };

  /**
   * Group-Based 25-User Batch Broadcast Engine (`গ্রুপ ভিত্তিক ২৫ জন করে ব্যাচ`)
   * - Splits target users into batches of 25 users (`BATCH_SIZE = 25`)
   * - Follows Telegram's official Bot API rate rules (~85ms between users inside a batch, 1.5s pause between batches of 25)
   * - If `singleBatchOnly === true`, sends exactly 1 batch of 25 users and pauses cleanly!
   */
  const runBroadcastLoop = async (job: BroadcastJob, singleBatchOnly = false) => {
    if (isSending) return;
    setIsSending(true);
    stopRequestedRef.current = false;
    setActiveJob(job);

    const botToken = resolveBotToken(settings.botToken);
    const replyMarkup =
      job.buttons && job.buttons.length > 0
        ? buildReplyMarkup(job.buttons, job.buttonColumns || 1)
        : undefined;

    let sent = Number(job.sent) || 0;
    let failed = Number(job.failed) || 0;
    let skippedCount = Number(job.skippedCount) || 0;
    let blockedCount = Number(job.blockedCount) || 0;
    const targetIds = job.targetUserIds || [];
    const totalUsers = targetIds.length;
    let currentIndex = Number(job.lastProcessedIndex) || 0;

    // Calculate batch boundaries (25 users per batch)
    const startBatchEnd = Math.min(
      totalUsers,
      (Math.floor(currentIndex / BATCH_SIZE) + 1) * BATCH_SIZE
    );
    const stopAtIndex = singleBatchOnly ? startBatchEnd : totalUsers;

    await update(ref(userDb, `broadcasts/${job.id}`), {
      status: "running",
      updatedAt: Date.now(),
    });

    for (let i = currentIndex; i < stopAtIndex; i++) {
      if (stopRequestedRef.current) {
        await update(ref(userDb, `broadcasts/${job.id}`), {
          status: "paused",
          sent,
          failed,
          skippedCount,
          blockedCount,
          lastProcessedIndex: i,
          updatedAt: Date.now(),
        });
        setIsSending(false);
        setBatchCooldownActive(false);
        setStatusBanner(
          `⏸️ ব্রডকাস্ট পজ করা হয়েছে (সফল: ${sent}, স্কিপড: ${skippedCount})। যেকোনো সময় পরের ২৫ জনের ব্যাচ চালু করতে পারবেন।`
        );
        return;
      }

      const uid = targetIds[i];
      const result = await sendSingleBroadcastItem({
        botToken,
        chatId: uid,
        messageType: job.messageType,
        text: job.text,
        mediaUrl: job.mediaUrl,
        replyMarkup,
      });

      if (result.status === "sent") {
        sent++;
        update(ref(userDb, `users/${uid}`), {
          user_id: uid,
          allows_write_to_pm: true,
          bot_chat_inactive: false,
          is_blocked: false,
        }).catch(() => {});
      } else if (result.status === "not_started") {
        // User opened Mini App via direct link without starting bot chat yet -> mark bot_chat_inactive & count as Skipped (NOT Failed!)
        skippedCount++;
        update(ref(userDb, `users/${uid}`), {
          user_id: uid,
          bot_chat_inactive: true,
        }).catch(() => {});
      } else if (result.status === "blocked") {
        blockedCount++;
        failed++;
        update(ref(userDb, `users/${uid}`), {
          user_id: uid,
          is_blocked: true,
        }).catch(() => {});
      } else {
        failed++;
      }

      currentIndex = i + 1;
      const isComplete = currentIndex >= totalUsers;
      const isBatchBoundary = currentIndex % BATCH_SIZE === 0;

      const updatedJobState: BroadcastJob = {
        ...job,
        status: isComplete
          ? "completed"
          : singleBatchOnly && currentIndex >= stopAtIndex
          ? "paused"
          : "running",
        sent,
        failed,
        skippedCount,
        blockedCount,
        lastProcessedIndex: currentIndex,
        updatedAt: Date.now(),
      };
      setActiveJob(updatedJobState);

      if (currentIndex % 5 === 0 || isBatchBoundary || isComplete || currentIndex === stopAtIndex) {
        await update(ref(userDb, `broadcasts/${job.id}`), {
          sent,
          failed,
          skippedCount,
          blockedCount,
          lastProcessedIndex: currentIndex,
          status: updatedJobState.status,
          updatedAt: Date.now(),
        }).catch(() => {});
      }

      // Telegram Rules Rate Limiting:
      // 1) After every 25-user batch: 1500ms safe batch cooldown
      // 2) Inside a 25-user batch: 85ms safe delay between messages (~12 msg/sec)
      if (currentIndex < stopAtIndex && !stopRequestedRef.current) {
        if (isBatchBoundary) {
          setBatchCooldownActive(true);
          await new Promise((r) => setTimeout(r, 1500));
          setBatchCooldownActive(false);
        } else {
          await new Promise((r) => setTimeout(r, 85));
        }
      }
    }

    setIsSending(false);
    setBatchCooldownActive(false);

    if (currentIndex >= totalUsers) {
      setStatusBanner(
        `✅ সব ব্যাচের ব্রডকাস্ট সম্পন্ন হয়েছে! সফল (Sent): ${sent} জন, বট স্টার্ট করেনি (Skipped): ${skippedCount} জন, ব্যর্থ (Failed): ${failed} জন।`
      );
    } else {
      const completedBatchNum = Math.ceil(currentIndex / BATCH_SIZE);
      setStatusBanner(
        `📦 ব্যাচ #${completedBatchNum} (২৫ জন) সম্পন্ন হয়েছে! সফল (Sent): ${sent} জন। পরের ২৫ জনের ব্যাচ পাঠাতে 'Send Next 25-User Batch' বাটনে ক্লিক করুন।`
      );
    }
  };

  const handleStartNewBroadcast = async (singleBatchOnly = false) => {
    if (isSending) return;
    if (!text.trim() && messageType === "text") {
      setStatusBanner("❌ দয়া করে ব্রডকাস্ট মেসেজ লিখুন!");
      return;
    }
    if (messageType !== "text" && !mediaUrl.trim()) {
      setStatusBanner(`❌ দয়া করে ${messageType.toUpperCase()} লিংক বা ফাইল দিন!`);
      return;
    }
    if (targetUsersList.length === 0) {
      setStatusBanner("❌ নির্বাচিত ফিল্টারে কোনো ইউজার পাওয়া যায়নি!");
      return;
    }

    const nextSerial = broadcasts.length + 1;
    const newBroadcastRef = push(ref(userDb, "broadcasts"));
    const jobId = newBroadcastRef.key || `bc_${Date.now()}`;

    const newJob: BroadcastJob = {
      id: jobId,
      serialNumber: nextSerial,
      messageType,
      text: text.trim(),
      mediaUrl: messageType === "text" ? "" : mediaUrl.trim(),
      buttons: enableButtons
        ? buttons.filter((b) => b.text.trim() && b.url.trim())
        : [],
      buttonColumns,
      targetType,
      targetJoinedAfter: joinedAfterDate ? new Date(joinedAfterDate).getTime() : 0,
      targetLanguageOrGroup: languageOrGroup,
      targetSpecificIds: specificIdsInput,
      totalUsers: targetUsersList.length,
      sent: 0,
      failed: 0,
      skippedCount: 0,
      blockedCount: 0,
      lastProcessedIndex: 0,
      targetUserIds: targetUsersList,
      status: "running",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await set(newBroadcastRef, newJob);
    await runBroadcastLoop(newJob, singleBatchOnly);
  };

  const handleStopBroadcast = () => {
    stopRequestedRef.current = true;
  };

  const handleResumeBroadcast = async (job: BroadcastJob, singleBatchOnly = false) => {
    if (isSending) return;
    const snap = await get(ref(userDb, `broadcasts/${job.id}`));
    const freshJob: BroadcastJob = snap.exists() ? snap.val() : job;
    if (freshJob.lastProcessedIndex >= freshJob.totalUsers) {
      await update(ref(userDb, `broadcasts/${job.id}`), { status: "completed" });
      return;
    }
    await runBroadcastLoop(freshJob, singleBatchOnly);
  };

  const handleCloneBroadcast = (job: BroadcastJob) => {
    setMessageType(job.messageType || "text");
    setText(job.text || "");
    setMediaUrl(job.mediaUrl || "");
    if (job.buttons && job.buttons.length > 0) {
      setEnableButtons(true);
      setButtons(job.buttons);
      setButtonColumns(job.buttonColumns || 1);
    } else {
      setEnableButtons(false);
    }
    setStatusBanner(`📋 ব্রডকাস্ট #${job.serialNumber} কম্পোজারে লোড করা হয়েছে!`);
    setTimeout(() => setStatusBanner(null), 3000);
  };

  const handleDeleteHistory = async (id: string) => {
    await remove(ref(userDb, `broadcasts/${id}`));
    if (activeJob?.id === id) {
      setActiveJob(null);
    }
  };

  // Progress & 25-User Batch calculation for Active Job
  const progressStats = useMemo(() => {
    if (!activeJob) return null;
    const total = Math.max(1, Number(activeJob.totalUsers) || 0);
    const processed = Math.min(
      total,
      Number(activeJob.lastProcessedIndex) ||
        (Number(activeJob.sent) || 0) +
          (Number(activeJob.failed) || 0) +
          (Number(activeJob.skippedCount) || 0)
    );
    const sent = Number(activeJob.sent) || 0;
    const failed = Number(activeJob.failed) || 0;
    const skipped = Number(activeJob.skippedCount) || 0;
    const remaining = Math.max(0, total - processed);
    const percent = Math.min(100, Math.round((processed / total) * 100));

    const totalBatches = Math.max(1, Math.ceil(total / BATCH_SIZE));
    const currentBatchNumber = Math.min(
      totalBatches,
      Math.floor(Math.max(0, processed - (processed === total ? 1 : 0)) / BATCH_SIZE) + 1
    );
    const currentBatchCount =
      processed === total
        ? total % BATCH_SIZE || BATCH_SIZE
        : processed % BATCH_SIZE;
    const currentBatchTarget = Math.min(
      BATCH_SIZE,
      total - (currentBatchNumber - 1) * BATCH_SIZE
    );
    const batchPercent = Math.min(
      100,
      Math.round((currentBatchCount / Math.max(1, currentBatchTarget)) * 100)
    );

    return {
      total,
      processed,
      sent,
      failed,
      skipped,
      remaining,
      percent,
      totalBatches,
      currentBatchNumber,
      currentBatchCount,
      currentBatchTarget,
      batchPercent,
    };
  }, [activeJob]);

  return (
    <div className="space-y-4 pb-10">
      {/* Top Header Banner */}
      <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/15 via-teal-500/10 to-sky-500/15 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
              <Megaphone size={20} />
            </div>
            <div>
              <h2 className="text-[15px] font-extrabold text-white">
                📢 Admin Broadcast System (25-User Batch Engine)
              </h2>
              <p className="text-[11px] text-white/60">
                গ্রুপ ভিত্তিক ২৫ জন করে ব্যাচ • ১০০% টেলিগ্রাম রুলস ও ফ্লাড-সেফ ডেলিভারি
              </p>
            </div>
          </div>
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/20 px-2.5 py-1 text-[10px] font-bold text-emerald-300">
            📦 প্রতি ব্যাচে ২৫ জন ইউজার
          </span>
        </div>

        {/* User Database Tracking Summary */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl bg-black/30 p-2.5 text-center">
            <p className="text-[10px] text-white/50">Total Real Users</p>
            <p className="text-[16px] font-extrabold text-white">
              {userStats.total.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl bg-black/30 p-2.5 text-center">
            <p className="text-[10px] text-emerald-300/70">Active / Reachable</p>
            <p className="text-[16px] font-extrabold text-emerald-400">
              {userStats.reachableCount.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl bg-black/30 p-2.5 text-center">
            <p className="text-[10px] text-sky-300/70">Channel Verified</p>
            <p className="text-[16px] font-extrabold text-sky-400">
              {userStats.verifiedCount.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl bg-black/30 p-2.5 text-center">
            <p className="text-[10px] text-red-300/70">Blocked (is_blocked)</p>
            <p className="text-[16px] font-extrabold text-red-400">
              {userStats.blockedCount.toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {statusBanner && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-2.5 text-[12px] font-bold text-emerald-200">
          {statusBanner}
        </div>
      )}

      {/* 📊 LIVE PROGRESS & 25-USER BATCH PANEL */}
      {activeJob && progressStats && (
        <section className="rounded-2xl border-2 border-amber-500/40 bg-[#171a21] p-4 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {isSending ? (
                <RefreshCw size={16} className="animate-spin text-emerald-400" />
              ) : activeJob.status === "paused" ? (
                <Clock size={16} className="text-amber-400" />
              ) : (
                <CheckCircle2 size={16} className="text-emerald-400" />
              )}
              <h3 className="text-[14px] font-extrabold text-white">
                📊 Broadcast #{activeJob.serialNumber} —{" "}
                {isSending
                  ? batchCooldownActive
                    ? `⏳ ২৫ জনের ব্যাচ সম্পন্ন! পরের ব্যাচ প্রস্তুত হচ্ছে...`
                    : `চলছে: ব্যাচ #${progressStats.currentBatchNumber} / ${progressStats.totalBatches} (২৫ জনের গ্রুপ)`
                  : activeJob.status === "paused"
                  ? "মাঝপথে থামানো আছে (Paused)"
                  : "Completed ✅"}
              </h3>
            </div>
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
              মোট প্রগ্রেস: {progressStats.percent}%
            </span>
          </div>

          {/* Current 25-User Batch Progress Bar */}
          <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-2.5">
            <div className="mb-1 flex items-center justify-between text-[11px] font-bold">
              <span className="flex items-center gap-1.5 text-sky-300">
                <Layers size={13} /> বর্তমান ২৫ জনের ব্যাচ (Batch #{progressStats.currentBatchNumber} /{" "}
                {progressStats.totalBatches})
              </span>
              <span className="text-white">
                {progressStats.currentBatchCount} / {progressStats.currentBatchTarget} জন
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-black/60">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-all duration-200"
                style={{ width: `${progressStats.batchPercent}%` }}
              />
            </div>
          </div>

          {/* Overall Progress Bar */}
          <div className="mt-2.5 h-3 w-full overflow-hidden rounded-full bg-black/50 p-0.5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-400 transition-all duration-300"
              style={{ width: `${progressStats.percent}%` }}
            />
          </div>

          {/* Stats Grid */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div className="rounded-xl bg-black/40 p-2.5 text-center">
              <p className="text-[10px] text-white/50">Total Users</p>
              <p className="text-[15px] font-extrabold text-white">
                {progressStats.total.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-emerald-500/10 p-2.5 text-center">
              <p className="text-[10px] text-emerald-300/80">Sent (সফল ✅)</p>
              <p className="text-[15px] font-extrabold text-emerald-400">
                {progressStats.sent.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-sky-500/10 p-2.5 text-center">
              <p className="text-[10px] text-sky-300/80">Skipped (No /start)</p>
              <p className="text-[15px] font-extrabold text-sky-300">
                {progressStats.skipped.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-red-500/10 p-2.5 text-center">
              <p className="text-[10px] text-red-300/80">Failed / Blocked</p>
              <p className="text-[15px] font-extrabold text-red-400">
                {progressStats.failed.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-amber-500/10 p-2.5 text-center">
              <p className="text-[10px] text-amber-300/80">Remaining (বাকি)</p>
              <p className="text-[15px] font-extrabold text-amber-400">
                {progressStats.remaining.toLocaleString()}
              </p>
            </div>
          </div>

          {/* 🛑 Stop / ▶️ Resume Controls */}
          <div className="mt-3 flex flex-wrap gap-2">
            {isSending ? (
              <button
                type="button"
                onClick={handleStopBroadcast}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-500 py-2.5 text-[13px] font-extrabold text-white shadow hover:bg-red-600 active:scale-[0.99]"
              >
                <Square size={15} fill="currentColor" /> 🛑 Stop Broadcast (মাঝপথে থামান)
              </button>
            ) : (
              progressStats.remaining > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => handleResumeBroadcast(activeJob, true)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-sky-500 py-2.5 text-[12px] font-extrabold text-black shadow hover:bg-sky-400 active:scale-[0.99]"
                  >
                    <Layers size={15} /> 📦 পরের ২৫ জনের ১টি ব্যাচ পাঠান (Batch #
                    {progressStats.currentBatchNumber})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResumeBroadcast(activeJob, false)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-[12px] font-extrabold text-black shadow hover:bg-emerald-400 active:scale-[0.99]"
                  >
                    <Play size={15} fill="currentColor" /> ▶️ সব ব্যাচ অটোমেটিক Resume করুন (বাকি{" "}
                    {progressStats.remaining.toLocaleString()} জন)
                  </button>
                </>
              )
            )}
          </div>
        </section>
      )}

      {/* 📢 SEND BROADCAST COMPOSER */}
      <section className="space-y-3 rounded-2xl bg-[#171a21] p-4">
        <h3 className="text-[13px] font-bold uppercase tracking-wider text-white/60">
          📢 1. Send Broadcast — মেসেজের ধরন নির্বাচন করুন
        </h3>

        {/* Message Type Selector */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              { id: "text", label: "Text Message", Icon: Type },
              { id: "photo", label: "Photo + Caption", Icon: ImageIcon },
              { id: "video", label: "Video + Caption", Icon: Video },
              { id: "document", label: "Document", Icon: FileText },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setMessageType(id)}
              className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-[12px] font-bold transition ${
                messageType === id
                  ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                  : "border-white/10 bg-black/30 text-white/70 hover:bg-white/5"
              }`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        {/* Media Input (for Photo / Video / Document) */}
        {messageType !== "text" && (
          <div className="space-y-2 rounded-xl border border-white/10 bg-black/30 p-3">
            <label className="block text-[11px] font-bold text-emerald-300">
              {messageType === "photo"
                ? "🖼️ ছবির ডাইরেক্ট লিংক (Photo URL) অথবা ফাইল আপলোড করুন"
                : messageType === "video"
                ? "🎬 ভিডিও লিংক (MP4 URL বা Telegram Video File ID)"
                : "📄 ডকুমেন্ট লিংক (PDF/ZIP/File URL বা Telegram File ID)"}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder={
                  messageType === "photo"
                    ? "https://i.ibb.co.com/example.jpg"
                    : messageType === "video"
                    ? "https://example.com/video.mp4"
                    : "https://example.com/offer.pdf"
                }
                className="flex-1 rounded-lg bg-black/50 px-3 py-2 text-[12px] text-white outline-none ring-1 ring-white/10 focus:ring-emerald-400"
              />
              {messageType === "photo" && (
                <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-2 text-[12px] font-bold text-emerald-300 hover:bg-emerald-500/30">
                  <Upload size={14} />
                  <span>{uploadingMedia ? "Uploading..." : "Upload Photo"}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </div>
        )}

        {/* Message / Caption Textarea */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[11px] font-bold text-white/70">
              {messageType === "text"
                ? "✉️ ব্রডকাস্ট মেসেজ (HTML সাপোর্টেড: <b>bold</b>, <i>italic</i>, <code>code</code>)"
                : "📝 ক্যাপশন (Caption — HTML সাপোর্টেড)"}
            </label>
            <span className="text-[10px] text-white/40">{text.length} chars</span>
          </div>
          <textarea
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="🎉 ধামাকা নতুন অফার! আজই PhotoCash অ্যাপে ফটো আপলোড ও রেফার করে প্রতিদিন ইনকাম করুন..."
            className="w-full rounded-xl bg-black/40 p-3 text-[13px] leading-relaxed text-white outline-none ring-1 ring-white/10 focus:ring-emerald-400"
          />
        </div>
      </section>

      {/* 👥 TARGET AUDIENCE & 25-USER BATCH INFO */}
      <section className="space-y-3 rounded-2xl bg-[#171a21] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-bold uppercase tracking-wider text-white/60">
            👥 2. কাদের কাছে যাবে (Target Audience & 25-User Batches)
          </h3>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-sky-500/20 px-3 py-1 text-[11px] font-extrabold text-sky-300">
              📦 মোট ব্যাচ: {totalBatchesCount}টি (২৫ জন/ব্যাচ)
            </span>
            <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-[11px] font-extrabold text-emerald-300">
              🎯 মোট ইউজার: {targetUsersList.length.toLocaleString()} জন
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(
            [
              {
                id: "all",
                title: "সব User (All Reachable Users)",
                desc: "সকল বৈধ ইউজার (অ্যাক্টিভ ও ভেরিফাইড ইউজাররা প্রথম ব্যাচে থাকবে)",
              },
              {
                id: "active",
                title: "Active Users (অ্যাক্টিভ ইউজার)",
                desc: "যারা চ্যানেল ভেরিফাইড বা গত ৭ দিনে অ্যাক্টিভ ছিল",
              },
              {
                id: "joined_after",
                title: "নির্দিষ্ট সময়ের পর যারা Start করেছে",
                desc: "নির্দিষ্ট তারিখ ও সময়ের পর জয়েন করা নতুন ইউজার",
              },
              {
                id: "specific_ids",
                title: "নির্দিষ্ট User ID (Specific IDs)",
                desc: "১ জন বা নির্দিষ্ট কয়েকজন ইউজারের চ্যাট আইডিতে পাঠান",
              },
              {
                id: "language_group",
                title: "নির্দিষ্ট ভাষা / গ্রুপ অনুযায়ী",
                desc: "ভেরিফাইড গ্রুপ, রেফারার গ্রুপ বা ভাষা (bn/en) অনুযায়ী",
              },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setTargetType(opt.id)}
              className={`flex flex-col items-start rounded-xl border p-3 text-left transition ${
                targetType === opt.id
                  ? "border-emerald-400 bg-emerald-500/15"
                  : "border-white/10 bg-black/30 hover:bg-white/5"
              }`}
            >
              <span className="text-[12px] font-extrabold text-white">{opt.title}</span>
              <span className="mt-0.5 text-[10px] text-white/50">{opt.desc}</span>
            </button>
          ))}
        </div>

        {/* Conditional Sub-filters */}
        {targetType === "joined_after" && (
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <label className="mb-1 block text-[11px] font-bold text-emerald-300">
              📅 কোন তারিখ ও সময়ের পর জয়েন করা ইউজারদের পাঠাতে চান?
            </label>
            <input
              type="datetime-local"
              value={joinedAfterDate}
              onChange={(e) => setJoinedAfterDate(e.target.value)}
              className="w-full rounded-lg bg-black/50 px-3 py-2 text-[12px] text-white outline-none ring-1 ring-white/10"
            />
          </div>
        )}

        {targetType === "specific_ids" && (
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <label className="mb-1 block text-[11px] font-bold text-emerald-300">
              🆔 ইউজারদের টেলিগ্রাম Chat ID লিখুন (কমা বা স্পেস দিয়ে একাধিক দেওয়া যাবে)
            </label>
            <textarea
              rows={2}
              value={specificIdsInput}
              onChange={(e) => setSpecificIdsInput(e.target.value)}
              placeholder="যেমন: 8235864550, 8749291037"
              className="w-full rounded-lg bg-black/50 p-2.5 font-mono text-[12px] text-white outline-none ring-1 ring-white/10"
            />
          </div>
        )}

        {targetType === "language_group" && (
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <label className="mb-1.5 block text-[11px] font-bold text-emerald-300">
              🌐 গ্রুপ বা ভাষা নির্বাচন করুন:
            </label>
            <select
              value={languageOrGroup}
              onChange={(e) => setLanguageOrGroup(e.target.value)}
              className="w-full rounded-lg bg-black/60 px-3 py-2 text-[12px] font-semibold text-white outline-none ring-1 ring-white/10"
            >
              <option value="verified">✅ চ্যানেল ভেরিফাইড ইউজার (Channel Verified)</option>
              <option value="referrers">👥 যারা অন্তত ১টি রেফার করেছে (Referrers Group)</option>
              <option value="unverified">⚠️ চ্যানেল আন-ভেরিফাইড ইউজার (Not Verified Yet)</option>
              <option value="bn">🇧🇩 বাংলা ভাষা (Language: bn)</option>
              <option value="en">🇬🇧 English Language (Language: en)</option>
              <option value="all">🌍 সব ভাষা ও গ্রুপ (All)</option>
            </select>
          </div>
        )}

        <label className="flex cursor-pointer items-center gap-2 pt-1 text-[11px] text-white/70">
          <input
            type="checkbox"
            checked={skipBlockedAndInactive}
            onChange={(e) => setSkipBlockedAndInactive(e.target.checked)}
            className="h-4 w-4 accent-emerald-500"
          />
          <span>
            যারা বট ব্লক করেছে বা এখনো বটে `/start` দেয়নি তাদের অটোমেটিক স্কিপ করুন (যেন Failed না আসে)
          </span>
        </label>
      </section>

      {/* 🔘 INLINE KEYBOARD BUTTON BUILDER */}
      <section className="space-y-3 rounded-2xl bg-[#171a21] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={enableButtons}
              onChange={(e) => setEnableButtons(e.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
            <span className="text-[13px] font-bold uppercase tracking-wider text-white/80">
              🔘 3. Button / Inline Keyboard যোগ করুন
            </span>
          </label>

          {enableButtons && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setButtonColumns(1)}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold ${
                  buttonColumns === 1
                    ? "bg-emerald-500 text-black"
                    : "bg-white/10 text-white/70"
                }`}
              >
                <Rows size={12} /> 1-Column
              </button>
              <button
                type="button"
                onClick={() => setButtonColumns(2)}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold ${
                  buttonColumns === 2
                    ? "bg-emerald-500 text-black"
                    : "bg-white/10 text-white/70"
                }`}
              >
                <LayoutGrid size={12} /> 2-Column Layout
              </button>
            </div>
          )}
        </div>

        {enableButtons && (
          <div className="space-y-2.5">
            {buttons.map((btn, idx) => (
              <div
                key={idx}
                className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/30 p-3 sm:flex-row sm:items-center"
              >
                <div className="flex-1 space-y-1">
                  <span className="text-[10px] font-bold text-white/50">
                    Button #{idx + 1} Name
                  </span>
                  <input
                    type="text"
                    value={btn.text}
                    onChange={(e) => updateButton(idx, { text: e.target.value })}
                    placeholder="যেমন: 📸 Open PhotoCash App"
                    className="w-full rounded-lg bg-black/50 px-3 py-1.5 text-[12px] text-white outline-none ring-1 ring-white/10 focus:ring-emerald-400"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <span className="text-[10px] font-bold text-white/50">
                    Button #{idx + 1} URL
                  </span>
                  <input
                    type="text"
                    value={btn.url}
                    onChange={(e) => updateButton(idx, { url: e.target.value })}
                    placeholder="https://..."
                    className="w-full rounded-lg bg-black/50 px-3 py-1.5 text-[12px] text-white outline-none ring-1 ring-white/10 focus:ring-emerald-400"
                  />
                </div>
                <div className="flex items-center justify-between gap-2 pt-3 sm:pt-4">
                  <label className="flex cursor-pointer items-center gap-1 text-[11px] text-emerald-300">
                    <input
                      type="checkbox"
                      checked={Boolean(btn.isWebApp)}
                      onChange={(e) => updateButton(idx, { isWebApp: e.target.checked })}
                      className="h-3.5 w-3.5 accent-emerald-500"
                    />
                    <span>Mini App</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => removeButton(idx)}
                    className="rounded-lg bg-red-500/20 p-2 text-red-400 hover:bg-red-500/30"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={addButton}
                className="flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-[11px] font-bold text-white hover:bg-white/15"
              >
                <Plus size={13} /> + আরো বাটন যোগ করুন (Add Button)
              </button>
              <button
                type="button"
                onClick={() =>
                  setButtons((prev) => [
                    ...prev,
                    {
                      text: "📢 Join Official Channel",
                      url: "https://t.me/jgjghjghh687",
                      isWebApp: false,
                    },
                  ])
                }
                className="rounded-xl bg-sky-500/15 px-3 py-2 text-[11px] font-bold text-sky-300 hover:bg-sky-500/25"
              >
                + চ্যানেল বাটন যোগ করুন
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 👁️ LIVE PREVIEW + 25-USER BATCH SEND BUTTONS */}
      <section className="space-y-3 rounded-2xl bg-[#171a21] p-4">
        <h3 className="text-[12px] font-bold uppercase tracking-wider text-white/50">
          👁️ লাইভ প্রিভিউ (Telegram Message Preview)
        </h3>
        <div className="mx-auto max-w-sm rounded-2xl border border-white/10 bg-[#0e1621] p-3 shadow-inner">
          {messageType === "photo" && mediaUrl && (
            <img
              src={mediaUrl}
              alt="Preview"
              className="mb-2 max-h-48 w-full rounded-xl object-cover"
            />
          )}
          {messageType === "video" && mediaUrl && (
            <div className="mb-2 flex items-center gap-2 rounded-xl bg-white/10 p-3 text-[11px] text-sky-300">
              <Video size={16} /> <span>Video: {mediaUrl}</span>
            </div>
          )}
          {messageType === "document" && mediaUrl && (
            <div className="mb-2 flex items-center gap-2 rounded-xl bg-white/10 p-3 text-[11px] text-amber-300">
              <FileText size={16} /> <span>Document: {mediaUrl}</span>
            </div>
          )}
          <div className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-white/90">
            {text ? (
              <span dangerouslySetInnerHTML={{ __html: text }} />
            ) : (
              <span className="italic text-white/30">আপনার মেসেজ এখানে দেখা যাবে...</span>
            )}
          </div>

          {enableButtons &&
            buttons.filter((b) => b.text.trim() && b.url.trim()).length > 0 && (
              <div
                className={`mt-2.5 grid gap-1.5 ${
                  buttonColumns === 2 ? "grid-cols-2" : "grid-cols-1"
                }`}
              >
                {buttons
                  .filter((b) => b.text.trim() && b.url.trim())
                  .map((b, i) => (
                    <div
                      key={i}
                      className="truncate rounded-lg bg-[#2b5278]/80 px-2.5 py-2 text-center text-[11.5px] font-bold text-white"
                    >
                      {b.text}
                    </div>
                  ))}
              </div>
            )}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => handleStartNewBroadcast(true)}
            disabled={isSending}
            className="flex items-center justify-center gap-2 rounded-xl border border-sky-400/50 bg-sky-500/20 py-3.5 text-[13px] font-extrabold text-sky-300 shadow transition hover:bg-sky-500/30 active:scale-[0.99] disabled:opacity-40"
          >
            <Layers size={16} />
            <span>
              📦 ২৫ জনের ১টি ব্যাচ পাঠান (First {Math.min(BATCH_SIZE, targetUsersList.length)} Users)
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleStartNewBroadcast(false)}
            disabled={isSending}
            className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 py-3.5 text-[13px] font-extrabold text-black shadow-lg transition hover:opacity-95 active:scale-[0.99] disabled:opacity-40"
          >
            <Send size={16} />
            <span>
              {isSending
                ? "ব্রডকাস্ট চলছে..."
                : `🚀 ২৫ জন করে সব ব্যাচ পাঠান (${targetUsersList.length.toLocaleString()} Users)`}
            </span>
          </button>
        </div>
      </section>

      {/* 📜 BROADCAST HISTORY */}
      <section className="space-y-3 rounded-2xl bg-[#171a21] p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-bold uppercase tracking-wider text-white/60">
            📜 Broadcast History ({broadcasts.length})
          </h3>
        </div>

        {broadcasts.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-white/40">
            এখনো কোনো ব্রডকাস্ট পাঠানো হয়নি।
          </p>
        ) : (
          <div className="space-y-2.5">
            {broadcasts.map((item) => {
              const canResume =
                !isSending &&
                item.status !== "completed" &&
                (item.lastProcessedIndex || 0) < (item.totalUsers || 0);
              const pct = Math.min(
                100,
                Math.round(
                  ((item.lastProcessedIndex ||
                    (item.sent || 0) + (item.failed || 0) + (item.skippedCount || 0)) /
                    Math.max(1, item.totalUsers || 1)) *
                    100
                )
              );

              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-white/10 bg-black/30 p-3.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 font-mono text-[11px] font-extrabold text-emerald-300">
                          #{item.serialNumber}
                        </span>
                        <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase text-white/80">
                          {item.messageType}
                        </span>
                        <span className="text-[11px] text-white/50">
                          Date: {formatBroadcastDate(item.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-[12px] font-semibold text-white/90">
                        Message:{" "}
                        {item.text ? item.text.replace(/<[^>]*>/g, "") : "(Media Broadcast)"}
                      </p>
                    </div>

                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase ${
                        item.status === "completed"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : item.status === "running"
                          ? "bg-sky-500/20 text-sky-300"
                          : "bg-amber-500/20 text-amber-300"
                      }`}
                    >
                      {item.status === "completed"
                        ? "Completed"
                        : item.status === "running"
                        ? `Running (${pct}%)`
                        : `Paused (${pct}%)`}
                    </span>
                  </div>

                  <div className="mt-2.5 grid grid-cols-4 gap-2 rounded-lg bg-black/40 p-2 text-center text-[11px]">
                    <div>
                      <span className="text-white/40">Users: </span>
                      <span className="font-bold text-white">
                        {(item.totalUsers || 0).toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-white/40">Sent: </span>
                      <span className="font-bold text-emerald-400">
                        {(item.sent || 0).toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-white/40">Skipped: </span>
                      <span className="font-bold text-sky-300">
                        {(item.skippedCount || 0).toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-white/40">Failed: </span>
                      <span className="font-bold text-red-400">
                        {(item.failed || 0).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
                    {canResume && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleResumeBroadcast(item, true)}
                          className="flex items-center gap-1 rounded-lg bg-sky-500 px-3 py-1.5 text-[11px] font-extrabold text-black hover:bg-sky-400"
                        >
                          <Layers size={12} /> +২৫ জনের ১টি ব্যাচ পাঠান
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResumeBroadcast(item, false)}
                          className="flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-extrabold text-black hover:bg-emerald-400"
                        >
                          <Play size={12} fill="currentColor" /> সব ব্যাচ Resume করুন (বাকি{" "}
                          {Math.max(
                            0,
                            (item.totalUsers || 0) - (item.lastProcessedIndex || 0)
                          )}{" "}
                          জন)
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => handleCloneBroadcast(item)}
                      className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/15"
                    >
                      <Copy size={12} /> Reuse
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteHistory(item.id)}
                      className="flex items-center gap-1 rounded-lg bg-red-500/20 px-2.5 py-1.5 text-[11px] font-semibold text-red-300 hover:bg-red-500/30"
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
