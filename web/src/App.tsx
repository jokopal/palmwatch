import { useEffect, useState } from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import maplibregl from "maplibre-gl";
import MapView from "./components/MapView";
import InsetMap from "./components/InsetMap";
import BasemapSwitcher from "./components/BasemapSwitcher";
import MapTools from "./components/MapTools";
import FloatingLegend from "./components/FloatingLegend";
import LeftPanel from "./components/LeftPanel";
import UserPanel from "./components/UserPanel";
import BlockPanel from "./components/BlockPanel";
import LoadingOverlay from "./components/LoadingOverlay";
import BottomPanel from "./components/BottomPanel";
import ProfileMenu from "./components/ProfileMenu";
import ProjectSwitcher from "./components/ProjectSwitcher";
import AdminUsers from "./components/AdminUsers";
import SharedView from "./components/SharedView";
import Login from "./components/Login";
import AnalysisBar from "./components/AnalysisBar";
import MobileShell from "./components/MobileShell";
import { api } from "./api";
import { supabase } from "./supabase";
import { mapStore, useMapStore } from "./store/mapStore";
import { useIsMobile } from "./useMediaQuery";
import { listProjects, type Project } from "./projects";
import { AuthProvider, fetchMyRole } from "./auth";
import { capabilitiesFor, type Role } from "./capabilities";
import { isReady } from "./features";
import type { BlockCollection, Summary } from "./types";

