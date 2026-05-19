'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getCameraStatus,
  listCameraDevices,
  selectCameraDevice,
} from '@/lib/runtimeClient';
import type { CameraDevice, CameraDeviceList, CameraSourceConfig } from '@/types/runtime';
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
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Usb, Loader2 } from 'lucide-react';

interface Props {
  onSelected?: (config: CameraSourceConfig) => void;
  disabled?: boolean;
}

function flattenDevices(list: CameraDeviceList): CameraDevice[] {
  return list.usb;
}

export default function CameraDeviceSelector({ onSelected, disabled }: Props) {
  const [devices, setDevices] = useState<CameraDeviceList | null>(null);
  const [active, setActive] = useState<CameraSourceConfig | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, status] = await Promise.all([
        listCameraDevices(),
        getCameraStatus(),
      ]);
      setDevices(list);
      setActive(status.config);
      if (status.config) {
        setSelectedId(`${status.config.kind}:${status.config.source_id}`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const flat = useMemo(
    () => (devices ? flattenDevices(devices) : []),
    [devices],
  );

  const handleApply = async () => {
    if (!selectedId) return;
    setApplying(true);
    setError(null);
    try {
      const { config } = await selectCameraDevice(selectedId);
      setActive(config);
      onSelected?.(config);
    } catch (e) {
      setError(String(e));
    } finally {
      setApplying(false);
    }
  };

  const activeLabel = useMemo(() => {
    if (!active) return 'Seçilmedi';
    const match = flat.find(
      (d) => d.id === `${active.kind}:${active.source_id}`,
    );
    return match?.label ?? `${active.kind} — ${active.source_id}`;
  }, [active, flat]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Select
          value={selectedId}
          onValueChange={setSelectedId}
          disabled={disabled || loading || flat.length === 0}
        >
          <SelectTrigger className="h-7 text-[11px] flex-1">
            <SelectValue placeholder="Kamera seçin…" />
          </SelectTrigger>
          <SelectContent>
            {devices && devices.usb.length > 0 && (
              <SelectGroup>
                <SelectLabel className="flex items-center gap-1 text-xs">
                  <Usb className="w-3 h-3" /> USB / Kamera
                </SelectLabel>
                {devices.usb.map((d) => (
                  <SelectItem
                    key={d.id}
                    value={d.id}
                    disabled={d.available === false}
                    className="text-xs"
                  >
                    {d.label}
                    {d.available === false ? ' (bağlanamadı)' : ''}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
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
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
        </Button>

        <Button
          type="button"
          size="sm"
          className="h-7 text-[10px] px-2.5 shrink-0"
          onClick={handleApply}
          disabled={!selectedId || applying || disabled}
        >
          {applying ? '…' : 'Bağla'}
        </Button>
      </div>

      {active && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Badge variant="outline" className="font-normal text-[9px] h-4 px-1">
            Aktif
          </Badge>
          <span className="truncate">{activeLabel}</span>
        </div>
      )}

      {error && (
        <p className="text-[10px] text-destructive leading-snug">{error}</p>
      )}

      {!loading && !error && devices && devices.usb.length === 0 && (
        <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-snug">
          Kamera bulunamadı — runtime çalışıyor mu?
        </p>
      )}
    </div>
  );
}
