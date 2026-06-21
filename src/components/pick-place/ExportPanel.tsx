'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePickPlace } from '@/contexts/PickPlaceContext';
import { useDxf } from '@/contexts/DxfContext';
import { Button } from '@/components/ui/button';
import { Download, FileSpreadsheet, ChevronDown, Factory, Loader2, AlertTriangle } from 'lucide-react';
import { buildPlacementOrders } from '@/operations/placementOrders';
import { placementOrdersToCsv, downloadPlacementCsv } from '@/operations/csvExport';
import { syncPlacementSnapshotFromScene } from '@/lib/placementSession';
import { loadPlacementSnapshot } from '@/lib/appSessionStore';
import {
  countAssignedStones,
  getPipelineSteps,
  sendPlanningToMachine,
} from '@/lib/planningPipeline';
import PipelineChecklist from '@/components/pick-place/PipelineChecklist';
import type { PlacementOrder } from '@/types/pickplace';

export default function ExportPanel() {
  const router = useRouter();
  const { stoneTypes, pickPlaceConfig } = usePickPlace();
  const { dxfScene, selectedDxfFile } = useDxf();

  const [orders, setOrders] = useState<PlacementOrder[] | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [stripTick, setStripTick] = useState(0);
  // Hydration fix: localStorage'dan okunan veriler (placementSnap, glueSnap)
  // server'da null, client'ta dolu olabilir → csvText/gluePreviewDone farkı
  // hydration mismatch yaratır. Mount sonrası render için ``mounted`` guard.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const onStrip = () => setStripTick((t) => t + 1);
    const onPlacement = () => {
      const snap = loadPlacementSnapshot();
      if (snap?.rows.length) {
        setShowPreview(true);
      }
    };
    window.addEventListener('rhine:glue-strip-updated', onStrip);
    window.addEventListener('rhine:placement-updated', onPlacement);
    const snap = loadPlacementSnapshot();
    if (snap?.rows.length && dxfScene) {
      const built = buildPlacementOrders(dxfScene, stoneTypes, pickPlaceConfig);
      if (built.length) setOrders(built);
      setShowPreview(true);
    }
    return () => {
      window.removeEventListener('rhine:glue-strip-updated', onStrip);
      window.removeEventListener('rhine:placement-updated', onPlacement);
    };
  }, [dxfScene, stoneTypes, pickPlaceConfig]);

  const stoneCount = useMemo(() => countAssignedStones(stoneTypes), [stoneTypes]);

  const placementSnap = useMemo(
    () => (mounted ? loadPlacementSnapshot() : null),
    [mounted, orders, stripTick],
  );

  const pipelineSteps = useMemo(
    () => getPipelineSteps(!!dxfScene, stoneCount),
    [dxfScene, stoneCount],
  );

  const canSend = !!dxfScene && stoneCount > 0 && !sending;

  const handleGenerate = useCallback(() => {
    if (!dxfScene) return;
    const built = buildPlacementOrders(dxfScene, stoneTypes, pickPlaceConfig);
    setOrders(built);
    syncPlacementSnapshotFromScene(
      dxfScene,
      stoneTypes,
      pickPlaceConfig,
      selectedDxfFile?.name,
    );
    setShowPreview(true);
    setSendError(null);
  }, [dxfScene, stoneTypes, pickPlaceConfig, selectedDxfFile?.name]);

  const csvText = useMemo(() => {
    if (orders?.length) return placementOrdersToCsv(orders);
    if (placementSnap?.csv) return placementSnap.csv;
    return null;
  }, [orders, placementSnap]);

  const handleDownload = useCallback(() => {
    if (!dxfScene) return;
    const built = orders ?? buildPlacementOrders(dxfScene, stoneTypes, pickPlaceConfig);
    if (!orders) setOrders(built);
    syncPlacementSnapshotFromScene(
      dxfScene,
      stoneTypes,
      pickPlaceConfig,
      selectedDxfFile?.name,
    );
    downloadPlacementCsv(placementOrdersToCsv(built));
  }, [dxfScene, stoneTypes, pickPlaceConfig, orders, selectedDxfFile?.name]);

  const handleSendToProduction = useCallback(async () => {
    if (!dxfScene) return;
    setSending(true);
    setSendError(null);
    const result = await sendPlanningToMachine({
      scene: dxfScene,
      stoneTypes,
      config: pickPlaceConfig,
      fileName: selectedDxfFile?.name,
      requireGluePreview: false,
      gluePreviewDone: false,
    });
    setSending(false);
    if (!result.ok) {
      setSendError(result.message);
      return;
    }
    router.push('/production');
  }, [
    dxfScene,
    stoneTypes,
    pickPlaceConfig,
    selectedDxfFile?.name,
    router,
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background/50">
      <div className="min-h-0 flex-1 overflow-y-auto space-y-4 pr-0.5">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-1">
            <FileSpreadsheet className="w-4 h-4 text-primary" />
            Dışa aktar ve gönder
          </h2>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Adimlari tamamlayin; son asamada Production'a aktarilir.
          </p>
        </div>

        <div className="rounded-md border border-border bg-muted/15 p-2.5">
          <PipelineChecklist steps={pipelineSteps} />
        </div>

        {orders && (
          <div className="flex gap-3 text-xs text-muted-foreground bg-muted/20 px-3 py-2 rounded-md border border-border">
            <span>{orders.length} CSV satiri</span>
          </div>
        )}

        {/* Buton grubu: tek ana aksiyon + opsiyonel */}
        <div className="space-y-2">
          {/* Primary action: Makineye gonder */}
          <Button
            size="sm"
            className="h-11 w-full text-sm gap-1.5 font-semibold"
            variant="default"
            onClick={() => void handleSendToProduction()}
            disabled={!canSend}
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Factory className="w-4 h-4" />
            )}
            Makineye gonder
          </Button>

          {/* Opsiyonel: CSV onizle / indir */}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs flex-1 text-muted-foreground"
              onClick={handleGenerate}
              disabled={stoneCount === 0 || !dxfScene}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />
              CSV onizle
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-muted-foreground"
              onClick={handleDownload}
              disabled={stoneCount === 0 || !dxfScene}
            >
              <Download className="w-3.5 h-3.5 mr-1.5" />
              CSV indir
            </Button>
          </div>

          {sendError && (
            <p className="text-[11px] text-destructive flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              {sendError}
            </p>
          )}
        </div>

        {csvText && (
          <div className="mt-1">
            <button
              type="button"
              className="text-xs text-muted-foreground flex items-center gap-1 w-full mb-1 hover:text-foreground transition-colors"
              onClick={() => setShowPreview((s) => !s)}
            >
              <ChevronDown
                className={`w-3 h-3 transition-transform ${showPreview ? 'rotate-180' : ''}`}
              />
              CSV onizleme
            </button>
            {showPreview && (
              <pre className="text-[11px] leading-[1.5] font-mono bg-muted/30 border border-border rounded-md p-3 overflow-auto max-h-[260px] custom-scrollbar whitespace-pre">
                {csvText}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
