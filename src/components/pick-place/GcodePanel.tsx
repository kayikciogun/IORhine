'use client';

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { usePickPlace } from '@/contexts/PickPlaceContext';
import { useDxf } from '@/contexts/DxfContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Cpu, Play, Settings2, ChevronDown, ChevronUp,
  Clock, Hash, Usb, Square,
  CheckCircle2, Radio, Download, Gamepad2, Send, Trash2,
} from 'lucide-react';
import {
  buildPlacementOrders, Mach3PostProcessor,
  GcodeResult,
} from '@/operations/Mach3PostProcessor';
import { WebSerialGCodeSender, type SerialLogEntry } from '@/services/webSerialGcodeSender';
import { clearAppSession } from '@/lib/appSessionStore';

// ─── Bağlantı durumu tipi ────────────────────────────────────────────────────
type ConnState = 'disconnected' | 'connecting' | 'connected';
type SendState = 'idle' | 'sending' | 'done' | 'error';

// ─── Singleton sender (session boyunca aynı bağlantı) ───────────────────────
let _senderInstance: WebSerialGCodeSender | null = null;
function getSender(): WebSerialGCodeSender {
  if (!_senderInstance) _senderInstance = new WebSerialGCodeSender();
  return _senderInstance;
}

export default function GcodePanel() {
  const { stoneTypes, pickPlaceConfig, updatePickPlaceConfig } = usePickPlace();
  const { dxfScene } = useDxf();
  const cfg = pickPlaceConfig;

  // Bağlantı
  const [connState, setConnState]   = useState<ConnState>('disconnected');
  const [sendState, setSendState]   = useState<SendState>('idle');
  const [log, setLog]               = useState<string[]>([]);
  const [progress, setProgress]     = useState<{cur: number; total: number} | null>(null);
  const [gcodeResult, setGcodeResult] = useState<GcodeResult | null>(null);

  // UI
  const [showSettings, setShowSettings] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showJog, setShowJog] = useState(false);
  const [jogStep, setJogStep] = useState(1);
  const [jogGcodeText, setJogGcodeText] = useState('');
  const [cncTerminalLines, setCncTerminalLines] = useState<string[]>([]);
  const logRef = useRef<HTMLPreElement>(null);
  const cncTerminalRef = useRef<HTMLPreElement>(null);

  const totalAssigned = useMemo(
    () => stoneTypes.reduce((a, s) => a + s.contourIds.length, 0),
    [stoneTypes],
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

  useEffect(() => {
    if (!showJog) return;
    setCncTerminalLines([]);
    const sender = getSender();
    const onSerialLog = (entry: SerialLogEntry) => {
      const t = new Date().toLocaleTimeString('tr-TR', { hour12: false });
      const line = `${t} [${entry.type}] ${entry.message}`;
      setCncTerminalLines(prev => [...prev.slice(-400), line]);
      addLog(`[${entry.type}] ${entry.message}`);
    };
    sender.setLogCallback(onSerialLog);
    return () => {
      sender.setLogCallback((entry) => {
        addLog(`[${entry.type}] ${entry.message}`);
      });
    };
  }, [showJog, addLog]);

  useEffect(() => {
    if (!showJog) return;
    const el = cncTerminalRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cncTerminalLines, showJog]);

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
    setShowJog(false);
    addLog('Bağlantı kesildi');
  };

  // ── JOG Komutları ────────────────────────────────────────────────────────
  const sendJogCommand = async (cmd: string) => {
    if (connState !== 'connected') {
      addLog('⚠ Bağlı değil!');
      return;
    }
    try {
      await getSender().sendGCode([cmd]);
      addLog(`JOG: ${cmd}`);
    } catch (e: any) {
      addLog(`✗ JOG hatası: ${e.message}`);
    }
  };

  /** Eksen jog: G90 ile mutlak hedefe gitmek yerine G91 göreli hareket */
  const sendJogLines = async (lines: string[], logLabel?: string) => {
    if (connState !== 'connected') {
      addLog('⚠ Bağlı değil!');
      return;
    }
    try {
      await getSender().sendGCode(lines);
      addLog(logLabel ?? `JOG: ${lines.join(' | ')}`);
    } catch (e: any) {
      addLog(`✗ JOG hatası: ${e.message}`);
    }
  };

  const handleJogMove = (axis: 'X' | 'Y' | 'Z', dir: -1 | 1) => {
    const feed = Math.max(1, cfg.jogFeed);
    const delta = dir * jogStep;
    void sendJogLines(
      ['G91', `G0 ${axis}${delta} F${feed}`, 'G90'],
      `JOG: G91 → ${axis}${delta >= 0 ? '+' : ''}${delta}mm @F${feed} → G90`,
    );
  };

  const handleJogHome = () => {
    sendJogCommand('G28');
  };

  const handleJogSafeZ = () => {
    sendJogCommand(`G0 Z${cfg.safeZ}`);
  };

  const handleJogZeroXY = () => {
    sendJogCommand('G92 X0 Y0 Z0');
    addLog('XYZ sıfırlandı (G92)');
  };

  const sendJogBuffer = async () => {
    if (connState !== 'connected') {
      addLog('⚠ Bağlı değil!');
      return;
    }
    const lines = jogGcodeText
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith(';'));
    if (lines.length === 0) {
      addLog('⚠ Gönderilecek satır yok');
      return;
    }
    try {
      await getSender().sendGCode(lines);
      addLog(`JOG: ${lines.length} satır gönderildi`);
    } catch (e: any) {
      addLog(`✗ JOG gönderim: ${e.message}`);
    }
  };

  // ── Placement G-code üret (sadece önizleme, USB gerektirmez) ────────────
  const handlePreview = () => {
    if (!dxfScene) {
      addLog('✗ DXF sahnesi henüz yüklenmedi!');
      return;
    }
    const { orders, stoneTypeMap } = buildPlacementOrders(dxfScene, stoneTypes, cfg);
    const pp = new Mach3PostProcessor(cfg);
    pp.enableSimulation(0, 0);
    const result = pp.generate(orders, stoneTypeMap);
    pp.disableSimulation();
    setGcodeResult(result);

    addLog(`── ${result.totalStones} taş → ${result.lines} satır G-Code üretildi (ÖNİZLEME) ──`);
    addLog('Mock Z: Strip=0mm, Fabric=0mm — gerçek üretimde Marlin ayarları ve taş Z offset kullanılır.');
    setShowPreview(true);
  };

  // ── Placement G-code üret + gönder ──────────────────────────────────────
  const handleGenerateAndSend = async () => {
    if (!dxfScene) {
      addLog('✗ DXF sahnesi henüz yüklenmedi!');
      return;
    }
    const { orders, stoneTypeMap } = buildPlacementOrders(dxfScene, stoneTypes, cfg);
    const pp = new Mach3PostProcessor(cfg);
    const result = pp.generate(orders, stoneTypeMap);
    setGcodeResult(result);

    addLog(`── ${result.totalStones} taş → ${result.lines} satır G-Code üretildi ──`);
    if (cfg.firmware === 'marlin' && cfg.marlinStripZMm === 0 && cfg.marlinFabricZMm === 0) {
      addLog('⚠ Marlin: Strip Z mm ve Kumaş Z mm 0 — pick/place Z yalnız taş tipi offset; yüzey Z’lerini ayarlardan girin.');
    }

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

  const isBusy = sendState === 'sending';

  // ── JSX ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background/50">
      <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-0.5">

      {/* Başlık */}
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-base font-semibold flex items-center gap-1.5">
          <Cpu className="w-4 h-4 text-primary" />
         Program
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
              {connState === 'connecting' ? 'Bağlanıyor…' : 'Bağlan '}
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
            {gcodeResult && !isBusy && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleDownload}
                title="G-Code'u dosya olarak indir (opsiyonel)">
                <Download className="w-3.5 h-3.5" />
              </Button>
            )}
          </>
        )}
      </div>

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
            <p className="text-xs font-mono">
              X{(cfg.stripOriginX + cfg.cellSize / 2).toFixed(3)}  Y{(cfg.stripOriginY + cfg.cellSize / 2).toFixed(3)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">= Strip Origin + ½·Hücre — pick ızgarasının ilk hücresi.</p>
          </div>

          {/* Strip Origin */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Strip Orijin (mm)</p>
            <div className="grid grid-cols-2 gap-2">
              <Num label="X" cfgKey="stripOriginX" step={0.5} />
              <Num label="Y" cfgKey="stripOriginY" step={0.5} />
            </div>
          </div>

          {/* Yeni taş tipi varsayılan Z */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Taş tipi varsayılan Z (tablo)</p>
            <p className="text-[10px] text-muted-foreground mb-1.5">
              «Yeni Tip» ile taş eklerken pick/place Z alanlarına yazılır; örn. +5 strip yüzeyinden 5 mm yukarı. Her taşta ayrı düzenlenebilir.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Num label="Varsayılan pick Z" cfgKey="defaultStonePickZMm" step={0.5} unit="mm" />
              <Num label="Varsayılan place Z" cfgKey="defaultStonePlaceZMm" step={0.5} unit="mm" />
            </div>
          </div>

          {/* Hızlar */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Hızlar (mm/dk)</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Num label="Rapid" cfgKey="rapidFeed" />
              <Num label="JOG" cfgKey="jogFeed" />
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

          {/* Firmware */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Firmware</p>
            <div className="flex gap-2">
              <button key="marlin" type="button"
                onClick={() => updatePickPlaceConfig({ firmware: 'marlin' })}
                className={`flex-1 py-1 text-xs rounded border transition-colors ${cfg.firmware === 'marlin' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:border-primary/50'}`}>
                Marlin (Ender 3)
              </button>
              <button key="standard" type="button"
                onClick={() => updatePickPlaceConfig({ firmware: 'standard' })}
                className={`flex-1 py-1 text-xs rounded border transition-colors ${cfg.firmware === 'standard' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:border-primary/50'}`}>
                Standart CNC
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {cfg.firmware === 'marlin'
                ? 'G28 → Z güvenli → iş alanı XY → G92 X0 Y0 → M83; bitiş: Z güvenli → G28 X Y → M84'
                : 'G90/G91 (absolute/relative), M30 (program sonu)'}
            </p>
            {cfg.firmware === 'marlin' && (
              <div className="mt-2 space-y-1.5 rounded-md border border-border/70 bg-muted/20 p-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Marlin G92 (iki ayrı anlam)</p>
                <p className="text-[9px] leading-snug text-muted-foreground mb-1">
                  <strong className="font-medium text-foreground">Makine mm:</strong> G28 sonrası nozzle buraya G0 ile gider, ardından G92 X0 Y0.
                  <strong className="font-medium text-foreground ml-1">DXF mm:</strong> O fiziksel noktanın çizimdeki koordinatı; G-code XY = strip/DXF − bu değer. Çizim orijinini tezgâhta G92 yaptıysanız çoğunlukla 0 / 0.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Num label="G92 öncesi makine X" cfgKey="marlinWorkspaceOriginX" step={0.5} />
                  <Num label="G92 öncesi makine Y" cfgKey="marlinWorkspaceOriginY" step={0.5} />
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Num label="Bu noktada DXF X" cfgKey="marlinDxfAtG92X" step={0.5} />
                  <Num label="Bu noktada DXF Y" cfgKey="marlinDxfAtG92Y" step={0.5} />
                </div>
                <p className="text-[9px] leading-snug text-muted-foreground">
                  Eski tek alan mantığı: DXF X/Y’yi makine ile aynı tutun (ör. 107.5). M83, XY orijinini sıfırlamaz; E için döndürmede kısa süre M82 kullanılır.
                </p>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide pt-1 border-t border-border/50">Z (G92 sonrası iş parçası mm)</p>
                <div className="grid grid-cols-2 gap-2">
                  <Num label="Strip Z mm" cfgKey="marlinStripZMm" step={0.05} />
                  <Num label="Kumaş Z mm" cfgKey="marlinFabricZMm" step={0.05} />
                </div>
                <p className="text-[9px] leading-snug text-muted-foreground">
                  Taşı ölçüp G92 sonrası strip ve kumaş yüzeyinde nozzle Z’yi (mm) buraya yazın; taş tipindeki pick/place Z offset eklenir.
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-border pt-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Tarayıcı oturumu</p>
            <p className="text-[9px] text-muted-foreground leading-snug mb-2">
              Taş tipleri, makine ayarları ve DXF bu tarayıcıda saklanır; sayfa yenilendiğinde geri yüklenir. Seri port bağlantısı yenilenmez.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full text-xs"
              onClick={() => {
                if (!window.confirm('Kayıtlı oturum silinsin mi? Sayfa yenilenecek.')) return;
                clearAppSession();
                window.location.reload();
              }}
            >
              Oturumu temizle ve yenile
            </Button>
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

      {/* Başlat + JOG — panel altı (üst alan kayar, bu sabit) */}
      <div className="shrink-0 border-t border-border bg-background/95 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex gap-2">
          <Button
            type="button"
            className="h-14 min-h-14 flex-1 gap-2 rounded-xl border-0 bg-emerald-600 text-base font-semibold text-white shadow-md hover:bg-emerald-700 disabled:pointer-events-none disabled:opacity-45 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            onClick={() => void handleGenerateAndSend()}
            disabled={
              isBusy ||
              totalAssigned === 0 ||
              connState !== 'connected' ||
              !dxfScene
            }
          >
            {sendState === 'sending' ? (
              <>
                <span className="inline-block size-5 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
                Gönderiliyor…
              </>
            ) : (
              <>
                <Play className="size-6 shrink-0" />
                Başlat
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-14 min-h-14 w-[5.5rem] shrink-0 flex-col gap-0.5 rounded-xl border-2 px-2 py-1 text-xs font-semibold"
            onClick={() => setShowJog(true)}
            disabled={connState !== 'connected' || isBusy}
            title="JOG ve G-code"
          >
            <Gamepad2 className="size-5" />
            JOG
          </Button>
          {isBusy && (
            <Button
              type="button"
              variant="destructive"
              className="h-14 min-h-14 w-14 shrink-0 rounded-xl p-0"
              onClick={handleStop}
              title="Durdur"
            >
              <Square className="size-5" />
            </Button>
          )}
        </div>
        {connState !== 'connected' && (
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
            Başlat ve JOG için önce USB ile bağlanın
          </p>
        )}
      </div>

      {/* JOG Modal — geniş, viewer üzerinde tam kullanım */}
      {showJog && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5 bg-black/60"
          role="dialog"
          aria-modal="true"
          aria-labelledby="jog-modal-title"
        >
          <div className="flex h-[min(92vh,880px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl ring-1 ring-black/5 dark:ring-white/10">
            {/* Üst başlık */}
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-muted/30 px-5 py-4 sm:px-6">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Gamepad2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 id="jog-modal-title" className="text-lg font-semibold tracking-tight sm:text-xl">
                    JOG &amp; G-code
                  </h3>
                  <p className="mt-0.5 max-w-xl text-xs text-muted-foreground sm:text-sm">
                    Eksen adımları veya alttaki editöre komut yazın. Çok satır göndermek için <strong>Gönder</strong> kullanın.
                  </p>
                </div>
              </div>
              <Button type="button" variant="ghost" size="sm" className="h-9 shrink-0 px-3"
                onClick={() => setShowJog(false)}>
                Kapat
              </Button>
            </div>

            {/* İçerik: mobilde üst jog, masaüstünde yan yana + altta COM konsolu */}
            <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid gap-5 p-5 sm:gap-6 sm:p-6 lg:grid-cols-[minmax(280px,400px)_1fr] lg:items-start">
                {/* Sol: JOG */}
                <div className="space-y-5 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
                  <div>
                    <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Adım (mm)</Label>
                    <div className="mt-2 grid grid-cols-4 gap-2">
                      {[0.1, 1, 5, 10].map(step => (
                        <button
                          key={step}
                          type="button"
                          onClick={() => setJogStep(step)}
                          className={`rounded-lg border py-3 text-sm font-semibold transition-colors ${jogStep === step ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:border-primary/50 hover:bg-muted/50'}`}
                        >
                          {step}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">JOG hızı (mm/dk)</Label>
                    <div className="mt-2 flex gap-2">
                      <Input
                        type="number"
                        min={1}
                        step={100}
                        className="h-11 flex-1 font-mono text-sm"
                        value={cfg.jogFeed}
                        onChange={e => updatePickPlaceConfig({ jogFeed: Math.max(1, parseFloat(e.target.value) || 1) })}
                      />
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-2">
                      {[6000, 12000, 30000, 60000].map(speed => (
                        <button
                          key={speed}
                          type="button"
                          onClick={() => updatePickPlaceConfig({ jogFeed: speed })}
                          className={`rounded-lg border py-2 text-xs font-semibold transition-colors ${cfg.jogFeed === speed ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-background hover:border-primary/40'}`}
                        >
                          {speed >= 1000 ? `${speed / 1000}k` : speed}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Z</Label>
                    <div className="mt-2 flex gap-3">
                      <Button type="button" variant="outline" className="h-14 flex-1 text-lg font-mono font-semibold"
                        onClick={() => handleJogMove('Z', -1)}>Z-</Button>
                      <Button type="button" variant="outline" className="h-14 flex-1 text-lg font-mono font-semibold"
                        onClick={() => handleJogMove('Z', 1)}>Z+</Button>
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">X / Y</Label>
                    <div className="mt-2 grid max-w-[280px] grid-cols-3 gap-2 sm:max-w-none">
                      <div />
                      <Button type="button" variant="outline" className="h-14 text-lg font-mono font-semibold"
                        onClick={() => handleJogMove('Y', 1)}>Y+</Button>
                      <div />
                      <Button type="button" variant="outline" className="h-14 text-lg font-mono font-semibold"
                        onClick={() => handleJogMove('X', -1)}>X-</Button>
                      <div className="flex items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 text-sm font-medium text-muted-foreground">
                        {jogStep} mm
                      </div>
                      <Button type="button" variant="outline" className="h-14 text-lg font-mono font-semibold"
                        onClick={() => handleJogMove('X', 1)}>X+</Button>
                      <div />
                      <Button type="button" variant="outline" className="h-14 text-lg font-mono font-semibold"
                        onClick={() => handleJogMove('Y', -1)}>Y-</Button>
                      <div />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <Button type="button" variant="secondary" className="h-11 text-xs sm:text-sm"
                      onClick={handleJogHome}>Home G28</Button>
                    <Button type="button" variant="secondary" className="h-11 text-xs sm:text-sm"
                      onClick={handleJogSafeZ}>Safe Z</Button>
                    <Button type="button" variant="secondary" className="h-11 text-xs sm:text-sm"
                      onClick={handleJogZeroXY}>Zero G92</Button>
                  </div>
                </div>

                {/* Sağ: G-code editörü */}
                <div className="flex min-h-[min(52vh,480px)] flex-col rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5 lg:min-h-[min(60vh,560px)]">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor="jog-gcode-editor" className="text-sm font-medium">
                      G-code editörü
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      Ctrl+Enter = gönder · ; ile başlayan satırlar atlanır
                    </span>
                  </div>
                  <textarea
                    id="jog-gcode-editor"
                    value={jogGcodeText}
                    onChange={e => setJogGcodeText(e.target.value)}
                    className="min-h-0 flex-1 resize-none rounded-lg border border-input bg-background px-4 py-3 font-mono text-sm leading-relaxed text-foreground shadow-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-base"
                    placeholder={'Örnek:\nG0 X10 Y20\nG0 Z5\nM106 S255'}
                    spellCheck={false}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        void sendJogBuffer();
                      }
                    }}
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" className="h-11 min-w-[140px] gap-2 px-5" onClick={() => void sendJogBuffer()}>
                      <Send className="h-4 w-4" />
                      Gönder
                    </Button>
                    <Button type="button" variant="outline" className="h-11 gap-2" onClick={() => setJogGcodeText('')}>
                      <Trash2 className="h-4 w-4" />
                      Temizle
                    </Button>
                  </div>
                </div>
              </div>
              </div>

              <div className="shrink-0 border-t border-border bg-muted/20 px-5 py-3 sm:px-6">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Seri konsol (COM)
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setCncTerminalLines([])}
                  >
                    Konsolu temizle
                  </Button>
                </div>
                <pre
                  ref={cncTerminalRef}
                  className="max-h-[200px] min-h-[120px] overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-background p-3 font-mono text-[11px] leading-relaxed text-foreground"
                >
                  {cncTerminalLines.length === 0 ? (
                    <span className="text-muted-foreground">
                      Bağlandıktan sonra CNC'den gelen ve gönderilen satırlar burada görünür.
                    </span>
                  ) : (
                    cncTerminalLines.join('\n')
                  )}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
