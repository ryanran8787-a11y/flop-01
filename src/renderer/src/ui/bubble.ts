/**
 * 最小文字氣泡（TTS 斷網降級顯示用；完整對話 UI 在階段 7/8）。
 */
export class Bubble {
  private el: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private doc: Document) {}

  show(text: string, ms = 6000): void {
    this.hide();
    const el = this.doc.createElement('div');
    el.setAttribute('data-bubble', '1');
    el.textContent = text;
    el.style.cssText =
      'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);max-width:82%;' +
      'padding:10px 16px;border-radius:14px;background:rgba(16,20,36,.9);color:#fff;' +
      'font-size:14px;line-height:1.5;z-index:9000;pointer-events:none;white-space:pre-wrap;';
    this.doc.body.appendChild(el);
    this.el = el;
    if (ms > 0) {
      this.timer = setTimeout(() => this.hide(), ms);
    }
  }

  hide(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.el?.remove();
    this.el = null;
  }
}
