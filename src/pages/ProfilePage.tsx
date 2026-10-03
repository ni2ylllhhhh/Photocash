import { useState, useRef, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ref, query, orderByChild, onValue } from "firebase/database";
import { contentDb } from "../firebase";
import { Post } from "../types";
import { useUser } from "../context/UserContext";
import { useSettings } from "../context/SettingsContext";
import { LayoutShell } from "../components/Navigation";
import {
  formatUSDT,
  formatCompactNumber,
  uploadImageToImgbb,
} from "../utils";
import {
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"grid" | "photos" | "reels">("grid");
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [nameInput, setNameInput] = useState(user?.name ?? "");
  const [bioInput, setBioInput] = useState(user?.bio ?? "");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<Post | null>(null);

  const [allPosts, setAllPosts] = useState<Post[]>([]);

  useEffect(() => {
    const pRef = query(ref(contentDb, "posts"), orderByChild("createdAt"));
    const unsubscribe = onValue(pRef, (snapshot) => {
      const data = snapshot.val() || {};
      const list: Post[] = Object.entries(data).map(([id, val]: [string, any]) => ({
        id,
        authorId: val.authorId || "",
        authorName: val.authorName || "Unknown user",
        authorUsername: val.authorUsername || "user",
        authorPhoto: val.authorPhoto || "",
        caption: val.caption ?? "",
        imageUrl: val.imageUrl || "",
        createdAt: val.createdAt || 0,
        likes: val.likes || {},
        comments: val.comments || {},
      }));
      list.sort((a, b) => b.createdAt - a.createdAt);
      setAllPosts(list);
    });
    return () => unsubscribe();
  }, []);

  const myPosts = useMemo(
    () => allPosts.filter((p) => p.authorId === user?.id),
    [allPosts, user?.id]
  );

  const followersCount = user?.followers ? Object.keys(user.followers).length : 0;
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

        <h1 className="mt-2 text-[20px] font-extrabold leading-tight text-ink">
          {user?.name}
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

        {Boolean(settings.forceChannelJoin) && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("open-channel-modal"))}
            className="mt-2.5 flex w-full items-center justify-between rounded-2xl border border-red-500/30 bg-gradient-to-r from-red-50 to-rose-50 px-3.5 py-2.5 text-left transition active:scale-[0.99]"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-600 text-white shadow-sm">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="white" className="-rotate-12">
                  <path d="M21.5 2.5L2 10.5L9.5 14.5L13.5 21.5L21.5 2.5Z" />
                </svg>
              </span>
              <div>
                <p className="text-[12px] font-black text-red-950">Telegram Channels (চ্যানেল ভেরিফিকেশন)</p>
                <p className="text-[10px] text-red-700/80">ভেরিফিকেশন স্ট্যাটাস ও চ্যানেল লিংক</p>
              </div>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-[10.5px] font-black shadow-sm ${
                user?.channelsVerified
                  ? "bg-emerald-600 text-white"
                  : "bg-red-600 text-white animate-pulse"
              }`}
            >
              {user?.channelsVerified ? "✓ Verified" : "ভেরিফাই করুন →"}
            </span>
          </button>
        )}

        <div className="mt-3 grid grid-cols-3 border-b border-line">
          {(
            [
              ["grid", LayoutGrid],
              ["photos", ImageIcon],
              ["reels", Clapperboard],
            ] as const
          ).map(([key, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key as any)}
              aria-label={key}
              className={`flex justify-center pb-2 ${
                tab === key ? "border-b-2 border-ink text-ink" : "text-muted"
              }`}
            >
              <Icon size={19} />
            </button>
          ))}
        </div>

        {myPosts.length === 0 ? (
          <p className="py-10 text-center text-[12px] text-muted">
            {tab === "reels" ? "No reels yet." : "No posts yet — upload a photo to start earning."}
          </p>
        ) : tab === "reels" ? (
          <p className="py-10 text-center text-[12px] text-muted">No reels yet.</p>
        ) : (
          <div className="mt-1.5 grid grid-cols-3 gap-1 pb-3">
            {myPosts.map((post) => (
              <button
                key={post.id}
                type="button"
                onClick={() => setSelectedPhoto(post)}
                className="relative aspect-square overflow-hidden rounded-md bg-canvas"
              >
                <img
                  src={post.imageUrl}
                  alt={post.caption}
                  className="h-full w-full object-cover"
                />
                <span className="absolute bottom-1 right-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-white">
                  ❤️ {Object.keys(post.likes || {}).length}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

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

      {selectedPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3"
          onClick={() => setSelectedPhoto(null)}
        >
          <img
            src={selectedPhoto.imageUrl}
            alt={selectedPhoto.caption}
            className="max-h-[80vh] w-full object-contain"
          />
        </div>
      )}
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
