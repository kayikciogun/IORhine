/**
 * Mach3 / GRBL uyumlu Pick & Place Post-Processor
 *
 * ─── Koordinat sistemi ────────────────────────────────────────────────────
 *  #500  = Strip yüzey Z referansı  (probe tetiklenme = strip'in üst yüzeyi)
 *  #501  = Kumaş  yüzey Z referansı
 *
 *  PICK  Z = [#500 + probeNozzleOffsetZ + stone.pickZOffset]
 *    – probeNozzleOffsetZ : Probe ucu → Nozzle ucu Z farkı
 *                           (+ = nozzle, probeden YUKARDA, yani taşa daha az iner)
 *    – pickZOffset         : Taş tipine özel "ne kadar derin girsin" (genelde negatif)
 *
 *  PLACE Z = [#501 + probeNozzleOffsetZ + stone.placeZOffset]
 *
 * ─── İki ayrı G-code dosyası ────────────────────────────────────────────
 *  1. setup.nc    → Sadece probe ölçümü. Makineye bağlandıktan sonra
 *                   BİR KEZ çalıştırılır; #500 ve #501'i belleğe yazar.
 *  2. pickplace.nc → Taş yerleştirme döngüsü. #500/#501 hazır olduğunu
 *                    varsayar; probe YOKTUR.
 *
 * ─── Fiziksel geometri ─────────────────────────────────────────────────
 *  Probe sensör makinede nozzle'dan (probeOffsetX, probeOffsetY) uzakta.
 *  Probe ile referans alınırken makine o ofsetle pozisyonlanır, ardından
 *  gerçek pick/place koordinatına gidilir.
 */

import { PickPlaceConfig, StoneType, PlacementOrder } from '@/types/pickplace';

export interface GcodeResult {
  gcode: string;
  totalStones: number;
  estimatedSeconds: number;
  lines: number;
}

// ─── Yardımcılar ──────────────────────────────────────────────────────────

const fmt  = (n: number, d = 3) => n.toFixed(d);
const safeZ = (cfg: PickPlaceConfig) => `G0 Z${fmt(cfg.safeZ)}`;

// ─── Setup G-code üretici ─────────────────────────────────────────────────

