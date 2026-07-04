import { useState } from "react";
import shp from "shpjs";
import { listVectorLayers, insertVectorLayer } from "../vectorLayers";
import { mapStore } from "../store/mapStore";

type FC = GeoJSON.FeatureCollection;

// Tab "Upload": unggah SHP (zip) / GeoJSON ke database (public.vector_layers)
// agar dapat dipanggil kembali sebagai layer. Konfigurasi via panel ini.
export default function UploadTab({ onClose }: { onClose?: () => void }) {
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
      let parsed: FC;
      if (file.name.toLowerCase().endsWith(".zip")) {
        parsed = normalize(await shp(await file.arrayBuffer()));
      } else {
        parsed = normalize(JSON.parse(await file.text()));
      }
      setFc(parsed);
      setName((n) => n || file.name.replace(/\.(zip|geojson|json)$/i, ""));
      setMsg(`Terbaca: ${parsed.features.length} fitur. Siap diupload.`);
    } catch (e2) {
      setErr(`Gagal parse: ${(e2 as Error).message}`);
      setFc(null);
      setMsg(null);
    } finally {
      e.target.value = "";
    }
  };

  const upload = async () => {
    if (!fc || !name.trim()) return;
    setBusy(true);
    setErr(null);
    setMsg("Mengupload ke database…");
    const res = await insertVectorLayer(name.trim(), fc);
    if (res.ok) {
      setMsg(`Berhasil menyimpan layer "${name.trim()}".`);
      setFc(null);
      setName("");
      mapStore.setDbLayers(await listVectorLayers());
    } else {
      setErr(res.error ?? "Upload gagal.");
      setMsg(null);
    }
    setBusy(false);
  };

  return (
    <div className="upload-tab">
      <div className="upload-head">
        <h3 className="sidebar-title">Upload Layer ke Database</h3>
        {onClose && <button className="upload-close" onClick={onClose} title="Kembali ke Layers">✕</button>}
      </div>
      <p className="upload-hint">
        Unggah <b>Shapefile (.zip)</b> atau <b>GeoJSON</b> (mis. batas kebun). Layer
        disimpan ke database dan bisa ditambahkan ke peta kapan saja.
      </p>

      <label className="upload-drop">
        <input type="file" accept=".zip,.geojson,.json" onChange={handleFile} disabled={busy} />
        <span>⭱ Pilih file (.zip / .geojson)</span>
      </label>

      {fc && (
        <div className="control-group">
          <label className="control-label">Nama layer</label>
          <input className="control-select" value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Batas Kebun Blok A" />
        </div>
      )}

      <button className="upload-submit" onClick={upload} disabled={!fc || !name.trim() || busy}>
        {busy ? "Uploading…" : "Simpan ke Database"}
      </button>

      {msg && <div className="upload-msg ok">{msg}</div>}
      {err && <div className="upload-msg err">{err}</div>}
    </div>
  );
}
