'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getMotionStatus, listMotionPorts, selectMotionPort } from '@/lib/runtimeClient';
import type { MotionPort, MotionStatus } from '@/types/runtime';
import { Loader2, RefreshCw, Usb } from 'lucide-react';

interface Props {
  disabled?: boolean;
  onSelected?: (status: MotionStatus) => void;
}

export default function MotionPortSelector({ disabled, onSelected }: Props) {
  const [ports, setPorts] = useState<MotionPort[]>([]);
  const [status, setStatus] = useState<MotionStatus | null>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listMotionPorts();
      setPorts(list.ports);
      setStatus(list.status);
      setSelected(list.status.serial_port);
    } catch (e) {
      setError(String(e));
      try {
        const st = await getMotionStatus();
        setStatus(st);
        setSelected(st.serial_port);
      } catch {
        // Runtime kapalıysa ana ekran zaten offline gösterir.
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activeLabel = useMemo(() => {
    if (!status) return 'Seçilmedi';
    if (status.mock_hardware) return 'Mock hardware aktif';
    const match = ports.find((p) => p.path === status.serial_port);
    return match?.label ?? status.serial_port;
  }, [ports, status]);

  const handleApply = async () => {
    if (!selected) return;
    setApplying(true);
    setError(null);
    try {
      const { status: next } = await selectMotionPort(selected);
      setStatus(next);
      onSelected?.(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setApplying(false);
    }
  };

  const canSelect = !status?.mock_hardware && ports.length > 0;

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium text-foreground/80">Motion USB / Marlin</p>
        {status?.mock_hardware && (
          <Badge variant="secondary" className="h-4 px-1 text-[9px]">
            Mock
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Select
          value={selected}
          onValueChange={setSelected}
          disabled={disabled || loading || !canSelect}
        >
          <SelectTrigger className="h-7 text-[11px] flex-1">
            <SelectValue placeholder={status?.mock_hardware ? 'Mock hardware' : 'USB port seçin…'} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel className="flex items-center gap-1 text-xs">
                <Usb className="w-3 h-3" /> Seri portlar
              </SelectLabel>
              {ports.map((p) => (
                <SelectItem
                  key={p.id}
                  value={p.path}
                  disabled={p.available === false}
                  className="text-xs"
                >
                  {p.label}
                  {p.available === false ? ' (bulunamadı)' : ''}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 shrink-0"
          onClick={() => refresh()}
          disabled={loading || disabled}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        </Button>

        <Button
          type="button"
          size="sm"
          className="h-7 text-[10px] px-2.5 shrink-0"
          onClick={handleApply}
          disabled={!selected || applying || disabled || status?.mock_hardware}
        >
          {applying ? '…' : 'Seç'}
        </Button>
      </div>

      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Badge variant="outline" className="font-normal text-[9px] h-4 px-1">
          Aktif
        </Badge>
        <span className="truncate">{activeLabel}</span>
      </div>

      {!loading && !status?.mock_hardware && ports.length === 0 && (
        <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-snug">
          Seri port bulunamadı. Kartı takın veya mock için <code>./scripts/start.sh --mock</code>.
        </p>
      )}

      {error && <p className="text-[10px] text-destructive leading-snug">{error}</p>}
    </div>
  );
}
