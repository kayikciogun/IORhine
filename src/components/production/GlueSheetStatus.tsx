'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { GlueSheetStatus } from '@/types/runtime';
import { loadGlueStripSnapshot, type GlueCellPreview } from '@/lib/glueStripSync';

interface Props {
  status: GlueSheetStatus | null;
  loading: boolean;
  error: string | null;
  runtimeOnline: boolean | null;
  activeIndex: number;
  phase: string;
  onReset: () => void;
}

type CellState = 'processing' | 'next' | 'done' | 'pending';

function getCellState(i: number, activeIndex: number, phase: string): CellState {
  if (phase === 'complete') return 'done';
  if (i < activeIndex) return 'done';
  if (i === activeIndex) {
    if (phase === 'running' || phase === 'paused' || phase === 'preparing') return 'processing';
    if (phase === 'ready') return 'next';
  }
  return 'pending';
}

function GlueStripMini({
  cells,
  cols,
  cursor,
  cellSize,
  activeIndex,
  phase,
}: {
  cells: GlueCellPreview[];
  cols: number;
  cursor: number;
  cellSize: number;
  activeIndex: number;
  phase: string;
}) {
  const rows = Math.ceil(cells.length / cols);
  const hs = cellSize / 2;
  const gridW = cols * cellSize;
  const gridH = rows * cellSize;

  return (
    <svg
      viewBox={`${-hs} ${-hs} ${gridW + cellSize} ${gridH + cellSize}`}
      className="w-full rounded border border-border bg-muted/20"
      style={{ maxHeight: 200 }}
    >
      {cells.map((cell, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx = col * cellSize;
        const cy = row * cellSize;
        const state = getCellState(i, activeIndex, phase);
        const consumed = state === 'done' || i < cursor;
        const active = state === 'processing' || state === 'next';

        return (
          <g key={i} transform={`translate(${cx}, ${cy})`}>
            {/* karo kutusu */}
            <rect
              x={-hs}
              y={-hs}
              width={cellSize}
              height={cellSize}
              fill={
                active
                  ? 'hsl(38 92% 50% / 0.25)'
                  : consumed
                    ? 'hsl(var(--primary)/0.15)'
                    : 'hsl(var(--muted)/0.4)'
              }
              stroke={active ? 'hsl(38 92% 50% / 0.9)' : 'hsl(var(--border))'}
              strokeWidth={active ? 0.9 : 0.4}
            />
            {/* sıra numarası */}
            <text
              x={-hs + 1.5}
              y={-hs + 4}
              fontSize={3}
              fill="hsl(var(--muted-foreground))"
            >
              {i + 1}
            </text>
            {/* kontür */}
            {cell.svgD ? (
              <path
                d={cell.svgD}
                fill={
                  active
                    ? 'hsl(38 92% 50% / 0.35)'
                    : consumed
                      ? 'hsl(var(--primary)/0.25)'
                      : (cell.color + '99')
                }
                stroke={active ? 'hsl(38 92% 50%)' : consumed ? 'hsl(var(--primary)/0.6)' : cell.color}
                strokeWidth={active ? 0.9 : 0.6}
              />
            ) : (
              <circle
                r={hs * 0.55}
                fill="none"
                stroke={consumed ? 'hsl(var(--primary)/0.5)' : cell.color}
                strokeWidth={0.7}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function GlueSheetStatusPanel({
  status,
  loading,
  error,
  runtimeOnline,
  activeIndex,
  phase,
  onReset,
}: Props) {
  const [localSnap, setLocalSnap] = useState(() => loadGlueStripSnapshot());

  useEffect(() => {
    const refresh = () => setLocalSnap(loadGlueStripSnapshot());
    refresh();
    window.addEventListener('rhine:glue-strip-updated', refresh);
    return () => window.removeEventListener('rhine:glue-strip-updated', refresh);
  }, []);

  if (runtimeOnline === false) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Runtime kapalı — <code className="text-[10px]">./scripts/start.sh</code> ile başlatın.
        </p>
        {localSnap && (
          <GlueStripMini
            cells={localSnap.cells}
            cols={localSnap.cols}
            cursor={0}
            cellSize={localSnap.config.cellSize}
            activeIndex={activeIndex}
            phase={phase}
          />
        )}
      </div>
    );
  }

  if (loading && !status) {
    return <p className="text-xs text-muted-foreground">Yapışkan levha yükleniyor…</p>;
  }

  if (error && !status) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-destructive">
          {error}
          <span className="block text-[10px] text-muted-foreground mt-0.5">
            Planlamada «Üret» + «5. Makineye gönder» yapın.
          </span>
        </p>
        {localSnap && (
          <GlueStripMini
            cells={localSnap.cells}
            cols={localSnap.cols}
            cursor={0}
            cellSize={localSnap.config.cellSize}
            activeIndex={activeIndex}
            phase={phase}
          />
        )}
      </div>
    );
  }

  if (!status) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Henüz yapışkan levha yok. Planlamada «Üret» + «5. Makineye gönder» kullanın.
        </p>
        {localSnap && (
          <GlueStripMini
            cells={localSnap.cells}
            cols={localSnap.cols}
            cursor={0}
            cellSize={localSnap.config.cellSize}
            activeIndex={activeIndex}
            phase={phase}
          />
        )}
      </div>
    );
  }

  const cursor = status.cursor;

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center text-xs">
        <span>
          Kalan: <strong>{status.remaining}</strong> / {status.total}
          <span className="text-muted-foreground ml-1">
            ({status.cols}×{status.rows}, 20 mm)
          </span>
        </span>
        <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={onReset}>
          Levha sıfırla
        </Button>
      </div>

      {localSnap && localSnap.cells.length > 0 ? (
        <GlueStripMini
          cells={localSnap.cells}
          cols={localSnap.cols}
          cursor={Math.max(cursor, activeIndex)}
          cellSize={localSnap.config.cellSize}
          activeIndex={activeIndex}
          phase={phase}
        />
      ) : (
        <div
          className="grid gap-px rounded border border-border p-1 bg-muted/30"
          style={{ gridTemplateColumns: `repeat(${Math.min(status.cols, 20)}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: Math.min(status.cols, 20) * Math.min(status.rows, 10) }).map((_, i) => (
            <div
              key={i}
              className={`aspect-square rounded-[1px] ${i < cursor ? 'bg-primary/60' : 'bg-muted'}`}
            />
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        CSV satırı ve yapışkan karo aynı sırada ilerler. Aktif sıra: {Math.min(activeIndex + 1, status.total)} / {status.total}
      </p>
    </div>
  );
}
