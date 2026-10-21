'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const SFML_DLLS = ['graphics', 'window', 'system', 'audio']
  .map(component => `sfml-${component}-3.dll`);
const CRT_DLLS = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'];

/** Quote a PowerShell literal without expanding variables or apostrophes. */
function powerShellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** Escape NSIS string syntax and reject multiline directive injection. */
function nsisLiteral(value) {
  const text = String(value);
  if (/[\0\r\n]/.test(text)) {
    throw new Error('NSIS values cannot contain control characters or newlines');
  }
  return text.replaceAll('$', () => '$$').replaceAll('"', '$\\"');
}

/** Render the installer with literal values, rejecting missing definitions. */
function renderInstaller(template, values) {
  return template.replace(/@([A-Z_]+)@/g, (_, name) => {
    if (!Object.hasOwn(values, name)) {
      throw new Error(`Missing NSIS template value: ${name}`);
    }
    return nsisLiteral(values[name]);
  });
}

/** Emit exact owned-file deletes and nonrecursive directory removals in postorder. */
async function writeUninstallManifest(bundle, destination) {
  const files = [];
  const directories = [];
  /** Visit bundle entries without following links into unrelated directories. */
  async function visit(relative) {
    const entries = await fs.readdir(path.join(bundle, relative), { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const name = path.join(relative, entry.name);
      if (/[*?]/.test(name)) throw new Error(`Invalid Windows bundle filename: ${name}`);
      if (entry.isDirectory()) {
        await visit(name);
        directories.push(name);
      } else {
        files.push(name);
      }
    }
  }
  await visit('');
  const commands = [];
  for (const [command, entries] of [['Delete', files], ['RMDir', directories]]) {
    for (const name of entries) {
      const escaped = nsisLiteral(name.split(path.sep).join('\\'));
      commands.push(`${command} "$INSTDIR\\${escaped}"`);
    }
  }
  await fs.writeFile(destination, `${commands.join('\n')}\n`);
}

/** Locate the newest installed Visual Studio x64 redistributable CRT. */
async function findCrtDirectory(run) {
  let redist = process.env.VCToolsRedistDir;
  if (!redist) {
    const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    const installation = String(await run(vswhere, [
      '-latest', '-products', '*', '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property', 'installationPath',
    ], { encoding: 'utf8', stdio: 'pipe' })).trim();
    if (!installation) throw new Error('Visual Studio C++ runtime installation is missing');
    const directory = path.join(installation, 'VC', 'Redist', 'MSVC');
    const versions = (await fs.readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name))
      .map(entry => entry.name)
      .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
    if (!versions.length) throw new Error(`No Visual C++ runtime found in ${directory}`);
    redist = path.join(directory, versions[0]);
  }
  const architectureDirectory = path.join(redist, 'x64');
  const directories = (await fs.readdir(architectureDirectory, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && /^Microsoft\.VC\d+\.CRT$/i.test(entry.name))
    .sort((a, b) => b.name.localeCompare(a.name, 'en', { numeric: true }));
  if (!directories.length) throw new Error('The x64 Visual C++ runtime is missing');
  return path.join(architectureDirectory, directories[0].name);
}

/** Copy only the four SFML components used by the binding and the release CRT. */
async function copyRuntimeLibraries(root, destination, crtDirectory) {
  const sfmlDirectory = path.join(root, 'node_modules/sfml.js/third_party/sfml/bin');
  const sfmlFiles = (await fs.readdir(sfmlDirectory)).filter(name => SFML_DLLS.includes(name));
  const runtimeFiles = (await fs.readdir(crtDirectory))
    .filter(name => /^(?:msvcp140[^\\/]*|vcruntime140[^\\/]*|concrt140)\.dll$/i.test(name));
  for (const name of SFML_DLLS) {
    if (!sfmlFiles.includes(name)) throw new Error(`Missing SFML runtime: ${name}`);
  }
  for (const name of CRT_DLLS) {
    if (!runtimeFiles.includes(name)) throw new Error(`Missing Visual C++ runtime: ${name}`);
  }
  await fs.mkdir(destination, { recursive: true });
  const files = [];
  for (const [directory, names] of [[sfmlDirectory, sfmlFiles], [crtDirectory, runtimeFiles]]) {
    for (const name of names) {
      const target = path.join(destination, name);
      await fs.copyFile(path.join(directory, name), target);
      files.push(target);
    }
  }
  return files;
}

/** Prefer an explicit or standard NSIS installation, then the runner's PATH. */
async function findMakensis() {
  const directories = [
    process.env.NSIS_DIR,
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'NSIS'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NSIS'),
  ].filter(Boolean);
  for (const directory of directories) {
    const executable = path.join(directory, 'makensis.exe');
    try {
      await fs.access(executable);
      return executable;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return 'makensis.exe';
}

/** Exercise silent install and uninstall only on the disposable CI runner. */
async function smokeInstaller(installer, staging, smoke, run) {
  const installed = path.join(staging, 'installed smoke with spaces');
  await fs.mkdir(path.join(installed, 'app'), { recursive: true });
  const unowned = [
    path.join(installed, 'unrelated.dll'),
    path.join(installed, 'app/unrelated.txt'),
  ];
  for (const file of unowned) await fs.writeFile(file, 'not owned by the game');
  // NSIS requires these last arguments to be unquoted, including paths with spaces.
  const options = { windowsVerbatimArguments: true, timeout: 180_000 };
  await run(installer, ['/S', `/D=${installed}`], options);
  try {
    await smoke(path.join(installed, 'SuperMarioKart.exe'));
  } finally {
    await run(path.join(installed, 'Uninstall.exe'), ['/S', `_?=${installed}`], options);
  }
  for (const file of unowned) {
    if (await fs.readFile(file, 'utf8') !== 'not owned by the game') {
      throw new Error(`Uninstaller changed an unrelated file: ${file}`);
    }
  }
  if ((await fs.readdir(installed)).includes('SuperMarioKart.exe')) {
    throw new Error('Uninstaller left the installed game executable behind');
  }
}

/** Build and smoke a Windows portable ZIP, then compile a per-user installer. */
async function packagePlatform(context) {
  if (process.platform !== 'win32') throw new Error('Windows packaging requires Windows');
  if (context.arch !== 'x64') throw new Error('Windows packaging supports x64 only');
  const { root, staging, output, version, productName, prepareApp,
    createExecutable, smoke, run } = context;
  const bundle = path.join(staging, 'SuperMarioKart');
  const executable = path.join(bundle, 'SuperMarioKart.exe');
  const basename = `super-mario-kart-${version}-windows-x64`;
  const portable = path.join(output, `${basename}-portable.zip`);
  const installer = path.join(output, `${basename}-setup.exe`);
  await fs.mkdir(bundle, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  await prepareApp(path.join(bundle, 'app'));
  await createExecutable(executable, 'app');
  await copyRuntimeLibraries(root, bundle, await findCrtDirectory(run));
  await fs.copyFile(path.join(root, 'assets/icon.ico'), path.join(bundle, 'icon.ico'));
  await smoke(executable);

  const powershell = script => run('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference = 'Stop'; ${script}`,
  ]);
  // .NET's zip API includes hidden files; Compress-Archive silently omits them.
  await fs.rm(portable, { force: true });
  await powershell('Add-Type -AssemblyName System.IO.Compression.FileSystem; ' +
    `[IO.Compression.ZipFile]::CreateFromDirectory(${powerShellLiteral(bundle)}, ` +
    `${powerShellLiteral(portable)}, [IO.Compression.CompressionLevel]::Optimal, $true)`);
  const extracted = path.join(staging, 'portable smoke with spaces');
  await fs.mkdir(extracted);
  await powershell('Add-Type -AssemblyName System.IO.Compression.FileSystem; ' +
    `[IO.Compression.ZipFile]::ExtractToDirectory(${powerShellLiteral(portable)}, ` +
    `${powerShellLiteral(extracted)})`);
  await smoke(path.join(extracted, 'SuperMarioKart', 'SuperMarioKart.exe'));

  const template = await fs.readFile(path.join(__dirname, 'windows/installer.nsi'), 'utf8');
  const script = path.join(staging, 'installer.nsi');
  const uninstallFiles = path.join(staging, 'uninstall-files.nsh');
  await writeUninstallManifest(bundle, uninstallFiles);
  await fs.writeFile(script, renderInstaller(template, {
    PRODUCT_NAME: productName,
    VERSION: version,
    BUNDLE: bundle,
    OUTPUT: installer,
    ICON: path.join(root, 'assets/icon.ico'),
    UNINSTALL_FILES: uninstallFiles,
  }));
  await run(await findMakensis(), ['/INPUTCHARSET', 'UTF8', script]);
  await fs.access(installer);
  if (process.env.CI === 'true') await smokeInstaller(installer, staging, smoke, run);
  return [portable, installer];
}

module.exports = {
  copyRuntimeLibraries,
  nsisLiteral,
  packagePlatform,
  powerShellLiteral,
  renderInstaller,
  writeUninstallManifest,
};
