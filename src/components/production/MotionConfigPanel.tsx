'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getMotionConfig, updateMotionConfig } from '@/lib/runtimeClient';
import type { MotionConfig } from '@/types/runtime';

interface Props {
  disabled?: boolean;
  onSaved?: (config: MotionConfig) => void;
}

const DEFAULT_CONFIG: MotionConfig = {
  rotation_axis: 'A',
  safe_z: 5,
  pick_z: 0.5,
  glue_z: 0.5,
  place_z: 0.5,
  xy_feed: 3000,
  z_feed: 600,
  rotation_feed: 3600,
  vacuum_on_dwell_s: 0.15,
  vacuum_off_dwell_s: 0.15,
  glue_dwell_s: 0.5,
};

function toNumber(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export default function MotionConfigPanel({ disabled, onSaved }: Props) {
  const [form, setForm] = useState<Record<keyof MotionConfig, string>>({
    rotation_axis: DEFAULT_CONFIG.rotation_axis,
    safe_z: String(DEFAULT_CONFIG.safe_z),
    pick_z: String(DEFAULT_CONFIG.pick_z),
    glue_z: String(DEFAULT_CONFIG.glue_z),
    place_z: String(DEFAULT_CONFIG.place_z),
    xy_feed: String(DEFAULT_CONFIG.xy_feed),
    z_feed: String(DEFAULT_CONFIG.z_feed),
    rotation_feed: String(DEFAULT_CONFIG.rotation_feed),
    vacuum_on_dwell_s: String(DEFAULT_CONFIG.vacuum_on_dwell_s),
    vacuum_off_dwell_s: String(DEFAULT_CONFIG.vacuum_off_dwell_s),
    glue_dwell_s: String(DEFAULT_CONFIG.glue_dwell_s),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const setField = (key: keyof MotionConfig, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const load = useCallback(async () => {
    setError(null);
    try {
      const cfg = await getMotionConfig();
      setForm({
        rotation_axis: cfg.rotation_axis,
        safe_z: String(cfg.safe_z),
        pick_z: String(cfg.pick_z),
        glue_z: String(cfg.glue_z),
        place_z: String(cfg.place_z),
        xy_feed: String(cfg.xy_feed),
        z_feed: String(cfg.z_feed),
        rotation_feed: String(cfg.rotation_feed),
        vacuum_on_dwell_s: String(cfg.vacuum_on_dwell_s),
        vacuum_off_dwell_s: String(cfg.vacuum_off_dwell_s),
        glue_dwell_s: String(cfg.glue_dwell_s),
      });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setMsg(null);
    const payload: MotionConfig = {
      rotation_axis: form.rotation_axis === 'E' ? 'E' : 'A',
      safe_z: toNumber(form.safe_z, DEFAULT_CONFIG.safe_z),
      pick_z: toNumber(form.pick_z, DEFAULT_CONFIG.pick_z),
      glue_z: toNumber(form.glue_z, DEFAULT_CONFIG.glue_z),
      place_z: toNumber(form.place_z, DEFAULT_CONFIG.place_z),
      xy_feed: toNumber(form.xy_feed, DEFAULT_CONFIG.xy_feed),
      z_feed: toNumber(form.z_feed, DEFAULT_CONFIG.z_feed),
      rotation_feed: toNumber(form.rotation_feed, DEFAULT_CONFIG.rotation_feed),
      vacuum_on_dwell_s: toNumber(form.vacuum_on_dwell_s, DEFAULT_CONFIG.vacuum_on_dwell_s),
      vacuum_off_dwell_s: toNumber(form.vacuum_off_dwell_s, DEFAULT_CONFIG.vacuum_off_dwell_s),
      glue_dwell_s: toNumber(form.glue_dwell_s, DEFAULT_CONFIG.glue_dwell_s),
    };

    try {
      const { config } = await updateMotionConfig(payload);
      setMsg('Motion config kaydedildi');
      onSaved?.(config);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const numberField = (key: keyof MotionConfig, label: string) => (
    <div>
      <Label className="text-[10px]">{label}</Label>
      <Input
        className="h-7 text-xs"
        value={form[key]}
        onChange={(e) => setField(key, e.target.value)}
        inputMode="decimal"
        disabled={disabled || saving}
      />
    </div>
  );

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 p-2">
      <p className="text-[10px] font-medium text-foreground/80">Motion config</p>

      <div>
        <Label className="text-[10px]">C ekseni</Label>
        <Select
          value={form.rotation_axis}
          onValueChange={(value) => setField('rotation_axis', value)}
          disabled={disabled || saving}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="A">A axis</SelectItem>
            <SelectItem value="E">E axis</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {numberField('safe_z', 'Safe Z')}
        {numberField('pick_z', 'Pick Z')}
        {numberField('glue_z', 'Glue Z')}
        {numberField('place_z', 'Place Z')}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {numberField('xy_feed', 'XY feed')}
        {numberField('z_feed', 'Z feed')}
        {numberField('rotation_feed', 'C feed')}
        {numberField('glue_dwell_s', 'Glue dwell')}
        {numberField('vacuum_on_dwell_s', 'Vac on dwell')}
        {numberField('vacuum_off_dwell_s', 'Vac off dwell')}
      </div>

      <Button
        type="button"
        size="sm"
        className="h-7 text-[10px] w-full"
        onClick={save}
        disabled={disabled || saving}
      >
        {saving ? 'Kaydediliyor…' : 'Motion config kaydet'}
      </Button>

      <p className="text-[10px] text-muted-foreground leading-snug">
        Kaydetmek mevcut motion bağlantısını sıfırlar; yeni değerler sonraki Job yükle/başlat akışında kullanılır.
      </p>
      {msg && <p className="text-[10px] text-muted-foreground">{msg}</p>}
      {error && <p className="text-[10px] text-destructive leading-snug">{error}</p>}
    </div>
  );
}
