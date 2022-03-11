import { spawnSync } from 'child_process';
import { workspaces } from './workspaces';

for (const name in workspaces) {
  const result = spawnSync(
    'yarn',
    ['workspace', name, 'run', ...process.argv.slice(2)],
    {
      stdio: 'inherit',
    }
  );

  if (result.status) {
    process.exit(result.status);
  }
}
