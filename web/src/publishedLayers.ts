import { supabase } from "./supabase";
import { mapStore, type ActiveLayer, type AvailableLayer } from "./store/mapStore";
import { getVectorLayerGeojson } from "./vectorLayers";
import { listRasterOverlays } from "./rasterOverlays";
import { listReferenceLayers } from "./analysisApi";

// ── Susunan layer terpublikasi ───────────────────────────────────────────────
//
// Admin menyusun layer aktifnya, lalu memublikasikannya sebagai titik awal bagi
// anggota project. Yang disimpan hanya RUJUKAN + tampilan, bukan geometrinya:
// satu layer garis di project ini saja berukuran 9 MB, jadi menyimpan geojson
// di dalam susunan akan membuat baris database membengkak dan pemuatan lambat.
// Klien menarik ulang isinya dari vector_layers / manifest overlay saat memuat.

/** Bentuk satu layer di dalam susunan terpublikasi (snake_case, sesuai DB). */
interface PublishedLayer {
  source_ref: string | null;
  kind: ActiveLayer["kind"];
  name: string;
  visible: boolean;
  symbology: ActiveLayer["symbology"];
  reference_config?: ActiveLayer["referenceConfig"];
  raster_config?: ActiveLayer["rasterConfig"];
}

export interface PublishedView {
  layers: PublishedLayer[];
  publishedAt: string | null;
}

/** Ubah layer aktif di store menjadi bentuk yang bisa disimpan. */
function serialize(layers: ActiveLayer[]): PublishedLayer[] {
  return layers.map((l) => ({
    source_ref: l.sourceRef ?? null,
    kind: l.kind,
    name: l.name,
    visible: l.visible,
    symbology: l.symbology,
    reference_config: l.referenceConfig,
    raster_config: l.rasterConfig,
  }));
}

/** Publikasikan susunan layer aktif saat ini. Admin saja (ditegakkan di DB). */
export async function publishLayers(
  projectId: string,
): Promise<{ ok: boolean; nLayers?: number; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase tidak dikonfigurasi." };

  const layers = serialize(mapStore.getState().activeLayers);
  const { data, error } = await supabase.rpc("publish_project_layers", {
    p_project_id: projectId,
    p_layers: layers,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, nLayers: (data as { n_layers?: number })?.n_layers ?? layers.length };
}

/** Ambil susunan terpublikasi. null = admin belum pernah memublikasikan. */
export async function fetchPublishedView(projectId: string): Promise<PublishedView | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_project_layers", { p_project_id: projectId });
  if (error) {
    console.warn("fetchPublishedView:", error.message);
    return null;
  }
  if (!data) return null;
  const raw = data as { layers?: PublishedLayer[]; published_at?: string };
  return { layers: raw.layers ?? [], publishedAt: raw.published_at ?? null };
}

/**
 * Muat susunan terpublikasi ke store: tarik geojson tiap layer vektor,
 * cocokkan raster ke manifest overlay, lalu terapkan simbologi & urutan.
 *
 * Layer ditambahkan dari belakang ke depan karena store menaruh layer baru di
 * indeks 0 — dengan begitu urutan akhirnya sama persis dengan yang admin susun.
 *
 * @returns jumlah layer yang berhasil dipulihkan
 */
export async function applyPublishedView(view: PublishedView): Promise<number> {
  const overlays = listRasterOverlays();
  // Metadata reference layer (field diagnostik, kelas) diambil dari katalog DB
  // supaya konfigurasi terbaru ikut, bukan salinan beku saat publikasi.
  let catalog: AvailableLayer[] = [];
  try {
    catalog = await listReferenceLayers();
  } catch {
    catalog = [];
  }

  let restored = 0;

  for (const pl of [...view.layers].reverse()) {
    if (pl.kind === "blocks") {
      mapStore.addBlocksLayer();
      applyAppearance(pl);
      restored++;
      continue;
    }

    if (pl.kind === "raster") {
      const overlay = overlays.find((o) => o.sourceRef === pl.source_ref);
      // Raster yang belum diproses build_raster_overlays.py tidak punya gambar
      // untuk ditempel — dilewati diam-diam, bukan ditambahkan sebagai layer
      // yang mustahil tampil.
      if (!overlay) continue;
      mapStore.addRasterLayer(overlay);
      applyAppearance(pl);
      restored++;
      continue;
    }

    if (!pl.source_ref) continue;
    const geojson = await getVectorLayerGeojson(pl.source_ref);
    if (!geojson) continue;

    const meta = catalog.find((c) => c.sourceRef === pl.source_ref) ?? {
      id: pl.source_ref,
      name: pl.name,
      group: "db" as const,
      sourceRef: pl.source_ref,
    };
    mapStore.addDbLayer(meta, geojson);
    applyAppearance(pl);
    restored++;
  }

  return restored;
}

/** Terapkan simbologi & visibilitas hasil publikasi ke layer yang baru ditambah. */
function applyAppearance(pl: PublishedLayer) {
  const added = mapStore
    .getState()
    .activeLayers.find((l) =>
      pl.kind === "blocks" ? l.kind === "blocks" : l.sourceRef === pl.source_ref,
    );
  if (!added) return;
  if (pl.symbology) mapStore.updateSymbology(added.id, pl.symbology);
  // Setter eksplisit, bukan toggle: alur ini berjalan di dalam effect yang bisa
  // dieksekusi dua kali, dan toggle akan membalik nilainya kembali.
  mapStore.setLayerVisible(added.id, pl.visible);
}
