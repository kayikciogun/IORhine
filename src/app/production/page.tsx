'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useDxf } from '@/contexts/DxfContext';
import { usePickPlace } from '@/contexts/PickPlaceContext';
import { buildPlacementOrders } from '@/operations/placementOrders';
import { placementOrdersToCsv } from '@/operations/csvExport';
import { ordersToRows } from '@/lib/placementCsv';
import { loadPlacementSnapshot, savePlacementSnapshot } from '@/lib/appSessionStore';
import { loadGlueStripSnapshot, syncGlueStripToRuntime } from '@/lib/glueStripSync';
import { loadPlanningBundle, type PlanningBundle } from '@/lib/planningPipeline';
import PlanningSummaryCard from '@/components/production/PlanningSummaryCard';
import {
  connectControlSocket,
  getCalibration,
  getCameraStatus,
  getDefaultRuntimeClientConfig,
  getGlueSheetStatus,
  getJobStatus,
  resetGlueSheet,
  runSnapshotDetect,
  type SnapshotDetectResult,
  uploadJob,
} from '@/lib/runtimeClient';
import type {
  CalibrationSummary,
  ControlCommand,
  DetectedStone,
  GlueSheetStatus,
  JobPhase,
  PlacementCsvRow,
  RuntimeEvent,
} from '@/types/runtime';
import { PHASE_LABELS } from '@/types/runtime';
import JobControlPanel from '@/components/production/JobControlPanel';
import ProgressDisplay from '@/components/production/ProgressDisplay';
import EventLog, { runtimeEventToLogText } from '@/components/production/EventLog';
import CameraDeviceSelector from '@/components/production/CameraDeviceSelector';
import type { CameraSourceConfig } from '@/types/runtime';
import MotionPortSelector from '@/components/production/MotionPortSelector';
import MotionConfigPanel from '@/components/production/MotionConfigPanel';
import PlacementJobTable from '@/components/production/PlacementJobTable';
import GlueSheetStatusPanel from '@/components/production/GlueSheetStatus';
import CalibrationPanel from '@/components/production/CalibrationPanel';
import VisionTunePanel from '@/components/production/VisionTunePanel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  ArrowLeft,
  Upload,
  RefreshCw,
  Factory,
  Camera,
  ListOrdered,
  Settings2,
  ScrollText,
} from 'lucide-react';

