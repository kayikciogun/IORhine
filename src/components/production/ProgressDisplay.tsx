'use client';

import { Progress } from '@/components/ui/progress';
import type { JobPhase } from '@/types/runtime';
import { PHASE_LABELS } from '@/types/runtime';

interface Props {
  phase: JobPhase;
  index: number;
  total: number;
}

export default function ProgressDisplay({ phase, index, total }: Props) {
  const pct = total > 0 ? Math.round((index / total) * 100) : 0;
  const label = PHASE_LABELS[phase] ?? phase;

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-end gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">İlerleme</p>
          <p className="text-lg font-semibold tabular-nums">
            {index}
            <span className="text-muted-foreground text-sm font-normal"> / {total}</span>
          </p>
        </div>
        <span className="text-2xl font-bold text-primary tabular-nums">{pct}%</span>
      </div>
      <Progress value={pct} className="h-2.5" />
      <p className="text-xs text-muted-foreground">Durum: {label}</p>
    </div>
  );
}
