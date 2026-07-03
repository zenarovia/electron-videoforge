import { useState, useEffect } from "react";
import { getSession, logout } from "./lib/auth";
import { getUserSettings } from "./pages/SettingsPage";
import LoginPage from "./pages/LoginPage";
import SettingsPage from "./pages/SettingsPage";

// Import the main VideoForge pipeline (we'll add this next)
import VideoProducer from "./pages/VideoProducer";

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState("app"); // "app" | "settings"

  useEffect(() => {
    const s = getSession();
    setSession(s);
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#0F1117", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: "32px" }}>🎬</div>
      </div>
    );
  }

  if (!session) {
    return <LoginPage onLogin={(s) => setSession(s)} />;
  }

  if (screen === "settings") {
    return <SettingsPage session={session} onBack={() => setScreen("app")} />;
  }

  // Build enriched session with user's API keys (non-admins)
  const userSettings = getUserSettings();
  const enrichedSession = {
    ...session,
    higgsfieldApiKey: userSettings.higgsfieldKey || null,
    claudeApiKey: userSettings.claudeKey || null,
    airtableApiKey: userSettings.airtableKey || null,
    airtableBase: userSettings.airtableBase || null,
    airtableTable: userSettings.airtableTable || null,
  };

  return (
    <VideoProducer
      session={enrichedSession}
      onSettings={() => setScreen("settings")}
      onLogout={() => { logout(); setSession(null); }}
    />
  );
}
