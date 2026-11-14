import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ref, query, orderByKey, limitToLast, get } from "firebase/database";
import { contentDb, userDb, userFirebaseConfig } from "../firebase";
import { Post } from "../types";
import { useUser } from "../context/UserContext";
import { LayoutShell } from "../components/Navigation";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { PostCard } from "../components/PostCard";
import { CommentModal } from "../components/CommentModal";
import { formatCompactNumber, generateAvatar } from "../utils";
import { getProfileFollowersCount, useEngagementTick } from "../utils/postEngagement";
import { compareNewestFirst } from "../utils/sortByNewest";
import {
  ArrowLeft,
  Search,
  X,
  UserPlus,
  UserCheck,
  Users,
  Image as ImageIcon,
  LoaderCircle,
  Clock,
} from "lucide-react";

interface SearchableUser {
  id: string;
  user_id?: string;
  name: string;
  first_name?: string;
  username: string;
  photo: string;
  bio?: string;
  postCount?: number;
  referrals?: number;
  createdAt?: number;
  joined_at?: number;
  last_active?: number;
  followers?: Record<string, boolean>;
  banned?: boolean;
  hasRealPost?: boolean;
}

// Module-level directory cache so revisiting /search is instantaneous
let cachedFullDirectory: SearchableUser[] | null = null;
let cachedFullDirectoryPromise: Promise<SearchableUser[]> | null = null;

function mapRawUser(id: string, val: any): SearchableUser | null {
  if (!val || typeof val !== "object") return null;
  if (val.banned) return null;
  const uid = String(val.id || val.user_id || id || "").trim();
  if (!uid) return null;
  const name = String(val.name || val.first_name || "").trim();
  if (!name) return null;
  const username = String(val.username || "").trim();
  const photo =
    String(val.photo || "").trim() || generateAvatar(name, uid);

  return {
    id: uid,
    user_id: val.user_id ? String(val.user_id) : undefined,
    name,
    first_name: val.first_name ? String(val.first_name) : undefined,
    username,
    photo,
    bio: val.bio ? String(val.bio) : undefined,
    postCount: Number(val.postCount) || 0,
    referrals: Number(val.referrals) || 0,
    createdAt: Number(val.createdAt) || 0,
    joined_at: Number(val.joined_at) || 0,
    last_active: Number(val.last_active) || 0,
    followers: val.followers && typeof val.followers === "object" ? val.followers : undefined,
  };
}

