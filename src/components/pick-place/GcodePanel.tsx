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
  CheckCircle2, Radio, Download, Gamepad2, Send, Trash2, OctagonAlert,
} from 'lucide-react';
import {
  buildPlacementOrders, Mach3PostProcessor,
  GcodeResult,
} from '@/operations/Mach3PostProcessor';
import type { PickPlaceConfig } from '@/types/pickplace';
import { WebSerialGCodeSender, type SerialLogEntry } from '@/services/webSerialGcodeSender';
import { clearAppSession } from '@/lib/appSessionStore';

// ─── Num: ayar paneli için sayısal input (bileşen dışında — kararlı kimlik) ──
function Num({ label, cfgKey, step = 1, unit }: {
  label: string;
  cfgKey: keyof PickPlaceConfig;
  step?: number;
  unit?: string;
}) {
  const { pickPlaceConfig: cfg, updatePickPlaceConfig } = usePickPlace();
  const rawVal = cfg[cfgKey];
  const displayVal =
    typeof rawVal === 'number' && Number.isFinite(rawVal)
      ? rawVal
      : typeof rawVal === 'string'
        ? (() => {
            const p = parseFloat(String(rawVal).replace(',', '.'));
            return Number.isFinite(p) ? p : '';
          })()
        : '';
  return (
    <div>
      <Label className="text-[10px] text-muted-foreground">
        {label}{unit && <span className="opacity-60"> ({unit})</span>}
      </Label>
      <Input
        type="number"
        step={step}
        className="h-6 text-xs mt-0.5 px-1"
        value={displayVal === '' ? '' : displayVal}
        onChange={e => {
          const parsed = parseFloat(e.target.value);
          if (!Number.isNaN(parsed)) {
            updatePickPlaceConfig({ [cfgKey]: parsed });
          }
        }}
      />
    </div>
  );
}

