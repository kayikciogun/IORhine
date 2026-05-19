export class DxfWriter {
  private entities: string[] = [];

  constructor() {
    this.entities = [];
  }

  public addCircle(x: number, y: number, radius: number, layer = '0') {
    this.entities.push(
      '0', 'CIRCLE',
      '8', layer,
      '10', x.toFixed(4),
      '20', y.toFixed(4),
      '30', '0.0',
      '40', radius.toFixed(4)
    );
  }

  public addLine(x1: number, y1: number, x2: number, y2: number, layer = '0') {
    this.entities.push(
      '0', 'LINE',
      '8', layer,
      '10', x1.toFixed(4),
      '20', y1.toFixed(4),
      '30', '0.0',
      '11', x2.toFixed(4),
      '21', y2.toFixed(4),
      '31', '0.0'
    );
  }

  public addPolyline(points: {x: number, y: number, bulge?: number}[], isClosed: boolean = true, layer = '0') {
    if (points.length < 2) return;

    this.entities.push(
      '0', 'LWPOLYLINE',
      '8', layer,
      '90', points.length.toString(),
      '70', isClosed ? '1' : '0'
    );

    for (const p of points) {
      this.entities.push(
        '10', p.x.toFixed(4),
        '20', p.y.toFixed(4)
      );
      if (p.bulge !== undefined && Math.abs(p.bulge) > 1e-6) {
        this.entities.push('42', p.bulge.toFixed(4));
      }
    }
  }

  public addText(text: string, x: number, y: number, height: number = 2, layer = '0') {
    this.entities.push(
      '0', 'TEXT',
      '8', layer,
      '10', x.toFixed(4),
      '20', y.toFixed(4),
      '30', '0.0',
      '40', height.toFixed(4),
      '1', text
    );
  }

  public generate(): string {
    const header = [
      '0', 'SECTION',
      '2', 'HEADER',
      '9', '$MEASUREMENT',
      '70', '1',
      '9', '$INSUNITS',
      '70', '4',
      '0', 'ENDSEC',
      '0', 'SECTION',
      '2', 'ENTITIES'
    ];

    const footer = [
      '0', 'ENDSEC',
      '0', 'EOF'
    ];

    return [...header, ...this.entities, ...footer].join('\n') + '\n';
  }
}
