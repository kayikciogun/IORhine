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
  getDefaultRuntimeClientConfig,
  getGlueSheetStatus,
  getJobStatus,
  resetGlueSheet,
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
import LiveCameraView from '@/components/production/LiveCameraView';
import CameraDeviceSelector from '@/components/production/CameraDeviceSelector';
import type { CameraSourceConfig } from '@/types/runtime';
import MotionPortSelector from '@/components/production/MotionPortSelector';
import MotionConfigPanel from '@/components/production/MotionConfigPanel';
import PlacementJobTable from '@/components/production/PlacementJobTable';
import GlueSheetStatusPanel from '@/components/production/GlueSheetStatus';
import CalibrationPanel from '@/components/production/CalibrationPanel';
import VisionTunePanel from '@/components/production/VisionTunePanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
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
  Video,
  ListOrdered,
  Settings2,
  ChevronDown,
  Eye,
  EyeOff,
  Usb,
  SlidersHorizontal,
  PlaySquare,
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
  const [cameraOn, setCameraOn] = useState(true);
  const [cameraStreamKey, setCameraStreamKey] = useState('default');
  const [detectedObjects, setDetectedObjects] = useState<DetectedStone[]>([]);
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

  const handleCameraFrame = useCallback((stones: DetectedStone[]) => {
    setDetectedObjects(stones);
  }, []);

  const handleCameraError = useCallback(
    (msg: string) => {
      if (msg.includes('Frame okunamadı')) return;
      appendLog(`Kamera: ${msg}`);
    },
    [appendLog],
  );

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
    <div className="flex h-screen flex-col overflow-hidden bg-gradient-to-b from-background via-background to-muted/30">
      <header className="shrink-0 z-30 border-b border-border/80 bg-background/85 backdrop-blur-md">
        <div className="px-4 py-2.5 flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Planlama
          </Link>
          <div className="flex items-center gap-2 min-w-0">
            <Factory className="w-4 h-4 text-primary shrink-0" />
            <h1 className="text-sm font-semibold leading-tight">Production</h1>
          </div>
          <Badge variant={phaseBadgeVariant} className="text-[10px]">
            {PHASE_LABELS[phase]}
          </Badge>
          {runtimeOnline != null && (
            <Badge variant={runtimeOnline ? 'outline' : 'destructive'} className="text-[10px]">
              {runtimeOnline ? 'Çevrimiçi' : 'Kapalı'}
            </Badge>
          )}
          {jobId && (
            <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]">
              {jobId}
            </span>
          )}
          <div className="flex-1" />
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

      <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
        {/* SOL: Ana içerik alanı */}
        <main className="flex-1 min-w-0 overflow-y-auto p-3 space-y-3 custom-scrollbar">
          {/* Üst satır: Kamera (kompakt) + Makine kontrolü (geniş) */}
          <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-start">
            {/* Kamera — kompakt, sol tarafta */}
            <Card className="overflow-hidden border-border/80 shadow-sm w-full lg:w-[min(300px,100%)] lg:max-w-[300px] shrink-0">
              <CardHeader className="py-2 px-3 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-xs flex items-center gap-1.5">
                  <Video className="w-3.5 h-3.5 text-primary" />
                  Kamera
                </CardTitle>
                <div className="flex items-center gap-1.5">
                  <Switch id="cam" checked={cameraOn} onCheckedChange={setCameraOn} className="scale-90" />
                  <Label htmlFor="cam" className="text-[10px] cursor-pointer">
                    {cameraOn ? 'Açık' : 'Kapalı'}
                  </Label>
                </div>
              </CardHeader>
              <CardContent className="p-2 flex justify-center bg-black/90">
                <LiveCameraView
                  enabled={cameraOn}
                  compact
                  streamKey={cameraStreamKey}
                  onFrame={handleCameraFrame}
                  onCameraError={handleCameraError}
                  className="rounded-md border-0"
                />
              </CardContent>
              <div className="px-3 py-2 border-t border-border/60">
                <CameraDeviceSelector
                  disabled={loading}
                  onSelected={(cfg: CameraSourceConfig) => {
                    setCameraStreamKey(`${cfg.kind}:${cfg.source_id}:${Date.now()}`);
                    appendLog(`Kamera: ${cfg.kind} / ${cfg.source_id}`);
                  }}
                />
              </div>
            </Card>

            {/* Makine kontrolü — geniş, ayrılmış kartlar */}
            <div className="flex-1 min-w-0 grid md:grid-cols-3 gap-3">
              <Card className="border-border/80 shadow-sm">
                <CardHeader className="py-1.5 px-3 flex flex-row items-center gap-1.5 space-y-0">
                  <Usb className="w-3 h-3 text-primary" />
                  <CardTitle className="text-[10px] font-medium">Motion Port</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-2.5">
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
                </CardContent>
              </Card>

              <Card className="border-border/80 shadow-sm">
                <CardHeader className="py-1.5 px-3 flex flex-row items-center gap-1.5 space-y-0">
                  <SlidersHorizontal className="w-3 h-3 text-primary" />
                  <CardTitle className="text-[10px] font-medium">Motion Ayarları</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-2.5">
                  <MotionConfigPanel
                    disabled={loading}
                    onSaved={() => appendLog('Motion config kaydedildi')}
                  />
                </CardContent>
              </Card>

              <Card className="border-border/80 shadow-sm">
                <CardHeader className="py-1.5 px-3 flex flex-row items-center gap-1.5 space-y-0">
                  <PlaySquare className="w-3 h-3 text-primary" />
                  <CardTitle className="text-[10px] font-medium">İş Kontrolü</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-2.5 space-y-2">
                  <JobControlPanel
                    phase={phase}
                    disabled={loading || !runtimeOnline}
                    onStart={() => sendCmd({ cmd: 'start' })}
                    onPause={() => sendCmd({ cmd: 'pause' })}
                    onResume={() => sendCmd({ cmd: 'resume' })}
                    onStop={() => sendCmd({ cmd: 'stop' })}
                    onEstop={() => sendCmd({ cmd: 'estop' })}
                  />
                  <ProgressDisplay phase={phase} index={index} total={total} />
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Alt satır: Olay günlüğü (collapsible) */}
          <Accordion type="single" collapsible defaultValue="log">
            <AccordionItem value="log" className="border-border/80 rounded-lg border shadow-sm bg-card">
              <AccordionTrigger className="px-3 py-2 text-xs hover:no-underline">
                <div className="flex items-center gap-1.5">
                  <ScrollText className="w-3.5 h-3.5 text-primary" />
                  <span className="font-medium">Olay Günlüğü</span>
                  <Badge variant="secondary" className="text-[9px] h-4 px-1">
                    {logEntries.length} kayıt
                  </Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 pt-0">
                <EventLog entries={logEntries} />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </main>

        {/* SAĞ: Yerleştirme tablosu + Ayarlar (Accordion) */}
        <aside className="w-full lg:w-[min(420px,38vw)] shrink-0 border-t lg:border-t-0 lg:border-l border-border bg-card/40 flex flex-col min-h-0 shadow-xl z-10">
          {/* Planning Summary + CSV Tablosu */}
          <section className="flex flex-col min-h-0 flex-[1.15] border-b border-border/80">
            <div className="shrink-0 px-3 py-2.5 border-b border-border/60 bg-muted/20 space-y-2">
              <PlanningSummaryCard
                bundle={planningBundle}
                glueStatus={glueStatus}
                csvRowCount={csvRows.length}
                fileName={
                  selectedDxfFile?.name ?? loadPlacementSnapshot()?.fileName
                }
              />
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-xs flex items-center gap-1.5">
                  <ListOrdered className="w-3.5 h-3.5 text-primary" />
                  Yerleştirme (CSV)
                </CardTitle>
                {csvRows.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {csvRows.length} satır
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0 p-3 pt-2 overflow-hidden flex flex-col">
              <PlacementJobTable
                rows={csvRows}
                activeIndex={index}
                phase={phase}
                compact
              />
            </div>
          </section>

          {/* Ayarlar — Accordion yerine Tabs */}
          <section className="flex flex-col min-h-0 flex-1">
            <div className="shrink-0 px-3 py-2 border-b border-border/60 bg-muted/20">
              <CardTitle className="text-xs flex items-center gap-1.5 mb-2">
                <Settings2 className="w-3.5 h-3.5 text-primary" />
                Ayarlar
              </CardTitle>
              <Tabs value={settingsTab} onValueChange={setSettingsTab}>
                <TabsList className="h-8 w-full grid grid-cols-3 bg-muted/50">
                  <TabsTrigger value="vision" className="text-[10px] h-6 px-1">
                    Görüntü
                  </TabsTrigger>
                  <TabsTrigger value="glue" className="text-[10px] h-6 px-1">
                    Yapışkan
                  </TabsTrigger>
                  <TabsTrigger value="cal" className="text-[10px] h-6 px-1">
                    Kal.
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-3 custom-scrollbar">
              {settingsTab === 'vision' && (
                <VisionTunePanel objects={detectedObjects} />
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
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
