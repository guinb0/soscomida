import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';

const api = path.resolve(import.meta.dirname, '../../apps/api');

/** Sobe um worker próprio (processa o outbox, a fila de pagamentos e os e-mails). */
export default function globalSetup(): () => void {
  const worker: ChildProcess = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist/worker.js'], { cwd: api, stdio: 'ignore' });
  return () => {
    worker.kill();
  };
}
