import { createRuntime } from './runtime.js';
import { writePrivateArtifacts } from './private-artifacts.js';
import { dateSchema } from './contracts.js';
const args = process.argv.slice(2).filter((a) => a !== '--'),
  options = new Map<string, string>();
try {
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index],
      value = args[index + 1];
    if (!['--as-of', '--output-dir'].includes(key) || !value || options.has(key))
      throw Error('Invalid generator options.');
    options.set(key, value);
  }
  const asOfDate = options.has('--as-of') ? dateSchema.parse(options.get('--as-of')) : undefined;
  const runtime = await createRuntime();
  try {
    const snapshot = await runtime.service.snapshot({ asOfDate });
    const output = await writePrivateArtifacts(snapshot, options.get('--output-dir'));
    // Only private local locations, never athlete result rows or credentials.
    console.log(JSON.stringify(output));
  } finally {
    await runtime.close();
  }
} catch {
  console.error(
    'Private athlete artifact generation failed. Check dates, runtime account/role, schema and output outside Git worktrees. No athlete data was logged.',
  );
  process.exitCode = 1;
}