export default function ProductionPage() {
  const { dxfScene, selectedDxfFile } = useDxf();
  const { stoneTypes, pickPlaceConfig } = usePickPlace();

  const [phase, setPhase] = useState<JobPhase>('idle');
  const [index, setIndex] = useState(0);
  const [total, setTotal] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [detectedObjects, setDetectedObjects] = useState<DetectedStone[]>([]);
  const [aiSnapshotResult, setAiSnapshotResult] = useState<SnapshotDetectResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  /** Seri mod: cevap gelir gelmez yeni kare tespiti. */
  const [serialDetect, setSerialDetect] = useState(false);
  const [detectFps, setDetectFps] = useState<number | null>(null);
  const serialDetectRef = useRef(false);
  const detectFpsEmaRef = useRef(0);
  const [csvRows, setCsvRows] = useState<PlacementCsvRow[]>([]);
  const [calSummary, setCalSummary] = useState<CalibrationSummary | null>(null);
  const [glueStatus, setGlueStatus] = useState<GlueSheetStatus | null>(null);
  const [glueLoading, setGlueLoading] = useState(true);
  const [glueError, setGlueError] = useState<string | null>(null);
  const [logEntries, setLogEntries] = useState<{ id: number; ts: Date; text: string }[]>([]);
  const [runtimeOnline, setRuntimeOnline] = useState<boolean | null>(null);
  // P2-B12: offline guard + exponential backoff. Runtime offline iken
  // 8s interval her seferinde fetch yapar — CPU/network boşa. ``runtimeOnlineRef``
  // ile offline iken early-return; backoff 8s→16s→32s (max 32s).
  const runtimeOnlineRef = useRef<boolean | null>(null);
  const refreshBackoffRef = useRef<number>(8000);
  // Hydration fix: ``typeof window`` SSR/CSR branch'i hydration mismatch yaratır
  // (server null render eder, client bundle render eder → <p> vs <div> farkı).
  // İlk render her zaman null (empty state), mount sonrası useEffect ile yükle.
  const [planningBundle, setPlanningBundle] = useState<PlanningBundle | null>(null);
  const logId = useRef(0);
  const controlRef = useRef<ReturnType<typeof connectControlSocket> | null>(null);

  const appendLog = useCallback((text: string) => {
    setLogEntries((prev) => {
      logId.current += 1;
      return [
        ...prev.slice(-199),
        { id: logId.current, ts: new Date(), text },
      ];
    });
  }, []);

  useEffect(() => {
    getCameraStatus()
      .then((s) => {
        if (s.is_live || s.config) setCameraReady(true);
      })
      .catch(() => {});
  }, []);

  const applySnapshotResult = useCallback(
    (res: SnapshotDetectResult, opts: { quiet: boolean }) => {
      setAiSnapshotResult(res);
      if (res.objects) {
        setDetectedObjects(
          res.objects.map((o) => ({
            id: o.id,
            index: o.index,
            x: o.x,
            y: o.y,
            cx: o.cx,
            cy: o.cy,
            angle: o.angle,
            score: o.score,
            area: o.area ?? 0,
            w: o.w,
            h: o.h,
            orientation: o.orientation,
            orientation_confidence: o.orientation_confidence,
          })),
        );
      } else {
        setDetectedObjects([]);
      }
      if (opts.quiet) return;
      if (!res.ok && res.error) {
        appendLog(`AI Hata: ${res.error}`);
      } else if (res.objects) {
        appendLog(`AI Snapshot: ${res.objects.length} nesne tespit edildi.`);
      }
    },
    [appendLog],
  );

  const runOneAiSnapshot = useCallback(
    async (opts?: { quiet?: boolean }) => {
      const quiet = opts?.quiet === true;
      setAiLoading(true);
      const t0 = performance.now();
      try {
        const res = await runSnapshotDetect({
          thresh_val: 0,
          invert_threshold: true,
          use_pca_angle: true,
          is_symmetric: true,
          draw: true,
        });
        applySnapshotResult(res, { quiet });
        const elapsed = (performance.now() - t0) / 1000;
        if (res.ok && elapsed > 0.001) {
          const inst = 1 / elapsed;
          detectFpsEmaRef.current =
            detectFpsEmaRef.current <= 0
              ? inst
              : detectFpsEmaRef.current * 0.7 + inst * 0.3;
          setDetectFps(detectFpsEmaRef.current);
        }
        return res;
      } catch (err) {
        if (!quiet) appendLog(`Snapshot AI Tespiti Başarısız: ${err}`);
        throw err;
      } finally {
        setAiLoading(false);
      }
    },
    [appendLog, applySnapshotResult],
  );

  const handleRunAiSnapshot = async () => {
    if (serialDetect) return;
    try {
      await runOneAiSnapshot({ quiet: false });
    } catch {
      // log already handled
    }
  };

  // Seri mod: cevap geldikçe sürekli yeni frame tespiti
  useEffect(() => {
    serialDetectRef.current = serialDetect;
    if (!serialDetect) return;
    let cancelled = false;
    (async () => {
      while (!cancelled && serialDetectRef.current) {
        try {
          await runOneAiSnapshot({ quiet: true });
        } catch {
          await new Promise((r) => setTimeout(r, 400));
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serialDetect, runOneAiSnapshot]);

  const handleSerialToggle = (on: boolean) => {
    if (on) {
      detectFpsEmaRef.current = 0;
      setDetectFps(null);
      appendLog('Seri tespit açıldı');
    } else {
      appendLog('Seri tespit kapatıldı');
    }
    setSerialDetect(on);
  };

  const refreshAux = useCallback(async () => {
    // P2-B12: offline iken early-return — runtime down iken her 8s fetch yapma.
    // İlk yükleme ve manuel refresh (runtimeOnlineRef === null) her zaman çalışır.
    if (runtimeOnlineRef.current === false) {
      return;
    }
    setGlueLoading(true);
    try {
      const base = getDefaultRuntimeClientConfig().restBaseUrl;
      const health = await fetch(`${base}/health`);
      const online = health.ok;
      setRuntimeOnline(online);
      runtimeOnlineRef.current = online;
      // P2-B12: online ise backoff'u resetle.
      if (online) refreshBackoffRef.current = 8000;
      if (!online) {
        setGlueError('Runtime yanıt vermiyor');
        setGlueStatus(null);
        // P2-B12: exponential backoff 8s→16s→32s (cap).
        refreshBackoffRef.current = Math.min(refreshBackoffRef.current * 2, 32000);
        return;
      }
      const cal = await getCalibration();
      setCalSummary(cal);
      try {
        const glue = await getGlueSheetStatus();
        setGlueStatus(glue);
        setGlueError(null);
      } catch (e) {
        setGlueStatus(null);
        setGlueError(e instanceof Error ? e.message : String(e));
      }
      // AI durumu artık kamera frame'inden (ws/camera) geliyor — her frame'de
      // ``ai_status`` field'ı var. Burada ayrıca poll yapmaya gerek yok.
    } catch {
      setRuntimeOnline(false);
      runtimeOnlineRef.current = false;
      setGlueStatus(null);
      setGlueError('Runtime bağlantısı kurulamadı');
      // P2-B12: backoff artır.
      refreshBackoffRef.current = Math.min(refreshBackoffRef.current * 2, 32000);
    } finally {
      setGlueLoading(false);
    }
  }, []);

  const loadRowsFromScene = useCallback(() => {
    if (!dxfScene) return [];
    const orders = buildPlacementOrders(dxfScene, stoneTypes, pickPlaceConfig);
    return ordersToRows(orders);
  }, [dxfScene, stoneTypes, pickPlaceConfig]);

  const loadRowsFromSession = useCallback(() => {
    const snap = loadPlacementSnapshot();
    return snap?.rows ?? [];
  }, []);

  useEffect(() => {
    const fromSession = loadRowsFromSession();
    if (fromSession.length) {
      setCsvRows(fromSession);
      return;
    }
    const fromScene = loadRowsFromScene();
    if (fromScene.length) setCsvRows(fromScene);
  }, [loadRowsFromScene, loadRowsFromSession]);

  useEffect(() => {
    setPlanningBundle(loadPlanningBundle());
    const pending = loadGlueStripSnapshot();
    const bundle = loadPlanningBundle();
    const pushGlue = (snap: NonNullable<ReturnType<typeof loadGlueStripSnapshot>>) =>
      syncGlueStripToRuntime(snap)
        .then(() =>
          appendLog(
            `Yapışkan levha: ${snap.cols}×${snap.rows} (${snap.cells.length} karo)`,
          ),
        )
        .catch((e) =>
          appendLog(`Yapışkan levha: ${e instanceof Error ? e.message : e}`),
        );

    if (bundle && pending) {
      void pushGlue(pending).finally(() => void refreshAux());
    } else if (pending) {
      void pushGlue(pending).finally(() => void refreshAux());
    } else {
      if (bundle) {
        appendLog(
          `Planlama: ${bundle.csvRowCount} CSV, yapışkan ${bundle.glueCols}×${bundle.glueRows}`,
        );
      }
      void refreshAux();
    }
    // P2-B12: recursive setTimeout ile dynamic backoff — setInterval yerine.
    // Offline iken 8s→16s→32s; online iken 8s sabit.
    let timer: ReturnType<typeof setTimeout>;
    const scheduleNext = () => {
      timer = setTimeout(() => {
        void refreshAux().finally(() => scheduleNext());
      }, refreshBackoffRef.current);
    };
    scheduleNext();
    return () => clearTimeout(timer);
  }, [refreshAux, appendLog]);

  useEffect(() => {
    const config = getDefaultRuntimeClientConfig();
    controlRef.current = connectControlSocket(config, {
      onEvent: (ev: RuntimeEvent) => {
        appendLog(runtimeEventToLogText(ev));
        if (ev.evt === 'state') {
          setPhase(ev.data.phase);
          setIndex(ev.data.i);
          setTotal(ev.data.total);
        }
        if (ev.evt === 'placed') setIndex(ev.data.i);
        if (ev.evt === 'glue_cell') {
          // Backend ``glue_cell`` event'i 1-indeksli cell numarası yollar
          // (``glue.cursor + 1``). Frontend tarafında ``GlueSheetStatus.cursor``
          // ise tüketilen hücre sayısı (0-indeksli, backend ile uyumlu).
          // Tutarlılık için ``cell - 1`` saklayıp ``Math.max`` ile monoton tutuyoruz.
          setGlueStatus((prev) => {
            if (!prev) return prev;
            const consumed = Math.max(prev.cursor, ev.data.cell - 1);
            return {
              ...prev,
              cursor: consumed,
              remaining: Math.max(0, prev.total - consumed),
            };
          });
        }
        if (ev.evt === 'glue_sheet_exhausted') {
          // Levha bitti → backend fazı 'paused' yapıyor; UI senkron kalsın.
          setPhase('paused');
          appendLog('Yapışkan levha bitti — Levha sıfırla + Devam gerekli (§10).');
        }
        if (ev.evt === 'job_complete') setPhase('complete');
      },
      onOpen: () => {
        setRuntimeOnline(true);
        appendLog('Kontrol kanalı bağlandı');
      },
      onClose: () => {
        setRuntimeOnline(false);
        appendLog('Kontrol kanalı kapandı');
      },
      onError: (err) => {
        // P1-16: onError handler yoktu; WS hatası sessizce yutuluyordu.
        setRuntimeOnline(false);
        appendLog(`Kontrol kanalı hatası: ${String(err)}`);
      },
    });
    return () => controlRef.current?.close();
  }, [appendLog]);

  const handleUploadJob = async () => {
    setLoading(true);
    try {
      let rows = loadRowsFromScene();
      let csv: string;

      if (rows.length) {
        const orders = buildPlacementOrders(dxfScene!, stoneTypes, pickPlaceConfig);
        csv = placementOrdersToCsv(orders);
        savePlacementSnapshot({
          rows,
          csv,
          fileName: selectedDxfFile?.name,
        });
      } else {
        const snap = loadPlacementSnapshot();
        if (!snap?.rows.length) {
          appendLog(
            'Yerleştirme listesi yok. Planlamada kontur atayıp «Makineye gönder» veya CSV önizle kullanın.',
          );
          return;
        }
        rows = snap.rows;
        csv = snap.csv;
      }

      setCsvRows(rows);
      const { jobId: id } = await uploadJob({
        csv,
        dxf: selectedDxfFile ?? undefined,
        fileName: selectedDxfFile?.name,
      });
      setJobId(id);
      const st = await getJobStatus();
      setPhase(st.phase);
      setIndex(st.index);
      setTotal(st.total);
      appendLog(`Job yüklendi (${rows.length} satır): ${id}`);
      await refreshAux();
    } catch (e) {
      appendLog(`Yükleme hatası: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const sendCmd = (cmd: ControlCommand) => controlRef.current?.send(cmd);

  const phaseBadgeVariant = useMemo(() => {
    if (phase === 'running') return 'default';
    if (phase === 'error') return 'destructive';
    if (phase === 'complete') return 'secondary';
    if (phase === 'ready') return 'outline';
    return 'secondary';
  }, [phase]);

  const [settingsTab, setSettingsTab] = useState('vision');

  return (
    <>
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        {/* === Header — minimal, tek satır === */}
      <header className="shrink-0 z-30 border-b border-border/80 bg-background/95 backdrop-blur-md">
        <div className="px-4 py-2 flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Planlama
          </Link>
          <div className="h-4 w-px bg-border" />
          <Factory className="w-4 h-4 text-primary" />
          <h1 className="text-sm font-semibold">Production</h1>
          <Badge variant={phaseBadgeVariant} className="text-[10px] ml-1">
            {PHASE_LABELS[phase]}
          </Badge>
          {runtimeOnline != null && (
            <Badge
              variant={runtimeOnline ? 'outline' : 'destructive'}
              className="text-[10px]"
            >
              {runtimeOnline ? '● Çevrimiçi' : '○ Kapalı'}
            </Badge>
          )}
          <div className="flex-1" />
          {jobId && (
            <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]">
              {jobId}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() => refreshAux()}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={handleUploadJob}
            disabled={loading || csvRows.length === 0}
          >
            <Upload className="w-3 h-3" />
            {loading ? 'Yükleniyor…' : 'Job yükle'}
          </Button>
        </div>
      </header>

      {/* === Ana alan: 2 kolon === */}
      <div className="flex flex-1 min-h-0">
        {/* SOL: Kamera (büyük) + İş kontrolü (altta) */}
        <main className="flex-1 min-w-0 flex flex-col min-h-0 border-r border-border/60">
          {/* Son snapshot — canlı stream yok; kamera cihaz seçimiyle bağlı kalır */}
          <div className="relative flex-1 min-h-0 bg-black flex items-center justify-center overflow-hidden">
            {aiSnapshotResult?.image_base64 ? (
              <img
                src={aiSnapshotResult.image_base64}
                alt="Son AI snapshot"
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-muted-foreground px-6 text-center gap-2">
                <Camera className="w-8 h-8 opacity-50" />
                <p className="text-xs">Canlı önizleme kapalı</p>
                <p className="text-[11px] text-muted-foreground/80 max-w-sm">
                  Kamera bağlı kalsın; &quot;Kare Al&quot; ile son frame ve taş tespiti burada görünür.
                </p>
              </div>
            )}
            <SnapshotHud
              phase={phase}
              index={index}
              total={total}
              detectedCount={detectedObjects.length}
              cameraReady={cameraReady}
              aiLoading={aiLoading}
              serialDetect={serialDetect}
              detectFps={detectFps}
            />
          </div>

          {/* Kamera alt araç çubuğu: cihaz seç + kare alma */}
          <div className="shrink-0 border-t border-border/60 bg-card/50 px-3 py-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <CameraDeviceSelector
                disabled={loading}
                onSelected={(cfg: CameraSourceConfig) => {
                  setCameraReady(true);
                  appendLog(`Kamera bağlandı: ${cfg.kind} / ${cfg.source_id}`);
                }}
              />
            </div>

            <div className="flex items-center gap-2.5 ml-auto shrink-0">
              <label
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none"
                title="Açıkken cevap geldikçe yeni kare alınır"
              >
                <Switch
                  checked={serialDetect}
                  onCheckedChange={handleSerialToggle}
                  disabled={loading || !runtimeOnline}
                  className="h-5 w-9 data-[state=checked]:bg-purple-600 [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4"
                />
                <span className={serialDetect ? 'text-purple-300 font-medium' : ''}>
                  Seri
                </span>
              </label>
              {serialDetect && detectFps != null && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 px-1.5 tabular-nums border-purple-500/40 text-purple-200"
                >
                  {detectFps.toFixed(1)} FPS
                </Badge>
              )}
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={aiLoading || serialDetect}
                onClick={handleRunAiSnapshot}
                className="h-7 px-3 text-xs bg-purple-600 hover:bg-purple-500 text-white font-semibold shadow-md shadow-purple-900/30 flex items-center gap-1.5"
                title={serialDetect ? 'Seri mod açık — tek kare için kapatın' : 'Tek kare AI tespiti'}
              >
                <span className="inline-block w-2 h-2 rounded-full bg-purple-300 animate-pulse" />
                {serialDetect ? 'Seri…' : aiLoading ? 'Analiz…' : 'Kare Al'}
              </Button>
            </div>
          </div>

          {/* İş kontrolü — büyük, belirgin, alt panel */}
          <div className="shrink-0 border-t border-border/60 bg-card/60 p-3 space-y-3">
            {/* İlerleme — büyük rakam */}
            <ProgressDisplay phase={phase} index={index} total={total} />
            {/* Kontrol butonları — tek satır, belirgin */}
            <JobControlPanel
              phase={phase}
              disabled={loading || !runtimeOnline}
              onStart={() => sendCmd({ cmd: 'start' })}
              onPause={() => sendCmd({ cmd: 'pause' })}
              onResume={() => sendCmd({ cmd: 'resume' })}
              onStop={() => sendCmd({ cmd: 'stop' })}
              onEstop={() => sendCmd({ cmd: 'estop' })}
            />
          </div>
        </main>

        {/* SAĞ: Açılır kapanır paneller (Accordion) */}
        <aside className="w-full lg:w-[min(400px,36vw)] shrink-0 flex flex-col min-h-0 bg-card/30 overflow-y-auto custom-scrollbar">
          <Accordion
            type="multiple"
            defaultValue={['summary', 'placement']}
            className="flex flex-col"
          >
            {/* Planlama özeti */}
            <AccordionItem value="summary" className="border-b border-border/60">
              <AccordionTrigger className="px-3 py-2.5 text-xs hover:no-underline">
                <div className="flex items-center gap-1.5">
                  <Factory className="w-3.5 h-3.5 text-primary" />
                  <span className="font-medium">Planlama Özeti</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 pt-0">
                <PlanningSummaryCard
                  bundle={planningBundle}
                  glueStatus={glueStatus}
                  csvRowCount={csvRows.length}
                  fileName={
                    selectedDxfFile?.name ?? loadPlacementSnapshot()?.fileName
                  }
                />
              </AccordionContent>
            </AccordionItem>

            {/* Yerleştirme tablosu */}
            <AccordionItem value="placement" className="border-b border-border/60">
              <AccordionTrigger className="px-3 py-2.5 text-xs hover:no-underline">
                <div className="flex items-center gap-1.5">
                  <ListOrdered className="w-3.5 h-3.5 text-primary" />
                  <span className="font-medium">Yerleştirme</span>
                  {csvRows.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] ml-1">
                      {csvRows.length} satır
                    </Badge>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-2 pb-2 pt-0 max-h-[400px] overflow-y-auto">
                <PlacementJobTable
                  rows={csvRows}
                  activeIndex={index}
                  phase={phase}
                  compact
                />
              </AccordionContent>
            </AccordionItem>

            {/* Ayarlar — tab içinde */}
            <AccordionItem value="settings" className="border-b border-border/60">
              <AccordionTrigger className="px-3 py-2.5 text-xs hover:no-underline">
                <div className="flex items-center gap-1.5">
                  <Settings2 className="w-3.5 h-3.5 text-primary" />
                  <span className="font-medium">Ayarlar</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 pt-2 space-y-2">
                <Tabs value={settingsTab} onValueChange={setSettingsTab}>
                  <TabsList className="h-8 w-full grid grid-cols-4 bg-muted/50">
                    <TabsTrigger value="vision" className="text-[10px] h-6 px-1">
                      Görüntü
                    </TabsTrigger>
                    <TabsTrigger value="glue" className="text-[10px] h-6 px-1">
                      Yapışkan
                    </TabsTrigger>
                    <TabsTrigger value="cal" className="text-[10px] h-6 px-1">
                      Kalibrasyon
                    </TabsTrigger>
                    <TabsTrigger value="motion" className="text-[10px] h-6 px-1">
                      Motion
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="max-h-[400px] overflow-y-auto custom-scrollbar pt-1">
                  {settingsTab === 'vision' && (
                    <VisionTunePanel
                      objects={detectedObjects}
                      aiSnapshotResult={aiSnapshotResult}
                    />
                  )}
                  {settingsTab === 'glue' && (
                    <GlueSheetStatusPanel
                      status={glueStatus}
                      loading={glueLoading}
                      error={glueError}
                      runtimeOnline={runtimeOnline}
                      activeIndex={index}
                      phase={phase}
                      onReset={async () => {
                        await resetGlueSheet();
                        await refreshAux();
                        appendLog('Glue sheet sıfırlandı');
                      }}
                    />
                  )}
                  {settingsTab === 'cal' && (
                    <CalibrationPanel summary={calSummary} onRefresh={refreshAux} />
                  )}
                  {settingsTab === 'motion' && (
                    <div className="space-y-3">
                      <MotionPortSelector
                        disabled={loading}
                        onSelected={(status) => {
                          appendLog(
                            status.mock_hardware
                              ? 'Motion: mock hardware'
                              : `Motion USB: ${status.serial_port}`,
                          );
                        }}
                      />
                      <MotionConfigPanel
                        disabled={loading}
                        onSaved={() => appendLog('Motion config kaydedildi')}
                      />
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Olay günlüğü */}
            <AccordionItem value="log" className="border-b border-border/60">
              <AccordionTrigger className="px-3 py-2.5 text-xs hover:no-underline">
                <div className="flex items-center gap-1.5">
                  <ScrollText className="w-3.5 h-3.5 text-primary" />
                  <span className="font-medium">Olay Günlüğü</span>
                  <Badge variant="secondary" className="text-[9px] h-4 px-1">
                    {logEntries.length}
                  </Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 pt-0 max-h-[200px] overflow-y-auto">
                <EventLog entries={logEntries} />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </aside>
      </div>
    </div>
    </>
  );
}

/**
 * Snapshot HUD — canlı stream yok; faz + son tespit özeti.
 */
function SnapshotHud({
  phase,
  index,
  total,
  detectedCount,
  cameraReady,
  aiLoading,
  serialDetect,
  detectFps,
}: {
  phase: JobPhase;
  index: number;
  total: number;
  detectedCount: number;
  cameraReady: boolean;
  aiLoading: boolean;
  serialDetect: boolean;
  detectFps: number | null;
}) {
  const phaseColor =
    phase === 'running'
      ? 'bg-green-500/80'
      : phase === 'error'
        ? 'bg-red-500/80'
        : phase === 'paused'
          ? 'bg-amber-500/80'
          : 'bg-black/60';
  return (
    <div className="absolute top-2 right-2 flex flex-col gap-1.5 items-end pointer-events-none">
      <Badge className={`${phaseColor} text-white text-[10px] border-0`}>
        {PHASE_LABELS[phase]}
      </Badge>
      {total > 0 && (
        <Badge className="bg-black/60 text-white text-[10px] border-0 tabular-nums">
          {index} / {total}
        </Badge>
      )}
      <Badge className="bg-black/60 text-white text-[10px] border-0">
        {cameraReady ? 'Kamera bağlı' : 'Kamera seç'}
      </Badge>
      {serialDetect && (
        <Badge className="bg-purple-700/90 text-white text-[10px] border-0">
          Seri{detectFps != null ? ` · ${detectFps.toFixed(1)} FPS` : '…'}
        </Badge>
      )}
      {aiLoading && !serialDetect && (
        <Badge className="bg-purple-700/90 text-white text-[10px] border-0">
          Analiz…
        </Badge>
      )}
      {detectedCount > 0 && (
        <Badge className="bg-black/60 text-white text-[10px] border-0">
          {detectedCount} taş
        </Badge>
      )}
    </div>
  );
}
