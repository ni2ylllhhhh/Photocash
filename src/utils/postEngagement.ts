import { useState, useEffect } from "react";
import { Post, Comment } from "../types";
import { generateAvatar } from "../utils";

const AUTO_COMMENTERS = [
  "Tanvir Hasan",
  "Nusrat Jahan",
  "Sabbir Rahman",
  "Mim Akter",
  "Rakib Hossain",
  "Farhana Islam",
  "Mehedi Hasan",
  "Sadia Afrin",
  "Arif Mahmud",
  "Jannatul Ferdous",
  "Shakib Alom",
  "Tania Sultana",
  "Fahim Ahmed",
  "Riya Moni",
  "Sohanur Rahman",
  "Nadia Islam",
  "Mahmudul Hasan",
  "Sumaiya Akter",
  "Imran Khan",
  "Puja Roy",
  "Nayeem Islam",
  "Tasnim Zara",
  "Rashedul Alam",
  "Lamia Islam",
];

const AUTO_COMMENTS_POOL: Array<{ text: string; emoji: string }> = [
  { text: "অসাধারণ ছবি ভাই! 🔥", emoji: "🔥" },
  { text: "মাশাল্লাহ অনেক সুন্দর লাগছে ❤️", emoji: "❤️" },
  { text: "Wow nice click 😍", emoji: "😍" },
  { text: "দারুণ হয়েছে পোষ্টটা 👏", emoji: "👏" },
  { text: "Superb photography! ✨", emoji: "👍" },
  { text: "খুবই চমৎকার ছবি 🥰", emoji: "❤️" },
  { text: "Amazing shot bro 🔥", emoji: "🔥" },
  { text: "সেরা ছবি আজকের! 🎉", emoji: "🎉" },
  { text: "অনেক সুন্দর ভিউ 😍", emoji: "😍" },
  { text: "Love this frame ❤️", emoji: "❤️" },
  { text: "Nice post 👍", emoji: "👍" },
  { text: "চমৎকার কালার ও ফ্রেমিং 💯", emoji: "⚡" },
  { text: "Keep it up! 🚀", emoji: "💰" },
  { text: "দেখে মন ভালো হয়ে গেল 😍", emoji: "😍" },
  { text: "Awesome picture! 👏", emoji: "👏" },
  { text: "অস্থির ছবি তুলেছেন 🔥", emoji: "🔥" },
];

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Automatic followers: +20 virtual followers every 10 minutes (600,000 ms),
 * incrementing smoothly, plus base 320 and real followers.
 */
export function getAutoFollowersCount(
  userId: string,
  createdAt?: number,
  now = Date.now()
): number {
  if (!createdAt || createdAt <= 0 || now <= createdAt) return 0;
  const elapsedMs = Math.max(0, now - createdAt);
  const completedHours = Math.floor(elapsedMs / 3600000);
  const uid = String(userId || "default");

  const cycleRates: number[] = [];
  let cycleSum = 0;
  for (let k = 0; k < 64; k++) {
    const rate = 15 + (hashString(`${uid}_fhr_${k}`) % 6);
    cycleRates.push(rate);
    cycleSum += rate;
  }

  const fullCycles = Math.floor(completedHours / 64);
  const remainderHours = completedHours % 64;

  let total = fullCycles * cycleSum;
  for (let k = 0; k < remainderHours; k++) {
    total += cycleRates[k];
  }

  // +20 followers virtually every 10 minutes
  const tenMinBlocks = Math.floor((elapsedMs % 3600000) / 600000);
  total += tenMinBlocks * 20;

  return total;
}

export function getProfileFollowersCount(
  user?: {
    id?: string;
    createdAt?: number;
    joined_at?: number;
    followers?: Record<string, boolean>;
  } | null,
  now = Date.now()
): number {
  const baseFollowers = 320;
  const realFollowers = user?.followers ? Object.keys(user.followers).length : 0;
  const startTs = Number(user?.createdAt || user?.joined_at || 0);
  const autoFollowers = getAutoFollowersCount(user?.id || "user", startTs, now);
  return baseFollowers + realFollowers + autoFollowers;
}

/**
 * +7 automatic likes every 1 full minute since post creation,
 * plus all real user likes stored in post.likes.
 */
export function getAutoLikesCount(createdAt: number, now = Date.now()): number {
  if (!createdAt || createdAt <= 0) return 0;
  const elapsedMinutes = Math.max(0, Math.floor((now - createdAt) / 60000));
  return elapsedMinutes * 7;
}

/**
 * +2 automatic comments every 5 full minutes since post creation.
 */
export function getAutoCommentsCount(createdAt: number, now = Date.now()): number {
  if (!createdAt || createdAt <= 0) return 0;
  const elapsedFiveMinBlocks = Math.max(0, Math.floor((now - createdAt) / 300000));
  return elapsedFiveMinBlocks * 2;
}

export function getPostLikesCount(
  post: Post,
  now = Date.now(),
  optimisticLiked?: boolean | null,
  currentUserId?: string
): number {
  const likesMap = post.likes || {};
  let realLikes = Object.keys(likesMap).length;

  if (
    currentUserId &&
    optimisticLiked !== undefined &&
    optimisticLiked !== null
  ) {
    const alreadyInDb = Boolean(likesMap[currentUserId]);
    if (optimisticLiked && !alreadyInDb) {
      realLikes += 1;
    } else if (!optimisticLiked && alreadyInDb) {
      realLikes = Math.max(0, realLikes - 1);
    }
  }

  return realLikes + getAutoLikesCount(post.createdAt, now);
}

export function getPostCommentsCount(post: Post, now = Date.now()): number {
  const realComments = post.comments ? Object.keys(post.comments).length : 0;
  return realComments + getAutoCommentsCount(post.createdAt, now);
}

/**
 * Returns real user comments combined with deterministic auto-generated comments
 * (+2 comments every 5 minutes) sorted newest first.
 */
export function getCombinedPostComments(
  post: Post,
  now = Date.now(),
  maxAutoToRender = 40
): Comment[] {
  const realList: Comment[] = post.comments ? Object.values(post.comments) : [];
  const totalAuto = getAutoCommentsCount(post.createdAt, now);

  const autoList: Comment[] = [];
  if (totalAuto > 0 && post.createdAt > 0) {
    const startIdx = Math.max(0, totalAuto - maxAutoToRender);
    for (let i = startIdx; i < totalAuto; i++) {
      const intervalIndex = Math.floor(i / 2) + 1; // 1-based 5-min block
      const isSecondInPair = i % 2 === 1;
      const seed = hashString(`${post.id}_auto_cmt_${i}`);

      const name = AUTO_COMMENTERS[seed % AUTO_COMMENTERS.length];
      const commentObj =
        AUTO_COMMENTS_POOL[(seed >> 3) % AUTO_COMMENTS_POOL.length];
      const offsetMs = isSecondInPair
        ? (seed % 20) * 1000
        : -((15 + (seed % 35)) * 1000);
      const commentTime = Math.min(
        now,
        post.createdAt + intervalIndex * 300000 + offsetMs
      );

      autoList.push({
        id: `auto_${post.id}_${i}`,
        uid: `auto_user_${seed % 10000}`,
        name,
        photo: generateAvatar(name, `${post.id}_${i}`),
        emoji: commentObj.emoji,
        text: commentObj.text,
        createdAt: commentTime,
      });
    }
  }

  return [...realList, ...autoList].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Hook that triggers a re-render every 8 seconds so that the +7 likes/1min
 * and +2 comments/5min counters tick up live on screen automatically.
 */
export function useEngagementTick(intervalMs = 8000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
