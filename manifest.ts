import { basename, extname, resolve } from 'node:path';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  checkExternalCommand,
  resolveOutputDirectory,
  runProcess,
  toErrorResponse,
  toTextResponse,
  type TextToolResponse,
} from '@jshookmcp/extension-sdk/bridges';
import { getPluginBooleanConfig, loadPluginEnv } from '@jshookmcp/extension-sdk/plugin';
import type {
  DomainManifest,
  PluginContract,
  PluginLifecycleContext,
  ToolArgs,
  ToolHandlerDeps,
} from '@jshookmcp/extension-sdk/plugin';

type HandlerMap = Record<string, (args: ToolArgs) => Promise<unknown>>;

loadPluginEnv(import.meta.url);

class JadxBridgeHandlers {
  async handleJadxBridge(args: ToolArgs): Promise<TextToolResponse> {
    const action = typeof args.action === 'string' ? args.action : 'guide';

    if (action === 'check_env') {
      return checkExternalCommand(
        'jadx',
        ['--version'],
        'jadx',
        'Install jadx CLI and add to PATH: https://github.com/skylot/jadx/releases',
      );
    }

    if (action === 'decompile') {
      const inputPath = typeof args.inputPath === 'string' ? args.inputPath.trim() : '';
      if (!inputPath) {
        return toErrorResponse('jadx_bridge', new Error('inputPath is required for decompile action'));
      }

      try {
        const absoluteInput = resolve(inputPath);
        const outputDirArg = typeof args.outputDir === 'string' ? args.outputDir : undefined;
        const extraArgs = Array.isArray(args.extraArgs)
          ? (args.extraArgs as unknown[]).filter((item): item is string => typeof item === 'string')
          : [];

        const outputIdentity = basename(absoluteInput, extname(absoluteInput));
        const outputDirectory = await resolveOutputDirectory(
          'jadx-decompile',
          outputIdentity,
          outputDirArg,
        );

        const result = await runProcess(
          'jadx',
          ['-d', outputDirectory.absolutePath, ...extraArgs, absoluteInput],
          { timeoutMs: 300_000 },
        );

        return toTextResponse({
          success: result.ok,
          outputDir: outputDirectory.displayPath,
          exitCode: result.exitCode,
          stdout: result.stdout.slice(0, 2000),
          stderr: result.stderr.slice(0, 2000),
          truncated: result.truncated,
          durationMs: result.durationMs,
        });
      } catch (error) {
        return toErrorResponse('jadx_bridge', error);
      }
    }

    if (action === 'guide') {
      return toTextResponse({
        success: true,
        guide: {
          actions: ['check_env', 'decompile', 'guide'],
          workflow: [
            '1. Use jadx_bridge(action="check_env") to verify jadx installation',
            '2. Use jadx_bridge(action="decompile", inputPath="app.apk") to decompile',
            '3. Inspect output source directory for Java code and resources',
          ],
          commonArgs: ['--deobf', '--show-bad-code', '--no-res', '--threads-count 4'],
          links: [
            'https://github.com/skylot/jadx',
            'https://github.com/skylot/jadx/wiki/jadx-CLI-options',
          ],
        },
      });
    }

    return toErrorResponse('jadx_bridge', new Error('Unsupported action'), { action });
  }
}

const tools: Tool[] = [
  {
    name: 'jadx_bridge',
    description: 'Jadx helper bridge. Actions: check_env, decompile, guide.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['check_env', 'decompile', 'guide'],
          default: 'guide',
        },
        inputPath: { type: 'string' },
        outputDir: { type: 'string' },
        extraArgs: { type: 'array', items: { type: 'string' } },
      },
    },
  },
];

const DEP_KEY = 'jadxBridgeHandlers';
const DOMAIN = 'jadx-bridge';

function bind(methodName: string) {
  return (deps: ToolHandlerDeps) => async (args: ToolArgs) => {
    const handlers = deps[DEP_KEY] as HandlerMap;
    const method = handlers[methodName];
    if (typeof method !== 'function') {
      throw new Error(`Missing jadx handler method: ${methodName}`);
    }
    return method(args ?? {});
  };
}

const domainManifest: DomainManifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full', 'reverse'],
  ensure() {
    return new JadxBridgeHandlers();
  },
  registrations: [
    {
      tool: tools[0]!,
      domain: DOMAIN,
      bind: bind('handleJadxBridge'),
    },
  ],
};

const plugin: PluginContract = {
  manifest: {
    kind: 'plugin-manifest',
    version: 1,
    id: 'io.github.vmoranv.jadx-bridge',
    name: 'Jadx Bridge',
    pluginVersion: '0.1.0',
    entry: 'manifest.js',
    description: 'Atomic Jadx bridge plugin.',
    compatibleCore: '>=0.1.0',
    permissions: {
      network: { allowHosts: ['127.0.0.1', 'localhost', '::1'] },
      process: { allowCommands: ['jadx'] },
      filesystem: { readRoots: [], writeRoots: [] },
      toolExecution: { allowTools: ['jadx_bridge'] },
    },
    activation: {
      onStartup: false,
      profiles: ['full', 'reverse'],
    },
    contributes: {
      domains: [domainManifest],
      workflows: [],
      configDefaults: {
        'plugins.jadx-bridge.enabled': true,
      },
      metrics: ['jadx_bridge_calls_total'],
    },
  },
  onLoad(ctx: PluginLifecycleContext): void {
    ctx.setRuntimeData('loadedAt', new Date().toISOString());
  },
  onValidate(ctx: PluginLifecycleContext) {
    const enabled = getPluginBooleanConfig(ctx, 'jadx-bridge', 'enabled', true);
    if (!enabled) return { valid: false, errors: ['Plugin disabled by config'] };
    return { valid: true, errors: [] };
  },
  onRegister(ctx: PluginLifecycleContext): void {
    ctx.registerDomain(domainManifest);
    ctx.registerMetric('jadx_bridge_calls_total');
  },
};

export default plugin;
