import { useState } from "react";
import shp from "shpjs";
import { listVectorLayers, insertVectorLayer } from "../vectorLayers";
import { importProjectBlocks } from "../projects";
import { mapStore } from "../store/mapStore";

type FC = GeoJSON.FeatureCollection;
type Mode = "blocks" | "layer";

interface Props {
  onClose?: () => void;
  projectId: string | null;
  onImported?: () => void; // reload data dashboard setelah import blok
}

// Tab "Upload": unggah SHP (zip) / GeoJSON. Dua mode:
//  - "blocks": jadi batas blok produksi milik project (dianalisis pipeline).
//  - "layer" : layer referensi (public.vector_layers) untuk overlay.
export default function UploadTab({ onClose, projectId, onImported }: Props) {
  const [mode, setMode] = useState<Mode>("blocks");
  const [name, setName] = useState("");
  const [fc, setFc] = useState<FC | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const normalize = (raw: unknown): FC => {
    const g = Array.isArray(raw) ? (raw[0] as FC) : (raw as FC);
    if (!g || g.type !== "FeatureCollection") throw new Error("Bukan FeatureCollection yang valid.");
    return g;
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setMsg("Membaca file…");
    try {
      const parsed = file.name.toLowerCase().endsWith(".zip")
        ? normalize(await shp(await file.arrayBuffer()))
        : normalize(JSON.parse(await file.text()));
      setFc(parsed);
      setName((n) => n || file.name.replace(/\.(zip|geojson|json)$/i, ""));
      setMsg(`Terbaca: ${parsed.features.length} fitur. Siap diproses.`);
    } catch (e2) {
      setErr(`Gagal parse: ${(e2 as Error).message}`);
      setFc(null);
      setMsg(null);
    } finally {
      e.target.value = "";
    }
  };

  const submit = async () => {
    if (!fc) return;
    setBusy(true);
    setErr(null);

    if (mode === "blocks") {
      if (!projectId) { setErr("Pilih/ buat project dulu sebelum import batas blok."); setBusy(false); return; }
      setMsg("Mengimpor batas blok ke project…");
      const res = await importProjectBlocks(projectId, fc);
      if (res.ok) {
        setMsg(`Berhasil impor ${res.imported} blok ke project. Memuat ulang peta…`);
        setFc(null); setName("");
        onImported?.();
      } else { setErr(res.error ?? "Import gagal."); setMsg(null); }
    } else {
      if (!name.trim()) { setErr("Isi nama layer."); setBusy(false); return; }
      setMsg("Menyimpan layer referensi…");
      const res = await insertVectorLayer(name.trim(), fc);
      if (res.ok) {
        setMsg(`Berhasil menyimpan layer "${name.trim()}".`);
        setFc(null); setName("");
        mapStore.setDbLayers(await listVectorLayers());
      } else { setErr(res.error ?? "Upload gagal."); setMsg(null); }
    }
    setBusy(false);
  };

  return (
    <div className="upload-tab">
      <div className="upload-head">
        <h3 className="sidebar-title">Upload SHP / GeoJSON</h3>
        {onClose && <button className="upload-close" onClick={onClose} title="Kembali ke Layers">✕</button>}
      </div>

      <div className="upload-mode">
        <label className={mode === "blocks" ? "on" : ""}>
          <input type="radio" checked={mode === "blocks"} onChange={() => setMode("blocks")} />
          Batas blok project <span>(jadi blok produksi & dianalisis)</span>
        </label>
        <label className={mode === "layer" ? "on" : ""}>
          <input type="radio" checked={mode === "layer"} onChange={() => setMode("layer")} />
          Layer referensi <span>(overlay, tidak dianalisis)</span>
        </label>
      </div>

      <p className="upload-hint">
        {mode === "blocks"
          ? "Unggah batas kebun/blok (.zip Shapefile atau GeoJSON). Setiap poligon menjadi blok milik project aktif; analitik EO menyusul dari pipeline."
          : "Unggah layer referensi (mis. jalan, sungai) yang disimpan ke database dan bisa ditambahkan ke peta."}
      </p>

      <label className="upload-drop">
        <input type="file" accept=".zip,.geojson,.json" onChange={handleFile} disabled={busy} />
        <span>⭱ Pilih file (.zip / .geojson)</span>
      </label>

      {fc && mode === "layer" && (
        <div className="control-group">
          <label className="control-label">Nama layer</label>
          <input className="control-select" value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Jaringan Jalan" />
        </div>
      )}

      <button className="upload-submit" onClick={submit} disabled={!fc || busy}>
        {busy ? "Memproses…" : mode === "blocks" ? "Import sebagai blok project" : "Simpan layer referensi"}
      </button>

      {msg && <div className="upload-msg ok">{msg}</div>}
      {err && <div className="upload-msg err">{err}</div>}
    </div>
  );
}
