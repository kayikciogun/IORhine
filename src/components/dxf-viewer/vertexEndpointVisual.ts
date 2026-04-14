import * as THREE from 'three';

export type VertexPickVisual = 'hidden' | 'hover' | 'selection' | 'excluded';

/**
 * Görünmez uç pick küresi: yalnızca hover / seçim / exclude anında hafif dolgu (opacity).
 */
export function applyVertexPickMeshAppearance(group: THREE.Object3D, mode: VertexPickVisual): void {
    const mesh = group.children.find(
        (c): c is THREE.Mesh => c instanceof THREE.Mesh && !!(c as THREE.Mesh).userData?.isVertexEndpointPick
    );
    if (!mesh?.material || !(mesh.material instanceof THREE.MeshBasicMaterial)) return;
    const m = mesh.material as THREE.MeshBasicMaterial;
    m.transparent = true;
    m.depthWrite = false;
    switch (mode) {
        case 'hidden':
            m.opacity = 0;
            m.color.setHex(0xffffff);
            break;
        case 'hover':
            m.opacity = 0.44;
            m.color.setHex(0x5dffbf);
            break;
        case 'selection':
            m.opacity = 0.58;
            m.color.setHex(0x00a85c);
            break;
        case 'excluded':
            m.opacity = 0.5;
            m.color.setHex(0xff4444);
            break;
    }
    m.needsUpdate = true;
}
