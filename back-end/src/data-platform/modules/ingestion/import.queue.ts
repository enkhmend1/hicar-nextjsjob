/**
 * Producer side of the bulk-import queue. The upload endpoint saves the file
 * to a temp path, creates an ImportJob, and enqueues here; the import worker
 * streams the file into raw_products. The file PATH (not its bytes) travels
 * through the queue — never put large payloads in Redis.
 */

import { makeQueue } from "../../shared/queues.js";

export const IMPORT_QUEUE = "dp:import";

export interface ImportJobData {
  importJobId: string;
  sellerId: string;
  filePath: string;
  source: "csv" | "excel";
  filename: string;
}

export const importQueue = makeQueue<ImportJobData>(IMPORT_QUEUE);

export async function enqueueImport(data: ImportJobData): Promise<void> {
  await importQueue.add("import", data, { jobId: `import:${data.importJobId}` });
}
