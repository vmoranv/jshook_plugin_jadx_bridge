import { basename, extname, resolve } from 'node:path';
import {
  checkExternalCommand,
  resolveOutputDirectory,
  runProcess,
  toErrorResponse,
  toTextResponse,
} from '@jshookmcp/extension-sdk/bridges';
import {
  createExtension,
} from '@jshookmcp/extension-sdk/plugin';
import type { ToolArgs, PluginLifecycleContext } from '@jshookmcp/extension-sdk/plugin';

const PLUGIN_SLUG = 'jadx-bridge';

function getPluginBooleanConfig(
  ctx: PluginLifecycleContext,
  slug: string,
  key: string,
  fallback: boolean,
): boolean {
  const value = ctx.getConfig(`plugins.${slug}.${key}`, fallback);
  return typeof value === 'boolean' ? value : fallback;
}

async function handleJadxBridge(args: ToolArgs) {
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

export default createExtension('io.github.vmoranv.jadx-bridge', '0.1.0')
  .compatibleCore('>=0.1.0')
  .profile(['full'])
  .allowHost(['127.0.0.1', 'localhost', '::1'])
  .allowCommand('jadx')
  .allowTool('jadx_bridge')
  .configDefault('plugins.jadx-bridge.enabled', true)
  .metric('jadx_bridge_calls_total')
  .tool(
    'jadx_bridge',
    'Jadx helper bridge. Actions: check_env, decompile, guide.',
    {
      action: { type: 'string', enum: ['check_env', 'decompile', 'guide'], default: 'guide' },
      inputPath: { type: 'string' },
      outputDir: { type: 'string' },
      extraArgs: { type: 'array', items: { type: 'string' } },
    },
    async (args) => handleJadxBridge(args),
  )
  .onLoad((ctx) => { ctx.setRuntimeData('loadedAt', new Date().toISOString()); })
  .onValidate((ctx: PluginLifecycleContext) => {
    const enabled = getPluginBooleanConfig(ctx, 'jadx-bridge', 'enabled', true);
    if (!enabled) return { valid: false, errors: ['Plugin disabled by config'] };
    return { valid: true, errors: [] };
  });