export function generateSetupGcode(cfg: PickPlaceConfig, firstStoneX: number, firstStoneY: number): string {
  const nx = cfg.probeNozzleOffsetZ; // kısaltma

  const lines: string[] = [
    '; ============================================================',
    '; IO-CAM Pick & Place — SETUP (Probe Referans)',
    `; Üretim: ${new Date().toISOString()}`,
    '; ============================================================',
    '; Bu dosyayı makineyi bağladıktan sonra BİR KEZ çalıştırın.',
    '; #500 (strip Z) ve #501 (kumaş Z) değişkenleri hafızaya yazar.',
    '; Ardından pickplace.nc dosyasını çalıştırın.',
    '; ============================================================',
    '',
    'G21 ; Metric',
    'G90 ; Absolute',
    '',
    '; ── Bilgi: Geometri ─────────────────────────────────────────',
    `; Probe XY ofseti nozzle'a göre: X${fmt(cfg.probeOffsetX)} Y${fmt(cfg.probeOffsetY)}`,
    `; Probe → Nozzle Z farkı (probeNozzleOffsetZ): ${fmt(nx)} mm`,
    `; İlk taş pick merkezi: X${fmt(firstStoneX)} Y${fmt(firstStoneY)}`,
    '',
    '; ── 1. Strip Yüzey Probe ────────────────────────────────────',
    `; Probe sensörü ilk taşın üzerine konumlanır (XY nozzle ofseti uygulanır)`,
    safeZ(cfg),
    `G0 X${fmt(firstStoneX + cfg.probeOffsetX)} Y${fmt(firstStoneY + cfg.probeOffsetY)}`,
    `G38.2 Z-80 F${fmt(cfg.probeFeed)} ; Yavaş probe aşağı`,
    `#500 = #2002                       ; Strip Z referansını kaydet`,
    `G0 Z${fmt(cfg.probeRetract)}        ; Geri çekil`,
    `; Not: Nozzle ucu bu noktada Z=[#500 + ${fmt(nx)}] = strip yüzeyinde`,
    '',
    '; ── 2. Kumaş Yüzey Probe ───────────────────────────────────',
    safeZ(cfg),
    `G0 X${fmt(cfg.fabricProbeX + cfg.probeOffsetX)} Y${fmt(cfg.fabricProbeY + cfg.probeOffsetY)}`,
    `G38.2 Z-80 F${fmt(cfg.probeFeed)} ; Yavaş probe aşağı`,
    `#501 = #2002                       ; Kumaş Z referansını kaydet`,
    `G0 Z${fmt(cfg.probeRetract)}        ; Geri çekil`,
    '',
    '; ── Bitti ───────────────────────────────────────────────────',
    safeZ(cfg),
    'G0 X0 Y0',
    `; #500 (strip Z) = [kayıtlı] | #501 (kumaş Z) = [kayıtlı]`,
    `; probeNozzleOffsetZ = ${fmt(nx)} mm — Pick/place Z hesabına otomatik eklenir`,
    'M30',
  ];

  return lines.join('\n');
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

  // Z ifadesi: #500 (strip ref) + nozzle geometri farkı + taş tipi ofseti
  private pickZ(st: StoneType): string {
    const geom = this.cfg.probeNozzleOffsetZ;
    const offset = geom + st.pickZOffset;
    const sign = offset >= 0 ? '+' : '';
    return `[#500${sign}${fmt(offset)}]`;
  }

  private placeZ(st: StoneType): string {
    const geom = this.cfg.probeNozzleOffsetZ;
    const offset = geom + st.placeZOffset;
    const sign = offset >= 0 ? '+' : '';
    return `[#501${sign}${fmt(offset)}]`;
  }

  private header(orders: PlacementOrder[]) {
    const { cfg } = this;
    const totalStones = orders.length;

    this.emit(
      '; ============================================================',
      '; IO-CAM Pick & Place — PLACEMENT',
      `; Üretim: ${new Date().toISOString()}`,
      `; Toplam taş: ${totalStones}`,
      '; ⚠  Bu dosyayı çalıştırmadan önce setup.nc çalıştırılmış olmalı!',
      '; ⚠  #500 (strip Z) ve #501 (kumaş Z) hafızada olmalı.',
      '; ============================================================',
      '',
      '; ── Geometri özeti ──────────────────────────────────────────',
      `; Probe→Nozzle XY: X${fmt(cfg.probeOffsetX)} Y${fmt(cfg.probeOffsetY)}`,
      `; Probe→Nozzle Z (probeNozzleOffsetZ): ${fmt(cfg.probeNozzleOffsetZ)} mm`,
      `; PICK  Z = [#500 + probeNozzleOffsetZ + stone.pickZOffset]`,
      `; PLACE Z = [#501 + probeNozzleOffsetZ + stone.placeZOffset]`,
      '',
      'G21 ; Metric',
      'G90 ; Absolute',
      'G17 ; XY plane',
      `G0 Z${fmt(cfg.safeZ)} ; Safe height`,
      '',
      '; ============================================================',
    );
  }

  private singleStone(order: PlacementOrder, st: StoneType, n: number) {
    const { cfg } = this;
    const ax = cfg.rotationAxis;
    this.emit(
      '',
      `; ── Taş ${n} | ${st.name} | Pick(${fmt(order.pickX)}, ${fmt(order.pickY)}) → Place(${fmt(order.placeX)}, ${fmt(order.placeY)}) Açı:${fmt(order.placeAngle, 1)}° ──`,
    );

    // 1. Pick
    this.emit(
      safeZ(cfg),
      `G0 X${fmt(order.pickX)} Y${fmt(order.pickY)}`,
      `G1 Z${this.pickZ(st)} F${cfg.pickFeed}`,
      cfg.vacuumOnCode,
    );
    if (cfg.vacuumOnDwell > 0) this.emit(`G4 P${cfg.vacuumOnDwell}`);
    this.emit(safeZ(cfg));

    // 2. Döndür
    if (Math.abs(order.placeAngle) > 0.01) {
      this.emit(`G1 ${ax}${fmt(order.placeAngle, 2)} F${cfg.rotationFeed} ; Döndür`);
    }

    // 3. Place
    this.emit(
      `G0 X${fmt(order.placeX)} Y${fmt(order.placeY)}`,
      `G1 Z${this.placeZ(st)} F${cfg.placeFeed}`,
      cfg.vacuumOffCode,
    );
    if (cfg.vacuumOffDwell > 0) this.emit(`G4 P${cfg.vacuumOffDwell}`);
    this.emit(safeZ(cfg));

    // 4. Sıfırla
    if (Math.abs(order.placeAngle) > 0.01) {
      this.emit(`G1 ${ax}0 F${cfg.rotationFeed} ; Sıfırla`);
    }

    this.stoneCount++;
  }

  private footer() {
    const { cfg } = this;
    this.emit(
      '',
      `; ── Bitti | ${this.stoneCount} taş yerleştirildi ──`,
      safeZ(cfg),
      'G0 X0 Y0',
      'M30',
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
      const st: StoneType = stoneTypeMap.get(key) ?? {
        id: '', name: 'Bilinmiyor', color: '#fff',
        pickZOffset: order.pickZ, placeZOffset: order.placeZ, contourIds: [],
      };
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { calcAngleFromSceneObject } = require('@/Utils/contourAngle');
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

      orders.push({ index, pickX, pickY, pickZ: st.pickZOffset, placeX, placeY, placeZ: st.placeZOffset, placeAngle });
      index++;
    }
  }

  return { orders, stoneTypeMap };
}

/** İlk taşın strip üzerindeki merkezi */
export function firstStoneCoord(cfg: PickPlaceConfig): { x: number; y: number } {
  return {
    x: cfg.stripOriginX + cfg.cellSize / 2,
    y: cfg.stripOriginY + cfg.cellSize / 2,
  };
}
