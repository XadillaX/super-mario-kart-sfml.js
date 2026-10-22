'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const packaging = require('../tools/packaging/windows.cjs');

/** Allocate and clean temporary fixture data without copying the repository. */
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smk windows test '));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('copies SFML release DLLs and app-local CRT without CI graphics DLLs', async t => {
  const directory = await fixture(t);
  const sfml = path.join(directory, 'node_modules/sfml.js');
  const runtime = path.join(directory, 'CRT');
  const bundle = path.join(directory, 'bundle');
  await fs.mkdir(path.join(sfml, 'third_party/sfml/bin'), { recursive: true });
  await fs.mkdir(path.join(sfml, 'build/Release'), { recursive: true });
  await fs.mkdir(runtime);
  await fs.mkdir(bundle);
  const releaseNames = [
    'sfml-graphics-3.dll', 'sfml-window-3.dll', 'sfml-system-3.dll',
    'sfml-audio-3.dll',
  ];
  for (const name of [
    ...releaseNames, 'sfml-audio-d-3.dll', 'opengl32.dll',
    'sfml-network-3.dll', 'mbedtls.dll', 'mbedcrypto.dll', 'mbedx509.dll',
  ]) {
    await fs.writeFile(path.join(sfml, 'third_party/sfml/bin', name), name);
  }
  await fs.writeFile(path.join(sfml, 'build/Release/opengl32.dll'), 'CI Mesa');
  for (const name of ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']) {
    await fs.writeFile(path.join(runtime, name), name);
  }
  const files = await packaging.copyRuntimeLibraries(directory, bundle, runtime);
  assert.deepEqual((await fs.readdir(bundle)).sort(), [
    ...releaseNames, 'msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll',
  ].sort());
  assert.equal(files.length, 7);
  assert.equal(await fs.readFile(path.join(bundle, 'vcruntime140_1.dll'), 'utf8'),
    'vcruntime140_1.dll');
});

test('fails closed when the portable runtime is incomplete', async t => {
  const directory = await fixture(t);
  await assert.rejects(
    packaging.copyRuntimeLibraries(directory, path.join(directory, 'bundle'),
      path.join(directory, 'missing CRT')),
    /ENOENT|missing|runtime/i
  );
});

test('rejects partial SFML and CRT installations instead of shipping a broken game', async t => {
  const directory = await fixture(t);
  const sfml = path.join(directory, 'node_modules/sfml.js/third_party/sfml/bin');
  const runtime = path.join(directory, 'CRT');
  await fs.mkdir(sfml, { recursive: true });
  await fs.mkdir(runtime);
  await fs.writeFile(path.join(sfml, 'sfml-graphics-3.dll'), 'graphics');
  await assert.rejects(
    packaging.copyRuntimeLibraries(directory, path.join(directory, 'bundle'), runtime),
    /sfml-(audio|window|system)-3\.dll/
  );
  for (const name of ['audio', 'window', 'system']) {
    await fs.writeFile(path.join(sfml, `sfml-${name}-3.dll`), name);
  }
  await fs.writeFile(path.join(runtime, 'msvcp140.dll'), 'runtime');
  await assert.rejects(
    packaging.copyRuntimeLibraries(directory, path.join(directory, 'bundle'), runtime),
    /vcruntime140/
  );
});

test('PowerShell literal quoting preserves paths containing apostrophes', () => {
  assert.equal(packaging.powerShellLiteral("C:\\Users\\O'Brien\\Kart"),
    "'C:\\Users\\O''Brien\\Kart'");
});

test('NSIS definitions escape dollar signs, quotes, and reject line injection', () => {
  assert.equal(packaging.nsisLiteral('C:\\Kart $build\\"quoted"'),
    'C:\\Kart $$build\\$\\\"quoted$\\\"');
  assert.throws(() => packaging.nsisLiteral('Kart\nSection'), /line|newline/i);
  assert.throws(() => packaging.nsisLiteral('Kart\rSection'), /line|newline/i);
  assert.throws(() => packaging.nsisLiteral('Kart\0Section'), /control|line/i);
});

test('NSIS installer definitions preserve literal paths and reject unknown placeholders', () => {
  const rendered = packaging.renderInstaller('OutFile "@OUTPUT@"\nName "@NAME@"', {
    OUTPUT: 'C:\\a $build\\setup.exe',
    NAME: 'Kart "Game"',
  });
  assert.equal(rendered,
    'OutFile "C:\\a $$build\\setup.exe"\nName "Kart $\\\"Game$\\\""');
  assert.throws(() => packaging.renderInstaller('@MISSING@', {}), /MISSING/);
});