/** JOG input: virgül/nokta ondalık, boş veya geçersiz → null */
function parseJogNumber(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

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
  /** JOG: göreli hareket adımı (mm) — metin input */
  const [jogMmText, setJogMmText] = useState('1');
  /** JOG: F hızı (mm/dk) — metin input; geçerliyse pickPlaceConfig ile senkron */
  const [jogFeedText, setJogFeedText] = useState('');
  /** JOG: kafa mutlak hedef açı (derece) — E/A */
  const [jogRotateDeg, setJogRotateDeg] = useState('0');
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

  /** JOG açılırken F alanını ayarlardaki jogFeed ile doldur (yazarken cfg ile döngüye girmemek için sadece showJog) */
  useEffect(() => {
    if (showJog) setJogFeedText(String(cfg.jogFeed));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız modal açılışında senkron
  }, [showJog]);

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
    const step = parseJogNumber(jogMmText);
    if (step === null || step <= 0) {
      addLog('⚠ Adım (mm): pozitif bir sayı girin');
      return;
    }
    const feedRaw = parseJogNumber(jogFeedText);
    if (feedRaw === null || feedRaw < 1) {
      addLog('⚠ F (mm/dk): en az 1 girin');
      return;
    }
    const feed = Math.max(1, Math.round(feedRaw));
    const delta = dir * step;
    void sendJogLines(
      ['G91', `G1 ${axis}${delta} F${feed}`, 'G90'],
      `JOG: G91 → G1 ${axis}${delta >= 0 ? '+' : ''}${delta}mm @F${feed} → G90`,
    );
  };

  /** Dönüş ekseni: mutlak hedef. JOG F = F input ile aynı. Marlin+E: M302, M82, G1 E, M83 */
  const handleJogGoToRotationAngle = () => {
    const ax = cfg.rotationAxis;
    const feedRaw = parseJogNumber(jogFeedText);
    if (feedRaw === null || feedRaw < 1) {
      addLog('⚠ F (mm/dk): en az 1 girin');
      return;
    }
    const feed = Math.max(1, Math.round(feedRaw));
    const raw = parseFloat(String(jogRotateDeg).trim().replace(',', '.'));
    if (!Number.isFinite(raw)) {
      addLog('⚠ Geçerli bir derece girin');
      return;
    }
    let angleStr = raw.toFixed(2);
    if (angleStr.includes('.')) angleStr = angleStr.replace(/\.?0+$/, '');
    const coldOk = cfg.firmware === 'marlin' && ax === 'E';
    const lines = coldOk
      ? ['M302 P1', 'M82', `G1 ${ax}${angleStr} F${feed}`, 'M83']
      : ['G90', `G1 ${ax}${angleStr} F${feed}`];
    const logExtra = coldOk ? 'M302 P1 → M82 → ' : 'G90 → ';
    void sendJogLines(
      lines,
      `JOG: ${logExtra}${ax}${angleStr}° @F${feed}${coldOk ? ' → M83' : ''}`,
    );
  };

  const handleJogSafeZ = () => {
    sendJogCommand(`G1 Z${cfg.safeZ} F${Math.max(1, Math.round(cfg.jogFeed))}`);
  };

  const handleJogZeroZ = () => {
    sendJogCommand('G92 Z0');
    addLog('Z tablo sıfırı (G92 Z0)');
  };

  /**
   * JOG / gönderim kuyruğunu keser. Marlin: yalnızca M410 (plan iptali).
   * M112 gönderilmez — Marlin kill() durumuna girer ve M999 / güç döngüsü gerekir.
   */
  const handleJogEmergencyStop = async () => {
    if (connState !== 'connected') {
      addLog('⚠ Bağlı değil!');
      return;
    }
    try {
      await getSender().stopSending();
      setSendState('idle');
      setProgress(null);
      const sender = getSender();
      if (cfg.firmware === 'marlin') {
        await sender.sendGCode(['M410']);
        addLog('Durdur: gönderici kesildi; Marlin M410 (plan temizle). Sonraki JOG/G-code normal çalışmalı.');
      } else {
        addLog('Durdur: gönderici kesildi (standart mod — ek firmware komutu yok).');
      }
    } catch (e: any) {
      addLog(`✗ Durdur: ${e.message}`);
    }
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
    const orders = buildPlacementOrders(dxfScene, stoneTypes, cfg);
    const pp = new Mach3PostProcessor(cfg);
    pp.enableSimulation(0, 0);
    const result = pp.generate(orders, stoneTypes);
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
    const orders = buildPlacementOrders(dxfScene, stoneTypes, cfg);
    const pp = new Mach3PostProcessor(cfg);
    const result = pp.generate(orders, stoneTypes);
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
                ? `G21 G90; M83 (+ isteğe M302). XY doğrudan DXF/strip mm — orijin program öncesi tezgahta (G28/G92/jog) siz; son: güvenli Z${cfg.releaseMotorsAtProgramEnd ? ' + M84' : ''}.`
                : 'G21 G90 G17; program sonu güvenli Z + M30. XY çizim mm (WCS).'}
            </p>
            {cfg.firmware === 'marlin' && (
              <div className="mt-2 space-y-1.5 rounded-md border border-border/70 bg-muted/20 p-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Marlin — XY / Z</p>
                <p className="text-[9px] leading-snug text-muted-foreground mb-1">
                  Üretilen G-code M206 veya sabit 107×107 köşesini orijin saymaz; çizim mm’leri mevcut WCS’e göre çalışır. İşe başlamadan nozzle’u strip/DXF ile hizalayın.
                </p>
                <label className="flex items-start gap-2 cursor-pointer text-[10px] leading-snug pb-1 border-b border-border/50">
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded border-border"
                    checked={cfg.releaseMotorsAtProgramEnd}
                    onChange={e => updatePickPlaceConfig({ releaseMotorsAtProgramEnd: e.target.checked })}
                  />
                  <span>
                    <span className="font-medium text-foreground">Program sonu M84 (motor kes)</span>
                    <span className="text-muted-foreground"> Varsayılan kapalı; uzun duruşta elle M84 kullanın.</span>
                  </span>
                </label>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide pt-1">Z (iş parçası mm)</p>
                <p className="text-[9px] leading-snug text-muted-foreground mb-1">
                  Strip / kumaş yüzeyi Z; taş tipi pick/place offset eklenir.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Num label="Strip Z mm" cfgKey="marlinStripZMm" step={0.05} />
                  <Num label="Kumaş Z mm" cfgKey="marlinFabricZMm" step={0.05} />
                </div>
                <p className="text-[9px] leading-snug text-muted-foreground">
                  Taş tipindeki pick/place Z offset bu değerlere eklenir.
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

      {/* JOG Modal */}
      {showJog && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-3 bg-black/65 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="jog-modal-title"
          onKeyDown={e => e.key === 'Escape' && setShowJog(false)}
        >
          <div className="flex h-[min(90vh,760px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">

            {/* Başlık */}
            <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
                  <Gamepad2 className="h-3.5 w-3.5" />
                </div>
                <div>
                  <h3 id="jog-modal-title" className="text-sm font-semibold leading-none">JOG &amp; G-code</h3>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">Ctrl+Enter ile gönder · ; ile yorum satırı</p>
                </div>
              </div>
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2.5 text-xs"
                onClick={() => setShowJog(false)}>
                Kapat
              </Button>
            </div>

            {/* İçerik: sol kontroller | sağ editör+konsol */}
            <div className="min-h-0 flex-1 flex overflow-hidden">

              {/* Sol: hareket kontrolleri + acil durdurma */}
              <div className="w-[300px] shrink-0 flex flex-col border-r border-border overflow-hidden bg-card/30">
                <div className="min-h-0 flex-1 overflow-y-auto p-4 flex flex-col gap-3.5 custom-scrollbar">

                {/* Adım + F — elle girilen değerler */}
                <div className="space-y-2.5">
                  <div>
                    <Label htmlFor="jog-mm" className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Adım (mm)
                    </Label>
                    <Input
                      id="jog-mm"
                      type="text"
                      inputMode="decimal"
                      className="mt-1 h-9 font-mono text-sm"
                      value={jogMmText}
                      onChange={e => setJogMmText(e.target.value)}
                      placeholder="örn. 1 veya 0,1"
                      spellCheck={false}
                    />
                  </div>
                  <div>
                    <Label htmlFor="jog-f" className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      F (mm/dk)
                    </Label>
                    <Input
                      id="jog-f"
                      type="text"
                      inputMode="numeric"
                      className="mt-1 h-9 font-mono text-sm"
                      value={jogFeedText}
                      onChange={e => setJogFeedText(e.target.value)}
                      onBlur={() => {
                        const v = parseJogNumber(jogFeedText);
                        if (v !== null && v >= 1) {
                          updatePickPlaceConfig({ jogFeed: Math.round(v) });
                        }
                      }}
                      placeholder="örn. 3000"
                      spellCheck={false}
                    />
                  </div>
                </div>

                <div className="h-px bg-border" />

                {/* XY pad + Z yan yana */}
                <div className="flex items-center gap-2">
                  {/* XY D-pad */}
                  <div className="grid grid-cols-3 gap-1.5 flex-1">
                    <div />
                    <Button type="button" variant="outline"
                      className="h-12 text-sm font-mono font-bold active:scale-95 transition-transform"
                      onClick={() => handleJogMove('Y', 1)}>Y+</Button>
                    <div />
                    <Button type="button" variant="outline"
                      className="h-12 text-sm font-mono font-bold active:scale-95 transition-transform"
                      onClick={() => handleJogMove('X', -1)}>X−</Button>
                    <div className="flex items-center justify-center rounded-md border border-dashed border-border bg-muted/30 text-[9px] font-medium text-muted-foreground text-center leading-tight px-0.5">
                      XY<br/>Δmm
                    </div>
                    <Button type="button" variant="outline"
                      className="h-12 text-sm font-mono font-bold active:scale-95 transition-transform"
                      onClick={() => handleJogMove('X', 1)}>X+</Button>
                    <div />
                    <Button type="button" variant="outline"
                      className="h-12 text-sm font-mono font-bold active:scale-95 transition-transform"
                      onClick={() => handleJogMove('Y', -1)}>Y−</Button>
                    <div />
                  </div>

                  {/* Z ekseni */}
                  <div className="flex flex-col gap-1.5">
                    <Button type="button" variant="outline"
                      className="h-12 w-[52px] text-sm font-mono font-bold active:scale-95 transition-transform"
                      onClick={() => handleJogMove('Z', 1)}>Z+</Button>
                    <div className="flex items-center justify-center text-[9px] font-semibold text-muted-foreground h-4">Z</div>
                    <Button type="button" variant="outline"
                      className="h-12 w-[52px] text-sm font-mono font-bold active:scale-95 transition-transform"
                      onClick={() => handleJogMove('Z', -1)}>Z−</Button>
                  </div>
                </div>

                <div className="h-px bg-border" />

                {/* Rotasyon */}
                <div>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {cfg.rotationAxis} ekseni — mutlak °
                  </span>
                  <div className="mt-1.5 flex gap-1.5">
                    <Input
                      id="jog-rotate-deg"
                      type="text"
                      inputMode="decimal"
                      className="h-9 flex-1 font-mono text-sm"
                      value={jogRotateDeg}
                      onChange={e => setJogRotateDeg(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); void handleJogGoToRotationAngle(); }
                      }}
                      placeholder="örn. 45"
                      aria-label={`Hedef açı ${cfg.rotationAxis}`}
                    />
                    <Button type="button" className="h-9 px-4 font-semibold shrink-0"
                      onClick={() => void handleJogGoToRotationAngle()}>
                      Git
                    </Button>
                  </div>
                </div>

                <div className="h-px bg-border" />

                {/* Yardımcı komutlar */}
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" className="flex-1 h-9 text-xs font-semibold"
                    title={`G1 Z${cfg.safeZ} (F=jog) — güvenli yüksekliğe çık`}
                    onClick={handleJogSafeZ}>
                    Safe Z
                  </Button>
                  <Button type="button" variant="default" className="flex-1 h-9 text-xs font-semibold"
                    title="G92 Z0 — mevcut Z konumunu sıfır olarak tanımla"
                    onClick={handleJogZeroZ}>
                    G92 Z0
                  </Button>
                </div>

                </div>

                <div className="shrink-0 border-t border-destructive/30 bg-destructive/[0.08] p-3 dark:bg-destructive/10">
                  <Button
                    type="button"
                    variant="destructive"
                    className="h-12 w-full gap-2 rounded-lg text-sm font-bold uppercase tracking-wide shadow-md active:scale-[0.98] transition-transform"
                    onClick={() => void handleJogEmergencyStop()}
                    title="PC kuyruğunu kes + Marlin M410. M112 yok (kill/M999 gerekmez)."
                  >
                    <OctagonAlert className="h-4 w-4 shrink-0" aria-hidden />
                    Durdur
                  </Button>
                  <p className="mt-1.5 text-center text-[9px] leading-snug text-muted-foreground">
                    {cfg.firmware === 'marlin'
                      ? 'M410 planı temizler; yazıcı çalışır kalır. Gerçek acil durum: tezgâh E-stop veya konsoldan M112 (sonrası M999).'
                      : 'Yalnızca host kuyruğu kesilir; tam durdurma için kontrolcü / fiziksel E-stop kullanın.'}
                  </p>
                </div>
              </div>

              {/* Sağ: G-code editörü + seri konsol */}
              <div className="min-h-0 flex-1 flex flex-col">

                {/* G-code editörü */}
                <div className="flex min-h-0 flex-1 flex-col p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <Label htmlFor="jog-gcode-editor" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      G-code editörü
                    </Label>
                    <button type="button"
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setJogGcodeText('')}>
                      <Trash2 className="h-2.5 w-2.5" /> Temizle
                    </button>
                  </div>
                  <textarea
                    id="jog-gcode-editor"
                    value={jogGcodeText}
                    onChange={e => setJogGcodeText(e.target.value)}
                    className="min-h-0 flex-1 resize-none rounded-lg border border-input bg-muted/20 px-3 py-2.5 font-mono text-sm leading-relaxed text-foreground shadow-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder={'G1 X10 Y20 F3000\nG1 Z5 F3000\nM106 S255\n; yorum satırı atlanır'}
                    spellCheck={false}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        void sendJogBuffer();
                      }
                    }}
                  />
                  <div className="mt-2">
                    <Button type="button" className="h-9 w-full gap-2 font-semibold"
                      onClick={() => void sendJogBuffer()}>
                      <Send className="h-3.5 w-3.5" />
                      Gönder
                    </Button>
                  </div>
                </div>

                {/* Seri konsol */}
                <div className="shrink-0 border-t border-border bg-muted/20 px-4 py-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Seri konsol</span>
                    <button type="button"
                      className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setCncTerminalLines([])}>
                      temizle
                    </button>
                  </div>
                  <pre ref={cncTerminalRef}
                    className="max-h-[160px] min-h-[72px] overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground custom-scrollbar">
                    {cncTerminalLines.length === 0
                      ? <span className="text-muted-foreground">CNC çıktısı burada görünür…</span>
                      : cncTerminalLines.join('\n')}
                  </pre>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
