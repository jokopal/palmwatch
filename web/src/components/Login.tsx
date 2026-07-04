import { useState } from "react";
import { supabase, usernameToEmail } from "../supabase";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      setError("Supabase client is not configured.");
      return;
    }
    setLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      // Username murni dipetakan ke email internal (lihat supabase.usernameToEmail).
      email: usernameToEmail(username),
      password,
    });
    setLoading(false);
    if (signInError) setError(signInError.message);
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 10px",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    background: "var(--bg)",
    color: "var(--text)",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "var(--bg)",
        fontFamily: "var(--font-mono)",
      }}
    >
      <div
        style={{
          background: "var(--panel)",
          padding: "32px",
          borderRadius: "8px",
          border: "1px solid var(--border)",
          boxShadow: "0 10px 25px -5px rgba(14, 48, 90, 0.15)",
          width: "360px",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <div
            style={{
              color: "var(--accent)",
              fontSize: "24px",
              marginBottom: "8px",
              fontFamily: "var(--font-display)",
              fontWeight: 700,
            }}
          >
            ▲ PalmWatch
          </div>
          <div style={{ fontSize: "13px", color: "var(--text-dim)", fontFamily: "var(--font-ui)" }}>
            Precision Intelligence System
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-dim)", marginTop: "4px", letterSpacing: "0.5px" }}>
            ACCESS GRANTED TO AUTHORIZED PERSONNEL ONLY
          </div>
        </div>

        {error && (
          <div
            style={{
              background: "#fee2e2",
              color: "#dc2626",
              padding: "10px",
              borderRadius: "4px",
              fontSize: "12px",
              marginBottom: "16px",
              fontFamily: "var(--font-ui)",
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label style={{ display: "block", fontSize: "11px", color: "var(--text-dim)", marginBottom: "4px", letterSpacing: "0.5px" }}>
              USERNAME
            </label>
            <input
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="mis. admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "11px", color: "var(--text-dim)", marginBottom: "4px", letterSpacing: "0.5px" }}>
              SECURITY KEY
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={inputStyle}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: "8px",
              padding: "10px",
              background: "var(--header-bg)",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 700,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.5px",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "AUTHENTICATING..." : "INITIALIZE SESSION"}
          </button>
        </form>
      </div>
    </div>
  );
}
