import React, { useState, useEffect, useMemo } from "react";
import { ref, onValue, update, remove, runTransaction } from "firebase/database";
import { contentDb, userDb } from "../firebase";
import { Settings, User, Post, Withdrawal, defaultSettings } from "../types";
import { useSettings } from "../context/SettingsContext";
import { formatUSDT, formatTimeAgo } from "../utils";
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
        {activeTab === "ads" && (
          <AdsTab settings={settings} save={saveSettings} />
        )}
        {activeTab === "users" && <UsersTab />}
        {activeTab === "posts" && <PostsTab />}
        {activeTab === "withdrawals" && <WithdrawalsTab />}
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
  const [saved, setSaved] = useState(false);

  useEffect(() => setForm(settings), [settings]);

  const updateField = (key: keyof Settings, value: any) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
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
      botToken: form.botToken || "8738784866:AAFk8eHwv2xuswJTCBxGcvKAwZuUJHq4bK0",
      botLink: form.botLink || "https://t.me/PhotoCash12_bot",
      webAppUrl: form.webAppUrl || "https://photocash.ziniyaapu7.workers.dev/",
    });
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
        <FormInput
          label="Telegram Bot API Token"
          value={form.botToken}
          onChange={(v) => updateField("botToken", v)}
          hint="Used to send automated bot welcome & referral notifications."
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
  const [saved, setSaved] = useState(false);

  useEffect(() => setForm(settings), [settings]);

  const updateField = (key: keyof Settings, value: any) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    await save({
      botLink: form.botLink,
      botUsername: form.botUsername,
      botToken: form.botToken,
      supportLink: form.supportLink,
      imgbbKey: form.imgbbKey,
      adEnabled: Boolean(form.adEnabled),
      adImage: form.adImage,
      adLink: form.adLink,
      adCode: form.adCode,
      starAdLink: form.starAdLink || "https://ads.ziniyaapu7.workers.dev/",
      forceChannelJoin: Boolean(form.forceChannelJoin ?? true),
      channelPopupDelaySec: Number(form.channelPopupDelaySec) || 39,
      requiredChannels: form.requiredChannels || [
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
      ],
    });
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

      <SectionCard title="Required Telegram Channels (বাধ্যতামূলক চ্যানেল জয়েন ও অটোমেটিক ভেরিফিকেশন)">
        <label className="flex items-center gap-2 text-[12px] font-semibold text-white/80">
          <input
            type="checkbox"
            checked={Boolean(form.forceChannelJoin ?? true)}
            onChange={(e) => updateField("forceChannelJoin", e.target.checked)}
            className="h-4 w-4"
          />
          Enable Mandatory Channel Verification (জয়েন না থাকলে ওয়েবসাইট ব্যবহার করতে দিবে না)
        </label>

        <FormInput
          label="New User Popup Delay (Seconds)"
          type="number"
          value={form.channelPopupDelaySec ?? 39}
          onChange={(v) => updateField("channelPopupDelaySec", Number(v) || 39)}
          hint="নতুন ইউজার ওয়েবসাইটে প্রবেশের কত সেকেন্ড পর চ্যানেল জয়েন পপআপ আসবে (ডিফল্ট: ৩৯ সেকেন্ড)। পুরাতন ইউজার চ্যানেল থেকে আন-জয়েন হলে সাথে সাথে আসবে।"
        />

        <div className="mt-3 space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <h4 className="text-[12px] font-bold text-emerald-400">1. Main Channel (প্রধান চ্যানেল)</h4>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <FormInput
                label="Channel Name"
                value={form.requiredChannels?.[0]?.name || "Main Channel"}
                onChange={(v) => {
                  const updated = [...(form.requiredChannels || [])];
                  updated[0] = { ...(updated[0] || {}), name: v };
                  updateField("requiredChannels", updated);
                }}
              />
              <FormInput
                label="Channel URL"
                value={form.requiredChannels?.[0]?.url || "https://t.me/jgjghjghh687"}
                onChange={(v) => {
                  const updated = [...(form.requiredChannels || [])];
                  const username = v.replace(/https?:\/\/t\.me\//i, "").replace(/^@/, "").trim();
                  updated[0] = { ...(updated[0] || {}), url: v, username };
                  updateField("requiredChannels", updated);
                }}
                hint="e.g. https://t.me/jgjghjghh687"
              />
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <h4 className="text-[12px] font-bold text-emerald-400">2. Support Channel (সাপোর্ট চ্যানেল)</h4>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <FormInput
                label="Channel Name"
                value={form.requiredChannels?.[1]?.name || "Support Channel"}
                onChange={(v) => {
                  const updated = [...(form.requiredChannels || [])];
                  updated[1] = { ...(updated[1] || {}), name: v };
                  updateField("requiredChannels", updated);
                }}
              />
              <FormInput
                label="Channel URL"
                value={form.requiredChannels?.[1]?.url || "https://t.me/Earning_Money_Lob"}
                onChange={(v) => {
                  const updated = [...(form.requiredChannels || [])];
                  const username = v.replace(/https?:\/\/t\.me\//i, "").replace(/^@/, "").trim();
                  updated[1] = { ...(updated[1] || {}), url: v, username };
                  updateField("requiredChannels", updated);
                }}
                hint="e.g. https://t.me/Earning_Money_Lob"
              />
            </div>
          </div>
        </div>
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
        <FormInput
          label="Bot token"
          value={form.botToken}
          onChange={(v) => updateField("botToken", v)}
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

function WithdrawalsTab() {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);

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

  const setStatus = async (item: Withdrawal, status: "approved" | "rejected") => {
    await update(ref(userDb, `withdrawals/${item.id}`), { status });
    if (status === "rejected") {
      await runTransaction(ref(userDb, `users/${item.uid}`), (u) => {
        if (!u) return u;
        return {
          ...u,
          balance: +((u.balance || 0) + item.amount).toFixed(4),
        };
      });
    }
  };

  const statusBadge = (s: string) => {
    if (s === "approved") return "bg-emerald-500/20 text-emerald-400";
    if (s === "rejected") return "bg-red-500/20 text-red-400";
    return "bg-amber-500/20 text-amber-400";
  };

  return (
    <ul className="space-y-2 pb-6">
      <p className="text-[11px] text-white/40">
        {withdrawals.filter((w) => w.status === "pending").length} pending • {withdrawals.length} total
      </p>
      {withdrawals.map((w) => (
        <li key={w.id} className="rounded-xl bg-white/5 p-3">
          <div className="flex items-center justify-between">
            <p className="text-[14px] font-extrabold">{formatUSDT(w.amount, 2)}</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusBadge(w.status)}`}>
              {w.status}
            </span>
          </div>
          <p className="text-[11px] text-white/60">
            {w.name} (@{w.username}) • ID {w.uid}
          </p>
          <p className="break-all text-[11px] text-white/40">
            {w.method} • {w.account}
          </p>
          <p className="text-[10px] text-white/30">{formatTimeAgo(w.createdAt)}</p>

          {w.status === "pending" && (
            <div className="mt-2 flex gap-2">
              <ActionPill onClick={() => setStatus(w, "approved")}>
                Approve (paid)
              </ActionPill>
              <ActionPill danger onClick={() => setStatus(w, "rejected")}>
                Reject & refund
              </ActionPill>
            </div>
          )}
        </li>
      ))}
    </ul>
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
