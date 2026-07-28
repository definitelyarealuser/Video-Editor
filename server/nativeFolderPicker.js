const { execFile } = require('child_process');

/**
 * Pops the OS's own native folder picker, right on the same screen the browser is running on -
 * this only works because the server and the browser using it are always the same machine here.
 * Windows uses WinForms' FolderBrowserDialog via a PowerShell one-liner (passed with
 * -EncodedCommand so it isn't subject to the script-file execution-policy restriction that
 * blocks running .ps1 files); Mac uses AppleScript's `choose folder`. Any other platform (or a
 * failure on a supported one) should fall back to the in-app folder browser - see
 * /api/browse-folders/supported and the try/catch around /api/browse-folders/native.
 */

const DIALOG_TIMEOUT_MS = 5 * 60 * 1000; // generous - this is a modal dialog waiting on a human

function isSupported() {
  return process.platform === 'win32' || process.platform === 'darwin';
}

function pickFolderWindows(initialPath) {
  return new Promise((resolve, reject) => {
    const escapedInitial = (initialPath || '').replace(/'/g, "''");
    const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select a folder'
$dialog.ShowNewFolderButton = $true
if ('${escapedInitial}' -ne '' -and (Test-Path -LiteralPath '${escapedInitial}')) {
  $dialog.SelectedPath = '${escapedInitial}'
}
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.SelectedPath
} else {
  Write-Output '__CANCELLED__'
}
`.trim();
    // -EncodedCommand takes base64 of the UTF-16LE script text - this bypasses the "running
    // scripts is disabled on this system" restriction entirely, since that policy governs
    // executing .ps1 script files, not ad-hoc encoded/inline commands.
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      { timeout: DIALOG_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr && stderr.trim() ? stderr.trim() : err.message));
        const out = stdout.trim();
        resolve(out === '__CANCELLED__' || !out ? null : out);
      }
    );
  });
}

function pickFolderMac(initialPath) {
  return new Promise((resolve, reject) => {
    const escapedInitial = (initialPath || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const defaultLocationClause = initialPath ? ` default location (POSIX file "${escapedInitial}")` : '';
    const script = `POSIX path of (choose folder with prompt "Select a folder"${defaultLocationClause})`;
    execFile('osascript', ['-e', script], { timeout: DIALOG_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) {
        // AppleScript raises error -128 ("User canceled") when Cancel is clicked - not a
        // real failure, just means nothing was picked.
        if (/-128|user canceled/i.test(stderr || '')) return resolve(null);
        return reject(new Error(stderr && stderr.trim() ? stderr.trim() : err.message));
      }
      resolve(stdout.trim());
    });
  });
}

function pickFolder(initialPath) {
  if (process.platform === 'win32') return pickFolderWindows(initialPath);
  if (process.platform === 'darwin') return pickFolderMac(initialPath);
  return Promise.reject(new Error('Native folder picker is not supported on this platform.'));
}

module.exports = { isSupported, pickFolder };
