import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { ref, get, set, update, onValue, runTransaction, push } from "firebase/database";
import { userDb } from "../firebase";
import { User, defaultSettings } from "../types";
import { useSettings } from "./SettingsContext";
import {
  getInitialUser,
  sendTelegramBotMessage,
  openExternalLink,
  getTelegramWebApp,
  generateAvatar,
  extractReferrerId,
  escapeHtml,
} from "../utils";

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
    const userRef = ref(userDb, `users/${initial.id}`);

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

        const userRef = ref(userDb, `users/${initial.id}`);
        const snap = await get(userRef);

        const executeReferral = async () => {
          if (!referrerId || referrerId === initial.id) return;

          // Strict Anti-Double Referral Lock (Guarantees 100% duplicate-proof referrals)
          const lockRef = ref(userDb, `referred_records/${initial.id}`);
          const lockSnap = await get(lockRef);
          if (lockSnap.exists()) {
            return;
          }
          await set(lockRef, { referrerId, creditedAt: Date.now() });

          const l1Ref = ref(userDb, `users/${referrerId}`);
          const l1Snap = await get(l1Ref);
          const referBonus = settings.referBonus ?? defaultSettings.referBonus;
          const botToken = settings.botToken || defaultSettings.botToken;

          if (l1Snap.exists()) {
            const l1Data = l1Snap.val() as User;
            await runTransaction(l1Ref, (refUser) => {
              if (!refUser) return refUser;
              return {
                ...refUser,
                referrals: (refUser.referrals || 0) + 1,
                balance: +((refUser.balance || 0) + referBonus).toFixed(4),
                totalEarned: +((refUser.totalEarned || 0) + referBonus).toFixed(4),
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

          // 1. Send automated notification to Referrer via Telegram Bot
          const safeName = escapeHtml(initial.name);
          await sendTelegramBotMessage(
            botToken,
            referrerId,
            `🎉 <b>New Referral Joined!</b>\n\n` +
              `👤 <b>${safeName}</b> has joined PhotoCash using your link.\n` +
              `💰 <b>+${referBonus.toFixed(2)} USDT</b> referral bonus added to your balance!\n\n` +
              `Keep sharing your link to earn more! 🚀`
          );

          setReferralStatusMessage(
            `🎉 You joined via referral! +$${(settings.signupBonus ?? defaultSettings.signupBonus).toFixed(2)} USDT welcome bonus added.`
          );

          try {
            sessionStorage.removeItem("pc_pending_ref");
            localStorage.removeItem("pc_pending_ref");
          } catch {}
        };

        if (snap.exists()) {
          // EXISTING USER: Cannot be referred again (Strict Anti-Fraud)
          const currentData = snap.val() as User;
          const updates: Partial<User> = {};
          if (!currentData.photo) updates.photo = initial.photo;
          if (!currentData.name) updates.name = initial.name;
          if (!currentData.username) updates.username = initial.username;

          // Clear any pending referral since existing users cannot claim referral bonus
          try {
            sessionStorage.removeItem("pc_pending_ref");
            localStorage.removeItem("pc_pending_ref");
          } catch {}

          if (Object.keys(updates).length > 0) {
            await update(userRef, updates);
          }
        } else {
          // NEW USER REGISTRATION
          const signupBonus = settings.signupBonus ?? defaultSettings.signupBonus;

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
          };

          await set(userRef, newUser);

          if (signupBonus > 0) {
            await push(ref(userDb, `users/${initial.id}/history`), {
              type: "signup_bonus",
              amount: signupBonus,
              note: "Welcome signup bonus",
              createdAt: Date.now(),
            });
          }

          // Send Welcome notification to New User via Telegram Bot (Strictly ONCE upon signup)
          const welcomeSentRef = ref(userDb, `users/${initial.id}/welcomeSent`);
          const welcomeSentSnap = await get(welcomeSentRef);
          if (!welcomeSentSnap.exists() || !welcomeSentSnap.val()) {
            await set(welcomeSentRef, true);
            const botToken = settings.botToken || defaultSettings.botToken;
            const safeName = escapeHtml(initial.name);
            const welcomeMsg =
              `Welcome back to PhotoCash 📸💸\n\n` +
              `Hello <b>${safeName}</b>! Your account is active.\n` +
              `এখানে ক্লিক করুন👉 /income .. \n` +
              `Please open mini app and earn USDT...`;

            await sendTelegramBotMessage(botToken, initial.id, welcomeMsg);
          }

          if (referrerId) {
            await executeReferral();
          }
        }

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

        const postCount = Math.max(0, Number(current.postCount) || 0);
        if (postCount <= 0) {
          await update(userRef, { lastAccrual: now });
          return;
        }

        const reward = Number((periods * postCount * baseReward).toFixed(4));
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
    if (!user?.referredBy || sourceAmount <= 0) return;
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

  const updateUser = async (data: Partial<User>) => {
    if (!user) return;
    await update(ref(userDb, `users/${user.id}`), data);
  };

  const addBalance = async (amount: number) => {
    if (!user || amount === 0) return;
    const todayKey = getTodayKey();
    await runTransaction(ref(userDb, `users/${user.id}`), (userData) => {
      if (!userData) return userData;
      const curToday = userData.todayKey === todayKey ? userData.todayEarned || 0 : 0;
      return {
        ...userData,
        balance: +((userData.balance || 0) + amount).toFixed(4),
        totalEarned: +((userData.totalEarned || 0) + Math.max(0, amount)).toFixed(4),
        todayEarned: +((curToday + Math.max(0, amount))).toFixed(4),
        todayKey,
      };
    });
  };

  const toggleFollow = async (authorId: string) => {
    if (!user || authorId === user.id) return;
    const followRef = ref(userDb, `following/${user.id}/${authorId}`);
    const snap = await get(followRef);
    if (snap.exists()) {
      await update(ref(userDb, `following/${user.id}`), { [authorId]: null });
    } else {
      await update(ref(userDb, `following/${user.id}`), { [authorId]: true });
    }
  };

  const isFollowing = (authorId: string) => {
    return false;
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
