// Live values for the preview: one SignalK stream, subscribed to the paths on screen.
// signalk-server only supports unsubscribing from everything, so a changed path set is sent
// as unsubscribe-all + subscribe (same strategy as the firmware, ADR-0004).

export type ValueListener = (path: string, value: unknown) => void;

export interface LiveSource {
  /** Replace the subscribed paths. */
  setPaths(paths: string[]): void;
  onValue(listener: ValueListener): () => void;
  close(): void;
}

export function streamUrl(loc: Pick<Location, 'protocol' | 'host'> = window.location): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/signalk/v1/stream?subscribe=none`;
}

export function createLiveSource(url: string = streamUrl()): LiveSource {
  const listeners = new Set<ValueListener>();
  let paths: string[] = [];
  let ws: WebSocket | undefined;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const subscribe = () => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ context: '*', unsubscribe: [{ path: '*' }] }));
    if (paths.length > 0)
      ws.send(
        JSON.stringify({
          context: 'vessels.self',
          subscribe: paths.map((path) => ({ path, policy: 'instant', minPeriod: 250 })),
        }),
      );
  };

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(url);
    ws.onopen = subscribe;
    ws.onmessage = (ev: MessageEvent<string>) => {
      let msg: { updates?: { values?: { path: string; value: unknown }[] }[] };
      try {
        msg = JSON.parse(ev.data) as typeof msg;
      } catch {
        return;
      }
      for (const u of msg.updates ?? [])
        for (const v of u.values ?? []) listeners.forEach((l) => l(v.path, v.value));
    };
    ws.onclose = () => {
      if (!closed) retry = setTimeout(connect, 3000);
    };
  };
  connect();

  return {
    setPaths(next) {
      const sorted = [...new Set(next)].sort();
      if (sorted.join('\n') === paths.join('\n')) return;
      paths = sorted;
      subscribe();
    },
    onValue(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    },
  };
}
