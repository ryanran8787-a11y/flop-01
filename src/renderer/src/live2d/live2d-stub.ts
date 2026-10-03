import type { Action, Emotion, MouthViseme } from '../../../shared/types.js';
import type { IAvatarRenderer } from '../../../shared/providers.js';

/**
 * Live2D 渲染器 stub（預留介面，不實作）。
 * 所有呼叫皆為 no-op（warn 一次）；loadModel 明確拋錯，呼叫方退回 VRM。
 */
export class Live2DNotImplemented extends Error {
  constructor() {
    super('Live2D 渲染器尚未實作（預留介面）');
    this.name = 'Live2DNotImplemented';
  }
}

export class Live2DRendererStub implements IAvatarRenderer {
  readonly kind = 'live2d-stub' as const;
  private warned = false;

  private warn(): void {
    if (!this.warned) {
      this.warned = true;
      // eslint-disable-next-line no-console
      console.warn('[live2d-stub] 尚未實作，所有呼叫為 no-op');
    }
  }

  async loadModel(_pathOrUrl: string): Promise<void> {
    throw new Live2DNotImplemented();
  }

  setEmotion(_e: Emotion): void {
    this.warn();
  }

  playAction(_a: Action): void {
    this.warn();
  }

  setLookAt(_yawDeg: number, _pitchDeg: number): void {
    this.warn();
  }

  setMouth(_viseme: MouthViseme, _weight: number): void {
    this.warn();
  }

  setThinking(_on: boolean): void {
    this.warn();
  }

  dispose(): void {
    this.warn();
  }
}
