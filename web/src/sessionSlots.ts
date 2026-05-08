import type { Session } from './types';

const STORAGE_KEY = 'sessionSlotMap';

type SlotMap = Record<string, Record<number, string>>;

function read(): SlotMap {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SlotMap) : {};
  } catch {
    return {};
  }
}

function write(m: SlotMap) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(m));
  } catch {
    // best effort
  }
}

export function rememberSlotNav(fromSessionId: string, toSessionId: string, slot: number) {
  if (fromSessionId === toSessionId) return;
  const m = read();
  if (!m[toSessionId]) m[toSessionId] = {};
  m[toSessionId][slot] = fromSessionId;
  write(m);
}

export function computeSlots(
  currentSessionId: string,
  candidates: Session[]
): { slotBySessionId: Map<string, number>; sessionBySlot: Map<number, string> } {
  const overrides = read()[currentSessionId] ?? {};
  const slotBySessionId = new Map<string, number>();
  const sessionBySlot = new Map<number, string>();
  const candidateIds = new Set(candidates.map(c => c.id));

  for (const [slotStr, targetId] of Object.entries(overrides)) {
    const slot = Number(slotStr);
    if (!Number.isInteger(slot) || slot < 1 || slot > 9) continue;
    if (!candidateIds.has(targetId)) continue;
    if (sessionBySlot.has(slot) || slotBySessionId.has(targetId)) continue;
    slotBySessionId.set(targetId, slot);
    sessionBySlot.set(slot, targetId);
  }

  let next = 1;
  for (const c of candidates) {
    if (slotBySessionId.has(c.id)) continue;
    while (next <= 9 && sessionBySlot.has(next)) next++;
    if (next > 9) break;
    slotBySessionId.set(c.id, next);
    sessionBySlot.set(next, c.id);
    next++;
  }

  return { slotBySessionId, sessionBySlot };
}
