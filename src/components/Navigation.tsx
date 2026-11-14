import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useSettings } from "../context/SettingsContext";
import {
  House,
  Users,
  Plus,
  Wallet,
  User,
} from "lucide-react";

interface NavItem {
  to: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  isCenter?: boolean;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Home", Icon: House },
  { to: "/refer", label: "Refer", Icon: Users },
  { to: "/create", label: "Create", Icon: Plus, isCenter: true },
  { to: "/wallet", label: "Wallet", Icon: Wallet },
  { to: "/profile", label: "Profile", Icon: User },
];

export function BottomNav() {
  const navigate = useNavigate();
  const { settings } = useSettings();

  const referBonusVal = Number(settings.referBonus ?? 0);
  const referBadge =
    referBonusVal > 0 ? `${Number(referBonusVal.toFixed(4))}$` : undefined;

  return (
    <nav
      className="pointer-events-none fixed bottom-0 left-1/2 z-40 w-full max-w-[480px] -translate-x-1/2 px-3 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
      aria-label="Main navigation"
    >
      <div className="pointer-events-auto rounded-full border border-[#f4c89e] bg-gradient-to-r from-[#fff3e8] via-[#fff6f3] to-[#ffedf2] px-2 py-2 shadow-[0_6px_22px_rgba(217,140,70,0.14),0_2px_8px_rgba(0,0,0,0.06)] backdrop-blur-md">
        <svg width="0" height="0" className="absolute pointer-events-none" aria-hidden="true">
          <defs>
            <linearGradient id="navBrandGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f2295b" />
              <stop offset="100%" stopColor="#f7841f" />
            </linearGradient>
          </defs>
        </svg>
        <ul className="flex items-end justify-between">
          {NAV_ITEMS.map(({ to, label, Icon, isCenter, badge: staticBadge }) => {
            const badge = to === "/refer" ? referBadge : staticBadge;
            return (
              <li key={to} className="flex flex-1 justify-center">
                <NavLink
                  to={to}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(to);
                  }}
                  className="flex flex-col items-center select-none focus:outline-none"
                >
                  {({ isActive }) => {
                    if (isCenter) {
                      return (
                        <div className="flex flex-col items-center">
                          <div
                            className={`-mt-[22px] flex h-[44px] w-[44px] items-center justify-center rounded-full border-2 border-white bg-gradient-to-tr from-[#f2295b] via-[#f55536] to-[#f7841f] transition-all active:scale-95 ${
                              isActive
                                ? "shadow-[0_4px_16px_rgba(242,41,91,0.48)] ring-2 ring-[#f7841f]/50"
                                : "shadow-[0_4px_13px_rgba(247,132,31,0.38)]"
                            }`}
                          >
                            <Icon size={21} strokeWidth={2.75} className="text-white" />
                          </div>
                          <span
                            className={`mt-0.5 text-[11px] leading-tight transition-colors ${
                              isActive
                                ? "brand-text font-extrabold"
                                : "font-semibold text-[#8c95a4]"
                            }`}
                          >
                            {label}
                          </span>
                        </div>
                      );
                    }

                  return (
                    <div className="flex flex-col items-center gap-0.5 active:scale-95 transition-transform">
                      <div className="relative flex h-[22px] items-center justify-center">
                        {badge && (
                          <span className="absolute -top-1.5 -right-3.5 z-10 rounded-full bg-[#10b981] px-1 py-[1px] text-[7.5px] font-black leading-none text-white ring-1 ring-white shadow-xs">
                            {badge}
                          </span>
                        )}
                        <Icon
                          size={21}
                          strokeWidth={isActive ? 2.25 : 1.75}
                          className={`transition-colors ${
                            isActive
                              ? "text-[#f2295b] [stroke:url(#navBrandGrad)]"
                              : "text-[#8c95a4]"
                          }`}
                        />
                      </div>
                      <span
                        className={`text-[11px] leading-tight transition-colors ${
                          isActive
                            ? "brand-text font-extrabold"
                            : "font-semibold text-[#8c95a4]"
                        }`}
                      >
                        {label}
                      </span>
                    </div>
                  );
                }}
              </NavLink>
            </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

export function LayoutShell({
  children,
  bare = false,
  className = "",
}: {
  children: React.ReactNode;
  bare?: boolean;
  className?: string;
}) {
  return (
    <div className="mx-auto min-h-full w-full max-w-[480px] bg-canvas">
      <main className={`min-h-full w-full ${bare ? "pb-4" : "pb-[88px]"} ${className}`}>
        {children}
      </main>
      {!bare && <BottomNav />}
    </div>
  );
}
