import type { ProtocolAdapter } from '../core/protocol/adapter.js';
import { TimeoutError, withDeadline } from '../core/timeouts/deadline.js';
import type { TraceStore } from '../core/tracing/store.js';
import { TestLevel, type TestResult } from '../core/types/test-result.js';
import { selectSuites } from '../suites/index.js';
import type { ExitInfo, Transport, TransportObserver } from '../transports/transport.js';
import type { ObservedTransportEvents, SharedDiscovery, SuiteContext } from './ctx.js';
import { createObservedEvents, createSharedDiscovery } from './ctx.js';
import type { RunOptions } from './options.js';
import { fail, fromError } from './result.js';

const MAX_OBSERVED_LINES = 1000;
const MAX_OBSERVED_OVERSIZE = 100;

export interface EngineSetup {
  adapter: ProtocolAdapter;
  transport: Transport;
  trace?: TraceStore;
  options: RunOptions;
}

export class TestEngine {
  readonly observed: ObservedTransportEvents;
  readonly shared: SharedDiscovery;
  private readonly clock: () => number;

  constructor(private readonly setup: EngineSetup) {
    this.observed = createObservedEvents();
    this.shared = createSharedDiscovery();
    this.clock = () => Date.now();
  }

  async run(): Promise<TestResult[]> {
    const { adapter, transport, options, trace } = this.setup;
    transport.observer = this.buildObserver(adapter, transport, trace);

    let results: TestResult[] = [];
    try {
      results = await withDeadline({ kind: 'test', ms: options.defaultTimeoutMs }, () =>
        this.runInternal(),
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        results.push(
          fail(
            'engine overall-timeout',
            'robustness',
            TestLevel.Robustness,
            'transport',
            'timeout',
            `overall test run exceeded the ${options.defaultTimeoutMs}ms budget`,
            { transport: transport.kind, durationMs: 0 },
          ),
        );
      } else {
        results.push(
          fromError('engine run', 'robustness', TestLevel.Robustness, error, 'protocol', {
            transport: transport.kind,
            durationMs: 0,
          }),
        );
      }
    }
    return results;
  }

  async dispose(): Promise<void> {
    await this.setup.adapter.shutdown();
  }

  private async runInternal(): Promise<TestResult[]> {
    const { adapter, transport, options } = this.setup;
    const results: TestResult[] = [];
    const connectedAt = this.clock();
    try {
      await withDeadline(
        { kind: 'connect', ms: options.connectTimeoutMs ?? options.defaultTimeoutMs },
        () => adapter.connect(),
      );
    } catch (error) {
      results.push(buildConnectFailure(error, this.clock() - connectedAt, transport.kind));
      return results;
    }

    const suites = selectSuites(options.maxLevel);
    for (const suite of suites) {
      const suiteStarted = this.clock();
      try {
        const suiteResults = await suite.run(this.ctx());
        results.push(...suiteResults);
      } catch (error) {
        results.push(
          fromError(`suite ${suite.name}`, 'robustness', suite.level, error, 'protocol', {
            transport: transport.kind,
            durationMs: this.clock() - suiteStarted,
          }),
        );
      }
    }

    return results;
  }

  private buildObserver(
    adapter: ProtocolAdapter,
    transport: Transport,
    trace: TraceStore | undefined,
  ): TransportObserver {
    return {
      onMessage: (message) => adapter.mux.handleMessage(message),
      onGarbage: (line) => {
        pushCapped(this.observed.garbageLines as string[], line, MAX_OBSERVED_LINES);
        trace?.add({
          direction: 'in',
          kind: 'event',
          method: '<framing>',
          transport: transport.kind,
          raw: line,
          timestamp: this.clock(),
        });
      },
      onStderr: (line) => {
        pushCapped(this.observed.stderrLines as string[], line, MAX_OBSERVED_LINES);
        trace?.add({
          direction: 'in',
          kind: 'stderr',
          transport: transport.kind,
          raw: line,
          timestamp: this.clock(),
        });
      },
      onExit: (exit: ExitInfo) => {
        this.observed.exit = exit;
        // A server that has exited will never respond to in-flight requests;
        // fail them immediately rather than letting them hang until timeout.
        adapter.mux.failAll(
          new Error(
            `server exited prematurely (code ${exit.code}, signal ${exit.signal ?? 'none'})`,
          ),
        );
        trace?.add({
          direction: 'in',
          kind: 'event',
          transport: transport.kind,
          status: `exit code=${exit.code} signal=${exit.signal ?? 'none'}`,
          timestamp: this.clock(),
        });
      },
      onError: (error) => {
        trace?.add({
          direction: 'in',
          kind: 'event',
          transport: transport.kind,
          error: error.message,
          timestamp: this.clock(),
        });
      },
      onOversize: (info) => {
        if (this.observed.oversize.length < MAX_OBSERVED_OVERSIZE) {
          this.observed.oversize.push(info);
        }
        trace?.add({
          direction: 'in',
          kind: 'event',
          transport: transport.kind,
          status: 'oversize',
          raw: info.line.slice(0, 200),
          timestamp: this.clock(),
        });
      },
    };
  }

  private ctx(): SuiteContext {
    return {
      adapter: this.setup.adapter,
      observed: this.observed,
      options: this.setup.options,
      trace: this.setup.trace,
      shared: this.shared,
      now: this.clock,
      transport: this.setup.transport.kind,
      era: this.setup.adapter.era,
    };
  }
}

function pushCapped(array: string[], value: string, cap: number): void {
  if (array.length >= cap) return;
  array.push(value);
}

function buildConnectFailure(error: unknown, durationMs: number, transport: string): TestResult {
  return fail(
    'engine connect',
    'connectivity',
    TestLevel.Connectivity,
    'transport',
    'connect',
    error instanceof Error ? error.message : String(error),
    { transport: transport as 'stdio', durationMs },
  );
}
