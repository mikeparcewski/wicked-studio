/**
 * A promise whose settlement the TEST controls — for pinning what a surface renders while a
 * wire is still pending (a probe, a member lookup, a launch in flight), then settling it inside
 * `act` so the resolved state is asserted on the same render tree. Every deferred a test hands
 * to a module-level in-flight guard (the campaign store's `refresh`) MUST be settled before the
 * test ends, or the next test's refresh returns the stale pending promise.
 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
