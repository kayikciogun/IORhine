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

  const maxRow = cells.length > 0 ? Math.max(...cells.map(c => Math.floor(c.y / appliedConfig.cellSize))) : 0;
  const maxCol = cells.length > 0 ? Math.max(...cells.map(c => Math.floor(c.x / appliedConfig.cellSize))) : 0;

  return (
    <div className="flex flex-col h-full bg-background/50">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-base font-semibold flex items-center gap-1.5">
          <LayoutGrid className="w-4 h-4 text-primary" />
          Dizim Şablonu
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
              width={(maxCol + 1) * appliedConfig.cellSize * 5} 
              height={(maxRow + 1) * appliedConfig.cellSize * 5} 
              viewBox={`-5 -5 ${(maxCol + 1) * appliedConfig.cellSize + 10} ${(maxRow + 1) * appliedConfig.cellSize + 10}`}
              className="mt-2 bg-background border shadow-sm"
            >
              {cells.map((cell, i) => {
                const hs = appliedConfig.cellSize / 2;
                return (
                  <g key={i}>
                    {/* Dış Kutu */}
                    <rect 
                      x={cell.x - hs} 
                      y={cell.y - hs} 
                      width={appliedConfig.cellSize} 
                      height={appliedConfig.cellSize} 
                      fill="none" 
                      stroke="currentColor" 
                      strokeOpacity="0.2"
                      strokeWidth="0.5" 
                    />
                    
                    {/* Taş Kontürü */}
                    <path 
                      d={pathToSvgString(cell.path, cell.x, cell.y)}
                      fill="none"
                      stroke={cell.color}
                      strokeWidth="1"
                    />
                    
                    {/* Numara */}
                    <text 
                      x={cell.x - hs + 1} 
                      y={cell.y - hs + 3.5} 
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
