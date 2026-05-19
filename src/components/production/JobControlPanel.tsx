'use client';

import { Button } from '@/components/ui/button';
import type { JobPhase } from '@/types/runtime';
import { Play, Pause, Square, OctagonAlert, RotateCcw } from 'lucide-react';

interface Props {
  phase: JobPhase;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onEstop: () => void;
  disabled?: boolean;
}

export default function JobControlPanel({
  phase,
  onStart,
  onPause,
  onResume,
  onStop,
  onEstop,
  disabled,
}: Props) {
  const canStart = phase === 'ready';
  const canPause = phase === 'running';
  const canResume = phase === 'paused';

  const startHint =
    phase === 'ready'
      ? null
      : phase === 'preparing'
        ? 'Job yükleniyor…'
        : phase === 'running'
          ? 'Zaten çalışıyor'
          : phase === 'error'
            ? 'Hata — Job yükle’yi tekrar deneyin'
            : 'Önce üstten «Job yükle» (durum: Hazır)';

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Job kontrol">
        <Button size="sm" className="h-8 text-xs gap-1" onClick={onStart} disabled={disabled || !canStart}>
          <Play className="w-3.5 h-3.5" /> Başlat
        </Button>
        <Button size="sm" variant="secondary" className="h-8 text-xs gap-1" onClick={onPause} disabled={disabled || !canPause}>
          <Pause className="w-3.5 h-3.5" /> Duraklat
        </Button>
        <Button size="sm" variant="secondary" className="h-8 text-xs gap-1" onClick={onResume} disabled={disabled || !canResume}>
          <RotateCcw className="w-3.5 h-3.5" /> Devam
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={onStop} disabled={disabled}>
          <Square className="w-3.5 h-3.5" /> Durdur
        </Button>
        <Button size="sm" variant="destructive" className="h-8 text-xs gap-1" onClick={onEstop} disabled={disabled}>
          <OctagonAlert className="w-3.5 h-3.5" /> E-stop
        </Button>
      </div>
      {startHint && (
        <p className="text-[10px] text-muted-foreground leading-snug">{startHint}</p>
      )}
    </div>
  );
}
