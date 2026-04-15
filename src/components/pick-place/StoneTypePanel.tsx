'use client';

import React, { useState } from 'react';
import { usePickPlace } from '../../contexts/PickPlaceContext';
import { useSelection } from '../dxf-viewer/useSelection';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Plus, Trash2, CheckCircle2, PaintBucket, Tag, ArrowUp, ArrowDown, Edit2 } from 'lucide-react';
import { StoneType } from '@/types/pickplace';

// Gelişmiş renk paleti (Tailwind / Modern Web)
const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', 
  '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'
];

export default function StoneTypePanel() {
  const { stoneTypes, activeStoneTypeId, setActiveStoneTypeId, addStoneType, removeStoneType, updateStoneType, assignContoursToType, pickPlaceConfig } = usePickPlace();
  const { selectedObjectsSet, clearSelection } = useSelection();

  // Yeni tip eklerken kullanılan state
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [newPickZ, setNewPickZ] = useState<number>(5);
  const [newPlaceZ, setNewPlaceZ] = useState<number>(5);

  const handleAddNew = () => {
    if (!newName.trim()) return;
    
    addStoneType({
      id: `stone_${Date.now()}`,
      name: newName,
      color: newColor,
      pickZOffset: newPickZ,
      placeZOffset: newPlaceZ,
      contourIds: []
    });
    
    setIsAdding(false);
    setNewName('');
    setNewPickZ(pickPlaceConfig.defaultStonePickZMm);
    setNewPlaceZ(pickPlaceConfig.defaultStonePlaceZMm);
    setNewColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]);
  };

  const [editingStoneId, setEditingStoneId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editPickZ, setEditPickZ] = useState(0);
  const [editPlaceZ, setEditPlaceZ] = useState(0);

  const startEdit = (stone: StoneType) => {
    setEditingStoneId(stone.id);
    setEditName(stone.name);
    setEditColor(stone.color);
    setEditPickZ(stone.pickZOffset);
    setEditPlaceZ(stone.placeZOffset);
  };

  const saveEdit = (id: string) => {
    if (!editName.trim()) return;
    updateStoneType(id, {
      name: editName,
      color: editColor,
      pickZOffset: editPickZ,
      placeZOffset: editPlaceZ
    });
    setEditingStoneId(null);
  };

  const handleAssignContours = () => {
    if (!activeStoneTypeId || selectedObjectsSet.size === 0) return;
    
    // Seçili objelerin handle'larını id olarak al
    const handlesToAssign: string[] = [];
    selectedObjectsSet.forEach((obj: any) => {
      const handle = obj.userData?.handle || obj.uuid;
      if (handle) handlesToAssign.push(handle);
    });

    assignContoursToType(activeStoneTypeId, handlesToAssign);
    
    // Atama bittikten sonra seçimi temizle ki yeni renkler ekranda hemen görünsün
    clearSelection();
  };

  const { unassignContours, reorderStoneTypes } = usePickPlace();

  const handleUnassignContours = () => {
    if (selectedObjectsSet.size === 0) return;
    const handlesToUnassign: string[] = [];
    selectedObjectsSet.forEach((obj: any) => {
      const handle = obj.userData?.handle || obj.uuid;
      if (handle) handlesToUnassign.push(handle);
    });
    unassignContours(handlesToUnassign);
    clearSelection();
  };

  return (
    <div className="flex flex-col bg-background/50">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-base font-semibold flex items-center gap-1.5">
          <Tag className="w-4 h-4 text-primary" />
          Taş Tipleri
        </h2>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => {
            if (!isAdding) {
              setNewPickZ(pickPlaceConfig.defaultStonePickZMm);
              setNewPlaceZ(pickPlaceConfig.defaultStonePlaceZMm);
            }
            setIsAdding(!isAdding);
          }}
          className="h-8"
        >
          <Plus className="w-4 h-4 mr-1" /> Yeni Tip
        </Button>
      </div>

      {isAdding && (
        <div className="bg-muted/50 p-4 rounded-lg mb-4 border border-border animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">İsim / Açıklama</Label>
              <Input 
                autoFocus
                placeholder="Örn: 4mm Kristal" 
                value={newName} 
                onChange={e => setNewName(e.target.value)}
                className="h-8 mt-1"
              />
            </div>
            
            <div>
              <Label className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                <PaintBucket className="w-3 h-3" /> Görüntüleme Rengi
              </Label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewColor(c)}
                    className={`w-6 h-6 rounded-full border-2 transition-transform ${newColor === c ? 'border-foreground scale-125' : 'border-transparent hover:scale-110'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground leading-snug">
              Varsayılanlar G-Code ayarlarındaki «Taş tipi varsayılan Z» değerlerinden gelir (tablo +5 mm vb.); burada tek tip için değiştirebilirsiniz.
            </p>

            <div className="flex gap-2">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">Z-Pick (Alma)</Label>
                <div className="relative mt-1">
                  <Input 
                    type="number" step="0.1" value={newPickZ}
                    onChange={e => setNewPickZ(parseFloat(e.target.value))}
                    className="h-8 text-right pr-6" 
                  />
                  <span className="absolute right-2 top-1.5 text-xs text-muted-foreground">mm</span>
                </div>
              </div>
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">Z-Place (Koyma)</Label>
                <div className="relative mt-1">
                  <Input 
                    type="number" step="0.1" value={newPlaceZ}
                    onChange={e => setNewPlaceZ(parseFloat(e.target.value))}
                    className="h-8 text-right pr-6" 
                  />
                  <span className="absolute right-2 top-1.5 text-xs text-muted-foreground">mm</span>
                </div>
              </div>
            </div>
            
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" size="sm" onClick={() => setIsAdding(false)}>İptal</Button>
              <Button size="sm" onClick={handleAddNew} disabled={!newName.trim()}>Ekle</Button>
            </div>
          </div>
        </div>
      )}

      {stoneTypes.length === 0 && !isAdding ? (
        <div className="text-center p-4 m-auto border border-dashed rounded-lg text-muted-foreground w-full">
          <p className="text-sm">Henüz taş tipi eklenmemiş.</p>
          <p className="text-[11px] mt-1 opacity-70">DXF üzerindeki kontürleri boyamak için önce bir taş tipi oluşturun.</p>
        </div>
      ) : (
        <div 
          className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar"
          onClick={() => setActiveStoneTypeId(null)}
        >
          {stoneTypes.map((stone: StoneType, index: number) => {
            const isActive = activeStoneTypeId === stone.id;
            const isEditing = editingStoneId === stone.id;

            if (isEditing) {
              return (
                <div key={stone.id} className="bg-muted/50 p-4 rounded-lg mb-2 border border-primary">
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">İsim / Açıklama</Label>
                      <Input 
                        autoFocus
                        value={editName} 
                        onChange={e => setEditName(e.target.value)}
                        className="h-8 mt-1"
                      />
                    </div>
                    
                    <div>
                      <Label className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                        <PaintBucket className="w-3 h-3" /> Görüntüleme Rengi
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {PRESET_COLORS.map(c => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setEditColor(c)}
                            className={`w-6 h-6 rounded-full border-2 transition-transform ${editColor === c ? 'border-foreground scale-125' : 'border-transparent hover:scale-110'}`}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Label className="text-xs text-muted-foreground">Z-Pick</Label>
                        <Input 
                          type="number" step="0.1" value={editPickZ}
                          onChange={e => setEditPickZ(parseFloat(e.target.value))}
                          className="h-8 mt-1 text-right" 
                        />
                      </div>
                      <div className="flex-1">
                        <Label className="text-xs text-muted-foreground">Z-Place</Label>
                        <Input 
                          type="number" step="0.1" value={editPlaceZ}
                          onChange={e => setEditPlaceZ(parseFloat(e.target.value))}
                          className="h-8 mt-1 text-right" 
                        />
                      </div>
                    </div>
                    
                    <div className="flex justify-end gap-2 mt-2">
                      <Button variant="ghost" size="sm" onClick={() => setEditingStoneId(null)}>İptal</Button>
                      <Button size="sm" onClick={() => saveEdit(stone.id)} disabled={!editName.trim()}>Kaydet</Button>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div 
                key={stone.id} 
                className={`flex flex-col p-3 rounded-lg border-l-4 border transition-colors cursor-pointer group ${isActive ? 'border-primary' : 'border-border hover:border-l-4'}`}
                style={{
                  borderLeftColor: stone.color,
                  backgroundColor: isActive
                    ? `${stone.color}22`
                    : `${stone.color}0d`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveStoneTypeId(isActive ? null : stone.id);
                }}
              >
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-4 w-4 p-0 text-muted-foreground hover:text-foreground"
                        disabled={index === 0}
                        onClick={(e) => { e.stopPropagation(); reorderStoneTypes(index, index - 1); }}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-4 w-4 p-0 text-muted-foreground hover:text-foreground"
                        disabled={index === stoneTypes.length - 1}
                        onClick={(e) => { e.stopPropagation(); reorderStoneTypes(index, index + 1); }}
                      >
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                    </div>
                    <div 
                      className={`w-4 h-4 rounded-full shadow-sm ${isActive ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
                      style={{ backgroundColor: stone.color }}
                    />
                    <span className="font-medium text-sm">{stone.name}</span>
                  </div>
                  
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6 text-muted-foreground hover:text-primary hover:bg-primary/10"
                      onClick={(e) => { e.stopPropagation(); startEdit(stone); }}
                    >
                      <Edit2 className="w-3 h-3" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); removeStoneType(stone.id); }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                
                <div className="mt-2 flex gap-4 text-xs text-muted-foreground ml-11">
                  <span title="Pick Z Offset">Z↓ {stone.pickZOffset}mm</span>
                  <span title="Place Z Offset">Z↑ {stone.placeZOffset}mm</span>
                  <span>|</span>
                  <span className="font-medium text-foreground">{stone.contourIds.length} Atanmış</span>
                </div>

                {/* Atama Kontrolleri */}
                {isActive && (
                  <div className="mt-3 ml-7 pt-3 border-t border-border/50 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="flex gap-2">
                       <Button 
                         size="sm" 
                         className={`flex-1 h-8 text-xs font-medium transition-all ${selectedObjectsSet.size > 0 ? '' : 'opacity-50'}`}
                         variant={selectedObjectsSet.size > 0 ? "default" : "secondary"}
                         onClick={(e) => { e.stopPropagation(); handleAssignContours(); }}
                         disabled={selectedObjectsSet.size === 0}
                       >
                         <CheckCircle2 className="w-3 h-3 mr-1.5" />
                         {selectedObjectsSet.size > 0 ? `Ata (${selectedObjectsSet.size})` : 'Ata'}
                       </Button>
                       
                       <Button 
                         size="sm" 
                         className={`flex-1 h-8 text-xs font-medium transition-all ${selectedObjectsSet.size > 0 ? '' : 'opacity-50'}`}
                         variant="destructive"
                         onClick={(e) => { e.stopPropagation(); handleUnassignContours(); }}
                         disabled={selectedObjectsSet.size === 0}
                       >
                         <Trash2 className="w-3 h-3 mr-1.5" />
                         Çıkar
                       </Button>
                    </div>
                    {selectedObjectsSet.size === 0 && (
                      <p className="text-[10px] text-muted-foreground text-center mt-2">İşlem yapmak için DXF üzerinden obje seçin.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
