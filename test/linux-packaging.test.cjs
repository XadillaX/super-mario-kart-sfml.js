'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const packaging = require('../tools/packaging/linux.cjs');

/** Allocate and clean temporary fixture data without copying the repository. */
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smk linux test '));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('ldd parsing preserves paths with spaces and fails on unresolved libraries', () => {
  assert.deepEqual(packaging.parseLdd(`
    linux-vdso.so.1 (0x123)
    libsfml-audio.so.3.1 => /tmp/Kart App/libsfml-audio.so.3.1 (0x456)
    libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x789)
    /lib64/ld-linux-x86-64.so.2 (0xabc)
  `), [
    { name: 'libsfml-audio.so.3.1', source: '/tmp/Kart App/libsfml-audio.so.3.1' },
    { name: 'libc.so.6', source: '/lib/x86_64-linux-gnu/libc.so.6' },
    { name: 'ld-linux-x86-64.so.2', source: '/lib64/ld-linux-x86-64.so.2' },
  ]);
  assert.throws(() => packaging.parseLdd('libsfml-audio.so.3.1 => not found'),
    /libsfml-audio.so.3.1/);
});

test('bundles native dependencies but never glibc or graphics drivers', () => {
  for (const name of [
    'libsfml-graphics.so.3.1', 'libstdc++.so.6', 'libgcc_s.so.1',
    'libfreetype.so.6', 'libFLAC.so.12', 'libX11.so.6', 'libudev.so.1',
  ]) {
    assert.equal(packaging.shouldBundleLibrary(name), true, name);
  }
  for (const name of [
    'libc.so.6', 'libm.so.6', 'libmvec.so.1', 'libpthread.so.0', 'libdl.so.2', 'librt.so.1',
    'libc_malloc_debug.so.0', 'libmemusage.so', 'libpcprofile.so',
    'ld-linux-x86-64.so.2', 'libnss_files.so.2', 'libGL.so.1',
    'libGLX.so.0', 'libGLdispatch.so.0', 'libEGL.so.1', 'libGLESv2.so.2',
    'libdrm.so.2', 'libgbm.so.1', 'libglapi.so.0', 'libLLVM.so.19.1',
    'libvulkan.so.1', 'libnvidia-glcore.so.550.1', 'radeonsi_dri.so',
  ]) {
    assert.equal(packaging.shouldBundleLibrary(name), false, name);
  }
});

test('collects transitive private libraries and records unbundled host dependencies', {
  skip: process.platform === 'win32',
}, async t => {
  const directory = await fixture(t);
  const native = path.join(directory, 'sfml.node');
  const source = path.join(directory, 'system libs');
  const destination = path.join(directory, 'private lib');
  await fs.mkdir(source);
  await fs.writeFile(native, 'native addon');
  for (const name of ['libsfml-graphics.so.3.1', 'libfreetype.so.6']) {
    await fs.writeFile(path.join(source, name), name);
  }
  const run = (command, args, options) => {
    assert.equal(command, 'ldd');
    assert.equal(options.env.LD_LIBRARY_PATH.includes(source), true);
    if (args[0] === native) {
      return `libsfml-graphics.so.3.1 => ${source}/libsfml-graphics.so.3.1 (0x123)
libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x456)`;
    }
    if (path.basename(args[0]) === 'libsfml-graphics.so.3.1') {
      return `libfreetype.so.6 => ${source}/libfreetype.so.6 (0x789)
libGL.so.1 => /lib/x86_64-linux-gnu/libGL.so.1 (0xabc)`;
    }
    return 'libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x456)';
  };
  const result = await packaging.copyRuntimeLibraries(
    [native], destination, [source], run
  );
  assert.deepEqual((await fs.readdir(destination)).sort(),
    ['libfreetype.so.6', 'libsfml-graphics.so.3.1']);
  assert.deepEqual(result.bundled.map(item => item.name).sort(),
    ['libfreetype.so.6', 'libsfml-graphics.so.3.1']);
  assert.deepEqual(result.external.map(item => item.name).sort(),
    ['libGL.so.1', 'libc.so.6']);
});

