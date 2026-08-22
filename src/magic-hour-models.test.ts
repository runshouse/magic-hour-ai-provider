import { describe, expect, it } from 'vitest';
import {
  capResolution,
  estimateCredits,
  magicHourVideoModels,
  snapDuration,
  toMagicHourResolution,
} from './magic-hour-models';

describe('snapDuration', () => {
  it('leaves a legal duration alone', () => {
    expect(snapDuration('kling-2.6', 10).duration).toBe(10);
  });

  it('rounds to the nearest legal duration', () => {
    expect(snapDuration('kling-2.6', 8).duration).toBe(10);
    expect(snapDuration('kling-2.6', 6).duration).toBe(5);
  });

  it('clamps past the ends of the range', () => {
    expect(snapDuration('sora-2', 999).duration).toBe(60);
    expect(snapDuration('sora-2', 0).duration).toBe(4);
  });

  it('passes unknown models through untouched', () => {
    expect(snapDuration('not-a-model', 7)).toEqual({ duration: 7 });
  });
});

describe('capResolution', () => {
  it('caps models with a ceiling', () => {
    expect(capResolution('sora-2', '4k')).toBe('720p');
    expect(capResolution('minimax-h3', '4k')).toBe('1080p');
  });

  it('leaves requests at or below the ceiling alone', () => {
    expect(capResolution('sora-2', '480p')).toBe('480p');
    expect(capResolution('kling-3.0', '4k')).toBe('4k');
  });
});

describe('toMagicHourResolution', () => {
  it('reads the tier off the height', () => {
    expect(toMagicHourResolution('854x480')).toBe('480p');
    expect(toMagicHourResolution('1280x720')).toBe('720p');
    expect(toMagicHourResolution('1920x1080')).toBe('1080p');
    expect(toMagicHourResolution('3840x2160')).toBe('4k');
  });

  it('rounds an in-between height up to the next tier', () => {
    expect(toMagicHourResolution('1000x600')).toBe('720p');
  });
});

describe('estimateCredits', () => {
  it('multiplies the per-second rate', () => {
    // wan-2.2 is 24 credits/sec.
    expect(estimateCredits('wan-2.2', 5)).toBe(120);
  });

  it('returns undefined for unknown models', () => {
    expect(estimateCredits('not-a-model', 5)).toBeUndefined();
  });
});

describe('catalogue', () => {
  it('gives every model at least one duration', () => {
    for (const [id, spec] of Object.entries(magicHourVideoModels)) {
      expect(spec.durations.length, id).toBeGreaterThan(0);
      expect(spec.creditsPerSecond, id).toBeGreaterThan(0);
    }
  });

  it('marks exactly the three free-tier models as free', () => {
    const free = Object.entries(magicHourVideoModels)
      .filter(([, spec]) => spec.free)
      .map(([id]) => id)
      .sort();

    expect(free).toEqual(['ltx-2.3', 'minimax-h3', 'wan-2.2']);
  });
});
