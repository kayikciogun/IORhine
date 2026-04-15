/**
 * Mach3 / Marlin Pick & Place Post-Processor
 *
 * Z (touch probe yok — elle ölçüm):
 *  - Marlin: PICK Z = marlinStripZMm + stone.pickZOffset, PLACE Z = marlinFabricZMm + stone.placeZOffset
 *  - Standart CNC: #500 / #501 strip ve kumaş yüzey referansı (kontrolcüde siz ayarlarsınız)
 *    PICK Z = [#500 + pickZOffset], PLACE Z = [#501 + placeZOffset]
 */

import { PickPlaceConfig, StoneType, PlacementOrder } from '@/types/pickplace';
import { calcAngleFromSceneObject } from '@/Utils/contourAngle';

export interface GcodeResult {
  gcode: string;
  totalStones: number;
  estimatedSeconds: number;
  lines: number;
}

// ─── Yardımcılar ──────────────────────────────────────────────────────────

const fmt  = (n: number, d = 3) => n.toFixed(d);
/** Üretilen G-code’daki tüm F (mm/dk) — tek değer */
const GCODE_FEED_MM_MIN = 10000;
const fAll = () => `F${fmt(GCODE_FEED_MM_MIN, 0)}`;
const safeZ = (cfg: PickPlaceConfig) => `G0 Z${fmt(cfg.safeZ)} ${fAll()}`;

/** Marlin + G92 sonrası: strip/DXF mm → G92 sonrası mantıksal XY (G92 noktasının çizim koordinatı çıkarılır). */
export function marlinWorkXY(cfg: PickPlaceConfig, dxfX: number, dxfY: number): { x: number; y: number } {
  if (cfg.firmware !== 'marlin') return { x: dxfX, y: dxfY };
  return {
    x: dxfX - cfg.marlinDxfAtG92X,
    y: dxfY - cfg.marlinDxfAtG92Y,
  };
}

// ─── Ana G-code üretici ───────────────────────────────────────────────────

export class Mach3PostProcessor {
  private cfg: PickPlaceConfig;
  private lines: string[] = [];
  private stoneCount = 0;

  constructor(cfg: PickPlaceConfig) {
    this.cfg = cfg;
  }

  private emit(...strs: string[]) { this.lines.push(...strs); }
  private cmt(t: string) { this.lines.push(`; ${t}`); }

  // Simulation mode: mock Z referans değerleri
  private mockStripZ: number | null = null;
  private mockFabricZ: number | null = null;

  enableSimulation(stripZ: number, fabricZ: number) {
    this.mockStripZ = stripZ;
    this.mockFabricZ = fabricZ;
  }
  disableSimulation() {
    this.mockStripZ = null;
    this.mockFabricZ = null;
  }

  // Z ifadesi: #500 (strip ref) + nozzle geometri farkı + taş tipi ofseti
  private pickZ(st: StoneType): string {
    const offset = st.pickZOffset;
    if (this.mockStripZ !== null) {
      return fmt(this.mockStripZ + offset);
    }
    if (this.cfg.firmware === 'marlin') {
      return fmt(this.cfg.marlinStripZMm + offset);
    }
    const sign = offset >= 0 ? '+' : '';
    return `[#500${sign}${fmt(offset)}]`;
  }

  private placeZ(st: StoneType): string {
    const offset = st.placeZOffset;
    if (this.mockFabricZ !== null) {
      return fmt(this.mockFabricZ + offset);
    }
    if (this.cfg.firmware === 'marlin') {
      return fmt(this.cfg.marlinFabricZMm + offset);
    }
    const sign = offset >= 0 ? '+' : '';
    return `[#501${sign}${fmt(offset)}]`;
  }

  private workXY(machineX: number, machineY: number): { x: number; y: number } {
    return marlinWorkXY(this.cfg, machineX, machineY);
  }

