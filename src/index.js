import log from 'loglevel';

export async function run() {
  log.info('[minimal-remote] exposed module invoked');
  const { heavy } = await import('./heavy.js');
  return heavy();
}
export default { run };
