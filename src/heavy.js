// Lands in its own async chunk. The tamper test flips bytes in this file's
// emitted output and expects the browser to refuse to execute it.
export function heavy() {
  return 'HEAVY_CHUNK_EXECUTED';
}