  private header(orders: PlacementOrder[]) {
    const { cfg } = this;
    const totalStones = orders.length;
    const isSim = this.mockStripZ !== null;
    const isMarlin = cfg.firmware === 'marlin';

    this.emit(
      '; ============================================================',
      '; IO-CAM Pick & Place — PLACEMENT',
      `; Üretim: ${new Date().toISOString()}`,
      `; Toplam taş: ${totalStones}`,
      isSim
        ? '; ⚠  SİMÜLASYON MODU'
        : isMarlin
        ? '; ⚠  Ender 3 (Marlin) modu'
        : '; ⚠  Standart CNC: #500 / #501 değerlerini kontrolcüde elle ayarlayın.',
      isSim
        ? `; Mock Z: Strip=${this.mockStripZ}mm, Fabric=${this.mockFabricZ}mm`
        : isMarlin
        ? '; Firmware: Marlin (E ekseni relative mode)'
        : '; ⚠  Standart CNC: #500 (strip Z) ve #501 (kumaş Z) kontrolcüde ayarlı olmalı.',
      '; ============================================================',
      '',
      '; ── Geometri özeti ──────────────────────────────────────────',
      ...(isSim
        ? [
            `; PICK/PLACE Z: simülasyon (sayısal mm)`,
          ]
        : isMarlin
          ? [
              `; Marlin PICK Z (mm) = marlinStripZMm(${fmt(cfg.marlinStripZMm)}) + taş pickZOffset`,
              `; Marlin PLACE Z (mm) = marlinFabricZMm(${fmt(cfg.marlinFabricZMm)}) + taş placeZOffset`,
            ]
          : [
              `; PICK  Z = [#500 + stone.pickZOffset]`,
              `; PLACE Z = [#501 + stone.placeZOffset]`,
            ]),
      ...(isMarlin
        ? [
            `; Marlin G92 öncesi makine (mm): X${fmt(cfg.marlinWorkspaceOriginX)} Y${fmt(cfg.marlinWorkspaceOriginY)}`,
            `; Aynı fiziksel noktanın DXF/strip koordinatı (mm): X${fmt(cfg.marlinDxfAtG92X)} Y${fmt(cfg.marlinDxfAtG92Y)} → G-code XY = DXF − bu değer`,
          ]
        : []),
      '',
      'G21 ; Metric',
      'G90 ; Absolute',
      ...(isMarlin ? [] : ['G17 ; XY plane']),
    );

    if (isMarlin) {
      this.emit(
        'G28 ; Tum eksenler home',
        safeZ(cfg),
        `G0 X${fmt(cfg.marlinWorkspaceOriginX)} Y${fmt(cfg.marlinWorkspaceOriginY)} ${fAll()}`,
        'G92 X0 Y0 ; Is parcasi XY orjini',
        'M83 ; E ekseni relative (Marlin)',
        safeZ(cfg),
        '',
        '; ============================================================',
      );
      return;
    }

    this.emit(
      `G0 Z${fmt(cfg.safeZ)} ${fAll()} ; Safe height`,
      '',
      '; ============================================================',
    );
  }

  /** Marlin: G4 S = saniye. Diğer: G4 P = milisaniye (FluidNC/Mach3 yaygın). */
  private dwell(seconds: number): string {
    if (this.cfg.firmware === 'marlin') {
      const s = Math.max(0, seconds);
      let t = fmt(s, 3);
      if (t.includes('.')) t = t.replace(/\.?0+$/, '');
      return `G4 S${t || '0'}`;
    }
    const ms = Math.round(seconds * 1000);
    return `G4 P${ms}`;
  }

  private singleStone(order: PlacementOrder, st: StoneType, n: number) {
    const { cfg } = this;
    const ax = cfg.rotationAxis;

    this.emit(
      '',
      `; ── Taş ${n} | ${st.name} | Pick(${fmt(order.pickX)}, ${fmt(order.pickY)}) → Place(${fmt(order.placeX)}, ${fmt(order.placeY)}) Açı:${fmt(order.placeAngle, 1)}° ──`,
    );

    // 1. Pick
    const pickW = this.workXY(order.pickX, order.pickY);
    this.emit(
      safeZ(cfg),
      `G0 X${fmt(pickW.x)} Y${fmt(pickW.y)} ${fAll()}`,
      `G1 Z${this.pickZ(st)} ${fAll()}`,
      cfg.vacuumOnCode,
    );
    if (cfg.vacuumOnDwell > 0) this.emit(`${this.dwell(cfg.vacuumOnDwell)} ; Vakum tut (${cfg.vacuumOnDwell}s)`);
    this.emit(safeZ(cfg));

    // 2. Döndür (Marlin + E: M83 iken G1 E açı kümülatif mm sayılır; M82 ile mutlak hedef)
    if (Math.abs(order.placeAngle) > 0.01) {
      if (cfg.firmware === 'marlin' && ax === 'E') {
        this.emit('M82 ; E mutlak (döndürme hedefi)');
        this.emit(`G1 E${fmt(order.placeAngle, 2)} ${fAll()} ; E hedefi (° yerine mm — mekanik eşlem size ait)`);
        this.emit('M83 ; E tekrar relative');
      } else {
        this.emit(`G1 ${ax}${fmt(order.placeAngle, 2)} ${fAll()} ; Döndür ${fmt(order.placeAngle, 1)}°`);
      }
    }

    // 3. Place
    const placeW = this.workXY(order.placeX, order.placeY);
    this.emit(
      `G0 X${fmt(placeW.x)} Y${fmt(placeW.y)} ${fAll()}`,
      `G1 Z${this.placeZ(st)} ${fAll()}`,
      cfg.vacuumOffCode,
    );
    if (cfg.vacuumOffDwell > 0) this.emit(`${this.dwell(cfg.vacuumOffDwell)} ; Vakum bekle (${cfg.vacuumOffDwell}s)`);
    this.emit(safeZ(cfg));

    // 4. Döndürme eksenini sıfırla
    if (Math.abs(order.placeAngle) > 0.01) {
      if (cfg.firmware === 'marlin' && ax === 'E') {
        this.emit('M82');
        this.emit(`G1 E0 ${fAll()} ; E sıfır`);
        this.emit('M83');
      } else {
        this.emit(`G1 ${ax}0 ${fAll()} ; Eksen sıfır`);
      }
    }

    this.stoneCount++;
  }

