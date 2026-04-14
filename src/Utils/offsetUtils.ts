/**
 * Offset İşlemleri Utility Sınıfı
 * Cavalier Contours WASM modülü ile modern multi-pline offset işlemlerini yönetir
 * 
 * ANA FONKSİYONLAR:
 * - createMultiPlineOffsets: Demo'daki gibi çoklu polyline offset (ÖNERİLEN)
 * - createRawOffset: Ham offset işlemi (debug/analiz için)
 * - createCavalierOffsets: Legacy tek polyline offset (deprecated)
 */

import '../../public/wasm/v0aigcode_cavalier_ffi.js';
import { plineParallelOffset, multiPlineParallelOffset, plineFindIntersects } from '../../public/wasm/v0aigcode_cavalier_ffi.js';

import { debug } from './debug';
// Type tanımları
export type Point2D = { x: number; y: number };
export type LineSegment = { type: 'Line'; start: Point2D; end: Point2D };
export type ArcSegment = {
    type: 'Arc';
    center: Point2D;
    radius: number;
    startAngle: number;
    endAngle: number;
    clockwise: boolean;
    start: Point2D;
    end: Point2D;
};
export type PathSegment = LineSegment | ArcSegment;
export type Path = PathSegment[];

// Yardımcı vektör işlemleri
export function vecAdd(a: Point2D, b: Point2D): Point2D { return { x: a.x + b.x, y: a.y + b.y }; }
export function vecSub(a: Point2D, b: Point2D): Point2D { return { x: a.x - b.x, y: a.y - b.y }; }
export function vecScale(v: Point2D, s: number): Point2D { return { x: v.x * s, y: v.y * s }; }
export function vecLength(v: Point2D): number { return Math.sqrt(v.x * v.x + v.y * v.y); }
export function vecNormalize(v: Point2D): Point2D {
    const len = vecLength(v);
    if (len < 1e-9) return { x: 0, y: 0 };
    return vecScale(v, 1 / len);
}
export function vecNormal(v: Point2D): Point2D { return { x: -v.y, y: v.x }; }
export function distance(p1: Point2D, p2: Point2D): number { 
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2)); 
}
export function pointsApproximatelyEqual(p1: Point2D, p2: Point2D, tolerance = 1e-5): boolean {
    return Math.abs(p1.x - p2.x) < tolerance && Math.abs(p1.y - p2.y) < tolerance; 
}

/**
 * Bir Path'in kapalı olup olmadığını kontrol eder
 * Kapalı: Son segmentin bitiş noktası ilk segmentin başlangıç noktasına eşitse
 */
export function isPathClosed(path: Path): boolean {
    if (!path || path.length < 1) return false;
    return pointsApproximatelyEqual(path[0].start, path[path.length - 1].end, 1e-3);
}

/**
 * Verilen yayın başlangıç ve bitiş noktalarının merkezine göre zıt yönlerde olup olmadığını kontrol eder.
 */
export function isArcDiametricallyOpposed(arc: ArcSegment, tolerance = 1e-3): boolean {
    if (!arc || !arc.center || !arc.start || !arc.end) return false;
    if (pointsApproximatelyEqual(arc.start, arc.end) && Math.abs(Math.abs(arc.endAngle - arc.startAngle) - 2 * Math.PI) < tolerance) {
         return false;
    }
    const vecCenterToStart = vecSub(arc.start, arc.center);
    const vecCenterToEnd = vecSub(arc.end, arc.center);
    const sumVec = vecAdd(vecCenterToStart, vecCenterToEnd);
    return vecLength(sumVec) < tolerance;
}

/**
 * Path nesnesini Cavalier Contours Polyline yapısına dönüştürür.
 * WASM uyumlu düz veri yapısı oluşturur.
 */
