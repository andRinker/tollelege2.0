import { afterEach, describe, expect, it, vi } from "vitest";
import { countKeys, readGeminiStream } from "@/server/gemini-stream";
import { progressResponse, readProgress } from "@/lib/progress-stream";
import { readShelf } from "@/server/shelf-scan/vision";

/** A server-sent-event response, written out in the given pieces (split anywhere, as a network does). */
function sse(pieces: string[], { delayMs = 0 } = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const piece of pieces) {
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        controller.enqueue(encoder.encode(piece));
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

const chunk = (parts: { text: string; thought?: boolean }[], finishReason?: string) =>
  `data: ${JSON.stringify({ candidates: [{ content: { parts }, ...(finishReason ? { finishReason } : {}) }] })}\r\n\r\n`;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("reading Gemini's streamed answer", () => {
  it("joins the answer across chunks, leaves thoughts out, and keeps the finish reason", async () => {
    const whole = chunk([{ text: "Counting spines", thought: true }]) + chunk([{ text: '{"spines":[' }]) + chunk([{ text: '{"title":"Holes"}]}' }], "STOP");
    // Split mid-event and mid-character boundary, as a real network would deliver it.
    const pieces = [whole.slice(0, 7), whole.slice(7, 60), whole.slice(60)];
    const heard: string[] = [];
    const result = await readGeminiStream(sse(pieces), { onText: (delta) => heard.push(delta) });
    expect(result).toEqual({ text: '{"spines":[{"title":"Holes"}]}', finish: "STOP" });
    expect(heard).toEqual(['{"spines":[', '{"title":"Holes"}]}']);
  });

  it("still reads a plain JSON answer, whole or as a list of chunks", async () => {
    const one = { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{}" }] } }] };
    expect(await readGeminiStream(Response.json(one))).toEqual({ text: "{}", finish: "STOP" });
    const list = [{ candidates: [{ content: { parts: [{ text: "[1," }] } }] }, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "2]" }] } }] }];
    expect(await readGeminiStream(Response.json(list))).toEqual({ text: "[1,2]", finish: "STOP" });
  });

  it("gives up on a stream that goes quiet, however long the request is allowed", async () => {
    const quiet = new Response(new ReadableStream({ start: () => {} }), { headers: { "content-type": "text/event-stream" } });
    await expect(readGeminiStream(quiet, { idleMs: 30 })).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("counts keys written so far, for progress", () => {
    expect(countKeys('{"books":[{"n":1,"title":null},{"n":2', "n")).toBe(2);
  });
});

describe("a shelf reading, streamed", () => {
  it("asks for the stream and reports each spine as it arrives", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    let url = "";
    const fetchFn = (async (input: RequestInfo | URL) => {
      url = String(input);
      return sse([chunk([{ text: '{"spines":[{"title":"Holes","author":"Sachar"},' }]), chunk([{ text: '{"title":null,"fragment":"WAR"}]}' }], "STOP")]);
    }) as typeof fetch;
    const progress: number[] = [];
    const reading = await readShelf({ data: new ArrayBuffer(8), mimeType: "image/jpeg" }, fetchFn, {
      onProgress: (step) => progress.push(step.spines),
    });
    expect(url).toContain(":streamGenerateContent?alt=sse&key=");
    expect(reading.sightings).toHaveLength(2);
    expect(progress).toEqual([1, 2]);
  });

  it("calls an answer cut off mid-stream a timeout, not an empty shelf", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(chunk([{ text: '{"spines":[' }])));
          init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    await expect(
      readShelf({ data: new ArrayBuffer(8), mimeType: "image/jpeg" }, fetchFn, { deadline: Date.now() + 5_100 }),
    ).rejects.toMatchObject({ reason: "timeout" });
  }, 10_000);
});

describe("a progress stream, from route to browser", () => {
  it("delivers each step and then the result", async () => {
    const response = progressResponse<number, string>(async (progress) => {
      progress(1);
      progress(2);
      return "done";
    });
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const steps: number[] = [];
    expect(await readProgress<number, string>(response, (step) => steps.push(step))).toBe("done");
    expect(steps).toEqual([1, 2]);
  });

  it("says so when the stream ends without a result", async () => {
    const cut = new Response('{"type":"progress","progress":1}\n');
    await expect(readProgress(cut, () => {})).rejects.toThrow("ended before its result");
  });
});
