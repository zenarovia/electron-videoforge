import { useState } from "react";
import { login, register } from "../lib/auth";

export default function LoginPage({ onLogin }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError("");
    setLoading(true);
    try {
      const session = mode === "login"
        ? await login({ email, password })
        : await register({ name, email, password });
      onLogin(session);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0F1117", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', -apple-system, sans-serif", padding: "24px" }}>
      <div style={{ width: "100%", maxWidth: "400px" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          <div style={{ width: "56px", height: "56px", background: "linear-gradient(135deg, #C9973A, #E8B85A)", borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "28px", margin: "0 auto 16px" }}>🎬</div>
          <div style={{ fontSize: "24px", fontWeight: 700, color: "#E8E8E8", letterSpacing: "-0.5px" }}>VideoForge</div>
          <div style={{ fontSize: "14px", color: "#6B7280", marginTop: "4px" }}>Script to video in minutes</div>
        </div>

        {/* Card */}
        <div style={{ background: "#1A1D27", borderRadius: "16px", border: "2px solid #2A2D3A", padding: "32px" }}>
          {/* Mode toggle */}
          <div style={{ display: "flex", background: "#0F1117", borderRadius: "10px", padding: "4px", marginBottom: "24px" }}>
            {["login", "register"].map(m => (
              <button key={m} onClick={() => { setMode(m); setError(""); }} style={{ flex: 1, padding: "8px", borderRadius: "7px", border: "none", background: mode === m ? "#2A2D3A" : "transparent", color: mode === m ? "#E8E8E8" : "#6B7280", fontSize: "13px", fontWeight: mode === m ? 600 : 400, cursor: "pointer", transition: "all 0.2s" }}>
                {m === "login" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>

          {/* Fields */}
          {mode === "register" && (
            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "12px", color: "#9CA3AF", fontWeight: 600, display: "block", marginBottom: "6px" }}>YOUR NAME</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="First name or full name" style={inputStyle} />
            </div>
          )}

          <div style={{ marginBottom: "16px" }}>
            <label style={{ fontSize: "12px", color: "#9CA3AF", fontWeight: 600, display: "block", marginBottom: "6px" }}>EMAIL</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" style={inputStyle} onKeyDown={e => e.key === "Enter" && handleSubmit()} />
          </div>

          <div style={{ marginBottom: "24px" }}>
            <label style={{ fontSize: "12px", color: "#9CA3AF", fontWeight: 600, display: "block", marginBottom: "6px" }}>PASSWORD</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === "register" ? "At least 8 characters" : "Your password"} style={inputStyle} onKeyDown={e => e.key === "Enter" && handleSubmit()} />
          </div>

          {error && (
            <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", fontSize: "13px", color: "#FCA5A5" }}>
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading || !email || !password || (mode === "register" && !name)}
            style={{
              width: "100%", padding: "14px", borderRadius: "10px", border: "none",
              background: loading || !email || !password ? "#2A2D3A" : "linear-gradient(135deg, #C9973A, #E8B85A)",
              color: loading || !email || !password ? "#4B5563" : "#0F1117",
              fontSize: "14px", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Please wait..." : mode === "login" ? "Sign In →" : "Create Account →"}
          </button>

          {mode === "register" && (
            <div style={{ fontSize: "12px", color: "#4B5563", marginTop: "16px", textAlign: "center", lineHeight: "1.5" }}>
              By creating an account you agree to use VideoForge responsibly. Admin features require approval from Twila.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%", padding: "12px 14px", borderRadius: "8px",
  border: "2px solid #2A2D3A", background: "#0F1117",
  color: "#E8E8E8", fontSize: "14px", outline: "none",
  boxSizing: "border-box", fontFamily: "inherit",
};
