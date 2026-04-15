'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { usePickPlace } from '../../contexts/PickPlaceContext';
import { useDxf } from '../../contexts/DxfContext';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Download, LayoutGrid, AlertCircle } from 'lucide-react';
import { generateStripData, exportStripToDxf, StripCell } from '@/operations/stripGenerator';
import { Path, ArcSegment } from '@/Utils/offsetUtils';

export default function StripPreview() {
  const { stoneTypes, pickPlaceConfig: cfg, updatePickPlaceConfig } = usePickPlace();
  const { dxfScene } = useDxf();
  const [cells, setCells] = useState<StripCell[]>([]);
  const [appliedConfig, setAppliedConfig] = useState(cfg);

  const pathToSvgString = (path: Path, offsetX: number, offsetY: number) => {
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
        // Y flip reverses winding, so swap sweepFlag
        const sweepFlag = arc.clockwise ? 1 : 0;
        d += `A ${arc.radius} ${arc.radius} 0 ${largeArcFlag} ${sweepFlag} ${arc.end.x + offsetX} ${-(arc.end.y) + offsetY} `;
      }
    });
    return d + 'Z';
  };

  // Toplam taş sayısını hesapla
  const totalStones = useMemo(() => {
    return stoneTypes.reduce((acc, st) => acc + st.contourIds.length, 0);
  }, [stoneTypes]);

  const handleGenerate = () => {
    if (!dxfScene) {
      alert("DXF sahnesi henüz yüklenmedi!");
      return;
    }
    const generated = generateStripData(dxfScene, stoneTypes, cfg);
    setCells(generated);
    setAppliedConfig({ ...cfg });
  };

  const handleDownloadDxf = () => {
    if (cells.length === 0) return;
    const dxfString = exportStripToDxf(cells, cfg);
    
    const blob = new Blob([dxfString], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `strip_layout_${new Date().getTime()}.dxf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const stripBounds = useMemo(() => {
    if (cells.length === 0) return null;
    const hs = appliedConfig.cellSize / 2;
    let minX = Infinity;
    let maxX = -Infinity;
    let minSvgY = Infinity;
    let maxSvgY = -Infinity;
    for (const c of cells) {
      const sx0 = c.x - hs;
      const sx1 = c.x + hs;
      const syTop = -c.y - hs;
      const syBot = -c.y + hs;
      if (sx0 < minX) minX = sx0;
      if (sx1 > maxX) maxX = sx1;
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

  return (
    <div className="flex flex-col h-full bg-background/50">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-base font-semibold flex items-center gap-1.5">
          <LayoutGrid className="w-4 h-4 text-primary" />
          Şablon
        </h2>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleGenerate}
            disabled={totalStones === 0}
            className="h-8"
          >
            Önizleme Üret
          </Button>
          <Button 
            variant="default" 
            size="sm" 
            onClick={handleDownloadDxf}
            disabled={cells.length === 0}
            className="h-8"
          >
            <Download className="w-4 h-4 mr-1" /> DXF İndir
          </Button>
        </div>
      </div>

      <div className="flex gap-2 mb-2 bg-muted/20 p-2 rounded-lg border border-border flex-wrap justify-between">
        <div className="flex items-center gap-1.5">
          <Label className="text-[11px] whitespace-nowrap">Grid X:</Label>
          <Input
            type="number"
            className="w-12 h-6 text-xs px-1"
            value={cfg.rowLength}
            onChange={(e) => updatePickPlaceConfig({ rowLength: parseInt(e.target.value) || 1 })}
            min={1}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-[11px] whitespace-nowrap">Hücre:</Label>
          <Input
            type="number"
            className="w-12 h-6 text-xs px-1"
            value={cfg.cellSize}
            onChange={(e) => updatePickPlaceConfig({ cellSize: parseFloat(e.target.value) || 10 })}
            min={5}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-[11px] whitespace-nowrap">Offset:</Label>
          <Input
            type="number"
            step="0.1"
            className="w-12 h-6 text-xs px-1"
            value={cfg.contourOffset}
            onChange={(e) => updatePickPlaceConfig({ contourOffset: parseFloat(e.target.value) || 0 })}
            min={0}
          />
        </div>
      </div>

      {totalStones === 0 ? (
        <div className="text-center p-4 m-auto border border-dashed rounded-lg text-muted-foreground w-full">
          <AlertCircle className="w-6 h-6 mb-2 opacity-50 mx-auto" />
          <p className="text-sm">Henüz taş atanmamış.</p>
        </div>
      ) : (
        <div className="flex-1 bg-muted/30 border border-border rounded-lg overflow-auto relative p-2 flex justify-center items-start custom-scrollbar">
          {cells.length === 0 ? (
            <div className="text-center text-muted-foreground m-auto">
              Önizleme üretmek için yukarıdaki butona tıklayın. Toplam {totalStones} taş dizilecek.
            </div>
          ) : (
            <svg
              width={stripBounds ? Math.min(560, Math.max(180, stripBounds.vbW * 4)) : 200}
              height={stripBounds ? Math.min(480, Math.max(160, stripBounds.vbH * 4)) : 200}
              viewBox={
                stripBounds
                  ? `${stripBounds.vbX} ${stripBounds.vbY} ${stripBounds.vbW} ${stripBounds.vbH}`
                  : '0 0 100 100'
              }
              preserveAspectRatio="xMidYMid meet"
              className="mt-2 max-h-[min(52vh,420px)] w-full bg-background border shadow-sm"
            >
              {cells.map((cell, i) => {
                const hs = appliedConfig.cellSize / 2;
                // Dünya +Y = şeritte yukarı; SVG +y aşağı olduğu için Y ters (path ile aynı mantık)
                const svgYTop = -cell.y - hs;
                return (
                  <g key={i}>
                    <rect
                      x={cell.x - hs}
                      y={svgYTop}
                      width={appliedConfig.cellSize}
                      height={appliedConfig.cellSize}
                      fill="none"
                      stroke="currentColor"
                      strokeOpacity="0.2"
                      strokeWidth="0.5"
                    />
                    <path
                      d={pathToSvgString(cell.path, cell.x, -cell.y)}
                      fill="none"
                      stroke={cell.color}
                      strokeWidth="1"
                    />
                    <text
                      x={cell.x - hs + 1}
                      y={svgYTop + 3.5}
                      fontSize="2.5"
                      fill="currentColor"
                      opacity="0.5"
                    >
                      {i + 1}
                    </text>
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