async function fetchFullDirectoryOnce(): Promise<SearchableUser[]> {
  if (cachedFullDirectory) return cachedFullDirectory;
  if (cachedFullDirectoryPromise) return cachedFullDirectoryPromise;

  cachedFullDirectoryPromise = (async () => {
    try {
      const res = await fetch(`${userFirebaseConfig.databaseURL}/users.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: SearchableUser[] = [];
      if (data && typeof data === "object") {
        for (const [id, val] of Object.entries(data)) {
          const mapped = mapRawUser(id, val);
          if (mapped) list.push(mapped);
        }
      }
      cachedFullDirectory = list;
      return list;
    } catch (err) {
      console.error("Background user directory load failed:", err);
      cachedFullDirectoryPromise = null;
      return [];
    }
  })();

  return cachedFullDirectoryPromise;
}

function isRealCustomPhoto(url?: string): boolean {
  if (!url) return false;
  return !url.includes("ui-avatars.com");
}

export function SearchPage() {
  const navigate = useNavigate();
  const { user, toggleFollow, isFollowing } = useUser();
  const now = useEngagementTick(15000);
  const inputRef = useRef<HTMLInputElement>(null);

  const [queryText, setQueryText] = useState("");
  const [activeTab, setActiveTab] = useState<"people" | "posts">("people");
  const [seedUsers, setSeedUsers] = useState<SearchableUser[]>(() => {
    try {
      const cached = sessionStorage.getItem("pc_search_seed_users_v1");
      if (cached) return JSON.parse(cached);
    } catch {}
    return [];
  });
  const [fullDirectory, setFullDirectory] = useState<SearchableUser[]>(
    () => cachedFullDirectory || []
  );
  const [directoryLoading, setDirectoryLoading] = useState<boolean>(
    () => !cachedFullDirectory
  );
  const [directIdMatches, setDirectIdMatches] = useState<SearchableUser[]>([]);
  const [recentPosts, setRecentPosts] = useState<Post[]>([]);
  const [commentPost, setCommentPost] = useState<Post | null>(null);
  const [visibleCount, setVisibleCount] = useState(30);
  const [recentSearches, setRecentSearches] = useState<SearchableUser[]>(() => {
    try {
      const raw = localStorage.getItem("pc_recent_searched_users");
      if (raw) return JSON.parse(raw);
    } catch {}
    return [];
  });

  // 1. Fast initial load: recent post creators + latest users (< 500ms)
  useEffect(() => {
    let active = true;

    async function loadFastSeeds() {
      try {
        const [postsSnap, usersSnap] = await Promise.all([
          get(query(ref(contentDb, "posts"), orderByKey(), limitToLast(80))),
          get(query(ref(userDb, "users"), orderByKey(), limitToLast(60))),
        ]);

        if (!active) return;

        const map = new Map<string, SearchableUser>();

        // Extract posts for Posts tab + real active creators
        const postsVal = postsSnap.val() || {};
        const postList: Post[] = Object.entries(postsVal).map(([id, val]: [string, any]) => ({
          id,
          authorId: val.authorId || "",
          authorName: val.authorName || "Unknown user",
          authorUsername: val.authorUsername || "user",
          authorPhoto:
            val.authorPhoto || generateAvatar(val.authorName || "U", val.authorId || id),
          caption: val.caption ?? "",
          imageUrl: val.imageUrl || "",
          createdAt: val.createdAt || 0,
          likes: val.likes || {},
          stars: val.stars || 0,
          starsCount: val.starsCount ?? (typeof val.stars === "number" ? val.stars : 0),
          comments: val.comments || {},
        }));

        const nowMs = Date.now();
        postList.sort((a, b) => compareNewestFirst(a, b, nowMs));
        setRecentPosts(postList);

        for (const p of postList) {
          if (!p.authorId) continue;
          const existing = map.get(p.authorId);
          if (!existing) {
            map.set(p.authorId, {
              id: p.authorId,
              name: p.authorName,
              username: p.authorUsername,
              photo: p.authorPhoto,
              postCount: 1,
              createdAt: p.createdAt,
              last_active: p.createdAt,
              hasRealPost: true,
            });
          } else {
            existing.postCount = (existing.postCount || 0) + 1;
            existing.hasRealPost = true;
            if (isRealCustomPhoto(p.authorPhoto)) {
              existing.photo = p.authorPhoto;
            }
          }
        }

        // Merge recent users from userDb
        const usersVal = usersSnap.val() || {};
        for (const [uid, val] of Object.entries(usersVal)) {
          const mapped = mapRawUser(uid, val);
          if (!mapped) continue;
          const existing = map.get(mapped.id);
          if (existing) {
            map.set(mapped.id, {
              ...mapped,
              hasRealPost: existing.hasRealPost,
              postCount: Math.max(mapped.postCount || 0, existing.postCount || 0),
              photo: isRealCustomPhoto(mapped.photo) ? mapped.photo : existing.photo,
            });
          } else {
            map.set(mapped.id, mapped);
          }
        }

        const merged = Array.from(map.values());
        setSeedUsers(merged);
        try {
          sessionStorage.setItem(
            "pc_search_seed_users_v1",
            JSON.stringify(merged.slice(0, 60))
          );
        } catch {}
      } catch (err) {
        console.error("Fast search seed load error:", err);
      }
    }

    loadFastSeeds();

    // 2. Load full user directory in background for instant search across all 9,600+ users
    if (!cachedFullDirectory) {
      setDirectoryLoading(true);
      fetchFullDirectoryOnce().then((list) => {
        if (!active) return;
        setFullDirectory(list);
        setDirectoryLoading(false);
      });
    } else {
      setFullDirectory(cachedFullDirectory);
      setDirectoryLoading(false);
    }

    return () => {
      active = false;
    };
  }, []);

  // 3. Direct instant exact lookup by ID / Chat ID whenever user types a numeric ID
  useEffect(() => {
    const clean = queryText.trim().replace(/^@/, "");
    const digitsOnly = clean.replace(/[^0-9]/g, "");
    if (!digitsOnly || digitsOnly.length < 5) {
      setDirectIdMatches([]);
      return;
    }

    let cancelled = false;
    get(ref(userDb, `users/${digitsOnly}`))
      .then((snap) => {
        if (cancelled || !snap.exists()) return;
        const mapped = mapRawUser(digitsOnly, snap.val());
        if (mapped) {
          setDirectIdMatches([mapped]);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [queryText]);

  // Combine seedUsers, fullDirectory, and directIdMatches cleanly (preferring richer entries)
  const combinedUsers = useMemo(() => {
    const map = new Map<string, SearchableUser>();

    for (const u of fullDirectory) {
      map.set(u.id, u);
    }
    for (const u of seedUsers) {
      const existing = map.get(u.id);
      if (existing) {
        map.set(u.id, {
          ...existing,
          hasRealPost: u.hasRealPost || existing.hasRealPost,
          postCount: Math.max(existing.postCount || 0, u.postCount || 0),
          photo: isRealCustomPhoto(existing.photo) ? existing.photo : u.photo,
        });
      } else {
        map.set(u.id, u);
      }
    }
    for (const u of directIdMatches) {
      const existing = map.get(u.id);
      map.set(u.id, existing ? { ...existing, ...u } : u);
    }

    return Array.from(map.values()).filter((u) => u.id !== user?.id && !u.banned);
  }, [fullDirectory, seedUsers, directIdMatches, user?.id]);

  // Facebook-style "People you may know" curated real users (real photos + active creators first)
  const suggestedPeople = useMemo(() => {
    const list = [...combinedUsers];
    list.sort((a, b) => {
      const scoreA =
        (a.hasRealPost ? 100 : 0) +
        (isRealCustomPhoto(a.photo) ? 40 : 0) +
        Math.min(a.postCount || 0, 20) +
        (a.last_active && now - a.last_active < 86400000 ? 15 : 0);
      const scoreB =
        (b.hasRealPost ? 100 : 0) +
        (isRealCustomPhoto(b.photo) ? 40 : 0) +
        Math.min(b.postCount || 0, 20) +
        (b.last_active && now - b.last_active < 86400000 ? 15 : 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return (b.last_active || b.createdAt || 0) - (a.last_active || a.createdAt || 0);
    });
    return list;
  }, [combinedUsers, now]);

  // Search matching & relevance ranking across Name, @Username, User/Chat ID, Bio
  const searchResultsUsers = useMemo(() => {
    const raw = queryText.trim();
    if (!raw) return [];
    const q = raw.toLowerCase();
    const qNoAt = q.replace(/^@/, "");

    const scored: Array<{ user: SearchableUser; score: number }> = [];

    for (const u of combinedUsers) {
      const idStr = (u.id || "").toLowerCase();
      const userIdStr = (u.user_id || "").toLowerCase();
      const uname = (u.username || "").toLowerCase();
      const nameStr = (u.name || "").toLowerCase();
      const firstStr = (u.first_name || "").toLowerCase();
      const bioStr = (u.bio || "").toLowerCase();

      let score = 0;
      if (idStr === qNoAt || userIdStr === qNoAt) score = 1000;
      else if (uname === qNoAt || nameStr === q) score = 900;
      else if (idStr.startsWith(qNoAt) || userIdStr.startsWith(qNoAt)) score = 800;
      else if (uname.startsWith(qNoAt) || nameStr.startsWith(qNoAt)) score = 700;
      else if (firstStr.startsWith(qNoAt)) score = 650;
      else if (
        nameStr.includes(qNoAt) ||
        uname.includes(qNoAt) ||
        idStr.includes(qNoAt) ||
        userIdStr.includes(qNoAt)
      ) {
        score = 500;
      } else if (bioStr.includes(qNoAt)) {
        score = 250;
      }

      if (score > 0) {
        if (isRealCustomPhoto(u.photo)) score += 20;
        if (u.hasRealPost) score += 15;
        scored.push({ user: u, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map((item) => item.user);
  }, [queryText, combinedUsers]);

  const searchResultsPosts = useMemo(() => {
    const raw = queryText.trim();
    if (!raw) return recentPosts;
    const q = raw.toLowerCase().replace(/^@/, "");
    return recentPosts.filter(
      (p) =>
        (p.caption ?? "").toLowerCase().includes(q) ||
        (p.authorName ?? "").toLowerCase().includes(q) ||
        (p.authorUsername ?? "").toLowerCase().includes(q) ||
        (p.authorId ?? "").toLowerCase().includes(q)
    );
  }, [queryText, recentPosts]);

  const handleOpenUser = (target: SearchableUser) => {
    try {
      const filtered = recentSearches.filter((r) => r.id !== target.id);
      const next = [target, ...filtered].slice(0, 8);
      setRecentSearches(next);
      localStorage.setItem("pc_recent_searched_users", JSON.stringify(next));
    } catch {}
    navigate(`/u/${target.id}`);
  };

  const handleClearRecent = () => {
    setRecentSearches([]);
    try {
      localStorage.removeItem("pc_recent_searched_users");
    } catch {}
  };

  const activeCommentPost =
    (commentPost && recentPosts.find((p) => p.id === commentPost.id)) || null;

  const isSearching = queryText.trim().length > 0;

  return (
    <LayoutShell>
      {/* Facebook-style Sticky Search Header */}
      <header className="sticky top-0 z-30 border-b border-line bg-white px-3 py-2.5 shadow-[0_1px_6px_rgba(0,0,0,0.04)]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink hover:bg-[#f0f2f5] active:scale-95"
          >
            <ArrowLeft size={20} />
          </button>

          <div className="flex flex-1 items-center gap-2 rounded-full bg-[#f0f2f5] px-3.5 py-2 focus-within:ring-2 focus-within:ring-[#1877f2]/30">
            <Search size={16} className="shrink-0 text-slate-400" />
            <input
              ref={inputRef}
              autoFocus
              type="text"
              value={queryText}
              onChange={(e) => {
                setQueryText(e.target.value);
                setVisibleCount(30);
              }}
              placeholder="Search by name or ID..."
              className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder-slate-400 outline-none"
            />
            {queryText && (
              <button
                type="button"
                onClick={() => {
                  setQueryText("");
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-300/80 text-slate-700 hover:bg-slate-400/80"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Facebook-style Filter Tabs */}
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("people")}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-bold transition ${
              activeTab === "people"
                ? "bg-[#e7f3ff] text-[#1877f2]"
                : "bg-[#f0f2f5] text-slate-600 hover:bg-slate-200/70"
            }`}
          >
            <Users size={13} />
            People{isSearching ? ` (${searchResultsUsers.length})` : ""}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("posts")}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-bold transition ${
              activeTab === "posts"
                ? "bg-[#e7f3ff] text-[#1877f2]"
                : "bg-[#f0f2f5] text-slate-600 hover:bg-slate-200/70"
            }`}
          >
            <ImageIcon size={13} />
            Posts{isSearching ? ` (${searchResultsPosts.length})` : ""}
          </button>

          {directoryLoading && (
            <span className="ml-auto flex items-center gap-1 text-[10.5px] font-semibold text-slate-400">
              <LoaderCircle size={12} className="animate-spin text-[#1877f2]" />
              Syncing users...
            </span>
          )}
        </div>
      </header>

      {/* PEOPLE TAB */}
      {activeTab === "people" && (
        <div className="space-y-2 pb-6">
          {/* 1. Search Results State */}
          {isSearching ? (
            <section className="bg-white">
              <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
                <h2 className="text-[14px] font-extrabold text-ink">
                  Search Results
                </h2>
                <span className="text-[11.5px] font-semibold text-muted">
                  {searchResultsUsers.length} found
                </span>
              </div>

              {searchResultsUsers.length === 0 ? (
                <div className="px-6 py-14 text-center">
                  {directoryLoading ? (
                    <div className="flex flex-col items-center gap-2">
                      <LoaderCircle size={24} className="animate-spin text-[#1877f2]" />
                      <p className="text-[13px] font-semibold text-ink">
                        Searching all users...
                      </p>
                      <p className="text-[11.5px] text-muted">
                        Looking up "{queryText}" across name &amp; ID
                      </p>
                    </div>
                  ) : (
                    <>
                      <p className="text-[14px] font-bold text-ink">No user found</p>
                      <p className="mt-1 text-[12px] text-muted">
                        Try searching by exact ID or full name.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <ul className="divide-y divide-line">
                    {searchResultsUsers.slice(0, visibleCount).map((u) => (
                      <FacebookUserRow
                        key={u.id}
                        target={u}
                        now={now}
                        following={isFollowing(u.id)}
                        onOpen={() => handleOpenUser(u)}
                        onToggleFollow={() => toggleFollow(u.id)}
                      />
                    ))}
                  </ul>

                  {visibleCount < searchResultsUsers.length && (
                    <div className="p-3">
                      <button
                        type="button"
                        onClick={() => setVisibleCount((prev) => prev + 30)}
                        className="w-full rounded-lg bg-[#e4e6eb] py-2 text-[13px] font-bold text-ink hover:bg-slate-300/80"
                      >
                        See more results ({searchResultsUsers.length - visibleCount} more)
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          ) : (
            <>
              {/* 2. Recent Searches (if any) */}
              {recentSearches.length > 0 && (
                <section className="bg-white px-3.5 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="flex items-center gap-1.5 text-[14px] font-extrabold text-ink">
                      <Clock size={14} className="text-slate-400" />
                      Recent
                    </h2>
                    <button
                      type="button"
                      onClick={handleClearRecent}
                      className="text-[12px] font-semibold text-[#1877f2] hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="no-scrollbar flex gap-2.5 overflow-x-auto pb-1">
                    {recentSearches.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => handleOpenUser(u)}
                        className="flex w-16 shrink-0 flex-col items-center gap-1 text-center"
                      >
                        <img
                          src={u.photo}
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).src = generateAvatar(u.name, u.id);
                          }}
                          alt={u.name}
                          className="h-12 w-12 rounded-full border border-slate-200 object-cover"
                        />
                        <span className="w-full truncate text-[11px] font-semibold text-ink">
                          {u.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* 3. Facebook-style "People you may know" Horizontal Cards */}
              {suggestedPeople.length > 0 && (
                <section className="bg-white py-3">
                  <div className="mb-2.5 flex items-center justify-between px-3.5">
                    <h2 className="text-[15px] font-extrabold text-ink">
                      People you may know
                    </h2>
                    <span className="text-[11px] font-semibold text-muted">
                      Active Creators
                    </span>
                  </div>

                  <div className="no-scrollbar flex gap-2.5 overflow-x-auto px-3.5 pb-1">
                    {suggestedPeople.slice(0, 14).map((u) => {
                      const followers = getProfileFollowersCount(u, now);
                      const following = isFollowing(u.id);

                      return (
                        <div
                          key={u.id}
                          className="flex w-[144px] shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.05)]"
                        >
                          <button
                            type="button"
                            onClick={() => handleOpenUser(u)}
                            className="relative h-[132px] w-full bg-slate-100 text-left focus:outline-none"
                          >
                            <img
                              src={u.photo}
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).src = generateAvatar(
                                  u.name,
                                  u.id
                                );
                              }}
                              alt={u.name}
                              className="h-full w-full object-cover"
                            />
                            {u.last_active && now - u.last_active < 86400000 && (
                              <span
                                title="Active recently"
                                className="absolute bottom-2 right-2 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white"
                              />
                            )}
                          </button>

                          <div className="flex flex-1 flex-col justify-between p-2">
                            <button
                              type="button"
                              onClick={() => handleOpenUser(u)}
                              className="text-left focus:outline-none"
                            >
                              <p className="flex items-center gap-1 text-[13px] font-bold text-ink">
                                <span className="truncate">{u.name}</span>
                                <VerifiedBadge className="h-[13px] w-[13px] shrink-0" />
                              </p>
                              <p className="mt-0.5 truncate text-[11px] text-muted">
                                {formatCompactNumber(followers)} followers
                              </p>
                            </button>

                            <button
                              type="button"
                              onClick={() => toggleFollow(u.id)}
                              className={`mt-2 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[12px] font-bold transition active:scale-[0.97] ${
                                following
                                  ? "bg-[#e4e6eb] text-ink"
                                  : "bg-[#1877f2] text-white"
                              }`}
                            >
                              {following ? (
                                <>
                                  <UserCheck size={13} /> Following
                                </>
                              ) : (
                                <>
                                  <UserPlus size={13} /> Follow
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* 4. Facebook-style Suggested People Vertical List */}
              <section className="bg-white">
                <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
                  <h2 className="text-[15px] font-extrabold text-ink">
                    Suggested People
                  </h2>
                  <span className="text-[11px] font-semibold text-muted">
                    {combinedUsers.length > 0
                      ? `${formatCompactNumber(combinedUsers.length)} members`
                      : "Loading..."}
                  </span>
                </div>

                {suggestedPeople.length === 0 ? (
                  <div className="divide-y divide-line">
                    {[0, 1, 2, 3, 4].map((idx) => (
                      <div key={idx} className="flex items-center gap-3 px-3.5 py-3">
                        <div className="h-13 w-13 animate-pulse rounded-full bg-slate-200" />
                        <div className="flex-1 space-y-2">
                          <div className="h-3.5 w-32 animate-pulse rounded bg-slate-200" />
                          <div className="h-2.5 w-44 animate-pulse rounded bg-slate-100" />
                        </div>
                        <div className="h-8 w-20 animate-pulse rounded-lg bg-slate-100" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <ul className="divide-y divide-line">
                      {suggestedPeople.slice(0, visibleCount).map((u) => (
                        <FacebookUserRow
                          key={u.id}
                          target={u}
                          now={now}
                          following={isFollowing(u.id)}
                          onOpen={() => handleOpenUser(u)}
                          onToggleFollow={() => toggleFollow(u.id)}
                        />
                      ))}
                    </ul>

                    {visibleCount < suggestedPeople.length && (
                      <div className="p-3">
                        <button
                          type="button"
                          onClick={() => setVisibleCount((prev) => prev + 30)}
                          className="w-full rounded-lg bg-[#e4e6eb] py-2 text-[13px] font-bold text-ink hover:bg-slate-300/80"
                        >
                          See more people
                        </button>
                      </div>
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {/* POSTS TAB */}
      {activeTab === "posts" && (
        <div className="pb-6">
          {searchResultsPosts.length === 0 ? (
            <div className="bg-white px-6 py-14 text-center">
              <p className="text-[14px] font-bold text-ink">No matching posts</p>
              <p className="mt-1 text-[12px] text-muted">
                Try another keyword or switch to the People tab.
              </p>
            </div>
          ) : (
            searchResultsPosts.map((post) => (
              <PostCard key={post.id} post={post} onComment={setCommentPost} />
            ))
          )}
        </div>
      )}

      <CommentModal post={activeCommentPost} onClose={() => setCommentPost(null)} />
    </LayoutShell>
  );
}

function FacebookUserRow({
  target,
  now,
  following,
  onOpen,
  onToggleFollow,
}: {
  target: SearchableUser;
  now: number;
  following: boolean;
  onOpen: () => void;
  onToggleFollow: () => void;
}) {
  const followers = getProfileFollowersCount(target, now);
  const isOnline = Boolean(target.last_active && now - target.last_active < 86400000);

  return (
    <li className="flex items-center gap-3 px-3.5 py-2.5 transition hover:bg-slate-50/80">
      <button
        type="button"
        onClick={onOpen}
        className="relative shrink-0 focus:outline-none"
      >
        <img
          src={target.photo}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = generateAvatar(
              target.name,
              target.id
            );
          }}
          alt={target.name}
          className="h-[52px] w-[52px] rounded-full border border-slate-200 object-cover"
        />
        {isOnline && (
          <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-emerald-500 ring-2 ring-white" />
        )}
      </button>

      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left focus:outline-none"
      >
        <p className="flex items-center gap-1 text-[14px] font-bold text-ink">
          <span className="truncate">{target.name}</span>
          <VerifiedBadge className="h-[14px] w-[14px] shrink-0" />
        </p>
        <p className="truncate text-[11.5px] font-medium text-muted">
          ID: {target.id}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {formatCompactNumber(followers)} followers
          {target.postCount && target.postCount > 0
            ? ` • ${target.postCount} post${target.postCount === 1 ? "" : "s"}`
            : ""}
        </p>
      </button>

      <button
        type="button"
        onClick={onToggleFollow}
        className={`flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-bold transition active:scale-95 ${
          following
            ? "bg-[#e4e6eb] text-ink"
            : "bg-[#e7f3ff] text-[#1877f2] hover:bg-[#dbeafe]"
        }`}
      >
        {following ? (
          <>
            <UserCheck size={13} /> Following
          </>
        ) : (
          <>
            <UserPlus size={13} /> Follow
          </>
        )}
      </button>
    </li>
  );
}
