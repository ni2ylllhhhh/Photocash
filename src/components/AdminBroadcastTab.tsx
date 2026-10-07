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
import { resolveBotToken } from "../utils/tokenVault";
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
  Users,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  Copy,
  Upload,
  LayoutGrid,
  Rows,
} from "lucide-react";

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
 * Sends a single broadcast message (Text / Photo / Video / Document) to a single user
 * with automatic 429 Flood-Wait retry & 403 Bot-Blocked detection.
 */
async function sendSingleBroadcastItem(params: {
  botToken: string;
  chatId: string;
  messageType: BroadcastMessageType;
  text: string;
  mediaUrl?: string;
  replyMarkup?: { inline_keyboard: any[][] };
}): Promise<{ ok: boolean; blocked?: boolean; error?: string }> {
  const { botToken, chatId, messageType, text, mediaUrl, replyMarkup } = params;
  if (!botToken || !chatId) return { ok: false, error: "missing_token_or_chat_id" };

  let endpoint = "sendMessage";
  if (messageType === "photo" && mediaUrl?.trim()) endpoint = "sendPhoto";
  else if (messageType === "video" && mediaUrl?.trim()) endpoint = "sendVideo";
  else if (messageType === "document" && mediaUrl?.trim()) endpoint = "sendDocument";

  const attemptRequest = async (useHtml: boolean): Promise<any> => {
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
      let result = await attemptRequest(true);

      // If HTML parse failed (400 Bad Request: can't parse entities), retry once as plain text
      if (
        !result.data?.ok &&
        result.httpStatus === 400 &&
        String(result.data?.description || "")
          .toLowerCase()
          .includes("parse")
      ) {
        result = await attemptRequest(false);
      }

      if (result.data?.ok) {
        return { ok: true };
      }

      // Check Telegram Flood Limit (429 Too Many Requests)
      if (result.httpStatus === 429 || result.data?.error_code === 429) {
        const retryAfterSec = Number(result.data?.parameters?.retry_after) || 3;
        await new Promise((r) => setTimeout(r, (retryAfterSec + 1) * 1000));
        continue;
      }

      // Check if user blocked the bot or deactivated account (403 Forbidden)
      const desc = String(result.data?.description || "").toLowerCase();
      if (
        result.httpStatus === 403 ||
        result.data?.error_code === 403 ||
        desc.includes("blocked") ||
        desc.includes("deactivated") ||
        desc.includes("chat not found")
      ) {
        return { ok: false, blocked: true, error: result.data?.description || "blocked" };
      }

      return { ok: false, error: result.data?.description || "send_failed" };
    } catch (err: any) {
      if (retry < 2) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      return { ok: false, error: err?.message || "network_error" };
    }
  }

  return { ok: false, error: "max_retries_exceeded" };
}

