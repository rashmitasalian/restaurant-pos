const tails = new Map<string, Promise<void>>();

export function resetOrderPrintTurnsForTests() {
  tails.clear();
}

/**
 * One promise chain per order. The tail is recorded before this function awaits,
 * a rejected job does not block the next one, and the map entry is removed only
 * when it is still this tail. Do not call this again for the same order from
 * inside work — that waits on itself.
 */
export function withOrderPrintTurn<T>(orderId: string, work: () => Promise<T>): Promise<T> {
  const key = String(orderId || "").trim();
  if (!key) {
    return Promise.reject(new Error("order-not-found"));
  }
  const previous = tails.get(key) || Promise.resolve();
  const result = previous.then(work, work);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  void tail.finally(() => {
    if (tails.get(key) === tail) {
      tails.delete(key);
    }
  });
  return result;
}

/** Acquire turns in sorted order id so two operations cannot deadlock. */
export function withOrderedPrintTurns<T>(orderIds: string[], work: () => Promise<T>): Promise<T> {
  const ids = [...new Set(orderIds.map((id) => String(id || "").trim()).filter(Boolean))].sort();
  if (!ids.length) {
    return Promise.reject(new Error("order-not-found"));
  }
  const enter = (index: number): Promise<T> => {
    if (index >= ids.length) {
      return work();
    }
    return withOrderPrintTurn(ids[index], () => enter(index + 1));
  };
  return enter(0);
}