test('uninstall manifest removes owned files but preserves unrelated DLLs and app data', async t => {
  const directory = await fixture(t);
  const bundle = path.join(directory, 'bundle');
  const installed = path.join(directory, 'shared installation');
  const manifest = path.join(directory, 'uninstall-files.nsh');
  await fs.mkdir(path.join(bundle, 'app/dist'), { recursive: true });
  await fs.writeFile(path.join(bundle, 'game.dll'), 'owned DLL');
  await fs.writeFile(path.join(bundle, 'app/dist/main.js'), 'owned code');
  await fs.cp(bundle, installed, { recursive: true });
  await fs.writeFile(path.join(installed, 'unrelated.dll'), 'unowned DLL');
  await fs.writeFile(path.join(installed, 'app/unrelated.txt'), 'unowned data');

  await packaging.writeUninstallManifest(bundle, manifest);
  const lines = (await fs.readFile(manifest, 'utf8')).trim().split('\n');
  for (const line of lines) {
    const match = line.match(/^(Delete|RMDir) "\$INSTDIR\\([^"*?]+)"$/);
    assert.ok(match, `Expected a literal file delete or nonrecursive rmdir: ${line}`);
    const target = path.join(installed, ...match[2].split('\\'));
    if (match[1] === 'Delete') {
      await fs.unlink(target);
    } else {
      try {
        await fs.rmdir(target);
      } catch (error) {
        if (error.code !== 'ENOTEMPTY') throw error;
      }
    }
  }
  await assert.rejects(fs.access(path.join(installed, 'game.dll')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(installed, 'app/dist')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(installed, 'unrelated.dll'), 'utf8'), 'unowned DLL');
  assert.equal(await fs.readFile(path.join(installed, 'app/unrelated.txt'), 'utf8'), 'unowned data');
});

test('platform packaging refuses non-Windows hosts before creating artifacts', {
  skip: process.platform === 'win32',
}, async () => {
  await assert.rejects(packaging.packagePlatform({ arch: 'x64' }), /Windows/);
});

test('layout upgrade removes legacy owned files and empty directories while retaining user files', async t => {
  const directory = await fixture(t);
  const bundle = path.join(directory, 'bundle');
  const installed = path.join(directory, 'installation');
  const manifest = path.join(directory, 'upgrade.nsh');
  const resources = ['assets/circuit/base.png', 'licenses/SFML.txt', 'LICENSE', 'README.md', 'package.json'];
  const legacy = [...resources, 'native/build/Release/sfml.node', 'dist/main.js'];
  for (const name of [...resources, 'sfmljs.dll', 'SuperMarioKart.exe']) {
    await fs.mkdir(path.dirname(path.join(bundle, name)), { recursive: true });
    await fs.writeFile(path.join(bundle, name), 'new package');
  }
  await fs.cp(bundle, installed, { recursive: true });
  for (const name of legacy) {
    await fs.mkdir(path.dirname(path.join(installed, 'app', name)), { recursive: true });
    await fs.writeFile(path.join(installed, 'app', name), 'old package');
  }
  const unowned = ['app/unrelated.txt', 'app/assets/custom.png', 'unrelated.dll'];
  for (const name of unowned) {
    await fs.writeFile(path.join(installed, name), 'user file');
  }

  assert.equal(typeof packaging.writeLegacyManifest, 'function', 'Legacy cleanup manifest is missing');
  await packaging.writeLegacyManifest(bundle, manifest);
  for (const line of (await fs.readFile(manifest, 'utf8')).trim().split('\n')) {
    const match = line.match(/^(Delete|RMDir) "\$INSTDIR\\([^"*?]+)"$/);
    assert.ok(match, `Unsafe cleanup directive: ${line}`);
    const target = path.join(installed, ...match[2].split('\\'));
    try {
      if (match[1] === 'Delete') await fs.unlink(target);
      else await fs.rmdir(target);
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
    }
  }
  for (const name of legacy) {
    await assert.rejects(fs.access(path.join(installed, 'app', name)), { code: 'ENOENT' });
  }
  for (const name of ['app/native', 'app/dist', 'app/licenses', 'app/assets/circuit']) {
    await assert.rejects(fs.access(path.join(installed, name)), { code: 'ENOENT' });
  }
  for (const name of unowned) {
    assert.equal(await fs.readFile(path.join(installed, name), 'utf8'), 'user file');
  }
  for (const name of [...resources, 'sfmljs.dll', 'SuperMarioKart.exe']) {
    assert.equal(await fs.readFile(path.join(installed, name), 'utf8'), 'new package');
  }
});