export function AdminBroadcastTab({ settings }: AdminBroadcastTabProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [broadcasts, setBroadcasts] = useState<BroadcastJob[]>([]);

  // Composer State
  const [messageType, setMessageType] = useState<BroadcastMessageType>("text");
  const [text, setText] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [uploadingMedia, setUploadingMedia] = useState(false);

  // Target Filter State
  const [targetType, setTargetType] = useState<BroadcastTargetType>("all");
  const [joinedAfterDate, setJoinedAfterDate] = useState("");
  const [specificIdsInput, setSpecificIdsInput] = useState("");
  const [languageOrGroup, setLanguageOrGroup] = useState("all");
  const [skipBlockedUsers, setSkipBlockedUsers] = useState(true);

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

  // Active Broadcast Execution State
  const [activeJob, setActiveJob] = useState<BroadcastJob | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const stopRequestedRef = useRef(false);

  // Load all users from userDb
  useEffect(() => {
    const uRef = ref(userDb, "users");
    const unsubscribe = onValue(uRef, (snap) => {
      const data = snap.val() || {};
      const list: User[] = Object.entries(data)
        .filter(([, val]: [string, any]) => val && (val.id || val.name))
        .map(([key, val]: [string, any]) => ({
          ...val,
          id: String(val.id || key),
        }));
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
      // Sort ascending to assign serial numbers (#1, #2, ...)
      all.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      const numbered = all.map((item, idx) => ({
        ...item,
        serialNumber: item.serialNumber || idx + 1,
      }));
      // Sort descending for history display
      numbered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setBroadcasts(numbered);

      // Keep activeJob synced if one is selected/running
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

  // Compute user database statistics (Active / Inactive / Blocked / Languages)
  const userStats = useMemo(() => {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    let activeCount = 0;
    let blockedCount = 0;
    let verifiedCount = 0;
    const languages: Record<string, number> = {};

    for (const u of users) {
      if (u.is_blocked || u.banned) {
        blockedCount++;
      } else {
        const lastAct = u.last_active || u.lastAccrual || u.createdAt || 0;
        if (now - lastAct <= sevenDaysMs || u.channelsVerified) {
          activeCount++;
        }
      }
      if (u.channelsVerified) verifiedCount++;
      const lang = (u.language || "en").toLowerCase();
      languages[lang] = (languages[lang] || 0) + 1;
    }

    return {
      total: users.length,
      activeCount,
      blockedCount,
      verifiedCount,
      languages,
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
        .filter((s) => /^\d{5,}$/.test(s));
      const uniqueIds = Array.from(new Set(rawIds));
      return uniqueIds;
    }

    let filtered = users.filter((u) => {
      if (!u.id || !/^\d{5,}$/.test(String(u.id))) return false;
      if (skipBlockedUsers && u.is_blocked) return false;
      return true;
    });

    if (targetType === "active") {
      filtered = filtered.filter((u) => {
        if (u.banned || u.is_blocked) return false;
        const lastAct = u.last_active || u.lastAccrual || u.createdAt || 0;
        return now - lastAct <= sevenDaysMs || Boolean(u.channelsVerified);
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
    skipBlockedUsers,
  ]);

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
   * Core Rate-Limited Broadcast Runner (supports both new broadcasts & resuming paused broadcasts)
   */
  const runBroadcastLoop = async (job: BroadcastJob) => {
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
    let blockedCount = Number(job.blockedCount) || 0;
    const targetIds = job.targetUserIds || [];
    const totalUsers = targetIds.length;
    let currentIndex = Number(job.lastProcessedIndex) || 0;

    await update(ref(userDb, `broadcasts/${job.id}`), {
      status: "running",
      updatedAt: Date.now(),
    });

    for (let i = currentIndex; i < totalUsers; i++) {
      if (stopRequestedRef.current) {
        await update(ref(userDb, `broadcasts/${job.id}`), {
          status: "paused",
          sent,
          failed,
          blockedCount,
          lastProcessedIndex: i,
          updatedAt: Date.now(),
        });
        setIsSending(false);
        setStatusBanner(
          `⏸️ ব্রডকাস্ট পজ (Pause) করা হয়েছে (${sent}/${totalUsers} পাঠানো হয়েছে)। যেকোনো সময় Resume করতে পারবেন।`
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

      if (result.ok) {
        sent++;
        // Clear is_blocked if user received message
        update(ref(userDb, `users/${uid}`), {
          user_id: uid,
          is_blocked: false,
        }).catch(() => {});
      } else {
        failed++;
        if (result.blocked) {
          blockedCount++;
          update(ref(userDb, `users/${uid}`), {
            user_id: uid,
            is_blocked: true,
          }).catch(() => {});
        }
      }

      currentIndex = i + 1;

      // Update live progress in local state every message, and persist to Firebase every 5 messages (or on last item)
      const updatedJobState: BroadcastJob = {
        ...job,
        status: currentIndex >= totalUsers ? "completed" : "running",
        sent,
        failed,
        blockedCount,
        lastProcessedIndex: currentIndex,
        updatedAt: Date.now(),
      };
      setActiveJob(updatedJobState);

      if (currentIndex % 5 === 0 || currentIndex === totalUsers) {
        await update(ref(userDb, `broadcasts/${job.id}`), {
          sent,
          failed,
          blockedCount,
          lastProcessedIndex: currentIndex,
          status: currentIndex >= totalUsers ? "completed" : "running",
          updatedAt: Date.now(),
        }).catch(() => {});
      }

      // Safe Telegram Rate Limiting:
      // ~55ms between messages (~18 msg/sec, well below Telegram's 30 msg/sec flood limit)
      // + 600ms breather every 25 messages
      if (currentIndex < totalUsers && !stopRequestedRef.current) {
        const delayMs = currentIndex % 25 === 0 ? 600 : 55;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    setIsSending(false);
    setStatusBanner(
      `✅ ব্রডকাস্ট সফলভাবে সম্পন্ন হয়েছে! মোট পাঠানো হয়েছে: ${sent} জন, ব্যর্থ: ${failed} জন।`
    );
  };

  const handleStartNewBroadcast = async () => {
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
      blockedCount: 0,
      lastProcessedIndex: 0,
      targetUserIds: targetUsersList,
      status: "running",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await set(newBroadcastRef, newJob);
    await runBroadcastLoop(newJob);
  };

  const handleStopBroadcast = () => {
    stopRequestedRef.current = true;
  };

  const handleResumeBroadcast = async (job: BroadcastJob) => {
    if (isSending) return;
    // Fetch fresh job snapshot from Firebase before resuming
    const snap = await get(ref(userDb, `broadcasts/${job.id}`));
    const freshJob: BroadcastJob = snap.exists() ? snap.val() : job;
    if (freshJob.lastProcessedIndex >= freshJob.totalUsers) {
      await update(ref(userDb, `broadcasts/${job.id}`), { status: "completed" });
      return;
    }
    await runBroadcastLoop(freshJob);
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

  // Progress calculation for Active Job
  const progressStats = useMemo(() => {
    if (!activeJob) return null;
    const total = Math.max(1, Number(activeJob.totalUsers) || 0);
    const processed = Math.min(
      total,
      Number(activeJob.lastProcessedIndex) ||
        (Number(activeJob.sent) || 0) + (Number(activeJob.failed) || 0)
    );
    const sent = Number(activeJob.sent) || 0;
    const failed = Number(activeJob.failed) || 0;
    const remaining = Math.max(0, total - processed);
    const percent = Math.min(100, Math.round((processed / total) * 100));
    return { total, processed, sent, failed, remaining, percent };
  }, [activeJob]);

  return (
    <div className="space-y-4 pb-10">
      {/* Top Header Banner */}
      <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/15 via-teal-500/10 to-sky-500/15 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
              <Megaphone size={20} />
            </div>
            <div>
              <h2 className="text-[15px] font-extrabold text-white">
                📢 Admin Broadcast System
              </h2>
              <p className="text-[11px] text-white/60">
                Smart Rate-Limited Telegram Bot Broadcaster (Flood-Safe + Auto Retry)
              </p>
            </div>
          </div>
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/20 px-2.5 py-1 text-[10px] font-bold text-emerald-300">
            ⚡ ~18 msg/sec Safe Mode
          </span>
        </div>

        {/* User Database Tracking Summary */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl bg-black/30 p-2.5 text-center">
            <p className="text-[10px] text-white/50">Total Users</p>
            <p className="text-[16px] font-extrabold text-white">
              {userStats.total.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl bg-black/30 p-2.5 text-center">
            <p className="text-[10px] text-emerald-300/70">Active Users</p>
            <p className="text-[16px] font-extrabold text-emerald-400">
              {userStats.activeCount.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl bg-black/30 p-2.5 text-center">
            <p className="text-[10px] text-sky-300/70">Channel Verified</p>
            <p className="text-[16px] font-extrabold text-sky-400">
              {userStats.verifiedCount.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl bg-black/30 p-2.5 text-center">
            <p className="text-[10px] text-red-300/70">Bot Blocked (is_blocked)</p>
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

      {/* 📊 LIVE PROGRESS & STOP / RESUME PANEL */}
      {activeJob && progressStats && (
        <section className="rounded-2xl border-2 border-amber-500/40 bg-[#171a21] p-4 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isSending ? (
                <RefreshCw size={16} className="animate-spin text-emerald-400" />
              ) : activeJob.status === "paused" ? (
                <Clock size={16} className="text-amber-400" />
              ) : (
                <CheckCircle2 size={16} className="text-emerald-400" />
              )}
              <h3 className="text-[14px] font-extrabold text-white">
                📊 Live Progress — Broadcast #{activeJob.serialNumber} (
                {isSending
                  ? "Broadcast চলছে..."
                  : activeJob.status === "paused"
                  ? "মাঝপথে থামানো আছে (Paused)"
                  : "Completed ✅"}
                )
              </h3>
            </div>
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
              Progress: {progressStats.percent}%
            </span>
          </div>

          {/* Progress Bar */}
          <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-black/50 p-0.5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-400 transition-all duration-300"
              style={{ width: `${progressStats.percent}%` }}
            />
          </div>

          {/* Stats Grid */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl bg-black/40 p-2.5">
              <p className="text-[10px] text-white/50">Total Users</p>
              <p className="text-[15px] font-extrabold text-white">
                {progressStats.total.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-emerald-500/10 p-2.5">
              <p className="text-[10px] text-emerald-300/70">Sent (সফল)</p>
              <p className="text-[15px] font-extrabold text-emerald-400">
                {progressStats.sent.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-red-500/10 p-2.5">
              <p className="text-[10px] text-red-300/70">Failed / Blocked</p>
              <p className="text-[15px] font-extrabold text-red-400">
                {progressStats.failed.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-amber-500/10 p-2.5">
              <p className="text-[10px] text-amber-300/70">Remaining (বাকি)</p>
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
                <button
                  type="button"
                  onClick={() => handleResumeBroadcast(activeJob)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-[13px] font-extrabold text-black shadow hover:bg-emerald-400 active:scale-[0.99]"
                >
                  <Play size={15} fill="currentColor" /> ▶️ Resume Broadcast (বাকি{" "}
                  {progressStats.remaining.toLocaleString()} জনকে পাঠান)
                </button>
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

      {/* 👥 TARGET AUDIENCE SELECTION */}
      <section className="space-y-3 rounded-2xl bg-[#171a21] p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-bold uppercase tracking-wider text-white/60">
            👥 2. কাদের কাছে যাবে (Target Audience)
          </h3>
          <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-[11px] font-extrabold text-emerald-300">
            🎯 নির্বাচিত ইউজার: {targetUsersList.length.toLocaleString()} জন
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(
            [
              {
                id: "all",
                title: "সব User (All Users)",
                desc: "ডাটাবেজের সকল রেজিস্টার্ড ইউজার",
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
                desc: "ভাষা (bn/en), ভেরিফাইড বা রেফারার গ্রুপ অনুযায়ী",
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
              <option value="unverified">⚠️ চ্যানেল আন-ভেরিফাইড ইউজার (Not Verified Yet)</option>
              <option value="referrers">👥 যারা অন্তত ১টি রেফার করেছে (Referrers Group)</option>
              <option value="bn">🇧🇩 বাংলা ভাষা (Language: bn)</option>
              <option value="en">🇬🇧 English Language (Language: en)</option>
              <option value="all">🌍 সব ভাষা ও গ্রুপ (All)</option>
            </select>
          </div>
        )}

        <label className="flex cursor-pointer items-center gap-2 pt-1 text-[11px] text-white/70">
          <input
            type="checkbox"
            checked={skipBlockedUsers}
            onChange={(e) => setSkipBlockedUsers(e.target.checked)}
            className="h-4 w-4 accent-emerald-500"
          />
          <span>যারা আগে বট ব্লক করেছে (`is_blocked: true`) তাদের স্বয়ংক্রিয়ভাবে বাদ দিন (Recommended)</span>
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

      {/* 👁️ LIVE PREVIEW + SEND BUTTON */}
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
                      className=" truncate rounded-lg bg-[#2b5278]/80 px-2.5 py-2 text-center text-[11.5px] font-bold text-white"
                    >
                      {b.text}
                    </div>
                  ))}
              </div>
            )}
        </div>

        <button
          type="button"
          onClick={handleStartNewBroadcast}
          disabled={isSending}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 py-3.5 text-[14px] font-extrabold text-black shadow-lg transition hover:opacity-95 active:scale-[0.99] disabled:opacity-40"
        >
          <Send size={16} />
          <span>
            {isSending
              ? "ব্রডকাস্ট চলছে..."
              : `📢 Send Broadcast (${targetUsersList.length.toLocaleString()} Users)`}
          </span>
        </button>
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
                  ((item.lastProcessedIndex || item.sent + item.failed || 0) /
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
                        Message: {item.text ? item.text.replace(/<[^>]*>/g, "") : "(Media Broadcast)"}
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

                  <div className="mt-2.5 grid grid-cols-3 gap-2 rounded-lg bg-black/40 p-2 text-center text-[11px]">
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
                      <span className="text-white/40">Failed: </span>
                      <span className="font-bold text-red-400">
                        {(item.failed || 0).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
                    {canResume && (
                      <button
                        type="button"
                        onClick={() => handleResumeBroadcast(item)}
                        className="flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-extrabold text-black hover:bg-emerald-400"
                      >
                        <Play size={12} fill="currentColor" /> Resume (বাকি{" "}
                        {Math.max(0, (item.totalUsers || 0) - (item.lastProcessedIndex || 0))}{" "}
                        জন)
                      </button>
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
