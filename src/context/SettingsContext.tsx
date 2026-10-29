import React, { createContext, useContext, useEffect, useState } from "react";
import { ref, onValue, update } from "firebase/database";
import { contentDb } from "../firebase";
import { Settings, defaultSettings } from "../types";

interface SettingsContextValue {
  settings: Settings;
  loading: boolean;
  saveSettings: (newSettings: Partial<Settings>) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: defaultSettings,
  loading: true,
  saveSettings: async () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const cached = localStorage.getItem("pc_cached_settings");
      if (cached) return { ...defaultSettings, ...JSON.parse(cached) };
    } catch {}
    return defaultSettings;
  });
  const [loading, setLoading] = useState(() => {
    try {
      return !localStorage.getItem("pc_cached_settings");
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const settingsRef = ref(contentDb, "settings");
    const unsubscribe = onValue(settingsRef, (snapshot) => {
      const data = snapshot.val() || {};
      const merged = { ...defaultSettings, ...data };
      setSettings(merged);
      setLoading(false);
      try {
        localStorage.setItem("pc_cached_settings", JSON.stringify(merged));
      } catch {}
    });
    return () => unsubscribe();
  }, []);

  const saveSettings = async (newSettings: Partial<Settings>) => {
    await update(ref(contentDb, "settings"), newSettings);
  };

  return (
    <SettingsContext.Provider value={{ settings, loading, saveSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
