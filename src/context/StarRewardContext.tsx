import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { ref, update, push } from "firebase/database";
import { contentDb, userDb } from "../firebase";
import { useSettings } from "./SettingsContext";
import { useUser } from "./UserContext";
import { defaultSettings } from "../types";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";

export const MIN_STAR_SECONDS = 60; // কমপক্ষে ১ মিনিট (৬০ সেকেন্ড) ওয়েবসাইটে থাকতে হবে
export const MAX_STAR_SECONDS = 360; // সর্বোচ্চ ৬ মিনিট (৩৬০ সেকেন্ড)-এর মধ্যে ব্যাক আসতে হবে
export const STAR_USDT_REWARD = 0.01; // প্রতি ১টি স্টারের দাম 0.01 USDT (যার পোস্ট তার মূল ব্যালেন্সে যোগ হবে)
const SESSION_STORAGE_KEY = "photocash_active_star_session";

const CONTENT_DB_URL = "https://photo-cash-30b8c-default-rtdb.firebaseio.com";
const USER_DB_URL = "https://photo-cash-2-default-rtdb.firebaseio.com";

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

function readSavedStarSession(): StarSession | null {
  try {
    const raw =
      localStorage.getItem(SESSION_STORAGE_KEY) ||
      sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.postId && typeof parsed.startedAt === "number") {
      return parsed;
    }
  } catch {}
  return null;
}

function clearSavedStarSession() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {}
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {}
}

function saveStarSessionToStorage(session: StarSession) {
  const serialized = JSON.stringify(session);
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, serialized);
  } catch {}
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, serialized);
  } catch {}
}

/**
 * Opens the ad URL outside the Telegram Mini App in Chrome / external system browser
 */
