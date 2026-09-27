import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { integrationEnvVars } from './test-env';

const BACKEND_DIR = fileURLToPath(new URL('../..', import.meta.url));

/**
 * A real `src/worker.ts` process, for restart, crash and multi-worker scenarios that an
 * in-process worker cannot simulate (a crash must kill the whole process).
 */
export class WorkerProcess {
  private output = '';
  readonly exited: Promise<number | null>;

  private constructor(private readonly child: ChildProcess) {
    child.stdout?.on('data', (chunk: Buffer) => (this.output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (this.output += chunk.toString()));
    this.exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  }

  static async start(overrides: Record<string, string> = {}): Promise<WorkerProcess> {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/worker.ts'], {
      cwd: BACKEND_DIR,
      env: { ...process.env, ...integrationEnvVars({ LOG_LEVEL: 'info', ...overrides }) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const worker = new WorkerProcess(child);
    await worker.waitForOutput(/Workers started/, 30_000);
    return worker;
  }

  get logs(): string {
    return this.output;
  }

  async waitForOutput(pattern: RegExp, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!pattern.test(this.output)) {
      if (this.child.exitCode !== null) {
        throw new Error(
          `Worker exited (${this.child.exitCode}) before ${pattern}:\n${this.output}`,
        );
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${pattern}:\n${this.output}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /** Hard kill, like a crash or `kill -9`: no graceful shutdown, locks are left behind. */
  async kill(): Promise<void> {
    if (this.child.exitCode === null) this.child.kill('SIGKILL');
    await this.exited;
  }
}
