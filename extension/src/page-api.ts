(function pageApi(): void {
  const DISPATCH_EVENT = "__mo_dispatch__";
  const DISPATCH_RESPONSE_EVENT = "__mo_dispatch_response__";

  let nextRequestId = 1;
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();

  document.addEventListener(DISPATCH_RESPONSE_EVENT, (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (!detail?.requestId) {
      return;
    }

    const entry = pending.get(detail.requestId);
    if (!entry) {
      return;
    }

    pending.delete(detail.requestId);
    if (detail.error) {
      entry.reject(new Error(detail.error));
      return;
    }

    entry.resolve(detail.result);
  });

  (window as typeof window & { __moDispatch?: (command: string, params?: unknown) => Promise<unknown> }).__moDispatch =
    function __moDispatch(command: string, params?: unknown): Promise<unknown> {
      const requestId = `mo_req_${nextRequestId++}`;
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        document.dispatchEvent(new CustomEvent(DISPATCH_EVENT, {
          detail: { requestId, command, params }
        }));
        setTimeout(() => {
          if (!pending.has(requestId)) {
            return;
          }
          pending.delete(requestId);
          reject(new Error(`Missouri dispatch timeout for command: ${command}`));
        }, 10000);
      });
    };
})();
