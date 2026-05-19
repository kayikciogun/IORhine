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
import { loadPlanningBundle } from '@/lib/planningPipeline';
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
  ArrowLeft,
  Upload,
  RefreshCw,
  Factory,
  Video,
  ListOrdered,
  Settings2,
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
  const [planningBundle, setPlanningBundle] = useState(
    () => (typeof window !== 'undefined' ? loadPlanningBundle() : null),
  );
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
    setGlueLoading(true);
    try {
      const base = getDefaultRuntimeClientConfig().restBaseUrl;
      const health = await fetch(`${base}/health`);
      const online = health.ok;
      setRuntimeOnline(online);
      if (!online) {
        setGlueError('Runtime yanıt vermiyor');
        setGlueStatus(null);
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
      setGlueStatus(null);
      setGlueError('Runtime bağlantısı kurulamadı');
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
    const t = setInterval(() => void refreshAux(), 8000);
    return () => clearInterval(t);
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
          setGlueStatus((prev) =>
            prev
              ? {
                  ...prev,
                  cursor: Math.max(prev.cursor, ev.data.cell),
                  remaining: Math.max(0, prev.total - Math.max(prev.cursor, ev.data.cell)),
                }
              : prev,
          );
        }
        if (ev.evt === 'job_complete') setPhase('complete');
      },
      onOpen: () => {
        setRuntimeOnline(true);
        appendLog('Kontrol kanalı bağlandı');
      },
      onClose: () => appendLog('Kontrol kanalı kapandı'),
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
        <main className="flex-1 min-w-0 overflow-y-auto p-3 space-y-3 custom-scrollbar">
          <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-start">
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

            <div className="flex-1 min-w-0 grid md:grid-cols-2 gap-3">
            <Card className="border-border/80 shadow-sm">
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs">Makine kontrolü</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 space-y-3">
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

            <Card className="border-border/80 shadow-sm flex flex-col min-h-[180px]">
              <CardHeader className="py-2 px-3 shrink-0">
                <CardTitle className="text-xs">Olay günlüğü</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 flex-1 min-h-0">
                <EventLog entries={logEntries} />
              </CardContent>
            </Card>
            </div>
          </div>
        </main>

        <aside className="w-full lg:w-[min(420px,38vw)] shrink-0 border-t lg:border-t-0 lg:border-l border-border bg-card/40 flex flex-col min-h-0 lg:max-h-none max-h-[48vh] shadow-2xl z-10">
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
              <CardDescription className="text-[10px] mt-0.5">
                Aktif satır vurgulanır
              </CardDescription>
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
