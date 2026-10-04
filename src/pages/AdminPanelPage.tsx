import React, { useState, useEffect, useMemo } from "react";
import { ref, onValue, update, remove, runTransaction } from "firebase/database";
import { contentDb, userDb } from "../firebase";
import { Settings, User, Post, Withdrawal, defaultSettings } from "../types";
import { useSettings } from "../context/SettingsContext";
import { formatUSDT, formatTimeAgo, sendTelegramBotMessage } from "../utils";
import { resolveBotToken, encryptBotToken } from "../utils/tokenVault";
import {
  Lock,
  LogOut,
  ShieldCheck,
  Settings as SettingsIcon,
  Megaphone,
  Users as UsersIcon,
  Image as ImageIcon,
  Banknote,
  Search,
  Trash,
  Send,
  ExternalLink,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Power,
  Phone,
  Copy,
  Check,
} from "lucide-react";

const SESSION_KEY = "pc_panel_session";
const MAX_ATTEMPTS = 5;

export function AdminPanelPage() {
  const { settings, saveSettings } = useSettings();
  const [authorized, setAuthorized] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [activeTab, setActiveTab] = useState("settings");

  useEffect(() => {
    const session = sessionStorage.getItem(SESSION_KEY);
    if (session && Date.now() - Number(session) < 60 * 60 * 1000) {
      setAuthorized(true);
    }
  }, []);

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (attempts >= MAX_ATTEMPTS) return;

    const correct = settings.adminPassword || defaultSettings.adminPassword;
    if (passwordInput === correct) {
      sessionStorage.setItem(SESSION_KEY, String(Date.now()));
      setAuthorized(true);
      setErrorMsg("");
    } else {
      setAttempts((prev) => prev + 1);
      setErrorMsg(`Incorrect password. ${MAX_ATTEMPTS - attempts - 1} attempt(s) left.`);
      setPasswordInput("");
    }
  };

  if (!authorized) {
    return (
      <div className="flex min-h-full w-full items-center justify-center bg-[#0f1115] p-6">
        <form
          onSubmit={handleUnlock}
          className="w-full max-w-xs rounded-2xl bg-[#171a21] p-6 text-center shadow-xl"
        >
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/5 text-white">
            <Lock size={20} />
          </span>
          <h1 className="text-[16px] font-bold text-white">Admin Control Panel</h1>
          <p className="mt-1 text-[11px] text-white/40">Enter admin password to continue</p>
          <input
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            placeholder="Enter password"
            autoComplete="off"
            disabled={attempts >= MAX_ATTEMPTS}
            className="mt-4 w-full rounded-lg bg-black/40 px-3 py-2 text-center text-[14px] tracking-[0.2em] text-white outline-none ring-1 ring-white/10 focus:ring-emerald-400"
          />
          {errorMsg && <p className="mt-2 text-[11px] text-red-400">{errorMsg}</p>}
          {attempts >= MAX_ATTEMPTS && (
            <p className="mt-2 text-[11px] text-red-400">
              Locked. Reload the page to retry.
            </p>
          )}
          <button
            type="submit"
            disabled={attempts >= MAX_ATTEMPTS}
            className="mt-3 w-full rounded-lg bg-emerald-500 py-2 text-[13px] font-bold text-black disabled:opacity-40"
          >
            Unlock Panel
          </button>
        </form>
      </div>
    );
  }

  const tabs = [
    { key: "settings", label: "Rewards & Tiers", Icon: SettingsIcon },
    { key: "channels", label: "Telegram Channels (ভেরিফিকেশন)", Icon: Send },
    { key: "ads", label: "Ads & Bot", Icon: Megaphone },
    { key: "users", label: "Users", Icon: UsersIcon },
    { key: "posts", label: "Posts", Icon: ImageIcon },
    { key: "withdrawals", label: "Payouts", Icon: Banknote },
  ];

  return (
    <div className="min-h-full w-full bg-[#0f1115] pb-10 text-white">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/10 bg-[#0f1115] px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-emerald-400" />
          <h1 className="text-[15px] font-bold">PhotoCash Admin Panel</h1>
        </div>
        <button
          type="button"
          onClick={() => {
            sessionStorage.removeItem(SESSION_KEY);
            setAuthorized(false);
          }}
          className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold"
        >
          <LogOut size={12} /> Lock
        </button>
      </header>

      <nav className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-3">
        {tabs.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold ${
              activeTab === key
                ? "bg-white text-black"
                : "bg-white/10 text-white/70"
            }`}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </nav>

      <div className="px-4">
        {activeTab === "settings" && (
          <SettingsTab settings={settings} save={saveSettings} />
        )}
        {activeTab === "channels" && (
          <ChannelsTab settings={settings} save={saveSettings} />
        )}
        {activeTab === "ads" && (
          <AdsTab settings={settings} save={saveSettings} />
        )}
        {activeTab === "users" && <UsersTab />}
        {activeTab === "posts" && <PostsTab />}
        {activeTab === "withdrawals" && (
          <WithdrawalsTab settings={settings} save={saveSettings} />
        )}
      </div>
    </div>
  );
}

function SettingsTab({
  settings,
  save,
}: {
  settings: Settings;
  save: (s: Partial<Settings>) => Promise<void>;
}) {
  const [form, setForm] = useState(settings);
  const [newBotToken, setNewBotToken] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => setForm(settings), [settings]);

  const updateField = (key: keyof Settings, value: any) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    const tokenToSave = resolveBotToken(newBotToken.trim() || settings.botToken);

    await save({
      signupBonus: Number(form.signupBonus) || 0,
      referBonus: Number(form.referBonus) || 0,
      postReward: Number(form.postReward) || 0,
      postRewardIntervalMin: Number(form.postRewardIntervalMin) || 10,
      passiveReward: Number(form.passiveReward) || 0,
      passiveIntervalMin: Number(form.passiveIntervalMin) || 10,
      l1Percent: Number(form.l1Percent) || 20,
      l2Percent: Number(form.l2Percent) || 15,
      l3Percent: Number(form.l3Percent) || 5,
      minWithdraw: Number(form.minWithdraw) || 5,
      minReferrals: Number(form.minReferrals) || 15,
      adminPassword: String(form.adminPassword || "445566"),
      announcement: form.announcement,
      botUsername: form.botUsername || "PhotoCash12_bot",
      appShortName: form.appShortName || "app",
      botToken: tokenToSave,
      botLink: form.botLink || "https://t.me/PhotoCash12_bot",
      webAppUrl: form.webAppUrl || "https://photocash.ziniyaapu7.workers.dev/",
    });
    setNewBotToken("");
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  return (
    <>
      <SectionCard title="Direct Mini Website / Mini App Referral Link">
        <FormInput
          label="Direct Mini Website / Web App URL"
          value={form.webAppUrl || "https://photocash.ziniyaapu7.workers.dev/"}
          onChange={(v) => updateField("webAppUrl", v)}
          hint="When friends click referral links, it directly opens this Mini Website / Web App without bot chat!"
        />
        <FormInput
          label="Telegram Bot Username"
          value={form.botUsername}
          onChange={(v) => updateField("botUsername", v)}
          hint="e.g. PhotoCash12_bot (without @)"
        />
        <FormInput
          label="BotFather App Short Name"
          value={form.appShortName || "app"}
          onChange={(v) => updateField("appShortName", v)}
          hint="The short name in @BotFather (e.g. 'app'). Direct launch link: https://t.me/PhotoCash12_bot/app?startapp=USER_ID"
        />
        <SecretTokenInput
          label="Telegram Bot API Token (গোপন টোকেন)"
          value={newBotToken}
          onChange={(v) => setNewBotToken(v)}
        />
      </SectionCard>
      <SectionCard title="Direct Earning Rules">
        <FormInput
          label="New Account Signup Bonus (USDT)"
          type="number"
          value={form.signupBonus}
          onChange={(v) => updateField("signupBonus", v)}
          hint="Added to balance when a new user registers."
        />
        <FormInput
          label="Direct Referral Bonus (USDT)"
          type="number"
          value={form.referBonus}
          onChange={(v) => updateField("referBonus", v)}
          hint="Added to referrer when a friend joins via their link."
        />
        <FormInput
          label="Reward per Photo Post (USDT)"
          type="number"
          value={form.postReward}
          onChange={(v) => updateField("postReward", v)}
          hint="USDT credited to user for publishing a photo post."
        />
        <FormInput
          label="Post Reward Interval (Minutes)"
          type="number"
          value={form.postRewardIntervalMin ?? 10}
          onChange={(v) => updateField("postRewardIntervalMin", v)}
          hint="User can earn the post reward once every this interval (Default: 10 minutes)."
        />
        <FormInput
          label="Passive reward per post (USDT)"
          type="number"
          value={form.passiveReward}
          onChange={(v) => updateField("passiveReward", v)}
        />
        <FormInput
          label="Passive interval (minutes)"
          type="number"
          value={form.passiveIntervalMin}
          onChange={(v) => updateField("passiveIntervalMin", v)}
          hint="Each active post generates this passive USDT every interval."
        />
      </SectionCard>

      <SectionCard title="Multi-Tier Referral Commission (%)">
        <FormInput
          label="Level 1 Commission (%)"
          type="number"
          value={form.l1Percent}
          onChange={(v) => updateField("l1Percent", v)}
          hint="Percent of earnings earned by direct inviter (Default: 20%)"
        />
        <FormInput
          label="Level 2 Commission (%)"
          type="number"
          value={form.l2Percent}
          onChange={(v) => updateField("l2Percent", v)}
          hint="Percent of earnings earned by level 2 ancestor (Default: 15%)"
        />
        <FormInput
          label="Level 3 Commission (%)"
          type="number"
          value={form.l3Percent}
          onChange={(v) => updateField("l3Percent", v)}
          hint="Percent of earnings earned by level 3 ancestor (Default: 5%)"
        />
      </SectionCard>

      <SectionCard title="Cash Out / Withdraw Rules">
        <FormInput
          label="Minimum withdraw (USDT)"
          type="number"
          value={form.minWithdraw}
          onChange={(v) => updateField("minWithdraw", v)}
        />
        <FormInput
          label="Required Referrals to Withdraw"
          type="number"
          value={form.minReferrals}
          onChange={(v) => updateField("minReferrals", v)}
          hint="User must have at least this many referrals to cash out."
        />
      </SectionCard>

      <SectionCard title="Admin Security & Password">
        <FormInput
          label="Admin password"
          type="password"
          value={form.adminPassword}
          onChange={(v) => updateField("adminPassword", v)}
          hint="Only you can access this panel."
        />
        <FormInput
          label="Global announcement text"
          value={form.announcement}
          onChange={(v) => updateField("announcement", v)}
        />
      </SectionCard>

      <SaveButton onSave={handleSave} saved={saved} />
    </>
  );
}

function AdsTab({
  settings,
  save,
}: {
  settings: Settings;
  save: (s: Partial<Settings>) => Promise<void>;
}) {
  const [form, setForm] = useState(settings);
  const [newBotToken, setNewBotToken] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => setForm(settings), [settings]);

  const updateField = (key: keyof Settings, value: any) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    const tokenToSave = resolveBotToken(newBotToken.trim() || settings.botToken);

    await save({
      botLink: form.botLink,
      botUsername: form.botUsername,
      botToken: tokenToSave,
      supportLink: form.supportLink,
      imgbbKey: form.imgbbKey,
      adEnabled: Boolean(form.adEnabled),
      adImage: form.adImage,
      adLink: form.adLink,
      adCode: form.adCode,
      starAdLink: form.starAdLink || "https://ads.ziniyaapu7.workers.dev/",
    });
    setNewBotToken("");
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  return (
    <>
      <SectionCard title="Banner Ads in Feed (Shown After Every Single Post)">
        <label className="flex items-center gap-2 text-[12px] font-semibold text-white/70">
          <input
            type="checkbox"
            checked={Boolean(form.adEnabled)}
            onChange={(e) => updateField("adEnabled", e.target.checked)}
            className="h-4 w-4"
          />
          Enable Banner Ads in Feed
        </label>

        <label className="block">
          <span className="text-[11px] font-semibold text-white/50">
            Ad network iframe / script code
          </span>
          <textarea
            rows={7}
            value={form.adCode}
            onChange={(e) => updateField("adCode", e.target.value)}
            className="mt-1 w-full rounded-lg bg-white/5 px-3 py-2 font-mono text-[11px] text-white outline-none ring-1 ring-white/10 focus:ring-emerald-400"
          />
          <span className="mt-0.5 block text-[10px] text-white/40">
            Directly execute HTML, JavaScript or iframe ad tags (e.g. 300x250 Adsterra).
          </span>
        </label>

        <FormInput
          label="Fallback Banner Image URL (if no script code)"
          value={form.adImage}
          onChange={(v) => updateField("adImage", v)}
        />
        <FormInput
          label="Banner Click Redirect Link"
          value={form.adLink}
          onChange={(v) => updateField("adLink", v)}
        />
      </SectionCard>

      <SectionCard title="Post Star Website Link (পোস্টে স্টার দিলে যে ওয়েবসাইট লিংকে যাবে)">
        <FormInput
          label="Star Ad Website URL (স্টার বিজ্ঞাপন লিংক)"
          value={form.starAdLink || ""}
          onChange={(v) => updateField("starAdLink", v)}
          hint="ইউজার পোস্টে স্টার এ ক্লিক করলে এই লিংকটি ওপেন হবে এবং ১ মিনিট থেকে ৬ মিনিটের মধ্যে ভিজিট সম্পন্ন করলে পোস্টে ১টি স্টার যোগ হবে এবং পোস্টের ক্রিয়েটর ০.০১ USDT পাবেন।"
        />
      </SectionCard>

      <SectionCard title="Telegram Bot & Services">
        <FormInput
          label="Bot link"
          value={form.botLink}
          onChange={(v) => updateField("botLink", v)}
          hint="Used for referral links: link?start=USER_ID"
        />
        <FormInput
          label="Bot username"
          value={form.botUsername}
          onChange={(v) => updateField("botUsername", v)}
        />
        <SecretTokenInput
          label="Bot token (গোপন টোকেন)"
          value={newBotToken}
          onChange={(v) => setNewBotToken(v)}
        />
        <FormInput
          label="Telegram Support link"
          value={form.supportLink}
          onChange={(v) => updateField("supportLink", v)}
        />
        <FormInput
          label="imgbb API key"
          value={form.imgbbKey}
          onChange={(v) => updateField("imgbbKey", v)}
        />
      </SectionCard>

      <SaveButton onSave={handleSave} saved={saved} />
    </>
  );
}

function ChannelsTab({
  settings,
  save,
}: {
  settings: Settings;
  save: (s: Partial<Settings>) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(Boolean(settings.forceChannelJoin ?? true));
  const [ch1Name, setCh1Name] = useState(
    settings.requiredChannels?.[0]?.name || "Main Channel"
  );
  const [ch1Url, setCh1Url] = useState(
    settings.requiredChannels?.[0]?.url || "https://t.me/jgjghjghh687"
  );
  const [ch2Name, setCh2Name] = useState(
    settings.requiredChannels?.[1]?.name || "Support Channel"
  );
  const [ch2Url, setCh2Url] = useState(
    settings.requiredChannels?.[1]?.url || "https://t.me/Earning_Money_Lob"
  );
  const [newBotToken, setNewBotToken] = useState("");
  const [botLink, setBotLink] = useState(
    settings.botLink || "https://t.me/PhotoCash12_bot"
  );
  const [saved, setSaved] = useState(false);
  const [testUserId, setTestUserId] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [toggleFeedback, setToggleFeedback] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(Boolean(settings.forceChannelJoin ?? true));
    setCh1Name(settings.requiredChannels?.[0]?.name || "Main Channel");
    setCh1Url(settings.requiredChannels?.[0]?.url || "https://t.me/jgjghjghh687");
    setCh2Name(settings.requiredChannels?.[1]?.name || "Support Channel");
    setCh2Url(settings.requiredChannels?.[1]?.url || "https://t.me/Earning_Money_Lob");
    setBotLink(settings.botLink || "https://t.me/PhotoCash12_bot");
  }, [settings]);

  const extractClean = (urlOrName: string) => {
    return urlOrName
      .trim()
      .replace(/https?:\/\/t\.me\//i, "")
      .replace(/^@/, "")
      .split("/")[0]
      .split("?")[0]
      .trim();
  };

  const handleToggle = async () => {
    const nextState = !enabled;
    setEnabled(nextState);
    setToggling(true);
    setToggleFeedback(null);
    try {
      await save({ forceChannelJoin: nextState });
      setToggleFeedback(
        nextState
          ? "✅ ভেরিফিকেশন সিস্টেম চালু (ON) করা হয়েছে!"
          : "🔴 ভেরিফিকেশন সিস্টেম বন্ধ (OFF) করা হয়েছে! ইউজাররা এখন কোনো পপআপ ছাড়াই সরাসরি ব্যবহার করতে পারবে।"
      );
      setTimeout(() => setToggleFeedback(null), 4000);
    } catch (err: any) {
      setEnabled(!nextState);
      setToggleFeedback("❌ সেভ ব্যর্থ: " + (err?.message || "Error"));
    } finally {
      setToggling(false);
    }
  };

  const handleSave = async () => {
    const u1 = extractClean(ch1Url);
    const u2 = extractClean(ch2Url);

    const requiredChannels = [
      {
        name: ch1Name.trim() || "Main Channel",
        url: ch1Url.trim().startsWith("http")
          ? ch1Url.trim()
          : `https://t.me/${u1}`,
        username: u1,
      },
      {
        name: ch2Name.trim() || "Support Channel",
        url: ch2Url.trim().startsWith("http")
          ? ch2Url.trim()
          : `https://t.me/${u2}`,
        username: u2,
      },
    ];

    const tokenToSave = resolveBotToken(newBotToken.trim() || settings.botToken);

    await save({
      forceChannelJoin: enabled,
      requiredChannels,
      botToken: tokenToSave,
      botLink: botLink.trim(),
    });

    setNewBotToken("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTestBot = async () => {
    if (!testUserId.trim()) {
      setTestResult("⚠️ অনুগ্রহ করে একটি টেলিগ্রাম ইউজার আইডি লিখুন (যেমন: 8235864550)");
      return;
    }
    setTesting(true);
    setTestResult(null);

    const u1 = extractClean(ch1Url);
    const activeToken = resolveBotToken(newBotToken.trim() || settings.botToken);
    try {
      const res = await fetch(
        `/api/verify-channel?user_id=${testUserId.trim()}&channel=${encodeURIComponent(
          u1
        )}&bot_token=${encodeURIComponent(encryptBotToken(activeToken))}`
      );
      const data = await res.json();
      if (data.ok) {
        if (data.joined) {
          setTestResult(`✅ ইউজার ${testUserId} সফলভাবে @${u1} চ্যানেলে জয়েন আছে! (Status: ${data.status})`);
        } else {
          setTestResult(`❌ ইউজার ${testUserId} এখনো @${u1} চ্যানেলে জয়েন করেনি! (${data.description || data.status})`);
        }
      } else {
        setTestResult(`❌ বট যাচাই ব্যর্থ হয়েছে: ${data.description || "Unknown error"}`);
      }
    } catch (err: any) {
      setTestResult(`❌ কানেকশন এরর: ${err.message}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      {/* Master Toggle Card */}
      <section className="mb-4 rounded-2xl border border-white/10 bg-gradient-to-br from-[#171a21] to-[#12141a] p-4 shadow-lg">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Power size={18} className={enabled ? "text-emerald-400" : "text-red-400"} />
              <h2 className="text-[14px] font-bold text-white">
                চ্যানেল ভেরিফিকেশন সিস্টেম অন/অফ (Master Switch)
              </h2>
            </div>
            <p className="mt-1 text-[11px] text-white/60">
              {enabled
                ? "🟢 সিস্টেম চালু আছে: ইউজাররা ওয়েবসাইটে প্রবেশ করলে বাধ্যতামূলক চ্যানেল ভেরিফাই করতে হবে।"
                : "🔴 সিস্টেম বন্ধ আছে: কোনো পপআপ আসবে না, সরাসরি সব ইউজার ওয়েবসাইট ব্যবহার করতে পারবে।"}
            </p>
          </div>

          <button
            type="button"
            onClick={handleToggle}
            disabled={toggling}
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-bold transition-all active:scale-95 cursor-pointer shadow-md disabled:opacity-50 ${
              enabled
                ? "bg-emerald-500 text-black shadow-emerald-500/20 hover:bg-emerald-400"
                : "bg-red-600 text-white shadow-red-600/30 hover:bg-red-500"
            }`}
          >
            {toggling ? (
              <RefreshCw size={15} className="animate-spin" />
            ) : (
              <Power size={15} />
            )}
            <span>
              {toggling
                ? "সেভ হচ্ছে..."
                : enabled
                ? "সিস্টেম চালু (ON)"
                : "সিস্টেম বন্ধ (OFF)"}
            </span>
          </button>
        </div>

        {toggleFeedback && (
          <div
            className={`mt-3 rounded-xl p-2.5 text-center text-[12px] font-bold shadow-md transition-all ${
              toggleFeedback.startsWith("✅")
                ? "border border-emerald-500/50 bg-emerald-500/20 text-emerald-300"
                : "border border-red-500/50 bg-red-500/20 text-red-300"
            }`}
          >
            {toggleFeedback}
          </div>
        )}
      </section>

      {/* Channel 1 Settings */}
      <SectionCard title="১. প্রধান চ্যানেল (Channel 1 - Main Channel)">
        <FormInput
          label="চ্যানেলের নাম (Channel Name)"
          value={ch1Name}
          onChange={(v) => setCh1Name(v)}
          hint="যেমন: Main Channel অথবা আপনার চ্যানেলের নাম"
        />

        <div className="space-y-1">
          <FormInput
            label="চ্যানেল লিংক বা ইউজারনেম (Telegram Channel URL / Username)"
            value={ch1Url}
            onChange={(v) => setCh1Url(v)}
            hint="যেমন: https://t.me/jgjghjghh687 বা @jgjghjghh687"
          />
          {ch1Url && (
            <div className="flex items-center gap-2 pt-1 text-[11px]">
              <span className="text-white/40">শনাক্তকৃত ইউজারনেম:</span>
              <span className="font-mono font-bold text-emerald-400">@{extractClean(ch1Url) || "none"}</span>
              <a
                href={ch1Url.startsWith("http") ? ch1Url : `https://t.me/${extractClean(ch1Url)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto flex items-center gap-1 text-emerald-400 hover:underline"
              >
                <span>লিংক টেস্ট করুন</span>
                <ExternalLink size={11} />
              </a>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Channel 2 Settings */}
      <SectionCard title="২. সাপোর্ট চ্যানেল (Channel 2 - Support Channel)">
        <FormInput
          label="চ্যানেলের নাম (Channel Name)"
          value={ch2Name}
          onChange={(v) => setCh2Name(v)}
          hint="যেমন: Support Channel অথবা ব্যাকআপ চ্যানেলের নাম"
        />

        <div className="space-y-1">
          <FormInput
            label="চ্যানেল লিংক বা ইউজারনেম (Telegram Channel URL / Username)"
            value={ch2Url}
            onChange={(v) => setCh2Url(v)}
            hint="যেমন: https://t.me/Earning_Money_Lob বা @Earning_Money_Lob"
          />
          {ch2Url && (
            <div className="flex items-center gap-2 pt-1 text-[11px]">
              <span className="text-white/40">শনাক্তকৃত ইউজারনেম:</span>
              <span className="font-mono font-bold text-emerald-400">@{extractClean(ch2Url) || "none"}</span>
              <a
                href={ch2Url.startsWith("http") ? ch2Url : `https://t.me/${extractClean(ch2Url)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto flex items-center gap-1 text-emerald-400 hover:underline"
              >
                <span>লিংক টেস্ট করুন</span>
                <ExternalLink size={11} />
              </a>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Telegram Bot Token & API */}
      <SectionCard title="টেলিগ্রাম বট কনফিগারেশন (Telegram Bot Settings)">
        <SecretTokenInput
          label="টেলিগ্রাম বট টোকেন (Telegram Bot Token - গোপন ও সুরক্ষিত)"
          value={newBotToken}
          onChange={(v) => setNewBotToken(v)}
        />

        <FormInput
          label="টেলিগ্রাম বট লিংক (Telegram Bot Link)"
          value={botLink}
          onChange={(v) => setBotLink(v)}
          hint="যেমন: https://t.me/PhotoCash12_bot"
        />

        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-200">
          <p className="font-bold">⚠️ অতি গুরুত্বপূর্ণ নিয়ম:</p>
          <p className="mt-0.5 leading-relaxed">
            টেলিগ্রামের নিয়মানুযায়ী মেম্বারশিপ চেক করার জন্য আপনার টেলিগ্রাম বটটিকে (যেমন: <strong>@PhotoCash12_bot</strong>) আপনার উভয় চ্যানেলেই অবশ্যই <strong>Administrator (অ্যাডমিন)</strong> হিসেবে যুক্ত রাখতে হবে।
          </p>
        </div>
      </SectionCard>

      {/* Live Bot Connectivity Test */}
      <SectionCard title="বট দিয়ে লাইভ মেম্বারশিপ টেস্ট করুন (Live Verification Test)">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={testUserId}
            onChange={(e) => setTestUserId(e.target.value)}
            placeholder="ইউজারের টেলিগ্রাম আইডি লিখুন (যেমন: 8235864550)"
            className="flex-1 rounded-lg bg-black/40 px-3 py-2 text-[12px] text-white outline-none ring-1 ring-white/10 focus:ring-emerald-400"
          />
          <button
            type="button"
            onClick={handleTestBot}
            disabled={testing}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-white/10 px-4 py-2 text-[12px] font-bold text-white hover:bg-white/20 active:scale-95 disabled:opacity-50"
          >
            {testing ? (
              <RefreshCw size={13} className="animate-spin text-emerald-400" />
            ) : (
              <RefreshCw size={13} />
            )}
            <span>টেস্ট করুন</span>
          </button>
        </div>

        {testResult && (
          <div
            className={`mt-2 rounded-lg p-2.5 text-[11px] font-semibold leading-relaxed ${
              testResult.startsWith("✅")
                ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border border-red-500/40 bg-red-500/10 text-red-300"
            }`}
          >
            {testResult}
          </div>
        )}
      </SectionCard>

      {/* Save Button */}
      <SaveButton onSave={handleSave} saved={saved} />
    </>
  );
}

function UsersTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const uRef = ref(userDb, "users");
    const unsubscribe = onValue(uRef, (snap) => {
      const data = snap.val() || {};
      const list: User[] = Object.values(data);
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setUsers(list);
    });
    return () => unsubscribe();
  }, []);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name?.toLowerCase().includes(q) ||
        u.id.includes(q) ||
        u.username?.toLowerCase().includes(q)
    );
  }, [users, search]);

  const adjustBalance = async (u: User, delta: number) => {
    await runTransaction(ref(userDb, `users/${u.id}`), (userData) => {
      if (!userData) return userData;
      return {
        ...userData,
        balance: +((userData.balance || 0) + delta).toFixed(4),
      };
    });
  };

  const setExactBalance = async (u: User) => {
    const val = window.prompt(`Set balance for ${u.name}`, String(u.balance ?? 0));
    if (val !== null) {
      await update(ref(userDb, `users/${u.id}`), { balance: Number(val) || 0 });
    }
  };

  const setExactReferrals = async (u: User) => {
    const val = window.prompt(`Set referral count for ${u.name}`, String(u.referrals ?? 0));
    if (val !== null) {
      await update(ref(userDb, `users/${u.id}`), { referrals: Number(val) || 0 });
    }
  };

  return (
    <>
      <div className="mb-3 flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
        <Search size={14} className="text-white/40" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, username or chat ID"
          className="w-full bg-transparent text-[12px] text-white outline-none"
        />
      </div>

      <p className="mb-2 text-[11px] text-white/40">{filteredUsers.length} users</p>

      <ul className="space-y-2 pb-6">
        {filteredUsers.map((u) => (
          <li key={u.id} className="rounded-xl bg-white/5 p-3">
            <div className="flex items-center gap-2">
              <img
                src={u.photo}
                alt=""
                className="h-9 w-9 rounded-full object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold">{u.name}</p>
                <p className="truncate text-[10px] text-white/40">
                  @{u.username} • ID {u.id} • {formatTimeAgo(u.createdAt || Date.now())}
                </p>
              </div>
              {u.banned && (
                <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-400">
                  banned
                </span>
              )}
            </div>

            <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[10px]">
              <MiniStat label="Balance" value={formatUSDT(u.balance || 0, 3)} />
              <MiniStat label="Posts" value={String(u.postCount || 0)} />
              <MiniStat label="L1 Refs" value={String(u.referrals || 0)} />
              <MiniStat label="L2 Refs" value={String(u.l2Referrals || 0)} />
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              <ActionPill onClick={() => adjustBalance(u, 1)}>+1</ActionPill>
              <ActionPill onClick={() => adjustBalance(u, -1)}>-1</ActionPill>
              <ActionPill onClick={() => setExactBalance(u)}>Set balance</ActionPill>
              <ActionPill onClick={() => setExactReferrals(u)}>Set referrals</ActionPill>
              <ActionPill onClick={() => update(ref(userDb, `users/${u.id}`), { banned: !u.banned })}>
                {u.banned ? "Unban" : "Ban"}
              </ActionPill>
              <ActionPill
                danger
                onClick={() => {
                  if (window.confirm(`Delete ${u.name}?`)) {
                    remove(ref(userDb, `users/${u.id}`));
                  }
                }}
              >
                Delete
              </ActionPill>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function PostsTab() {
  const [posts, setPosts] = useState<Post[]>([]);

  useEffect(() => {
    const pRef = ref(contentDb, "posts");
    const unsubscribe = onValue(pRef, (snap) => {
      const data = snap.val() || {};
      const list: Post[] = Object.values(data);
      list.sort((a, b) => b.createdAt - a.createdAt);
      setPosts(list);
    });
    return () => unsubscribe();
  }, []);

  return (
    <ul className="space-y-2 pb-6">
      <p className="text-[11px] text-white/40">{posts.length} posts</p>
      {posts.map((p) => (
        <li key={p.id} className="flex items-center gap-2 rounded-xl bg-white/5 p-2">
          <img
            src={p.imageUrl}
            alt=""
            className="h-14 w-14 rounded-lg object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-bold">{p.authorName}</p>
            <p className="truncate text-[11px] text-white/50">{p.caption || " "}</p>
            <p className="text-[10px] text-white/30">
              {formatTimeAgo(p.createdAt)} • {Object.keys(p.likes || {}).length} likes
            </p>
          </div>
          <button
            type="button"
            aria-label="Delete post"
            onClick={() => remove(ref(contentDb, `posts/${p.id}`))}
            className="rounded-lg bg-red-500/20 p-2 text-red-400"
          >
            <Trash size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function WithdrawalsTab({
  settings,
  save,
}: {
  settings: Settings;
  save: (s: Partial<Settings>) => Promise<void>;
}) {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [adminChatId, setAdminChatId] = useState(settings.adminChatId || "");
  const [savingChatId, setSavingChatId] = useState(false);
  const [chatIdMsg, setChatIdMsg] = useState<string | null>(null);
  const [copiedAccount, setCopiedAccount] = useState<string | null>(null);

  useEffect(() => {
    setAdminChatId(settings.adminChatId || "");
  }, [settings.adminChatId]);

  useEffect(() => {
    const wRef = ref(userDb, "withdrawals");
    const unsubscribe = onValue(wRef, (snap) => {
      const data = snap.val() || {};
      const list: Withdrawal[] = Object.values(data);
      list.sort((a, b) => b.createdAt - a.createdAt);
      setWithdrawals(list);
    });
    return () => unsubscribe();
  }, []);

  const handleSaveAdminChatId = async () => {
    setSavingChatId(true);
    setChatIdMsg(null);
    try {
      await save({ adminChatId: adminChatId.trim() });
      setChatIdMsg("✅ অ্যাডমিন নোটিফিকেশন চ্যাট আইডি সেভ হয়েছে!");
      setTimeout(() => setChatIdMsg(null), 3500);
    } catch (err: any) {
      setChatIdMsg("❌ সেভ ব্যর্থ: " + err.message);
    } finally {
      setSavingChatId(false);
    }
  };

  const setStatus = async (item: Withdrawal, status: "approved" | "rejected") => {
    await update(ref(userDb, `withdrawals/${item.id}`), { status, updatedAt: Date.now() });
    if (status === "rejected") {
      await runTransaction(ref(userDb, `users/${item.uid}`), (u) => {
        if (!u) return u;
        return {
          ...u,
          balance: +((u.balance || 0) + item.amount).toFixed(4),
        };
      });
    }

    // Send Telegram Notification to the User via Bot
    const botToken = resolveBotToken(settings.botToken);
    try {
      if (status === "approved") {
        const msg =
          `🎉 <b>অভিনন্দন! আপনার উইথড্র সফল হয়েছে!</b>\n\n` +
          `💵 <b>পরিমাণ:</b> $${item.amount.toFixed(2)} USDT\n` +
          `💳 <b>পেমেন্ট মেথড:</b> ${item.method}\n` +
          `📞 <b>একাউন্ট / নাম্বার:</b> <code>${item.account}</code>\n` +
          `✅ <b>স্ট্যাটাস:</b> পেইড / অ্যাপ্রুভড (Paid)\n\n` +
          `আপনার একাউন্টে টাকা সফলভাবে পাঠানো হয়েছে। PhotoCash-এ কাজ করার জন্য ধন্যবাদ! 📸💸`;
        await sendTelegramBotMessage(botToken, item.uid, msg);
      } else {
        const msg =
          `⚠️ <b>আপনার উইথড্র রিকোয়েস্ট বাতিল করা হয়েছে</b>\n\n` +
          `💵 <b>পরিমাণ:</b> $${item.amount.toFixed(2)} USDT (${item.method})\n` +
          `📞 <b>একাউন্ট:</b> <code>${item.account}</code>\n` +
          `❌ <b>স্ট্যাটাস:</b> রিজেক্টেড (Rejected)\n\n` +
          `উইথড্র করার $${item.amount.toFixed(2)} USDT আপনার PhotoCash একাউন্টে রিফান্ড করা হয়েছে। সঠিক ফোন নাম্বার বা একাউন্ট দিয়ে পুনরায় চেষ্টা করুন।`;
        await sendTelegramBotMessage(botToken, item.uid, msg);
      }
    } catch (err) {
      console.error("Telegram notification error:", err);
    }
  };

  const copyNumber = (text: string, id: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedAccount(id);
    setTimeout(() => setCopiedAccount(null), 1500);
  };

  const statusBadge = (s: string) => {
    if (s === "approved") return "bg-emerald-500/20 text-emerald-400";
    if (s === "rejected") return "bg-red-500/20 text-red-400";
    return "bg-amber-500/20 text-amber-400";
  };

  return (
    <div className="space-y-4 pb-8">
      {/* Admin Telegram Notification Config */}
      <section className="rounded-2xl border border-white/10 bg-[#171a21] p-4 shadow-lg">
        <div className="flex items-center gap-2">
          <Send size={16} className="text-emerald-400" />
          <h2 className="text-[13px] font-bold text-white">
            অ্যাডমিন টেলিগ্রাম নোটিফিকেশন (Withdrawal Alert)
          </h2>
        </div>
        <p className="mt-1 text-[11px] text-white/60">
          যেকোনো ইউজার ক্যাশআউট রিকোয়েস্ট দিলে স্বয়ংক্রিয়ভাবে আপনার টেলিগ্রামে মেসেজ ও ইউজারের ফোন নাম্বার চলে আসবে।
        </p>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={adminChatId}
            onChange={(e) => setAdminChatId(e.target.value)}
            placeholder="আপনার টেলিগ্রাম চ্যাট আইডি বা চ্যানেল আইডি (যেমন: 8235864550)"
            className="flex-1 rounded-xl bg-black/40 px-3.5 py-2.5 text-[12px] text-white outline-none ring-1 ring-white/10 focus:ring-emerald-400"
          />
          <button
            type="button"
            onClick={handleSaveAdminChatId}
            disabled={savingChatId}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-[12px] font-bold text-black transition active:scale-95 hover:bg-emerald-400 disabled:opacity-50"
          >
            {savingChatId ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
            <span>সেভ করুন</span>
          </button>
        </div>

        {chatIdMsg && (
          <p
            className={`mt-2 text-[11.5px] font-bold ${
              chatIdMsg.startsWith("✅") ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {chatIdMsg}
          </p>
        )}
      </section>

      {/* Withdrawals List */}
      <div>
        <p className="mb-2 text-[11px] text-white/40">
          {withdrawals.filter((w) => w.status === "pending").length} pending • {withdrawals.length} total
        </p>

        <ul className="space-y-2.5">
          {withdrawals.map((w) => {
            const isPhone = /^(01|\+8801)\d{9}/.test(w.account.trim());

            return (
              <li key={w.id} className="rounded-2xl border border-white/10 bg-white/5 p-3.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-[15px] font-extrabold text-white">
                    {formatUSDT(w.amount, 2)}
                    <span className="ml-1.5 text-[11px] font-normal text-white/40">
                      (≈ {(w.amount * 125).toFixed(0)} BDT)
                    </span>
                  </p>
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${statusBadge(w.status)}`}>
                    {w.status}
                  </span>
                </div>

                <div className="mt-2 flex items-center justify-between text-[11.5px]">
                  <p className="text-white/80">
                    <span className="font-bold text-white">{w.name}</span>{" "}
                    {w.username && (
                      <a
                        href={`https://t.me/${w.username}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-400 hover:underline"
                      >
                        (@{w.username})
                      </a>
                    )}{" "}
                    • ID: <span className="font-mono text-white/60">{w.uid}</span>
                  </p>
                  <span className="text-[10px] text-white/40">{formatTimeAgo(w.createdAt)}</span>
                </div>

                {/* Account & Phone Section */}
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-black/40 px-3 py-2 text-[12px]">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-amber-400">{w.method}:</span>
                    <span className="font-mono font-extrabold text-white">{w.account}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {isPhone && (
                      <a
                        href={`tel:${w.account.trim()}`}
                        className="flex items-center gap-1 rounded-lg bg-emerald-500/20 px-2.5 py-1 text-[11px] font-bold text-emerald-400 transition hover:bg-emerald-500/30 active:scale-95"
                      >
                        <Phone size={12} />
                        <span>ফোন করুন</span>
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => copyNumber(w.account.trim(), w.id)}
                      className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/80 transition hover:bg-white/20 active:scale-95"
                    >
                      {copiedAccount === w.id ? (
                        <>
                          <Check size={12} className="text-emerald-400" />
                          <span className="text-emerald-400">কপি হয়েছে</span>
                        </>
                      ) : (
                        <>
                          <Copy size={12} />
                          <span>কপি</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {w.status === "pending" && (
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setStatus(w, "approved")}
                      className="flex-1 rounded-xl bg-emerald-500 py-2 text-center text-[12px] font-bold text-black shadow-md transition hover:bg-emerald-400 active:scale-95"
                    >
                      ✓ Approve (টাকা পাঠানো হয়েছে)
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus(w, "rejected")}
                      className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] font-bold text-red-400 transition hover:bg-red-500/20 active:scale-95"
                    >
                      ✕ Reject & Refund
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function SecretTokenInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="block space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="text-[11px] font-semibold text-white/50">{label}</span>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400">
          <Lock size={10} />
          <span>টোকেন লুকানো ও সুরক্ষিত আছে (দেখা যাবে না)</span>
        </span>
      </div>
      <input
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="•••••••••••••••••••••••••••••••••••• (নতুন টোকেন চেঞ্জ করতে এখানে পেস্ট করুন)"
        className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[13px] text-white outline-none focus:border-emerald-400 focus:bg-black/60"
      />
      <span className="block text-[10px] text-white/40">
        নিরাপত্তার কারণে বর্তমান বট টোকেন কাউকে দেখানো হয় না। শুধুমাত্র টোকেন পরিবর্তন (Change) করতে চাইলে নতুন টোকেন পেস্ট করে Save চাপুন।
      </span>
    </div>
  );
}

function FormInput({
  label,
  value,
  onChange,
  type = "text",
  hint,
}: {
  label: string;
  value: any;
  onChange: (v: string) => void;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-white/50">{label}</span>
      <input
        type={type}
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg bg-white/5 px-3 py-2 text-[13px] text-white outline-none focus:bg-white/10"
      />
      {hint && <span className="mt-0.5 block text-[10px] text-white/30">{hint}</span>}
    </label>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3 rounded-2xl bg-white/5 p-4">
      <h2 className="mb-3 text-[13px] font-bold text-white">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function SaveButton({ onSave, saved }: { onSave: () => void; saved: boolean }) {
  return (
    <button
      type="button"
      onClick={onSave}
      className="mb-6 w-full rounded-xl bg-emerald-500 py-2.5 text-[13px] font-bold text-black shadow-lg"
    >
      {saved ? "Saved ✅" : "Save changes"}
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-black/30 py-1.5">
      <p className="text-[9px] text-white/40">{label}</p>
      <p className="text-[12px] font-bold">{value}</p>
    </div>
  );
}

function ActionPill({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
        danger ? "bg-red-500/20 text-red-400" : "bg-white/10 text-white"
      }`}
    >
      {children}
    </button>
  );
}
