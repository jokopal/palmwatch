import { useRef } from "react";

interface Props {
  open: boolean;
  title: string;
  /** Sheet melebar penuh (true) atau setengah layar (false). */
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Bottom-sheet untuk layout mobile: naik dari bawah menutupi peta.
 * - Grabber di atas: tap / drag untuk toggle setengah ↔ penuh; drag ke bawah untuk tutup.
 * - Tombol ✕ menutup ke tampilan peta.
 */
export default function MobileSheet({ open, title, expanded, onToggleExpand, onClose, children }: Props) {
  const startY = useRef<number | null>(null);

  const onPointerDown = (e: React.PointerEvent) => { startY.current = e.clientY; };
  const onPointerUp = (e: React.PointerEvent) => {
    if (startY.current == null) return;
    const dy = e.clientY - startY.current;
    startY.current = null;
    if (dy > 60) {
      // Tarik ke bawah: kalau sedang penuh → setengah, kalau setengah → tutup.
      if (expanded) onToggleExpand();
      else onClose();
    } else if (dy < -60 && !expanded) {
      onToggleExpand();
    } else if (Math.abs(dy) < 8) {
      onToggleExpand(); // tap grabber
    }
  };

  return (
    <div className={`m-sheet ${open ? "open" : ""} ${expanded ? "full" : ""}`} role="dialog" aria-hidden={!open}>
      <div
        className="m-sheet-grabber"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <span className="m-sheet-bar" />
      </div>
      <div className="m-sheet-head">
        <span className="m-sheet-title">{title}</span>
        <button className="m-sheet-close" onClick={onClose} aria-label="Tutup panel">✕</button>
      </div>
      <div className="m-sheet-body">{children}</div>
    </div>
  );
}
