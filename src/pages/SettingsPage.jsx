import { useState, useEffect } from "react";

const STORAGE_KEY = "videoforge:userSettings";

export default function SettingsPage({ session, onBack }) {
  const [higgsfieldKey, setHiggsfieldKey] = useState("");
  const [claudeKey, setClaudeKey] = useState("");
  const [fishKey, setFishKey] = useState("");
  const [airtableKey, setAirtableKey] = useState("");
  const [airtableBase, setAirtableBase] = useState("");
  const [airtableTable, setAirtableTable] = useState("");
  const [saved, setSaved] = useState(false);
  const [showKeys, setShowKeys] = useState(false);

  const isAdmin = session?.isAdmin;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        setHiggsfieldKey(s.higgsfieldKey || "");
        setClaudeKey(s.claudeKey || "");
        setFishKey(s.fishKey || "");
        setAirtableKey(s.airtableKey || "");
        setAirtableBase(s.airtableBase || "");
        setAirtableTable(s.airtableTable || "");
      }
    } catch {}
  }, []);

  const handleSave = () => {
    const settings = { higgsfieldKey, claudeKey, fishKey, airtableKey, airtableBase, airtableTable };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0F1117", color: "#E8E8E8", fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <div style={{ maxWidth: "640px", margin: "0 auto", padding: "40px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "32px" }}>
          <button onClick={onBack} style={{ padding: "8px 14px", borderRadius: "8px", border: "2px solid #2A2D3A", background: "transparent", color: "#9CA3AF", fontSize: "13px", cursor: "pointer" }}>← Back</button>
          <div>
            <div style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "-0.5px" }}>Settings</div>
            <div style={{ fontSize: "13px", color: "#6B7280" }}>Signed in as {session?.name} · {isAdmin ? "Admin" : "User"} account</div>
          </div>
        </div>

        {isAdmin ? (
          // Admin — keys are handled by backend
          <div style={{ background: "#1A1D27", borderRadius: "12px", border: "2px solid rgba(201,151,58,0.3)", padding: "24px" }}>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#C9973A", marginBottom: "8px" }}>✓ Admin Account</div>
            <div style={{ fontSize: "14px", color: "#9CA3AF", lineHeight: "1.6" }}>
              Your account uses VideoForge's backend API keys — you don't need to enter anything here. All Higgsfield, Claude, and Airtable connections are pre-configured.
            </div>
            <div style={{ marginTop: "16px", padding: "12px 14px", background: "#0F1117", borderRadius: "8px", fontSize: "12px", color: "#6B7280" }}>
              To update backend keys, edit environment variables in Vercel dashboard.
            </div>
          </div>
        ) : (
          // Regular user — needs their own keys
          <div>
            <div style={{ background: "rgba(201,151,58,0.06)", border: "1px solid rgba(201,151,58,0.2)", borderRadius: "10px", padding: "14px 16px", marginBottom: "28px", display: "flex", gap: "10px" }}>
              <span style={{ fontSize: "16px" }}>🔑</span>
              <div style={{ fontSize: "13px", color: "#9CA3AF", lineHeight: "1.5" }}>
                VideoForge uses your own API accounts so you're in full control of your costs. Your keys are stored only in your browser — they never leave your device.
              </div>
            </div>

            {/* Higgsfield */}
            <Section title="Higgsfield" required>
              <div style={{ fontSize: "12px", color: "#6B7280", marginBottom: "10px" }}>
                Get your API key from <a href="https://higgsfield.ai" target="_blank" style={{ color: "#C9973A" }}>higgsfield.ai</a> → Account → API Keys
              </div>
              <PasswordField label="API Key" value={higgsfieldKey} onChange={setHiggsfieldKey} show={showKeys} placeholder="hf_..." />
            </Section>

            {/* Claude */}
            <Section title="Anthropic Claude" required>
              <div style={{ fontSize: "12px", color: "#6B7280", marginBottom: "10px" }}>
                Get your API key from <a href="https://console.anthropic.com" target="_blank" style={{ color: "#C9973A" }}>console.anthropic.com</a> → API Keys
              </div>
              <PasswordField label="API Key" value={claudeKey} onChange={setClaudeKey} show={showKeys} placeholder="sk-ant-..." />
            </Section>

            {/* Fish Audio */}
            <Section title="Fish Audio" required>
              <div style={{ fontSize: "12px", color: "#6B7280", marginBottom: "10px" }}>
                Get your API key from <a href="https://fish.audio" target="_blank" style={{ color: "#C9973A" }}>fish.audio</a> → Account → API Keys. Used for voiceover generation during video assembly.
              </div>
              <PasswordField label="API Key" value={fishKey} onChange={setFishKey} show={showKeys} placeholder="fish_..." />
            </Section>

            {/* Airtable (optional) */}
            <Section title="Airtable" subtitle="Optional — for saving job history">
              <div style={{ fontSize: "12px", color: "#6B7280", marginBottom: "12px" }}>
                Get your key from <a href="https://airtable.com/account" target="_blank" style={{ color: "#C9973A" }}>airtable.com/account</a>. If you skip this, jobs are tracked locally only.
              </div>
              <PasswordField label="API Key" value={airtableKey} onChange={setAirtableKey} show={showKeys} placeholder="pat..." />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "12px" }}>
                <div>
                  <label style={labelStyle}>Base ID</label>
                  <input value={airtableBase} onChange={e => setAirtableBase(e.target.value)} placeholder="appXXXXXXXXXX" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Table ID</label>
                  <input value={airtableTable} onChange={e => setAirtableTable(e.target.value)} placeholder="tblXXXXXXXXXX" style={inputStyle} />
                </div>
              </div>
            </Section>

            {/* Show/hide keys toggle */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
              <button onClick={() => setShowKeys(!showKeys)} style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid #3A3D4A", background: "transparent", color: "#9CA3AF", fontSize: "12px", cursor: "pointer" }}>
                {showKeys ? "🙈 Hide Keys" : "👁 Show Keys"}
              </button>
              <span style={{ fontSize: "12px", color: "#4B5563" }}>Keys are masked by default for security</span>
            </div>

            <button onClick={handleSave} disabled={!higgsfieldKey || !claudeKey || !fishKey} style={{
              width: "100%", padding: "14px", borderRadius: "10px", border: "none",
              background: !higgsfieldKey || !claudeKey || !fishKey ? "#2A2D3A" : "linear-gradient(135deg, #C9973A, #E8B85A)",
              color: !higgsfieldKey || !claudeKey || !fishKey ? "#4B5563" : "#0F1117",
              fontSize: "14px", fontWeight: 700, cursor: !higgsfieldKey || !claudeKey || !fishKey ? "not-allowed" : "pointer",
            }}>
              {saved ? "✓ Settings Saved!" : "Save Settings →"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, subtitle, required, children }) {
  return (
    <div style={{ background: "#1A1D27", borderRadius: "12px", border: "2px solid #2A2D3A", padding: "20px", marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
        <div style={{ fontSize: "14px", fontWeight: 700, color: "#E8E8E8" }}>{title}</div>
        {required && <span style={{ fontSize: "10px", background: "rgba(239,68,68,0.15)", color: "#FCA5A5", padding: "2px 6px", borderRadius: "4px", fontWeight: 700 }}>Required</span>}
        {subtitle && <span style={{ fontSize: "12px", color: "#6B7280" }}>{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function PasswordField({ label, value, onChange, show, placeholder }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
    </div>
  );
}

const labelStyle = { fontSize: "11px", color: "#6B7280", fontWeight: 600, display: "block", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" };
const inputStyle = { width: "100%", padding: "10px 14px", borderRadius: "8px", border: "2px solid #2A2D3A", background: "#0F1117", color: "#E8E8E8", fontSize: "13px", outline: "none", boxSizing: "border-box", fontFamily: "inherit" };

// Export settings loader for use in main app
export function getUserSettings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
  catch { return {}; }
}
