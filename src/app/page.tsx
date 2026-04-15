'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useDxf } from '@/contexts/DxfContext';
import { useSelection } from '@/components/dxf-viewer/useSelection';
import { usePickPlace } from '@/contexts/PickPlaceContext';
import { debug } from '@/Utils/debug';
import { clearAppSession } from '@/lib/appSessionStore';
import { FileX2, FolderKanban } from 'lucide-react';
import initCavc, { on_load as cavcOnLoad } from '../../public/wasm/v0aigcode_cavalier_ffi.js';
import StoneTypePanel from '@/components/pick-place/StoneTypePanel';
import StripPreview from '@/components/pick-place/StripPreview';
import GcodePanel from '@/components/pick-place/GcodePanel';

// DxfViewer Three.js kullanır, client-side render edilmeli
const DxfViewer = dynamic(() => import('@/components/dxf-viewer/DxfViewer'), { ssr: false });

export default function PickPlaceHome() {
  const { selectedDxfFile, setSelectedDxfFile, dxfSessionHydrated, clearDxfSession } = useDxf();
  const { selectedObjectsSet } = useSelection();
  const { activeStoneTypeId } = usePickPlace();

  // WASM Init
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initCavc('/wasm/v0aigcode_cavalier_ffi_bg.wasm');
        if (!cancelled) {
          try { cavcOnLoad(); } catch { }
          debug.log('[WASM] Cavalier Contours WASM başarıyla başlatıldı');
          (window as any).__CAVALIER_WASM_READY__ = true;
        }
      } catch (e) {
        if (!cancelled) console.error('[WASM] Cavalier Contours init hatası:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleDxfFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedDxfFile(file);
      event.target.value = '';
    }
  };

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-foreground">
      {/* Sol Panel: DXF Viewer */}
      <div className="flex-1 relative border-r border-border h-full flex flex-col">
        {!dxfSessionHydrated ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Oturum yükleniyor…
          </div>
        ) : selectedDxfFile ? (
          <>
            <div className="absolute left-4 top-4 z-20 max-w-[min(100%,calc(100%-2rem))]">
              <div
                className="flex flex-wrap items-stretch gap-0 rounded-2xl border border-border/80 bg-card/92 p-1 shadow-lg backdrop-blur-xl ring-1 ring-black/[0.04] dark:bg-card/85 dark:ring-white/[0.07]"
                role="toolbar"
                aria-label="DXF oturum araçları"
              >
                <button
                  type="button"
                  onClick={() => clearDxfSession()}
                  title="Bu DXF dosyasını kapat; yeni dosya seçebilirsiniz"
                  className="group inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-left text-xs font-semibold text-foreground transition-colors hover:bg-destructive/12 hover:text-destructive sm:flex-none"
                >
                  <FileX2 className="h-4 w-4 shrink-0 opacity-70 group-hover:opacity-100" aria-hidden />
                  <span className="hidden sm:inline">DXF kaldır</span>
                  <span className="sm:hidden">Kaldır</span>
                </button>
                <span className="my-1.5 w-px shrink-0 self-stretch bg-border/70" aria-hidden />
                <button
                  type="button"
                  title="Taş tipleri, ayarlar ve DXF dahil tüm oturumu sıfırlar"
                  onClick={() => {
                    if (!window.confirm('Tüm oturum silinsin mi? (Taş tipleri, DXF, ayarlar) Sayfa yenilenecek.')) return;
                    clearAppSession();
                    window.location.reload();
                  }}
                  className="group inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-left text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:flex-none"
                >
                  <FolderKanban className="h-4 w-4 shrink-0 opacity-70 group-hover:opacity-100" aria-hidden />
                  <span>Yeni proje</span>
                </button>
              </div>
              <p className="mt-1.5 hidden px-0.5 text-[10px] leading-tight text-muted-foreground/90 sm:block">
                Kaldır: sadece çizim · Yeni proje: tam sıfırlama
              </p>
            </div>
            <DxfViewer
              key={`${selectedDxfFile.name}-${selectedDxfFile.lastModified}`}
              initialFile={selectedDxfFile}
              isPickPlaceMode={true}
              activeStoneTypeId={activeStoneTypeId}
            />
          </>
        ) : (
          <label className="flex-1 flex items-center justify-center text-muted-foreground border-2 border-dashed border-border/50 m-8 rounded-xl bg-muted/5 cursor-pointer hover:bg-muted/10 hover:border-primary/40 transition-colors">
            <div className="text-center pointer-events-none">
              <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-xl font-medium">Başlamak için DXF dosyası yükleyin</p>
              <p className="text-sm mt-1 opacity-60">Buraya tıklayın</p>
            </div>
            <input type="file" accept=".dxf" className="hidden" onChange={handleDxfFileSelect} />
          </label>
        )}
      </div>

      {/* Sağ Panel: Ayarlar ve İşlemler */}
      <div className="w-[360px] xs:w-[400px] shrink-0 bg-card border-l border-border h-full flex flex-col shadow-2xl z-20">
        <div className="p-3 border-b border-border bg-muted/30 flex justify-between items-center">
          <h1 className="text-base font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            IO-CAM Pick & Place
          </h1>
        </div>
        
        <div className="flex min-h-0 flex-1 flex-col space-y-3 overflow-y-auto p-2 custom-scrollbar">
          {/* Taş Tipi Yönetimi */}
          <div className="rounded-lg border border-border bg-background p-3 shadow-sm flex flex-col shrink-0 min-h-[100px] max-h-[60vh]">
            <StoneTypePanel />
          </div>
          
          {/* Dizim Şablonu */}
          <div className="rounded-lg border border-border bg-background p-3 shadow-sm flex flex-col shrink-0 min-h-[250px]">
            <StripPreview />
          </div>

          {/* G-Code Paneli — Başlat/JOG altta; kalan yüksekliği doldurur */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background p-3 shadow-sm">
            <GcodePanel />
          </div>
        </div>
      </div>
    </div>
  );
}
