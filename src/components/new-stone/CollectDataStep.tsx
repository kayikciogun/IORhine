'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Camera, Save, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  DATASET_TARGET_PER_CLASS,
  getDatasetStats,
  runSnapshotDetect,
  submitLabelBatch,
  type AiStatus,
  type SnapshotDetectResult,
} from '@/lib/runtimeClient';
import {
  boxFromDetected,
  initialLabelState,
  labelReducer,
  type StoneLabel,
} from './labelState';
import DeleteSessionButton from './DeleteSessionButton';

interface Props {
  stoneId: string;
  stoneName: string;
  isSymmetric: boolean;
  onReadyToTrain: () => void;
  onBack: () => void;
  onDeleted: () => void;
}

const LABEL_FILL: Record<StoneLabel, string> = {
  unlabeled: 'rgba(255, 255, 255, 0.08)',
  true: 'rgba(34, 197, 94, 0.38)',
  false: 'rgba(239, 68, 68, 0.38)',
  skip: 'rgba(107, 114, 128, 0.18)',
};

const LABEL_RING: Record<StoneLabel, string> = {
  unlabeled: 'rgba(255, 255, 255, 0.35)',
  true: 'rgba(34, 197, 94, 0.55)',
  false: 'rgba(239, 68, 68, 0.55)',
  skip: 'rgba(156, 163, 175, 0.35)',
};

const LABEL_CHIP: Record<StoneLabel, { bg: string; text: string; title: string }> = {
  unlabeled: { bg: 'rgba(0,0,0,0.65)', text: '#fde68a', title: '?' },
  true: { bg: 'rgba(22, 163, 74, 0.92)', text: '#fff', title: 'DÜZ' },
  false: { bg: 'rgba(220, 38, 38, 0.92)', text: '#fff', title: 'TERS' },
  skip: { bg: 'rgba(75, 85, 99, 0.85)', text: '#e5e7eb', title: 'ATLA' },
};

function shapePoints(
  box: { bx1: number; by1: number; bx2: number; by2: number; contour: [number, number][] | null },
  sx: number,
  sy: number,
): string {
  if (box.contour && box.contour.length >= 3) {
    return box.contour.map(([x, y]) => `${x * sx},${y * sy}`).join(' ');
  }
  const { bx1, by1, bx2, by2 } = box;
  return [
    `${bx1 * sx},${by1 * sy}`,
    `${bx2 * sx},${by1 * sy}`,
    `${bx2 * sx},${by2 * sy}`,
    `${bx1 * sx},${by2 * sy}`,
  ].join(' ');
}

