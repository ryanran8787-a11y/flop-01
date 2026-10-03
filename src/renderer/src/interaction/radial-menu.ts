/**
 * 環形選單（DOM）：換裝 / 設定 / 靜音 / 離開。
 * 位置數學為純函數（可測）；DOM 類只做薄封裝（jsdom 測試）。
 */
export type RadialItemId = 'outfit' | 'settings' | 'mute' | 'leave';

export interface RadialItem {
  id: RadialItemId;
  label: string;
}

/** 按鈕在圓上的偏移（度轉弧度，-90° 起始即正上方）。 */
export function radialLayout(count: number, radius: number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i / Math.max(count, 1)) * Math.PI * 2;
    pts.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
  }
  return pts;
}

export class RadialMenu {
  private root: HTMLElement | null = null;
  private backdrop: HTMLElement | null = null;

  constructor(
    private doc: Document,
    private onSelect: (id: RadialItemId) => void,
  ) {}

  get isOpen(): boolean {
    return this.root !== null;
  }

  open(x: number, y: number, muted: boolean): void {
    this.close();
    const items: RadialItem[] = [
      { id: 'outfit', label: '換裝' },
      { id: 'settings', label: '設定' },
      { id: 'mute', label: muted ? '取消靜音' : '靜音' },
      { id: 'leave', label: '離開' },
    ];
    const bd = this.doc.createElement('div');
    bd.setAttribute('data-radial', 'backdrop');
    bd.style.cssText = 'position:fixed;inset:0;background:transparent;z-index:9998;';
    bd.addEventListener('pointerdown', () => this.close());
    this.doc.body.appendChild(bd);
    this.backdrop = bd;

    const root = this.doc.createElement('div');
    root.setAttribute('data-radial', 'menu');
    root.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:9999;pointer-events:none;`;
    const pts = radialLayout(items.length, 84);
    items.forEach((item, i) => {
      const p = pts[i] ?? { x: 0, y: 0 };
      const b = this.doc.createElement('button');
      b.textContent = item.label;
      b.setAttribute('data-item', item.id);
      b.style.cssText = `position:absolute;left:${p.x}px;top:${p.y}px;transform:translate(-50%,-50%);pointer-events:auto;padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.35);background:rgba(20,24,40,.88);color:#fff;font-size:13px;cursor:pointer;white-space:nowrap;`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = item.id;
        this.close();
        this.onSelect(id);
      });
      root.appendChild(b);
    });
    this.doc.body.appendChild(root);
    this.root = root;
  }

  close(): void {
    this.root?.remove();
    this.backdrop?.remove();
    this.root = null;
    this.backdrop = null;
  }
}
