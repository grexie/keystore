import { execSync } from 'child_process';

interface Workspaces {
  [name: string]: {
    location: string;
    workspaceDependencies: string[];
    mismatchedWorkspaceDependencies: string[];
  };
}

const workspaces: Workspaces = JSON.parse(
  execSync('yarn workspaces info').toString()
);

export { workspaces };
