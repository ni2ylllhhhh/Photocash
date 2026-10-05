import { useState, useEffect } from "react";
import { ref, onValue } from "firebase/database";
import { userDb } from "../firebase";
import { useUser } from "../context/UserContext";
import { useSettings } from "../context/SettingsContext";
import { LayoutShell } from "../components/Navigation";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { formatUSDT, formatTimeAgo, openExternalLink } from "../utils";
import { REFER_BANNER_URL } from "../types";
import { Check, Copy, Send, CheckCircle2 } from "lucide-react";

interface ReferralItem {
  id: string;
  name: string;
  photo: string;
  username?: string;
  joinedAt: number;
}

export function ReferPage() {
  const { user } = useUser();
  const { settings } = useSettings();
  const [referrals, setReferrals] = useState<ReferralItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "level1">("overview");

  useEffect(() => {
    if (!user) return;
    const refPath = ref(userDb, `referrals/${user.id}`);
    const unsubscribe = onValue(refPath, (snapshot) => {
      const data = snapshot.val() || {};
      const list: ReferralItem[] = Object.values(data);
      list.sort((a, b) => b.joinedAt - a.joinedAt);
      setReferrals(list);
    });
    return () => unsubscribe();
  }, [user?.id]);

  const botUsername = settings.botUsername || "PhotoCash12_bot";
  // Official Telegram Mini App Direct Link: t.me/<bot>?startapp=<id>
  const referralLink = `https://t.me/${botUsername}?startapp=${user?.id ?? ""}`;

  const totalEarned = (user?.referrals ?? 0) * settings.referBonus;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShareOnTelegram = () => {
    const text = encodeURIComponent("PhotoCash — Earn USDT from photos! Join now 🚀");
    openExternalLink(
      `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${text}`
    );
  };

  return (
    <LayoutShell>
      {/* Toast Notification */}
      {copied && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full bg-slate-900/95 px-4 py-2 text-white shadow-2xl backdrop-blur-md transition-all animate-bounce">
          <CheckCircle2 size={16} className="text-emerald-400" />
          <span className="text-[12px] font-bold tracking-wide">Successfully Copied!</span>
        </div>
      )}

      {/* Seamless Hero Banner - Perfectly integrated into the website header */}
      <div className="relative w-full bg-white overflow-hidden pt-2">
        <img
          src={REFER_BANNER_URL}
          alt="Invite your friend"
          className="w-full h-auto object-contain block select-none"
        />
        {/* Soft bottom edge gradient to seamlessly melt into the content */}
        <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white via-white/70 to-transparent pointer-events-none" />
      </div>

      <div className="px-3 -mt-1 space-y-2 relative z-10">
        {/* 4 Stat Cards: L1 TOTAL, L2 TOTAL, BONUS, EARNED */}
        <section className="grid grid-cols-4 gap-1.5">
          <StatCard
            label="L1 TOTAL"
            value={String(user?.referrals ?? 0)}
            color="text-brand-orange"
          />
          <StatCard
            label="L2 TOTAL"
            value={String(user?.l2Referrals ?? 0)}
            color="text-green-600"
          />
          <StatCard
            label="BONUS"
            value={formatUSDT(settings.referBonus, 2)}
            color="text-blue-600"
          />
          <StatCard
            label="EARNED"
            value={formatUSDT(totalEarned, 2)}
            color="text-purple-600"
          />
        </section>

        <section className="rounded-2xl bg-white p-3 shadow-sm">
          <div className="mb-2 border-b border-line pb-1.5 flex items-center justify-between">
            <span className="text-[12px] font-bold tracking-wide text-blue-600">
              YOUR TELEGRAM REFERRAL LINK
            </span>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
              ⚡ Direct Launch
            </span>
          </div>

          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate rounded-lg border border-line px-2.5 py-2 font-mono text-[11px] text-muted">
              {referralLink}
            </p>
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy referral link"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange text-white active:scale-95"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>

          <p className="mt-2 text-[10px] text-muted leading-relaxed">
            👉 লিংকে ক্লিক করলেই টেলিগ্রামের পপ-আপ আসবে এবং <b>Start</b> চাপলে সরাসরি মিনি অ্যাপস চালু হয়ে যাবে।
          </p>

          <button
            type="button"
            onClick={handleShareOnTelegram}
            className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-full bg-[#2f8fd8] py-2.5 text-[13px] font-bold text-white active:scale-[0.98]"
          >
            <Send size={15} /> Share on Telegram
          </button>
        </section>

        <section className="rounded-2xl bg-white p-3 shadow-sm">
          <div className="mb-2 flex gap-4 border-b border-line">
            {(["overview", "level1"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`pb-1.5 text-[12px] font-bold uppercase tracking-wide ${
                  activeTab === tab
                    ? "border-b-2 border-brand-orange text-brand-orange"
                    : "text-muted"
                }`}
              >
                {tab === "overview" ? "Overview" : `Level 1 (${referrals.length})`}
              </button>
            ))}
          </div>

          {activeTab === "overview" ? (
            <div className="py-3 text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-orange text-[13px] font-bold text-white">
                YOU
              </span>
              <p className="mt-2 text-[12px] text-muted">
                {referrals.length} friend{referrals.length === 1 ? "" : "s"} joined with your link
              </p>
              <p className="mt-1 text-[12px] font-bold text-ink">
                Total direct bonus: {formatUSDT(totalEarned, 2)} USDT
              </p>
            </div>
          ) : referrals.length === 0 ? (
            <p className="py-5 text-center text-[12px] text-muted">No referrals yet.</p>
          ) : (
            <ul className="space-y-2">
              {referrals.map((item) => (
                <li key={item.id} className="flex items-center gap-2">
                  <img
                    src={item.photo}
                    alt=""
                    className="h-8 w-8 rounded-full object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 text-[12px] font-semibold text-ink">
                      <span className="truncate">{item.name}</span>
                      <VerifiedBadge className="h-[13px] w-[13px]" />
                    </p>
                    <p className="text-[10px] text-muted">
                      {item.username ? `@${item.username} • ` : ""}{formatTimeAgo(item.joinedAt)}
                    </p>
                  </div>
                  <span className="text-[12px] font-bold text-green-600">
                    +{formatUSDT(settings.referBonus, 2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </LayoutShell>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-xl bg-white px-1 py-2 text-center shadow-sm">
      <p className={`text-[9px] font-bold tracking-wide ${color}`}>{label}</p>
      <p className="mt-0.5 text-[15px] font-extrabold text-ink">{value}</p>
    </div>
  );
}
