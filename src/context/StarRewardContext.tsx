import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { ref, get, update, runTransaction, push } from "firebase/database";
import { contentDb, userDb } from "../firebase";
import { useSettings } from "./SettingsContext";
import { useUser } from "./UserContext";
import { defaultSettings } from "../types";
import { Sparkles, ExternalLink, AlertTriangle, CheckCircle2, X, Clock } from "lucide-react";

export const MIN_STAR_SECONDS = 60; // 1 minute minimum on ad site
export const MAX_STAR_SECONDS = 360; // 6 minutes maximum allowed
export const STAR_USDT_REWARD = 0.01; // 0.01 USDT per star to post creator
const SESSION_STORAGE_KEY = "photocash_active_star_session";

interface StarSession {
  postId: string;
  authorName?: string;
  authorId?: string;
  startedAt: number;
}

interface StarRewardContextType {
  startStarSession: (postId: string, authorName?: string, authorId?: string) => void;
  activeSession: StarSession | null;
  cancelSession: () => void;
  verifySession: () => void;
  reopenAdLink: () => void;
}

const StarRewardContext = createContext<StarRewardContextType | null>(null);

export function StarRewardProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const { user } = useUser();

  const [activeSession, setActiveSession] = useState<StarSession | null>(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  });

  const [remainingSec, setRemainingSec] = useState<number>(MIN_STAR_SECONDS);
  const [warningMessage, setWarningMessage] = useState<string>("");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "info";
    title: string;
    message: string;
  } | null>(null);

  const starAdUrl =
    settings.starAdLink?.trim() ||
    defaultSettings.starAdLink ||
    "https://ads.ziniyaapu7.workers.dev/";

  // Sync session with storage
  useEffect(() => {
    if (activeSession) {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(activeSession));
    } else {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, [activeSession]);

  // Real-time countdown timer for active session
  useEffect(() => {
    if (!activeSession) {
      setRemainingSec(MIN_STAR_SECONDS);
      setWarningMessage("");
      return;
    }

    const checkTimer = () => {
      const elapsed = Math.floor((Date.now() - activeSession.startedAt) / 1000);
      const remaining = Math.max(0, MIN_STAR_SECONDS - elapsed);
      setRemainingSec(remaining);
    };

    checkTimer();
    const interval = setInterval(checkTimer, 500);
    return () => clearInterval(interval);
  }, [activeSession]);

  // Award star to post AND credit 0.01 USDT to post creator's balance
  const awardStar = useCallback(
    async (postId: string, explicitAuthorId?: string) => {
      try {
        const postRef = ref(contentDb, `posts/${postId}`);
        const snap = await get(postRef);

        let authorId = explicitAuthorId || "";
        let nextStars = 1;

        if (snap.exists()) {
          const postData = snap.val();
          authorId = authorId || postData.authorId || "";
          const currentStars = Number(postData.starsCount ?? postData.stars ?? 0);
          nextStars = currentStars + 1;
          await update(postRef, {
            starsCount: nextStars,
            stars: nextStars,
          });
        } else {
          await update(postRef, {
            starsCount: 1,
            stars: 1,
          });
        }

        // Credit 0.01 USDT to post author's balance
        if (authorId) {
          try {
            const authorRef = ref(userDb, `users/${authorId}`);
            const authorSnap = await get(authorRef);
            if (authorSnap.exists()) {
              const currentBal = Number(authorSnap.val()?.balance || 0);
              const currentTotal = Number(authorSnap.val()?.totalEarned || 0);
              const newBal = Number((currentBal + STAR_USDT_REWARD).toFixed(4));
              const newTotal = Number((currentTotal + STAR_USDT_REWARD).toFixed(4));

              await update(authorRef, {
                balance: newBal,
                totalEarned: newTotal,
              });

              await push(ref(userDb, `users/${authorId}/history`), {
                type: "star_reward",
                amount: STAR_USDT_REWARD,
                note: `পোস্টে স্টার বোনাস (+0.01 USDT)`,
                createdAt: Date.now(),
              });
            }
          } catch (authorErr) {
            console.error("Failed to credit author balance for star:", authorErr);
          }
        }

        setFeedback({
          type: "success",
          title: "স্টার যুক্ত হয়েছে! ⭐",
          message: `🎉 অভিনন্দন! সফলভাবে ১ মিনিট ভিজিট সম্পন্ন হয়েছে। এই পোস্টে ১টি স্টার যোগ হয়েছে এবং পোস্ট ক্রিয়েটর ০.০১ USDT ব্যালেন্স পেয়েছেন!`,
        });
      } catch (err) {
        try {
          const starRef = ref(contentDb, `posts/${postId}/starsCount`);
          await runTransaction(starRef, (current) => (Number(current) || 0) + 1);
          setFeedback({
            type: "success",
            title: "স্টার যুক্ত হয়েছে! ⭐",
            message: `🎉 অভিনন্দন! সফলভাবে ১ মিনিট ভিজিট সম্পন্ন হয়েছে। ১টি স্টার যোগ হয়েছে এবং ০.০১ USDT ব্যালেন্স ক্রিয়েটরের অ্যাকাউন্টে জমা হয়েছে।`,
          });
        } catch {
          setFeedback({
            type: "error",
            title: "ত্রুটি হয়েছে",
            message: "স্টার যোগ করতে সমস্যা হয়েছে, অনুগ্রহ করে আবার চেষ্টা করুন।",
          });
        }
      }
    },
    []
  );

  const verifySession = useCallback(() => {
    if (!activeSession) return;
    const elapsed = Math.floor((Date.now() - activeSession.startedAt) / 1000);

    if (elapsed < MIN_STAR_SECONDS) {
      const diff = MIN_STAR_SECONDS - elapsed;
      setWarningMessage(`১ মিনিট শেষ হতে আরো ${diff} সেকেন্ড বাকি!`);
      setFeedback({
        type: "error",
        title: "১ মিনিট পূর্ণ হয়নি! ⚠️",
        message: `কমপক্ষে ১ মিনিট সাইটে থাকতে হবে! আপনি মাত্র ${elapsed} সেকেন্ড ছিলেন। সময়ের আগে ফিরে আসায় স্টার যোগ হয়নি (আরো ${diff} সেকেন্ড সাইটে থাকুন)।`,
      });
      return;
    }

    if (elapsed > MAX_STAR_SECONDS) {
      setActiveSession(null);
      setWarningMessage("");
      setFeedback({
        type: "error",
        title: "সময় শেষ হয়ে গেছে! ⚠️",
        message: `৬ মিনিট পার হয়ে গেছে! ৬ মিনিটের মধ্যে ফিরে না আসায় স্টার যুক্ত হয়নি। অনুগ্রহ করে নতুন করে চেষ্টা করুন।`,
      });
      return;
    }

    const { postId, authorId } = activeSession;
    setActiveSession(null);
    setWarningMessage("");
    awardStar(postId, authorId);
  }, [activeSession, awardStar]);

  const cancelSession = useCallback(() => {
    setActiveSession(null);
    setWarningMessage("");
  }, []);

  const reopenAdLink = useCallback(() => {
    const tg = (window as unknown as { Telegram?: { WebApp?: { openLink?: (url: string) => void } } })?.Telegram;
    if (tg?.WebApp?.openLink) {
      tg.WebApp.openLink(starAdUrl);
    } else {
      window.open(starAdUrl, "_blank", "noopener,noreferrer");
    }
  }, [starAdUrl]);

  // Security Verification when user refocuses or returns to the PhotoCash tab
  useEffect(() => {
    if (!activeSession) return;

    const handleReturn = () => {
      if (!activeSession) return;
      const elapsed = Math.floor((Date.now() - activeSession.startedAt) / 1000);

      // Grace period: ignore events firing within the first 2 seconds (initial browser tab spawn)
      if (elapsed < 2) {
        return;
      }

      // If user came back before 1 minute (60s): Alert them, do NOT award star
      if (elapsed < MIN_STAR_SECONDS) {
        const diff = MIN_STAR_SECONDS - elapsed;
        setWarningMessage(`১ মিনিট পূর্ণ হয়নি! আরো ${diff} সেকেন্ড সাইটে থাকুন।`);
        setFeedback({
          type: "error",
          title: "১ মিনিট পূর্ণ হয়নি! ⚠️",
          message: `কমপক্ষে ১ মিনিট সাইটে থাকতে হবে! আপনি মাত্র ${elapsed} সেকেন্ড ছিলেন। সময়ের আগে ফিরে আসায় স্টার যোগ হয়নি। আরো ${diff} সেকেন্ড সাইটে থাকতে হবে।`,
        });
        return;
      }

      // If user took more than 6 minutes (360s): Expire session, do NOT award star
      if (elapsed > MAX_STAR_SECONDS) {
        setActiveSession(null);
        setWarningMessage("");
        setFeedback({
          type: "error",
          title: "সময় শেষ হয়ে গেছে! ⚠️",
          message: `৬ মিনিট পার হয়ে গেছে! সময়মতো ফিরে না আসায় স্টার যুক্ত হয়নি।`,
        });
        return;
      }

      // Between 1 minute (60s) and 6 minutes (360s): Automatically verify and award star!
      const { postId, authorId } = activeSession;
      setActiveSession(null);
      setWarningMessage("");
      awardStar(postId, authorId);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        handleReturn();
      }
    };

    window.addEventListener("focus", handleReturn);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleReturn);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [activeSession, awardStar]);

  const startStarSession = useCallback(
    (postId: string, authorName?: string, authorId?: string) => {
      const now = Date.now();
      const newSession: StarSession = {
        postId,
        authorName,
        authorId,
        startedAt: now,
      };

      setActiveSession(newSession);
      setRemainingSec(MIN_STAR_SECONDS);
      setWarningMessage("");

      // Open external ad network link
      const tg = (window as unknown as { Telegram?: { WebApp?: { openLink?: (url: string) => void } } })?.Telegram;
      if (tg?.WebApp?.openLink) {
        tg.WebApp.openLink(starAdUrl);
      } else {
        window.open(starAdUrl, "_blank", "noopener,noreferrer");
      }
    },
    [starAdUrl]
  );

  return (
    <StarRewardContext.Provider
      value={{
        startStarSession,
        activeSession,
        cancelSession,
        verifySession,
        reopenAdLink,
      }}
    >
      {children}

      {/* Floating Active Star Session Banner */}
      {activeSession && (
        <div className="fixed bottom-16 left-0 right-0 z-50 mx-auto max-w-[420px] px-3 transition-all animate-in fade-in slide-in-from-bottom-4">
          <div className="flex flex-col gap-2 rounded-2xl border-2 border-amber-400 bg-[#121214]/95 p-3 shadow-2xl backdrop-blur-md text-white">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 to-yellow-400 text-white shadow-md">
                  <Sparkles size={20} className={remainingSec > 0 ? "animate-spin text-white duration-1000" : "text-white"} />
                  <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-black text-[9px] font-black text-amber-300 border border-amber-400">
                    {remainingSec}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-bold text-white flex items-center gap-1">
                    <span>⭐ স্টার রিওয়ার্ড চলছে</span>
                    <span className="rounded bg-amber-500/20 px-1 py-0.2 text-[10px] text-amber-300 font-mono">
                      +0.01 USDT
                    </span>
                  </p>
                  <p className="truncate text-[10px] text-white/60">
                    {remainingSec > 0
                      ? `সাইটে কমপক্ষে আরো ${remainingSec} সেকেন্ড থাকুন (১ মিনিট)`
                      : "১ মিনিট পূর্ণ হয়েছে! স্টার সংগ্রহ করুন"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {remainingSec > 0 ? (
                  <button
                    type="button"
                    onClick={reopenAdLink}
                    className="flex items-center gap-1 rounded-full bg-amber-500 px-2.5 py-1.5 text-[10px] font-bold text-black shadow-sm hover:bg-amber-400 active:scale-95"
                  >
                    <span>সাইটে যান</span>
                    <ExternalLink size={11} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={verifySession}
                    className="flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1.5 text-[11px] font-bold text-white shadow-md hover:bg-emerald-600 animate-pulse active:scale-95"
                  >
                    <span>⭐ স্টার নিন</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={cancelSession}
                  className="p-1 text-white/60 hover:text-white"
                  title="বন্ধ করুন"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {warningMessage && (
              <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 text-[11px] font-medium text-amber-300">
                <AlertTriangle size={13} className="shrink-0 text-amber-400" />
                <span>{warningMessage}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Result Feedback Modal / Toast */}
      {feedback && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#16161a] p-5 text-center shadow-2xl text-white animate-in zoom-in-95">
            <div
              className={`mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl ${
                feedback.type === "success"
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                  : "bg-rose-500/20 text-rose-400 border border-rose-500/40"
              }`}
            >
              {feedback.type === "success" ? (
                <CheckCircle2 size={32} />
              ) : (
                <AlertTriangle size={32} />
              )}
            </div>

            <h3 className="text-[17px] font-bold text-white">{feedback.title}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-white/70">
              {feedback.message}
            </p>

            <button
              type="button"
              onClick={() => setFeedback(null)}
              className={`mt-4 w-full rounded-full py-2.5 text-[14px] font-bold text-white shadow-md transition ${
                feedback.type === "success"
                  ? "bg-emerald-600 hover:bg-emerald-500 active:scale-95"
                  : "bg-rose-600 hover:bg-rose-500 active:scale-95"
              }`}
            >
              ঠিক আছে
            </button>
          </div>
        </div>
      )}
    </StarRewardContext.Provider>
  );
}

export function useStarReward() {
  const context = useContext(StarRewardContext);
  if (!context) {
    throw new Error("useStarReward must be used within a StarRewardProvider");
  }
  return context;
}
