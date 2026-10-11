import { useSettings } from "../context/SettingsContext";
import { DEFAULT_VERIFIED_BADGE_URL } from "../types";

export function VerifiedBadge({
  className = "h-[1.05em] w-[1.05em]",
}: {
  className?: string;
}) {
  const { settings } = useSettings();
  const badgeUrl = (settings.verifiedBadgeUrl || DEFAULT_VERIFIED_BADGE_URL).trim();

  if (!badgeUrl) return null;

  return (
    <img
      src={badgeUrl}
      alt="Verified"
      className={`inline-block shrink-0 select-none object-contain align-middle ${className}`}
    />
  );
}