export function pathToCavalierPolyline(path: Path, isClosedFlag: boolean = true): any {
    if (!path || path.length === 0) {
        debug.warn("[offsetUtils] pathToCavalierPolyline: Boş veya tanımsız path.");
        return null;
    }

    // Eğer yol zaten kapalıysa "isClosedFlag" kullan, aksi halde false
    const isPathAlreadyClosed = isPathClosed(path);
    const effectiveIsClosedFlag = isPathAlreadyClosed ? true : isClosedFlag;
    
    const numSegments = path.length;
    // Polyline segment/vertex ilişkisi:
    // - Kapalı (closed) polyline: N segment -> N vertex (ilk verteks tekrarlanmaz)
    // - Açık (open) polyline: N segment -> N+1 vertex (son nokta eklenir)
    const vertexArray: Array<[number, number, number]> = [];

    // İlk nokta
    vertexArray.push([path[0].start.x, path[0].start.y, 0]); // İlk bulge değeri döngüde düzeltilecek

    for (let i = 0; i < numSegments; i++) {
        const segment = path[i];
        
        // Geçerlilik kontrolü - NaN değerleri kontrolü
        if (isNaN(segment.start.x) || isNaN(segment.start.y) || 
            isNaN(segment.end.x) || isNaN(segment.end.y)) {
            debug.warn(`[offsetUtils] pathToCavalierPolyline: NaN koordinatları içeren segment atlanıyor:`, segment);
            continue;
        }
        
        if (segment.type === 'Line') {
            // Düz çizgi için bulge 0
            vertexArray[i][2] = 0;
        } else { // ArcSegment
            const arc = segment as ArcSegment;
            
            // NaN kontrolü - merkez ve yarıçap
            if (isNaN(arc.center.x) || isNaN(arc.center.y) || isNaN(arc.radius)) {
                debug.warn(`[offsetUtils] pathToCavalierPolyline: NaN merkez/yarıçap içeren arc atlanıyor:`, arc);
                vertexArray[i][2] = 0; // Sorunlu arc'ları çizgi olarak kabul et
                continue;
            }
            
            let deltaAngle = arc.endAngle - arc.startAngle;
            const twoPi = 2 * Math.PI;

            // Açı normalleştirme
            while (deltaAngle <= -twoPi) deltaAngle += twoPi;
            while (deltaAngle > twoPi) deltaAngle -= twoPi;

            if (arc.clockwise) {
                if (deltaAngle > 0) deltaAngle -= twoPi;
            } else {
                if (deltaAngle < 0) deltaAngle += twoPi;
            }
            
            // Neredeyse tam daire kontrolü
            if (Math.abs(Math.abs(deltaAngle) - twoPi) < 1e-6) {
                debug.warn(`[offsetUtils] pathToCavalierPolyline: Tam daire tespit edildi, parçalar halinde işlenmeli.`);
                // Tam daire için bulge hesaplanamamalı, parçalar halinde ele alınmalı
                vertexArray[i][2] = 0; 
                continue;
            } 
            
            // Bulge hesapla ve kontrol et
            const bulgeValue = Math.tan(deltaAngle / 4);
            if (isNaN(bulgeValue) || !isFinite(bulgeValue) || Math.abs(bulgeValue) > 10) {
                debug.warn(`[offsetUtils] pathToCavalierPolyline: Geçersiz bulge değeri (${bulgeValue}), 0 kullanılıyor.`);
                vertexArray[i][2] = 0;
            } else {
                vertexArray[i][2] = bulgeValue;
            }
        }

        // Bir sonraki nokta (segment.end)
        if (i < numSegments - 1) {
            vertexArray.push([segment.end.x, segment.end.y, 0]); // bulge değeri bir sonraki döngüde atanacak
        } else if (!effectiveIsClosedFlag) {
            // Açık path için son noktayı ekle
            vertexArray.push([segment.end.x, segment.end.y, 0]);
        }
        // NOT: Kapalı path için (effectiveIsClosedFlag === true) kapanış verteksi TEKRAR EKLENMEZ
    }
    
    // Güvenlik kontrolü - NaN kontrol et
    for (let i = 0; i < vertexArray.length; i++) {
        for (let j = 0; j < 3; j++) {
            if (isNaN(vertexArray[i][j]) || !isFinite(vertexArray[i][j])) {
                debug.warn(`[offsetUtils] pathToCavalierPolyline: Geçersiz değer düzeltiliyor [${i}][${j}] = ${vertexArray[i][j]}`);
                vertexArray[i][j] = 0; // NaN değerlerini 0 ile değiştir
            }
        }
    }
    
    // Debug çıktısı
    debug.log(`[offsetUtils] pathToCavalierPolyline: Oluşturulan vertex dizisi (${vertexArray.length} nokta):`);
    let debugStr = "";
    for (let i = 0; i < Math.min(vertexArray.length, 10); i++) { // Fazla log oluşturma
        debugStr += `[${vertexArray[i][0].toFixed(3)}, ${vertexArray[i][1].toFixed(3)}, ${vertexArray[i][2].toFixed(4)}] `;
        if ((i+1) % 3 === 0 && i > 0 && (i+1) < vertexArray.length) debugStr += "\n";
    }
    if (vertexArray.length > 10) debugStr += " ... (toplam " + vertexArray.length + " nokta)";
    debug.log(debugStr);
    
    try {
        // TAM Rust/WASM uyumlu nesne
        const cavalierInput = {
            isClosed: effectiveIsClosedFlag,  // ÖNEMLİ: "closed" değil "isClosed" kullan!
            vertexes: vertexArray    // Vertex dizisi
        };
        
        debug.log(`[offsetUtils] pathToCavalierPolyline: Rust/WASM uyumlu nesne - vertices sayısı: ${cavalierInput.vertexes.length}, isClosed: ${cavalierInput.isClosed}`);
        return cavalierInput;
    } catch (error) {
        console.error("[offsetUtils] pathToCavalierPolyline: JS nesne dönüşüm hatası:", error);
        return null;
    }
}

/**
 * Cavalier Contours Polyline yapısından Path nesnesine dönüştürür.
 * Yay segmentleri korunur.
 */
export function cavalierPolylineToPath(polyline: any): Path {
    // Giriş verisi kontrolü
    if (!polyline) {
        debug.warn("[offsetUtils] Null polyline verisi");
        return [];
    }
    
    // Yeni WASM API'sinin Polyline sınıfı kontrolü
    if (polyline.__wbg_ptr !== undefined && typeof polyline.vertexData === 'function') {
        debug.log("[offsetUtils] Yeni Polyline sınıfı tespit edildi");
        try {
            const vertexData = polyline.vertexData(); // Float64Array döner
            const isClosed = polyline.isClosed;
            debug.log(`[offsetUtils] Polyline verisi: ${vertexData.length / 3} vertex, isClosed=${isClosed}`);
            
            // Debug: İlk birkaç vertex'i göster
            debug.log(`[offsetUtils] İlk 3 vertex:`, 
                Array.from(vertexData.slice(0, 9)).map((v, i) => 
                    i % 3 === 0 ? `[${vertexData[i]?.toFixed(3)}, ${vertexData[i+1]?.toFixed(3)}, ${vertexData[i+2]?.toFixed(4)}]` : ''
                ).filter(Boolean).slice(0, 3)
            );
            
            // Float64Array'i [x, y, bulge] triplet'lerine dönüştür
            const vertexes: Array<[number, number, number]> = [];
            for (let i = 0; i < vertexData.length; i += 3) {
                vertexes.push([vertexData[i], vertexData[i + 1], vertexData[i + 2]]);
            }
            
            const result = convertVertexesToPath(vertexes, isClosed);
            debug.log(`[offsetUtils] Polyline → Path dönüştürme: ${result.length} segment oluştu`);
            return result;
        } catch (error) {
            console.error("[offsetUtils] Yeni Polyline sınıfı dönüştürme hatası:", error);
        return [];
    }
    }
    
    // Legacy/JSON format desteği (eski veya JSON dönen WASM API'si için)
    try {
        const hasVertexArray = polyline && Array.isArray((polyline as any).vertexes);
        const hasIsClosedBool = typeof (polyline as any).isClosed === 'boolean';
        if (hasVertexArray) {
            const rawVertexes = (polyline as any).vertexes as any[];
            const isClosed = hasIsClosedBool ? Boolean((polyline as any).isClosed) : true;
            const vertexes: Array<[number, number, number]> = [];
            for (let i = 0; i < rawVertexes.length; i++) {
                const v = rawVertexes[i];
                if (Array.isArray(v)) {
                    const x = Number(v[0]);
                    const y = Number(v[1]);
                    const b = v.length > 2 ? Number(v[2]) : 0;
                    if (isFinite(x) && isFinite(y)) {
                        vertexes.push([x, y, isFinite(b) ? b : 0]);
                    }
                } else if (v && typeof v === 'object') {
                    const x = Number((v as any).x);
                    const y = Number((v as any).y);
                    const b = Number((v as any).bulge);
                    if (isFinite(x) && isFinite(y)) {
                        vertexes.push([x, y, isFinite(b) ? b : 0]);
                    }
                }
            }
            if (vertexes.length >= 2) {
                debug.log(`[offsetUtils] Legacy/JSON polyline tespit edildi: ${vertexes.length} vertex, isClosed=${isClosed}`);
                const path = convertVertexesToPath(vertexes, isClosed);
                debug.log(`[offsetUtils] Legacy/JSON → Path: ${path.length} segment`);
                return path;
            }
        }
    } catch (e) {
        debug.warn('[offsetUtils] Legacy/JSON polyline dönüştürme hatası:', e);
    }
    debug.warn("[offsetUtils] Tanınmayan polyline formatı - boş path döndürülüyor");
    return [];

}