// Deteksi mode share publik (?share=<token>) sekali di awal.
const SHARE_TOKEN = new URLSearchParams(window.location.search).get("share");

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [authChecking, setAuthChecking] = useState(true);

  const [data, setData] = useState<BlockCollection | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Project (multi-kebun) — #4
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);

  // State for main map synchronization
  const [mainMap, setMainMap] = useState<maplibregl.Map | null>(null);

  // Konfigurasi inset dari store peta.
  const insetsEnabled = useMapStore((s) => s.insetsEnabled);
  const insets = useMapStore((s) => s.insets);

  // Layout: HP/tablet-portrait → mobile shell; selebihnya → workspace panel.
  const isMobile = useIsMobile();

  // Fitur blok terpilih — dipakai panel detail (desktop float & sheet mobile).
  const selectedFeature = data?.features.find((f) => f.properties.block_id === selectedId) ?? null;

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

  // Bypass auth hanya untuk pengembangan lokal. import.meta.env.DEV di-inline
  // saat build, sehingga seluruh cabang ini hilang dari bundel produksi —
  // sebuah VITE_PREVIEW_NO_AUTH yang tak sengaja terbawa tidak bisa lagi
  // memberi akses tanpa login.
  const previewBypass = import.meta.env.DEV && Boolean(import.meta.env.VITE_PREVIEW_NO_AUTH);
  const authed = !authChecking && Boolean(session || !supabase || previewBypass);

  // Role (Fase 2 RBAC) — dari public.users. Mulai dari "loading": selama role
  // belum diketahui, capabilitiesFor() tidak memberi izin apa pun sehingga
  // kontrol admin tidak pernah berkedip muncul lalu hilang.
  const [role, setRole] = useState<Role>("loading");
  const [roleError, setRoleError] = useState<string | null>(null);
  const caps = capabilitiesFor(role);
  const [showUsers, setShowUsers] = useState(false);

  useEffect(() => {
    if (!authed) return;
    if (previewBypass) {
      // Preview dev wajib menyebut rolenya eksplisit. Tidak ada lagi default
      // ke admin: salah ketik nilai env dulu berarti akses penuh tanpa login.
      const r = import.meta.env.VITE_PREVIEW_ROLE;
      setRole(r === "admin" ? "admin" : "user");
      return;
    }
    let cancelled = false;
    fetchMyRole().then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setRole(res.role);
        setRoleError(null);
      } else {
        // Gagal menentukan role = akses paling terbatas, tapi katakan sebabnya.
        setRole("guest");
        setRoleError(res.reason);
      }
    });
    return () => { cancelled = true; };
  }, [authed, session, previewBypass]);

  // Role tanpa manajer layer sama sekali (mis. guest) tak punya cara
  // mengaktifkan layer blok sendiri — tanpa ini petanya basemap kosong.
  // Anggota project TIDAK termasuk: LeftPanel memulihkan susunan terpublikasi
  // milik admin, dan menambah blok di sini akan menduplikasi pekerjaan itu.
  useEffect(() => {
    if (role === "loading" || caps.styleLayers) return;
    mapStore.addBlocksLayer();
  }, [role, caps.styleLayers]);

  const reloadProjects = () => {
    listProjects().then((ps) => {
      setProjects(ps);
      setProjectId((cur) => cur ?? ps[0]?.id ?? null);
    });
  };

  // Muat daftar project saat sudah terautentikasi.
  useEffect(() => {
    if (!authed) return;
    reloadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  const reloadData = () => {
    api.summary(projectId).then(setSummary).catch((e) => setError(String(e)));
    api.blocks(projectId).then(setData).catch((e) => setError(String(e)));
  };

  // Fetch data blok/summary di-scope per project.
  useEffect(() => {
    if (!authed) return;
    reloadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, projectId]);

  // Mode share publik (read-only, tanpa login) — untuk petani via link.
  if (SHARE_TOKEN) return <SharedView token={SHARE_TOKEN} />;

  if (authChecking) {
    return (
      <div style={{
        height: '100vh', display: 'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'center',
        background: 'linear-gradient(160deg, var(--color-teal-dark) 0%, var(--color-teal) 100%)',
        gap: '20px',
      }}>
        <svg width="44" height="44" viewBox="0 0 56 56" fill="none">
          <polygon points="28,4 50,16 50,40 28,52 6,40 6,16" stroke="#9BCB4F" strokeWidth="2.5" fill="none" opacity="0.9"/>
          <circle cx="28" cy="28" r="4.5" fill="#9BCB4F"/>
          <circle cx="28" cy="28" r="2" fill="#fff"/>
        </svg>
        <div style={{ fontFamily: 'var(--font-display)', color: '#fff', fontSize: '16px', fontWeight: 600, letterSpacing: '0.3px' }}>PalmWatch</div>
        <div style={{ fontFamily: 'var(--font-ui)', color: 'rgba(255,255,255,0.5)', fontSize: '11px', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Memuat sistem…</div>
      </div>
    );
  }

  // If Supabase is enabled and no session, show Login.
  // VITE_PREVIEW_NO_AUTH (dev-only, opt-in) melewati gerbang auth untuk keperluan
  // preview/verifikasi UI peta tanpa sesi. JANGAN diaktifkan di production.
  if (supabase && !session && !previewBypass) {
    return <Login />;
  }

  return (
    <AuthProvider role={role}>
    <div className={`app${isMobile ? " app--mobile" : ""}`}>
      <header className="header">
        <div className="brand">
          <b>
            <svg width="18" height="18" viewBox="0 0 56 56" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
              <polygon points="28,4 50,16 50,40 28,52 6,40 6,16" stroke="#9BCB4F" strokeWidth="3" fill="none"/>
              <circle cx="28" cy="28" r="5" fill="#9BCB4F"/>
              <circle cx="28" cy="28" r="2" fill="#fff"/>
            </svg>
            PalmWatch
          </b>
          <span>by Pranata Bhumi</span>
        </div>

        <ProjectSwitcher
          projects={projects}
          currentId={projectId}
          canManage={caps.manageProjects}
          onSwitch={setProjectId}
          onProjectsChanged={reloadProjects}
        />

        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          {summary && (
            <div className="header-kpis" style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--text-md)', fontWeight: 700, color: '#fff', lineHeight: 1 }}>
                  {summary.total_area_ha} ha
                </div>
                <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Total Area</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--text-md)', fontWeight: 700, color: '#fff', lineHeight: 1 }}>
                  {summary.n_blocks}
                </div>
                <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-2xs)', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Blok</div>
              </div>
              {(summary.by_priority?.critical ?? 0) > 0 && (
                <div className="hdr-pill hdr-pill--crit">
                  {summary.by_priority.critical} Kritis
                </div>
              )}
              {/* Blok tanpa analisis ditandai terpisah. Sebelumnya mereka
                  terhitung "normal" sehingga kebun yang belum pernah
                  dianalisis tampil sebagai sehat sepenuhnya. */}
              {(summary.by_priority?.no_data ?? 0) > 0 && (
                <div className="hdr-pill hdr-pill--nodata"
                  title="Blok ini belum punya data kondisi — statusnya belum diketahui, bukan sehat">
                  {summary.by_priority.no_data} belum dianalisis
                </div>
              )}
            </div>
          )}
          {caps.manageUsers && (
            <button className="header-admin-btn" onClick={() => setShowUsers(true)} title="Kelola user & akses project">
              ⚙ User
            </button>
          )}
          <ProfileMenu session={session} />
        </div>
      </header>

      {roleError && (
        <div className="role-error-banner">
          Hak akses tidak dapat dipastikan, jadi aplikasi dibuka dalam mode
          paling terbatas. <span className="reb-reason">{roleError}</span>
        </div>
      )}

      {caps.manageUsers && showUsers && (
        <AdminUsers
          projects={projects}
          currentUserId={session?.user?.id}
          onClose={() => setShowUsers(false)}
        />
      )}

      {isMobile ? (
        <MobileShell
          data={data}
          summary={summary}
          selectedId={selectedId}
          selectedFeature={selectedFeature}
          onSelect={setSelectedId}
          projects={projects}
          projectId={projectId}
          error={error}
          onMapLoad={setMainMap}
          onBlocksImported={() => { reloadProjects(); reloadData(); }}
        />
      ) : (
      <>
      {/* Analysis toolbar — admin only (menulis hasil ke DB) */}
      {caps.runAnalysis && isReady("analysis") && <AnalysisBar projectId={projectId} />}

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

                    {!data && !error && <LoadingOverlay />}

                    {/* Detail blok terpilih — "identify" ala SIG, float di atas peta */}
                    {selectedFeature && (
                      <BlockPanel
                        feature={selectedFeature}
                        onClose={() => setSelectedId(null)}
                      />
                    )}

                    {error && (
                      <div style={{
                        position: 'absolute', bottom: 16, left: 16,
                        background: 'var(--critical-bg)', color: 'var(--critical)',
                        padding: '8px 12px', borderRadius: 'var(--r-md)',
                        zIndex: 10, fontSize: 'var(--text-xs)',
                        fontFamily: 'var(--font-ui)',
                        border: '1px solid rgba(192,57,43,0.2)',
                        boxShadow: 'var(--shadow-sm)',
                      }}>
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

          {/* Right Area — admin: layer workspace; user: viewer + input stub */}
          <Panel defaultSize={25} minSize={0} collapsible={true}>
            {caps.styleLayers ? (
              // Anggota project kini ikut mendapat manajer layer (simbologi,
              // urutan, nyala/mati), dengan kartu ringkasan kebun di atasnya.
              // Yang tidak mereka miliki: katalog Available Layers & tab Upload.
              <div className="right-stack">
                {!caps.manageLayerSet && (
                  <UserPanel
                    project={projects.find((p) => p.id === projectId)}
                    summary={summary}
                    compact
                  />
                )}
                <LeftPanel
                  projectId={projectId}
                  onBlocksImported={() => { reloadProjects(); reloadData(); }}
                />
              </div>
            ) : (
              <UserPanel
                project={projects.find((p) => p.id === projectId)}
                summary={summary}
              />
            )}
          </Panel>

        </PanelGroup>
      </div>
      </>
      )}
    </div>
    </AuthProvider>
  );
}
