import { describe, expect, it } from 'vitest';
import { checkVram, estimateLlmMiB, estimateWhisperMiB, presetToPatch, recommendPreset } from '../src/shared/hardware.js';
import { HARDWARE_PRESETS } from '../src/shared/config-schema.js';

describe('hardware', () => {
  it('LLM 量級估算', () => {
    expect(estimateLlmMiB('qwen3:8b')).toBe(6000);
    expect(estimateLlmMiB('qwen3:27b')).toBe(17000);
    expect(estimateLlmMiB('mystery-model-xl')).toBeNull();
  });

  it('Whisper int8 打折', () => {
    expect(estimateWhisperMiB('small', 'float16')).toBe(1200);
    expect(estimateWhisperMiB('small', 'int8')).toBe(720);
    expect(estimateWhisperMiB('nope', 'float16')).toBeNull();
  });

  it('超標警告、未知不警告', () => {
    const over = checkVram(
      { llmModel: 'qwen3:27b', whisper: { size: 'large-v3', compute: 'float16' } },
      { vramTotalMiB: 8192 },
    );
    expect(over.warn).toBe(true);
    const ok = checkVram(
      { llmModel: 'qwen3:8b', whisper: { size: 'small', compute: 'float16' } },
      { vramTotalMiB: 12288 },
    );
    expect(ok.warn).toBe(false);
    const unknown = checkVram(
      { llmModel: 'mystery', whisper: { size: 'small', compute: 'float16' } },
      { vramTotalMiB: 8192 },
    );
    expect(unknown.warn).toBe(false);
  });

  it('推薦與套用', () => {
    expect(recommendPreset(null).id).toBe('low');
    expect(recommendPreset(6000).id).toBe('low');
    expect(recommendPreset(8000).id).toBe('mid');
    expect(recommendPreset(24000).id).toBe('high');
    const patch = presetToPatch(HARDWARE_PRESETS[1] as (typeof HARDWARE_PRESETS)[number]);
    expect(patch.llmModel).toBe('qwen3:8b');
    expect(patch.whisper.size).toBe('small');
  });
});
