'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  activateOrientationModel,
  listOrientationModels,
  type OrientationModelInfo,
} from '@/lib/runtimeClient';

interface Props {
  disabled?: boolean;
  onChanged?: (model: OrientationModelInfo) => void;
  onError?: (msg: string) => void;
}

export default function OrientationModelSelector({
  disabled,
  onChanged,
  onError,
}: Props) {
  const [models, setModels] = useState<OrientationModelInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listOrientationModels();
      setModels(res.models);
      setActiveId(res.active_id);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = models.find((m) => m.id === activeId) ?? models.find((m) => m.active);

  const handleChange = async (id: string) => {
    const m = models.find((x) => x.id === id);
    if (!m || m.id === activeId) return;
    setSwitching(true);
    try {
      await activateOrientationModel({ model_dir: m.path });
      setActiveId(m.id);
      setModels((prev) =>
        prev.map((x) => ({ ...x, active: x.id === m.id })),
      );
      onChanged?.(m);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
      await refresh();
    } finally {
      setSwitching(false);
    }
  };

  const accLabel =
    active?.best_val_acc != null
      ? `${(active.best_val_acc * 100).toFixed(0)}%`
      : null;

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:inline">
        Orientation
      </span>
      <Select
        value={activeId ?? undefined}
        onValueChange={(v) => void handleChange(v)}
        disabled={disabled || loading || switching || models.length === 0}
      >
        <SelectTrigger className="h-7 w-[min(200px,42vw)] text-[11px] px-2">
          <SelectValue
            placeholder={loading ? 'Yükleniyor…' : 'Model yok'}
          />
        </SelectTrigger>
        <SelectContent>
          {models.map((m) => (
            <SelectItem key={m.id} value={m.id} className="text-xs">
              <span className="font-medium">{m.label}</span>
              {m.best_val_acc != null && (
                <span className="ml-1.5 text-muted-foreground tabular-nums">
                  {(m.best_val_acc * 100).toFixed(0)}%
                </span>
              )}
              {m.active && (
                <span className="ml-1.5 text-emerald-400">●</span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {accLabel && (
        <Badge
          variant="outline"
          className="h-5 text-[9px] px-1.5 tabular-nums shrink-0 border-emerald-500/30 text-emerald-300"
          title="Validation accuracy"
        >
          {accLabel}
        </Badge>
      )}
      {switching && (
        <span className="text-[9px] text-muted-foreground shrink-0">…</span>
      )}
    </div>
  );
}
