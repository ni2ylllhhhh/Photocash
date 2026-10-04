import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ref, push, set, runTransaction } from "firebase/database";
import { userDb } from "../firebase";
import { useUser } from "../context/UserContext";
import { useSettings } from "../context/SettingsContext";
import { LayoutShell } from "../components/Navigation";
import { formatUSDT, sendTelegramBotMessage, escapeHtml } from "../utils";
import { resolveBotToken } from "../utils/tokenVault";
import { ArrowLeft, Check, Info, ArrowUpRight } from "lucide-react";
import { User, BKASH_LOGO_URL, NAGAD_LOGO_URL, BINANCE_LOGO_URL } from "../types";

const AMOUNTS = [5, 10, 15, 30, 60, 100];

type PaymentMethod = "bkash" | "nagad" | "binance";

export function BkashLogo({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <img
      src={BKASH_LOGO_URL}
      alt="bKash"
      className={`object-cover rounded-xl shadow-sm ${className}`}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).src = "/assets/bkash.png";
      }}
    />
  );
}

export function NagadLogo({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <img
      src={NAGAD_LOGO_URL}
      alt="Nagad"
      className={`object-cover rounded-xl shadow-sm ${className}`}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).src = "/assets/nagad.jpg";
      }}
    />
  );
}

export function BinanceLogo({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <img
      src={BINANCE_LOGO_URL}
      alt="Binance"
      className={`object-cover rounded-xl shadow-sm ${className}`}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).src = "/assets/binance.png";
      }}
    />
  );
}

const METHODS: {
  id: PaymentMethod;
  name: string;
  label: string;
  placeholder: string;
  helper: string;
  activeColor: string;
  activeBorder: string;
  activeBg: string;
  icon: (cls?: string) => React.ReactNode;
}[] = [
  {
    id: "bkash",
    name: "bKash",
    label: "bKash Number",
    placeholder: "e.g. 01XXXXXXXXX",
    helper: "সঠিক বিকাশ পার্সোনাল নাম্বার দিন",
    activeColor: "text-[#E2136E]",
    activeBorder: "border-[#E2136E]",
    activeBg: "bg-[#E2136E]/10",
    icon: (cls) => <BkashLogo className={cls || "w-7 h-7"} />,
  },
  {
    id: "nagad",
    name: "Nagad",
    label: "Nagad Number",
    placeholder: "e.g. 01XXXXXXXXX",
    helper: "সঠিক নগদ পার্সোনাল নাম্বার দিন",
    activeColor: "text-[#E51A24]",
    activeBorder: "border-[#E51A24]",
    activeBg: "bg-[#E51A24]/10",
    icon: (cls) => <NagadLogo className={cls || "w-7 h-7"} />,
  },
  {
    id: "binance",
    name: "Binance",
    label: "Account Number",
    placeholder: "USDT BEP20 address / Binance ID",
    helper: "সঠিক USDT (BEP20) বা Binance Pay ID দিন",
    activeColor: "text-[#F3BA2F]",
    activeBorder: "border-[#F3BA2F]",
    activeBg: "bg-[#F3BA2F]/10",
    icon: (cls) => <BinanceLogo className={cls || "w-7 h-7"} />,
  },
];

