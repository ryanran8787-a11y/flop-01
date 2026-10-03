import type { Emotion, MouthViseme } from '../../../shared/types.js';
import {
  BLINK_CANDIDATES,
  EMOTION_PRESET_CANDIDATES,
  MOUTH_PRESET_CANDIDATES,
  isMouthPreset,
  resolvePreset,
} from './expression-map.js';

/**
 * 表情控制器的最小 VRM 依賴（結構型別，真實 VRMExpressionManager 可直接傳入）。
 * d.ts 已核實：setValue/getValue/getExpression/expressionMap 皆存在。
 */
export interface ExpressionSink {
  setValue: (name: string, weight: number) => void;
  getExpression: (name: string) => unknown | null;
  expressionMap: Record<string, unknown>;
}

const noSink: ExpressionSink = {
  setValue: () => {},
  getExpression: () => null,
  expressionMap: {},
};

/**
 * 分層保證：
 * - setEmotion 只寫「非嘴部」preset，且離開前先把其他情緒 preset 歸零
 * - setMouth 只寫嘴部 preset，'closed' 時全歸零
 * - 兩層互不碰對方的 preset（以 isMouthPreset 劃界）
 * - 情緒權重用 damp 平滑過渡；口型/眨眼由呼叫方逐幀直寫
 */
export class ExpressionController {
  private sink: ExpressionSink = noSink;
  private emotionTarget: Emotion = 'idle';
  private emotionWeights = new Map<string, number>();
  private mouthResolved = new Map<string, string | null>();

  bind(sink: ExpressionSink | null): void {
    this.sink = sink ?? noSink;
    this.mouthResolved.clear();
    // 綁定新模型時先全歸零（嘴部也歸零，呼叫方會重寫）
    this.clearAll();
  }

  available(): Set<string> {
    return new Set(Object.keys(this.sink.expressionMap));
  }

  setEmotion(e: Emotion): void {
    this.emotionTarget = e;
  }

  /** 情緒平滑：每幀呼叫，lambda 約 8。 */
  update(dt: number): void {
    const avail = this.available();
    const targetName = resolvePreset(avail, EMOTION_PRESET_CANDIDATES[this.emotionTarget]);
    const k = 1 - Math.exp(-8 * Math.max(dt, 0));
    // 所有非嘴部情緒候選都參與衰減，避免殘留
    const all = new Set<string>();
    for (const list of Object.values(EMOTION_PRESET_CANDIDATES)) {
      const n = resolvePreset(avail, list);
      if (n !== null && !isMouthPreset(n)) all.add(n);
    }
    for (const name of all) {
      const goal = name === targetName ? 1 : 0;
      const cur = this.emotionWeights.get(name) ?? 0;
      const next = cur + (goal - cur) * k;
      this.emotionWeights.set(name, next);
      this.sink.setValue(name, next);
    }
  }

  setMouth(viseme: MouthViseme, weight: number): void {
    const avail = this.available();
    if (viseme === 'closed') {
      this.zeroMouth(avail);
      return;
    }
    const key = `${viseme}`;
    let name = this.mouthResolved.get(key);
    if (name === undefined) {
      name = resolvePreset(avail, MOUTH_PRESET_CANDIDATES[viseme]);
      this.mouthResolved.set(key, name);
    }
    this.zeroMouth(avail, name);
    if (name !== null) this.sink.setValue(name, Math.max(0, Math.min(1, weight)));
  }

  /** 眨眼值 0=睜 1=閉。1.0 若只有左右 pair 則兩眼同寫。 */
  setBlink(v: number): void {
    const avail = this.available();
    const w = Math.max(0, Math.min(1, v));
    let wrote = false;
    for (const c of BLINK_CANDIDATES) {
      const n = resolvePreset(avail, [c]);
      if (n !== null) {
        // 'blink' 單寫；左右 pair 兩眼同值
        this.sink.setValue(n, w);
        wrote = true;
        if (c === 'blink') break;
      }
    }
    if (!wrote) {
      // 無任何眨眼 preset：靜默跳過（不断言，避免雜牌模型報錯）
    }
  }

  reset(): void {
    this.emotionTarget = 'idle';
    this.emotionWeights.clear();
    this.clearAll();
  }

  private zeroMouth(avail: Set<string>, except: string | null = null): void {
    const seen = new Set<string>();
    for (const list of Object.values(MOUTH_PRESET_CANDIDATES)) {
      const n = resolvePreset(avail, list);
      if (n !== null && n !== except && !seen.has(n)) {
        seen.add(n);
        this.sink.setValue(n, 0);
      }
    }
  }

  private clearAll(): void {
    for (const name of this.available()) {
      try {
        this.sink.setValue(name, 0);
      } catch {
        // 個別失敗不中斷
      }
    }
  }
}
