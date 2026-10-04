import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ref, onValue } from "firebase/database";
import { userDb } from "../firebase";
import { Withdrawal } from "../types";
import { useUser } from "../context/UserContext";
import { useSettings } from "../context/SettingsContext";
import { LayoutShell } from "../components/Navigation";
import { formatUSDT, openExternalLink } from "../utils";
import {
  ArrowLeft,
  ChevronDown,
  Wallet,
  History,
  TrendingUp,
  Users,
  Headphones,
  MessageSquare,
  Clock,
} from "lucide-react";

const SUBSEQUENT_WITHDRAW_REFERRALS = 5;

export function WalletPage() {
  const navigate = useNavigate();
  const { user } = useUser();
  const { settings } = useSettings();
  const [validWithdrawCount, setValidWithdrawCount] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    const wRef = ref(userDb, "withdrawals");
    const unsubscribe = onValue(wRef, (snap) => {
      const data = snap.val() || {};
      const list: Withdrawal[] = Object.values(data);
      const count = list.filter(
        (w) => w.uid === user.id && w.status !== "rejected"
      ).length;
      setValidWithdrawCount(count);
    });
    return () => unsubscribe();
  }, [user?.id]);

  const balance = user?.balance ?? 0;
  const referrals = user?.referrals ?? 0;

  const firstMinRefs = settings.minReferrals || 15;
  const isFirstWithdraw = validWithdrawCount === 0;
  const requiredTotalReferrals = isFirstWithdraw
    ? firstMinRefs
    : firstMinRefs + validWithdrawCount * SUBSEQUENT_WITHDRAW_REFERRALS;
  const neededReferrals = Math.max(0, requiredTotalReferrals - referrals);

  return (
    <LayoutShell className="px-3 pt-3">
      <header className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate("/")}
          aria-label="Back"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-[17px] font-extrabold text-ink">Wallet</h1>
        <span className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[12px] font-bold text-ink">
          USDT <ChevronDown size={13} />
        </span>
      </header>

      <section className="rounded-2xl bg-white px-4 py-4 text-center">
        <p className="text-[13px] font-semibold text-muted">Total Earnings</p>
        <p className="mt-0.5 text-[34px] font-extrabold leading-tight text-ink">
          {formatUSDT(balance)}
        </p>
        <p className="text-[11px] text-muted">
          Lifetime {formatUSDT(user?.totalEarned ?? 0)}
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => navigate("/cashout")}
            className="brand-grad flex items-center justify-center gap-1.5 rounded-full py-2 text-[13px] font-bold text-white active:scale-[0.98]"
          >
            <Wallet size={15} /> Cash Out
          </button>
          <button
            type="button"
            onClick={() => navigate("/payments")}
            className="flex items-center justify-center gap-1.5 rounded-full bg-canvas py-2 text-[13px] font-bold text-ink active:scale-[0.98]"
          >
            <History size={15} /> Payments
          </button>
        </div>
      </section>

      <section className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-white p-3">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-muted">Today's earnings</p>
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-canvas text-brand-orange">
              <TrendingUp size={13} />
            </span>
          </div>
          <p className="mt-1.5 text-[20px] font-extrabold text-ink">
            {formatUSDT(user?.todayEarned ?? 0)}
          </p>
          <p className="text-[10px] text-muted">{user?.postCount ?? 0} earning posts</p>
        </div>

        <div className="rounded-2xl bg-white p-3">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-muted">Total Refar</p>
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-canvas text-brand-pink">
              <Users size={13} />
            </span>
          </div>
          <p className="mt-1.5 text-[20px] font-extrabold text-ink">
            👥 {referrals}
          </p>
          <p className="text-[10px] text-muted">
            {neededReferrals > 0
              ? `${neededReferrals} more needed`
              : "Requirement complete ✅"}
          </p>
        </div>
      </section>

      <div className="mt-2 rounded-2xl border border-brand-pink/30 bg-brand-pink/5 p-3">
        {isFirstWithdraw ? (
          <p className="text-[12px] font-bold text-brand-pink">
            🚨 প্রথমবার {firstMinRefs} রেফার না করলে withdraw হবে না
          </p>
        ) : (
          <p className="text-[12px] font-bold text-brand-pink">
            🚨 পরবর্তী withdraw করতে মাত্র {SUBSEQUENT_WITHDRAW_REFERRALS} টি করে রেফার প্রয়োজন
          </p>
        )}
      </div>

      <h2 className="mb-1.5 mt-4 text-[16px] font-extrabold text-ink">Support</h2>
      <section className="rounded-2xl bg-white p-3">
        <div className="flex items-center gap-2.5">
          <span className="brand-grad flex h-10 w-10 items-center justify-center rounded-full text-white">
            <Headphones size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold text-ink">Chat with support</p>
            <p className="text-[11px] text-muted">Withdrawals • balance • account</p>
          </div>
          <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-bold text-green-600">
            🟢 Online
          </span>
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => openExternalLink(settings.supportLink)}
            className="flex items-center justify-center gap-1.5 rounded-full bg-canvas py-2 text-[12px] font-semibold text-ink"
          >
            <MessageSquare size={13} /> Live agent
          </button>
          <button
            type="button"
            onClick={() => openExternalLink(settings.supportLink)}
            className="flex items-center justify-center gap-1.5 rounded-full bg-canvas py-2 text-[12px] font-semibold text-ink"
          >
            <Clock size={13} /> Quick replies
          </button>
        </div>

        <button
          type="button"
          onClick={() => openExternalLink(settings.supportLink)}
          className="brand-grad mt-2 flex w-full items-center justify-center gap-1.5 rounded-full py-2.5 text-[13px] font-bold text-white active:scale-[0.98]"
        >
          <MessageSquare size={15} /> Telegram Support
        </button>
      </section>
    </LayoutShell>
  );
}
