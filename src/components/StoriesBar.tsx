import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ref, query, orderByKey, limitToLast, onValue } from "firebase/database";
import { contentDb } from "../firebase";
import { Story } from "../types";
import { useUser } from "../context/UserContext";
import { VerifiedBadge } from "./VerifiedBadge";
import { Plus, X, ChevronLeft, ChevronRight } from "lucide-react";

function formatStoryTime(timestamp?: number): string {
  if (!timestamp) return "";
  const diffMs = Date.now() - timestamp;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return "24h ago";
}

export function StoriesBar() {
  const [stories, setStories] = useState<Story[]>(() => {
    try {
      const cached = sessionStorage.getItem("pc_cached_stories");
      if (cached) {
        const parsed = JSON.parse(cached);
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        return parsed.filter((s: any) => s && s.createdAt > cutoff);
      }
    } catch {}
    return [];
  });
  const { user } = useUser();
  const navigate = useNavigate();
  const [activeStoryIndex, setActiveStoryIndex] = useState<number | null>(null);

  useEffect(() => {
    // Fetch all active stories from the database within the 24-hour window (expanded from 5 to 150)
    const storiesQuery = query(
      ref(contentDb, "stories"),
      orderByKey(),
      limitToLast(150)
    );
    const unsubscribe = onValue(storiesQuery, (snapshot) => {
      const data = snapshot.val() || {};
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const list: Story[] = (Object.values(data) as any[])
        .filter((s: any) => s && s.imageUrl && s.createdAt > cutoff)
        .sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0));
      setStories(list);
      try {
        sessionStorage.setItem("pc_cached_stories", JSON.stringify(list));
      } catch {}
    });
    return () => unsubscribe();
  }, []);

  const activeStory =
    activeStoryIndex !== null && stories[activeStoryIndex]
      ? stories[activeStoryIndex]
      : null;

  const handleNextStory = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (activeStoryIndex === null) return;
    if (activeStoryIndex < stories.length - 1) {
      setActiveStoryIndex(activeStoryIndex + 1);
    } else {
      setActiveStoryIndex(null);
    }
  };

  const handlePrevStory = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (activeStoryIndex === null) return;
    if (activeStoryIndex > 0) {
      setActiveStoryIndex(activeStoryIndex - 1);
    }
  };

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
          <span className="absolute inset-x-0 bottom-0 bg-white/95 py-1 text-[9px] font-semibold text-ink text-center">
            Add story
          </span>
          <span className="brand-grad absolute left-1/2 top-2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full text-white shadow-sm">
            <Plus size={13} />
          </span>
        </button>

        {stories.map((story, idx) => (
          <button
            key={story.id || idx}
            type="button"
            onClick={() => setActiveStoryIndex(idx)}
            className="relative h-[110px] w-[74px] shrink-0 overflow-hidden rounded-xl bg-black transition active:scale-95"
          >
            <img
              src={story.imageUrl}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
            <img
              src={story.authorPhoto}
              alt=""
              className="absolute left-1.5 top-1.5 h-6 w-6 rounded-full border-2 border-brand-pink object-cover"
            />
            <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/85 via-black/40 to-transparent px-1 pb-1 pt-3 text-left text-[9px] font-semibold text-white">
              {story.authorName}
            </span>
          </button>
        ))}
      </div>

      {activeStory && activeStoryIndex !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 select-none"
          onClick={handleNextStory}
        >
          {/* Top Progress bar indicator */}
          <div className="absolute left-3 right-3 top-2 flex gap-1 z-20">
            {stories.slice(0, 30).map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-all ${
                  i === activeStoryIndex
                    ? "bg-white"
                    : i < activeStoryIndex
                    ? "bg-white/60"
                    : "bg-white/20"
                }`}
              />
            ))}
          </div>

          <img
            src={activeStory.imageUrl}
            alt=""
            className="max-h-full max-w-full object-contain"
          />

          {/* Author Header */}
          <div className="absolute left-3 top-5 z-20 flex items-center gap-2">
            <img
              src={activeStory.authorPhoto}
              alt=""
              className="h-9 w-9 rounded-full border border-white/50 object-cover shadow"
            />
            <div className="flex flex-col">
              <span className="flex items-center gap-1 text-[13px] font-bold text-white drop-shadow">
                <span>{activeStory.authorName}</span>
                <VerifiedBadge className="h-[14px] w-[14px]" />
              </span>
              <span className="text-[10px] font-medium text-white/80 drop-shadow">
                {formatStoryTime(activeStory.createdAt)}
              </span>
            </div>
          </div>

          {/* Close button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setActiveStoryIndex(null);
            }}
            aria-label="Close story"
            className="absolute right-3 top-5 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition active:scale-90"
          >
            <X size={18} />
          </button>

          {/* Previous / Next tap navigation buttons */}
          {activeStoryIndex > 0 && (
            <button
              type="button"
              onClick={handlePrevStory}
              aria-label="Previous story"
              className="absolute left-2 top-1/2 -translate-y-1/2 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur transition active:scale-90"
            >
              <ChevronLeft size={22} />
            </button>
          )}

          {activeStoryIndex < stories.length - 1 && (
            <button
              type="button"
              onClick={handleNextStory}
              aria-label="Next story"
              className="absolute right-2 top-1/2 -translate-y-1/2 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur transition active:scale-90"
            >
              <ChevronRight size={22} />
            </button>
          )}
        </div>
      )}
    </>
  );
}
