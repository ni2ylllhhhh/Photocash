import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ref, query, orderByKey, limitToLast, onValue } from "firebase/database";
import { contentDb } from "../firebase";
import { Story } from "../types";
import { useUser } from "../context/UserContext";
import { VerifiedBadge } from "./VerifiedBadge";
import { formatTimeAgo, generateAvatar } from "../utils";
import { compareNewestFirst, safeCacheList } from "../utils/sortByNewest";
import { Plus, X, ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";

interface StoryGroup {
  key: string;
  authorId: string;
  authorName: string;
  authorPhoto: string;
  stories: Story[];
  latestCreatedAt: number;
  latestKey: string;
}

export function StoriesBar() {
  const [storyQueryLimit, setStoryQueryLimit] = useState(50);
  const [groupLimit, setGroupLimit] = useState(15);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalFetchedCount, setTotalFetchedCount] = useState(0);

  const [stories, setStories] = useState<Story[]>(() => {
    try {
      sessionStorage.removeItem("pc_cached_stories");
      const cached = sessionStorage.getItem("pc_cached_stories_v3");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          return [...parsed].sort((a, b) => compareNewestFirst(a, b));
        }
      }
    } catch {}
    return [];
  });
  const { user } = useUser();
  const navigate = useNavigate();
  const [activeGroupIndex, setActiveGroupIndex] = useState<number | null>(null);
  const [activeSlideIndex, setActiveSlideIndex] = useState<number>(0);

  useEffect(() => {
    // Load only the latest batch from Firebase initially to keep Firebase load minimal
    const storiesQuery = query(
      ref(contentDb, "stories"),
      orderByKey(),
      limitToLast(storyQueryLimit)
    );
    const unsubscribe = onValue(storiesQuery, (snapshot) => {
      const data = snapshot.val() || {};
      const entries = Object.entries(data);
      setTotalFetchedCount(entries.length);

      const now = Date.now();
      const list: Story[] = entries
        .map(([id, s]: [string, any]) => ({
          id: s?.id || id,
          authorId: s?.authorId || "",
          authorName: s?.authorName || "User",
          authorPhoto:
            s?.authorPhoto || generateAvatar(s?.authorName || "U", s?.authorId || id),
          imageUrl: s?.imageUrl || "",
          createdAt: Math.min(Number(s?.createdAt) || 0, now),
        }))
        .filter((s) => Boolean(s.imageUrl))
        .sort((a, b) => compareNewestFirst(a, b, now));

      setStories(list);
      setLoadingMore(false);
      safeCacheList("pc_cached_stories_v3", list, 50);
    });
    return () => unsubscribe();
  }, [storyQueryLimit]);

  // Group stories by author: one card per user, ordered with newest poster first
  const storyGroups = useMemo<StoryGroup[]>(() => {
    const map = new Map<string, StoryGroup>();
    const now = Date.now();

    for (const s of stories) {
      const groupKey =
        (s.authorId && s.authorId.trim()) ||
        (s.authorName && s.authorName.trim().toLowerCase()) ||
        s.id;

      const existing = map.get(groupKey);
      if (!existing) {
        map.set(groupKey, {
          key: groupKey,
          authorId: s.authorId || "",
          authorName: s.authorName || "User",
          authorPhoto:
            s.authorPhoto || generateAvatar(s.authorName || "U", groupKey),
          stories: [s],
          latestCreatedAt: s.createdAt || 0,
          latestKey: s.id || "",
        });
      } else {
        existing.stories.push(s);
        const isNewer =
          compareNewestFirst(
            s,
            { id: existing.latestKey, createdAt: existing.latestCreatedAt },
            now
          ) < 0;
        if (isNewer) {
          existing.latestCreatedAt = s.createdAt || 0;
          existing.latestKey = s.id || "";
          if (s.authorName) existing.authorName = s.authorName;
          if (s.authorPhoto) existing.authorPhoto = s.authorPhoto;
        }
      }
    }

    return Array.from(map.values())
      .map((g) => ({
        ...g,
        stories: [...g.stories].sort((a, b) => compareNewestFirst(a, b, now)),
      }))
      .sort((a, b) =>
        compareNewestFirst(
          { id: a.latestKey, createdAt: a.latestCreatedAt },
          { id: b.latestKey, createdAt: b.latestCreatedAt },
          now
        )
      );
  }, [stories]);

  const visibleGroups = useMemo(
    () => storyGroups.slice(0, groupLimit),
    [storyGroups, groupLimit]
  );

  const hasMoreToLoad =
    storyGroups.length > groupLimit || totalFetchedCount >= storyQueryLimit;

  const handleSeeMore = () => {
    const nextLimit = groupLimit + 15;
    setGroupLimit(nextLimit);
    if (storyGroups.length < nextLimit + 5 && totalFetchedCount >= storyQueryLimit) {
      setLoadingMore(true);
      setStoryQueryLimit((prev) => prev + 80);
    }
  };

  const activeGroup =
    activeGroupIndex !== null && visibleGroups[activeGroupIndex]
      ? visibleGroups[activeGroupIndex]
      : null;

  const activeStory =
    activeGroup && activeGroup.stories[activeSlideIndex]
      ? activeGroup.stories[activeSlideIndex]
      : null;

  const openGroup = (groupIdx: number) => {
    setActiveGroupIndex(groupIdx);
    setActiveSlideIndex(0);
  };

  const closeViewer = () => {
    setActiveGroupIndex(null);
    setActiveSlideIndex(0);
  };

  const handleNextStory = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (activeGroupIndex === null || !activeGroup) return;

    if (activeSlideIndex < activeGroup.stories.length - 1) {
      setActiveSlideIndex(activeSlideIndex + 1);
    } else if (activeGroupIndex < visibleGroups.length - 1) {
      setActiveGroupIndex(activeGroupIndex + 1);
      setActiveSlideIndex(0);
    } else {
      closeViewer();
    }
  };

  const handlePrevStory = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (activeGroupIndex === null || !activeGroup) return;

    if (activeSlideIndex > 0) {
      setActiveSlideIndex(activeSlideIndex - 1);
    } else if (activeGroupIndex > 0) {
      const prevGroup = visibleGroups[activeGroupIndex - 1];
      setActiveGroupIndex(activeGroupIndex - 1);
      setActiveSlideIndex(Math.max(0, prevGroup.stories.length - 1));
    }
  };

  const hasPrev =
    activeGroupIndex !== null && (activeSlideIndex > 0 || activeGroupIndex > 0);
  const hasNext =
    activeGroupIndex !== null &&
    activeGroup !== null &&
    (activeSlideIndex < activeGroup.stories.length - 1 ||
      activeGroupIndex < visibleGroups.length - 1);

  return (
    <>
      <div className="no-scrollbar flex gap-2 overflow-x-auto bg-white px-3 pb-2.5 pt-1">
        <button
          type="button"
          onClick={() => navigate("/create?story=1")}
          className="relative h-[110px] w-[74px] shrink-0 overflow-hidden rounded-xl bg-canvas"
          aria-label="Add story"
        >
          {user?.photo && (
            <img
              src={user.photo}
              alt=""
              className="h-full w-full object-cover opacity-70"
            />
          )}
          <span className="absolute inset-x-0 bottom-0 bg-white/95 py-1 text-center text-[9px] font-semibold text-ink">
            Add story
          </span>
          <span className="brand-grad absolute left-1/2 top-2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full text-white shadow-sm">
            <Plus size={13} />
          </span>
        </button>

        {visibleGroups.map((group, idx) => {
          const coverStory = group.stories[0];

          return (
            <button
              key={group.key}
              type="button"
              onClick={() => openGroup(idx)}
              className="relative h-[110px] w-[74px] shrink-0 overflow-hidden rounded-xl bg-black transition active:scale-95"
            >
              <img
                src={coverStory.imageUrl}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <img
                src={group.authorPhoto}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = generateAvatar(
                    group.authorName,
                    group.key
                  );
                }}
                alt=""
                className="absolute left-1.5 top-1.5 h-6 w-6 rounded-full border-2 border-brand-pink object-cover"
              />
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/85 via-black/40 to-transparent px-1 pb-1 pt-3 text-left text-[9px] font-semibold text-white">
                {group.authorName}
              </span>
            </button>
          );
        })}

        {hasMoreToLoad && (
          <button
            type="button"
            onClick={handleSeeMore}
            disabled={loadingMore}
            className="flex h-[110px] w-[74px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-line bg-canvas text-ink transition hover:bg-slate-200/70 active:scale-95"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-brand-pink shadow-xs">
              {loadingMore ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <ChevronRight size={18} />
              )}
            </span>
            <span className="text-[10px] font-bold text-ink">See more</span>
          </button>
        )}
      </div>

      {activeGroup && activeStory && activeGroupIndex !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 select-none"
          onClick={handleNextStory}
        >
          {/* Segmented Progress bar for current user's stories */}
          <div className="absolute left-3 right-3 top-2 z-20 flex gap-1">
            {activeGroup.stories.map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-all ${
                  i === activeSlideIndex
                    ? "bg-white"
                    : i < activeSlideIndex
                    ? "bg-white/65"
                    : "bg-white/25"
                }`}
              />
            ))}
          </div>

          <img
            src={activeStory.imageUrl}
            alt=""
            className="max-h-full max-w-full object-contain"
          />

          {/* Left tap zone */}
          <div
            onClick={(e) => {
              e.stopPropagation();
              handlePrevStory(e);
            }}
            className="absolute inset-y-16 left-0 z-10 w-1/3"
          />

          {/* Author Header */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (activeGroup.authorId) {
                closeViewer();
                navigate(`/u/${activeGroup.authorId}`);
              }
            }}
            className="absolute left-3 top-5 z-20 flex items-center gap-2 text-left focus:outline-none"
          >
            <img
              src={activeGroup.authorPhoto}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = generateAvatar(
                  activeGroup.authorName,
                  activeGroup.key
                );
              }}
              alt=""
              className="h-9 w-9 rounded-full border border-white/50 object-cover shadow"
            />
            <div className="flex flex-col">
              <span className="flex items-center gap-1 text-[13px] font-bold text-white drop-shadow">
                <span>{activeGroup.authorName}</span>
                <VerifiedBadge className="h-[14px] w-[14px]" />
              </span>
              <span className="text-[10px] font-medium text-white/80 drop-shadow">
                {formatTimeAgo(activeStory.createdAt)}
              </span>
            </div>
          </button>

          {/* Close button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              closeViewer();
            }}
            aria-label="Close story"
            className="absolute right-3 top-5 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition active:scale-90"
          >
            <X size={18} />
          </button>

          {/* Previous / Next tap navigation buttons */}
          {hasPrev && (
            <button
              type="button"
              onClick={handlePrevStory}
              aria-label="Previous story"
              className="absolute left-2 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur transition active:scale-90"
            >
              <ChevronLeft size={22} />
            </button>
          )}

          {hasNext && (
            <button
              type="button"
              onClick={handleNextStory}
              aria-label="Next story"
              className="absolute right-2 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur transition active:scale-90"
            >
              <ChevronRight size={22} />
            </button>
          )}
        </div>
      )}
    </>
  );
}
