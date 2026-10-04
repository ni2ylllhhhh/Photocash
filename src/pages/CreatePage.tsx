import React, { useState, useRef, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ref, push, set, runTransaction } from "firebase/database";
import { contentDb, userDb } from "../firebase";
import { User } from "../types";
import { useUser } from "../context/UserContext";
import { useSettings } from "../context/SettingsContext";
import { LayoutShell } from "../components/Navigation";
import { formatUSDT, uploadImageToImgbb } from "../utils";
import { ArrowLeft, X, Image as ImageIcon, LoaderCircle } from "lucide-react";

export function CreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isStory = searchParams.get("story") === "1";
  const { user, distributeTierCommissions } = useUser();
  const { settings } = useSettings();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const preUploadPromiseRef = useRef<Promise<string> | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const intervalMin = settings.postRewardIntervalMin ?? 10;
  const intervalMs = intervalMin * 60 * 1000;
  const lastRewardAt = user?.lastPostRewardAt || 0;
  const timeSinceLast = Date.now() - lastRewardAt;
  const isEligibleForReward = !lastRewardAt || timeSinceLast >= intervalMs;
  const remainingMinutes = Math.max(1, Math.ceil((intervalMs - timeSinceLast) / 60000));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fileInputRef.current?.click();
    }, 250);
    return () => window.clearTimeout(timer);
  }, []);

  const handleSelectFile = (file?: File) => {
    if (!file) return;
    setErrorMessage("");
    setSelectedFile(file);
    if (previewUrl) {
      try {
        URL.revokeObjectURL(previewUrl);
      } catch {}
    }
    const objUrl = URL.createObjectURL(file);
    setPreviewUrl(objUrl);

    // Immediately start pre-uploading in background the moment photo is selected
    // so when the user clicks "Post", the URL is already ready!
    preUploadPromiseRef.current = uploadImageToImgbb(
      file,
      settings.imgbbKeys || settings.imgbbKey
    );
  };

  const handlePublish = async () => {
    if (!selectedFile || !user || uploading) return;
    setUploading(true);
    setErrorMessage("");

    try {
      // 1. Use pre-started upload promise (or start now if not present)
      const uploadTask =
        preUploadPromiseRef.current ||
        uploadImageToImgbb(selectedFile, settings.imgbbKeys || settings.imgbbKey);
      const uploadedUrl = await uploadTask;

      if (isStory) {
        const storyRef = push(ref(contentDb, "stories"));
        await set(storyRef, {
          id: storyRef.key,
          authorId: user.id,
          authorName: user.name,
          authorPhoto: user.photo,
          imageUrl: uploadedUrl,
          createdAt: Date.now(),
        });
        setSuccessMessage("Story published!");
      } else {
        const now = Date.now();
        const todayKey = new Date().toISOString().slice(0, 10);
        const postRef = push(ref(contentDb, "posts"));

        const postPayload = {
          id: postRef.key,
          authorId: user.id,
          authorName: user.name,
          authorUsername: user.username,
          authorPhoto: user.photo,
          caption: caption.trim(),
          imageUrl: uploadedUrl,
          createdAt: now,
        };

        let creditedReward = 0;

        // 2. Run post creation and atomic user balance/postCount update in parallel for maximum speed & concurrency safety
        await Promise.all([
          set(postRef, postPayload),
          runTransaction(ref(userDb, `users/${user.id}`), (current: User | null) => {
            if (!current) return current;
            const serverLastReward = Number(current.lastPostRewardAt) || 0;
            const serverEligible = !serverLastReward || now - serverLastReward >= intervalMs;
            const reward = serverEligible
              ? Math.max(0, Math.min(0.5, Number(settings.postReward || 0)))
              : 0;

            creditedReward = reward;

            const prevBalance = Number(current.balance) || 0;
            const prevTotal = Number(current.totalEarned) || 0;
            const isToday = current.todayKey === todayKey;
            const prevToday = isToday ? Number(current.todayEarned) || 0 : 0;
            const currentPostCount = Number(current.postCount) || 0;

            const updated: User = {
              ...current,
              postCount: currentPostCount + 1,
            };

            if (reward > 0) {
              updated.balance = Number((prevBalance + reward).toFixed(4));
              updated.totalEarned = Number((prevTotal + reward).toFixed(4));
              updated.todayEarned = Number((prevToday + reward).toFixed(4));
              updated.todayKey = todayKey;
              updated.lastPostRewardAt = now;
            }

            return updated;
          }),
        ]);

        if (creditedReward > 0) {
          // Record history & commissions asynchronously in background without blocking navigation
          const historyRef = push(ref(userDb, `users/${user.id}/history`));
          set(historyRef, {
            type: "post",
            amount: creditedReward,
            note: "Post reward",
            createdAt: now,
          }).catch(() => {});

          distributeTierCommissions(creditedReward, "Post reward").catch(() => {});

          setSuccessMessage(
            `Posted! +${formatUSDT(creditedReward, 3)} USDT added to balance! 🎉`
          );
        } else {
          setSuccessMessage(`Posted! (Next reward available in ${remainingMinutes}m)`);
        }
      }

      window.setTimeout(() => navigate("/"), 500);
    } catch (err: any) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
      setUploading(false);
    }
  };

  return (
    <LayoutShell bare>
      <header className="flex items-center gap-2 border-b border-line bg-white px-3 py-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="p-1"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="flex-1 text-[15px] font-bold text-ink">
          {isStory ? "Add story" : "Create post"}
        </h1>
        <button
          type="button"
          onClick={handlePublish}
          disabled={!selectedFile || uploading}
          className={`rounded-full px-3.5 py-1.5 text-[12px] font-bold text-white transition ${
            !selectedFile || uploading ? "bg-gray-300" : "brand-grad"
          }`}
        >
          {uploading ? "Posting..." : "Post"}
        </button>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleSelectFile(e.target.files?.[0])}
      />

      <div className="p-3">
        <div className="flex items-center gap-2">
          <img
            src={user?.photo}
            alt=""
            className="h-9 w-9 rounded-full object-cover"
          />
          <div>
            <p className="text-[13px] font-bold text-ink">{user?.name}</p>
            <p className="text-[11px]">
              {isEligibleForReward ? (
                <span className="font-semibold text-emerald-600">
                  Earn +{formatUSDT(settings.postReward, 3)} USDT for this post! (Every {intervalMin}m)
                </span>
              ) : (
                <span className="font-medium text-amber-600">
                  Next reward in {remainingMinutes} min • You can still post!
                </span>
              )}
            </p>
          </div>
        </div>

        {!isStory && (
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={3}
            placeholder="Write a caption..."
            className="mt-3 w-full resize-none rounded-xl bg-white p-3 text-[13px] outline-none"
          />
        )}

        {previewUrl ? (
          <div className="relative mt-3 overflow-hidden rounded-xl bg-black">
            <img
              src={previewUrl}
              alt="Selected"
              className="max-h-80 w-full object-contain"
            />
            <button
              type="button"
              onClick={() => {
                setSelectedFile(null);
                setPreviewUrl("");
                preUploadPromiseRef.current = null;
              }}
              aria-label="Remove photo"
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-3 flex h-40 w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line bg-white text-muted"
          >
            <ImageIcon size={22} />
            <span className="text-[12px] font-semibold">Open gallery</span>
            <span className="text-[10px]">Choose a photo from your device</span>
          </button>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => navigate("/create")}
            className={`rounded-xl py-2 text-[12px] font-semibold ${
              isStory ? "bg-white/60 text-muted" : "bg-white text-ink"
            }`}
          >
            Feed post
          </button>
          <button
            type="button"
            onClick={() => navigate("/create?story=1")}
            className={`rounded-xl py-2 text-[12px] font-semibold ${
              isStory ? "bg-white text-ink" : "bg-white/60 text-muted"
            }`}
          >
            Story (24h)
          </button>
        </div>

        {errorMessage && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] font-medium text-red-600">
            {errorMessage}
          </p>
        )}

        {successMessage && (
          <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-[12px] font-medium text-green-700">
            {successMessage}
          </p>
        )}

        {uploading && (
          <p className="mt-3 flex items-center gap-2 text-[12px] text-muted">
            <LoaderCircle size={14} className="animate-spin" /> Publishing instantly...
          </p>
        )}
      </div>
    </LayoutShell>
  );
}
