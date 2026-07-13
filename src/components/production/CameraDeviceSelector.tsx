'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

function configId(cfg: CameraSourceConfig): string {
  return `${cfg.kind}:${cfg.source_id}`;
}

export default function CameraDeviceSelector({ onSelected, disabled }: Props) {
  const [devices, setDevices] = useState<CameraDeviceList | null>(null);
  const [active, setActive] = useState<CameraSourceConfig | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSelectedRef = useRef(onSelected);
  onSelectedRef.current = onSelected;

  const connectDevice = useCallback(async (deviceId: string) => {
    setApplying(true);
    setError(null);
    try {
      const { config } = await selectCameraDevice(deviceId);
      setActive(config);
      setSelectedId(configId(config));
      onSelectedRef.current?.(config);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setApplying(false);
    }
  }, []);

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
        setSelectedId(configId(status.config));
      }
      return status;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Açılışta son kaydedilen kamerayı otomatik bağla ("Bağla" tıklaması gerekmesin).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const status = await refresh();
      if (cancelled || !status?.config) return;

      if (status.is_live) {
        onSelectedRef.current?.(status.config);
        return;
      }

      await connectDevice(configId(status.config));
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, connectDevice]);

  const flat = useMemo(
    () => (devices ? flattenDevices(devices) : []),
    [devices],
  );

  const handleApply = async () => {
    if (!selectedId) return;
    await connectDevice(selectedId);
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
