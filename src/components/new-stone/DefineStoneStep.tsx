'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  createDatasetStone,
  listDatasetStones,
  type DatasetStoneSummary,
} from '@/lib/runtimeClient';
import DeleteSessionButton from './DeleteSessionButton';

interface Props {
  onCreated: (info: {
    stoneId: string;
    name: string;
    isSymmetric: boolean;
  }) => void;
}

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_\-]/g, '')
    .slice(0, 64);
}

export default function DefineStoneStep({ onCreated }: Props) {
  const [name, setName] = useState('');
  const [stoneId, setStoneId] = useState('');
  const [autoId, setAutoId] = useState(true);
  const [isSymmetric, setIsSymmetric] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<DatasetStoneSummary[]>([]);

  const refreshExisting = async () => {
    try {
      const res = await listDatasetStones();
      setExisting(res.stones);
    } catch {
      setExisting([]);
    }
  };

  useEffect(() => {
    void refreshExisting();
  }, []);

  const handleNameChange = (v: string) => {
    setName(v);
    if (autoId) setStoneId(slugify(v));
  };

  const handleSubmit = async () => {
    setError(null);
    const sid = (autoId ? slugify(name) : stoneId.trim()) || slugify(name);
    if (!sid) {
      setError('Taş adı veya kimlik gerekli.');
      return;
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_\-]{0,63}$/.test(sid)) {
      setError('Kimlik harf/rakam ile başlamalı (a-z, 0-9, _, -).');
      return;
    }
    setBusy(true);
    try {
      await createDatasetStone({
        stone_id: sid,
        name: name.trim() || sid,
        is_symmetric: isSymmetric,
      });
      onCreated({
        stoneId: sid,
        name: name.trim() || sid,
        isSymmetric,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const resume = (s: DatasetStoneSummary) => {
    onCreated({
      stoneId: s.stone_id,
      name: s.name || s.stone_id,
      isSymmetric: s.is_symmetric,
    });
  };

  return (
    <div className="max-w-md mx-auto space-y-5 py-6 px-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Yeni taş tanımla</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Taşa bir isim ver. Sonraki adımda kameradan kare alıp kontürlere
          Düz / Ters etiketi yapıştıracaksın.
        </p>
      </div>

      {existing.length > 0 && (
        <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
          <div className="text-[11px] font-medium text-muted-foreground">
            Yarım kalan session&apos;lar — devam et veya sil
          </div>
          <ul className="space-y-1.5 max-h-40 overflow-y-auto">
            {existing.map((s) => (
              <li
                key={s.stone_id}
                className="flex items-center gap-2 rounded-md bg-background/60 px-2 py-1.5"
              >
                <button
                  type="button"
                  className="flex-1 min-w-0 text-left"
                  onClick={() => resume(s)}
                >
                  <div className="text-xs font-medium truncate">{s.name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono truncate">
                    {s.stone_id}
                  </div>
                </button>
                <Badge variant="outline" className="text-[9px] shrink-0 border-emerald-500/30 text-emerald-300">
                  {s.true}D
                </Badge>
                <Badge variant="outline" className="text-[9px] shrink-0 border-red-500/30 text-red-300">
                  {s.false}T
                </Badge>
                <DeleteSessionButton
                  stoneId={s.stone_id}
                  stoneName={s.name}
                  onDeleted={() => void refreshExisting()}
                  size="sm"
                  variant="ghost"
                  iconOnly
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-muted-foreground">
          Taş adı
        </label>
        <Input
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="Örn. Oval Siyah"
          className="h-9"
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-muted-foreground">
            Kimlik (klasör adı)
          </label>
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
            <Switch
              checked={autoId}
              onCheckedChange={(on) => {
                setAutoId(on);
                if (on) setStoneId(slugify(name));
              }}
              className="h-4 w-7 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-3"
            />
            Otomatik
          </label>
        </div>
        <Input
          value={stoneId}
          onChange={(e) => {
            setAutoId(false);
            setStoneId(e.target.value);
          }}
          disabled={autoId}
          placeholder="oval_siyah"
          className="h-9 font-mono text-xs"
        />
      </div>

      <label className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 cursor-pointer">
        <div>
          <div className="text-xs font-medium">Simetrik taş</div>
          <div className="text-[10px] text-muted-foreground">
            180° dönünce aynı görünen şekiller (daire, kare…)
          </div>
        </div>
        <Switch checked={isSymmetric} onCheckedChange={setIsSymmetric} />
      </label>

      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1.5">
          {error}
        </p>
      )}

      <Button
        className="w-full h-9"
        onClick={handleSubmit}
        disabled={busy || (!name.trim() && !stoneId.trim())}
      >
        {busy ? 'Oluşturuluyor…' : 'Devam — Veri topla'}
      </Button>
    </div>
  );
}