/**
 * Cavalier Contours ile offset yolları oluşturur
 * @deprecated createMultiPlineOffsets kullanın - daha iyi performans ve ada desteği
 * @param path Offset uygulanacak yol
 * @param offset Offset mesafesi (pozitif veya negatif)
 * @returns Offset uygulanmış yollar
 */
export function createCavalierOffsets(path: Path, offset: number, forceClosed: boolean = true): Path[] {
    // Yol geçerlilik kontrolü
    if (!path || !Array.isArray(path) || path.length === 0) {
        console.error("[offsetUtils] Geçersiz yol verisi:", path);
        return [];
    }
    
    // Path debuglama
    debug.log(`[offsetUtils] Path uzunluğu: ${path.length}, İlk segment tipi: ${path[0]?.type}`);
    
    // NaN içeren segmentleri filtrele
    const filteredPath = path.filter(segment => {
        const hasValidCoords = !(
            isNaN(segment.start.x) || isNaN(segment.start.y) || 
            isNaN(segment.end.x) || isNaN(segment.end.y) || 
            !isFinite(segment.start.x) || !isFinite(segment.start.y) || 
            !isFinite(segment.end.x) || !isFinite(segment.end.y)
        );
        
        // Yay segmenti için ek kontroller
        if (hasValidCoords && segment.type === 'Arc') {
            const arc = segment as ArcSegment;
            return !(
                isNaN(arc.center.x) || isNaN(arc.center.y) || 
                isNaN(arc.radius) || isNaN(arc.startAngle) || isNaN(arc.endAngle) ||
                !isFinite(arc.center.x) || !isFinite(arc.center.y) || 
                !isFinite(arc.radius) || !isFinite(arc.startAngle) || !isFinite(arc.endAngle) ||
                arc.radius <= 0
            );
        }
        
        return hasValidCoords;
    });
    
    // Yolun uzunluğu (açık yollar için 1 segment yeterlidir, kapalı için en az 2 gerekir)
    if (filteredPath.length < (forceClosed ? 2 : 1)) {
        debug.warn(`[offsetUtils] Path segment sayısı yetersiz (len=${filteredPath.length}, forceClosed=${forceClosed}) - offsetleme atlanıyor.`);
        return [];
    }

    if (filteredPath.length < path.length) {
        debug.warn(`[offsetUtils] ${path.length - filteredPath.length} geçersiz segment filtrelendi.`);
        if (filteredPath.length < (forceClosed ? 2 : 1)) {
            console.error("[offsetUtils] Filtreleme sonrası yetersiz segment sayısı, offsetleme atlanıyor.");
            return [];
        }
    }
    
    // Yolun kapalı olup olmadığını kontrol et; açık yolu zorla kapatma seçime bağlı
    const isClosedPath = isPathClosed(filteredPath);
    
    try {
        // Rust/WASM uyumlu nesne formatına dönüştür
        const cavalierInputObject = pathToCavalierPolyline(filteredPath, forceClosed ? true : isClosedPath);
        if (!cavalierInputObject || !cavalierInputObject.vertexes) {
            console.error("[offsetUtils] pathToCavalierPolyline'dan geçerli veri alınamadı veya vertexes alanı eksik.");
            return [];
        }
        
        // Offset mesafesi kontrolü
        const absOffset = Math.abs(offset);
        const minOffset = 0.1;  // Çok küçük offset değerleri sorun çıkarabilir
        const maxOffset = 500;  // Çok büyük offset değerleri de sorun çıkarabilir
        
        if (absOffset < minOffset) {
            debug.warn(`[offsetUtils] Offset değeri çok küçük (${offset}), asgari ${minOffset} kullanılıyor.`);
            offset = offset >= 0 ? minOffset : -minOffset;
        } else if (absOffset > maxOffset) {
            debug.warn(`[offsetUtils] Offset değeri çok büyük (${offset}), azami ${maxOffset} kullanılıyor.`);
            offset = offset >= 0 ? maxOffset : -maxOffset;
        }
        
        debug.log(`[offsetUtils] Offset için hazırlanan veri: { vertexes uzunluğu: ${cavalierInputObject.vertexes.length}, isClosed: ${cavalierInputObject.isClosed} }`);
        
        try {
            // handle_self_intersects seçeneği boolean olarak
            const handleSelfIntersects = true; // self-intersect yönetimini AÇ
            debug.log(`[offsetUtils] plineParallelOffset çağrılıyor: offset=${offset}, handle_self_intersects=${handleSelfIntersects}`);
            
            // İSTENEN DEBUG LOG: plineParallelOffset input verisini tam yazdır
            debug.log("[DEBUG OFFSET INPUT]", JSON.stringify(cavalierInputObject, null, 2));
            
            // Safety ilk - yeni bir kopya oluştur
            const cleanInputObject = JSON.parse(JSON.stringify(cavalierInputObject));
            
            // WASM işlemini çağır
            debug.log("[DEBUG] plineParallelOffset input:", JSON.stringify(cleanInputObject, null, 2));
            const offsetResult = plineParallelOffset(cleanInputObject, offset, handleSelfIntersects);
            debug.log("[DEBUG] plineParallelOffset output:", offsetResult);
            
            // Sonucu dönüştür
            if (!offsetResult || !Array.isArray(offsetResult) || offsetResult.length === 0) {
                debug.warn("[offsetUtils] Offset sonucu geçersiz veya boş");
                return [];
            }
            
            debug.log("[offsetUtils] Offset sonucu detayı:", {
                resultType: typeof offsetResult,
                isArray: Array.isArray(offsetResult),
                length: offsetResult.length,
                firstItem: offsetResult[0],
                firstItemType: typeof offsetResult[0],
                firstItemKeys: offsetResult[0] ? Object.keys(offsetResult[0]) : null
            });
            
            // Offset sonucu path'leri dönüştür ve NaN değerleri filtrele
            const resultPaths: Path[] = [];
            
            for (const resultItem of offsetResult) {
                try {
                    debug.log("[offsetUtils] resultItem detayı:", {
                        type: typeof resultItem,
                        constructor: resultItem?.constructor?.name,
                        hasVertexes: resultItem && 'vertexes' in resultItem,
                        hasVertexData: resultItem && typeof resultItem.vertexData === 'function',
                        hasIsClosed: resultItem && 'isClosed' in resultItem,
                        keys: resultItem ? Object.keys(resultItem) : null
                    });
                    
                    // Yeni Polyline sınıfı kontrolü (WASM'dan gelen)
                    if (resultItem && typeof resultItem.vertexData === 'function') {
                        debug.log("[offsetUtils] Yeni Polyline sınıfı tespit edildi, direkt dönüştürülüyor");
                        const resultPath = cavalierPolylineToPath(resultItem);
                        if (resultPath && resultPath.length > 0) {
                            resultPaths.push(resultPath);
                        }
                        continue;
                    }
                    
                    // Legacy format kontrolü
                    if (resultItem && Array.isArray(resultItem.vertexes)) {
                        const vs = resultItem.vertexes as any[];
                        let badVertex = false;
                        for (let i = 0; i < vs.length; i++) {
                            const v = vs[i];
                            const x = Array.isArray(v) ? Number(v[0]) : (v && typeof v === 'object' && 'x' in v ? Number((v as any).x) : NaN);
                            const y = Array.isArray(v) ? Number(v[1]) : (v && typeof v === 'object' && 'y' in v ? Number((v as any).y) : NaN);
                            const b = Array.isArray(v) ? (v.length > 2 ? Number(v[2]) : 0) : (v && typeof v === 'object' && 'bulge' in v ? Number((v as any).bulge) : 0);
                            if (!isFinite(x) || !isFinite(y)) { badVertex = true; break; }
                            if (!isFinite(b) || isNaN(b)) { /* bulge NaN olabilir, 0 olarak kabul */ }
                        }
                        if (badVertex) {
                            debug.warn('[offsetUtils] Legacy format: Geçersiz verteks tespit edildi, item atlanıyor.');
                            continue;
                        }
                    }

                    const resultPath = cavalierPolylineToPath(resultItem);
                    
                    // Ek filtre - NaN içeren path'leri alma
                    let hasNaN = false;
                    if (resultPath && resultPath.length > 0) {
                        for (const seg of resultPath) {
                            if (
                                !isFinite(seg.start.x) || !isFinite(seg.start.y) ||
                                !isFinite(seg.end.x) || !isFinite(seg.end.y) ||
                                (seg.type === 'Arc' && (!isFinite((seg as any).radius) || !isFinite((seg as any).startAngle) || !isFinite((seg as any).endAngle)))
                            ) {
                                hasNaN = true;
                                break;
                            }
                        }
                    } else {
                        hasNaN = true;
                    }
                    if (hasNaN) {
                        debug.warn('[offsetUtils] Offset sonucu: NaN içeren path tespit edildi, atlanıyor.');
                        continue;
                    }
                    
                    resultPaths.push(resultPath);
                } catch (err) {
                    debug.warn('[offsetUtils] Offset sonucu path dönüştürme hatası, item atlanıyor:', err);
                }
            }
            
            return resultPaths;
            
        } catch (error) {
            console.error("[offsetUtils] cavcParallelOffset çağrısı hatası:", error);
            return [];
        }
    } catch (error) {
        console.error("[offsetUtils] Veri hazırlama hatası:", error);
        return [];
    }
}

