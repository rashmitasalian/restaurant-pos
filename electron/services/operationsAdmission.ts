import { AsyncLocalStorage } from "async_hooks";

type Admission = { id: number };

const admissions = new AsyncLocalStorage<Admission>();
const goLiveWrites = new AsyncLocalStorage<true>();

let nextAdmissionId = 1;
let admissionsClosed = false;
let inflight = 0;
let blockedReason: string | null = null;
const drainWaiters: Array<() => void> = [];

function notifyDrain() {
  if (inflight !== 0) {
    return;
  }
  const pending = drainWaiters.splice(0, drainWaiters.length);
  for (const waiter of pending) {
    waiter();
  }
}

export function operationsBlockReason() {
  return blockedReason;
}

export function blockOperations(reason: string) {
  blockedReason = reason;
}

export function clearOperationsBlock() {
  blockedReason = null;
}

export function isAdmissionsClosed() {
  return admissionsClosed;
}

export function closeAdmissions() {
  admissionsClosed = true;
}

export function reopenAdmissions() {
  admissionsClosed = false;
}

export function inflightAdmissions() {
  return inflight;
}

export function assertWriteAdmitted() {
  if (blockedReason && !goLiveWrites.getStore()) {
    throw new Error(blockedReason);
  }
  if (!admissionsClosed) {
    return;
  }
  if (goLiveWrites.getStore() || admissions.getStore()) {
    return;
  }
  throw new Error("operations-locked");
}

function rejectNewAdmission() {
  if (blockedReason) {
    throw new Error(blockedReason);
  }
  if (admissionsClosed) {
    throw new Error("operations-locked");
  }
}

export function admitSync<T>(fn: () => T): T {
  if (admissions.getStore()) {
    return fn();
  }
  rejectNewAdmission();
  const admission = { id: nextAdmissionId++ };
  inflight += 1;
  try {
    return admissions.run(admission, fn);
  } finally {
    inflight -= 1;
    notifyDrain();
  }
}

export async function admitAsync<T>(fn: () => Promise<T>): Promise<T> {
  if (admissions.getStore()) {
    return fn();
  }
  rejectNewAdmission();
  const admission = { id: nextAdmissionId++ };
  inflight += 1;
  try {
    return await admissions.run(admission, fn);
  } finally {
    inflight -= 1;
    notifyDrain();
  }
}

export function runAsGoLive<T>(fn: () => T): T {
  return goLiveWrites.run(true, fn);
}

export function drainAdmissions(timeoutMs: number): Promise<void> {
  if (inflight === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const onDrain = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      const index = drainWaiters.indexOf(onDrain);
      if (index >= 0) {
        drainWaiters.splice(index, 1);
      }
      reject(new Error("operations-drain-timeout"));
    }, timeoutMs);
    drainWaiters.push(onDrain);
  });
}

export function resetOperationsAdmissionForTests() {
  admissionsClosed = false;
  blockedReason = null;
  inflight = 0;
  drainWaiters.splice(0, drainWaiters.length);
}
