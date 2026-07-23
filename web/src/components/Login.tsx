import { useState } from "react";
import { supabase, usernameToEmail } from "../supabase";

// Ikon heksagon (logomark Pranata Bhumi — blok kebun + titik survei)
function HexLogo({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" aria-hidden="true">
      <polygon
        points="28,4 50,16 50,40 28,52 6,40 6,16"
        stroke="#9BCB4F"
        strokeWidth="2.5"
        fill="none"
      />
      <line x1="28" y1="4"  x2="28" y2="52" stroke="#9BCB4F" strokeWidth="1" strokeOpacity="0.35" />
      <line x1="6"  y1="16" x2="50" y2="40" stroke="#9BCB4F" strokeWidth="1" strokeOpacity="0.35" />
      <line x1="50" y1="16" x2="6"  y2="40" stroke="#9BCB4F" strokeWidth="1" strokeOpacity="0.35" />
      <circle cx="28" cy="28" r="4.5" fill="#9BCB4F" />
      <circle cx="28" cy="28" r="2"   fill="#ffffff" />
    </svg>
  );
}

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) { setError("Supabase client is not configured."); return; }
    setLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username),
      password,
    });
    setLoading(false);
    if (signInError) setError(signInError.message);
  };

  return (
    <div style={{
      display: "flex",
      height: "100vh",
      overflow: "hidden",
      fontFamily: "var(--font-ui)",
      background: "var(--bg)",
    }}>
      {/* ── Left hero panel ──────────────────────────────────────── */}
      <div style={{
        flex: "0 0 420px",
        background: "linear-gradient(160deg, var(--color-teal-dark) 0%, var(--color-teal) 60%, var(--color-teal-mid) 100%)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "56px 48px",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Subtle hex grid background pattern */}
        <div style={{
          position: "absolute", inset: 0, opacity: 0.06,
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='52' viewBox='0 0 60 52' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolygon points='30,2 56,16 56,36 30,50 4,36 4,16' stroke='%23ffffff' stroke-width='1.5' fill='none'/%3E%3C/svg%3E")`,
          backgroundSize: "60px 52px",
        }} />

        {/* Logo + brand */}
        <div style={{ position: "relative", zIndex: 1, marginBottom: "40px" }}>
          <HexLogo size={52} />
          <div style={{
            marginTop: "20px",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: "28px",
            color: "#ffffff",
            letterSpacing: "0.2px",
            lineHeight: 1.1,
          }}>
            PalmWatch
          </div>
          <div style={{
            fontFamily: "var(--font-ui)",
            fontWeight: 500,
            fontSize: "11px",
            color: "var(--color-cyan)",
            textTransform: "uppercase",
            letterSpacing: "2px",
            marginTop: "6px",
          }}>
            Pranata Bhumi Consulting
          </div>
        </div>

        {/* Tagline */}
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{
            fontFamily: "var(--font-display)",
            fontSize: "18px",
            color: "rgba(255,255,255,0.92)",
            fontWeight: 600,
            lineHeight: 1.4,
            marginBottom: "16px",
          }}>
            Precision Intelligence<br />for Sustainable Palm Oil
          </div>
          <div style={{
            fontFamily: "var(--font-ui)",
            fontSize: "13px",
            color: "rgba(255,255,255,0.55)",
            lineHeight: 1.65,
            maxWidth: "300px",
          }}>
            Platform GIS presisi untuk analitik blok kebun: NDVI, curah hujan, intervensi, dan proyeksi yield.
          </div>
        </div>

        {/* Values footer */}
        <div style={{
          position: "absolute",
          bottom: "32px",
          left: "48px",
          right: "48px",
          display: "flex",
          gap: "20px",
          zIndex: 1,
        }}>
          {[
            { label: "Bukti", sub: "Evidence First" },
            { label: "Presisi", sub: "Per block" },
            { label: "Lestari", sub: "EUDR ready" },
          ].map(v => (
            <div key={v.label} style={{ flex: 1 }}>
              <div style={{
                fontFamily: "var(--font-data)",
                fontSize: "13px",
                fontWeight: 700,
                color: "var(--color-cyan)",
              }}>{v.label}</div>
              <div style={{
                fontFamily: "var(--font-ui)",
                fontSize: "10px",
                color: "rgba(255,255,255,0.45)",
                letterSpacing: "0.5px",
                marginTop: "2px",
              }}>{v.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right form panel ─────────────────────────────────────── */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px",
        background: "var(--bg)",
      }}>
        <div style={{
          width: "100%",
          maxWidth: "360px",
        }}>
          {/* Header */}
          <div style={{ marginBottom: "32px" }}>
            <div style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "22px",
              color: "var(--text)",
              marginBottom: "6px",
            }}>
              Masuk ke Platform
            </div>
            <div style={{
              fontFamily: "var(--font-ui)",
              fontSize: "13px",
              color: "var(--text-dim)",
            }}>
              Akses terbatas untuk personel terotorisasi.
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div style={{
              background: "var(--critical-bg)",
              color: "var(--critical)",
              padding: "10px 14px",
              borderRadius: "var(--r-md)",
              fontSize: "12px",
              marginBottom: "20px",
              fontFamily: "var(--font-ui)",
              border: "1px solid rgba(192,57,43,0.2)",
              lineHeight: 1.5,
            }}>
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <div>
              <label style={{
                display: "block",
                fontSize: "11px",
                fontWeight: 600,
                color: "var(--text-dim)",
                marginBottom: "6px",
                letterSpacing: "0.8px",
                textTransform: "uppercase",
                fontFamily: "var(--font-ui)",
              }}>
                Username
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
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--r-md)",
                  background: "var(--surface)",
                  color: "var(--text)",
                  fontFamily: "var(--font-data)",
                  fontSize: "13px",
                  outline: "none",
                  transition: "border-color 180ms ease, box-shadow 180ms ease",
                }}
                onFocus={e => {
                  e.currentTarget.style.borderColor = "var(--color-cyan)";
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(35,181,192,0.15)";
                }}
                onBlur={e => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
            </div>

            <div>
              <label style={{
                display: "block",
                fontSize: "11px",
                fontWeight: 600,
                color: "var(--text-dim)",
                marginBottom: "6px",
                letterSpacing: "0.8px",
                textTransform: "uppercase",
                fontFamily: "var(--font-ui)",
              }}>
                Security Key
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--r-md)",
                  background: "var(--surface)",
                  color: "var(--text)",
                  fontFamily: "var(--font-data)",
                  fontSize: "13px",
                  outline: "none",
                  transition: "border-color 180ms ease, box-shadow 180ms ease",
                }}
                onFocus={e => {
                  e.currentTarget.style.borderColor = "var(--color-cyan)";
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(35,181,192,0.15)";
                }}
                onBlur={e => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: "8px",
                padding: "11px",
                background: loading ? "var(--color-teal-mid)" : "var(--color-teal)",
                color: "white",
                border: "none",
                borderRadius: "var(--r-md)",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 700,
                fontFamily: "var(--font-display)",
                fontSize: "14px",
                letterSpacing: "0.4px",
                opacity: loading ? 0.75 : 1,
                transition: "background 180ms ease",
              }}
              onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = "var(--primary-hover)"; }}
              onMouseLeave={e => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = "var(--color-teal)"; }}
            >
              {loading ? "Mengautentikasi…" : "Masuk ke Platform"}
            </button>
          </form>

          {/* Footer */}
          <div style={{
            marginTop: "40px",
            paddingTop: "20px",
            borderTop: "1px solid var(--border-subtle)",
            textAlign: "center",
            fontFamily: "var(--font-ui)",
            fontSize: "11px",
            color: "var(--text-muted)",
          }}>
            © 2025 PT Pranata Bhumi Konsultindo · Confidential
          </div>
        </div>
      </div>
    </div>
  );
}
