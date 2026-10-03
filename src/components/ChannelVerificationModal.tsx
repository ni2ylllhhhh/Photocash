import React, { useState, useEffect, useCallback, useRef } from "react";
import { useUser } from "../context/UserContext";
import { useSettings } from "../context/SettingsContext";
import { APP_LOGO_URL, RequiredChannel } from "../types";
import {
  extractTelegramUsername,
  checkChannelMembership,
} from "../utils/telegramVerification";
import { CheckCircle2, Crown, RefreshCw, AlertCircle, Sparkles, ExternalLink } from "lucide-react";

export function ChannelVerificationModal() {
  const { user, updateUser } = useUser();
  const { settings, loading: settingsLoading } = useSettings();

  const [isOpen, setIsOpen] = useState(false);
  const [joinedMap, setJoinedMap] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [justCompleted, setJustCompleted] = useState(false);

  const checkingRef = useRef<boolean>(false);
  const hasInitialCheckedRef = useRef<boolean>(false);
  const forceJoin = Boolean(settings.forceChannelJoin);

  const channels: RequiredChannel[] =
    settings.requiredChannels && settings.requiredChannels.length > 0
      ? settings.requiredChannels
      : [
          {
            name: "Main Channel",
            username: "jgjghjghh687",
            url: "https://t.me/jgjghjghh687",
          },
          {
            name: "Support Channel",
            username: "Earning_Money_Lob",
            url: "https://t.me/Earning_Money_Lob",
          },
        ];

  // Purge any old fake local verifications on mount so every user starts clean
  useEffect(() => {
    try {
      channels.forEach((ch) => {
        const u = extractTelegramUsername(ch.username || ch.url);
        localStorage.removeItem(`pc_verified_${u}`);
        sessionStorage.removeItem(`pc_verified_${u}`);
      });
    } catch {}
  }, []);

  // Live Check with the Telegram Bot
  const runLiveCheck = useCallback(async (interactive = false) => {
    if (!user || checkingRef.current || !forceJoin) return;
    checkingRef.current = true;
    setChecking(true);
    if (interactive) setStatusMessage("🤖 বট দিয়ে মেম্বারশিপ যাচাই করা হচ্ছে...");

    try {
      const botToken = settings.botToken || "8738784866:AAFk8eHwv2xuswJTCBxGcvKAwZuUJHq4bK0";
      const newMap: Record<string, boolean> = {};
      let allJoined = true;

      for (const ch of channels) {
        const u = extractTelegramUsername(ch.username || ch.url);
        const result = await checkChannelMembership(botToken, ch, user.id);
        newMap[u] = result.joined;
        if (!result.joined) allJoined = false;
      }

      setJoinedMap(newMap);

      if (allJoined) {
        setStatusMessage("🎉 অভিনন্দন! সব চ্যানেল যাচাই সম্পন্ন হয়েছে!");
        setJustCompleted(true);
        if (!user.channelsVerified) {
          await updateUser({
            channelsVerified: true,
            channelsVerifiedAt: Date.now(),
          });
        }

        setTimeout(() => {
          setIsOpen(false);
          setJustCompleted(false);
          setStatusMessage(null);
        }, 1300);
      } else {
        // User is missing one or more channels!
        // Immediately lock the website and set channelsVerified: false
        setIsOpen(true);
        if (user.channelsVerified) {
          await updateUser({
            channelsVerified: false,
          });
        }
        if (interactive) {
          setStatusMessage("❌ আপনি এখনো সব চ্যানেলে জয়েন করেননি! দয়া করে চ্যানেলে জয়েন করুন।");
        } else {
          setStatusMessage("⚠️ চ্যানেল ভেরিফিকেশন প্রয়োজন। দয়া করে চ্যানেলে জয়েন করুন।");
        }
      }
    } catch (err) {
      console.error("Live check error:", err);
      if (interactive) setStatusMessage("যাচাই করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।");
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, [user, channels, updateUser, settings.botToken, forceJoin]);

  // Listen for open event anywhere in the app (only opens if forceJoin is enabled)
  useEffect(() => {
    const handleOpen = () => {
      if (!forceJoin) return;
      setIsOpen(true);
      runLiveCheck(true);
    };
    window.addEventListener("open-channel-modal", handleOpen);
    return () => window.removeEventListener("open-channel-modal", handleOpen);
  }, [forceJoin, runLiveCheck]);

  // 1. Run live check EVERY TIME user enters the website (Mount / Initial Load)
  useEffect(() => {
    if (settingsLoading) return;
    if (!forceJoin) {
      setIsOpen(false);
      return;
    }

    if (!user) return;

    // If user is not verified, show modal immediately while checking
    if (!user.channelsVerified) {
      setIsOpen(true);
    }

    // Always run live check on website entry!
    if (!hasInitialCheckedRef.current) {
      hasInitialCheckedRef.current = true;
      runLiveCheck(false);
    }
  }, [user?.id, forceJoin, settingsLoading, runLiveCheck]);

  // 2. Periodic background verification + on focus / visibility change
  // Re-verifies every time user switches back to the tab or every 25 seconds
  useEffect(() => {
    if (!forceJoin || !user) return;

    const interval = setInterval(() => {
      runLiveCheck(false);
    }, isOpen ? 5000 : 25000);

    const handleFocus = () => runLiveCheck(false);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        runLiveCheck(false);
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isOpen, user, forceJoin, runLiveCheck]);

  // Handle clicking "Join Channel" -> Opens Telegram channel (does NOT fake verified!)
  const handleJoin = (channel: RequiredChannel) => {
    setStatusMessage("📢 চ্যানেলে জয়েন করার পর নিচের 'বট দিয়ে যাচাই করুন' বাটনে চাপুন।");

    const tg = (
      window as unknown as {
        Telegram?: {
          WebApp?: {
            openTelegramLink?: (url: string) => void;
            openLink?: (url: string) => void;
          };
        };
      }
    )?.Telegram;

    if (tg?.WebApp?.openTelegramLink) {
      tg.WebApp.openTelegramLink(channel.url);
    } else if (tg?.WebApp?.openLink) {
      tg.WebApp.openLink(channel.url);
    } else {
      const win = window.open(channel.url, "_blank", "noopener,noreferrer");
      if (!win) {
        window.location.href = channel.url;
      }
    }
  };

  // Unlock Website / Verify Button Click
  const handleUnlockWebsite = async () => {
    const allJoined = channels.every((ch) => {
      const u = extractTelegramUsername(ch.username || ch.url);
      return joinedMap[u] === true;
    });

    if (allJoined) {
      setJustCompleted(true);
      await updateUser({
        channelsVerified: true,
        channelsVerifiedAt: Date.now(),
      });
      setTimeout(() => {
        setIsOpen(false);
        setJustCompleted(false);
      }, 1200);
    } else {
      // Trigger live check with the bot
      runLiveCheck(true);
    }
  };

  if (settingsLoading || !forceJoin || !isOpen) return null;

  const allChannelsJoined = channels.every((ch) => {
    const u = extractTelegramUsername(ch.username || ch.url);
    return joinedMap[u] === true;
  });

  return (
    /* 
      Transparent Overlay:
      - Clean transparent background so the website remains visible behind the modal.
    */
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-3 animate-in fade-in duration-200">
      <div className="relative w-full max-w-[340px] sm:max-w-[350px] select-none">
        {/* Outer Red Ambient Glow */}
        <div className="pointer-events-none absolute -inset-2 rounded-[36px] bg-red-600/30 blur-xl" />

        {/* Outer Chamfered Container Frame */}
        <div className="relative overflow-visible rounded-[26px] border-2 border-[#ff1e2e] bg-[#0c0a10] px-3.5 pb-3.5 pt-9 shadow-[0_12px_45px_rgba(0,0,0,0.8),0_0_30px_rgba(255,20,40,0.55),inset_0_0_20px_rgba(200,10,30,0.35)]">
          {/* Subtle Chamfer Corner Bevel Overlays */}
          <div className="pointer-events-none absolute -top-[2px] -left-[2px] h-3 w-3 border-t-2 border-l-2 border-red-400 rounded-tl-lg" />
          <div className="pointer-events-none absolute -top-[2px] -right-[2px] h-3 w-3 border-t-2 border-r-2 border-red-400 rounded-tr-lg" />
          <div className="pointer-events-none absolute -bottom-[2px] -left-[2px] h-3 w-3 border-b-2 border-l-2 border-red-400 rounded-bl-lg" />
          <div className="pointer-events-none absolute -bottom-[2px] -right-[2px] h-3 w-3 border-b-2 border-r-2 border-red-400 rounded-br-lg" />

          {/* Top Center Overflowing Medallion (PhotoCash Logo + Crown) */}
          <div className="absolute -top-11 left-1/2 -translate-x-1/2 flex flex-col items-center z-20">
            {/* Golden Crown */}
            <div className="relative -mb-2 z-10 text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.9)] animate-pulse">
              <Crown size={22} fill="#f59e0b" stroke="#78350f" strokeWidth={1.5} />
            </div>

            {/* Glowing Red Circle Crest */}
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full border-2 border-[#ff2a3b] bg-black p-0.5 shadow-[0_0_22px_rgba(255,30,50,0.95),inset_0_0_10px_rgba(255,0,30,0.6)]">
              <img
                src={APP_LOGO_URL}
                alt="PhotoCash"
                className="h-full w-full rounded-full object-cover"
              />
            </div>
          </div>

          {/* Heading Section: 3D Paper Plane + "Join Our" + "Telegram Channels" */}
          <div className="mt-1 flex flex-col items-center text-center">
            <div className="flex items-center justify-center gap-1.5">
              <div className="relative -rotate-12 drop-shadow-[0_2px_6px_rgba(255,0,0,0.8)]">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M21.5 2.5L2 10.5L9.5 14.5L13.5 21.5L21.5 2.5Z"
                    fill="url(#red_plane_gradient)"
                  />
                  <path
                    d="M21.5 2.5L9.5 14.5L13.5 21.5L21.5 2.5Z"
                    fill="#b91c1c"
                  />
                  <path
                    d="M9.5 14.5L21.5 2.5L12 12L9.5 14.5Z"
                    fill="#fca5a5"
                  />
                  <defs>
                    <linearGradient
                      id="red_plane_gradient"
                      x1="2"
                      y1="2.5"
                      x2="21.5"
                      y2="21.5"
                      gradientUnits="userSpaceOnUse"
                    >
                      <stop stopColor="#ff4d4d" />
                      <stop offset="0.6" stopColor="#dc2626" />
                      <stop offset="1" stopColor="#991b1b" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>

              <h2
                className="text-[19px] font-black tracking-wide text-white"
                style={{
                  textShadow:
                    "0 1px 1px #999, 0 2px 2px #555, 0 3px 5px rgba(0,0,0,0.9)",
                }}
              >
                Join Our
              </h2>
            </div>

            <h1
              className="mt-0 text-[21px] font-black uppercase tracking-tight"
              style={{
                background: "linear-gradient(180deg, #ff4d4d 0%, #dc2626 50%, #991b1b 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                filter:
                  "drop-shadow(0 2px 0 #7f1d1d) drop-shadow(0 3px 1px #450a0a) drop-shadow(0 0 12px rgba(239,68,68,0.8))",
              }}
            >
              Telegram Channels
            </h1>
            <p className="mt-0.5 text-[10px] text-zinc-300 font-medium">
              চ্যানেলে জয়েন করে নিচের বাটন দিয়ে ভেরিফাই করুন
            </p>
          </div>

          {/* 2 Channel Boxes (Side-by-side) with Live Bot Verification Status */}
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            {channels.slice(0, 2).map((ch, idx) => {
              const u = extractTelegramUsername(ch.username || ch.url);
              const isJoined = Boolean(joinedMap[u]);
              const isFirst = idx === 0;

              const titleMain = isFirst ? "Main" : "Support";
              const titleSec = "Channel";
              const subtitle = isFirst
                ? "All Videos • Updates • News"
                : "Help • Support • Updates";

              return (
                <div
                  key={ch.url}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleJoin(ch)}
                  className={`group relative flex flex-col justify-between rounded-xl border bg-[#120f18] p-2 transition-all duration-200 cursor-pointer active:scale-95 select-none ${
                    isJoined
                      ? "border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.45)] hover:border-emerald-400"
                      : "border-[#e11d48]/80 shadow-[0_0_10px_rgba(225,29,72,0.3)] hover:border-red-400 hover:shadow-[0_0_15px_rgba(255,40,70,0.5)]"
                  }`}
                  title={`Click to open ${ch.name}`}
                >
                  <div>
                    {/* Top Row: Circular Red Telegram Orb + Title */}
                    <div className="flex items-center gap-1.5">
                      <div className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-[#7f1d1d] via-[#dc2626] to-[#f87171] border border-red-300/40 shadow-[0_2px_5px_rgba(220,38,38,0.7)] group-hover:scale-105 transition-transform">
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="white"
                          className="-rotate-6 ml-0.5"
                        >
                          <path d="M21.5 2.5L2 10.5L9.5 14.5L13.5 21.5L21.5 2.5Z" />
                        </svg>
                      </div>

                      <div className="min-w-0">
                        <h3 className="text-[11px] font-black text-white leading-tight group-hover:text-red-200 transition-colors">
                          {titleMain}{" "}
                          <span className="text-[#ff3b4b]">{titleSec}</span>
                        </h3>
                      </div>
                    </div>

                    <p className="mt-1 text-[8px] text-white/60 leading-tight">
                      {subtitle}
                    </p>
                  </div>

                  {/* Channel Status and Join/Verified Pill Button */}
                  <div className="mt-2 space-y-1">
                    {isJoined ? (
                      <div className="flex w-full items-center justify-center gap-1 rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 py-1 text-[9.5px] font-black text-white shadow-[0_0_8px_rgba(16,185,129,0.7)]">
                        <CheckCircle2 size={11} />
                        <span>✓ Verified</span>
                      </div>
                    ) : (
                      <div className="flex w-full items-center justify-center gap-1 rounded-full bg-gradient-to-b from-[#ff3b4b] via-[#dc2626] to-[#991b1b] border border-red-300/40 py-1 text-[9.5px] font-black text-white shadow-[0_2px_8px_rgba(220,38,38,0.8)] group-hover:brightness-115 transition">
                        <ExternalLink size={10} />
                        <span>Join Channel</span>
                        <span>→</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Interactive "বট দিয়ে যাচাই ও ওয়েবসাইট আনলক" (Verify with Bot & Unlock) Button */}
          <div className="mt-3">
            <button
              type="button"
              onClick={handleUnlockWebsite}
              disabled={checking}
              className={`flex w-full items-center justify-center gap-1.5 rounded-xl py-2 px-3 text-[12px] font-black transition active:scale-[0.98] cursor-pointer shadow-lg ${
                allChannelsJoined
                  ? "bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 text-white shadow-[0_0_18px_rgba(16,185,129,0.8)] hover:brightness-110 animate-pulse"
                  : "bg-gradient-to-r from-red-600 via-rose-600 to-red-700 text-white shadow-[0_0_14px_rgba(225,29,72,0.6)] hover:brightness-110"
              }`}
            >
              {checking ? (
                <>
                  <RefreshCw size={14} className="animate-spin text-white" />
                  <span>বট যাচাই করছে...</span>
                </>
              ) : allChannelsJoined ? (
                <>
                  <Sparkles size={14} className="text-yellow-200" />
                  <span>🎉 ভেরিফাইড — ওয়েবসাইট আনলক করুন 🔓</span>
                </>
              ) : (
                <>
                  <RefreshCw size={13} className="text-white" />
                  <span>🔍 বট দিয়ে যাচাই করুন (Verify Channels)</span>
                </>
              )}
            </button>
          </div>

          {/* Feedback/Status message */}
          {statusMessage && (
            <div className={`mt-2 flex items-center justify-center gap-1 rounded-lg py-1 px-2 text-[10px] font-bold ${
              statusMessage.includes("🎉")
                ? "bg-emerald-950/90 border border-emerald-500/60 text-emerald-300"
                : "bg-red-950/90 border border-red-500/60 text-red-300"
            }`}>
              {statusMessage.includes("🎉") ? (
                <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle size={12} className="text-red-400 shrink-0" />
              )}
              <span className="leading-tight">{statusMessage}</span>
            </div>
          )}

          {/* Bottom "(( 🔔 )) Don’t miss any update!" */}
          <div className="mt-2.5 flex items-center justify-center gap-1.5 text-[9.5px] font-semibold text-white/90">
            <div className="flex items-center gap-0.5 text-red-500 animate-pulse">
              <span className="text-[11px] font-bold">((</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-[#ff2a3b] drop-shadow-[0_0_6px_rgba(255,40,60,0.8)]"
              >
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" fill="#dc2626" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
              <span className="text-[11px] font-bold">))</span>
            </div>
            <span>
              Don’t miss any{" "}
              <span className="font-black text-[#ff2a3b]">update!</span>
            </span>
          </div>

          {/* Celebration banner */}
          {justCompleted && (
            <div className="mt-2 flex items-center justify-center gap-1 rounded-xl border border-emerald-500/70 bg-emerald-950/90 py-1.5 px-2 text-[10.5px] font-bold text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.7)] animate-in fade-in">
              <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
              <span>ওয়েবসাইট সফলভাবে আনলক হয়েছে! স্বাগতম...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
