import { useEffect, useState } from "react";
import { dbAll, dbClear, dbDelete, downloadCapture, type CaptureRecord } from "~/lib/captureStore";

export function CaptureGallery({ version }: { version: number }) {
  const [items, setItems] = useState<CaptureRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    dbAll()
      .then((rows) => {
        if (cancelled) return;
        setItems([...rows].sort((a, b) => b.id - a.id));
      })
      .catch((err) => console.error(err));
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (items.length === 0) return null;

  return (
    <div className="card">
      <div className="galhead">
        <span className="galtitle">Saved captures ({items.length})</span>
        <button
          className="ghost small"
          onClick={() => dbClear().then(() => setItems([]))}
        >
          Delete all
        </button>
      </div>
      <div className="gallery">
        {items.map((it) => (
          <div className="capItem" key={it.id}>
            <img src={it.dataUrl} alt={"Capture from " + new Date(it.ts).toLocaleString()} />
            <div className="capMeta">{new Date(it.ts).toLocaleString()}</div>
            <div className="capActions">
              <button className="ghost small" onClick={() => downloadCapture(it)}>
                Download
              </button>
              <button
                className="ghost small danger"
                onClick={() => dbDelete(it.id).then(() => setItems((prev) => prev.filter((p) => p.id !== it.id)))}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
