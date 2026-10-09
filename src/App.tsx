import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { SettingsProvider } from "./context/SettingsContext";
import { UserProvider, useUser } from "./context/UserContext";
import { StarRewardProvider } from "./context/StarRewardContext";
import { ChannelVerificationModal } from "./components/ChannelVerificationModal";
import { HomePage } from "./pages/HomePage";
import { ReferPage } from "./pages/ReferPage";
import { CreatePage } from "./pages/CreatePage";
import { WalletPage } from "./pages/WalletPage";
import { CashOutPage } from "./pages/CashOutPage";
import { PaymentsPage } from "./pages/PaymentsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { UserProfilePage } from "./pages/UserProfilePage";
import { AdminPanelPage } from "./pages/AdminPanelPage";
import { APP_LOGO_URL } from "./types";
import { startBotKeepAliveService } from "./utils/botKeepAlive";

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useUser();

  if (loading) {
    return (
      <div className="flex min-h-full w-full items-center justify-center bg-canvas">
        <div className="text-center">
          <img
            src={APP_LOGO_URL}
            alt="PhotoCash"
            className="mx-auto mb-2 h-14 w-14 animate-pulse rounded-2xl object-cover shadow-md"
          />
          <p className="text-[12px] font-semibold text-muted">
            Connecting your Telegram account...
          </p>
        </div>
      </div>
    );
  }

  if (user?.banned) {
    return (
      <div className="flex min-h-full w-full items-center justify-center bg-canvas px-8 text-center">
        <p className="text-[13px] font-semibold text-brand-pink">
          Your account has been suspended. Please contact support.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

export default function App() {
  useEffect(() => {
    startBotKeepAliveService();
  }, []);

  return (
    <BrowserRouter>
      <SettingsProvider>
        <Routes>
          <Route path="/admin" element={<AdminPanelPage />} />
          <Route path="/admin/*" element={<AdminPanelPage />} />
          <Route path="/panel" element={<AdminPanelPage />} />
          <Route path="/panel/*" element={<AdminPanelPage />} />
          <Route
            path="*"
            element={
              <UserProvider>
                <StarRewardProvider>
                  <AuthGate>
                    <ChannelVerificationModal />
                    <Routes>
                      <Route path="/" element={<HomePage />} />
                      <Route path="/refer" element={<ReferPage />} />
                      <Route path="/create" element={<CreatePage />} />
                      <Route path="/wallet" element={<WalletPage />} />
                      <Route path="/cashout" element={<CashOutPage />} />
                      <Route path="/payments" element={<PaymentsPage />} />
                      <Route path="/profile" element={<ProfilePage />} />
                      <Route path="/u/:id" element={<UserProfilePage />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </AuthGate>
                </StarRewardProvider>
              </UserProvider>
            }
          />
        </Routes>
      </SettingsProvider>
    </BrowserRouter>
  );
}
