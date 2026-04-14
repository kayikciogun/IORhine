import * as THREE from 'three';
import { debug } from '../../Utils/debug';
import { calcAngleFromSceneObject } from '../../Utils/contourAngle';

// Mesafe görselleştirme fonksiyonları (Kullanıcı isteği üzerine kaldırıldı)
export function clearDistanceVisualization() {
  // Kaldırıldığı için boş fonksiyon
}

if (typeof window !== 'undefined') {
  (window as any).clearDistanceVisualization = clearDistanceVisualization;
}

export interface GeometryProperty {
  label: string;
  value: string;
  unit?: string;
}

export interface GeometryInfo {
  type: string;
  handle?: string;
  layer?: string;
  properties: GeometryProperty[];
}

// Koordinat formatı
function formatCoordinate(value: number): string {
  return value.toFixed(3);
}

// Uzunluk formatı
function formatLength(value: number): string {
  return value.toFixed(3);
}

// Açı formatı (radyandan dereceye)
function formatAngle(radians: number): string {
  const degrees = (radians * 180) / Math.PI;
  return degrees.toFixed(2);
}

// İki nokta arası mesafe hesaplama
function calculateDistance(p1: THREE.Vector3, p2: THREE.Vector3): number {
  return p1.distanceTo(p2);
}

// Yay uzunluğu hesaplama
function calculateArcLength(radius: number, startAngle: number, endAngle: number): number {
  let angle = Math.abs(endAngle - startAngle);
  // Eğer açı 2π'den büyükse, tam daire
  if (angle > 2 * Math.PI) {
    angle = 2 * Math.PI;
  }
  return radius * angle;
}

// LINE özellikleri
function getLineProperties(userData: any): GeometryProperty[] {
  const properties: GeometryProperty[] = [];
  
  if (userData.data?.startPoint && userData.data?.endPoint) {
    const start = userData.data.startPoint;
    const end = userData.data.endPoint;
    
    // Uzunluk (PropertiesPanel.vue'daki length özelliği)
    const startVec = new THREE.Vector3(start.x, start.y, start.z || 0);
    const endVec = new THREE.Vector3(end.x, end.y, end.z || 0);
    const length = calculateDistance(startVec, endVec);
    
    properties.push({
      label: 'Length',
      value: formatLength(length),
      unit: 'mm'
    });
    
    // Başlangıç noktası koordinatları
    properties.push({
      label: 'Start X',
      value: formatCoordinate(start.x)
    });
    
    properties.push({
      label: 'Start Y',
      value: formatCoordinate(start.y)
    });
    
    if (start.z && start.z !== 0) {
      properties.push({
        label: 'Start Z',
        value: formatCoordinate(start.z)
      });
    }
    
    // Bitiş noktası koordinatları
    properties.push({
      label: 'End X',
      value: formatCoordinate(end.x)
    });
    
    properties.push({
      label: 'End Y',
      value: formatCoordinate(end.y)
    });
    
    if (end.z && end.z !== 0) {
      properties.push({
        label: 'End Z',
        value: formatCoordinate(end.z)
      });
    }
    
    // Açı (X eksenine göre)
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const angle = Math.atan2(dy, dx);
    
    properties.push({
      label: 'Angle',
      value: formatAngle(angle),
      unit: '°'
    });
  }
  
  return properties;
}

// CIRCLE özellikleri
function getCircleProperties(userData: any): GeometryProperty[] {
  const properties: GeometryProperty[] = [];
  
  if (userData.data?.center && userData.data?.radius) {
    const center = userData.data.center;
    const radius = userData.data.radius;
    
    // Yarıçap (PropertiesPanel.vue'daki radius özelliği)
    properties.push({
      label: 'Radius',
      value: formatLength(radius),
      unit: 'mm'
    });
    
    // Çap (PropertiesPanel.vue'daki diameter özelliği)
    properties.push({
      label: 'Diameter',
      value: formatLength(radius * 2),
      unit: 'mm'
    });
    
    // Çevre (PropertiesPanel.vue'daki circumference özelliği)
    const circumference = 2 * Math.PI * radius;
    properties.push({
      label: 'Circumference',
      value: formatLength(circumference),
      unit: 'mm'
    });
    
    // Merkez koordinatları (PropertiesPanel.vue'daki center.x, center.y özelliği)
    properties.push({
      label: 'Point X',
      value: formatCoordinate(center.x)
    });
    
    properties.push({
      label: 'Point Y',
      value: formatCoordinate(center.y)
    });
    
    if (center.z && center.z !== 0) {
      properties.push({
        label: 'Point Z',
        value: formatCoordinate(center.z)
      });
    }
    
    // Alan
    const area = Math.PI * radius * radius;
    properties.push({
      label: 'Alan',
      value: formatLength(area),
      unit: 'mm²'
    });
  }
  
  return properties;
}

