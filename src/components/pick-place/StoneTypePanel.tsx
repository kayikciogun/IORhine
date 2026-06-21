'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { usePickPlace } from '../../contexts/PickPlaceContext';
import { useSelection } from '../dxf-viewer/useSelection';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Plus, Trash2, CheckCircle2, PaintBucket, Tag, Edit2, Gem,
} from 'lucide-react';
import { StoneType } from '@/types/pickplace';

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
  '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
];

const COLOR_NAMES: Record<string, string> = {
  '#ef4444': 'Kırmızı', '#f97316': 'Turuncu', '#f59e0b': 'Amber',
  '#84cc16': 'Lime', '#22c55e': 'Yeşil', '#06b6d4': 'Camgöbeği',
  '#3b82f6': 'Mavi', '#6366f1': 'Indigo', '#a855f7': 'Mor', '#ec4899': 'Pembe',
};

/**
 * Yeni UX felsefesi (2026-06):
 * - "Aktif tip" kavramı atama için kaldırıldı — kafa karıştırıcıydı.
 * - Akış: DXF'ten kontür seç → altta "Renk seç + Ata" paneli → renk seç → Ata.
 * - Atama her zaman yeni taş tipi oluşturur (Taş 1, Taş 2, ...).
 * - Mevcut taş tipleri üstte kart listesi — düzenle/sil.
 * - "Mevcut tipe ekle" opsiyonel: kart üzerindeki + butonu (hover'da görünür).
 */