/**
 * Cavalier Contours ile Boolean Intersection operasyonu gerçekleştirir
 * NOT: Yeni multi-pline offset mantığı kullanıldığından bu fonksiyon artık gerekli değil
 * @deprecated Multi-pline offset kullanın
 */
export function performCavalierBooleanIntersection(subjectPath: Path, clipPaths: Path[]): Path[] {
    debug.warn("[offsetUtils] Bu fonksiyon deprecated - multi-pline offset kullanın");
    return [subjectPath];
}

/**
 * Cavalier Contours ile Boolean operasyonu gerçekleştirir
 * NOT: Yeni multi-pline offset mantığı kullanıldığından bu fonksiyon artık gerekli değil
 * @deprecated Multi-pline offset kullanın
 */
export function performCavalierBooleanOp(subjectPath: Path, clipPaths: Path[]): Path[] {
    debug.warn("[offsetUtils] Bu fonksiyon deprecated - multi-pline offset kullanın");
    return [subjectPath];
}

/**
 * Multi-Pline Parallel Offset - Demo'daki gibi çoklu polyline offset işlemi
 * Boundary ve island'ları otomatik olarak ayırır ve iteratif offset uygular
 * @param boundaryPath Ana sınır yolu (CCW olmalı)
 * @param islandPaths Ada yolları (CW olmalı)
 * @param offset Offset mesafesi
 * @param maxIterations Maksimum iterasyon sayısı
 * @returns Her iterasyon için offset sonuçları
 */