// ARC özellikleri
function getArcProperties(userData: any): GeometryProperty[] {
  const properties: GeometryProperty[] = [];
  
  if (userData.data?.center && userData.data?.radius && 
      userData.data?.startAngle !== undefined && userData.data?.endAngle !== undefined) {
    const center = userData.data.center;
    const radius = userData.data.radius;
    const startAngle = userData.data.startAngle;
    const endAngle = userData.data.endAngle;
    
    // Yarıçap (PropertiesPanel.vue'daki radius özelliği)
    properties.push({
      label: 'Radius',
      value: formatLength(radius),
      unit: 'mm'
    });
    
    // Yay uzunluğu (PropertiesPanel.vue'daki arcLength özelliği)
    const arcLength = calculateArcLength(radius, startAngle, endAngle);
    properties.push({
      label: 'Arc Length',
      value: formatLength(arcLength),
      unit: 'mm'
    });
    
    // Merkez koordinatları (PropertiesPanel.vue'daki center.x, center.y özelliği)
    properties.push({
      label: 'Center Point X',
      value: formatCoordinate(center.x)
    });
    
    properties.push({
      label: 'Center Point Y',
      value: formatCoordinate(center.y)
    });
    
    if (center.z && center.z !== 0) {
      properties.push({
        label: 'Center Point Z',
        value: formatCoordinate(center.z)
      });
    }
    
    // Başlangıç açısı
    properties.push({
      label: 'Start Angle',
      value: formatAngle(startAngle),
      unit: '°'
    });
    
    // Bitiş açısı
    properties.push({
      label: 'End Angle',
      value: formatAngle(endAngle),
      unit: '°'
    });
    
    // Açı farkı
    let angleDiff = Math.abs(endAngle - startAngle);
    if (angleDiff > 2 * Math.PI) angleDiff = 2 * Math.PI;
    
    properties.push({
      label: 'Angle Difference',
      value: formatAngle(angleDiff),
      unit: '°'
    });
  }
  
  return properties;
}

// POLYLINE özellikleri
function getPolylineProperties(userData: any): GeometryProperty[] {
  const properties: GeometryProperty[] = [];
  
  if (userData.data?.vertices && Array.isArray(userData.data.vertices)) {
    const vertices = userData.data.vertices;
    
    // Toplam uzunluk hesaplama (PropertiesPanel.vue'daki length özelliği)
    let totalLength = 0;
    for (let i = 0; i < vertices.length - 1; i++) {
      const p1 = new THREE.Vector3(vertices[i].x, vertices[i].y, vertices[i].z || 0);
      const p2 = new THREE.Vector3(vertices[i + 1].x, vertices[i + 1].y, vertices[i + 1].z || 0);
      totalLength += calculateDistance(p1, p2);
    }
    
    // Kapalı polyline ise son nokta ile ilk nokta arasındaki mesafeyi ekle
    if (userData.data.isClosed && vertices.length > 2) {
      const first = new THREE.Vector3(vertices[0].x, vertices[0].y, vertices[0].z || 0);
      const last = new THREE.Vector3(vertices[vertices.length - 1].x, vertices[vertices.length - 1].y, vertices[vertices.length - 1].z || 0);
      totalLength += calculateDistance(first, last);
    }
    
    properties.push({
      label: 'Length',
      value: formatLength(totalLength),
      unit: 'mm'
    });
    
    // Nokta sayısı
    properties.push({
      label: 'Vertices',
      value: vertices.length.toString()
    });
    
    // Kapalı mı?
    properties.push({
      label: 'Status',
      value: userData.data.isClosed ? 'Closed' : 'Open'
    });
    
    // İlk nokta koordinatları
    if (vertices.length > 0) {
      const firstVertex = vertices[0];
      properties.push({
        label: 'Start X',
        value: formatCoordinate(firstVertex.x)
      });
      
      properties.push({
        label: 'Start Y',
        value: formatCoordinate(firstVertex.y)
      });
      
      if (firstVertex.z && firstVertex.z !== 0) {
        properties.push({
          label: 'Start Z',
          value: formatCoordinate(firstVertex.z)
        });
      }
    }
    
    // Son nokta koordinatları (kapalı değilse)
    if (vertices.length > 1 && !userData.data.isClosed) {
      const lastVertex = vertices[vertices.length - 1];
      properties.push({
        label: 'End X',
        value: formatCoordinate(lastVertex.x)
      });
      
      properties.push({
        label: 'End Y',
        value: formatCoordinate(lastVertex.y)
      });
      
      if (lastVertex.z && lastVertex.z !== 0) {
        properties.push({
          label: 'End Z',
          value: formatCoordinate(lastVertex.z)
        });
      }
    }
  }
  
  return properties;
}