test('checksum validation rejects corrupt appimagetool bytes', async t => {
  const directory = await fixture(t);
  const file = path.join(directory, 'appimagetool');
  await fs.writeFile(file, 'abc');
  await packaging.verifyChecksum(file,
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  await assert.rejects(packaging.verifyChecksum(file, '0'.repeat(64)), /checksum/i);
});

test('AppRun resolves a relocated bundle and forwards arguments and library paths', {
  skip: process.platform === 'win32',
}, async t => {
  const directory = await fixture(t);
  const appDir = path.join(directory, 'moved AppDir');
  const executable = path.join(appDir, 'usr/bin/super-mario-kart');
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.copyFile(path.join(__dirname, '../tools/packaging/linux/AppRun'),
    path.join(appDir, 'AppRun'));
  await fs.chmod(path.join(appDir, 'AppRun'), 0o755);
  await fs.writeFile(executable, '#!/bin/sh\nprintf "%s\\n" "$LD_LIBRARY_PATH" "$@"\n',
    { mode: 0o755 });
  const output = execFileSync(path.join(appDir, 'AppRun'), ['--smoke-test', 'two words'], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    env: { ...process.env, LD_LIBRARY_PATH: '/existing/lib' },
  }).trim().split('\n');
  assert.equal(output[0], [
    path.join(appDir, 'usr/lib/super-mario-kart/lib'),
    path.join(appDir, 'usr/lib/super-mario-kart/app/native/third_party/sfml/lib'),
    '/existing/lib',
  ].join(':'));
  assert.deepEqual(output.slice(1), ['--smoke-test', 'two words']);
  const clean = execFileSync(path.join(appDir, 'AppRun'), [], {
    cwd: os.tmpdir(), encoding: 'utf8', env: { PATH: process.env.PATH },
  }).trim();
  assert.equal(clean.endsWith(':'), false, 'do not add cwd to library search path');
});

test('Debian launcher finds its private runtime after extraction under a path with spaces', {
  skip: process.platform === 'win32',
}, async t => {
  const directory = await fixture(t);
  const root = await fs.realpath(directory);
  const launcher = path.join(root, 'usr/bin/super-mario-kart');
  const privateDirectory = path.join(root, 'usr/lib/super-mario-kart');
  await fs.mkdir(path.dirname(launcher), { recursive: true });
  await fs.mkdir(privateDirectory, { recursive: true });
  await fs.copyFile(path.join(__dirname, '../tools/packaging/linux/launcher'), launcher);
  await fs.chmod(launcher, 0o755);
  await fs.writeFile(path.join(privateDirectory, 'super-mario-kart'),
    '#!/bin/sh\nprintf "%s\\n" "$LD_LIBRARY_PATH" "$@"\n', { mode: 0o755 });
  const output = execFileSync(launcher, ['--smoke-test', 'two words'], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  }).trim().split('\n');
  assert.deepEqual(output, [
    `${privateDirectory}/lib:${privateDirectory}/app/native/third_party/sfml/lib`,
    '--smoke-test',
    'two words',
  ]);
});

test('extracts the original PNG icon from ICO and rejects malformed offsets', async () => {
  const ico = await fs.readFile(path.join(__dirname, '../assets/icon.ico'));
  const png = packaging.extractPngIcon(ico);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.throws(() => packaging.extractPngIcon(Buffer.alloc(6)), /icon|ICO/i);
  const broken = Buffer.from(ico);
  for (let index = 0; index < broken.readUInt16LE(4); index++) {
    broken.writeUInt32LE(0xffffffff, 6 + index * 16 + 12);
  }
  assert.throws(() => packaging.extractPngIcon(broken), /icon|ICO|bounds/i);
});

test('Debian versions retain release and prerelease ordering without control injection', () => {
  assert.equal(packaging.debianVersion('1.2.3'), '1.2.3');
  assert.equal(packaging.debianVersion('1.2.3-rc.1'), '1.2.3~rc.1');
  assert.equal(packaging.debianVersion('1.2.3-rc.1+build.5'), '1.2.3~rc.1+build.5');
  assert.throws(() => packaging.debianVersion('1.2.3\nDepends: bad'), /version/i);
});

test('Debian control retains derived ABI floors and explicit dlopen audio dependencies', () => {
  const control = packaging.debianControl('1.2.3-rc.1', 1234,
    'libc6 (>= 2.38), libgl1, libglx0');
  assert.match(control, /^Version: 1\.2\.3~rc\.1$/m);
  assert.match(control, /^Architecture: amd64$/m);
  assert.match(control, /^Installed-Size: 1234$/m);
  assert.match(control, /^Depends: libc6 \(>= 2\.38\), libgl1, libglx0, libasound2t64 \| libasound2, libpulse0$/m);
  assert.throws(() => packaging.debianControl('1.0.0', 1, 'libc6\nInjected: yes'),
    /depend|control|line/i);
  assert.throws(() => packaging.debianControl('1.0.0', 1, ''), /depend/i);
});

test('platform packaging refuses non-Linux hosts before creating artifacts', {
  skip: process.platform === 'linux',
}, async () => {
  await assert.rejects(packaging.packagePlatform({ arch: 'x64' }), /Linux/);
});