export function createMultiPlineOffsets(
    boundaryPath: Path, 
    islandPaths: Path[], 
    offset: number, 
    maxIterations: number = 100
): Path[][] {
    //debug.log(`🔄 [MultiPlineOffset] Başlatılıyor: boundary=${boundaryPath.length}seg, islands=${islandPaths.length}, offset=${offset}, maxIter=${maxIterations}`);
    
    // WASM başlatma kontrolü
    const wasmReady = (window as any)?.__CAVALIER_WASM_READY__;
   // debug.log(`🔍 [MultiPlineOffset] WASM durumu: ready=${wasmReady}, multiPlineParallelOffset=${typeof multiPlineParallelOffset}`);
    
    if (!wasmReady) {
        console.error(`❌ [MultiPlineOffset] WASM modülü henüz başlatılmamış! __CAVALIER_WASM_READY__=${wasmReady}`);
        return [];
    }
    
    // WASM fonksiyon kontrolü
    if (typeof multiPlineParallelOffset !== 'function') {
        console.error(`❌ [MultiPlineOffset] multiPlineParallelOffset fonksiyonu mevcut değil! Type: ${typeof multiPlineParallelOffset}`);
        return [];
    }
   // debug.log(`✅ [MultiPlineOffset] WASM hazır ve multiPlineParallelOffset fonksiyonu mevcut`);
    
    // Tüm path'leri Cavalier formatına dönüştür
    const allPaths: Path[] = [boundaryPath, ...islandPaths];
    const cavalierPlines: any[] = [];
    
    for (let i = 0; i < allPaths.length; i++) {
        const path = allPaths[i];
        const cavalierPline = pathToCavalierPolyline(path, true);
        if (cavalierPline) {
            cavalierPlines.push(cavalierPline);
         //   debug.log(`📐 [MultiPlineOffset] Path ${i} dönüştürüldü: ${cavalierPline.vertexes.length} vertex`);
        } else {
            debug.warn(`⚠️ [MultiPlineOffset] Path ${i} dönüştürülemedi, atlanıyor`);
        }
    }
    
    if (cavalierPlines.length === 0) {
        console.error("❌ [MultiPlineOffset] Hiçbir path dönüştürülemedi");
        return [];
    }
    
    // Iteratif offset işlemi
    const allIterationResults: Path[][] = [];
    let currentPlines = cavalierPlines;
    let iteration = 0;
    
    try {
        while (iteration < maxIterations && currentPlines.length > 0) {
           // debug.log(`🔄 [MultiPlineOffset] İterasyon ${iteration + 1}: ${currentPlines.length} pline işleniyor`);
            
            // Multi-pline parallel offset çağrısı
         //   debug.log(`🔧 [MultiPlineOffset] multiPlineParallelOffset çağrılıyor: ${currentPlines.length} pline, offset=${offset}`);
            
            let offsetResult;
            try {
                offsetResult = multiPlineParallelOffset(currentPlines, offset);
             //   debug.log(`✅ [MultiPlineOffset] multiPlineParallelOffset başarılı:`, typeof offsetResult, offsetResult?.ccwPlines?.length, offsetResult?.cwPlines?.length);
            } catch (error) {
                console.error(`❌ [MultiPlineOffset] multiPlineParallelOffset hatası:`, error);
                break;
            }
            
            if (!offsetResult || (!offsetResult.ccwPlines?.length && !offsetResult.cwPlines?.length)) {
              //  debug.log(`✅ [MultiPlineOffset] İterasyon ${iteration + 1}: Offset sonucu boş, döngü sonlandırılıyor`);
                break;
            }
            
            // Sonuçları Path formatına dönüştür
            const iterationPaths: Path[] = [];
            
            // CCW plines (boundaries)
            if (offsetResult.ccwPlines?.length) {
           //     debug.log(`📊 [MultiPlineOffset] CCW plines: ${offsetResult.ccwPlines.length}`);
                for (let i = 0; i < offsetResult.ccwPlines.length; i++) {
                    const ccwPline = offsetResult.ccwPlines[i];
                    try {
                    //    debug.log(`🔄 [MultiPlineOffset] CCW pline ${i} dönüştürülüyor...`);
                        const path = cavalierPolylineToPath(ccwPline);
                    //    debug.log(`✅ [MultiPlineOffset] CCW pline ${i} → ${path.length} segment`);
                        
                        if (path.length > 0) {
                            // Path validasyon
                            const hasInvalidCoords = path.some(seg => 
                                !isFinite(seg.start.x) || !isFinite(seg.start.y) || 
                                !isFinite(seg.end.x) || !isFinite(seg.end.y)
                            );
                            
                            if (hasInvalidCoords) {
                                console.error(`❌ [MultiPlineOffset] CCW path ${i} geçersiz koordinatlar içeriyor!`);
                                continue;
                            }
                            
                            iterationPaths.push(path);
                        } else {
                            debug.warn(`⚠️ [MultiPlineOffset] CCW pline ${i} boş path üretti`);
                        }
                    } catch (err) {
                        console.error(`❌ [MultiPlineOffset] CCW pline ${i} dönüştürme hatası:`, err);
                    }
                }
            }
            
            // CW plines (islands)
            if (offsetResult.cwPlines?.length) {
              //  debug.log(`📊 [MultiPlineOffset] CW plines: ${offsetResult.cwPlines.length}`);
                for (let i = 0; i < offsetResult.cwPlines.length; i++) {
                    const cwPline = offsetResult.cwPlines[i];
                    try {
                 //       debug.log(`🔄 [MultiPlineOffset] CW pline ${i} dönüştürülüyor...`);
                        const path = cavalierPolylineToPath(cwPline);
//debug.log(`✅ [MultiPlineOffset] CW pline ${i} → ${path.length} segment`);
                       
                        if (path.length > 0) {
                            // Path validasyon
                            const hasInvalidCoords = path.some(seg => 
                                !isFinite(seg.start.x) || !isFinite(seg.start.y) || 
                                !isFinite(seg.end.x) || !isFinite(seg.end.y)
                            );
                            
                            if (hasInvalidCoords) {
                                console.error(`❌ [MultiPlineOffset] CW path ${i} geçersiz koordinatlar içeriyor!`);
                                continue;
                            }
                            
                            iterationPaths.push(path);
                        } else {
                            debug.warn(`⚠️ [MultiPlineOffset] CW pline ${i} boş path üretti`);
                        }
                    } catch (err) {
                        console.error(`❌ [MultiPlineOffset] CW pline ${i} dönüştürme hatası:`, err);
                    }
                }
            }
            
            if (iterationPaths.length > 0) {
                allIterationResults.push(iterationPaths);
              //  debug.log(`✅ [MultiPlineOffset] İterasyon ${iteration + 1}: ${iterationPaths.length} path oluşturuldu`);
            }
            
            // Bir sonraki iterasyon için input hazırla
            const nextInput: any[] = [];
            
            // 🛡️ Dejenere path kontrolü için minimum segment sayısı
            const MIN_VALID_SEGMENTS = 1; // ⚡ GEVŞETME: 3 → 1 (açık kontür desteği için)
            const MIN_PATH_LENGTH = Math.abs(offset) * 0.1; // ⚡ GEVŞETME: 0.5 → 0.1 (çok toleranslı - açık kontür için)
            
            // CCW plines'ı bir sonraki iterasyon için kullan
            if (offsetResult.ccwPlines?.length) {
                for (const ccwPline of offsetResult.ccwPlines) {
                    const cavalierInput = cavalierPolylineToPath(ccwPline);
                    
                    // Dejenere path kontrolü - sadece boş path'leri filtrele
                    if (cavalierInput.length < MIN_VALID_SEGMENTS) {
                        debug.warn(`⚠️ [MultiPlineOffset] Boş path, atlanıyor`);
                        continue;
                    }
                    
                    // Path uzunluğu kontrolü - çok kısa path'leri filtrele
                    let totalLength = 0;
                    for (const seg of cavalierInput) {
                        totalLength += distance(seg.start, seg.end);
                    }
                    if (totalLength < MIN_PATH_LENGTH) {
                        debug.warn(`⚠️ [MultiPlineOffset] Çok kısa path (${totalLength.toFixed(3)}mm < ${MIN_PATH_LENGTH.toFixed(3)}mm), atlanıyor`);
                        continue;
                    }
                    
                    const reconverted = pathToCavalierPolyline(cavalierInput, true);
                    if (reconverted) {
                        nextInput.push(reconverted);
                    }
                }
            }
            
            // CW plines'ı da bir sonraki iterasyon için kullan
            if (offsetResult.cwPlines?.length) {
                for (const cwPline of offsetResult.cwPlines) {
                    const cavalierInput = cavalierPolylineToPath(cwPline);
                    
                    // Dejenere path kontrolü - sadece boş path'leri filtrele
                    if (cavalierInput.length < MIN_VALID_SEGMENTS) {
                        debug.warn(`⚠️ [MultiPlineOffset] Boş path, atlanıyor`);
                        continue;
                    }
                    
                    // Path uzunluğu kontrolü - çok kısa path'leri filtrele
                    let totalLength = 0;
                    for (const seg of cavalierInput) {
                        totalLength += distance(seg.start, seg.end);
                    }
                    if (totalLength < MIN_PATH_LENGTH) {
                        debug.warn(`⚠️ [MultiPlineOffset] Çok kısa path (${totalLength.toFixed(3)}mm < ${MIN_PATH_LENGTH.toFixed(3)}mm), atlanıyor`);
                        continue;
                    }
                    
                    const reconverted = pathToCavalierPolyline(cavalierInput, true);
                    if (reconverted) {
                        nextInput.push(reconverted);
                    }
                }
            }
            
            // Eğer geçerli path kalmadıysa döngüden çık
            if (nextInput.length === 0) {
                debug.log(`✅ [MultiPlineOffset] Geçerli path kalmadı, döngü sonlandırılıyor (iterasyon ${iteration + 1})`);
                break;
            }
            
            currentPlines = nextInput;
            iteration++;
        }
        
        // Döngü güvenlik kontrolü
        if (iteration >= maxIterations) {
            console.warn(`⚠️ [MultiPlineOffset] Maksimum iterasyon (${maxIterations}) limiti aşıldı!`);
            console.warn(`   Offset işlemi tamamlanmamış olabilir. Son iterasyonda ${currentPlines.length} pline kaldı.`);
        }
        
     //   debug.log(`🎯 [MultiPlineOffset] Tamamlandı: ${iteration} iterasyon, toplam ${allIterationResults.length} sonuç grubu`);
        return allIterationResults;
        
    } catch (error) {
        console.error("❌ [MultiPlineOffset] Hata:", error);
        return allIterationResults; // Kısmi sonuçları döndür
    }
}

