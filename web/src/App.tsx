import { useEffect, useState } from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import maplibregl from "maplibre-gl";
import MapView from "./components/MapView";
import InsetMap from "./components/InsetMap";
import BasemapSwitcher from "./components/BasemapSwitcher";
import MapTools from "./components/MapTools";
import FloatingLegend from "./components/FloatingLegend";
import LeftPanel from "./components/LeftPanel";
import BottomPanel from "./components/BottomPanel";
import ProfileMenu from "./components/ProfileMenu";
import Login from "./components/Login";
import { api } from "./api";
import { supabase } from "./supabase";
import { useMapStore } from "./store/mapStore";
import type { BlockCollection, Summary } from "./types";

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [authChecking, setAuthChecking] = useState(true);

  const [data, setData] = useState<BlockCollection | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // State for main map synchronization
  const [mainMap, setMainMap] = useState<maplibregl.Map | null>(null);

  // Konfigurasi inset dari store peta.
  const insetsEnabled = useMapStore((s) => s.insetsEnabled);
  const insets = useMapStore((s) => s.insets);

  useEffect(() => {
    // Check initial auth state
    if (!supabase) {
      setAuthChecking(false);
      return;
    }
    
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthChecking(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => authListener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const previewBypass = Boolean(import.meta.env.VITE_PREVIEW_NO_AUTH);
    if (authChecking || (!session && supabase && !previewBypass)) return;

    api.summary().then(setSummary).catch((e) => setError(String(e)));
    api.blocks().then(setData).catch((e) => setError(String(e)));
  }, [session, authChecking]);

  if (authChecking) {
    return <div style={{ height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'var(--bg)', fontFamily: 'var(--font-mono)' }}>INITIALIZING SYSTEM...</div>;
  }

  // If Supabase is enabled and no session, show Login.
  // VITE_PREVIEW_NO_AUTH (dev-only, opt-in) melewati gerbang auth untuk keperluan
  // preview/verifikasi UI peta tanpa sesi. JANGAN diaktifkan di production.
  if (supabase && !session && !import.meta.env.VITE_PREVIEW_NO_AUTH) {
    return <Login />;
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <b><span className="leaf">▲</span> PalmWatch</b>
          <span>Precision Intelligence</span>
        </div>
        
        <div className="header-title">
          PLANTATION MONITOR EXPLORING TOOL
        </div>

        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          {summary && (
            <div style={{ display: 'flex', gap: '16px', fontSize: '13px' }}>
              <div>Total Area: <b style={{ fontFamily: 'var(--font-mono)' }}>{summary.total_area_ha} ha</b></div>
              <div>Blocks: <b style={{ fontFamily: 'var(--font-mono)' }}>{summary.n_blocks}</b></div>
            </div>
          )}
          <ProfileMenu session={session} />
        </div>
      </header>

      <div className="body">
        <PanelGroup orientation="horizontal">
          
          {/* Left Area (Workspace + Bottom Panel) */}
          <Panel defaultSize={75} minSize={30}>
            <PanelGroup orientation="vertical">
              
              {/* Top: Map Workspace */}
              <Panel defaultSize={70} minSize={20} onResize={() => {
                // Trigger maplibre resize when panel resizes
                if (mainMap) {
                  setTimeout(() => mainMap.resize(), 50);
                }
              }}>
                <div className="map-workspace">
                  <div className="main-map-wrap">
                    <MapView
                      data={data}
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                      onMapLoad={setMainMap}
                    />

                    <MapTools />
                    <BasemapSwitcher />
                    <FloatingLegend />

                    {error && (
                      <div style={{ position: 'absolute', bottom: 16, left: 16, background: '#fee2e2', color: '#dc2626', padding: '8px 12px', borderRadius: '4px', zIndex: 10, fontSize: '12px' }}>
                        API error: {error}
                      </div>
                    )}
                  </div>

                  {insetsEnabled && insets.length > 0 && (
                    <div className="inset-maps-wrap" style={{ width: '300px', flexShrink: 0 }}>
                      {insets.map((cfg) => (
                        <div className="inset-map-box" key={cfg.id}>
                          <InsetMap mainMap={mainMap} data={data} config={cfg} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Panel>

              {/* Horizontal Split Handle */}
              <PanelResizeHandle className="ResizeHandleOuter">
                <div className="ResizeHandleInner" />
              </PanelResizeHandle>

              {/* Bottom: Detailed Analytics / Interventions */}
              <Panel defaultSize={30} minSize={0} collapsible={true}>
                <BottomPanel data={data} selectedId={selectedId} onSelect={setSelectedId} />
              </Panel>

            </PanelGroup>
          </Panel>

          {/* Vertical Split Handle */}
          <PanelResizeHandle className="ResizeHandleOuter">
            <div className="ResizeHandleInner" />
          </PanelResizeHandle>

          {/* Right Area (Layer workspace panel) */}
          <Panel defaultSize={25} minSize={0} collapsible={true}>
            <LeftPanel canUpload={!!session} />
          </Panel>

        </PanelGroup>
      </div>
    </div>
  );
}
