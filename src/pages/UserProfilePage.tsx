import { useState, useMemo, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ref, onValue, query, orderByChild } from "firebase/database";
import { userDb, contentDb } from "../firebase";
import { User, Post } from "../types";
import { useUser } from "../context/UserContext";
import { LayoutShell } from "../components/Navigation";
import { PostCard } from "../components/PostCard";
import { CommentModal } from "../components/CommentModal";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { formatCompactNumber } from "../utils";
import { ArrowLeft, UserCheck, UserPlus } from "lucide-react";

export function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, toggleFollow, isFollowing } = useUser();

  const [profile, setProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"grid" | "feed">("grid");
  const [commentPost, setCommentPost] = useState<Post | null>(null);
  const [allPosts, setAllPosts] = useState<Post[]>([]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    const uRef = ref(userDb, `users/${id}`);
    const unsubscribe = onValue(uRef, (snap) => {
      setProfile(snap.val());
      setLoading(false);
    });
    return () => unsubscribe();
  }, [id]);

  useEffect(() => {
    const pRef = query(ref(contentDb, "posts"), orderByChild("createdAt"));
    const unsubscribe = onValue(pRef, (snapshot) => {
      const data = snapshot.val() || {};
      const list: Post[] = Object.entries(data).map(([pid, val]: [string, any]) => ({
        id: pid,
        authorId: val.authorId || "",
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
      list.sort((a, b) => b.createdAt - a.createdAt);
      setAllPosts(list);
    });
    return () => unsubscribe();
  }, []);

  const userPosts = useMemo(
    () => allPosts.filter((p) => p.authorId === id),
    [allPosts, id]
  );

  if (!loading && !profile) {
    return (
      <LayoutShell className="px-3 pt-6">
        <p className="text-center text-[13px] text-muted">User not found.</p>
      </LayoutShell>
    );
  }

  const followersCount = 320 + (profile?.followers ? Object.keys(profile.followers).length : 0);
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

        <div className="mt-3 flex gap-4 border-b border-line">
          {(["grid", "feed"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setTab(mode)}
              className={`pb-2 text-[12px] font-bold uppercase tracking-wide ${
                tab === mode ? "border-b-2 border-ink text-ink" : "text-muted"
              }`}
            >
              {mode === "grid" ? "Photos" : "Posts"}
            </button>
          ))}
        </div>
      </div>

      {userPosts.length === 0 ? (
        <p className="py-10 text-center text-[12px] text-muted">No posts yet.</p>
      ) : tab === "grid" ? (
        <div className="mt-1.5 grid grid-cols-3 gap-1 px-3 pb-3">
          {userPosts.map((post) => (
            <button
              key={post.id}
              type="button"
              onClick={() => setTab("feed")}
              className="aspect-square overflow-hidden rounded-md bg-canvas"
            >
              <img
                src={post.imageUrl}
                alt={post.caption}
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-1.5">
          {userPosts.map((post) => (
            <PostCard key={post.id} post={post} onComment={setCommentPost} />
          ))}
        </div>
      )}

      <CommentModal
        post={commentPost}
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
