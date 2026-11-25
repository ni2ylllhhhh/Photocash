import { useState, useRef, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ref, query, orderByKey, limitToLast, onValue } from "firebase/database";
import { contentDb } from "../firebase";
import { Post } from "../types";
import { useUser } from "../context/UserContext";
import { useSettings } from "../context/SettingsContext";
import { LayoutShell } from "../components/Navigation";
import { PostCard } from "../components/PostCard";
import { CommentModal } from "../components/CommentModal";
import { VerifiedBadge } from "../components/VerifiedBadge";
import {
  formatUSDT,
  formatCompactNumber,
  uploadImageToImgbb,
} from "../utils";
import {
  getPostLikesCount,
  getProfileFollowersCount,
  useEngagementTick,
} from "../utils/postEngagement";
import { compareNewestFirst, safeCacheList } from "../utils/sortByNewest";
import {
  ArrowLeft,
  Ellipsis,
  Pencil,
  DollarSign,
  LayoutGrid,
  Image as ImageIcon,
  Clapperboard,
  LoaderCircle,
  X,
} from "lucide-react";

export function ProfilePage() {
  const navigate = useNavigate();
  const { user, updateUser } = useUser();
  const { settings } = useSettings();
  const now = useEngagementTick(15000);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"feed" | "photos" | "reels">("feed");
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [nameInput, setNameInput] = useState(user?.name ?? "");
  const [bioInput, setBioInput] = useState(user?.bio ?? "");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [commentPost, setCommentPost] = useState<Post | null>(null);

  const [postLimit, setPostLimit] = useState(12);
  const [needsFallback, setNeedsFallback] = useState(false);

  const [userSpecificPosts, setUserSpecificPosts] = useState<Post[]>(() => {
    try {
      sessionStorage.removeItem("pc_cached_posts");
      if (user?.id) {
        const cachedUser = sessionStorage.getItem(`pc_user_posts_v2_${user.id}`);
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
              .filter((p: Post) => p.authorId === user.id)
              .sort((a: Post, b: Post) => compareNewestFirst(a, b));
          }
        }
      }
    } catch {}
    return [];
  });

  const [postsLoading, setPostsLoading] = useState<boolean>(() => {
    try {
      if (user?.id && sessionStorage.getItem(`pc_user_posts_v2_${user.id}`)) {
        return false;
      }
    } catch {}
    return true;
  });

  const [fallbackPosts, setFallbackPosts] = useState<Post[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    // Re-hydrate instantly if user.id becomes available after mount
    try {
      const cachedUser = sessionStorage.getItem(`pc_user_posts_v2_${user.id}`);
      if (cachedUser) {
        const parsed = JSON.parse(cachedUser);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setUserSpecificPosts([...parsed].sort((a, b) => compareNewestFirst(a, b)));
          setPostsLoading(false);
        }
      }
    } catch {}

    // Fetch only the latest batch from user_posts for sub-second loading
    const userPostsQuery = query(
      ref(contentDb, `user_posts/${user.id}`),
      orderByKey(),
      limitToLast(postLimit)
    );
    const unsubscribeUserPosts = onValue(userPostsQuery, (snapshot) => {
      const data = snapshot.val() || {};
      const nowMs = Date.now();
      const list: Post[] = Object.entries(data).map(([id, val]: [string, any]) => ({
        id,
        authorId: val.authorId || user.id,
        authorName: val.authorName || user.name,
        authorUsername: val.authorUsername || user.username,
        authorPhoto: val.authorPhoto || user.photo,
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
        safeCacheList(`pc_user_posts_v2_${user.id}`, list, 12);
      } else {
        try {
          sessionStorage.removeItem(`pc_user_posts_v2_${user.id}`);
        } catch {}
        setNeedsFallback(true);
      }
    });

    return () => unsubscribeUserPosts();
  }, [user?.id, postLimit]);

  // Only query global posts if user_posts/${user.id} is empty (legacy accounts)
  useEffect(() => {
    if (!needsFallback || !user?.id) return;
    const pRef = query(ref(contentDb, "posts"), orderByKey(), limitToLast(25));
    const unsubscribeFeed = onValue(pRef, (snapshot) => {
      const data = snapshot.val() || {};
      const nowMs = Date.now();
      const list: Post[] = Object.entries(data)
        .filter(([, val]: [string, any]) => val?.authorId === user.id)
        .map(([id, val]: [string, any]) => ({
          id,
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
  }, [needsFallback, user?.id]);

  // Seamlessly load older posts as user scrolls down
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

  const myPosts = useMemo(() => {
    if (userSpecificPosts.length > 0) return userSpecificPosts;
    return fallbackPosts;
  }, [userSpecificPosts, fallbackPosts]);

  const followersCount = getProfileFollowersCount(user, now);
  const followingCount = user?.following ? Object.keys(user.following).length : 0;

  const handleAvatarChange = async (file?: File) => {
    if (!file) return;
    setAvatarUploading(true);
    try {
      const url = await uploadImageToImgbb(file, settings.imgbbKeys || settings.imgbbKey);
      await updateUser({ photo: url });
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSaveProfile = async () => {
    await updateUser({
      name: nameInput.trim() || user?.name,
      bio: bioInput.trim(),
    });
    setEditModalOpen(false);
  };

  return (
    <LayoutShell>
      <div className="relative h-24 bg-gradient-to-r from-amber-50 via-white to-pink-50">
        <div className="absolute left-3 top-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}
            aria-label="Back"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/70 bg-white/75 text-ink shadow-xs active:scale-95"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="text-[16px] font-extrabold tracking-tight text-ink">
            Profile
          </span>
        </div>
        <button
          type="button"
          onClick={() => navigate("/wallet")}
          aria-label="More"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-white/70 bg-white/60 text-ink"
        >
          <Ellipsis size={16} />
        </button>
      </div>

      <div className="px-3">
        <div className="-mt-10 flex items-end justify-between">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="relative"
          >
            <img
              src={user?.photo}
              alt={user?.name}
              className="h-20 w-20 rounded-full border-4 border-canvas object-cover"
            />
            {avatarUploading && (
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white">
                <LoaderCircle size={18} className="animate-spin" />
              </span>
            )}
            <span className="brand-grad absolute bottom-1 right-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-canvas text-white">
              <Pencil size={11} />
            </span>
          </button>
          <span className="mb-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-muted">
            ID: {user?.id}
          </span>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleAvatarChange(e.target.files?.[0])}
        />

        <h1 className="mt-2 flex items-center gap-1.5 text-[20px] font-extrabold leading-tight text-ink">
          <span className="truncate">{user?.name}</span>
          <VerifiedBadge className="h-[19px] w-[19px]" />
        </h1>
        <p className="text-[13px] text-muted">@{user?.username}</p>
        {user?.bio && <p className="mt-1 text-[12px] text-ink">{user.bio}</p>}

        <section className="mt-2.5 grid grid-cols-3 divide-x divide-line rounded-2xl bg-white py-2.5 text-center">
          <StatBox value={formatCompactNumber(user?.postCount ?? myPosts.length)} label="Posts" />
          <StatBox value={formatCompactNumber(followersCount)} label="Followers" />
          <StatBox value={formatCompactNumber(followingCount)} label="Following" />
        </section>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setNameInput(user?.name ?? "");
              setBioInput(user?.bio ?? "");
              setEditModalOpen(true);
            }}
            className="flex items-center justify-center gap-1.5 rounded-full bg-white py-2 text-[13px] font-bold text-ink active:scale-[0.98]"
          >
            <Pencil size={14} /> Edit profile
          </button>
          <button
            type="button"
            onClick={() => navigate("/wallet")}
            className="brand-grad flex items-center justify-center gap-1.5 rounded-full py-2 text-[13px] font-bold text-white active:scale-[0.98]"
          >
            <DollarSign size={14} /> Earnings {formatUSDT(user?.balance ?? 0, 2)}
          </button>
        </div>

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

      {postsLoading && myPosts.length === 0 ? (
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
      ) : myPosts.length === 0 ? (
        <p className="px-3 py-10 text-center text-[12px] text-muted">
          {tab === "reels" ? "No reels yet." : "No posts yet — upload a photo to start earning."}
        </p>
      ) : tab === "reels" ? (
        <p className="px-3 py-10 text-center text-[12px] text-muted">No reels yet.</p>
      ) : tab === "feed" ? (
        <div className="mt-1.5">
          {myPosts.map((post) => (
            <div key={post.id} id={`my-profile-post-${post.id}`}>
              <PostCard post={post} onComment={setCommentPost} />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-1.5 grid grid-cols-3 gap-1 px-3 pb-3">
          {myPosts.map((post) => (
            <button
              key={post.id}
              type="button"
              onClick={() => {
                setTab("feed");
                setTimeout(() => {
                  document
                    .getElementById(`my-profile-post-${post.id}`)
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

      {editModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-0">
          <div className="w-full max-w-[480px] rounded-t-2xl bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-bold text-ink">Edit profile</h2>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-canvas"
              >
                <X size={14} />
              </button>
            </div>

            <label className="text-[11px] font-semibold text-muted" htmlFor="pname">
              Name
            </label>
            <input
              id="pname"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              className="mb-3 mt-1 w-full rounded-xl bg-canvas px-3 py-2 text-[13px] outline-none"
            />

            <label className="text-[11px] font-semibold text-muted" htmlFor="pbio">
              Bio
            </label>
            <textarea
              id="pbio"
              value={bioInput}
              rows={2}
              onChange={(e) => setBioInput(e.target.value)}
              className="mb-3 mt-1 w-full resize-none rounded-xl bg-canvas px-3 py-2 text-[13px] outline-none"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mb-2 w-full rounded-full bg-canvas py-2 text-[13px] font-semibold text-ink"
            >
              Change photo from gallery
            </button>

            <button
              type="button"
              onClick={handleSaveProfile}
              className="brand-grad w-full rounded-full py-2.5 text-[13px] font-bold text-white"
            >
              Save changes
            </button>
          </div>
        </div>
      )}

      <CommentModal
        post={(commentPost && myPosts.find((p) => p.id === commentPost.id)) || commentPost}
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