function openInExternalBrowser(url: string) {
  try {
    const tg = (window as any)?.Telegram?.WebApp;
    if (tg && typeof tg.openLink === "function") {
      tg.openLink(url, { try_instant_view: false });
      return;
    }
  } catch {}

  try {
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (win) return;
  } catch {}

  try {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch {
    window.location.href = url;
  }
}

export function StarRewardProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const { user } = useUser();

  const [activeSession, setActiveSession] = useState<StarSession | null>(null);
  const [topNotice, setTopNotice] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const isProcessingRef = useRef(false);
  const noticeTimerRef = useRef<number | null>(null);

  const showTopNotice = useCallback((type: "success" | "error", message: string) => {
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
    }
    setTopNotice({ type, message });
    noticeTimerRef.current = window.setTimeout(() => {
      setTopNotice(null);
    }, 5500);
  }, []);

  const starAdUrl =
    settings.starAdLink?.trim() ||
    defaultSettings.starAdLink ||
    "https://ads.ziniyaapu7.workers.dev/";

  // 100% Guaranteed Star Count & +0.01 USDT Post Owner Balance Credit (REST + Firebase SDK)
  const awardStar = useCallback(
    async (postId: string, explicitAuthorId?: string) => {
      showTopNotice(
        "success",
        "⭐ ১টি স্টার যোগ হয়েছে! (+0.01 USDT পোস্টের মূল ব্যালেন্সে যোগ হয়েছে)"
      );

      let authorId = explicitAuthorId || "";

      try {
        const postRes = await fetch(`${CONTENT_DB_URL}/posts/${encodeURIComponent(postId)}.json`);
        const postData = postRes.ok ? await postRes.json() : null;

        if (postData && typeof postData === "object") {
          authorId = authorId || postData.authorId || "";
          const currentStars =
            typeof postData.starsCount === "number"
              ? postData.starsCount
              : typeof postData.stars === "number"
              ? postData.stars
              : postData.stars && typeof postData.stars === "object"
              ? Object.keys(postData.stars).length
              : 0;
          const nextStars = currentStars + 1;

          await fetch(`${CONTENT_DB_URL}/posts/${encodeURIComponent(postId)}.json`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ starsCount: nextStars, stars: nextStars }),
          });

          update(ref(contentDb, `posts/${postId}`), {
            starsCount: nextStars,
            stars: nextStars,
          }).catch(() => {});
        }
      } catch (err) {
        console.error("Error updating post star count:", err);
      }

      // Credit +0.01 USDT strictly to the post owner's (authorId) main balance
      if (authorId) {
        try {
          const userRes = await fetch(`${USER_DB_URL}/users/${encodeURIComponent(authorId)}.json`);
          const authorData = userRes.ok ? await userRes.json() : null;

          if (authorData && typeof authorData === "object") {
            const todayKey = new Date().toISOString().slice(0, 10);
            const currentBal = Number(authorData.balance || 0);
            const currentTotal = Number(authorData.totalEarned || 0);
            const currentToday =
              authorData.todayKey === todayKey ? Number(authorData.todayEarned || 0) : 0;

            const newBal = Number((currentBal + STAR_USDT_REWARD).toFixed(4));
            const newTotal = Number((currentTotal + STAR_USDT_REWARD).toFixed(4));
            const newToday = Number((currentToday + STAR_USDT_REWARD).toFixed(4));

            const updates = {
              balance: newBal,
              totalEarned: newTotal,
              todayEarned: newToday,
              todayKey,
            };

            await fetch(`${USER_DB_URL}/users/${encodeURIComponent(authorId)}.json`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(updates),
            });

            update(ref(userDb, `users/${authorId}`), updates).catch(() => {});

            const historyEntry = {
              type: "star_reward",
              amount: STAR_USDT_REWARD,
              note:
                user?.id === authorId
                  ? `নিজের পোস্টে স্টার বোনাস (+0.01 USDT)`
                  : `পোস্টে স্টার বোনাস (+0.01 USDT)`,
              createdAt: Date.now(),
            };

            await fetch(`${USER_DB_URL}/users/${encodeURIComponent(authorId)}/history.json`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(historyEntry),
            });

            push(ref(userDb, `users/${authorId}/history`), historyEntry).catch(() => {});
          }
        } catch (err) {
          console.error("Error crediting author star bonus:", err);
        }
      }
    },
    [showTopNotice, user?.id]
  );

  // Evaluate when the user comes back from Chrome / external browser to the Mini App
  const evaluateReturn = useCallback(() => {
    if (isProcessingRef.current) return;

    const session = readSavedStarSession();
    if (!session) return;

    const elapsed = Math.floor((Date.now() - session.startedAt) / 1000);

    // 3-second grace period while Chrome / external browser is launching
    if (elapsed < 3) return;

    // Immediately consume the session so it only triggers once per Star click
    isProcessingRef.current = true;
    clearSavedStarSession();
    setActiveSession(null);

    // If user came back BEFORE 1 minute (60s) OR AFTER 6 minutes (360s) -> Do NOT add Star, show small top notice!
    if (elapsed < MIN_STAR_SECONDS || elapsed > MAX_STAR_SECONDS) {
      showTopNotice(
        "error",
        "আপনার স্টার যোগ হয় নাই! ওয়েবসাইটে ১ মিনিট থাকতে হবে এবং ৬ মিনিটের মধ্যে ব্যাক আসতে হবে।"
      );
      setTimeout(() => {
        isProcessingRef.current = false;
      }, 500);
      return;
    }

    // Stayed >= 1 minute (60s) AND <= 6 minutes (360s) -> 100% Count Star & +0.01 USDT!
    awardStar(session.postId, session.authorId).finally(() => {
      setTimeout(() => {
        isProcessingRef.current = false;
      }, 500);
    });
  }, [awardStar, showTopNotice]);

  useEffect(() => {
    evaluateReturn();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        evaluateReturn();
      }
    };

    const onReturnEvent = () => {
      if (document.visibilityState === "visible") {
        evaluateReturn();
      }
    };

    window.addEventListener("pageshow", onReturnEvent);
    window.addEventListener("focus", onReturnEvent);
    window.addEventListener("pointerdown", onReturnEvent);
    window.addEventListener("touchstart", onReturnEvent);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("pageshow", onReturnEvent);
      window.removeEventListener("focus", onReturnEvent);
      window.removeEventListener("pointerdown", onReturnEvent);
      window.removeEventListener("touchstart", onReturnEvent);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [evaluateReturn]);

  // Clicking Star opens https://ads.ziniyaapu7.workers.dev/ outside the Mini App in Chrome / external browser
  const startStarSession = useCallback(
    (postId: string, authorName?: string, authorId?: string) => {
      const newSession: StarSession = {
        postId,
        authorName,
        authorId,
        startedAt: Date.now(),
      };

      saveStarSessionToStorage(newSession);
      setActiveSession(newSession);

      // Open outside Mini Web App in Chrome / external browser
      openInExternalBrowser(starAdUrl);
    },
    [starAdUrl]
  );

  const cancelSession = useCallback(() => {
    clearSavedStarSession();
    setActiveSession(null);
  }, []);

  const verifySession = useCallback(() => {
    evaluateReturn();
  }, [evaluateReturn]);

  const reopenAdLink = useCallback(() => {
    openInExternalBrowser(starAdUrl);
  }, [starAdUrl]);

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

      {/* Compact Top Notification Banner */}
      {topNotice && (
        <div className="fixed top-2.5 left-0 right-0 z-[9999] mx-auto max-w-[400px] px-3 pointer-events-auto">
          <div
            className={`flex items-center justify-between gap-2.5 rounded-2xl px-3.5 py-2.5 shadow-xl border backdrop-blur-md transition-all ${
              topNotice.type === "success"
                ? "bg-emerald-600/95 border-emerald-400/50 text-white"
                : "bg-rose-600/95 border-rose-400/50 text-white"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {topNotice.type === "success" ? (
                <CheckCircle2 size={18} className="shrink-0 text-white" />
              ) : (
                <AlertTriangle size={18} className="shrink-0 text-amber-200" />
              )}
              <p className="text-[12px] font-bold leading-snug">
                {topNotice.message}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setTopNotice(null)}
              aria-label="Close"
              className="shrink-0 rounded-full bg-black/20 p-1 text-white/90 hover:bg-black/30"
            >
              <X size={13} />
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