export default function StoneTypePanel() {
  const {
    stoneTypes,
    activeStoneTypeId,
    setActiveStoneTypeId,
    addStoneType,
    removeStoneType,
    updateStoneType,
    assignContoursToType,
    unassignContours,
  } = usePickPlace();
  const { selectedObjectsSet, clearSelection } = useSelection();

  // Atama paneli durumu
  const [assignColor, setAssignColor] = useState<string>(PRESET_COLORS[0]);
  const [assignName, setAssignName] = useState<string>('');

  // Düzenleme durumu
  const [editingStoneId, setEditingStoneId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editThickness, setEditThickness] = useState('2');

  const totalSelected = selectedObjectsSet.size;

  // Bir sonraki taş numarası
  const nextStoneNum = useMemo(() => stoneTypes.length + 1, [stoneTypes.length]);

  // Önerilen isim (kullanıcı boş bırakırsa)
  const suggestedName = useMemo(() => {
    if (assignName.trim()) return assignName.trim();
    return `Taş ${nextStoneNum}`;
  }, [assignName, nextStoneNum]);

  const startEdit = useCallback((stone: StoneType) => {
    setEditingStoneId(stone.id);
    setEditName(stone.name);
    setEditColor(stone.color);
    setEditThickness(String(stone.thickness ?? 2));
  }, []);

  const saveEdit = useCallback((id: string) => {
    if (!editName.trim()) return;
    const t = parseFloat(editThickness.replace(',', '.'));
    updateStoneType(id, {
      name: editName,
      color: editColor,
      thickness: Number.isFinite(t) ? t : 2,
    });
    setEditingStoneId(null);
  }, [editName, editColor, editThickness, updateStoneType]);

  /**
   * Ana aksiyon: seçili kontürleri yeni taş tipi olarak ata.
   * Renk + isim → yeni StoneType oluştur → kontürleri bağla → seçimi temizle.
   */
  const handleAssign = useCallback(() => {
    if (totalSelected === 0) return;
    const handles: string[] = [];
    selectedObjectsSet.forEach((obj: any) => {
      const handle = obj.userData?.handle || obj.uuid;
      if (handle) handles.push(handle);
    });
    const id = `stone_${Date.now()}`;
    addStoneType({
      id,
      name: suggestedName,
      color: assignColor,
      contourIds: [],
      thickness: 2.0,
    });
    assignContoursToType(id, handles);
    clearSelection();
    // Sonraki atama için bir sonraki renk
    setAssignColor(PRESET_COLORS[stoneTypes.length % PRESET_COLORS.length]);
    setAssignName('');
  }, [
    totalSelected, selectedObjectsSet, suggestedName, assignColor,
    addStoneType, assignContoursToType, clearSelection, stoneTypes.length,
  ]);

  /**
   * Opsiyonel: seçili kontürleri mevcut bir taş tipine ekle (karttaki +).
   */
  const handleAddToExisting = useCallback((stoneId: string) => {
    if (totalSelected === 0) return;
    const handles: string[] = [];
    selectedObjectsSet.forEach((obj: any) => {
      const handle = obj.userData?.handle || obj.uuid;
      if (handle) handles.push(handle);
    });
    assignContoursToType(stoneId, handles);
    clearSelection();
  }, [totalSelected, selectedObjectsSet, assignContoursToType, clearSelection]);

  const handleUnassignContours = useCallback(() => {
    if (totalSelected === 0) return;
    const handles: string[] = [];
    selectedObjectsSet.forEach((obj: any) => {
      const handle = obj.userData?.handle || obj.uuid;
      if (handle) handles.push(handle);
    });
    unassignContours(handles);
    clearSelection();
  }, [totalSelected, selectedObjectsSet, unassignContours, clearSelection]);

  return (
    <div className="flex flex-col bg-background/50 h-full">
      {/* Başlık */}
      <div className="flex items-center gap-1.5 mb-2">
        <Tag className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold">Taş Tipleri</h2>
        {stoneTypes.length > 0 && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {stoneTypes.length} tip
          </span>
        )}
      </div>

      {/* Mevcut taş tipleri listesi */}
      {stoneTypes.length === 0 ? (
        <div className="text-center p-4 border border-dashed rounded-lg text-muted-foreground mb-3">
          <Gem className="w-6 h-6 mb-1.5 opacity-40 mx-auto" />
          <p className="text-sm">Henüz taş tipi yok.</p>
          <p className="text-[11px] mt-1 opacity-70">
            DXF'ten kontür seçin, alttan renk belirleyip atayın.
          </p>
        </div>
      ) : (
        <div className="flex-1 space-y-1.5 overflow-y-auto min-h-0 mb-2">
          {stoneTypes.map((stone: StoneType) => {
            const isActive = activeStoneTypeId === stone.id;
            const isEditing = editingStoneId === stone.id;

            if (isEditing) {
              return (
                <div key={stone.id} className="bg-muted/50 p-3 rounded-lg border border-primary">
                  <div className="space-y-2">
                    <Input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-8 text-sm"
                      placeholder="Taş adı"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(stone.id);
                        if (e.key === 'Escape') setEditingStoneId(null);
                      }}
                    />
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Label className="text-[10px] text-muted-foreground flex items-center gap-1 shrink-0">
                        <PaintBucket className="w-3 h-3" /> Renk
                      </Label>
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setEditColor(c)}
                          className={`w-5 h-5 rounded-full border-2 transition-transform ${editColor === c ? 'border-foreground scale-110' : 'border-transparent hover:scale-110'}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-[10px] text-muted-foreground shrink-0">Kalınlık</Label>
                      <Input
                        className="h-7 text-xs w-20"
                        value={editThickness}
                        onChange={(e) => setEditThickness(e.target.value)}
                        inputMode="decimal"
                      />
                      <span className="text-[10px] text-muted-foreground">mm</span>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setEditingStoneId(null)}>
                        İptal
                      </Button>
                      <Button size="sm" onClick={() => saveEdit(stone.id)} disabled={!editName.trim()}>
                        Kaydet
                      </Button>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={stone.id}
                className={`group flex items-center gap-2.5 px-2.5 py-2 rounded-lg border transition-all ${
                  isActive
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-border/60 hover:border-primary/30 bg-card'
                }`}
              >
                {/* Renk noktası */}
                <div
                  className="w-3.5 h-3.5 rounded-full shrink-0 ring-1 ring-black/10"
                  style={{ backgroundColor: stone.color }}
                />

                {/* İsim + kontur sayısı */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{stone.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {stone.contourIds.length} kontur
                    {stone.thickness ? ` · ${stone.thickness}mm` : ''}
                  </div>
                </div>

                {/* Mevcut tipe ekle (seçili kontür varsa, hover'da) */}
                {totalSelected > 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-primary hover:bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); handleAddToExisting(stone.id); }}
                    title={`${totalSelected} kontürü bu tipe ekle`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                )}

                {/* Düzenle */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10"
                  onClick={(e) => { e.stopPropagation(); startEdit(stone); }}
                >
                  <Edit2 className="w-3 h-3" />
                </Button>

                {/* Sil */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); removeStoneType(stone.id); }}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* === Atama paneli (alt, sticky) === */}
      {totalSelected > 0 ? (
        <div className="sticky bottom-0 bg-background/95 backdrop-blur border border-border rounded-lg p-3 shadow-lg space-y-2.5">
          {/* Seçili kontür sayısı */}
          <div className="flex items-center gap-2 text-xs">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            <span className="font-medium">{totalSelected} kontür seçildi</span>
          </div>

          {/* Renk seçici */}
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1.5 block">
              Taş rengi
            </Label>
            <div className="flex gap-1.5 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAssignColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    assignColor === c
                      ? 'border-foreground scale-110 ring-2 ring-primary/30'
                      : 'border-transparent hover:scale-110'
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`${COLOR_NAMES[c] ?? c} rengini seç`}
                />
              ))}
            </div>
          </div>

          {/* İsim (opsiyonel, otomatik önerilir) */}
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1 block">
              Taş adı <span className="opacity-60">(opsiyonel)</span>
            </Label>
            <Input
              value={assignName}
              onChange={(e) => setAssignName(e.target.value)}
              placeholder={suggestedName}
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAssign();
              }}
            />
          </div>

          {/* Ana aksiyon: Ata */}
          <Button
            size="sm"
            className="w-full h-10 text-sm font-semibold gap-1.5"
            onClick={handleAssign}
          >
            <CheckCircle2 className="w-4 h-4" />
            {totalSelected} kontürü «{suggestedName}» olarak ata
          </Button>

          {/* Kaldır (opsiyonel) */}
          <Button
            size="sm"
            variant="ghost"
            className="w-full h-7 text-[11px] text-muted-foreground"
            onClick={handleUnassignContours}
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Seçili kontürleri geri al
          </Button>
        </div>
      ) : (
        /* Kontür seçilmediğinde ipucu */
        <div className="sticky bottom-0 bg-muted/20 border border-dashed border-border rounded-lg p-3 text-center">
          <p className="text-[11px] text-muted-foreground">
            DXF üzerinde kontür seçin → buradan renk belirleyip atayın
          </p>
        </div>
      )}
    </div>
  );
}
