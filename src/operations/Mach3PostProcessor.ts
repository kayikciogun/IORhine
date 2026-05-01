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

const fmt = (n: number, d = 3) => {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(d) : (0).toFixed(d);
};

/** Strip / DXF XY (mm) — doğrudan G-code’a; tezgâh WCS çizimle uyumlu olmalı. */
export function marlinWorkXY(_cfg: PickPlaceConfig, dxfX: number, dxfY: number): { x: number; y: number } {
  return { x: dxfX, y: dxfY };
}

// ─── Ana G-code üretici ───────────────────────────────────────────────────

export class Mach3PostProcessor {
  private cfg: PickPlaceConfig;
  private _lines: string[] = [];
  private stoneCount = 0;

  constructor(cfg: PickPlaceConfig) {
    this.cfg = cfg;
  }

  private emit(...strs: string[]) { this._lines.push(...strs); }
  private cmt(t: string) { this._lines.push(`; ${t}`); }

  // ─── Feed hızları ────────────────────────────────────────────────────────
  private fRapid() { return `F${Math.round(this.cfg.rapidFeed)}`; }
  private fPick()  { return `F${Math.round(this.cfg.pickFeed)}`; }
  private fPlace() { return `F${Math.round(this.cfg.placeFeed)}`; }
  private fRot()   { return `F${Math.round(this.cfg.rotationFeed)}`; }

  /** Güvenli Z — G0 yok, doğrusal G1 + rapid F */
  private safeZLine() {
    return `G1 Z${fmt(this.cfg.safeZ)} ${this.fRapid()}`;
  }

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
      `; Uretim: ${new Date().toISOString()}`,
      `; Toplam tas: ${totalStones}`,
      isSim
        ? '; SIMULASYON MODU'
        : isMarlin
        ? '; Ender 3 (Marlin) modu'
        : '; Standart CNC: #500 / #501 degerlerini kontrolcude elle ayarlayin.',
      isSim
        ? `; Mock Z: Strip=${this.mockStripZ}mm, Fabric=${this.mockFabricZ}mm`
        : isMarlin
        ? '; Firmware: Marlin (E ekseni relative mode)'
        : '; Standart CNC: #500 (strip Z) ve #501 (kumas Z) kontrolcude ayarli olmali.',
      '; ============================================================',
      '',
      '; Geometri ozeti',
      ...(isSim
        ? ['; PICK/PLACE Z: simulasyon (sayisal mm)']
        : isMarlin
          ? [
              `; Marlin PICK Z (mm) = marlinStripZMm(${fmt(cfg.marlinStripZMm)}) + tas pickZOffset`,
              `; Marlin PLACE Z (mm) = marlinFabricZMm(${fmt(cfg.marlinFabricZMm)}) + tas placeZOffset`,
            ]
          : [
              '; PICK  Z = [#500 + stone.pickZOffset]',
              '; PLACE Z = [#501 + stone.placeZOffset]',
            ]),
      ...(isMarlin
        ? ['; XY: DXF/strip mm — WCS onceden cizimle hizalanmis olmali']
        : []),
      `; Hizlar (mm/dk): Rapid=${Math.round(cfg.rapidFeed)} Pick=${Math.round(cfg.pickFeed)} Place=${Math.round(cfg.placeFeed)} Rot=${Math.round(cfg.rotationFeed)}`,
      '',
      'G21 ; Metric',
      'G90 ; Absolute',
      ...(isMarlin ? [] : ['G17 ; XY plane']),
    );

    if (isMarlin) {
      this.emit(
        '; Marlin XY: DXF/strip mm — WCS orijinini program oncesi tezgahta siz ayarlayin (G92 / jog). M206/M500 yok.',
        '',
        'M83 ; E ekseni relative (Marlin)',
        'G28 R0           ; home',
        ...(cfg.rotationAxis === 'E'
          ? ['M302 P1 ; Soguk extrude izni (E motoru isitmasiz donebilir)']
          : []),
        '',
        '; ============================================================',
      );
      return;
    }

    this.emit(
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
      `; Tas ${n} | ${st.name} | Pick(${fmt(order.pickX)}, ${fmt(order.pickY)}) -> Place(${fmt(order.placeX)}, ${fmt(order.placeY)}) Aci:${fmt(order.placeAngle, 1)}`,
    );

    // 1. Pick: güvenli Z → pick XY → aşağı in → vakum aç → yukarı çık
    const pickW = this.workXY(order.pickX, order.pickY);
    this.emit(
      this.safeZLine(),
      `G1 X${fmt(pickW.x)} Y${fmt(pickW.y)} ${this.fRapid()}`,
      `G1 Z${this.pickZ(st)} ${this.fPick()}`,
      cfg.vacuumOnCode,
    );
    if (cfg.vacuumOnDwell > 0) this.emit(`${this.dwell(cfg.vacuumOnDwell)} ; Vakum tut (${cfg.vacuumOnDwell}s)`);
    this.emit(this.safeZLine());

    // 2. Döndür — Marlin + E: M82 ile mutlak hedef, sonra M83'e geri dön
    if (Math.abs(order.placeAngle) > 0.01) {
      if (cfg.firmware === 'marlin' && ax === 'E') {
        this.emit(
          'M82 ; E mutlak (donme hedefi)',
          `G1 E${fmt(order.placeAngle, 2)} ${this.fRot()} ; Dondur`,
          'M83 ; E tekrar relative',
        );
      } else {
        this.emit(`G1 ${ax}${fmt(order.placeAngle, 2)} ${this.fRot()} ; Dondur ${fmt(order.placeAngle, 1)}`);
      }
    }

    // 3. Place: place XY → aşağı in → vakum kapat → yukarı çık
    const placeW = this.workXY(order.placeX, order.placeY);
    this.emit(
      `G1 X${fmt(placeW.x)} Y${fmt(placeW.y)} ${this.fRapid()}`,
      `G1 Z${this.placeZ(st)} ${this.fPlace()}`,
      cfg.vacuumOffCode,
    );
    if (cfg.vacuumOffDwell > 0) this.emit(`${this.dwell(cfg.vacuumOffDwell)} ; Vakum bekle (${cfg.vacuumOffDwell}s)`);
    this.emit(this.safeZLine());

    // 4. Rotasyon sıfırla
    if (Math.abs(order.placeAngle) > 0.01) {
      if (cfg.firmware === 'marlin' && ax === 'E') {
        this.emit('M82', `G1 E0 ${this.fRot()} ; E sifir`, 'M83');
      } else {
        this.emit(`G1 ${ax}0 ${this.fRot()} ; Eksen sifir`);
      }
    }

    this.stoneCount++;
  }

  private footer() {
    const { cfg } = this;
    const isMarlin = cfg.firmware === 'marlin';

    this.emit(
      '',
      `; Bitti | ${this.stoneCount} tas yerlestirildi`,
      this.safeZLine(),
      ...(isMarlin
        ? (cfg.releaseMotorsAtProgramEnd
          ? ['M84 ; Motorlari serbest birak']
          : ['G1 X0 Y0 F60000 ; Orjine git (G92 X0 Y0)'])
        : ['M30']),
    );
  }

  generate(
    orders: PlacementOrder[],
    stoneTypes: StoneType[],
  ): GcodeResult {
    this._lines = [];
    this.stoneCount = 0;

    // O(1) id → StoneType erişimi — key çakışması riski yok
    const stoneTypeById = new Map(stoneTypes.map(st => [st.id, st]));

    this.header(orders);

    orders.forEach((order, i) => {
      const st = stoneTypeById.get(order.stoneTypeId);
      if (!st) {
        console.warn(`[PostProcessor] StoneType bulunamadı: stoneTypeId=${order.stoneTypeId} (taş ${i + 1})`);
        return;
      }
      this.singleStone(order, st, i + 1);
    });

    this.footer();

    const gcode = this._lines.join('\n');
    return {
      gcode,
      totalStones: this.stoneCount,
      estimatedSeconds: orders.length * 6,
      lines: this._lines.length,
    };
  }
}

