'use client';

import React, { useState, useMemo, useRef, useCallback } from 'react';
import { usePickPlace } from '@/contexts/PickPlaceContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Cpu, Play, Settings2, ChevronDown, ChevronUp,
  Clock, Hash, AlertTriangle, Usb, Square,
  CheckCircle2, Radio, Download
} from 'lucide-react';
import {
  buildPlacementOrders, Mach3PostProcessor,
  generateSetupGcode, firstStoneCoord, GcodeResult,
} from '@/operations/Mach3PostProcessor';
import { WebSerialGCodeSender } from '@/services/webSerialGcodeSender';

// ─── Bağlantı durumu tipi ────────────────────────────────────────────────────
type ConnState = 'disconnected' | 'connecting' | 'connected';
type SendState = 'idle' | 'probing' | 'sending' | 'done' | 'error';

// ─── Singleton sender (session boyunca aynı bağlantı) ───────────────────────
let _senderInstance: WebSerialGCodeSender | null = null;
function getSender(): WebSerialGCodeSender {
  if (!_senderInstance) _senderInstance = new WebSerialGCodeSender();
  return _senderInstance;
}

export default function GcodePanel() {
  const { stoneTypes, pickPlaceConfig, updatePickPlaceConfig } = usePickPlace();
  const cfg = pickPlaceConfig;

  // Bağlantı
  const [connState, setConnState]   = useState<ConnState>('disconnected');
  const [sendState, setSendState]   = useState<SendState>('idle');
  const [probeOk, setProbeOk]       = useState(false);
  const [log, setLog]               = useState<string[]>([]);
  const [progress, setProgress]     = useState<{cur: number; total: number} | null>(null);
  const [gcodeResult, setGcodeResult] = useState<GcodeResult | null>(null);

  // UI
  const [showSettings, setShowSettings] = useState(false);
  const [showPreview, setShowPreview]   = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  const totalAssigned = useMemo(
    () => stoneTypes.reduce((a, s) => a + s.contourIds.length, 0),
    [stoneTypes],
  );
  const firstStone = useMemo(
    () => firstStoneCoord(cfg),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cfg.stripOriginX, cfg.stripOriginY, cfg.cellSize],
  );

  const addLog = useCallback((msg: string) => {
    setLog(prev => {
      const next = [...prev, msg].slice(-120); // max 120 satır
      return next;
    });
    setTimeout(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, 20);
  }, []);

  // ── Bağlan / Bağlantıyı Kes ─────────────────────────────────────────────
  const handleConnect = async () => {
    const sender = getSender();
    if (!WebSerialGCodeSender.isSupported()) {
      addLog('⚠ Web Serial API bu tarayıcıda desteklenmiyor (Chrome/Edge kullanın)');
      return;
    }
    try {
      setConnState('connecting');
      addLog('Port seçimi bekleniyor…');
      const port = await sender.requestPort();
      await sender.connect(port, 115200);
      setConnState('connected');
      addLog('✓ Bağlandı');
    } catch (e: any) {
      setConnState('disconnected');
      addLog(`✗ Bağlantı hatası: ${e.message}`);
    }
  };

  const handleDisconnect = async () => {
    try {
      await getSender().disconnect();
    } catch { /* ignore */ }
    setConnState('disconnected');
    setSendState('idle');
    setProbeOk(false);
    addLog('Bağlantı kesildi');
  };

  // ── Probe G-code gönder ─────────────────────────────────────────────────
  const handleProbe = async () => {
    setSendState('probing');
    setProbeOk(false);
    const sender = getSender();
    sender.setLogCallback((entry) => addLog(`[${entry.type}] ${entry.message}`));
    try {
      const setupGcode = generateSetupGcode(cfg, firstStone.x, firstStone.y);
      const lines = setupGcode.split('\n');
      addLog('── Probe başlatılıyor ──');
      addLog(`İlk taş: X${firstStone.x.toFixed(2)} Y${firstStone.y.toFixed(2)}`);

      await sender.sendGCode(lines);

      setProbeOk(true);
      setSendState('idle');
      addLog('✓ Probe tamamlandı → #500, #501 controller hafızasında');
    } catch (e: any) {
      setSendState('error');
      addLog(`✗ Probe hatası: ${e.message}`);
    }
  };

  // ── Placement G-code üret (sadece önizleme, probe/USB gerektirmez) ──────
  const handlePreview = () => {
    if (typeof window === 'undefined' || !(window as any).dxfScene) {
      addLog('✗ DXF sahnesi henüz yüklenmedi!');
      return;
    }
    const scene = (window as any).dxfScene;
    const { orders, stoneTypeMap } = buildPlacementOrders(scene, stoneTypes, cfg);
    const pp = new Mach3PostProcessor(cfg);
    // Mock Z değerleri: stripZ=0, fabricZ=0
    // Gerçek makinede probe bu değerleri #500 ve #501'e kaydeder
    pp.enableSimulation(0, 0);
    const result = pp.generate(orders, stoneTypeMap);
    pp.disableSimulation();
    setGcodeResult(result);

    addLog(`── ${result.totalStones} taş → ${result.lines} satır G-Code üretildi (ÖNİZLEME) ──`);
    addLog('Mock Z: Strip=0mm, Fabric=0mm — probe sonrası gerçek değerlerle geçerli.');
    setShowPreview(true);
  };

  // ── Placement G-code üret + gönder ──────────────────────────────────────
  const handleGenerateAndSend = async () => {
    if (typeof window === 'undefined' || !(window as any).dxfScene) {
      addLog('✗ DXF sahnesi henüz yüklenmedi!');
      return;
    }
    const scene = (window as any).dxfScene;
    const { orders, stoneTypeMap } = buildPlacementOrders(scene, stoneTypes, cfg);
    const pp = new Mach3PostProcessor(cfg);
    const result = pp.generate(orders, stoneTypeMap);
    setGcodeResult(result);

    addLog(`── ${result.totalStones} taş → ${result.lines} satır G-Code üretildi ──`);

    setSendState('sending');
    setProgress({ cur: 0, total: result.lines });

    const sender = getSender();
    // Progress callback
    sender.setStatusCallback((status) => {
      setProgress({ cur: status.current_line, total: status.total_lines });
    });
    // Log callback
    sender.setLogCallback((entry) => {
      addLog(`[${entry.type}] ${entry.message}`);
    });

    try {
      const lines = result.gcode.split('\n');
      await sender.sendGCode(lines);
      setSendState('done');
      setProgress(null);
      addLog(`✓ Gönderim tamamlandı (${result.totalStones} taş)`);
    } catch (e: any) {
      setSendState('error');
      addLog(`✗ Gönderim hatası: ${e.message}`);
    }
  };

  const handleStop = () => {
    getSender().stopSending();
    setSendState('idle');
    setProgress(null);
    addLog('⏹ Durduruldu');
  };

  // Yedek olarak G-code dosyası indir
  const handleDownload = () => {
    if (!gcodeResult) return;
    const blob = new Blob([gcodeResult.gcode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `pickplace_${Date.now()}.nc`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  // ── Input helper ─────────────────────────────────────────────────────────
  const Num = ({ label, cfgKey, step = 1, unit }: {
    label: string; cfgKey: keyof typeof cfg; step?: number; unit?: string;
  }) => (
    <div>
      <Label className="text-[10px] text-muted-foreground">
        {label}{unit && <span className="opacity-60"> ({unit})</span>}
      </Label>
      <Input type="number" step={step}
        className="h-6 text-xs mt-0.5 px-1"
        value={cfg[cfgKey] as number}
        onChange={e => updatePickPlaceConfig({ [cfgKey]: parseFloat(e.target.value) || 0 })}
      />
    </div>
  );

  const isBusy = sendState === 'probing' || sendState === 'sending';

  // ── JSX ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col bg-background/50">

      {/* Başlık */}
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-base font-semibold flex items-center gap-1.5">
          <Cpu className="w-4 h-4 text-primary" />
          G-Code / Gönderim
        </h2>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
          onClick={() => setShowSettings(s => !s)}>
          <Settings2 className="w-3.5 h-3.5 mr-1" />
          Ayarlar
          {showSettings ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
        </Button>
      </div>

      {/* Bağlantı + Akış Butonları */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {connState !== 'connected' ? (
          <>
            <Button size="sm" variant="outline" className="h-7 px-3 text-xs"
              onClick={handleConnect} disabled={connState === 'connecting'}>
              <Usb className="w-3.5 h-3.5 mr-1" />
              {connState === 'connecting' ? 'Bağlanıyor…' : 'Bağlan (USB)'}
            </Button>
            <Button size="sm" variant="secondary" className="h-7 px-3 text-xs"
              onClick={handlePreview} disabled={totalAssigned === 0}>
              <Cpu className="w-3.5 h-3.5 mr-1" />
              Önizle
            </Button>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1 text-xs text-green-500 font-medium px-1">
              <Radio className="w-3 h-3 animate-pulse" /> Bağlı
            </span>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-muted-foreground"
              onClick={handleDisconnect} disabled={isBusy}>
              Kes
            </Button>
            <Button size="sm" variant="secondary" className="h-7 px-3 text-xs"
              onClick={handleProbe} disabled={isBusy}>
              {sendState === 'probing'
                ? <><span className="animate-spin mr-1">⟳</span>Probe…</>
                : <><Cpu className="w-3 h-3 mr-1" />Probe</>}
            </Button>
            <Button size="sm" className="h-7 px-3 text-xs"
              onClick={handleGenerateAndSend}
              disabled={isBusy || totalAssigned === 0 || !probeOk}>
              {sendState === 'sending'
                ? <><span className="animate-spin mr-1">⟳</span>Gönderiliyor…</>
                : <><Play className="w-3 h-3 mr-1" />Üret & Gönder</>}
            </Button>
            {isBusy && (
              <Button size="sm" variant="destructive" className="h-7 px-2 text-xs"
                onClick={handleStop}>
                <Square className="w-3 h-3" />
              </Button>
            )}
            {gcodeResult && !isBusy && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleDownload}
                title="G-Code'u dosya olarak indir (opsiyonel)">
                <Download className="w-3.5 h-3.5" />
              </Button>
            )}
          </>
        )}
      </div>

      {/* Probe uyarısı */}
      {connState === 'connected' && !probeOk && (
        <div className="flex items-start gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 mb-2 bg-amber-500/10 px-2 py-1.5 rounded-md border border-amber-500/20">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
          <span>Önce <strong>Probe</strong> çalıştırın → controller #500 (strip Z) ve #501 (kumaş Z) öğrenir, ardından gönderim aktif olur.</span>
        </div>
      )}
      {probeOk && (
        <div className="flex items-center gap-1.5 text-[10px] text-green-600 dark:text-green-400 mb-2 bg-green-500/10 px-2 py-1.5 rounded-md border border-green-500/20">
          <CheckCircle2 className="w-3 h-3" />
          Probe tamamlandı — #500 (strip Z) ve #501 (kumaş Z) hazır.
        </div>
      )}

      {/* İlerleme */}
      {progress && (
        <div className="mb-2">
          <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
            <span>Gönderiliyor…</span>
            <span>{progress.cur} / {progress.total}</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary transition-all"
              style={{ width: `${progress.total ? (progress.cur / progress.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {/* İstatistik */}
      {gcodeResult && (
        <div className="flex gap-3 text-xs text-muted-foreground mb-2 bg-muted/20 px-2 py-1 rounded-md border border-border">
          <span className="flex items-center gap-1"><Hash className="w-3 h-3" />{gcodeResult.totalStones} taş</span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            ~{Math.round(gcodeResult.estimatedSeconds / 60)}dk
          </span>
          <span>{gcodeResult.lines} satır</span>
          {sendState === 'done' && <span className="text-green-500 font-medium flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Tamamlandı</span>}
        </div>
      )}

      {/* Makine Ayarları */}
      {showSettings && (
        <div className="mb-3 bg-muted/20 p-3 rounded-lg border border-border space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">

          {/* İlk taş (hesaplanan) */}
          <div className="bg-primary/5 border border-primary/20 rounded-md px-2 py-1.5">
            <p className="text-[10px] font-semibold text-primary mb-0.5">İlk Pick Merkezi (strip)</p>
            <p className="text-xs font-mono">X{firstStone.x.toFixed(3)}  Y{firstStone.y.toFixed(3)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">= Strip Origin + ½·CellSize — Probe bu noktayı referans alır.</p>
          </div>

          {/* Strip Origin */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Strip Orijin (mm)</p>
            <div className="grid grid-cols-2 gap-2">
              <Num label="X" cfgKey="stripOriginX" step={0.5} />
              <Num label="Y" cfgKey="stripOriginY" step={0.5} />
            </div>
          </div>

          {/* Probe ↔ Nozzle geometrisi */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Probe → Nozzle Mesafesi</p>
            <p className="text-[10px] text-muted-foreground mb-1.5">
              Sensörün nozzle ucuna göre fiziksel konumu.
              Pick Z = <code className="text-[10px]">[#500 + Z + pickZOffset]</code>
            </p>
            <div className="grid grid-cols-3 gap-2">
              <Num label="XY X" cfgKey="probeOffsetX" step={0.5} unit="mm" />
              <Num label="XY Y" cfgKey="probeOffsetY" step={0.5} unit="mm" />
              <Num label="Z yükseklik" cfgKey="probeNozzleOffsetZ" step={0.1} unit="mm" />
            </div>
          </div>

          {/* Hızlar */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Hızlar (mm/dk)</p>
            <div className="grid grid-cols-3 gap-2">
              <Num label="Rapid" cfgKey="rapidFeed" />
              <Num label="Pick" cfgKey="pickFeed" />
              <Num label="Place" cfgKey="placeFeed" />
            </div>
          </div>

          {/* Z */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Z / Döndürme</p>
            <div className="grid grid-cols-2 gap-2">
              <Num label="Safe Z" cfgKey="safeZ" step={0.5} />
              <Num label="Rot. Feed" cfgKey="rotationFeed" />
            </div>
          </div>

          {/* Vakum */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Vakum M-Kodları</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px]">Aç</Label>
                <Input type="text" className="h-6 text-xs mt-0.5 px-1"
                  value={cfg.vacuumOnCode}
                  onChange={e => updatePickPlaceConfig({ vacuumOnCode: e.target.value })} />
              </div>
              <div>
                <Label className="text-[10px]">Kapat</Label>
                <Input type="text" className="h-6 text-xs mt-0.5 px-1"
                  value={cfg.vacuumOffCode}
                  onChange={e => updatePickPlaceConfig({ vacuumOffCode: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-1.5">
              <Num label="G4 Bekleme Aç (sn)" cfgKey="vacuumOnDwell" step={0.1} />
              <Num label="G4 Bekleme Kapat (sn)" cfgKey="vacuumOffDwell" step={0.1} />
            </div>
          </div>

          {/* Probe ayarları */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Probe Noktaları</p>
            </div>
            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-2">
                <Num label="Probe Hız" cfgKey="probeFeed" />
                <Num label="Geri Çekilme" cfgKey="probeRetract" step={0.5} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Num label="Kumaş X" cfgKey="fabricProbeX" step={0.5} />
                <Num label="Kumaş Y" cfgKey="fabricProbeY" step={0.5} />
              </div>
            </div>
          </div>

          {/* Eksen */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Döndürme Ekseni</p>
            <div className="flex gap-2">
              {(['E', 'A'] as const).map(ax => (
                <button key={ax} type="button"
                  onClick={() => updatePickPlaceConfig({ rotationAxis: ax })}
                  className={`flex-1 py-1 text-xs rounded border transition-colors ${cfg.rotationAxis === ax ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:border-primary/50'}`}>
                  {ax} Ekseni
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Canlı log */}
      {log.length > 0 && (
        <pre ref={logRef}
          className="text-[10px] leading-[1.5] font-mono bg-muted/30 border border-border rounded-md p-2 overflow-auto max-h-[200px] custom-scrollbar whitespace-pre">
          {log.join('\n')}
        </pre>
      )}

      {/* G-code önizleme (collapsible) */}
      {gcodeResult && (
        <div className="mt-1">
          <button className="text-xs text-muted-foreground flex items-center gap-1 w-full mb-1"
            onClick={() => setShowPreview(s => !s)}>
            <ChevronDown className={`w-3 h-3 transition-transform ${showPreview ? 'rotate-180' : ''}`} />
            G-Code ({gcodeResult.lines} satır)
          </button>
          {showPreview && (
            <pre className="text-[10px] leading-[1.4] font-mono bg-muted/30 border border-border rounded-md p-2 overflow-auto max-h-[240px] custom-scrollbar whitespace-pre">
              {gcodeResult.gcode}
            </pre>
          )}
        </div>
      )}

      {totalAssigned === 0 && connState !== 'connected' && (
        <div className="text-center text-xs text-muted-foreground py-3">
          Bağlan ve taş tiplerini atayın, ardından yerleştirme yapılabilir.
        </div>
      )}
    </div>
  );
}
