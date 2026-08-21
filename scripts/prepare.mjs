import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Runs on `npm install` and git/npx installs.
//
// The compiled CLI (dist/) is committed to the repo because this package is
// distributed via git and npx (not npmjs), so an install never needs to run a
// TypeScript build (npm does not reliably install devDependencies before the
// `prepare` lifecycle for git dependencies).
//
// Husky hooks only matter in a real developer checkout. Git/npx installs run
// `prepare` from a temp clone where there is no .git and husky is not
// installed, so we skip setup there rather than fail the install.

const root = process.cwd();
const binDir = join(root, 'node_modules', '.bin');
process.env.PATH = `${binDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`;

if (existsSync(resolve('.git')) && hasLocalBin('husky')) {
  try {
    execSync('npm exec --no-install husky', { stdio: 'inherit', cwd: root });
  } catch {
    // best-effort: a .git checkout without hooks is not fatal
  }
}

function hasLocalBin(name) {
  try {
    execSync(`npm exec --no-install -- ${name} --version`, { stdio: 'ignore', cwd: root });
    return true;
  } catch {
    return false;
  }
}
