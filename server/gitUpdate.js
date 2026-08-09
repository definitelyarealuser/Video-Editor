const { execFile } = require('child_process');
const path = require('path');

/**
 * Lets the app pull its own updates from GitHub and restart itself - same trust model as the
 * rest of this app (browse-folders, save-to-any-local-path, etc.): it only ever runs on your
 * own machine, so there's no separate auth layer here beyond that.
 */

const ROOT = path.join(__dirname, '..');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    // shell: true so `npm` resolves correctly on Windows (where the real executable is
    // npm.cmd) - Node's execFile doesn't go through a shell by default, which is otherwise a
    // classic gotcha for spawning npm cross-platform.
    execFile(cmd, args, { cwd: ROOT, shell: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error((stderr || '').trim() || err.message);
        e.detail = stderr;
        return reject(e);
      }
      resolve((stdout || '').trim());
    });
  });
}

function getCurrentBranch() {
  return run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
}

async function getCurrentCommit() {
  const hash = await run('git', ['rev-parse', 'HEAD']);
  const message = await run('git', ['log', '-1', '--pretty=%s']);
  return { hash, message };
}

async function isWorkingTreeClean() {
  const status = await run('git', ['status', '--porcelain']);
  return status.length === 0;
}

/**
 * Fetches the current branch from origin and compares local HEAD to the remote tip - doesn't
 * change anything on disk, just reports whether an update is available.
 */
async function checkForUpdate() {
  const branch = await getCurrentBranch();
  await run('git', ['fetch', 'origin', branch]);
  const current = await getCurrentCommit();
  const latestHash = await run('git', ['rev-parse', `origin/${branch}`]);
  const latestMessage = await run('git', ['log', '-1', '--pretty=%s', `origin/${branch}`]);
  return {
    branch,
    updateAvailable: current.hash !== latestHash,
    current,
    latest: { hash: latestHash, message: latestMessage },
  };
}

/**
 * Actually applies the update: fetches, then hard-resets the working tree to match the
 * remote branch exactly. A deployed copy of this app is never meant to carry local commits,
 * so a hard reset is simpler and more reliable than a merge-based pull - there's no way for it
 * to produce a conflict. Refuses if there are uncommitted changes to tracked files, as a
 * safety net against silently discarding something unexpected.
 */
async function applyUpdate() {
  const clean = await isWorkingTreeClean();
  if (!clean) {
    throw new Error(
      "This install has local file changes that an update would overwrite - that shouldn't normally happen. Leave this one to whoever manages the code."
    );
  }

  const branch = await getCurrentBranch();
  await run('git', ['fetch', 'origin', branch]);
  await run('git', ['reset', '--hard', `origin/${branch}`]);
  await run('npm', ['install']);

  const current = await getCurrentCommit();
  return { branch, current };
}

module.exports = { getCurrentBranch, getCurrentCommit, checkForUpdate, applyUpdate };
