'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Camera, Play, CheckCircle2 } from 'lucide-react';
import DeleteSessionButton from './DeleteSessionButton';
import {
  activateOrientationModel,
  getOrientationTrainStatus,
  startOrientationTrain,
  type TrainStatus,
} from '@/lib/runtimeClient';

interface Props {
  stoneId: string;
  stoneName: string;
  counts: { true: number; false: number };
  onContinueCollect: () => void;
  onDeleted: () => void;
}

export default function TrainStep({
  stoneId,
  stoneName,
  counts,
  onContinueCollect,
  onDeleted,
}: Props) {
  const [status, setStatus] = useState<TrainStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activatedDir, setActivatedDir] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await getOrientationTrainStatus();
      setStatus(s);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while running
  useEffect(() => {
    if (status?.status !== 'running') return;
    const t = setInterval(() => void refresh(), 1500);
    return () => clearInterval(t);
  }, [status?.status, refresh]);

  const handleStart = async () => {
    setError(null);
    setBusy(true);
    setActivatedDir(null);
    try {
      const s = await startOrientationTrain({
        stone_id: stoneId,
        epochs: 15,
        batch_size: 16,
        lr: 1e-4,
      });
      setStatus(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleActivate = async () => {
    setError(null);
    setActivating(true);
    try {
      const res = await activateOrientationModel({
        stone_id: stoneId,
        model_dir: status?.model_dir || undefined,
      });
      setActivatedDir(res.model_dir);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActivating(false);
    }
  };

  const running = status?.status === 'running';
  const done = status?.status === 'done' && status.stone_id === stoneId;
  const failed = status?.status === 'error' && status.stone_id === stoneId;
  const epochPct =
    status && status.epochs > 0
      ? Math.min(100, Math.round((status.epoch / status.epochs) * 100))
      : 0;
  const canActivate =
    done &&
    !!status?.model_dir &&
    (status.best_val_acc ?? 0) >= 0.75;

  return (
    <div className="max-w-lg mx-auto py-8 space-y-5 px-4">
      <div className="space-y-1.5 text-center">
        <h2 className="text-base font-semibold">Eğitim</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">{stoneName}</span> veri
          setiyle ConvNeXt fine-tune → ONNX. Bitince modeli hot-reload ile
          devreye al.
        </p>
      </div>

      <div className="flex justify-center gap-2">
        <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300">
          Düz {counts.true}
        </Badge>
        <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-300">
          Ters {counts.false}
        </Badge>
        <Badge variant="secondary" className="text-[10px] font-mono">
          {stoneId}
        </Badge>
      </div>

      {(running || done || failed) && status && (
        <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-2.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium">
              {running
                ? 'Eğitiliyor…'
                : done
                  ? 'Tamamlandı'
                  : 'Hata'}
            </span>
            <span className="font-mono tabular-nums text-muted-foreground">
              {status.epoch}/{status.epochs}
            </span>
          </div>
          <Progress value={running ? Math.max(4, epochPct) : 100} className="h-1.5" />
          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
            <div>
              train_acc{' '}
              <span className="text-foreground">{(status.train_acc * 100).toFixed(1)}%</span>
            </div>
            <div>
              val_acc{' '}
              <span className="text-foreground">{(status.val_acc * 100).toFixed(1)}%</span>
            </div>
            <div className="col-span-2 text-emerald-300">
              best {(status.best_val_acc * 100).toFixed(1)}%
            </div>
          </div>
          {status.message && (
            <p className="text-[10px] text-muted-foreground">{status.message}</p>
          )}
          {failed && status.error && (
            <p className="text-[11px] text-red-400">{status.error}</p>
          )}
        </div>
      )}

      {done && status && status.best_val_acc < 0.75 && (
        <p className="text-[11px] text-amber-400 bg-amber-500/10 rounded px-2 py-1.5">
          Val accuracy düşük ({(status.best_val_acc * 100).toFixed(0)}%). Daha
          fazla veri toplayıp yeniden eğitmen önerilir — yine de deneyebilirsin.
        </p>
      )}

      {activatedDir && (
        <p className="text-[11px] text-emerald-300 bg-emerald-500/10 rounded px-2 py-1.5 flex items-start gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Model devrede: <code className="text-[10px] break-all">{activatedDir}</code>
        </p>
      )}

      {error && (
        <p className="text-[11px] text-red-400 bg-red-500/10 rounded px-2 py-1.5">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Button
          className="h-9 gap-1.5"
          onClick={handleStart}
          disabled={busy || running}
        >
          <Play className="w-3.5 h-3.5" />
          {busy
            ? 'Başlatılıyor…'
            : running
              ? 'Eğitim sürüyor…'
              : done
                ? 'Yeniden eğit'
                : 'Eğitimi başlat'}
        </Button>

        <Button
          className="h-9 gap-1.5 bg-emerald-700 hover:bg-emerald-600"
          onClick={handleActivate}
          disabled={!done || activating || !status?.model_dir}
          title={
            !canActivate && done
              ? 'Val acc düşük — yine de aktifleştirilebilir'
              : undefined
          }
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          {activating ? 'Yükleniyor…' : 'Devreye al'}
        </Button>

        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <Button
            variant="outline"
            className="h-8 gap-1.5 flex-1"
            onClick={onContinueCollect}
            disabled={running}
          >
            <Camera className="w-3.5 h-3.5" />
            Veri toplamaya devam
          </Button>
          <DeleteSessionButton
            stoneId={stoneId}
            stoneName={stoneName}
            onDeleted={onDeleted}
          />
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground text-center">
        Çıktı:{' '}
        <code className="bg-muted px-1 rounded">
          datasets/orientation_model_{stoneId}/
        </code>
      </p>
    </div>
  );
}