// ─── Placement orders builder ─────────────────────────────────────────────

export function buildPlacementOrders(
  scene: any,
  stoneTypes: StoneType[],
  cfg: PickPlaceConfig,
): PlacementOrder[] {
  // O(1) handle → sahne objesi indeksi: tek traverse tüm sahneyi kapsar
  const handleIndex = new Map<string, any>();
  scene.traverse((o: any) => {
    const h = o.userData?.handle;
    if (h) handleIndex.set(h, o);
  });

  const orders: PlacementOrder[] = [];
  let index = 0;

  // cellGap destekli grid adımı
  const pitch = cfg.cellSize + (cfg.cellGap ?? 0);

  for (const st of stoneTypes) {
    for (const handle of st.contourIds) {
      const obj = handleIndex.get(handle);
      if (!obj) continue;

      // DXF koordinatı — kumaş üzerindeki konum
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

      // Strip grid koordinatı — buildPlacementOrders ile stripGenerator aynı pitch kullanır
      const col = index % cfg.rowLength;
      const row = Math.floor(index / cfg.rowLength);
      const pickX = cfg.stripOriginX + col * pitch + cfg.cellSize / 2;
      const pickY = cfg.stripOriginY + row * pitch + cfg.cellSize / 2;

      const placeAngle = calcAngleFromSceneObject(obj);

      orders.push({ index, stoneTypeId: st.id, pickX, pickY, placeX, placeY, placeAngle });
      index++;
    }
  }

  return orders;
}
