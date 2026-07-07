import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computeSlots, rememberSlotNav } from './sessionSlots.ts';
import type { Session } from './types';

function session(id: string): Session {
  return { id } as Session;
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

describe('computeSlots', () => {
  it('assigns slots 1..N in candidate order with no overrides', () => {
    const candidates = [session('a'), session('b'), session('c')];
    const { slotBySessionId, sessionBySlot } = computeSlots('current', candidates);
    expect(slotBySessionId.get('a')).toBe(1);
    expect(slotBySessionId.get('b')).toBe(2);
    expect(slotBySessionId.get('c')).toBe(3);
    expect(sessionBySlot.get(1)).toBe('a');
  });

  it('caps assignment at slot 9', () => {
    const candidates = Array.from({ length: 12 }, (_, i) => session(`s${i}`));
    const { slotBySessionId } = computeSlots('current', candidates);
    expect(slotBySessionId.size).toBe(9);
    expect(slotBySessionId.has('s9')).toBe(false);
  });

  it('honors a remembered slot override and fills remaining slots around it', () => {
    rememberSlotNav('from', 'current', 5);
    const candidates = [session('a'), session('b'), session('from')];
    const { slotBySessionId, sessionBySlot } = computeSlots('current', candidates);
    expect(slotBySessionId.get('from')).toBe(5);
    expect(sessionBySlot.get(5)).toBe('from');
    // a/b get the first free slots, skipping 5
    expect(slotBySessionId.get('a')).toBe(1);
    expect(slotBySessionId.get('b')).toBe(2);
  });

  it('ignores an override pointing at a session that is not a candidate', () => {
    rememberSlotNav('from', 'current', 3);
    const candidates = [session('a'), session('b')];
    const { slotBySessionId } = computeSlots('current', candidates);
    expect(slotBySessionId.get('a')).toBe(1);
    expect(slotBySessionId.get('b')).toBe(2);
  });

  it('ignores an out-of-range override slot', () => {
    rememberSlotNav('from', 'current', 42);
    const candidates = [session('from')];
    const { slotBySessionId } = computeSlots('current', candidates);
    expect(slotBySessionId.get('from')).toBe(1);
  });

  it('does not record an override when navigating to the same session', () => {
    rememberSlotNav('same', 'same', 4);
    const candidates = [session('same')];
    const { slotBySessionId } = computeSlots('same', candidates);
    expect(slotBySessionId.get('same')).toBe(1);
  });

  it('honors only the first stored slot when the same target was recorded under two slots', () => {
    // rememberSlotNav can accumulate multiple slot entries for the same target session
    // over time; computeSlots must assign it to exactly one slot, not both.
    rememberSlotNav('x', 'current', 2);
    rememberSlotNav('x', 'current', 5);
    const { slotBySessionId, sessionBySlot } = computeSlots('current', [session('x')]);
    expect(slotBySessionId.get('x')).toBe(2);
    expect(sessionBySlot.has(5)).toBe(false);
  });
});
