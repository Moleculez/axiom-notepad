import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { MathRequest, MathResult } from "./math-contract";

let active = 0;
export class MathExportLimitError extends Error {
  constructor(
    message: string,
    public status: 413 | 429,
  ) {
    super(message);
  }
}
const unavailable = (message: string): MathResult => ({
  html: '<span class="math-error">Equation preview unavailable. Refer to the preserved TeX source.</span>',
  css: "",
  error: message,
});
/** A fresh, memory-bounded worker per export. TeX cannot monopolize the API
 * thread; startup and each expression have independently enforced deadlines. */
export async function renderMathBatch(
  requests: MathRequest[],
): Promise<MathResult[]> {
  if (!requests.length) return [];
  if (requests.length > 500)
    throw new MathExportLimitError(
      "Export up to 500 distinct equations per document.",
      413,
    );
  if (active >= 2)
    throw new MathExportLimitError(
      "Two equation exports are already running. Please retry shortly.",
      429,
    );
  active++;
  try {
    const require = createRequire(join(process.cwd(), "package.json"));
    const module = pathToFileURL(
      join(dirname(require.resolve("@axiom/markdown")), "mathjax.ts"),
    ).href;
    const loader = pathToFileURL(require.resolve("tsx/esm/api")).href;
    const worker = new Worker(
      `
      const { parentPort, workerData } = require('node:worker_threads');
      import(workerData.loader).then(({ tsImport }) => tsImport(workerData.module, workerData.module)).then(({ renderMath }) => {
        parentPort.on('message', ({ id, request }) => parentPort.postMessage({ id, result: renderMath(request) }));
        parentPort.postMessage({ ready: true });
      }).catch(error => { throw error; });
    `,
      {
        eval: true,
        workerData: { module, loader },
        resourceLimits: { maxOldGenerationSizeMb: 192, stackSizeMb: 4 },
      },
    );
    return await new Promise<MathResult[]>((resolve) => {
      const results: MathResult[] = [];
      let index = 0,
        bytes = 0,
        settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (message?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        while (results.length < requests.length)
          results.push(
            unavailable(message ?? "The equation renderer stopped."),
          );
        resolve(results);
      };
      const send = () => {
        clearTimeout(timer);
        if (index === requests.length) {
          finish();
          return;
        }
        worker.postMessage({ id: index, request: requests[index] });
        timer = setTimeout(
          () => finish("Equation rendering exceeded its time limit."),
          2000,
        );
      };
      worker.on(
        "message",
        (event: { ready?: boolean; id: number; result: MathResult }) => {
          if (settled) return;
          if (event.ready) {
            send();
            return;
          }
          if (event.id !== index) return;
          results.push(event.result);
          bytes += event.result.html.length;
          index++;
          if (bytes > 20_000_000)
            finish("Equation export exceeds the 20 MB output limit.");
          else send();
        },
      );
      worker.on("error", (error) => finish(error.message));
      worker.on("exit", () => finish());
      timer = setTimeout(
        () => finish("The local equation renderer could not start."),
        15000,
      );
    });
  } finally {
    active--;
  }
}
