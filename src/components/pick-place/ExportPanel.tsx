'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePickPlace } from '@/contexts/PickPlaceContext';
import { useDxf } from '@/contexts/DxfContext';
import { Button } from '@/components/ui/button';
import { Download, FileSpreadsheet, ChevronDown, Factory, Loader2 } from 'lucide-react';
import { buildPlacementOrders } from '@/operations/placementOrders';
import { placementOrdersToCsv, downloadPlacementCsv } from '@/operations/csvExport';
import { syncPlacementSnapshotFromScene } from '@/lib/placementSession';
import { loadGlueStripSnapshot } from '@/lib/glueStripSync';
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

  useEffect(() => {
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

  const glueSnap = useMemo(() => loadGlueStripSnapshot(), [stripTick, stoneCount]);
  const gluePreviewDone = useMemo(
    () => glueSnap != null && glueSnap.cells.length === stoneCount && stoneCount > 0,
    [glueSnap, stoneCount],
  );

  const placementSnap = useMemo(
    () => loadPlacementSnapshot(),
    [orders, stripTick],
  );
  const csvPreviewDone = useMemo(
    () =>
      (orders != null && orders.length > 0) ||
      (placementSnap != null && placementSnap.rows.length === stoneCount && stoneCount > 0),
    [orders, placementSnap, stoneCount],
  );

  const pipelineSteps = useMemo(
    () =>
      getPipelineSteps(!!dxfScene, stoneCount, gluePreviewDone, csvPreviewDone),
    [dxfScene, stoneCount, gluePreviewDone, csvPreviewDone],
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
      requireGluePreview: true,
      gluePreviewDone,
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
    gluePreviewDone,
    router,
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background/50">
      <div className="min-h-0 flex-1 overflow-y-auto space-y-3 pr-0.5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-1.5 mb-1">
            <FileSpreadsheet className="w-4 h-4 text-primary" />
            Dışa aktar ve gönder
          </h2>
          <p className="text-[10px] text-muted-foreground leading-snug">
            Yukarıdaki adımları sırayla tamamlayın; son adımda tüm veriler Production&apos;a aktarılır.
          </p>
        </div>

        <div className="rounded-md border border-border bg-muted/15 p-2">
          <PipelineChecklist steps={pipelineSteps} />
        </div>

        {orders && (
          <div className="flex gap-3 text-xs text-muted-foreground bg-muted/20 px-2 py-1.5 rounded-md border border-border">
            <span>{orders.length} CSV satırı</span>
            {gluePreviewDone && glueSnap && (
              <span>{glueSnap.cells.length} yapışkan karo</span>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="h-8 text-xs"
            onClick={handleGenerate}
            disabled={stoneCount === 0 || !dxfScene}
          >
            4. CSV önizle
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={handleDownload}
            disabled={stoneCount === 0 || !dxfScene}
          >
            <Download className="w-3.5 h-3.5" />
            CSV indir
          </Button>
        </div>

        <Button
          size="sm"
          className="h-9 w-full text-xs gap-1.5"
          variant="default"
          onClick={() => void handleSendToProduction()}
          disabled={!canSend}
        >
          {sending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Factory className="w-3.5 h-3.5" />
          )}
          5. Makineye gönder
        </Button>

        {sendError && (
          <p className="text-[11px] text-destructive">{sendError}</p>
        )}

        {!gluePreviewDone && stoneCount > 0 && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400">
            Göndermeden önce Glue Levha → <strong>Üret</strong> ile şablonu önizleyin.
          </p>
        )}

        {csvText && (
          <div className="mt-1">
            <button
              type="button"
              className="text-xs text-muted-foreground flex items-center gap-1 w-full mb-1"
              onClick={() => setShowPreview((s) => !s)}
            >
              <ChevronDown
                className={`w-3 h-3 transition-transform ${showPreview ? 'rotate-180' : ''}`}
              />
              CSV önizleme
            </button>
            {showPreview && (
              <pre className="text-[10px] leading-[1.4] font-mono bg-muted/30 border border-border rounded-md p-2 overflow-auto max-h-[160px] custom-scrollbar whitespace-pre">
                {csvText}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
