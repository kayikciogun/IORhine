'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Wifi, WifiOff } from 'lucide-react';
import {
  connectCameraSocket,
  getDefaultRuntimeClientConfig,
} from '@/lib/runtimeClient';
import type { DetectedStone } from '@/types/runtime';
import { Badge } from '@/components/ui/badge';

interface Props {
  enabled: boolean;
  className?: string;
  /** Production yan düzeni: küçük önizleme (geniş ana sütunda dev kalmaz). */
  compact?: boolean;
  /** Değişince WebSocket yeniden bağlanır (kamera değişimi). */
  streamKey?: string;
  onFrame?: (stones: DetectedStone[], fps: number | null) => void;
  onCameraError?: (msg: string) => void;
}

export default function LiveCameraView({
  enabled,
  className = '',
  compact = false,
  streamKey = 'default',
  onFrame,
  onCameraError,
}: Props) {
  const compactShell =
    'inline-block w-fit max-w-[min(280px,92vw)]';
  const frameClass = compact
    ? 'block h-auto max-h-[min(200px,24vh)] w-auto max-w-[280px] object-contain'
    : 'w-full aspect-[16/10] object-contain';
  const placeholderClass = compact
    ? 'flex min-h-[140px] w-[260px] max-w-full max-h-[min(200px,24vh)] items-center justify-center'
    : 'flex aspect-[16/10] w-full items-center justify-center';
  const [src, setSrc] = useState<string | null>(null);
  const [stones, setStones] = useState<DetectedStone[]>([]);
  const [connected, setConnected] = useState(false);
  const [fps, setFps] = useState<number | null>(null);
  const [camError, setCamError] = useState<string | null>(null);

  const onFrameRef = useRef(onFrame);
  const onCameraErrorRef = useRef(onCameraError);
  onFrameRef.current = onFrame;
  onCameraErrorRef.current = onCameraError;

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }
    const config = getDefaultRuntimeClientConfig();
    const conn = connectCameraSocket(config, {
      onOpen: () => {
        setConnected(true);
        setCamError(null);
      },
      onClose: () => setConnected(false),
      onFrame: (ev) => {
        setSrc(`data:image/jpeg;base64,${ev.jpg_base64}`);
        const list = ev.stones ?? [];
        setStones(list);
        if (ev.fps != null) setFps(ev.fps);
        setCamError(null);
        onFrameRef.current?.(list, ev.fps ?? null);
      },
      onError: (msg) => {
        setCamError(msg);
        onCameraErrorRef.current?.(msg);
      },
    });
    return () => conn.close();
  }, [enabled, streamKey]);

  if (!enabled) {
    return (
      <div
        className={`flex flex-col items-center justify-center border border-dashed border-border bg-muted/20 ${
          compact ? `${compactShell} min-h-[120px]` : 'aspect-[16/10]'
        } ${className}`}
      >
        <Camera className="w-6 h-6 text-muted-foreground/50 mb-1" />
        <p className="text-xs text-muted-foreground">Kamera kapalı</p>
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden border border-border bg-black/90 ${
        compact ? compactShell : ''
      } ${className}`}
    >
      <div className="absolute top-1.5 left-1.5 right-1.5 z-10 flex flex-wrap items-center gap-1.5">
        <Badge variant={connected ? 'default' : 'secondary'} className="gap-1 text-[9px] h-5 px-1.5">
          {connected ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
          {connected ? 'Canlı' : 'Bağlanıyor…'}
        </Badge>
        {fps != null && (
          <Badge variant="outline" className="text-[9px] h-5 px-1.5 bg-black/50 text-white border-white/20">
            {fps.toFixed(0)} FPS
          </Badge>
        )}
        <Badge variant="outline" className="text-[9px] h-5 px-1.5 bg-black/50 text-white border-white/20 ml-auto">
          {stones.length} nesne
        </Badge>
      </div>

      {camError && (
        <div className="absolute bottom-1.5 left-1.5 right-1.5 z-10 text-[9px] text-amber-200 bg-black/70 rounded px-1.5 py-0.5">
          {camError}
        </div>
      )}

      {src ? (
        <img src={src} alt="Konveyör kamerası" className={frameClass} />
      ) : (
        <div className={`${placeholderClass} flex-col text-muted-foreground`}>
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mb-1" />
          <span className="text-[10px]">Frame bekleniyor…</span>
        </div>
      )}
    </div>
  );
}