// ELLIPSE özellikleri
function getEllipseProperties(userData: any): GeometryProperty[] {
  const properties: GeometryProperty[] = [];
  
  if (userData.data?.center && userData.data?.majorAxisEndPoint && userData.data?.axisRatio) {
    const center = userData.data.center;
    const majorAxis = userData.data.majorAxisEndPoint;
    const axisRatio = userData.data.axisRatio;
    
    // Merkez koordinatları
    properties.push({
      label: 'Center X',
      value: formatCoordinate(center.x)
    });
    
    properties.push({
      label: 'Center Y',
      value: formatCoordinate(center.y)
    });
    
    if (center.z && center.z !== 0) {
      properties.push({
        label: 'Center Z',
        value: formatCoordinate(center.z)
      });
    }
    
    // Büyük eksen yarıçapı
    const majorRadius = Math.sqrt(majorAxis.x * majorAxis.x + majorAxis.y * majorAxis.y);
    properties.push({
      label: 'Major Radius',
      value: formatLength(majorRadius),
      unit: 'mm'
    });
    
    // Küçük eksen yarıçapı
    const minorRadius = majorRadius * axisRatio;
    properties.push({
      label: 'Minor Radius',
      value: formatLength(minorRadius),
      unit: 'mm'
    });
    
    // Çevre (yaklaşık)
    const circumference = Math.PI * (3 * (majorRadius + minorRadius) - Math.sqrt((3 * majorRadius + minorRadius) * (majorRadius + 3 * minorRadius)));
    properties.push({
      label: 'Circumference',
      value: formatLength(circumference),
      unit: 'mm'
    });
    
    // Alan
    const area = Math.PI * majorRadius * minorRadius;
    properties.push({
      label: 'Area',
      value: formatLength(area),
      unit: 'mm²'
    });
  }
  
  return properties;
}

// SPLINE özellikleri
function getSplineProperties(userData: any): GeometryProperty[] {
  const properties: GeometryProperty[] = [];
  
  if (userData.data?.controlPoints && Array.isArray(userData.data.controlPoints)) {
    const controlPoints = userData.data.controlPoints;
    
    // Kontrol noktası sayısı
    properties.push({
      label: 'Control Points',
      value: controlPoints.length.toString()
    });
    
    // Derece
    if (userData.data.degree !== undefined) {
      properties.push({
        label: 'Degree',
        value: userData.data.degree.toString()
      });
    }
    
    // Kapalı mı?
    properties.push({
      label: 'Status',
      value: userData.data.isClosed ? 'Closed' : 'Open'
    });
    
    // İlk kontrol noktası
    if (controlPoints.length > 0) {
      const firstPoint = controlPoints[0];
      properties.push({
        label: 'Start X',
        value: formatCoordinate(firstPoint.x)
      });
      
      properties.push({
        label: 'Start Y',
        value: formatCoordinate(firstPoint.y)
      });
      
      if (firstPoint.z && firstPoint.z !== 0) {
        properties.push({
          label: 'Start Z',
          value: formatCoordinate(firstPoint.z)
        });
      }
    }
    
    // Son kontrol noktası
    if (controlPoints.length > 1) {
      const lastPoint = controlPoints[controlPoints.length - 1];
      properties.push({
        label: 'End X',
        value: formatCoordinate(lastPoint.x)
      });
      
      properties.push({
        label: 'End Y',
        value: formatCoordinate(lastPoint.y)
      });
      
      if (lastPoint.z && lastPoint.z !== 0) {
        properties.push({
          label: 'End Z',
          value: formatCoordinate(lastPoint.z)
        });
      }
    }
  }
  
  return properties;
}