/**
 * Raw Offset - Demo'daki gibi ham offset işlemi (kesişim yönetimi olmadan)
 * @param path Offset uygulanacak yol
 * @param offset Offset mesafesi
 * @param showIntersects Kesişimleri göster/hesapla
 * @returns Offset sonuçları ve isteğe bağlı kesişim noktaları
 */
export function createRawOffset(
    path: Path, 
    offset: number, 
    showIntersects: boolean = false
): { offsetPaths: Path[], intersectPoints?: Point2D[] } {
    debug.log(`🔍 [RawOffset] Başlatılıyor: ${path.length}seg, offset=${offset}, intersects=${showIntersects}`);
    
    const cavalierPline = pathToCavalierPolyline(path, true);
    if (!cavalierPline) {
        console.error("❌ [RawOffset] Path Cavalier formatına dönüştürülemedi");
        return { offsetPaths: [] };
    }
    
        try {
            // Raw offset (handle_self_intersects = false)
            const rawOffsetResults = plineParallelOffset(cavalierPline, offset, false);
        
        if (!rawOffsetResults || !Array.isArray(rawOffsetResults)) {
            debug.warn("⚠️ [RawOffset] Geçersiz offset sonucu");
            return { offsetPaths: [] };
        }
        
        // Sonuçları Path formatına dönüştür
        const offsetPaths: Path[] = [];
        debug.log(`🔍 [RawOffset] ${rawOffsetResults.length} raw offset sonucu dönüştürülüyor`);
        
        for (let i = 0; i < rawOffsetResults.length; i++) {
            const result = rawOffsetResults[i];
            try {
                debug.log(`📐 [RawOffset] Sonuç ${i + 1} dönüştürülüyor:`, typeof result, result?.constructor?.name);
                
                const path = cavalierPolylineToPath(result);
                if (path && path.length > 0) {
                    offsetPaths.push(path);
                    debug.log(`✅ [RawOffset] Sonuç ${i + 1}: ${path.length} segment path oluşturuldu`);
                } else {
                    debug.warn(`⚠️ [RawOffset] Sonuç ${i + 1}: Boş path`);
                }
            } catch (err) {
                debug.warn(`⚠️ [RawOffset] Sonuç ${i + 1} dönüştürme hatası:`, err);
            }
        }
        
        const response: { offsetPaths: Path[], intersectPoints?: Point2D[] } = { offsetPaths };
        
        // Kesişim noktalarını hesapla (istenirse)
        if (showIntersects && offsetPaths.length > 1) {
            debug.log("🔍 [RawOffset] Kesişim noktaları hesaplanıyor...");
            const intersectPoints: Point2D[] = [];
            
            for (let i = 0; i < offsetPaths.length; i++) {
                for (let j = i + 1; j < offsetPaths.length; j++) {
                    try {
                        const pline1 = pathToCavalierPolyline(offsetPaths[i], true);
                        const pline2 = pathToCavalierPolyline(offsetPaths[j], true);
                        
                        if (pline1 && pline2) {
                            const intersects = plineFindIntersects(pline1, pline2);
                            if (Array.isArray(intersects)) {
                                for (const point of intersects) {
                                    if (point && typeof point.x === 'number' && typeof point.y === 'number') {
                                        intersectPoints.push({ x: point.x, y: point.y });
                                    }
                                }
                            }
                        }
                    } catch (err) {
                        debug.warn(`⚠️ [RawOffset] Kesişim hesaplama hatası (${i}-${j}):`, err);
                    }
                }
            }
            
            response.intersectPoints = intersectPoints;
            debug.log(`✅ [RawOffset] ${intersectPoints.length} kesişim noktası bulundu`);
        }
        
        debug.log(`✅ [RawOffset] Tamamlandı: ${offsetPaths.length} offset path`);
        return response;
        
            } catch (error) {
        console.error("❌ [RawOffset] Hata:", error);
        return { offsetPaths: [] };
    }
}

