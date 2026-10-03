import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ref, query, orderByChild, limitToLast, onValue } from "firebase/database";
import { contentDb } from "../firebase";
import { Post } from "../types";
import { useUser } from "../context/UserContext";
import { useSettings } from "../context/SettingsContext";
import { LayoutShell } from "../components/Navigation";
import { Header } from "../components/Header";
import { StoriesBar } from "../components/StoriesBar";
import { PostCard } from "../components/PostCard";
import { AdBanner } from "../components/AdBanner";
import { CommentModal } from "../components/CommentModal";
import {
  Image as ImageIcon,
  Sparkles,
  ListChecks,
  Trophy,
  Gift,
} from "lucide-react";

const FEED_TABS = [
  { label: "For you", Icon: Sparkles },
  { label: "Following", Icon: ListChecks },
  { label: "Top earners", Icon: Trophy },
  { label: "Rewards", Icon: Gift },
];

export function HomePage() {
  const navigate = useNavigate();
  const { user, referralStatusMessage, dismissReferralMessage } = useUser();
  const { settings } = useSettings();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTab, setCurrentTab] = useState("For you");
  const [commentPost, setCommentPost] = useState<Post | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const postsQuery = query(
      ref(contentDb, "posts"),
      orderByChild("createdAt"),
      limitToLast(200)
    );
    const unsubscribe = onValue(postsQuery, (snapshot) => {
      const data = snapshot.val() || {};
      const list: Post[] = Object.entries(data).map(([id, val]: [string, any]) => ({
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
        comments: val.comments || {},
      }));
      list.sort((a, b) => b.createdAt - a.createdAt);
      setPosts(list);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const filteredPosts = useMemo(() => {
    let result = posts;
    if (currentTab === "Following") {
      result = result.filter((p) => user?.following?.[p.authorId]);
    }
    if (currentTab === "Top earners") {
      result = [...result].sort(
        (a, b) => Object.keys(b.likes || {}).length - Object.keys(a.likes || {}).length
      );
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          (p.caption ?? "").toLowerCase().includes(q) ||
          (p.authorName ?? "").toLowerCase().includes(q) ||
          (p.authorUsername ?? "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [posts, currentTab, user?.following, searchQuery]);

  const activeCommentPost =
    commentPost && posts.find((p) => p.id === commentPost.id) || null;

  return (
    <LayoutShell>
      <Header onSearch={() => setSearchOpen((prev) => !prev)} />

      {Boolean(settings.forceChannelJoin) && !user?.channelsVerified && (
        <div
          onClick={() => window.dispatchEvent(new CustomEvent("open-channel-modal"))}
          className="mx-3 my-2 flex cursor-pointer items-center justify-between rounded-xl border border-red-500/50 bg-gradient-to-r from-red-600 via-rose-600 to-red-600 px-3 py-2 text-white shadow-md transition active:scale-[0.99] hover:brightness-105"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[14px] animate-bounce">📢</span>
            <p className="truncate text-[11.5px] font-bold">
              টেলিগ্রাম চ্যানেলে জয়েন করুন (ভেরিফিকেশন আবশ্যক)
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-black/30 px-2 py-0.5 text-[10px] font-black text-amber-300">
            জয়েন করুন →
          </span>
        </div>
      )}

      {referralStatusMessage && (
        <div className="mx-3 my-2 flex items-center justify-between rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-2.5 text-white shadow">
          <div className="flex items-center gap-2">
            <span className="text-[16px]">🎉</span>
            <p className="text-[12px] font-bold leading-tight">{referralStatusMessage}</p>
          </div>
          <button
            type="button"
            onClick={dismissReferralMessage}
            className="ml-2 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-white/30"
          >
            OK
          </button>
        </div>
      )}

      {searchOpen && (
        <div className="border-b border-line bg-white px-3 py-2">
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search people or posts"
            className="w-full rounded-full bg-canvas px-3 py-1.5 text-[13px] outline-none"
          />
        </div>
      )}

      <div className="flex items-center gap-2 bg-white px-3 py-2">
        <img
          src={user?.photo}
          alt=""
          className="h-8 w-8 rounded-full object-cover"
        />
        <button
          type="button"
          onClick={() => navigate("/create")}
          className="flex-1 rounded-full bg-canvas px-3 py-2 text-left text-[13px] text-muted"
        >
          What's on your mind?
        </button>
        <button
          type="button"
          onClick={() => navigate("/create")}
          aria-label="Upload photo"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-canvas text-ink"
        >
          <ImageIcon size={16} />
        </button>
      </div>

      <StoriesBar />

      <div className="no-scrollbar flex gap-2 overflow-x-auto border-b-[6px] border-canvas bg-white px-3 py-2">
        {FEED_TABS.map(({ label, Icon }) => (
          <button
            key={label}
            type="button"
            onClick={() => setCurrentTab(label)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${
              currentTab === label ? "brand-grad text-white" : "bg-canvas text-ink"
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-1.5">
          {[0, 1].map((idx) => (
            <div key={idx} className="bg-white p-3">
              <div className="mb-2 flex items-center gap-2">
                <div className="h-9 w-9 animate-pulse rounded-full bg-canvas" />
                <div className="h-3 w-28 animate-pulse rounded bg-canvas" />
              </div>
              <div className="h-48 w-full animate-pulse rounded bg-canvas" />
            </div>
          ))}
        </div>
      ) : filteredPosts.length === 0 ? (
        <div className="bg-white px-6 py-14 text-center">
          <p className="text-[13px] font-semibold text-ink">No posts yet</p>
          <p className="mt-1 text-[12px] text-muted">
            Upload your first photo and start earning USDT.
          </p>
          <button
            type="button"
            onClick={() => navigate("/create")}
            className="brand-grad mt-3 rounded-full px-4 py-1.5 text-[12px] font-bold text-white"
          >
            Create post
          </button>
        </div>
      ) : (
        filteredPosts.map((post, index) => (
          <div key={post.id}>
            <PostCard post={post} onComment={setCommentPost} />
            <AdBanner index={index} />
          </div>
        ))
      )}

      <CommentModal
        post={activeCommentPost}
        onClose={() => setCommentPost(null)}
      />
    </LayoutShell>
  );
}
