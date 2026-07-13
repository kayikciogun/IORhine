'use client';

import { Button } from '@/components/ui/button';
import LiveCameraView from '@/components/production/LiveCameraView';
import type { DetectedStone } from '@/types/runtime';
import type { SnapshotDetectResult } from '@/lib/runtimeClient';

interface Props {
  objects?: DetectedStone[];
  aiSnapshotResult?: SnapshotDetectResult | null;
  onAiSnapshotResult?: (res: SnapshotDetectResult | null) => void;
  activeMainView?: 'live' | 'ai';
  onSwapView?: (view: 'live' | 'ai') => void;
  cameraOn?: boolean;
  cameraStreamKey?: string;
  onCameraFrame?: (stones: DetectedStone[], fps: number | null) => void;
  onCameraError?: (msg: string) => void;
}

export default function VisionTunePanel({
  objects = [],
  aiSnapshotResult,
  activeMainView,
  onSwapView,
  cameraOn = true,
  cameraStreamKey = 'default',
  onCameraFrame,
  onCameraError,
}: Props) {
  return (
    <div className="space-y-4 text-xs">
      <div className="p-2.5 rounded-lg border border-purple-500/30 bg-purple-500/5 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold tracking-wide text-purple-300 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
            Küçük Ekran Önizleme
          </h3>
          {aiSnapshotResult?.objects && (
            <span className="text-[10px] font-medium text-purple-200 bg-purple-900/60 px-2 py-0.5 rounded">
              {aiSnapshotResult.objects.length} nesne bulundu
            </span>
          )}
        </div>
        <p className="text-[9.5px] text-muted-foreground leading-tight">
          Kamera alt araç çubuğundaki "Tek Kare AI Tespiti (Kare Al)" butonunu kullanarak anlık semantik tespit yapabilirsiniz.
        </p>

        {activeMainView === 'ai' ? (
          <div className="mt-2 space-y-1.5 border-t border-purple-500/20 pt-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-medium text-emerald-300 flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Canlı Kamera (Küçük Ekran)
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onSwapView?.('live')}
                className="h-6 px-2 text-[10px] bg-emerald-950/80 hover:bg-emerald-900 border-emerald-500/50 text-emerald-100"
              >
                Büyük Ekrana Al / Canlı İzle
              </Button>
            </div>
            <div className="w-full h-[180px] rounded border border-emerald-500/30 bg-black overflow-hidden relative">
              <LiveCameraView
                enabled={cameraOn}
                streamKey={cameraStreamKey}
                onFrame={onCameraFrame}
                onCameraError={onCameraError}
                className="w-full h-full object-contain"
              />
            </div>
          </div>
        ) : (
          <div className="mt-2 space-y-1.5 border-t border-purple-500/20 pt-2">
            {aiSnapshotResult?.image_base64 ? (
              <>
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-medium text-purple-200">AI Snapshot Sonucu:</div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onSwapView?.('ai')}
                    className="h-6 px-2 text-[10px] bg-purple-950/80 hover:bg-purple-900 border-purple-500/50 text-purple-100"
                  >
                    Büyük Ekrana Al / İncele
                  </Button>
                </div>
                <img
                  src={aiSnapshotResult.image_base64}
                  alt="AI Snapshot Detection"
                  className="w-full h-auto rounded border border-purple-500/30 bg-black object-contain max-h-[220px] cursor-pointer"
                  onClick={() => onSwapView?.('ai')}
                />
                {aiSnapshotResult.vlm_text && (
                  <div className="text-[9px] font-mono text-purple-300/80 bg-black/60 p-1.5 rounded max-h-16 overflow-y-auto">
                    VLM Çıktısı: {aiSnapshotResult.vlm_text}
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-medium text-emerald-300 flex items-center gap-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Canlı Kamera (Küçük Ekran)
                  </div>
                </div>
                <div className="w-full h-[180px] rounded border border-emerald-500/30 bg-black overflow-hidden relative">
                  <LiveCameraView
                    enabled={cameraOn}
                    streamKey={cameraStreamKey}
                    onFrame={onCameraFrame}
                    onCameraError={onCameraError}
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

