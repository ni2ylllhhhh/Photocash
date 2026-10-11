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
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const settingsRef = ref(contentDb, "settings");
    const unsubscribe = onValue(settingsRef, (snapshot) => {
      const data = snapshot.val() || {};
      setSettings({ ...defaultSettings, ...data });
      setLoading(false);
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