export function CashOutPage() {
  const navigate = useNavigate();
  const { user } = useUser();
  const { settings } = useSettings();

  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>("bkash");
  const [selectedAmount, setSelectedAmount] = useState(settings.minWithdraw);
  const [accountNumber, setAccountNumber] = useState(
    user?.bkashNumber || user?.binanceId || ""
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const balance = user?.balance ?? 0;
  const referrals = user?.referrals ?? 0;

  const currentMethodObj = METHODS.find((m) => m.id === selectedMethod) || METHODS[0];

  const minRequiredReferrals = settings.minReferrals || 15;
  const insufficientBalance = balance < Math.max(selectedAmount, settings.minWithdraw || 5);
  const insufficientReferrals = referrals < minRequiredReferrals;
  const invalidAccount = (() => {
    const clean = accountNumber.trim();
    if (selectedMethod === "bkash" || selectedMethod === "nagad") {
      const digits = clean.replace(/\D/g, "");
      return digits.length < 11;
    }
    return clean.length < 6;
  })();

  const cannotWithdraw = insufficientBalance || insufficientReferrals || invalidAccount;

  const handleSelectMethod = (methodId: PaymentMethod) => {
    setSelectedMethod(methodId);
    if (methodId === "bkash") {
      setAccountNumber(user?.bkashNumber || "");
    } else if (methodId === "nagad") {
      setAccountNumber(user?.nagadNumber || "");
    } else {
      setAccountNumber(user?.binanceId || "");
    }
  };

  const handleSubmit = async () => {
    if (cannotWithdraw || !user || submitting) return;
    setSubmitting(true);

    const methodTitle =
      selectedMethod === "bkash"
        ? "bKash"
        : selectedMethod === "nagad"
        ? "Nagad"
        : "Binance USDT (BEP20)";

    // Atomically verify sufficient balance & required referrals before deducting balance
    let txSuccess = false;
    await runTransaction(ref(userDb, `users/${user.id}`), (userData) => {
      if (!userData) return userData;
      const currentBal = Number(userData.balance) || 0;
      const currentRefs = Number(userData.referrals) || 0;
      const minW = Math.max(selectedAmount, Number(settings.minWithdraw) || 5);

      if (currentBal < minW || currentRefs < minRequiredReferrals) {
        txSuccess = false;
        return; // Abort transaction
      }

      txSuccess = true;
      const updated: any = {
        ...userData,
        balance: +(currentBal - selectedAmount).toFixed(4),
      };
      if (selectedMethod === "bkash") updated.bkashNumber = accountNumber.trim();
      else if (selectedMethod === "nagad") updated.nagadNumber = accountNumber.trim();
      else updated.binanceId = accountNumber.trim();
      return updated;
    });

    if (!txSuccess) {
      setSubmitting(false);
      return;
    }

    const withdrawalRef = push(ref(userDb, "withdrawals"));
    await set(withdrawalRef, {
      id: withdrawalRef.key,
      uid: user.id,
      name: user.name,
      username: user.username,
      amount: selectedAmount,
      method: methodTitle,
      account: accountNumber.trim(),
      status: "pending",
      createdAt: Date.now(),
    });

    // Send Telegram Notification to the user and Admin
    try {
      const botToken = resolveBotToken(settings.botToken);

      // 1. Send confirmation message to user's Telegram
      const userMsg =
        `💸 <b>PhotoCash উইথড্র রিকোয়েস্ট সফল হয়েছে!</b>\n\n` +
        `👤 <b>নাম:</b> ${escapeHtml(user.name)}\n` +
        `💵 <b>উইথড্র পরিমাণ:</b> $${selectedAmount.toFixed(2)} USDT\n` +
        `💳 <b>পেমেন্ট মেথড:</b> ${methodTitle}\n` +
        `📞 <b>ফোন / একাউন্ট নাম্বার:</b> <code>${accountNumber.trim()}</code>\n` +
        `⏳ <b>স্ট্যাটাস:</b> পেন্ডিং (Pending)\n\n` +
        `✅ আপনার ক্যাশআউট রিকোয়েস্ট অ্যাডমিনের কাছে পৌঁছেছে। অ্যাডমিন খুব শীঘ্রই ভেরিফাই করে পেমেন্ট পাঠিয়ে দিবে অথবা প্রয়োজন হলে আপনার নাম্বারে যোগাযোগ / ফোন করবে। 📞`;

      await sendTelegramBotMessage(botToken, user.id, userMsg);

      // 2. Send alert message to Admin Telegram ID / Channel if configured
      if (settings.adminChatId?.trim()) {
        const adminMsg =
          `🚨 <b>নতুন ক্যাশআউট রিকোয়েস্ট!</b>\n\n` +
          `👤 <b>ইউজার:</b> ${escapeHtml(user.name)} (@${user.username || "none"})\n` +
          `🆔 <b>টেলিগ্রাম আইডি:</b> <code>${user.id}</code>\n` +
          `💵 <b>পরিমাণ:</b> $${selectedAmount.toFixed(2)} USDT\n` +
          `💳 <b>মেথড:</b> ${methodTitle}\n` +
          `📞 <b>ফোন / একাউন্ট:</b> <code>${accountNumber.trim()}</code>\n` +
          `🕒 <b>সময়:</b> ${new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" })}\n\n` +
          `👉 অ্যাডমিন প্যানেল থেকে রিকোয়েস্ট অ্যাপ্রুভ করুন অথবা নাম্বারে কল করুন।`;
        await sendTelegramBotMessage(botToken, settings.adminChatId.trim(), adminMsg);
      }
    } catch (msgErr) {
      console.error("Failed to send withdrawal Telegram message:", msgErr);
    }

    setSubmitting(false);
    setSubmitted(true);
  };

  return (
    <LayoutShell bare className="px-3 pt-3">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="p-1"
          >
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-[17px] font-extrabold text-ink">Cash Out</h1>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-[12px] font-bold text-ink">
          Balance {formatUSDT(balance, 2)}
        </span>
      </header>

      {submitted ? (
        <section className="rounded-2xl bg-white p-6 text-center shadow-sm">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <Check size={24} />
          </span>
          <h2 className="mt-2 text-[15px] font-bold text-ink">উইথড্র রিকোয়েস্ট সফল হয়েছে!</h2>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            {formatUSDT(selectedAmount, 2)} USDT উইথড্র সফলভাবে গ্রহণ করা হয়েছে। {currentMethodObj.name} একাউন্টে ({accountNumber}) টাকা পাঠানো হবে।
          </p>
          <div className="mt-2.5 rounded-xl border border-emerald-500/20 bg-emerald-50 p-2.5 text-[11.5px] text-emerald-900 leading-snug">
            📲 আপনার টেলিগ্রামে রিকোয়েস্ট মেসেজ পাঠানো হয়েছে। অ্যাডমিন খুব শীঘ্রই ভেরিফাই করে পেমেন্ট করবে অথবা আপনার নাম্বারে ফোন করবে। 📞
          </div>
          <button
            type="button"
            onClick={() => navigate("/wallet")}
            className="brand-grad mt-4 w-full rounded-full px-5 py-2.5 text-[13px] font-bold text-white shadow"
          >
            Back to wallet
          </button>
        </section>
      ) : (
        <>
          <section className="rounded-2xl bg-white p-3">
            <p className="mb-2 text-[13px] font-semibold text-muted">Select Amount</p>
            <div className="grid grid-cols-3 gap-2">
              {AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setSelectedAmount(amt)}
                  className={`rounded-xl border py-3 text-[15px] font-bold transition ${
                    selectedAmount === amt
                      ? "border-brand-orange bg-brand-orange/10 text-ink"
                      : "border-transparent bg-canvas text-ink"
                  }`}
                >
                  $ {amt}
                </button>
              ))}
            </div>
          </section>

          <section className="mt-2 rounded-2xl bg-white p-3">
            <p className="mb-2 text-[13px] font-semibold text-muted">Payment Method</p>
            <div className="grid grid-cols-3 gap-2">
              {METHODS.map((method) => {
                const isSelected = selectedMethod === method.id;
                return (
                  <button
                    key={method.id}
                    type="button"
                    onClick={() => handleSelectMethod(method.id)}
                    className={`relative flex flex-col items-center justify-center rounded-xl border py-2.5 transition active:scale-[0.98] ${
                      isSelected
                        ? "border-brand-orange bg-brand-orange/10"
                        : "border-transparent bg-canvas"
                    }`}
                  >
                    <div className="flex h-8 w-8 items-center justify-center">
                      {method.icon("w-8 h-8")}
                    </div>
                    <p
                      className={`mt-1 text-[11px] font-bold ${
                        isSelected ? "text-brand-orange" : "text-muted"
                      }`}
                    >
                      {method.name}
                    </p>
                    {isSelected && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand-orange text-white shadow-sm">
                        <Check size={11} strokeWidth={3} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <p className="mb-1.5 mt-3 text-[13px] font-semibold text-muted">
              {currentMethodObj.label}
            </p>
            <div className="flex items-center gap-2.5 rounded-full bg-canvas px-3.5 py-2.5 focus-within:ring-2 focus-within:ring-brand-orange/20">
              <div className="shrink-0">
                {currentMethodObj.icon("w-6 h-6 rounded-lg")}
              </div>
              <input
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder={currentMethodObj.placeholder}
                className="w-full bg-transparent text-[13px] font-medium text-ink outline-none placeholder:text-muted/60"
              />
            </div>
            <p className="mt-1.5 text-[10px] text-muted">
              {currentMethodObj.helper}
            </p>
          </section>

          <section className="mt-2 space-y-1.5 rounded-2xl bg-white p-3">
            <CheckRow
              ok={!insufficientBalance}
              text={`সর্বনিম্ন ${formatUSDT(settings.minWithdraw || 5, 2)} USDT (আপনার ব্যালেন্স ${formatUSDT(balance, 2)})`}
            />
            <CheckRow
              ok={!insufficientReferrals}
              text={`${minRequiredReferrals}টা রেফারের প্রয়োজন ( আপনার আছে ${String(referrals).padStart(2, "0")} টা )`}
            />
            <CheckRow
              ok={!invalidAccount}
              text={
                selectedMethod === "bkash"
                  ? "সঠিক বিকাশ নাম্বার প্রদান করুন (১১ ডিজিট)"
                  : selectedMethod === "nagad"
                  ? "সঠিক নগদ নাম্বার প্রদান করুন (১১ ডিজিট)"
                  : "সঠিক BEP20 এড্রেস বা Binance ID প্রদান করুন"
              }
            />
          </section>

          {insufficientBalance && (
            <p className="mt-2 flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 py-2.5 text-[13px] font-bold text-red-600">
              <Info size={15} /> Your balance is insufficient!
            </p>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={cannotWithdraw || submitting}
            className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-full py-3 text-[15px] font-bold text-white transition ${
              cannotWithdraw || submitting
                ? "brand-grad opacity-40"
                : "brand-grad active:scale-[0.98]"
            }`}
          >
            <ArrowUpRight size={16} />{" "}
            {submitting ? "Sending..." : `Cash out ${formatUSDT(selectedAmount, 2)}`}
          </button>

          <p className="mb-4 mt-2 text-center text-[11px] text-muted">
            By cashing out, you agree to PhotoCash's Cash Out Terms & Conditions.
          </p>
        </>
      )}
    </LayoutShell>
  );
}

function CheckRow({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p className={`flex items-center gap-1.5 text-[11px] font-medium ${ok ? "text-green-600" : "text-muted"}`}>
      <span
        className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] text-white ${
          ok ? "bg-green-500" : "bg-gray-300"
        }`}
      >
        ✓
      </span>
      {text}
    </p>
  );
}

