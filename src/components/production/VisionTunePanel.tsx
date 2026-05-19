'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { getVisionSettings, updateVisionSettings } from '@/lib/runtimeClient';
import type { DetectedStone, VisionSettings } from '@/types/runtime';

interface Props {
  objects?: DetectedStone[];
}

function formatMaxArea(v: number): string {
  return v >= 1000 ? `${Math.round(v / 1000)}k` : String(v);
}

export default function VisionTunePanel({ objects = [] }: Props) {
  const [blur, setBlur] = useState(9);
  const [threshold, setThreshold] = useState(120);
  const [autoThresh, setAutoThresh] = useState(false);
  const [minArea, setMinArea] = useState(600);
  const [maxArea, setMaxArea] = useState(80000);
  const [showMask, setShowMask] = useState(false);
  const [matchTh, setMatchTh] = useState(0.15);
  const [msg, setMsg] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyRef = useRef(false);

  const buildBody = useCallback((): VisionSettings => {
    const bk = blur % 2 === 0 ? blur + 1 : blur;
    return {
      blur_kernel: bk,
      fast_detect_threshold: autoThresh ? 0 : threshold,
      min_contour_area: minArea,
      max_contour_area: maxArea,
      show_mask: showMask,
      match_threshold: matchTh,
      threshold_auto: autoThresh,
    };
  }, [autoThresh, blur, matchTh, maxArea, minArea, showMask, threshold]);

  const pushLive = useCallback(
    (body: VisionSettings) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          await updateVisionSettings(body);
          setMsg(null);
        } catch (e) {
          setMsg(String(e));
        }
      }, 200);
    },
    [],
  );

  const load = useCallback(async () => {
    try {
      const v = await getVisionSettings();
      setBlur(v.blur_kernel);
      setAutoThresh(v.threshold_auto ?? v.fast_detect_threshold <= 0);
      setThreshold(
        v.fast_detect_threshold > 0 ? v.fast_detect_threshold : 120,
      );
      setMinArea(v.min_contour_area);
      setMaxArea(v.max_contour_area ?? 80000);
      setShowMask(v.show_mask ?? false);
      setMatchTh(v.match_threshold);
      readyRef.current = true;
    } catch (e) {
      setMsg(String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!readyRef.current) return;
    pushLive(buildBody());
  }, [buildBody, pushLive]);

  const filtered = objects.filter((o) => o.area >= minArea && o.area <= maxArea);
  const angles = filtered.map((o) => o.angle);
  const statAvg =
    angles.length > 0
      ? (angles.reduce((a, b) => a + b, 0) / angles.length).toFixed(1)
      : '—';
  const statMin = angles.length > 0 ? Math.min(...angles).toFixed(1) : '—';
  const statMax = angles.length > 0 ? Math.max(...angles).toFixed(1) : '—';

  return (
    <div className="space-y-4 text-xs">
      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">
          Görüntü ayarları
        </h3>
        <p className="text-[10px] text-muted-foreground mb-3 leading-snug">
          web_angle ile aynı: eşik, min/maks alan, maske. Değişiklikler canlı
          uygulanır.
        </p>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Switch
              id="otsu"
              checked={autoThresh}
              onCheckedChange={setAutoThresh}
            />
            <Label htmlFor="otsu" className="text-[10px] cursor-pointer">
              Otsu otomatik eşik
            </Label>
          </div>

          {!autoThresh && (
            <div>
              <div className="flex justify-between mb-1">
                <Label className="text-[10px]">Eşik</Label>
                <span className="text-[10px] tabular-nums text-primary">
                  {threshold}
                </span>
              </div>
              <Slider
                min={0}
                max={255}
                step={1}
                value={[threshold]}
                onValueChange={([v]) => setThreshold(v)}
              />
            </div>
          )}

          <div>
            <div className="flex justify-between mb-1">
              <Label className="text-[10px]">Min alan (px²)</Label>
              <span className="text-[10px] tabular-nums text-primary">
                {minArea}
              </span>
            </div>
            <Slider
              min={100}
              max={5000}
              step={100}
              value={[minArea]}
              onValueChange={([v]) => setMinArea(v)}
            />
          </div>

          <div>
            <div className="flex justify-between mb-1">
              <Label className="text-[10px]">Maks alan (px²)</Label>
              <span className="text-[10px] tabular-nums text-primary">
                {formatMaxArea(maxArea)}
              </span>
            </div>
            <Slider
              min={1000}
              max={200000}
              step={1000}
              value={[maxArea]}
              onValueChange={([v]) => setMaxArea(v)}
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="mask"
              checked={showMask}
              onCheckedChange={setShowMask}
            />
            <Label htmlFor="mask" className="text-[10px] cursor-pointer">
              Maske görünümü
            </Label>
          </div>

          <details className="text-[10px]">
            <summary className="cursor-pointer text-muted-foreground">
              Job vision (matchShapes)
            </summary>
            <div className="mt-2 space-y-2">
              <Label className="text-[10px]">
                Blur kernel: {blur}
              </Label>
              <Slider
                min={1}
                max={31}
                step={2}
                value={[blur]}
                onValueChange={([v]) => setBlur(v)}
              />
              <Label className="text-[10px]">
                Eşik: {matchTh.toFixed(2)}
              </Label>
              <Slider
                min={0.05}
                max={1}
                step={0.01}
                value={[matchTh]}
                onValueChange={([v]) => setMatchTh(v)}
              />
            </div>
          </details>
        </div>
      </div>

      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          İstatistikler
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            ['Nesne', String(filtered.length)],
            ['Ort. açı', statAvg === '—' ? '—' : `${statAvg}°`],
            ['Min açı', statMin === '—' ? '—' : `${statMin}°`],
            ['Maks açı', statMax === '—' ? '—' : `${statMax}°`],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-md border border-border/80 bg-muted/30 px-2 py-1.5"
            >
              <div className="text-[9px] text-muted-foreground">{label}</div>
              <div className="text-sm font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>
      </div>

      {msg && (
        <p className="text-[10px] text-destructive leading-snug">{msg}</p>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-[10px] w-full"
        onClick={() => load()}
      >
        Ayarları sunucudan yenile
      </Button>
    </div>
  );
}
