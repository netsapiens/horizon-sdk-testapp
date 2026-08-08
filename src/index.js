import log from 'loglevel';

export async function run() {
  log.info('[minimal-remote] MATERIALLY DIFFERENT OUTPUT');
  const { heavy } = await import('./heavy.js');
  return heavy();
}
export default { run };

// byte-changing edit without a version bump
