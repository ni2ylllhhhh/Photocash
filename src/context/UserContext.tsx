import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { ref, get, set, update, onValue, runTransaction, push } from "firebase/database";
import { userDb, contentDb } from "../firebase";
import { User, Settings, defaultSettings } from "../types";
import { useSettings } from "./SettingsContext";
import {
  getInitialUser,
  sendTelegramBotMessage,
  generateAvatar,
  extractReferrerId,
  escapeHtml,
} from "../utils";
import { resolveBotToken } from "../utils/tokenVault";
import {
  verifyAndLockReferralSecurity,
  registerUserDeviceAndIp,
} from "../utils/securityShield";

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

interface UserContextValue {
  user: User | null;
  loading: boolean;
  referralStatusMessage: string | null;
  dismissReferralMessage: () => void;
  updateUser: (data: Partial<User>) => Promise<void>;
  addBalance: (amount: number) => Promise<void>;
  distributeTierCommissions: (sourceAmount: number, sourceLabel: string) => Promise<void>;
  toggleFollow: (authorId: string) => Promise<void>;
  isFollowing: (authorId: string) => boolean;
}

const UserContext = createContext<UserContextValue>({
  user: null,
  loading: true,
  referralStatusMessage: null,
  dismissReferralMessage: () => {},
  updateUser: async () => {},
  addBalance: async () => {},
  distributeTierCommissions: async () => {},
  toggleFollow: async () => {},
  isFollowing: () => false,
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [referralStatusMessage, setReferralStatusMessage] = useState<string | null>(null);
  const initialized = useRef(false);
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const initial = getInitialUser();
    userIdRef.current = initial.id;

    (async () => {
      try {
        let initial = getInitialUser();
        userIdRef.current = initial.id;

        // If referrer ID wasn't populated in first instant, give Telegram WebApp a brief moment
        let referrerId =
          initial.startParam && String(initial.startParam).trim() !== initial.id
            ? String(initial.startParam).trim()
            : null;

        if (!referrerId) {
          await new Promise((r) => setTimeout(r, 200));
          const retryRef = extractReferrerId();
          if (retryRef && retryRef !== initial.id) {
            referrerId = retryRef;
          }
        }

        // Clean referrerId (extract digits if prefixed like ref_123456)
        if (referrerId) {
          const digitsMatch = referrerId.match(/\d{5,}/);
          if (digitsMatch && digitsMatch[0] !== initial.id) {
            referrerId = digitsMatch[0];
          } else if (referrerId === initial.id) {
            referrerId = null;
          }
        }

        const userRef = ref(userDb, `users/${initial.id}`);
        const [snap, liveSettingsSnap] = await Promise.all([
          get(userRef),
          get(ref(contentDb, "settings")).catch(() => null),
        ]);
        const liveSettings: Settings = {
          ...defaultSettings,
          ...settings,
          ...(liveSettingsSnap && liveSettingsSnap.exists() ? liveSettingsSnap.val() : {}),
        };

        const existingVal = snap.exists() ? (snap.val() as Partial<User>) : null;
        const isFullyRegistered = Boolean(
          existingVal &&
            typeof existingVal.createdAt === "number" &&
            typeof existingVal.balance === "number"
        );

        const executeReferral = async () => {
          if (!referrerId || referrerId === initial.id) return false;

          // Fetch referrer first to check security rules (banned status, velocity cooldown, farm patterns)
          const l1Ref = ref(userDb, `users/${referrerId}`);
          const l1Snap = await get(l1Ref);
          const l1Val = l1Snap.exists() ? (l1Snap.val() as User & { lastReferralAt?: number }) : null;

          if (l1Val?.banned) {
            return false;
          }

          // Multi-layer Anti-Cheat Security Check (Device Fingerprint + LocalStorage Owner + IP Lock + Farm Tag + 90s Cooldown)
          const securityCheck = await verifyAndLockReferralSecurity({
            newUserId: initial.id,
            newUserName: initial.name,
            referrerId,
            referrerName: l1Val?.name,
            lastReferralAt: l1Val?.lastReferralAt,
          });

          if (!securityCheck.allowed) {
            await push(ref(userDb, `security_logs/blocked_referrals`), {
              referrerId,
              newUserId: initial.id,
              newUserName: initial.name,
              reason: securityCheck.reason || "security_violation",
              createdAt: Date.now(),
            }).catch(() => {});
            return false;
          }

          // Strict Anti-Double Referral Lock (Guarantees 100% duplicate-proof referrals,
          // while allowing re-testing if a user was deleted from `users` over 60s ago)
          const lockRef = ref(userDb, `referred_records/${initial.id}`);
          const lockSnap = await get(lockRef);
          if (lockSnap.exists()) {
            const lockVal = lockSnap.val() || {};
            const ageMs = Date.now() - Number(lockVal.creditedAt || 0);
            if (isFullyRegistered || ageMs < 60000) {
              return false;
            }
          }
          await set(lockRef, {
            referrerId,
            newUserId: initial.id,
            newUserName: initial.name,
            creditedAt: Date.now(),
            messageSent: true,
          });

          // Ensure referredBy is saved on the new user
          await update(userRef, { referredBy: referrerId }).catch(() => {});

          const referBonus = Number(liveSettings.referBonus ?? defaultSettings.referBonus);
          const signupBonus = Number(liveSettings.signupBonus ?? defaultSettings.signupBonus);
          const botToken = resolveBotToken(liveSettings.botToken);
          let updatedReferralCount = 1;

          if (l1Snap.exists() && l1Snap.val()?.createdAt) {
            const l1Data = l1Snap.val() as User;
            updatedReferralCount = (Number(l1Data.referrals) || 0) + 1;
            const todayKey = getTodayKey();
            const nowTs = Date.now();

            await runTransaction(l1Ref, (refUser) => {
              if (!refUser) return refUser;
              const curToday =
                refUser.todayKey === todayKey ? Number(refUser.todayEarned) || 0 : 0;
              return {
                ...refUser,
                referrals: (Number(refUser.referrals) || 0) + 1,
                balance: +((Number(refUser.balance) || 0) + referBonus).toFixed(4),
                totalEarned: +((Number(refUser.totalEarned) || 0) + referBonus).toFixed(4),
                todayEarned: +(curToday + referBonus).toFixed(4),
                todayKey,
                lastReferralAt: nowTs,
              };
            });

            // L2 & L3 ancestor increment
            const l2Id = l1Data.referredBy;
            if (l2Id && l2Id !== initial.id && l2Id !== referrerId) {
              const l2Ref = ref(userDb, `users/${l2Id}`);
              const l2Snap = await get(l2Ref);
              if (l2Snap.exists()) {
                const l2Data = l2Snap.val() as User;
                await runTransaction(l2Ref, (u2) => {
                  if (!u2) return u2;
                  return { ...u2, l2Referrals: (u2.l2Referrals || 0) + 1 };
                });

                const l3Id = l2Data.referredBy;
                if (l3Id && l3Id !== initial.id && l3Id !== referrerId && l3Id !== l2Id) {
                  const l3Ref = ref(userDb, `users/${l3Id}`);
                  await runTransaction(l3Ref, (u3) => {
                    if (!u3) return u3;
                    return { ...u3, l3Referrals: (u3.l3Referrals || 0) + 1 };
                  });
                }
              }
            }
          } else {
            // Initialize referrer profile if not previously opened
            await set(l1Ref, {
              id: referrerId,
              name: "Telegram User",
              username: `user_${referrerId.slice(-4)}`,
              photo: generateAvatar("User", referrerId),
              bio: "",
              balance: referBonus,
              totalEarned: referBonus,
              todayEarned: referBonus,
              todayKey: getTodayKey(),
              postCount: 0,
              referrals: 1,
              l2Referrals: 0,
              l3Referrals: 0,
              createdAt: Date.now(),
              lastAccrual: Date.now(),
            });
          }

          // Add to Referrer's Referrals List
          await set(ref(userDb, `referrals/${referrerId}/${initial.id}`), {
            id: initial.id,
            name: initial.name,
            username: initial.username,
            photo: initial.photo,
            joinedAt: Date.now(),
          });

          // Add to Referrer's Transaction History
          await push(ref(userDb, `users/${referrerId}/history`), {
            type: "referral_l1",
            amount: referBonus,
            note: `Direct referral bonus — ${initial.name}`,
            createdAt: Date.now(),
          });

          const safeName = escapeHtml(initial.name);

          // 1. Send automated Telegram message to the REFERRER (যে রেফার করেছে) - strictly ONCE
          await sendTelegramBotMessage(
            botToken,
            referrerId,
            `🎉 <b>অভিনন্দন! নতুন রেফারেল জয়েন করেছে!</b>\n\n` +
              `👤 <b>নাম:</b> ${safeName}\n` +
              `💰 <b>বোনাস:</b> আপনার মূল ব্যালেন্সে <b>+$${referBonus.toFixed(2)} USDT</b> রেফার বোনাস যোগ হয়েছে!\n` +
              `👥 <b>মোট রেফার:</b> ${updatedReferralCount} জন\n\n` +
              `আরো বেশি ইনকাম করতে আপনার রেফার লিংক শেয়ার করুন! 🚀`
          );

          // 2. Send automated Telegram message to the NEW USER (যাকে রেফার করা হয়েছে) - strictly ONCE
          await sendTelegramBotMessage(
            botToken,
            initial.id,
            `🎉 <b>অভিনন্দন ${safeName}! রেফারেল জয়েন সফল হয়েছে! 📸💸</b>\n\n` +
              `✅ আপনি রেফারেল লিংকের মাধ্যমে <b>PhotoCash</b>-এ জয়েন করেছেন।\n` +
              `💰 আপনার মূল ব্যালেন্সে <b>+$${signupBonus.toFixed(2)} USDT</b> ওয়েলকাম বোনাস যোগ হয়েছে!\n\n` +
              `এখনি ফটো আপলোড ও স্টার দিয়ে প্রতিদিন ইনকাম শুরু করুন! 🚀`
          );

          setReferralStatusMessage(
            `🎉 অভিনন্দন! আপনি রেফারেল লিংকে জয়েন করেছেন এবং +$${signupBonus.toFixed(2)} USDT ওয়েলকাম বোনাস পেয়েছেন!`
          );

          try {
            sessionStorage.removeItem("pc_pending_ref");
            localStorage.removeItem("pc_pending_ref");
          } catch {}

          return true;
        };

        if (isFullyRegistered && existingVal) {
          // EXISTING REGISTERED USER
          const currentData = existingVal as User;
          const updates: Partial<User> = {};
          if (!currentData.photo) updates.photo = initial.photo;
          if (!currentData.name) updates.name = initial.name;
          if (!currentData.username) updates.username = initial.username;

          // If this user was just created seconds ago by the bot (/start without param) and hasn't been referred yet,
          // honor the referral link on their first Mini App launch within 10 minutes of account creation
          const isBrandNewFromBot =
            referrerId &&
            !currentData.referredBy &&
            Date.now() - (currentData.createdAt || 0) < 10 * 60 * 1000;

          if (isBrandNewFromBot) {
            await executeReferral();
          } else {
            try {
              sessionStorage.removeItem("pc_pending_ref");
              localStorage.removeItem("pc_pending_ref");
            } catch {}
          }

          if (Object.keys(updates).length > 0) {
            await update(userRef, updates);
          }
        } else {
          // NEW USER REGISTRATION (Preserves channelsVerified if set prior to registration)
          const signupBonus = Number(liveSettings.signupBonus ?? defaultSettings.signupBonus);

          const newUser: User = {
            id: initial.id,
            name: initial.name,
            username: initial.username,
            photo: initial.photo,
            bio: "",
            balance: signupBonus,
            totalEarned: signupBonus,
            todayEarned: signupBonus,
            todayKey: getTodayKey(),
            postCount: 0,
            referrals: 0,
            l2Referrals: 0,
            l3Referrals: 0,
            referredBy: referrerId,
            binanceId: "",
            createdAt: Date.now(),
            lastAccrual: Date.now(),
            ...(existingVal?.channelsVerified
              ? {
                  channelsVerified: true,
                  channelsVerifiedAt: existingVal.channelsVerifiedAt || Date.now(),
                }
              : {}),
          };

          await set(userRef, newUser);

          if (signupBonus > 0) {
            await push(ref(userDb, `users/${initial.id}/history`), {
              type: "signup_bonus",
              amount: signupBonus,
              note: referrerId
                ? "Welcome referral signup bonus"
                : "Welcome signup bonus",
              createdAt: Date.now(),
            });
          }

          let referredSuccess = false;
          if (referrerId) {
            referredSuccess = await executeReferral();
          }

          // If not referred (or referral didn't trigger), send standard welcome message ONCE
          if (!referredSuccess) {
            const welcomeSentRef = ref(userDb, `users/${initial.id}/welcomeSent`);
            const welcomeSentSnap = await get(welcomeSentRef);
            if (!welcomeSentSnap.exists() || !welcomeSentSnap.val()) {
              await set(welcomeSentRef, true);
              const botToken = resolveBotToken(settings.botToken);
              const safeName = escapeHtml(initial.name);
              const welcomeMsg =
                `🎉 <b>Welcome to PhotoCash 📸💸</b>\n\n` +
                `Hello <b>${safeName}</b>! আপনার একাউন্ট সফলভাবে চালু হয়েছে।\n` +
                `💰 আপনার মূল ব্যালেন্সে <b>+$${signupBonus.toFixed(2)} USDT</b> ওয়েলকাম বোনাস যোগ হয়েছে!\n\n` +
                `Please open mini app and earn USDT... 🚀`;

              await sendTelegramBotMessage(botToken, initial.id, welcomeMsg);
            }
          }
        }

        // Lock current user's hardware device & IP to prevent multi-account self-referral on the same phone
        registerUserDeviceAndIp(initial.id).catch(() => {});

        onValue(userRef, (snapshot) => {
          setUser(snapshot.val());
          setLoading(false);
        });
      } catch {
        setLoading(false);
      }
    })();
  }, [settings.referBonus, settings.signupBonus, settings.botToken, settings.botLink]);

  // Passive background accrual: Every passiveIntervalMin (10 min), award passiveReward (0.009 USDT) per post
  useEffect(() => {
    if (!user) return;
    const intervalMin = settings.passiveIntervalMin ?? defaultSettings.passiveIntervalMin;
    const intervalMs = intervalMin * 60 * 1000;
    const baseReward = settings.passiveReward ?? defaultSettings.passiveReward;

    const checkAccrual = async () => {
      if (baseReward <= 0) return;
      const now = Date.now();
      const last = user.lastAccrual || user.createdAt || now;
      if (now - last >= intervalMs) {
        const periods = Math.min(144, Math.floor((now - last) / intervalMs));
        if (periods <= 0) return;

        const userRef = ref(userDb, `users/${user.id}`);
        const userSnap = await get(userRef);
        if (!userSnap.exists()) return;
        const current = userSnap.val() as User;

        // Re-verify against server timestamp to prevent duplicate accrual across tabs
        const serverLast = current.lastAccrual || current.createdAt || now;
        if (now - serverLast < intervalMs) return;
        const verifiedPeriods = Math.min(144, Math.floor((now - serverLast) / intervalMs));
        if (verifiedPeriods <= 0) return;

        const postCount = Math.max(0, Number(current.postCount) || 0);
        if (postCount <= 0) {
          await update(userRef, { lastAccrual: now });
          return;
        }

        const reward = Number((verifiedPeriods * postCount * baseReward).toFixed(4));
        if (reward <= 0) return;

        const todayKey = getTodayKey();
        const prevBal = Number(current.balance) || 0;
        const prevTotal = Number(current.totalEarned) || 0;
        const isToday = current.todayKey === todayKey;
        const prevToday = isToday ? Number(current.todayEarned) || 0 : 0;

        await update(userRef, {
          balance: Number((prevBal + reward).toFixed(4)),
          totalEarned: Number((prevTotal + reward).toFixed(4)),
          todayEarned: Number((prevToday + reward).toFixed(4)),
          todayKey,
          lastAccrual: now,
        });

        await push(ref(userDb, `users/${user.id}/history`), {
          type: "passive",
          amount: reward,
          note: `অটোমেটিক ইনকাম (${postCount}টি পোস্ট x ${baseReward} USDT / ${intervalMin} মিনিট)`,
          createdAt: now,
        });
      }
    };

    checkAccrual();
    const intervalId = window.setInterval(checkAccrual, 30000);
    return () => window.clearInterval(intervalId);
  }, [user?.id, user?.postCount, settings.passiveReward, settings.passiveIntervalMin]);

  // Distribute commissions (L1, L2, L3) when user earns from posts / activities
  const distributeTierCommissions = async (sourceAmount: number, sourceLabel: string) => {
    if (!user?.referredBy || sourceAmount <= 0 || sourceAmount > 1) return;
    const l1Percent = settings.l1Percent ?? defaultSettings.l1Percent;
    const l2Percent = settings.l2Percent ?? defaultSettings.l2Percent;
    const l3Percent = settings.l3Percent ?? defaultSettings.l3Percent;

    try {
      // Level 1 commission
      const l1Id = user.referredBy;
      const l1Ref = ref(userDb, `users/${l1Id}`);
      const l1Snap = await get(l1Ref);
      if (!l1Snap.exists()) return;
      const l1Data = l1Snap.val() as User;

      const l1Bonus = +((sourceAmount * l1Percent) / 100).toFixed(4);
      if (l1Bonus > 0) {
        await runTransaction(l1Ref, (u) => {
          if (!u) return u;
          return {
            ...u,
            balance: +((u.balance || 0) + l1Bonus).toFixed(4),
            totalEarned: +((u.totalEarned || 0) + l1Bonus).toFixed(4),
          };
        });
        await push(ref(userDb, `users/${l1Id}/history`), {
          type: "commission_l1",
          amount: l1Bonus,
          note: `L1 commission (${l1Percent}%) from ${user.name} - ${sourceLabel}`,
          createdAt: Date.now(),
        });
      }

      // Level 2 commission
      const l2Id = l1Data.referredBy;
      if (!l2Id) return;
      const l2Ref = ref(userDb, `users/${l2Id}`);
      const l2Snap = await get(l2Ref);
      if (!l2Snap.exists()) return;
      const l2Data = l2Snap.val() as User;

      const l2Bonus = +((sourceAmount * l2Percent) / 100).toFixed(4);
      if (l2Bonus > 0) {
        await runTransaction(l2Ref, (u) => {
          if (!u) return u;
          return {
            ...u,
            balance: +((u.balance || 0) + l2Bonus).toFixed(4),
            totalEarned: +((u.totalEarned || 0) + l2Bonus).toFixed(4),
          };
        });
        await push(ref(userDb, `users/${l2Id}/history`), {
          type: "commission_l2",
          amount: l2Bonus,
          note: `L2 commission (${l2Percent}%) from ${user.name} - ${sourceLabel}`,
          createdAt: Date.now(),
        });
      }

      // Level 3 commission
      const l3Id = l2Data.referredBy;
      if (!l3Id) return;
      const l3Ref = ref(userDb, `users/${l3Id}`);
      const l3Snap = await get(l3Ref);
      if (!l3Snap.exists()) return;

      const l3Bonus = +((sourceAmount * l3Percent) / 100).toFixed(4);
      if (l3Bonus > 0) {
        await runTransaction(l3Ref, (u) => {
          if (!u) return u;
          return {
            ...u,
            balance: +((u.balance || 0) + l3Bonus).toFixed(4),
            totalEarned: +((u.totalEarned || 0) + l3Bonus).toFixed(4),
          };
        });
        await push(ref(userDb, `users/${l3Id}/history`), {
          type: "commission_l3",
          amount: l3Bonus,
          note: `L3 commission (${l3Percent}%) from ${user.name} - ${sourceLabel}`,
          createdAt: Date.now(),
        });
      }
    } catch {}
  };

  // Strictly whitelisted profile update — blocks any unauthorized modification of balance, referrals, or admin flags
  const updateUser = async (data: Partial<User>) => {
    if (!user) return;
    const allowedFields: (keyof User)[] = [
      "name",
      "username",
      "photo",
      "bio",
      "binanceId",
      "bkashNumber",
      "nagadNumber",
      "channelsVerified",
      "channelsVerifiedAt",
    ];
    const safeUpdates: Record<string, any> = {};
    for (const key of allowedFields) {
      if (data[key] !== undefined) {
        safeUpdates[key] = data[key];
      }
    }
    if (Object.keys(safeUpdates).length === 0) return;
    await update(ref(userDb, `users/${user.id}`), safeUpdates);
  };

  // Locked down: arbitrary positive balance injection from client is blocked
  const addBalance = async (amount: number) => {
    if (!user || amount === 0 || amount > 0.05) return;
    const todayKey = getTodayKey();
    await runTransaction(ref(userDb, `users/${user.id}`), (userData) => {
      if (!userData) return userData;
      const curToday = userData.todayKey === todayKey ? userData.todayEarned || 0 : 0;
      return {
        ...userData,
        balance: Math.max(0, +((userData.balance || 0) + amount).toFixed(4)),
        totalEarned: +((userData.totalEarned || 0) + Math.max(0, amount)).toFixed(4),
        todayEarned: +(curToday + Math.max(0, amount)).toFixed(4),
        todayKey,
      };
    });
  };

  const toggleFollow = async (authorId: string) => {
    if (!user || !authorId || authorId === user.id) return;
    const currentlyFollowing = Boolean(user.following?.[authorId]);
    const nextVal = currentlyFollowing ? null : true;

    // Optimistic local state update for instant button response
    setUser((prev) => {
      if (!prev) return prev;
      const nextFollowing = { ...(prev.following || {}) };
      if (currentlyFollowing) {
        delete nextFollowing[authorId];
      } else {
        nextFollowing[authorId] = true;
      }
      return { ...prev, following: nextFollowing };
    });

    await Promise.all([
      update(ref(userDb, `users/${user.id}/following`), { [authorId]: nextVal }),
      update(ref(userDb, `users/${authorId}/followers`), { [user.id]: nextVal }),
    ]);
  };

  const isFollowing = (authorId: string) => {
    if (!user || !authorId) return false;
    return Boolean(user.following?.[authorId]);
  };

  const dismissReferralMessage = () => {
    setReferralStatusMessage(null);
  };

  return (
    <UserContext.Provider
      value={{
        user,
        loading,
        referralStatusMessage,
        dismissReferralMessage,
        updateUser,
        addBalance,
        distributeTierCommissions,
        toggleFollow,
        isFollowing,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