// TEXT özellikleri
function getTextProperties(userData: any): GeometryProperty[] {
  const properties: GeometryProperty[] = [];
  
  if (userData.data?.text) {
    // Metin içeriği
    properties.push({
      label: 'Text',
      value: userData.data.text.toString()
    });
    
    // Yükseklik
    if (userData.data.height !== undefined) {
      properties.push({
        label: 'Height',
        value: formatLength(userData.data.height),
        unit: 'mm'
      });
    }
    
    // Pozisyon
    if (userData.data.position) {
      const pos = userData.data.position;
      properties.push({
        label: 'Position X',
        value: formatCoordinate(pos.x)
      });
      
      properties.push({
        label: 'Position Y',
        value: formatCoordinate(pos.y)
      });
      
      if (pos.z && pos.z !== 0) {
        properties.push({
          label: 'Position Z',
          value: formatCoordinate(pos.z)
        });
      }
    }
    
    // Rotasyon açısı
    if (userData.data.rotation !== undefined) {
      properties.push({
        label: 'Rotation',
        value: formatAngle(userData.data.rotation),
        unit: '°'
      });
    }
  }
  
  return properties;
}

// POINT özellikleri
function getPointProperties(userData: any): GeometryProperty[] {
  const properties: GeometryProperty[] = [];
  
  // Center point'ler için userData.data.point kullanılıyor
  // Normal POINT entity'ler için userData.data.position kullanılıyor
  const pos = userData.data?.point || userData.data?.position;

  if (pos) {
    if (userData.data?.isVertexPoint && Array.isArray(userData.data?.vertexContributors) && userData.data.vertexContributors.length > 0) {
      properties.push({
        label: 'Snap',
        value: `${userData.data.vertexContributors.length} bağlantı`
      });
    }
    properties.push({
      label: 'X',
      value: formatCoordinate(pos.x)
    });

    properties.push({
      label: 'Y',
      value: formatCoordinate(pos.y)
    });

    if (pos.z && pos.z !== 0) {
      properties.push({
        label: 'Z',
        value: formatCoordinate(pos.z)
      });
    }

    // Eğer bu bir center point ise parent bilgisini göster
    if (userData.data?.parentType && userData.data?.parentHandle) {
      properties.push({
        label: 'Parent Type',
        value: userData.data.parentType
      });

      properties.push({
        label: 'Parent Handle',
        value: userData.data.parentHandle
      });
    }
  }
  
  return properties;
}

// Ana fonksiyon - obje tipine göre özellikleri döndürür
export function getGeometryInfo(object: THREE.Object3D): GeometryInfo | null {
  if (!object.userData) return null;
  
  const type = object.userData.type;
  const handle = object.userData.handle || object.uuid;
  const layer = object.userData.layer;
  const displayType =
    object.userData?.type === 'POINT' && object.userData?.data?.isVertexPoint
      ? 'VERTEX (Snap)'
      : type;
  
  let properties: GeometryProperty[] = [];
  
  switch (type) {
    case 'LINE':
      properties = getLineProperties(object.userData);
      break;
    case 'CIRCLE':
      properties = getCircleProperties(object.userData);
      break;
    case 'ARC':
      properties = getArcProperties(object.userData);
      break;
    case 'POLYLINE':
    case 'LWPOLYLINE':
      properties = getPolylineProperties(object.userData);
      break;
    case 'ELLIPSE':
      properties = getEllipseProperties(object.userData);
      break;
    case 'SPLINE':
      properties = getSplineProperties(object.userData);
      break;
    case 'TEXT':
    case 'MTEXT':
      properties = getTextProperties(object.userData);
      break;
    case 'POINT':
      properties = getPointProperties(object.userData);
      break;
    default:
      // Bilinmeyen tip için temel bilgiler
      properties = [
        {
          label: 'Type',
          value: type || 'Unknown'
        }
      ];
  }
  
  // Placement açısını hesapla (pick & place için)
  const placementAngle = calcAngleFromSceneObject(object);
  properties.push({
    label: 'Placement Açı',
    value: placementAngle.toFixed(2),
    unit: '°'
  });

  return {
    type: displayType || type || 'Bilinmeyen',
    handle,
    layer,
    properties
  };
}

// Çoklu seçim için özet bilgi
export function getSelectionSummary(objects: Set<THREE.Object3D>): GeometryInfo {
  const typeCount: { [key: string]: number } = {};
  let totalObjects = 0;
  
  objects.forEach(obj => {
    const type = obj.userData?.type || 'Bilinmeyen';
    typeCount[type] = (typeCount[type] || 0) + 1;
    totalObjects++;
  });
  
  const properties: GeometryProperty[] = [
    {
      label: 'Total Objects',
      value: totalObjects.toString()
    }
  ];
  
  // Her tip için sayı
  Object.entries(typeCount).forEach(([type, count]) => {
    properties.push({
      label: type,
      value: count.toString()
    });
  });
  
  // İki obje seçiliyse aralarındaki mesafeyi hesapla
  // (Kullanıcı isteği üzerine mesafe hesaplaması kapalı)
  
  return {
    type: 'Multi Selection',
    properties
  };
}