export default function CollectDataStep({
  stoneId,
  stoneName,
  isSymmetric,
  onReadyToTrain,
  onBack,
  onDeleted,
}: Props) {
  const [state, dispatch] = useReducer(labelReducer, undefined, initialLabelState);
  const [snapshot, setSnapshot] = useState<SnapshotDetectResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState({ true: 0, false: 0 });
  const [target, setTarget] = useState(DATASET_TARGET_PER_CLASS);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState({ sx: 1, sy: 1, w: 0, h: 0 });

  const refreshStats = useCallback(async () => {
    try {
      const s = await getDatasetStats(stoneId);
      setCounts({ true: s.true, false: s.false });
      setTarget(s.target_per_class);
      if (s.ready_to_train) onReadyToTrain();
    } catch {
      /* ignore first load */
    }
  }, [stoneId, onReadyToTrain]);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  const updateScale = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;
    const rect = img.getBoundingClientRect();
    setScale({
      sx: rect.width / img.naturalWidth,
      sy: rect.height / img.naturalHeight,
      w: rect.width,
      h: rect.height,
    });
  }, []);

  useLayoutEffect(() => {
    updateScale();
  }, [snapshot?.image_base64, updateScale]);

  useEffect(() => {
    const onResize = () => updateScale();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [updateScale]);

  useEffect(() => {
    if (state.pulseId == null) return;
    const t = setTimeout(() => dispatch({ type: 'CLEAR_PULSE' }), 180);
    return () => clearTimeout(t);
  }, [state.pulseId]);

  useEffect(() => {
    if (!state.toast) return;
    const t = setTimeout(() => dispatch({ type: 'CLEAR_TOAST' }), 900);
    return () => clearTimeout(t);
  }, [state.toast]);

  const capture = async () => {
    setError(null);
    setAiLoading(true);
    try {
      const res = await runSnapshotDetect({
        draw: false,
        is_symmetric: isSymmetric,
        use_pca_angle: true,
        invert_threshold: true,
        thresh_val: 0,
      });
      if (res.ai_status) setAiStatus(res.ai_status as AiStatus);
      if (!res.ok) {
        setError(res.error || 'Kare alınamadı');
        return;
      }
      setSnapshot(res);
      const boxes = (res.objects ?? []).map(boxFromDetected);
      dispatch({ type: 'RESET', boxes });
      if (boxes.length === 0) {
        setError('Bu karede taş bulunamadı — kamerayı / sahneyi kontrol et.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiLoading(false);
    }
  };

  const applyLabel = useCallback(
    (label: StoneLabel) => {
      if (state.selectedId == null) return;
      dispatch({ type: 'LABEL', id: state.selectedId, label });
    },
    [state.selectedId],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        dispatch({ type: 'UNDO' });
        return;
      }
      if (e.key === '1') {
        e.preventDefault();
        applyLabel('true');
      } else if (e.key === '2') {
        e.preventDefault();
        applyLabel('false');
      } else if (e.key === '0' || e.key === '3') {
        e.preventDefault();
        applyLabel('skip');
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        applyLabel('unlabeled');
      } else if (e.key === 'Tab' || e.key === 'ArrowRight') {
        e.preventDefault();
        const ids = state.boxes.map((b) => b.id);
        if (!ids.length) return;
        const cur = state.selectedId == null ? -1 : ids.indexOf(state.selectedId);
        const next = ids[(cur + 1 + ids.length) % ids.length];
        dispatch({ type: 'SELECT', id: next });
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const ids = state.boxes.map((b) => b.id);
        if (!ids.length) return;
        const cur = state.selectedId == null ? 0 : ids.indexOf(state.selectedId);
        const prev = ids[(cur - 1 + ids.length) % ids.length];
        dispatch({ type: 'SELECT', id: prev });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyLabel, state.boxes, state.selectedId]);

  const labeledTrue = Object.values(state.labels).filter((l) => l === 'true').length;
  const labeledFalse = Object.values(state.labels).filter((l) => l === 'false').length;
  const labeledSkip = Object.values(state.labels).filter((l) => l === 'skip').length;
  const unlabeled = Object.values(state.labels).filter((l) => l === 'unlabeled').length;
  const canSave = labeledTrue + labeledFalse > 0 && !!snapshot?.image_base64;

  const handleSave = async () => {
    if (!snapshot?.image_base64 || !canSave) return;
    setSaving(true);
    setError(null);
    try {
      const labels = state.boxes
        .filter((b) => state.labels[b.id] === 'true' || state.labels[b.id] === 'false')
        .map((b) => ({
          bx1: b.bx1,
          by1: b.by1,
          bx2: b.bx2,
          by2: b.by2,
          label: state.labels[b.id] as 'true' | 'false',
        }));
      const res = await submitLabelBatch({
        stone_id: stoneId,
        frame_jpeg_base64: snapshot.image_base64,
        labels,
      });
      setCounts(res.counts);
      setTarget(res.target_per_class);
      setSavedFlash(`${res.saved} crop kaydedildi`);
      setTimeout(() => setSavedFlash(null), 1500);
      if (res.errors?.length) {
        setError(res.errors.slice(0, 3).join(' · '));
      }
      // Kareyi temizle — yeni kare için hazır
      setSnapshot(null);
      dispatch({ type: 'RESET', boxes: [] });
      if (res.ready_to_train) onReadyToTrain();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const truePct = Math.min(100, Math.round((counts.true / target) * 100));
  const falsePct = Math.min(100, Math.round((counts.false / target) * 100));
  const ready =
    counts.true >= target && counts.false >= target;

  return (
    <div className="flex flex-1 min-h-0 gap-0">
      {/* Sol: görüntü + overlay */}
      <div className="flex-1 min-w-0 flex flex-col border-r border-border/60">
        <div className="relative flex-1 min-h-0 bg-black flex items-center justify-center overflow-hidden">
          {snapshot?.image_base64 ? (
            <div className="relative max-w-full max-h-full">
              <img
                ref={imgRef}
                src={snapshot.image_base64}
                alt="Etiketleme karesi"
                className="max-w-full max-h-[calc(100vh-220px)] object-contain block"
                onLoad={updateScale}
                draggable={false}
              />
              {scale.w > 0 && (
                <svg
                  className="absolute inset-0"
                  width={scale.w}
                  height={scale.h}
                  viewBox={`0 0 ${scale.w} ${scale.h}`}
                >
                  <defs>
                    <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="2.5" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  {state.boxes.map((box) => {
                    const label = state.labels[box.id] ?? 'unlabeled';
                    const selected = state.selectedId === box.id;
                    const pulsing = state.pulseId === box.id;
                    const pts = shapePoints(box, scale.sx, scale.sy);
                    const chip = LABEL_CHIP[label];
                    const cx = box.cx * scale.sx;
                    const cy = box.cy * scale.sy;
                    // Chip taşın üstünde değil, biraz üst-dışta — yüzey okunabilsin
                    const chipY = Math.max(14, box.by1 * scale.sy - 10);
                    const chipW = label === 'unlabeled' ? 28 : 44;
                    return (
                      <g
                        key={box.id}
                        style={{
                          transformOrigin: `${cx}px ${cy}px`,
                          transform: pulsing ? 'scale(1.04)' : 'scale(1)',
                          transition: 'transform 140ms ease-out',
                        }}
                      >
                        {/* Seçili: yumuşak dış ışıma (çerçeve değil) */}
                        {selected && (
                          <polygon
                            points={pts}
                            fill="rgba(56, 189, 248, 0.18)"
                            stroke="rgba(56, 189, 248, 0.7)"
                            strokeWidth={1.2}
                            filter="url(#softGlow)"
                            className="pointer-events-none"
                          />
                        )}
                        {/* Boyama: şeffaf dolgu, neredeyse strokesiz */}
                        <polygon
                          points={pts}
                          fill={LABEL_FILL[label]}
                          stroke={LABEL_RING[label]}
                          strokeWidth={selected ? 1 : 0.6}
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            dispatch({ type: 'SELECT', id: box.id });
                          }}
                        />
                        {/* Etiket chip — taş yüzeyini kapatmaz */}
                        <g className="pointer-events-none">
                          <rect
                            x={cx - chipW / 2}
                            y={chipY - 11}
                            width={chipW}
                            height={16}
                            rx={4}
                            fill={chip.bg}
                          />
                          <text
                            x={cx}
                            y={chipY + 1}
                            textAnchor="middle"
                            fill={chip.text}
                            fontSize={9}
                            fontWeight={700}
                            letterSpacing={0.4}
                          >
                            #{box.id} {chip.title}
                          </text>
                        </g>
                      </g>
                    );
                  })}
                </svg>
              )}
              {state.toast && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 rounded-md bg-black/80 text-white text-xs px-3 py-1.5 font-medium shadow-lg">
                  {state.toast}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground px-6 text-center">
              <Camera className="w-8 h-8 opacity-50" />
              <p className="text-xs">Henüz kare yok</p>
              <p className="text-[11px] text-muted-foreground/80 max-w-sm">
                &quot;Kare Al&quot; ile taşları bul — kontüre tıkla, <kbd className="px-1 rounded bg-muted">1</kbd> Düz,{' '}
                <kbd className="px-1 rounded bg-muted">2</kbd> Ters.
              </p>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border/60 bg-card/50 px-3 py-2 flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onBack}>
            ← Geri
          </Button>
          <div className="text-[11px] text-muted-foreground truncate">
            <span className="font-medium text-foreground">{stoneName}</span>
            <span className="mx-1.5">·</span>
            <span className="font-mono">{stoneId}</span>
          </div>
          <div className="flex-1" />
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-muted-foreground mr-2">
            <Badge variant="outline" className="h-5 text-[9px] border-amber-500/40 text-amber-300">etiketsiz</Badge>
            <Badge variant="outline" className="h-5 text-[9px] border-emerald-500/40 text-emerald-300">1 Düz</Badge>
            <Badge variant="outline" className="h-5 text-[9px] border-red-500/40 text-red-300">2 Ters</Badge>
            <Badge variant="outline" className="h-5 text-[9px]">0 Atla</Badge>
            <Badge variant="outline" className="h-5 text-[9px]">Ctrl+Z</Badge>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            disabled={state.history.length === 0}
            onClick={() => dispatch({ type: 'UNDO' })}
            title="Geri al (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1.5 text-xs bg-purple-600 hover:bg-purple-500"
            disabled={aiLoading || (aiStatus != null && aiStatus !== 'ready')}
            onClick={capture}
          >
            <Camera className="w-3 h-3" />
            {aiLoading ? 'Analiz…' : 'Kare Al'}
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={!canSave || saving}
            onClick={handleSave}
          >
            <Save className="w-3 h-3" />
            {saving ? 'Kaydediliyor…' : `Kaydet (${labeledTrue + labeledFalse})`}
          </Button>
        </div>
      </div>

      {/* Sağ: sayaç + yardım */}
      <aside className="w-full sm:w-[280px] shrink-0 flex flex-col bg-card/30 p-3 gap-3 overflow-y-auto">
        <div className="space-y-1">
          <h3 className="text-xs font-semibold">Veri seti ilerlemesi</h3>
          <p className="text-[10px] text-muted-foreground">
            Hedef: sınıf başı {target} örnek
          </p>
        </div>

        <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5">
          <div className="flex justify-between text-[11px]">
            <span className="text-emerald-300 font-medium">Düz (true)</span>
            <span className="font-mono tabular-nums">
              {counts.true} / {target}
            </span>
          </div>
          <Progress value={truePct} className="h-1.5 [&>div]:bg-emerald-500" />
        </div>

        <div className="space-y-2 rounded-lg border border-red-500/30 bg-red-500/5 p-2.5">
          <div className="flex justify-between text-[11px]">
            <span className="text-red-300 font-medium">Ters (false)</span>
            <span className="font-mono tabular-nums">
              {counts.false} / {target}
            </span>
          </div>
          <Progress value={falsePct} className="h-1.5 [&>div]:bg-red-500" />
        </div>

        {snapshot && (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5 space-y-1 text-[11px]">
            <div className="font-medium text-foreground/90">Bu kare</div>
            <div className="flex justify-between">
              <span className="text-emerald-300">Düz</span>
              <span className="font-mono">{labeledTrue}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-red-300">Ters</span>
              <span className="font-mono">{labeledFalse}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Atlandı</span>
              <span className="font-mono">{labeledSkip}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-amber-300">Etiketsiz</span>
              <span className="font-mono">{unlabeled}</span>
            </div>
          </div>
        )}

        <div className="text-[10px] text-muted-foreground leading-relaxed space-y-1 border-t border-border/50 pt-2">
          <p>
            <strong className="text-foreground/80">Kullanım:</strong> kontüre
            tıkla → <kbd className="px-1 rounded bg-muted">1</kbd> /{' '}
            <kbd className="px-1 rounded bg-muted">2</kbd>. Etiket sonrası otomatik
            sonraki kutuya geçer.
          </p>
          <p>Yanlışsa tekrar seçip tuşa bas veya Ctrl+Z.</p>
        </div>

        {savedFlash && (
          <p className="text-[11px] text-emerald-300 bg-emerald-500/10 rounded px-2 py-1.5">
            {savedFlash}
          </p>
        )}
        {error && (
          <p className="text-[11px] text-red-400 bg-red-500/10 rounded px-2 py-1.5">
            {error}
          </p>
        )}

        <Button
          className="mt-auto h-9"
          disabled={!ready}
          onClick={onReadyToTrain}
        >
          {ready ? 'Eğitime geç →' : `Eğitim için ${Math.max(0, target - counts.true)} düz + ${Math.max(0, target - counts.false)} ters`}
        </Button>

        <DeleteSessionButton
          stoneId={stoneId}
          stoneName={stoneName}
          onDeleted={onDeleted}
          className="w-full [&>button]:w-full"
        />
      </aside>
    </div>
  );
}
