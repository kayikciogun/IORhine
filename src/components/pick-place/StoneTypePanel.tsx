'use client';

import React, { useState, useCallback } from 'react';
import { usePickPlace } from '../../contexts/PickPlaceContext';
import { useSelection } from '../dxf-viewer/useSelection';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Plus, Trash2, CheckCircle2, PaintBucket, Tag, Edit2, X } from 'lucide-react';
import { StoneType } from '@/types/pickplace';

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
  '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
];

export default function StoneTypePanel() {
  const { stoneTypes, activeStoneTypeId, setActiveStoneTypeId, addStoneType, removeStoneType, updateStoneType, assignContoursToType, reorderStoneTypes, unassignContours } = usePickPlace();
  const { selectedObjectsSet, clearSelection } = useSelection();

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);

  const [editingStoneId, setEditingStoneId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editThickness, setEditThickness] = useState('2');

  const totalSelected = selectedObjectsSet.size;

  const handleAddNew = useCallback(() => {
    if (!newName.trim()) return;
    addStoneType({
      id: `stone_${Date.now()}`,
      name: newName,
      color: newColor,
      contourIds: [],
      thickness: 2.0,
    });
    setIsAdding(false);
    setNewName('');
    setNewColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]);
  }, [newName, newColor, addStoneType]);

  const startEdit = useCallback((stone: StoneType) => {
    setEditingStoneId(stone.id);
    setEditName(stone.name);
    setEditColor(stone.color);
    setEditThickness(String(stone.thickness ?? 2));
  }, []);

  const saveEdit = useCallback((id: string) => {
    if (!editName.trim()) return;
    const t = parseFloat(editThickness.replace(',', '.'));
    updateStoneType(id, { name: editName, color: editColor, thickness: Number.isFinite(t) ? t : 2 });
    setEditingStoneId(null);
  }, [editName, editColor, editThickness, updateStoneType]);

  const handleAssignContours = useCallback(() => {
    if (!activeStoneTypeId || totalSelected === 0) return;
    const handles: string[] = [];
    selectedObjectsSet.forEach((obj: any) => {
      const handle = obj.userData?.handle || obj.uuid;
      if (handle) handles.push(handle);
    });
    assignContoursToType(activeStoneTypeId, handles);
    clearSelection();
  }, [activeStoneTypeId, totalSelected, selectedObjectsSet, assignContoursToType, clearSelection]);

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
    <div className="flex flex-col bg-background/50">
      <div className="flex justify-between items-center mb-2.5">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <Tag className="w-4 h-4 text-primary" />
          Taş Tipleri
        </h2>
        {!isAdding && (
          <Button variant="ghost" size="sm" onClick={() => setIsAdding(true)} className="h-7 text-xs">
            <Plus className="w-3.5 h-3.5 mr-1" /> Yeni Tip
          </Button>
        )}
      </div>

      {isAdding && (
        <div className="bg-muted/40 p-3 rounded-lg mb-3 border border-border">
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              placeholder="Örn: 4mm Kristal"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-8 text-sm flex-1"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddNew();
                if (e.key === 'Escape') setIsAdding(false);
              }}
            />
            <div className="flex gap-1">
              {PRESET_COLORS.slice(0, 5).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-transform ${newColor === c ? 'border-foreground scale-110' : 'border-transparent hover:scale-110'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <Button size="sm" className="h-8" onClick={handleAddNew} disabled={!newName.trim()}>
              Ekle
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsAdding(false)}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Seçili obje badge */}
      {totalSelected > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span className="font-medium">{totalSelected} obje seçildi</span>
          <span className="text-muted-foreground ml-auto">Atama icin bir tas tipi secin</span>
        </div>
      )}

      {stoneTypes.length === 0 && !isAdding ? (
        <div className="text-center p-4 border border-dashed rounded-lg text-muted-foreground w-full">
          <p className="text-sm">Henüz taş tipi eklenmemiş.</p>
          <p className="text-[11px] mt-1 opacity-70">Dxf üzerindeki konturleri boyamak icin once bir tas tipi olusturun.</p>
        </div>
      ) : (
        <div className="flex-1 space-y-2">
          {stoneTypes.map((stone: StoneType, index: number) => {
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
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(stone.id);
                        if (e.key === 'Escape') setEditingStoneId(null);
                      }}
                    />
                    <div className="flex items-center gap-1.5">
                      <Label className="text-[10px] text-muted-foreground flex items-center gap-1 shrink-0">
                        <PaintBucket className="w-3 h-3" /> Rengi sec
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
                      <Label className="text-[10px] text-muted-foreground shrink-0">Kalınlık (mm)</Label>
                      <Input
                        className="h-7 text-xs w-20"
                        value={editThickness}
                        onChange={(e) => setEditThickness(e.target.value)}
                        inputMode="decimal"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setEditingStoneId(null)}>Iptal</Button>
                      <Button size="sm" onClick={() => saveEdit(stone.id)} disabled={!editName.trim()}>Kaydet</Button>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={stone.id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all cursor-pointer select-none ${
                  isActive ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border hover:border-primary/40 bg-card'
                }`}
                onClick={() => setActiveStoneTypeId(isActive ? null : stone.id)}                // P3-F42: keyboard accessibility — div onClick yerine tabIndex + role + onKeyDown
                tabIndex={0}
                role="button"
                aria-pressed={isActive}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveStoneTypeId(isActive ? null : stone.id);
                  }
                }}              >
                {/* Renk noktasi */}
                <div
                  className={`w-4 h-4 rounded-full shadow-sm shrink-0 ${isActive ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
                  style={{ backgroundColor: stone.color }}
                />

                {/* Isim + sayi */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{stone.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {stone.contourIds.length} atanmış kontur
                  </div>
                </div>

                {/* Actionlar */}
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10"
                    onClick={(e) => { e.stopPropagation(); startEdit(stone); }}
                  >
                    <Edit2 className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); removeStoneType(stone.id); }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            );
          })}

          {/* Aktif tip icin atama butonlari (tüm tipler altinda degil, aktif secildiiginde fixed gibi) */}
          {activeStoneTypeId && stoneTypes.find((s) => s.id === activeStoneTypeId) && (
            <div className="sticky bottom-0 bg-background/95 backdrop-blur border border-border rounded-lg p-2.5 mt-2 shadow-sm">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 h-8 text-xs"
                  variant={totalSelected > 0 ? 'default' : 'secondary'}
                  onClick={handleAssignContours}
                  disabled={totalSelected === 0}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                  {totalSelected > 0 ? `${totalSelected} konturu ata` : 'Kontur ata'}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1 h-8 text-xs"
                  onClick={handleUnassignContours}
                  disabled={totalSelected === 0}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  Kaldır
                </Button>
              </div>
              {totalSelected === 0 && (
                <p className="text-[10px] text-muted-foreground text-center mt-1.5">
                  Atama icin DXF uzerinden kontur secin.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
