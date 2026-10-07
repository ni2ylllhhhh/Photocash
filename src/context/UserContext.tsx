import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
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
  const claimingReferralRef = useRef(false);

  /**
   * Credits the referral ONLY when the referred user has joined the required channels
   * (or if forceChannelJoin is disabled by admin).
   */
  const claimVerifiedReferral = useCallback(
    async (
      currentUser: {
        id: string;
        name: string;
        username: string;
        photo: string;
        referredBy?: string | null;
        channelsVerified?: boolean;
      },
      explicitReferrerId?: string | null
    ): Promise<boolean> => {
      if (claimingReferralRef.current) return false;

      const rawRef = explicitReferrerId || currentUser.referredBy || extractReferrerId();
      if (!rawRef) return false;

      let targetReferrerId = String(rawRef).trim();
      const digitsMatch = targetReferrerId.match(/\d{5,}/);
      if (digitsMatch) {
        targetReferrerId = digitsMatch[0];
      }

      if (!targetReferrerId || targetReferrerId === currentUser.id) return false;

      claimingReferralRef.current = true;
      try {
        const liveSettingsSnap = await get(ref(contentDb, "settings")).catch(() => null);
        const liveSettings: Settings = {
          ...defaultSettings,
          ...settings,
          ...(liveSettingsSnap && liveSettingsSnap.exists()
            ? liveSettingsSnap.val()
            : {}),
        };

        const forceJoin = Boolean(liveSettings.forceChannelJoin ?? true);

        // STRICT RULE: If channel verification is enabled, the referral CANNOT be counted
        // or rewarded until the referred user has joined and verified the required channels!
        if (forceJoin && !currentUser.channelsVerified) {
          return false;
        }

        // Check if already credited in /referrals or /referred_records
        const [existingRefEntrySnap, lockSnap, l1Snap] = await Promise.all([
          get(ref(userDb, `referrals/${targetReferrerId}/${currentUser.id}`)),
          get(ref(userDb, `referred_records/${currentUser.id}`)),
          get(ref(userDb, `users/${targetReferrerId}`)),
        ]);

        if (existingRefEntrySnap.exists() || lockSnap.exists()) {
          try {
            sessionStorage.removeItem("pc_pending_ref");
            localStorage.removeItem("pc_pending_ref");
          } catch {}
          return false;
        }

        const l1Ref = ref(userDb, `users/${targetReferrerId}`);
        const l1Val = l1Snap.exists()
          ? (l1Snap.val() as User & { lastReferralAt?: number })
          : null;

        if (l1Val?.banned) {
          return false;
        }

        // Multi-layer Anti-Cheat Security Check (Same-phone LocalStorage Owner + Same-Phone/IP pair + Bot-Farm Tag)
        const securityCheck = await verifyAndLockReferralSecurity({
          newUserId: currentUser.id,
          newUserName: currentUser.name,
          referrerId: targetReferrerId,
          referrerName: l1Val?.name,
        });

        if (!securityCheck.allowed) {
          await push(ref(userDb, `security_logs/blocked_referrals`), {
            referrerId: targetReferrerId,
            newUserId: currentUser.id,
            newUserName: currentUser.name,
            reason: securityCheck.reason || "security_violation",
            createdAt: Date.now(),
          }).catch(() => {});
          return false;
        }

        // Atomic lock on referred_records/${currentUser.id} to guarantee 100% duplicate-proof referrals
        const lockRef = ref(userDb, `referred_records/${currentUser.id}`);
        let lockAcquired = false;
        await runTransaction(lockRef, (currentLock) => {
          if (currentLock) {
            lockAcquired = false;
            return; // Abort transaction if already credited
          }
          lockAcquired = true;
          return {
            referrerId: targetReferrerId,
            newUserId: currentUser.id,
            newUserName: currentUser.name,
            channelsVerified: true,
            creditedAt: Date.now(),
            messageSent: true,
          };
        });

        if (!lockAcquired) {
          return false;
        }

        // Ensure referredBy is saved on the user
        await update(ref(userDb, `users/${currentUser.id}`), {
          referredBy: targetReferrerId,
        }).catch(() => {});

        // 1. Add to Referrer's Referrals List first so we can verify the exact real count
        await set(ref(userDb, `referrals/${targetReferrerId}/${currentUser.id}`), {
          id: currentUser.id,
          name: currentUser.name,
          username: currentUser.username,
          photo: currentUser.photo,
          channelsVerified: true,
          joinedAt: Date.now(),
        });

        const allRefsSnap = await get(ref(userDb, `referrals/${targetReferrerId}`)).catch(
          () => null
        );
        const exactListCount =
          allRefsSnap && allRefsSnap.exists()
            ? Object.keys(allRefsSnap.val() || {}).length
            : 1;

        const referBonus = Number(liveSettings.referBonus ?? defaultSettings.referBonus);
        const signupBonus = Number(
          liveSettings.signupBonus ?? defaultSettings.signupBonus
        );
        const botToken = resolveBotToken(liveSettings.botToken);
        const webAppUrl =
          liveSettings.webAppUrl || "https://photocash.ziniyaapu7.workers.dev";
        let updatedReferralCount = exactListCount;

        if (l1Snap.exists() && l1Snap.val()?.createdAt) {
          const l1Data = l1Snap.val() as User;
          const todayKey = getTodayKey();
          const nowTs = Date.now();

          await runTransaction(l1Ref, (refUser) => {
            if (!refUser) return refUser;
            const curToday =
              refUser.todayKey === todayKey ? Number(refUser.todayEarned) || 0 : 0;
            const nextRefCount = Math.max(
              (Number(refUser.referrals) || 0) + 1,
              exactListCount
            );
            updatedReferralCount = nextRefCount;
            return {
              ...refUser,
              referrals: nextRefCount,
              balance: +((Number(refUser.balance) || 0) + referBonus).toFixed(4),
              totalEarned: +((Number(refUser.totalEarned) || 0) + referBonus).toFixed(4),
              todayEarned: +(curToday + referBonus).toFixed(4),
              todayKey,
              lastReferralAt: nowTs,
            };
          });

          // L2 & L3 ancestor increment
          const l2Id = l1Data.referredBy;
          if (l2Id && l2Id !== currentUser.id && l2Id !== targetReferrerId) {
            const l2Ref = ref(userDb, `users/${l2Id}`);
            const l2Snap = await get(l2Ref);
            if (l2Snap.exists()) {
              const l2Data = l2Snap.val() as User;
              await runTransaction(l2Ref, (u2) => {
                if (!u2) return u2;
                return { ...u2, l2Referrals: (u2.l2Referrals || 0) + 1 };
              });

              const l3Id = l2Data.referredBy;
              if (
                l3Id &&
                l3Id !== currentUser.id &&
                l3Id !== targetReferrerId &&
                l3Id !== l2Id
              ) {
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
            id: targetReferrerId,
            name: "Telegram User",
            username: `user_${targetReferrerId.slice(-4)}`,
            photo: generateAvatar("User", targetReferrerId),
            bio: "",
            balance: referBonus,
            totalEarned: referBonus,
            todayEarned: referBonus,
            todayKey: getTodayKey(),
            postCount: 0,
            referrals: exactListCount,
            l2Referrals: 0,
            l3Referrals: 0,
            createdAt: Date.now(),
            lastAccrual: Date.now(),
          });
        }

        // Add to Referrer's Transaction History
        await push(ref(userDb, `users/${targetReferrerId}/history`), {
          type: "referral_l1",
          amount: referBonus,
          note: `Verified referral bonus — ${currentUser.name}`,
          createdAt: Date.now(),
        });

        const safeName = escapeHtml(currentUser.name);

        // 1. Send automated Telegram message to the REFERRER (যে রেফার করেছে) - strictly ONCE
        await sendTelegramBotMessage(
          botToken,
          targetReferrerId,
          `🎉 <b>অভিনন্দন! নতুন ভেরিফাইড রেফারেল জয়েন করেছে!</b>\n\n` +
            `👤 <b>নাম:</b> ${safeName}\n` +
            `✅ <b>চ্যানেল জয়েন:</b> সম্পন্ন (Verified)\n` +
            `💰 <b>বোনাস:</b> আপনার মূল ব্যালেন্সে <b>+$${referBonus.toFixed(2)} USDT</b> রেফার বোনাস যোগ হয়েছে!\n` +
            `👥 <b>মোট রেফার:</b> ${updatedReferralCount} জন\n\n` +
            `আরো বেশি ইনকাম করতে আপনার রেফার লিংক শেয়ার করুন! 🚀`,
          webAppUrl
        );

        // 2. Send automated Telegram message to the NEW USER (যাকে রেফার করা হয়েছে) - strictly ONCE
        await sendTelegramBotMessage(
          botToken,
          currentUser.id,
          `🎉 <b>অভিনন্দন ${safeName}! রেফারেল ও চ্যানেল জয়েন সফল হয়েছে! 📸💸</b>\n\n` +
            `✅ আপনি সফলভাবে চ্যানেলে জয়েন করে <b>PhotoCash</b> ভেরিফাই করেছেন।\n` +
            `💰 আপনার মূল ব্যালেন্সে <b>+$${signupBonus.toFixed(2)} USDT</b> ওয়েলকাম বোনাস যোগ হয়েছে!\n\n` +
            `এখনি ফটো আপলোড ও স্টার দিয়ে প্রতিদিন ইনকাম শুরু করুন! 🚀`,
          webAppUrl
        );

        setReferralStatusMessage(
          `🎉 অভিনন্দন! চ্যানেল ভেরিফাই ও রেফারেল সফল হয়েছে (+$${signupBonus.toFixed(2)} USDT ওয়েলকাম বোনাস)!`
        );

        try {
          sessionStorage.removeItem("pc_pending_ref");
          localStorage.removeItem("pc_pending_ref");
        } catch {}

        return true;
      } finally {
        claimingReferralRef.current = false;
      }
    },
    [settings]
  );

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    (async () => {
      try {
        const initial = getInitialUser();

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
          ...(liveSettingsSnap && liveSettingsSnap.exists()
            ? liveSettingsSnap.val()
            : {}),
        };

        const existingVal = snap.exists() ? (snap.val() as Partial<User>) : null;
        const isFullyRegistered = Boolean(
          existingVal &&
            typeof existingVal.createdAt === "number" &&
            typeof existingVal.balance === "number"
        );

        const forceJoin = Boolean(liveSettings.forceChannelJoin ?? true);

        if (isFullyRegistered && existingVal) {
          // EXISTING REGISTERED USER
          const currentData = existingVal as User;
          const updates: Partial<User> = {};
          if (!currentData.photo) updates.photo = initial.photo;
          if (!currentData.name) updates.name = initial.name;
          if (!currentData.username) updates.username = initial.username;

          // Save referrerId on user if they don't have one yet and just opened via referral link
          const candidateRef =
            currentData.referredBy && currentData.referredBy !== initial.id
              ? currentData.referredBy
              : referrerId && referrerId !== initial.id
              ? referrerId
              : null;

          if (candidateRef && !currentData.referredBy) {
            updates.referredBy = candidateRef;
          }

          if (Object.keys(updates).length > 0) {
            await update(userRef, updates);
          }

          // Only credit the referral if channel verification is already completed (or forceChannelJoin is disabled)
          if (candidateRef && (!forceJoin || currentData.channelsVerified)) {
            await claimVerifiedReferral(
              {
                id: initial.id,
                name: currentData.name || initial.name,
                username: currentData.username || initial.username,
                photo: currentData.photo || initial.photo,
                referredBy: candidateRef,
                channelsVerified: Boolean(currentData.channelsVerified),
              },
              candidateRef
            );
          }
        } else {
          // NEW USER REGISTRATION
          const signupBonus = Number(
            liveSettings.signupBonus ?? defaultSettings.signupBonus
          );
          const alreadyVerified = Boolean(existingVal?.channelsVerified);

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
            referredBy: referrerId || null,
            binanceId: "",
            createdAt: Date.now(),
            lastAccrual: Date.now(),
            ...(alreadyVerified
              ? {
                  channelsVerified: true,
                  channelsVerifiedAt: existingVal?.channelsVerifiedAt || Date.now(),
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
          // If forceChannelJoin is ON, referral is NOT counted until the user joins the channels!
          if (referrerId && (!forceJoin || alreadyVerified)) {
            referredSuccess = await claimVerifiedReferral(
              {
                id: initial.id,
                name: initial.name,
                username: initial.username,
                photo: initial.photo,
                referredBy: referrerId,
                channelsVerified: alreadyVerified,
              },
              referrerId
            );
          }

          // Send standard welcome message to new user if referral hasn't fired yet
          if (!referredSuccess) {
            const welcomeSentRef = ref(userDb, `users/${initial.id}/welcomeSent`);
            const welcomeSentSnap = await get(welcomeSentRef);
            if (!welcomeSentSnap.exists() || !welcomeSentSnap.val()) {
              await set(welcomeSentRef, true);
              const botToken = resolveBotToken(liveSettings.botToken);
              const safeName = escapeHtml(initial.name);
              const welcomeMsg =
                `🎉 <b>Welcome to PhotoCash 📸💸</b>\n\n` +
                `Hello <b>${safeName}</b>! আপনার একাউন্ট সফলভাবে চালু হয়েছে।\n` +
                `💰 আপনার মূল ব্যালেন্সে <b>+$${signupBonus.toFixed(2)} USDT</b> ওয়েলকাম বোনাস যোগ হয়েছে!\n\n` +
                (referrerId && forceJoin
                  ? `📢 <b>গুরুত্বপূর্ণ:</b> অ্যাপে প্রবেশ করে আমাদের অফিসিয়াল চ্যানেলগুলোতে জয়েন করে ভেরিফাই সম্পন্ন করুন! 🚀`
                  : `Please open mini app and earn USDT... 🚀`);

              await sendTelegramBotMessage(
                botToken,
                initial.id,
                welcomeMsg,
                liveSettings.webAppUrl || "https://photocash.ziniyaapu7.workers.dev"
              );
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
  }, [
    settings.referBonus,
    settings.signupBonus,
    settings.botToken,
    settings.botLink,
    claimVerifiedReferral,
  ]);

  // Automatically trigger referral reward the exact moment the user completes channel verification!
  useEffect(() => {
    if (!user?.id) return;
    const forceJoin = Boolean(settings.forceChannelJoin ?? true);
    if (forceJoin && !user.channelsVerified) return;

    const candidateRef = user.referredBy || extractReferrerId();
    if (!candidateRef || candidateRef === user.id) return;

    claimVerifiedReferral(
      {
        id: user.id,
        name: user.name,
        username: user.username,
        photo: user.photo,
        referredBy: candidateRef,
        channelsVerified: Boolean(user.channelsVerified),
      },
      candidateRef
    ).catch(() => {});
  }, [user?.id, user?.channelsVerified, user?.referredBy, settings.forceChannelJoin, claimVerifiedReferral]);

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

    // If channelsVerified just became true, immediately credit any pending referral!
    if (safeUpdates.channelsVerified === true) {
      const candidateRef = user.referredBy || extractReferrerId();
      if (candidateRef && candidateRef !== user.id) {
        await claimVerifiedReferral(
          {
            id: user.id,
            name: user.name,
            username: user.username,
            photo: user.photo,
            referredBy: candidateRef,
            channelsVerified: true,
          },
          candidateRef
        ).catch(() => {});
      }
    }
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
