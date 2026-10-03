import { describe, expect, it, vi } from 'vitest';
import { TTSPlayer, type MiniAudio } from '../src/renderer/src/audio/tts-player.js';

function fakeAudio(): MiniAudio & { played: boolean } {
  const a = {
    src: '',
    onended: null as (() => void) | null,
    onerror: null as ((msg: string) => void) | null,
    played: false,
    play: async () => {
      a.played = true;
    },
    pause: () => {},
  };
  return a;
}

function player() {
  const audios: Array<ReturnType<typeof fakeAudio>> = [];
  const mouth: Array<[string, number]> = [];
  const playing: Array<[boolean, string | null]> = [];
  const errors: Array<[string, string]> = [];
  const p = new TTSPlayer({
    createAudio: () => {
      const a = fakeAudio();
      audios.push(a);
      return a;
    },
    analyser: null,
    onMouth: (v, w) => mouth.push([v, w]),
    onPlayingChange: (b, id) => playing.push([b, id]),
    onError: (id, msg) => errors.push([id, msg]),
  });
  return { p, audios, mouth, playing, errors };
}

describe('TTSPlayer', () => {
  it('入隊即播，播完接下一句並回 closed', async () => {
    const { p, audios, mouth, playing } = player();
    p.speakFile('a', '/tmp/a.mp3');
    p.speakFile('b', '/tmp/b.mp3');
    await Promise.resolve();
    expect(p.playing).toBe(true);
    expect(audios.length).toBe(1);
    expect(playing[0]).toEqual([true, 'a']);
    audios[0]?.onended?.();
    await Promise.resolve();
    expect(audios.length).toBe(2);
    expect(audios[1]?.src).toBe('/tmp/b.mp3');
    audios[1]?.onended?.();
    await Promise.resolve();
    expect(p.playing).toBe(false);
    expect(mouth[mouth.length - 1]).toEqual(['closed', 0]);
    expect(playing[playing.length - 1]).toEqual([false, null]);
  });

  it('cancel 清空並停播', async () => {
    const { p, audios, mouth } = player();
    p.speakFile('a', '/tmp/a.mp3');
    p.speakFile('b', '/tmp/b.mp3');
    await Promise.resolve();
    expect(p.pending).toBe(1);
    p.cancel();
    expect(p.playing).toBe(false);
    expect(p.pending).toBe(0);
    expect(mouth[mouth.length - 1]).toEqual(['closed', 0]);
    expect(audios.length).toBe(1); // b 永不建 element
  });

  it('播錯跳下一句並回報', async () => {
    const { p, audios, errors } = player();
    p.speakFile('a', '/bad.mp3');
    p.speakFile('b', '/tmp/b.mp3');
    await Promise.resolve();
    audios[0]?.onerror?.('decode error');
    await Promise.resolve();
    expect(errors).toEqual([['a', 'decode error']]);
    expect(audios.length).toBe(2);
  });

  it('有 analyser 時 update 推主導口型', async () => {
    const mouth: Array<[string, number]> = [];
    const p = new TTSPlayer({
      createAudio: () => fakeAudio(),
      analyser: {
        binCount: 512,
        getData: (arr) => {
          arr.fill(2);
          // 中頻灌能量 → aa
          for (let i = 10; i < 60; i++) arr[i] = 200;
        },
      },
      onMouth: (v, w) => mouth.push([v, w]),
      onPlayingChange: () => {},
    });
    p.speakFile('a', '/tmp/a.mp3');
    await Promise.resolve();
    for (let i = 0; i < 30; i++) p.update(1 / 60);
    const last = mouth[mouth.length - 1];
    expect(last?.[0]).toBe('aa');
    expect(last?.[1]).toBeGreaterThan(0.1);
  });
});
