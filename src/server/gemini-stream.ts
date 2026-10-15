import "server-only";

/**
 * Reading Gemini's answer as it streams, from `:streamGenerateContent?alt=sse`.
 *
 * A blocking `generateContent` sends nothing until the whole answer is written, so a slow
 * answer looks exactly like a hung one: to the browser, to the teacher watching a spinner,
 * and to the timeout that had to guess how long is too long. Streamed, the answer arrives a
 * piece at a time, so progress can be shown, and a request is only given up on when Google
 * has gone quiet (`idleMs`), not merely because a long answer is still being written.
 *
 * Thought summaries (`includeThoughts`) are asked for so the stream keeps moving while the
 * model thinks; they are counted as activity but never joined into the answer.
 */

export type GeminiStreamPart = { text?: string; thought?: boolean };
type Chunk = {
  candidates?: { finishReason?: string; content?: { parts?: GeminiStreamPart[] } }[];
  promptFeedback?: { blockReason?: string };
};

export type GeminiStreamResult = {
  /** The answer's text, joined across every part and chunk, without thoughts. */
  text: string;
  /** The candidate's finish reason, or the prompt's block reason, or "none". */
  finish: string;
};

export class GeminiIdleError extends Error {
  constructor(idleMs: number) {
    super(`No data from Gemini for ${Math.round(idleMs / 1000)}s`);
    this.name = "TimeoutError";
  }
}

export function streamUrl(endpoint: string, model: string, apiKey: string): string {
  return `${endpoint}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
}

/**
 * Reads a streamed answer to the end. `onText` hears each new piece of the answer (not
 * thoughts) along with everything so far. A plain JSON body is accepted too, whole or as a
 * list of chunks, which is what the endpoint sends without `alt=sse`, and what tests send.
 */
export async function readGeminiStream(
  response: Response,
  { idleMs, onText }: { idleMs?: number; onText?: (delta: string, soFar: string) => void } = {},
): Promise<GeminiStreamResult> {
  let text = "";
  let finish = "none";
  const absorb = (chunk: Chunk) => {
    const candidate = chunk.candidates?.[0];
    const delta = (candidate?.content?.parts ?? [])
      .filter((part) => !part.thought)
      .map((part) => part.text ?? "")
      .join("");
    if (delta) {
      text += delta;
      onText?.(delta, text);
    }
    finish = candidate?.finishReason ?? chunk.promptFeedback?.blockReason ?? finish;
  };

  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream") || !response.body) {
    const payload = (await response.json()) as Chunk | Chunk[];
    for (const chunk of Array.isArray(payload) ? payload : [payload]) absorb(chunk);
    return { text, finish };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  // A request's own abort signal (its overall time limit) also ends the body, mid-read.
  for (;;) {
    const { done, value } = await withIdleLimit(reader.read(), idleMs, () => void reader.cancel().catch(() => {}));
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    // Server-sent events are separated by a blank line; each carries one JSON chunk.
    let end: number;
    while ((end = buffered.search(/\r?\n\r?\n/)) !== -1) {
      absorbEvent(buffered.slice(0, end));
      buffered = buffered.slice(end).replace(/^\r?\n\r?\n/, "");
    }
  }
  absorbEvent(buffered);
  return { text, finish };

  function absorbEvent(event: string) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data) absorb(JSON.parse(data) as Chunk);
  }
}

async function withIdleLimit<T>(read: Promise<T>, idleMs: number | undefined, onIdle: () => void): Promise<T> {
  if (!idleMs) return read;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Rejected before cancelling: cancelling settles the pending read as "done" at once,
      // which would otherwise pass for an answer that simply ended.
      reject(new GeminiIdleError(idleMs));
      onIdle();
    }, idleMs);
  });
  try {
    return await Promise.race([read, idle]);
  } finally {
    clearTimeout(timer);
  }
}

/** How many times `key` has been written as a JSON key in a partial answer: a progress count. */
export function countKeys(partial: string, key: string): number {
  return partial.split(`"${key}"`).length - 1;
}
