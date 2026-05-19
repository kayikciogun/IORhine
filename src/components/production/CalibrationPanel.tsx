'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CalibrationSummary } from '@/types/runtime';
import { getDefaultRuntimeClientConfig } from '@/lib/runtimeClient';

interface Props {
  summary: CalibrationSummary | null;
  onRefresh: () => void;
}

export default function CalibrationPanel({ summary, onRefresh }: Props) {
  const [fabricDx, setFabricDx] = useState('0');
  const [fabricDy, setFabricDy] = useState('0');
  const [glueOx, setGlueOx] = useState('0');
  const [glueOy, setGlueOy] = useState('0');
  const [glueZ, setGlueZ] = useState('0.5');
  const [chessCols, setChessCols] = useState('9');
  const [chessRows, setChessRows] = useState('6');
  const [squareMm, setSquareMm] = useState('20');
  const [msg, setMsg] = useState<string | null>(null);
  const [homoLoading, setHomoLoading] = useState(false);

  const base = getDefaultRuntimeClientConfig().restBaseUrl;

  async function post(path: string, body?: unknown) {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const detail = (err as { detail?: string }).detail;
      throw new Error(detail ?? `${path} failed (${res.status})`);
    }
    onRefresh();
    return res.json();
  }

  async function calibrateHomography() {
    setHomoLoading(true);
    setMsg(null);
    try {
      const data = await post('/api/calibration/homography', {
        chessboard_cols: parseInt(chessCols, 10),
        chessboard_rows: parseInt(chessRows, 10),
        square_size_mm: parseFloat(squareMm),
      });
      const err = (data as { reprojection_error_mm?: number }).reprojection_error_mm;
      setMsg(
        err != null
          ? `Homography kaydedildi (ortalama hata: ${err.toFixed(3)} mm)`
          : 'Homography kaydedildi',
      );
    } catch (e) {
      setMsg(String(e));
    } finally {
      setHomoLoading(false);
    }
  }

  return (
    <div className="space-y-3 text-xs">
      {summary && (
        <ul className="text-muted-foreground space-y-0.5">
          <li>Yapışkan ızgarası: {summary.glue_sheet ? '✓' : '—'}</li>
          <li>Kumaş offset: {summary.fabric_offset ? '✓' : '—'}</li>
          <li>Homography (vision pick): {summary.homography ? '✓' : '—'}</li>
        </ul>
      )}

      <p className="text-[10px] text-muted-foreground leading-snug">
        Pick her zaman vision (konveyör + kamera). CSV satır i → yapışkan karo i → kumaş.
        Jog ile yapışkan ızgarasının sol-alt köşesini origin olarak kaydedin.
      </p>

      <p className="text-[10px] font-medium text-foreground/80">Yapışkan ızgarası (1→2→3…)</p>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-[10px]">Glue origin X</Label>
          <Input className="h-7 text-xs" value={glueOx} onChange={(e) => setGlueOx(e.target.value)} />
        </div>
        <div>
          <Label className="text-[10px]">Glue origin Y</Label>
          <Input className="h-7 text-xs" value={glueOy} onChange={(e) => setGlueOy(e.target.value)} />
        </div>
        <div>
          <Label className="text-[10px]">Glue Z</Label>
          <Input className="h-7 text-xs" value={glueZ} onChange={(e) => setGlueZ(e.target.value)} />
        </div>
      </div>
      <Button
        size="sm"
        className="h-7 text-[10px] w-full"
        onClick={() =>
          post('/api/calibration/glue_sheet', {
            origin_x: parseFloat(glueOx),
            origin_y: parseFloat(glueOy),
            z: parseFloat(glueZ),
            cell_size: 20,
          })
            .then(() => setMsg('Yapışkan ızgarası kaydedildi'))
            .catch((e) => setMsg(String(e)))
        }
      >
        Yapışkan ızgarası kaydet
      </Button>

      <p className="text-[10px] font-medium text-foreground/80">Kumaş</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px]">Fabric dx</Label>
          <Input className="h-7 text-xs" value={fabricDx} onChange={(e) => setFabricDx(e.target.value)} />
        </div>
        <div>
          <Label className="text-[10px]">Fabric dy</Label>
          <Input className="h-7 text-xs" value={fabricDy} onChange={(e) => setFabricDy(e.target.value)} />
        </div>
      </div>
      <Button
        size="sm"
        className="h-7 text-[10px] w-full"
        onClick={() =>
          post('/api/calibration/fabric', {
            dx: parseFloat(fabricDx),
            dy: parseFloat(fabricDy),
          })
            .then(() => setMsg('Kumaş offset kaydedildi'))
            .catch((e) => setMsg(String(e)))
        }
      >
        Kumaş offset kaydet
      </Button>

      <p className="text-[10px] font-medium text-foreground/80">Vision (homography)</p>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-[10px]">İç köşe (sütun)</Label>
          <Input className="h-7 text-xs" value={chessCols} onChange={(e) => setChessCols(e.target.value)} />
        </div>
        <div>
          <Label className="text-[10px]">İç köşe (satır)</Label>
          <Input className="h-7 text-xs" value={chessRows} onChange={(e) => setChessRows(e.target.value)} />
        </div>
        <div>
          <Label className="text-[10px]">Kare (mm)</Label>
          <Input className="h-7 text-xs" value={squareMm} onChange={(e) => setSquareMm(e.target.value)} />
        </div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        className="h-7 text-[10px] w-full"
        disabled={homoLoading}
        onClick={calibrateHomography}
      >
        {homoLoading ? 'Kalibre ediliyor…' : 'Homography kalibre et'}
      </Button>

      {msg && <p className="text-[10px] text-muted-foreground">{msg}</p>}
    </div>
  );
}
