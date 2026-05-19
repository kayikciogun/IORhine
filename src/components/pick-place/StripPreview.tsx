'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { usePickPlace } from '../../contexts/PickPlaceContext';
import { useDxf } from '../../contexts/DxfContext';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import {
  Download,
  LayoutGrid,
  AlertCircle,
  RefreshCw,
  Info,
} from 'lucide-react';
import { loadGlueStripSnapshot, saveGlueStripSnapshot } from '@/lib/glueStripSync';
import { countAssignedStones } from '@/lib/planningPipeline';
import {
  generateStripData,
  exportStripToDxf,
  StripCell,
} from '@/operations/stripGenerator';
import { Path, ArcSegment } from '@/Utils/offsetUtils';

function finiteOrEmpty(v: unknown): number | '' {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return '';
}

export default function StripPreview() {
  const { stoneTypes, pickPlaceConfig: cfg, updatePickPlaceConfig } = usePickPlace();
  const { dxfScene } = useDxf();
  const [cells, setCells] = useState<StripCell[]>([]);
  const [appliedConfig, setAppliedConfig] = useState(cfg);
  const [isStale, setIsStale] = useState(false);
  const hydratedRef = useRef(false);

  // Sayfa yenilenince / geri dönünce session'dan şablonu geri yükle.
  // Ref kullanıyoruz: state tabanlı guard stoneTypes geç gelince kalıcı takılıyordu.
  useEffect(() => {
    if (hydratedRef.current) return;
    if (!dxfScene) return;
    const n = countAssignedStones(stoneTypes);
    if (n === 0) return; // stoneTypes henüz context'ten gelmediyse bekle
    hydratedRef.current = true;
    const snap = loadGlueStripSnapshot();
    if (!snap || snap.cells.length === 0) return;
    const regenerated = generateStripData(dxfScene, stoneTypes, snap.config);
    if (regenerated.length) {
      setCells(regenerated);
      setAppliedConfig(snap.config);
      setIsStale(false);
    }
  }, [dxfScene, stoneTypes]);

  useEffect(() => {
    if (cells.length === 0) return;
    setIsStale(true);
  }, [
    stoneTypes,
    cfg.cellSize,
    cfg.rowLength,
    cfg.cellGap,
    cfg.stripOriginX,
    cfg.stripOriginY,
  ]);

  const pathToSvgString = (path: Path, offsetX: number, offsetY: number, close = true) => {
    if (!path || path.length === 0) return '';
    let d = '';
    path.forEach((segment, index) => {
      if (index === 0) {
        d += `M ${segment.start.x + offsetX} ${-(segment.start.y) + offsetY} `;
      }
      if (segment.type === 'Line') {
        d += `L ${segment.end.x + offsetX} ${-(segment.end.y) + offsetY} `;
      } else if (segment.type === 'Arc') {
        const arc = segment as ArcSegment;
        let angleDiff = arc.endAngle - arc.startAngle;
        if (!arc.clockwise && angleDiff < 0) angleDiff += 2 * Math.PI;
        if (arc.clockwise && angleDiff > 0) angleDiff -= 2 * Math.PI;
        const largeArcFlag = Math.abs(angleDiff) > Math.PI ? 1 : 0;
        const sweepFlag = arc.clockwise ? 1 : 0;
        d += `A ${arc.radius} ${arc.radius} 0 ${largeArcFlag} ${sweepFlag} ${arc.end.x + offsetX} ${-(arc.end.y) + offsetY} `;
      }
    });
    return close ? d + 'Z' : d;
  };

  const totalStones = useMemo(
    () => stoneTypes.reduce((acc, st) => acc + st.contourIds.length, 0),
    [stoneTypes],
  );

  const handleGenerate = () => {
    if (!dxfScene) {
      alert('DXF sahnesi henüz yüklenmedi!');
      return;
    }
    const generated = generateStripData(dxfScene, stoneTypes, cfg);
    setCells(generated);
    setAppliedConfig({ ...cfg });
    setIsStale(false);
    saveGlueStripSnapshot(generated, cfg);
  };

  const handleDownloadDxf = () => {
    if (cells.length === 0) return;
    const dxfString = exportStripToDxf(cells, cfg);
    const blob = new Blob([dxfString], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `glue_sheet_${Date.now()}.dxf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const stripBounds = useMemo(() => {
    if (cells.length === 0) return null;
    const cellW =
      typeof appliedConfig.cellSize === 'number' &&
      Number.isFinite(appliedConfig.cellSize)
        ? appliedConfig.cellSize
        : 20;
    const hs = cellW / 2;
    let minX = Infinity,
      maxX = -Infinity,
      minSvgY = Infinity,
      maxSvgY = -Infinity;
    for (const c of cells) {
      if (c.x - hs < minX) minX = c.x - hs;
      if (c.x + hs > maxX) maxX = c.x + hs;
      const syTop = -c.y - hs;
      const syBot = -c.y + hs;
      if (syTop < minSvgY) minSvgY = syTop;
      if (syBot > maxSvgY) maxSvgY = syBot;
    }
    const pad = 8;
    return {
      vbX: minX - pad,
      vbY: minSvgY - pad,
      vbW: maxX - minX + pad * 2,
      vbH: maxSvgY - minSvgY + pad * 2,
    };
  }, [cells, appliedConfig.cellSize]);

  const rowLenUi = finiteOrEmpty(cfg.rowLength);
  const cellSzUi = finiteOrEmpty(cfg.cellSize);

  return (
    <div className="flex flex-col h-full bg-background/50">
      {/* Başlık */}
      <div className="flex justify-between items-center mb-2">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-1.5">
            <LayoutGrid className="w-4 h-4 text-primary" />
            3. Glue Levha
          </h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            <strong>Üret</strong> ile önizleyin; gönderim alttaki 5. adımda.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerate}
            disabled={totalStones === 0}
            className="h-8"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1" />
            Üret
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleDownloadDxf}
            disabled={cells.length === 0}
            className="h-8"
          >
            <Download className="w-3.5 h-3.5 mr-1" />
            DXF İndir
          </Button>
        </div>
      </div>

  

      {/* Ayarlar */}
      <div className="flex gap-2 mb-2 bg-muted/20 p-2 rounded-lg border border-border flex-wrap justify-between">
        <div className="flex items-center gap-1.5">
          <Label className="text-[11px] whitespace-nowrap" title="Satır başına max karo sayısı">
            Sütun/satır:
          </Label>
          <Input
            type="number"
            className="w-12 h-6 text-xs px-1"
            value={rowLenUi === '' ? '' : rowLenUi}
            onChange={(e) =>
              updatePickPlaceConfig({ rowLength: parseInt(e.target.value, 10) || 1 })
            }
            min={1}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-[11px] whitespace-nowrap">Hücre (mm):</Label>
          <Input
            type="number"
            className="w-14 h-6 text-xs px-1"
            value={cellSzUi === '' ? '' : cellSzUi}
            onChange={(e) =>
              updatePickPlaceConfig({ cellSize: parseFloat(e.target.value) || 20 })
            }
            min={5}
          />
        </div>
      </div>

      {isStale && cells.length > 0 && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[11px]">
          <RefreshCw className="w-3 h-3 shrink-0" />
          <span>Ayarlar değişti — önizleme güncel değil. Yeniden üretin.</span>
        </div>
      )}

      {totalStones === 0 ? (
        <div className="text-center p-4 m-auto border border-dashed rounded-lg text-muted-foreground w-full">
          <AlertCircle className="w-6 h-6 mb-2 opacity-50 mx-auto" />
          <p className="text-sm">Henüz taş atanmamış.</p>
        </div>
      ) : (
        <div className="flex-1 bg-muted/30 border border-border rounded-lg overflow-auto relative p-2 flex justify-center items-start custom-scrollbar">
          {cells.length === 0 ? (
            <div className="text-center text-muted-foreground m-auto text-sm">
              <p>Önizlemek için <strong>Üret</strong>'e tıklayın.</p>
              <p className="text-xs mt-1 text-muted-foreground/70">
                {totalStones} taş · her hücre hedef açıda gösterilir
              </p>
            </div>
          ) : (
            <svg
              width={
                stripBounds
                  ? Math.min(560, Math.max(180, stripBounds.vbW * 4))
                  : 200
              }
              height={
                stripBounds
                  ? Math.min(480, Math.max(160, stripBounds.vbH * 4))
                  : 200
              }
              viewBox={
                stripBounds
                  ? `${stripBounds.vbX} ${stripBounds.vbY} ${stripBounds.vbW} ${stripBounds.vbH}`
                  : '0 0 100 100'
              }
              preserveAspectRatio="xMidYMid meet"
              className="mt-2 max-h-[min(52vh,420px)] w-full bg-background border shadow-sm"
            >
              {cells.map((cell, i) => {
                const cellDraw =
                  typeof appliedConfig.cellSize === 'number' &&
                  Number.isFinite(appliedConfig.cellSize)
                    ? appliedConfig.cellSize
                    : 20;
                const hs = cellDraw / 2;
                const svgYTop = -cell.y - hs;
                const cx = cell.x;
                const cy = -cell.y;
                const angle = cell.targetAngle ?? 0;
                return (
                  <g key={i}>
                    {/* Hücre kutusu */}
                    <rect
                      x={cx - hs}
                      y={svgYTop}
                      width={cellDraw}
                      height={cellDraw}
                      fill="none"
                      stroke="currentColor"
                      strokeOpacity="0.25"
                      strokeWidth="0.5"
                    />

                    {/* Taş kontürü — açık ARC/LINE için viewer'daki ham polyline noktaları */}
                    {cell.polylinePoints && cell.polylinePoints.length > 1 ? (
                      <polyline
                        points={cell.polylinePoints
                          .map((p) => `${cx + p.x},${cy - p.y}`)
                          .join(' ')}
                        fill="none"
                        stroke={cell.color}
                        strokeWidth="0.8"
                      />
                    ) : (
                      <path
                        d={pathToSvgString(cell.path, cx, cy, cell.isClosed)}
                        fill={cell.isClosed ? cell.color + '22' : 'none'}
                        stroke={cell.color}
                        strokeWidth="0.8"
                      />
                    )}

                    {/* Sıra numarası */}
                    <text
                      x={cx - hs + 1}
                      y={svgYTop + 3.5}
                      fontSize="2.5"
                      fill="currentColor"
                      opacity="0.55"
                    >
                      {i + 1}
                    </text>

                    {/* Açı etiketi */}
                    {Math.abs(angle) > 0.5 && (
                      <text
                        x={cx + hs - 1}
                        y={svgYTop + 3.5}
                        fontSize="2.2"
                        fill="currentColor"
                        opacity="0.55"
                        textAnchor="end"
                      >
                        {angle.toFixed(0)}°
                      </text>
                    )}
                  </g>
                );
              })}

            </svg>
          )}
        </div>
      )}
    </div>
  );
}
