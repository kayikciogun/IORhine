'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { PlacementCsvRow } from '@/types/runtime';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ListOrdered } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  rows: PlacementCsvRow[];
  activeIndex: number;
  phase: string;
  /** Yan panelde üst başlık dışarıda verildiğinde iç başlığı gizler */
  compact?: boolean;
}

type RowStatus = 'processing' | 'next' | 'done' | 'pending';

function getRowStatus(i: number, activeIndex: number, phase: string): RowStatus {
  if (phase === 'complete') return 'done';
  if (i < activeIndex) return 'done';
  if (i === activeIndex) {
    if (phase === 'running' || phase === 'paused' || phase === 'preparing') return 'processing';
    if (phase === 'ready') return 'next';
  }
  return 'pending';
}

const ROW_OVERLAY: Record<RowStatus, string> = {
  processing:
    'relative bg-amber-500/30 dark:bg-amber-400/25 ring-1 ring-inset ring-amber-500/80 shadow-[inset_4px_0_0_0_hsl(38_92%_50%)]',
  next: 'relative bg-sky-500/15 dark:bg-sky-400/12 ring-1 ring-inset ring-sky-500/40',
  done: 'bg-muted/50 text-muted-foreground opacity-55',
  pending: '',
};

export default function PlacementJobTable({ rows, activeIndex, phase, compact }: Props) {
  const scrollRef = useRef<HTMLTableRowElement | null>(null);

  const shapeId = useMemo(
    () => (rows.length ? rows[0].shape_id : '—'),
    [rows],
  );

  const isJobActive = phase === 'running' || phase === 'paused' || phase === 'preparing';

  useEffect(() => {
    if (!isJobActive && phase !== 'ready') return;
    scrollRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex, phase, isJobActive]);

  if (!rows.length) {
    return (
      <div
        className={`flex flex-col items-center justify-center text-center text-muted-foreground border border-dashed rounded-lg ${
          compact ? 'py-8 px-3 flex-1 min-h-[120px]' : 'py-12'
        }`}
      >
        <ListOrdered className="w-10 h-10 mb-2 opacity-40" />
        <p className="text-sm font-medium">Henüz yerleştirme listesi yok</p>
        <p className="text-xs mt-1 max-w-xs">
          Planlama ekranından DXF yükleyin veya buradan job yükleyin.
        </p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col min-h-0 ${compact ? 'h-full' : ''}`}>
      {!compact && (
        <div className="flex items-center justify-between gap-2 mb-2 px-1 shrink-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Yerleştirme listesi</h3>
            <Badge variant="secondary" className="text-[10px]">
              {rows.length} satır
            </Badge>
          </div>
          <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[140px]">
            shape: {shapeId}
          </span>
        </div>
      )}

      {compact && (phase === 'running' || phase === 'paused' || phase === 'ready') && (
        <div className="flex flex-wrap gap-1.5 mb-2 px-0.5 shrink-0 text-[9px]">
          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-amber-500/30 ring-1 ring-amber-500/60">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            İşlemde
          </span>
          <span className="inline-flex items-center rounded px-1.5 py-0.5 bg-muted/50 opacity-60">
            Tamamlandı
          </span>
        </div>
      )}

      <div
        className={cn(
          'rounded-lg border border-border overflow-auto',
          compact && 'flex-1 min-h-0',
        )}
      >
        <Table>
          <TableHeader className="sticky top-0 bg-muted/90 backdrop-blur z-10">
            <TableRow>
              <TableHead className="w-10 text-xs">#</TableHead>
              <TableHead className="text-xs">X</TableHead>
              <TableHead className="text-xs">Y</TableHead>
              <TableHead className="text-xs w-12">°</TableHead>
              <TableHead className="text-xs max-w-[72px]">shape</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => {
              const status = getRowStatus(i, activeIndex, phase);
              const isProcessing = status === 'processing';

              return (
                <TableRow
                  key={`${row.id}-${row.shape_id}-${i}`}
                  ref={(el) => {
                    if (
                      el &&
                      (status === 'processing' ||
                        (status === 'next' && phase === 'ready'))
                    ) {
                      scrollRef.current = el;
                    }
                  }}
                  className={cn('transition-colors duration-300', ROW_OVERLAY[status])}
                >
                  <TableCell className="font-mono text-[11px] py-1.5 px-2">
                    <span className="flex items-center gap-1 flex-wrap">
                      {isProcessing && (
                        <Badge
                          variant="outline"
                          className="h-4 px-1 text-[8px] border-amber-600/60 bg-amber-500/40 text-amber-950 dark:text-amber-100 shrink-0"
                        >
                          İşlemde
                        </Badge>
                      )}
                      {status === 'next' && phase === 'ready' && (
                        <Badge variant="outline" className="h-4 px-1 text-[8px] shrink-0">
                          Sıradaki
                        </Badge>
                      )}
                      {row.id}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-[11px] py-1.5 px-2">
                    {row.target_x.toFixed(1)}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] py-1.5 px-2">
                    {row.target_y.toFixed(1)}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] py-1.5 px-2">
                    {row.target_angle.toFixed(0)}
                  </TableCell>
                  <TableCell
                    className="font-mono text-[10px] py-1.5 px-2 text-muted-foreground max-w-[72px] truncate"
                    title={row.shape_id}
                  >
                    {row.shape_id}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
