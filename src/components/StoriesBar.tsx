import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ref, onValue } from "firebase/database";
import { contentDb } from "../firebase";
import { Story } from "../types";
import { useUser } from "../context/UserContext";
import { VerifiedBadge } from "./VerifiedBadge";
import { Plus, X } from "lucide-react";

export function StoriesBar() {
  const [stories, setStories] = useState<Story[]>([]);
  const { user } = useUser();
  const navigate = useNavigate();
  const [activeStory, setActiveStory] = useState<Story | null>(null);

  useEffect(() => {
    const storiesRef = ref(contentDb, "stories");
    const unsubscribe = onValue(storiesRef, (snapshot) => {
      const data = snapshot.val() || {};
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const list: Story[] = (Object.values(data) as any[])
        .filter((s: any) => s.createdAt > cutoff)
        .sort((a: any, b: any) => b.createdAt - a.createdAt);
      setStories(list);
    });
    return () => unsubscribe();
  }, []);

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
          <span className="brand-grad absolute left-1/2 top-2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full text-white">
            <Plus size={13} />
          </span>
        </button>

        {stories.map((story) => (
          <button
            key={story.id}
            type="button"
            onClick={() => setActiveStory(story)}
            className="relative h-[110px] w-[74px] shrink-0 overflow-hidden rounded-xl bg-black"
          >
            <img
              src={story.imageUrl}
              alt=""
              className="h-full w-full object-cover"
            />
            <img
              src={story.authorPhoto}
              alt=""
              className="absolute left-1.5 top-1.5 h-6 w-6 rounded-full border-2 border-brand-pink object-cover"
            />
            <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1 pb-1 pt-3 text-left text-[9px] font-semibold text-white">
              {story.authorName}
            </span>
          </button>
        ))}
      </div>

      {activeStory && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black"
          onClick={() => setActiveStory(null)}
        >
          <img
            src={activeStory.imageUrl}
            alt=""
            className="max-h-full w-full object-contain"
          />
          <div className="absolute left-3 top-3 flex items-center gap-2">
            <img
              src={activeStory.authorPhoto}
              alt=""
              className="h-8 w-8 rounded-full object-cover"
            />
            <span className="flex items-center gap-1 text-[13px] font-semibold text-white">
              <span>{activeStory.authorName}</span>
              <VerifiedBadge className="h-[14px] w-[14px]" />
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveStory(null)}
            aria-label="Close story"
            className="absolute right-3 top-3 text-white"
          >
            <X size={20} />
          </button>
        </div>
      )}
    </>
  );
}
