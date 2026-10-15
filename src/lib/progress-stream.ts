/**
 * A slow request that reports as it goes: newline-delimited JSON, one event per line, ending
 * with the result. Used for the Gemini features, whose answers take from seconds to minutes,
 * so the page shows progress instead of a spinner that can't be told apart from a hang.
 * Free of server imports: the route writes it and the browser reads it.
 */
export type ProgressEvent<P, R> =
  | { type: "progress"; progress: P }
  /** Sent while nothing else is, so no proxy along the way takes a quiet line for a dead one. */
  | { type: "ping" }
  | { type: "done"; result: R };

const HEARTBEAT_MS = 10_000;

/**
 * A streamed response that runs `work`, sending each `progress` it reports, and then its
 * result. `work` must turn its own failures into a result: the status line has already gone.
 */
export function progressResponse<P, R>(work: (progress: (value: P) => void) => Promise<R>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: ProgressEvent<P, R>) => {
        if (open) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const heartbeat = setInterval(() => send({ type: "ping" }), HEARTBEAT_MS);
      try {
        send({ type: "done", result: await work((progress) => send({ type: "progress", progress })) });
      } finally {
        clearInterval(heartbeat);
        open = false;
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // Tells a buffering proxy to pass each line on as it's written.
      "x-accel-buffering": "no",
    },
  });
}

/**
 * Reads a progress stream to its result, calling `onProgress` for each step on the way.
 * Throws if the stream ends without one: the connection dropped, or the function was cut off.
 */
export async function readProgress<P, R>(response: Response, onProgress: (progress: P) => void): Promise<R> {
  if (!response.body) throw new Error(`No response body (HTTP ${response.status}).`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let result: { value: R } | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as ProgressEvent<P, R>;
    if (event.type === "progress") onProgress(event.progress);
    else if (event.type === "done") result = { value: event.result };
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffered.indexOf("\n")) !== -1) {
      handle(buffered.slice(0, end));
      buffered = buffered.slice(end + 1);
    }
  }
  handle(buffered);
  if (!result) throw new Error(`The response ended before its result (HTTP ${response.status}).`);
  return (result as { value: R }).value;
}
