'use client';

import type { PlanningBundle } from '@/lib/planningPipeline';
import type { GlueSheetStatus } from '@/types/runtime';

interface Props {
  bundle: PlanningBundle | null;
  glueStatus: GlueSheetStatus | null;
  csvRowCount: number;
  fileName?: string;
}

export default function PlanningSummaryCard({
  bundle,
  glueStatus,
  csvRowCount,
  fileName,
}: Props) {
  if (!bundle && csvRowCount === 0 && !glueStatus) {
    return (
      <p className="text-[11px] text-muted-foreground leading-snug">
        Planlamadan henüz veri gelmedi. Ana sayfada adımları tamamlayıp{' '}
        <strong>Makineye gönder</strong> kullanın.
      </p>
    );
  }

  const name = bundle?.fileName ?? fileName ?? '—';
  const stones = bundle?.stoneCount ?? csvRowCount;
  const csv = bundle?.csvRowCount ?? csvRowCount;
  const glueCells = bundle?.glueCellCount ?? glueStatus?.total ?? 0;
  const glueGrid =
    bundle != null
      ? `${bundle.glueCols}×${bundle.glueRows}`
      : glueStatus
        ? `${glueStatus.cols}×${glueStatus.rows}`
        : '—';

  return (
    <div className="rounded-md border border-border bg-muted/20 p-2.5 space-y-1.5 text-[11px]">
      <p className="font-medium text-foreground">Planlama özeti</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted-foreground">
        <dt>DXF</dt>
        <dd className="truncate text-foreground font-mono text-[10px]">{name}</dd>
        <dt>Taş / CSV</dt>
        <dd className="text-foreground">
          {stones} kontur → {csv} yerleştirme satırı
        </dd>
        <dt>Yapışkan ızgara</dt>
        <dd className="text-foreground">
          {glueCells} karo ({glueGrid}, 20 mm)
          {glueStatus != null && (
            <span className="text-muted-foreground">
              {' '}
              · sıradaki karo {glueStatus.cursor + 1}
            </span>
          )}
        </dd>
      </dl>
    </div>
  );
}