// Manuel offset fonksiyonu kaldırıldı - artık multi-pline offset kullanılıyor

/**
 * Vertex dizisini Path formatına dönüştürür
 * @param vertexes [x, y, bulge] triplet'leri dizisi
 * @param isClosed Path'in kapalı olup olmadığı
 * @returns Path dizisi
 */
export function convertVertexesToPath(vertexes: Array<[number, number, number]>, isClosed: boolean): Path {
    debug.log(`🔧 [convertVertexesToPath] Başlatılıyor: ${vertexes?.length} vertex, isClosed=${isClosed}`);
    
    if (!vertexes || vertexes.length < 2) {
        debug.warn("[offsetUtils] convertVertexesToPath: Yetersiz vertex sayısı");
        return [];
    }
    
    // İlk birkaç vertex'i debug için göster
    debug.log(`[convertVertexesToPath] İlk 3 vertex:`, vertexes.slice(0, 3));
    
    const path: Path = [];
    
    try {
        // Vertexleri işle - her biri [x, y, bulge] formatında
        for (let i = 0; i < vertexes.length - 1; i++) {
            const current = vertexes[i];
            const next = vertexes[i + 1];
            
            const [startX, startY, bulge] = current;
            const [endX, endY] = next;
            
            // NaN kontrolü
            if (isNaN(startX) || isNaN(startY) || isNaN(endX) || isNaN(endY) ||
                !isFinite(startX) || !isFinite(startY) || !isFinite(endX) || !isFinite(endY)) {
                debug.warn(`[offsetUtils] convertVertexesToPath: Geçersiz koordinat vertex[${i}]: [${startX}, ${startY}] -> [${endX}, ${endY}]`);
                continue;
            }
            
            const startPt = { x: startX, y: startY };
            const endPt = { x: endX, y: endY };
            
            if (Math.abs(bulge) < 1e-6 || isNaN(bulge) || !isFinite(bulge)) {
                // Düz çizgi
                path.push({ type: 'Line', start: startPt, end: endPt });
            } else {
                try {
                    // Yay segmenti - Bulge değerinden yay parametrelerini hesapla
                  //  debug.log(`🔧 [ARC_DEBUG] Vertex[${i}]: bulge=${bulge.toFixed(6)}, start=(${startX.toFixed(3)},${startY.toFixed(3)}), end=(${endX.toFixed(3)},${endY.toFixed(3)})`);
                    
                    const arcAngle = 4 * Math.atan(bulge);
                    const clockwise = bulge < 0;
                    
                  //  debug.log(`🔧 [ARC_DEBUG] arcAngle=${arcAngle.toFixed(6)}°, clockwise=${clockwise}`);
                    
                    // Merkez ve yarıçap hesaplama
                    const chord = vecLength(vecSub(endPt, startPt));
                    
                    if (chord < 1e-6) {
                        path.push({ type: 'Line', start: startPt, end: endPt });
                        continue;
                    }
                    
                    const halfAngle = arcAngle / 2;
                    if (isNaN(halfAngle) || Math.abs(halfAngle) < 1e-10) {
                        path.push({ type: 'Line', start: startPt, end: endPt });
                        continue;
                    }
                    
                    const sinHalfAngle = Math.sin(Math.abs(halfAngle));
                    if (Math.abs(sinHalfAngle) < 1e-10) {
                        path.push({ type: 'Line', start: startPt, end: endPt });
                        continue;
                    }
                    
                    const radius = chord / (2 * sinHalfAngle);
                    debug.log(`🔧 [ARC_DEBUG] chord=${chord.toFixed(3)}, sinHalfAngle=${sinHalfAngle.toFixed(6)}, radius=${radius.toFixed(3)}`);
                    
                    if (isNaN(radius) || !isFinite(radius) || radius <= 0) {
                        debug.warn(`⚠️ [ARC_DEBUG] Geçersiz radius (${radius}), Line'a dönüştürülüyor`);
                        path.push({ type: 'Line', start: startPt, end: endPt });
                        continue;
                    }
                    
                    // Chord vektörü ve normali
                    const chordVec = vecSub(endPt, startPt);
                    const normalizedChord = vecNormalize(chordVec);
                    
                    let normal;
                    if (arcAngle > 0) {
                        normal = { x: -normalizedChord.y, y: normalizedChord.x };
                    } else {
                        normal = { x: normalizedChord.y, y: -normalizedChord.x };
                    }
                    
                    const midToCenter = radius * Math.cos(Math.abs(halfAngle));
                    const centerOffset = vecScale(normal, midToCenter);
                    
                    const midPoint = {
                        x: startPt.x + chordVec.x * 0.5,
                        y: startPt.y + chordVec.y * 0.5
                    };
                    
                    const centerPoint = {
                        x: midPoint.x + centerOffset.x,
                        y: midPoint.y + centerOffset.y
                    };
                    
                    if (isNaN(centerPoint.x) || isNaN(centerPoint.y)) {
                        path.push({ type: 'Line', start: startPt, end: endPt });
                        continue;
                    }
                    
                    const startVec = vecSub(startPt, centerPoint);
                    const startAngle = Math.atan2(startVec.y, startVec.x);
                    const endVec = vecSub(endPt, centerPoint);
                    const endAngle = Math.atan2(endVec.y, endVec.x);
                    
                    debug.log(`✅ [ARC_DEBUG] Arc oluşturuldu: center=(${centerPoint.x.toFixed(3)},${centerPoint.y.toFixed(3)}), radius=${radius.toFixed(3)}, startAngle=${startAngle.toFixed(3)}, endAngle=${endAngle.toFixed(3)}`);
                    
                    path.push({
                        type: 'Arc',
                        center: centerPoint,
                        radius: radius,
                        startAngle: startAngle,
                        endAngle: endAngle,
                        clockwise: clockwise,
                        start: startPt,
                        end: endPt
                    });
                } catch (err) {
                    console.error("[offsetUtils] convertVertexesToPath: Yay hesaplama hatası:", err);
                    path.push({ type: 'Line', start: startPt, end: endPt });
                }
            }
        }
        
        // Kapalı polylineler için son->ilk segmenti ekle (bulge'a göre Arc/Line)
        if (isClosed && vertexes.length >= 2) {
            const first = vertexes[0];
            const last = vertexes[vertexes.length - 1];
            const [firstX, firstY, firstBulge] = first; // ilk vertex bulge genelde bir önceki kenara aittir
            const [lastX, lastY, lastBulge] = last;

            const firstPt = { x: firstX, y: firstY };
            const lastPt = { x: lastX, y: lastY };

            const hasDuplicateClosing = pointsApproximatelyEqual(firstPt, lastPt, 1e-6);
            if (!hasDuplicateClosing) {
                const closingBulge = (typeof lastBulge === 'number' && isFinite(lastBulge)) ? lastBulge : 0;
                if (Math.abs(closingBulge) < 1e-6) {
                    // Düz kapanış
                    path.push({ type: 'Line', start: lastPt, end: firstPt });
                } else {
                    // Bulge'tan kapanış arc'ını oluştur
                    try {
                        const arcAngle = 4 * Math.atan(closingBulge);
                        const clockwise = closingBulge < 0;

                        const chord = vecLength(vecSub(firstPt, lastPt));
                        if (chord < 1e-6) {
                            path.push({ type: 'Line', start: lastPt, end: firstPt });
                        } else {
                            const halfAngle = arcAngle / 2;
                            const sinHalfAngle = Math.sin(Math.abs(halfAngle));
                            if (Math.abs(sinHalfAngle) < 1e-10) {
                                path.push({ type: 'Line', start: lastPt, end: firstPt });
                            } else {
                                const radius = chord / (2 * sinHalfAngle);
                                const chordVec = vecSub(firstPt, lastPt);
                                const normalizedChord = vecNormalize(chordVec);
                                const normal = arcAngle > 0
                                    ? { x: -normalizedChord.y, y: normalizedChord.x }
                                    : { x: normalizedChord.y, y: -normalizedChord.x };
                                const midToCenter = radius * Math.cos(Math.abs(halfAngle));
                                const centerOffset = vecScale(normal, midToCenter);
                                const midPoint = {
                                    x: lastPt.x + chordVec.x * 0.5,
                                    y: lastPt.y + chordVec.y * 0.5
                                };
                                const centerPoint = {
                                    x: midPoint.x + centerOffset.x,
                                    y: midPoint.y + centerOffset.y
                                };
                                const startVec = vecSub(lastPt, centerPoint);
                                const endVec = vecSub(firstPt, centerPoint);
                                const startAngle = Math.atan2(startVec.y, startVec.x);
                                const endAngle = Math.atan2(endVec.y, endVec.x);

                                path.push({
                                    type: 'Arc',
                                    center: centerPoint,
                                    radius: radius,
                                    startAngle,
                                    endAngle,
                                    clockwise,
                                    start: lastPt,
                                    end: firstPt
                                });
                            }
                        }
                    } catch (e) {
                        debug.warn('[offsetUtils] Kapanış arc hesaplanamadı, Line kullanıldı:', e);
                        path.push({ type: 'Line', start: lastPt, end: firstPt });
                    }
                }
            }
        }
        
        // Kapalı yol ise son segmentin bitiş noktasını ilk segmentin başlangıcına eşitle
        if (path.length > 1 && isClosed) {
            path[path.length - 1].end = { ...path[0].start };
        }
        
        return path;
    } catch (error) {
        console.error("[offsetUtils] convertVertexesToPath: Path dönüştürme hatası:", error);
        return [];
    }
}