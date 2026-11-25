import { useState, useMemo, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ref, onValue, query, orderByKey, limitToLast } from "firebase/database";
import { userDb, contentDb } from "../firebase";
import { User, Post } from "../types";
import { useUser } from "../context/UserContext";
import { LayoutShell } from "../components/Navigation";
import { PostCard } from "../components/PostCard";
import { CommentModal } from "../components/CommentModal";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { formatCompactNumber } from "../utils";
import {
  getPostLikesCount,
  getProfileFollowersCount,
  useEngagementTick,
} from "../utils/postEngagement";
import { compareNewestFirst, safeCacheList } from "../utils/sortByNewest";
import {
  ArrowLeft,
  UserCheck,
  UserPlus,
  LayoutGrid,
  Image as ImageIcon,
  Clapperboard,
} from "lucide-react";

export function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, toggleFollow, isFollowing } = useUser();
  const now = useEngagementTick(15000);

  const [profile, setProfile] = useState<User | null>(() => {
    if (!id) return null;
    try {
      const cached = sessionStorage.getItem(`pc_user_profile_v1_${id}`);
      if (cached) return JSON.parse(cached);
    } catch {}
    return null;
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (!id) return true;
    try {
      return !sessionStorage.getItem(`pc_user_profile_v1_${id}`);
    } catch {
      return true;
    }
  });
  const [tab, setTab] = useState<"feed" | "photos" | "reels">("feed");
  const [commentPost, setCommentPost] = useState<Post | null>(null);
  const [postLimit, setPostLimit] = useState(12);
  const [needsFallback, setNeedsFallback] = useState(false);

  const [userSpecificPosts, setUserSpecificPosts] = useState<Post[]>(() => {
    if (!id) return [];
    try {
      const cachedUser = sessionStorage.getItem(`pc_user_posts_v2_${id}`);
      if (cachedUser) {
        const parsed = JSON.parse(cachedUser);
        if (Array.isArray(parsed)) {
          return [...parsed].sort((a, b) => compareNewestFirst(a, b));
        }
      }
      const cachedFeed = sessionStorage.getItem("pc_cached_posts_v2");
      if (cachedFeed) {
        const parsed = JSON.parse(cachedFeed);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((p: Post) => p.authorId === id)
            .sort((a: Post, b: Post) => compareNewestFirst(a, b));
        }
      }
    } catch {}
    return [];
  });
  const [postsLoading, setPostsLoading] = useState<boolean>(() => {
    if (!id) return true;
    try {
      return !sessionStorage.getItem(`pc_user_posts_v2_${id}`);
    } catch {
      return true;
    }
  });
  const [fallbackPosts, setFallbackPosts] = useState<Post[]>([]);

  useEffect(() => {
    if (!id) return;
    setPostLimit(12);
    setNeedsFallback(false);
    setFallbackPosts([]);

    let hasCachedProfile = false;
    try {
      const cached = sessionStorage.getItem(`pc_user_profile_v1_${id}`);
      if (cached) {
        setProfile(JSON.parse(cached));
        setLoading(false);
        hasCachedProfile = true;
      } else {
        // Instant lightweight preview from feed/stories/search caches if available
        const feedRaw = sessionStorage.getItem("pc_cached_posts_v2");
        if (feedRaw) {
          const match = (JSON.parse(feedRaw) as Post[]).find((p) => p.authorId === id);
          if (match) {
            setProfile({
              id,
              name: match.authorName,
              username: match.authorUsername || "user",
              photo: match.authorPhoto,
              bio: "",
              balance: 0,
              totalEarned: 0,
              todayEarned: 0,
              todayKey: "",
              postCount: 0,
              referrals: 0,
              referredBy: null,
              binanceId: "",
              createdAt: 0,
            });
            setLoading(false);
          }
        }
      }
    } catch {}
    if (!hasCachedProfile) setLoading(true);

    const uRef = ref(userDb, `users/${id}`);
    const unsubscribe = onValue(uRef, (snap) => {
      const val = snap.val() as User | null;
      setProfile(val);
      setLoading(false);
      if (val) {
        try {
          // Strip heavy history array before caching profile metadata
          const { history: _omitHistory, ...lightProfile } = val as User & { history?: unknown };
          sessionStorage.setItem(`pc_user_profile_v1_${id}`, JSON.stringify(lightProfile));
        } catch {}
      } else {
        try {
          sessionStorage.removeItem(`pc_user_profile_v1_${id}`);
          sessionStorage.removeItem(`pc_user_posts_v2_${id}`);
        } catch {}
      }
    });
    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    try {
      const cachedUser = sessionStorage.getItem(`pc_user_posts_v2_${id}`);
      if (cachedUser) {
        const parsed = JSON.parse(cachedUser);
        if (Array.isArray(parsed)) {
          setUserSpecificPosts([...parsed].sort((a, b) => compareNewestFirst(a, b)));
          setPostsLoading(false);
        }
      }
    } catch {}

    const userPostsQuery = query(
      ref(contentDb, `user_posts/${id}`),
      orderByKey(),
      limitToLast(postLimit)
    );
    const unsubscribeUserPosts = onValue(userPostsQuery, (snapshot) => {
      const data = snapshot.val() || {};
      const nowMs = Date.now();
      const list: Post[] = Object.entries(data).map(([pid, val]: [string, any]) => ({
        id: pid,
        authorId: val.authorId || id,
        authorName: val.authorName || "Unknown user",
        authorUsername: val.authorUsername || "user",
        authorPhoto: val.authorPhoto || "",
        caption: val.caption ?? "",
        imageUrl: val.imageUrl || "",
        createdAt: val.createdAt || 0,
        likes: val.likes || {},
        stars: val.stars || 0,
        starsCount: val.starsCount ?? (typeof val.stars === "number" ? val.stars : 0),
        comments: val.comments || {},
      }));
      list.sort((a, b) => compareNewestFirst(a, b, nowMs));
      setUserSpecificPosts(list);
      if (list.length > 0) {
        setPostsLoading(false);
        setNeedsFallback(false);
        safeCacheList(`pc_user_posts_v2_${id}`, list, 12);
      } else {
        try {
          sessionStorage.removeItem(`pc_user_posts_v2_${id}`);
        } catch {}
        setNeedsFallback(true);
      }
    });

    return () => unsubscribeUserPosts();
  }, [id, postLimit]);

  // Conditional fallback only when user_posts/${id} is empty
  useEffect(() => {
    if (!needsFallback || !id) return;
    const pRef = query(ref(contentDb, "posts"), orderByKey(), limitToLast(25));
    const unsubscribeFeed = onValue(pRef, (snapshot) => {
      const data = snapshot.val() || {};
      const nowMs = Date.now();
      const list: Post[] = Object.entries(data)
        .filter(([, val]: [string, any]) => val?.authorId === id)
        .map(([pid, val]: [string, any]) => ({
          id: pid,
          authorId: val.authorId || "",
          authorName: val.authorName || "Unknown user",
          authorUsername: val.authorUsername || "user",
          authorPhoto:
            val.authorPhoto ||
            "https://ui-avatars.com/api/?name=U&background=f2295b&color=fff&size=128&bold=true",
          caption: val.caption ?? "",
          imageUrl: val.imageUrl || "",
          createdAt: val.createdAt || 0,
          likes: val.likes || {},
          stars: val.stars || 0,
          starsCount: val.starsCount ?? (typeof val.stars === "number" ? val.stars : 0),
          comments: val.comments || {},
        }));
      list.sort((a, b) => compareNewestFirst(a, b, nowMs));
      setFallbackPosts(list);
      setPostsLoading(false);
    });
    return () => unsubscribeFeed();
  }, [needsFallback, id]);

  useEffect(() => {
    const handleScroll = () => {
      if (
        userSpecificPosts.length >= postLimit &&
        window.innerHeight + window.scrollY >=
          document.documentElement.scrollHeight - 600
      ) {
        setPostLimit((prev) => (prev < 120 ? prev + 12 : prev));
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [userSpecificPosts.length, postLimit]);

  const userPosts = useMemo(() => {
    if (userSpecificPosts.length > 0) return userSpecificPosts;
    return fallbackPosts;
  }, [userSpecificPosts, fallbackPosts]);

  if (!loading && !profile) {
    return (
      <LayoutShell className="px-3 pt-6">
        <p className="text-center text-[13px] text-muted">User not found.</p>
      </LayoutShell>
    );
  }

  const followersCount = getProfileFollowersCount(
    profile ? { ...profile, id: profile.id || id } : null,
    now
  );
  const followingCount = profile?.following ? Object.keys(profile.following).length : 0;
  const isMe = user?.id === id;
  const following = id ? isFollowing(id) : false;

  return (
    <LayoutShell>
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-white px-3 py-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="p-1"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="flex min-w-0 items-center gap-1 text-[15px] font-bold text-ink">
          <span className="truncate">{profile?.name ?? "Profile"}</span>
          <VerifiedBadge className="h-[15px] w-[15px]" />
        </h1>
      </header>

      <div className="h-20 bg-gradient-to-r from-amber-50 via-white to-pink-50" />

      <div className="px-3">
        <img
          src={profile?.photo}
          alt={profile?.name}
          className="-mt-10 h-20 w-20 rounded-full border-4 border-canvas object-cover"
        />

        <h2 className="mt-2 flex items-center gap-1.5 text-[19px] font-extrabold leading-tight text-ink">
          <span className="truncate">{profile?.name}</span>
          <VerifiedBadge className="h-[18px] w-[18px]" />
        </h2>
        <p className="text-[13px] text-muted">@{profile?.username}</p>
        {profile?.bio && <p className="mt-1 text-[12px] text-ink">{profile.bio}</p>}

        <section className="mt-2.5 grid grid-cols-3 divide-x divide-line rounded-2xl bg-white py-2.5 text-center">
          <StatBox value={formatCompactNumber(profile?.postCount ?? userPosts.length)} label="Posts" />
          <StatBox value={formatCompactNumber(followersCount)} label="Followers" />
          <StatBox value={formatCompactNumber(followingCount)} label="Following" />
        </section>

        {!isMe && (
          <button
            type="button"
            onClick={() => id && toggleFollow(id)}
            className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-full py-2 text-[13px] font-bold active:scale-[0.98] ${
              following ? "bg-white text-ink" : "brand-grad text-white"
            }`}
          >
            {following ? <UserCheck size={14} /> : <UserPlus size={14} />}
            {following ? "Following" : "Follow"}
          </button>
        )}

        <div className="mt-3 grid grid-cols-3 border-b border-line">
          {(
            [
              ["feed", LayoutGrid],
              ["photos", ImageIcon],
              ["reels", Clapperboard],
            ] as const
          ).map(([key, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-label={key}
              className={`flex justify-center pb-2 ${
                tab === key ? "border-b-2 border-ink text-ink" : "text-muted"
              }`}
            >
              <Icon size={19} />
            </button>
          ))}
        </div>
      </div>

      {postsLoading && userPosts.length === 0 ? (
        <div className="mt-1.5 space-y-1.5">
          {[0, 1].map((idx) => (
            <div key={idx} className="bg-white p-3">
              <div className="mb-2 flex items-center gap-2">
                <div className="h-9 w-9 animate-pulse rounded-full bg-canvas" />
                <div className="h-3 w-28 animate-pulse rounded bg-canvas" />
              </div>
              <div className="h-44 w-full animate-pulse rounded bg-canvas" />
            </div>
          ))}
        </div>
      ) : userPosts.length === 0 ? (
        <p className="py-10 text-center text-[12px] text-muted">
          {tab === "reels" ? "No reels yet." : "No posts yet."}
        </p>
      ) : tab === "reels" ? (
        <p className="py-10 text-center text-[12px] text-muted">No reels yet.</p>
      ) : tab === "feed" ? (
        <div className="mt-1.5">
          {userPosts.map((post) => (
            <div key={post.id} id={`user-profile-post-${post.id}`}>
              <PostCard post={post} onComment={setCommentPost} />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-1.5 grid grid-cols-3 gap-1 px-3 pb-3">
          {userPosts.map((post) => (
            <button
              key={post.id}
              type="button"
              onClick={() => {
                setTab("feed");
                setTimeout(() => {
                  document
                    .getElementById(`user-profile-post-${post.id}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }, 50);
              }}
              className="relative aspect-square overflow-hidden rounded-md bg-canvas"
            >
              <img
                src={post.imageUrl}
                alt={post.caption}
                className="h-full w-full object-cover"
              />
              <span className="absolute bottom-1 right-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-white">
                ❤️ {formatCompactNumber(getPostLikesCount(post, now))}
              </span>
            </button>
          ))}
        </div>
      )}

      <CommentModal
        post={(commentPost && userPosts.find((p) => p.id === commentPost.id)) || commentPost}
        onClose={() => setCommentPost(null)}
      />
    </LayoutShell>
  );
}

function StatBox({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-[17px] font-extrabold leading-tight text-ink">{value}</p>
      <p className="text-[11px] text-muted">{label}</p>
    </div>
  );
}
