import { useEffect, useRef, useState } from "react";
import { BASEMAPS } from "../map/basemaps";
import { mapStore, useMapStore } from "../store/mapStore";

// Pemilih basemap di kiri-bawah peta, dropdown membuka ke ATAS (maks 5 basemap).
// Perubahan berlaku ke peta utama & seluruh inset (via store).
export default function BasemapSwitcher() {
  const basemap = useMapStore((s) => s.basemap);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = BASEMAPS.find((b) => b.id === basemap) ?? BASEMAPS[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className="basemap-switcher">
      {open && (
        <div className="basemap-menu" role="listbox">
          {BASEMAPS.map((b) => (
            <button
              key={b.id}
              role="option"
              aria-selected={b.id === basemap}
              className={`basemap-option${b.id === basemap ? " active" : ""}`}
              onClick={() => {
                mapStore.setBasemap(b.id);
                setOpen(false);
              }}
            >
              <span className={`basemap-dot bm-${b.id}`} />
              {b.label}
            </button>
          ))}
        </div>
      )}
      <button
        className="basemap-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Ganti basemap"
      >
        <span className={`basemap-dot bm-${current.id}`} />
        <span className="basemap-label">{current.label}</span>
        <span className="basemap-caret">{open ? "▾" : "▴"}</span>
      </button>
    </div>
  );
}
