'use client';

import type { DetectedStone } from '@/types/runtime';
import type { SnapshotDetectResult } from '@/lib/runtimeClient';

interface Props {
  objects?: DetectedStone[];
  aiSnapshotResult?: SnapshotDetectResult | null;
}

export default function VisionTunePanel({
  objects = [],
  aiSnapshotResult,
}: Props) {
  const stones = aiSnapshotResult?.objects?.length
    ? aiSnapshotResult.objects
    : objects;

  return (
    <div className="space-y-3 text-xs">
      <div className="p-2.5 rounded-lg border border-purple-500/30 bg-purple-500/5 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold tracking-wide text-purple-300">
            Son tespitler
          </h3>
          <span className="text-[10px] font-medium text-purple-200 bg-purple-900/60 px-2 py-0.5 rounded">
            {stones.length} taş
          </span>
        </div>
        <p className="text-[9.5px] text-muted-foreground leading-tight">
          Canlı stream yok. &quot;Kare Al&quot; son frame + VLM sonucunu ana ekrana yazar.
        </p>

        {stones.length === 0 ? (
          <div className="text-[10px] text-muted-foreground border-t border-purple-500/20 pt-2">
            Henüz tespit yok
          </div>
        ) : (
          <ul className="border-t border-purple-500/20 pt-2 space-y-1 max-h-[220px] overflow-y-auto">
            {stones.map((s, i) => {
              const id = 'id' in s && s.id != null ? s.id : i + 1;
              const cx = 'cx' in s && s.cx != null ? s.cx : s.x;
              const cy = 'cy' in s && s.cy != null ? s.cy : s.y;
              return (
                <li
                  key={id}
                  className="flex items-center justify-between gap-2 rounded bg-black/40 px-2 py-1 font-mono text-[10px] text-purple-100"
                >
                  <span>#{id}</span>
                  <span>
                    ({Math.round(cx)}, {Math.round(cy)})
                  </span>
                  <span>{Math.round(s.angle)}°</span>
                  <span className="text-purple-200/90">
                    {s.orientation && s.orientation !== 'uncertain'
                      ? s.orientation
                      : '—'}
                  </span>
                  <span className="text-purple-300/80">
                    {typeof s.score === 'number' ? s.score.toFixed(2) : '—'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {aiSnapshotResult?.vlm_text && (
          <div className="text-[9px] font-mono text-purple-300/80 bg-black/60 p-1.5 rounded max-h-16 overflow-y-auto">
            {aiSnapshotResult.vlm_text}
          </div>
        )}
      </div>
    </div>
  );
}
