import {
  backtestFingerprint,
  getBacktest,
  getSignals,
  getStatus,
  getSummary,
  getTape,
  tapeFingerprint,
} from "@/lib/snapshot";

export const dynamic = "force-dynamic";

/**
 * Server-sent events. Every 2s: `summary`, `signal`, `status`. The heavier
 * `backtest` and `tape` payloads go out only when their data changed.
 * The runtime config is re-read on every tick, so flipping `backtestSource`
 * reaches open dashboards without a reconnect.
 */
export async function GET(req: Request) {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      let lastBacktest = "";
      let lastTape = "";
      const tick = async () => {
        try {
          send("summary", getSummary());
          send("signal", getSignals());
          send("status", await getStatus());
          const bf = backtestFingerprint();
          if (bf !== lastBacktest) {
            lastBacktest = bf;
            send("backtest", getBacktest());
          }
          const tf = tapeFingerprint();
          if (tf !== lastTape) {
            lastTape = tf;
            send("tape", getTape());
          }
        } catch (err) {
          send("error", { message: (err as Error).message });
        }
      };
      void tick();
      timer = setInterval(() => void tick(), 2000);
      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      closed = true;
      clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no", // stops nginx buffering the stream
    },
  });
}