  private footer() {
    const { cfg } = this;
    const isMarlin = cfg.firmware === 'marlin';

    this.emit(
      '',
      `; ── Bitti | ${this.stoneCount} taş yerleştirildi ──`,
      safeZ(cfg),
      ...(isMarlin
        ? ['G28 X Y ; Z sabit, sadece XY home', 'M84 ; Motorları serbest bırak (Ender 3/Marlin)']
        : [`G0 X0 Y0 ${fAll()}`, 'M30']),
    );
  }

  generate(
    orders: PlacementOrder[],
    stoneTypeMap: Map<string, StoneType>,
  ): GcodeResult {
    this.lines = [];
    this.stoneCount = 0;

    this.header(orders);

    orders.forEach((order, i) => {
      const key = `${order.placeX.toFixed(3)}_${order.placeY.toFixed(3)}`;
      const st = stoneTypeMap.get(key);
      if (!st) {
        console.warn(`StoneType not found for placeX=${order.placeX}, placeY=${order.placeY}`);
        return;
      }
      this.singleStone(order, st, i + 1);
    });

    this.footer();

    const gcode = this.lines.join('\n');
    return {
      gcode,
      totalStones: this.stoneCount,
      estimatedSeconds: orders.length * 6,
      lines: this.lines.length,
    };
  }
}

// ─── Placement orders builder ─────────────────────────────────────────────

export function buildPlacementOrders(
  scene: any,
  stoneTypes: StoneType[],
  cfg: PickPlaceConfig,
): { orders: PlacementOrder[]; stoneTypeMap: Map<string, StoneType> } {
  const orders: PlacementOrder[] = [];
  const stoneTypeMap = new Map<string, StoneType>();
  let index = 0;

  for (const st of stoneTypes) {
    for (const handle of st.contourIds) {
      let obj: any = null;
      scene.traverse((o: any) => {
        if (o.userData?.handle === handle) obj = o;
      });
      if (!obj) continue;

      // DXF koordinatı (kumaş üzerindeki konum)
      const data = obj.userData?.data;
      let placeX = 0, placeY = 0;
      if (data?.center) {
        placeX = data.center.x;
        placeY = data.center.y;
      } else if (data?.vertices?.length) {
        let sx = 0, sy = 0;
        data.vertices.forEach((v: any) => { sx += v.x; sy += v.y; });
        placeX = sx / data.vertices.length;
        placeY = sy / data.vertices.length;
      }

      // Strip üzerindeki pick koordinatı
      const col = index % cfg.rowLength;
      const row = Math.floor(index / cfg.rowLength);
      const pickX = cfg.stripOriginX + col * cfg.cellSize + cfg.cellSize / 2;
      const pickY = cfg.stripOriginY + row * cfg.cellSize + cfg.cellSize / 2;

      const placeAngle = calcAngleFromSceneObject(obj);

      const key = `${placeX.toFixed(3)}_${placeY.toFixed(3)}`;
      stoneTypeMap.set(key, st);

      orders.push({ index, pickX, pickY, placeX, placeY, placeAngle });
      index++;
    }
  }

  return { orders, stoneTypeMap };
}
