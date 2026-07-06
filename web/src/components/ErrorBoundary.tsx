import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

// Menangkap error render agar seluruh aplikasi tidak blank saat satu komponen
// gagal. Menampilkan fallback + opsi reload.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
    // Hook Sentry/observability bisa dipasang di sini.
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-boundary">
        <div className="eb-card">
          <div className="eb-icon">⚠</div>
          <h2>Terjadi kesalahan tak terduga</h2>
          <p>Sebagian antarmuka gagal dimuat. Coba muat ulang halaman.</p>
          <pre className="eb-detail">{this.state.error.message}</pre>
          <div className="eb-actions">
            <button className="eb-btn primary" onClick={() => window.location.reload()}>Muat ulang</button>
            <button className="eb-btn" onClick={() => this.setState({ error: null })}>Coba lagi</button>
          </div>
        </div>
      </div>
    );
  }
}
