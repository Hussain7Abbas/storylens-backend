/**
 * NDJSON responses for cloud AI, in the desktop companion's frame format
 * (`started`, `heartbeat`, then one `result` or `error`), so the extension reads
 * both with the same code. Heartbeats keep Bun's idle timeout and proxies from
 * closing long requests (images take up to a few minutes).
 */

export type Frame = { type: 'started' | 'heartbeat' | 'result' | 'error' } & Record<string, unknown>;

export const HEARTBEAT_MS = 8_000;

export function wantsStream(accept: string | null | undefined): boolean {
  return Boolean(accept?.includes('application/x-ndjson'));
}

export function ndjsonResponse(
  run: (send: (frame: Frame) => void) => Promise<void>,
  { heartbeatMs = HEARTBEAT_MS }: { heartbeatMs?: number } = {},
): Response {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (frame: Frame) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
        } catch {
          closed = true;
        }
      };
      const heartbeat = setInterval(() => send({ type: 'heartbeat' }), heartbeatMs);
      run(send)
        .catch((error) => {
          console.error('[ai] stream failed', error);
          send({ type: 'error', error: { code: 'AI_PROVIDER_FAILED', message: 'The AI request failed' } });
        })
        .finally(() => {
          clearInterval(heartbeat);
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // Already closed by the client.
          }
        });
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      // Nginx must pass frames through as they are written.
      'x-accel-buffering': 'no',
    },
  });
}
