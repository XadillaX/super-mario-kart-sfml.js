'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const APPIMAGETOOL_URL =
  'https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage';
const APPIMAGETOOL_SHA256 =
  'ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0';

/** Parse ldd's resolved paths, failing closed for missing shared libraries. */
function parseLdd(output) {
  const libraries = [];
  for (const raw of String(output).split('\n')) {
    const line = raw.trim();
    if (/=>\s*not found(?:\s|$)/.test(line)) {
      throw new Error(`Unresolved native runtime dependency: ${line}`);
    }
    const mapped = line.match(/^(\S+)\s+=>\s+(\/.+?)\s+\(0x[\da-f]+\)$/i);
    if (mapped) {
      libraries.push({ name: mapped[1], source: mapped[2] });
      continue;
    }
    const direct = line.match(/^(\/.+?)\s+\(0x[\da-f]+\)$/i);
    if (direct) libraries.push({ name: path.basename(direct[1]), source: direct[1] });
  }
  return libraries;
}

/** Leave glibc and GPU drivers on the host to preserve their ABI coupling. */
function shouldBundleLibrary(name) {
  // The system loader, glibc, and the host GPU stack must remain a matched set.
  return ![
    /^(?:ld-linux[^/]*|ld64)\.so(?:\.|$)/,
    /^lib(?:c|c_malloc_debug|m|mvec|pthread|dl|rt|resolv|util|anl|BrokenLocale|thread_db|memusage|pcprofile)\.so(?:\.|$)/,
    /^libnss_[^/]*\.so(?:\.|$)/,
    /^lib(?:GL[^/]*|EGL[^/]*|GLES[^/]*|OpenGL|glapi|drm[^/]*|gbm|vulkan[^/]*|LLVM[^/]*|nvidia[^/]*|cuda[^/]*)\.so(?:\.|$)/,
    /_dri\.so(?:\.|$)/,
  ].some(pattern => pattern.test(name));
}

/** Collect the transitive ELF dependency graph into a private library directory. */
async function copyRuntimeLibraries(executables, destination, searchDirectories, run) {
  await fs.mkdir(destination, { recursive: true });
  const env = {
    ...process.env,
    LC_ALL: 'C',
    LD_LIBRARY_PATH: [destination, ...searchDirectories].join(':'),
  };
  const pending = [...executables];
  const inspected = new Set();
  const bundled = new Map();
  const external = new Map();
  while (pending.length) {
    const executable = pending.shift();
    const real = await fs.realpath(executable);
    if (inspected.has(real)) continue;
    inspected.add(real);
    const libraries = parseLdd(await run('ldd', [executable], {
      encoding: 'utf8', stdio: 'pipe', env,
    }));
    for (const library of libraries) {
      if (!shouldBundleLibrary(library.name)) {
        external.set(library.name, library);
      } else if (!bundled.has(library.name)) {
        const target = path.join(destination, library.name);
        await fs.copyFile(library.source, target);
        bundled.set(library.name, { ...library, destination: target });
        pending.push(library.source);
      }
    }
  }
  return { bundled: [...bundled.values()], external: [...external.values()] };
}

/** Verify pinned tool bytes before executing downloaded code. */
async function verifyChecksum(file, expected) {
  const digest = createHash('sha256').update(await fs.readFile(file)).digest('hex');
  if (digest !== expected) throw new Error(`SHA256 checksum mismatch for ${file}: ${digest}`);
}

/** Return the largest embedded PNG, validating every ICO directory entry. */
function extractPngIcon(ico) {
  if (ico.length < 6 || ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) {
    throw new Error('Invalid ICO icon header');
  }
  const count = ico.readUInt16LE(4);
  const directorySize = 6 + count * 16;
  if (!count || directorySize > ico.length) throw new Error('Invalid ICO icon directory');
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const images = [];
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 16;
    const size = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    if (offset < directorySize || size < 8 || offset + size > ico.length) {
      throw new Error('ICO icon image is out of bounds');
    }
    const image = ico.subarray(offset, offset + size);
    if (image.subarray(0, 8).equals(signature)) {
      images.push({ image, width: ico[entry] || 256, height: ico[entry + 1] || 256 });
    }
  }
  images.sort((a, b) => b.width * b.height - a.width * a.height);
  if (!images.length) throw new Error('ICO icon contains no PNG image');
  return images[0].image;
}

/** Map SemVer prereleases to Debian's lower-sorting tilde notation. */
function debianVersion(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid Debian release version: ${version}`);
  }
  return version.replace('-', '~');
}

/** Render package metadata with ELF-derived dependencies and dlopen audio backends. */
function debianControl(version, installedSize, dependencies) {
  if (!dependencies || /[\0\r\n]/.test(dependencies)) {
    throw new Error('Invalid Debian dependencies');
  }
  if (!Number.isSafeInteger(installedSize) || installedSize < 0) {
    throw new Error('Invalid Debian installed size');
  }
  return [
    'Package: super-mario-kart',
    `Version: ${debianVersion(version)}`,
    'Section: games',
    'Priority: optional',
    'Architecture: amd64',
    'Maintainer: XadillaX <i@2333.moe>',
    `Installed-Size: ${installedSize}`,
    `Depends: ${dependencies}, libasound2t64 | libasound2, libpulse0`,
    'Homepage: https://github.com/XadillaX/super-mario-kart-sfml.js',
    'Description: Super Mario Kart powered by sfml.js',
    ' A standalone TypeScript kart-racing game, with its own Node.js runtime,',
    ' SFML native libraries, and game assets. No system Node.js is required.',
    '',
  ].join('\n');
}

/** Resolve a library's Debian package, including merged-/usr path aliases. */
async function packageOwner(file, run) {
  const resolved = await fs.realpath(file);
  const candidates = new Set([file, resolved]);
  for (const candidate of candidates) {
    if (candidate.startsWith('/usr/')) candidates.add(candidate.slice(4));
    else if (/^\/(?:lib|lib64|bin|sbin)\//.test(candidate)) candidates.add(`/usr${candidate}`);
  }
  for (const candidate of candidates) {
    let output;
    try {
      output = String(await run('dpkg-query', ['--search', candidate], {
        encoding: 'utf8', stdio: 'pipe', env: { ...process.env, LC_ALL: 'C' },
      }));
    } catch {
      continue;
    }
    for (const line of output.split('\n')) {
      const match = line.match(/^([a-z0-9][a-z0-9+.-]*(?::[a-z0-9-]+)?): \//);
      if (match) return match[1].split(':')[0];
    }
  }
  return null;
}

/** Preserve the installed copyright notices for each redistributed system library. */
async function retainLibraryNotices(libraries, destination, run) {
  await fs.mkdir(destination, { recursive: true });
  const packages = new Set();
  for (const library of libraries) {
    const owner = await packageOwner(library.source, run);
    if (!owner) {
      if (/^\/(?:usr\/)?lib(?:64)?\//.test(library.source)) {
        throw new Error(`Cannot identify the license owner of ${library.source}`);
      }
      continue; // SFML and application dependency notices are in the payload.
    }
    if (packages.has(owner)) continue;
    packages.add(owner);
    await fs.copyFile(`/usr/share/doc/${owner}/copyright`,
      path.join(destination, `${owner}.copyright`));
  }
  return [...packages];
}

/** Sum installed bytes without following symlinks outside the package. */
async function installedSize(directory) {
  let bytes = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) bytes += await installedSize(file);
    else bytes += (await fs.lstat(file)).size;
  }
  return bytes;
}

/** Build with checksum-pinned appimagetool, extracting the tool to avoid FUSE. */
async function createAppImage(appDir, staging, artifact, run) {
  const tooling = path.join(staging, 'appimage tooling');
  await fs.mkdir(tooling);
  const tool = path.join(tooling, 'appimagetool.AppImage');
  const response = await fetch(APPIMAGETOOL_URL, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`appimagetool download failed: HTTP ${response.status}`);
  await fs.writeFile(tool, Buffer.from(await response.arrayBuffer()), { mode: 0o755 });
  await verifyChecksum(tool, APPIMAGETOOL_SHA256);
  await run(tool, ['--appimage-extract'], { cwd: tooling });
  await run(path.join(tooling, 'squashfs-root/AppRun'), [
    '--no-appstream', '--comp', 'gzip', appDir, artifact,
  ], { env: { ...process.env, ARCH: 'x86_64' } });
  await fs.chmod(artifact, 0o755);
}

/** Build a Debian filesystem tree, derive ABI dependencies, and smoke its extraction. */
async function createDebianPackage(context, appDir, libraries, privatePackages, artifact) {
  const { staging, version, createExecutable, smoke, run } = context;
  const debRoot = path.join(staging, 'debian');
  await fs.mkdir(debRoot);
  await fs.cp(path.join(appDir, 'usr'), path.join(debRoot, 'usr'), {
    recursive: true, verbatimSymlinks: true,
  });
  const appBase = path.join(debRoot, 'usr/lib/super-mario-kart');
  const executable = path.join(appBase, 'super-mario-kart');
  // /usr/bin is a relocatable launcher; its sibling library tree holds the SEA.
  await createExecutable(executable, 'app');
  await fs.copyFile(path.join(__dirname, 'linux/launcher'),
    path.join(debRoot, 'usr/bin/super-mario-kart'));
  await fs.chmod(path.join(debRoot, 'usr/bin/super-mario-kart'), 0o755);
  const work = path.join(staging, 'debian dependency scan');
  await fs.mkdir(path.join(work, 'debian'), { recursive: true });
  await fs.writeFile(path.join(work, 'debian/control'), [
    'Source: super-mario-kart',
    'Section: games',
    'Priority: optional',
    'Maintainer: XadillaX <i@2333.moe>',
    '',
    'Package: super-mario-kart',
    'Architecture: amd64',
    'Description: Standalone kart-racing game',
    '',
  ].join('\n'));
  const sfml = path.join(appBase, 'app/node_modules/sfml.js');
  const privateLib = path.join(appBase, 'lib');
  // Scan every bundled ELF, not just the launcher: SFML and libstdc++ may require
  // a newer glibc than Node. Suppress only dependencies actually shipped here.
  const elfFiles = [
    executable, path.join(sfml, 'build/Release/sfml.node'),
    ...libraries.map(library => path.join(privateLib, library.name)),
  ];
  const dependencyOutput = String(await run('dpkg-shlibdeps', [
    '--ignore-missing-info', '-O',
    `-l${privateLib}`, `-l${path.join(sfml, 'third_party/sfml/lib')}`,
    ...privatePackages.map(name => `-x${name}`),
    ...elfFiles.map(file => `-e${file}`),
  ], { cwd: work, encoding: 'utf8', stdio: 'pipe' }));
  const dependencies = dependencyOutput.match(/^shlibs:Depends=(.+)$/m)?.[1];
  const metadata = path.join(debRoot, 'DEBIAN');
  await fs.mkdir(metadata);
  await fs.writeFile(path.join(metadata, 'control'), debianControl(
    version, Math.ceil(await installedSize(path.join(debRoot, 'usr')) / 1024), dependencies
  ));
  await run('dpkg-deb', ['--root-owner-group', '--build', debRoot, artifact]);
  const extracted = path.join(staging, 'debian extracted smoke');
  await run('dpkg-deb', ['--extract', artifact, extracted]);
  await smoke(path.join(extracted, 'usr/bin/super-mario-kart'));
}

/** Assemble the Linux app and smoke the AppDir, extracted AppImage, and extracted deb. */
async function packagePlatform(context) {
  if (process.platform !== 'linux') throw new Error('Linux packaging requires Linux');
  if (context.arch !== 'x64') throw new Error('Linux packaging supports x64 only');
  const { root, staging, output, version, prepareApp, createExecutable, smoke, run } = context;
  const appDir = path.join(staging, 'SuperMarioKart.AppDir');
  const appRoot = path.join(appDir, 'usr/lib/super-mario-kart/app');
  const executable = path.join(appDir, 'usr/bin/super-mario-kart');
  const privateLib = path.join(appDir, 'usr/lib/super-mario-kart/lib');
  const basename = `super-mario-kart-${version}-linux-x64`;
  const appImage = path.join(output, `${basename}.AppImage`);
  const deb = path.join(output, `${basename}.deb`);
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.mkdir(output, { recursive: true });
  await prepareApp(appRoot);
  await createExecutable(executable, '../lib/super-mario-kart/app');
  const sfml = path.join(appRoot, 'node_modules/sfml.js');
  const libraries = await copyRuntimeLibraries([
    executable, path.join(sfml, 'build/Release/sfml.node'),
  ], privateLib, [path.join(sfml, 'third_party/sfml/lib')], run);
  const documentation = path.join(appDir, 'usr/share/doc/super-mario-kart');
  const privatePackages = await retainLibraryNotices(libraries.bundled,
    path.join(documentation, 'third-party'), run);
  await fs.copyFile(path.join(root, 'LICENSE'), path.join(documentation, 'copyright'));
  await fs.copyFile(path.join(__dirname, 'linux/AppRun'), path.join(appDir, 'AppRun'));
  await fs.chmod(path.join(appDir, 'AppRun'), 0o755);

  const icon = extractPngIcon(await fs.readFile(path.join(root, 'assets/icon.ico')));
  const iconDirectory = path.join(appDir, 'usr/share/icons/hicolor/256x256/apps');
  const desktopDirectory = path.join(appDir, 'usr/share/applications');
  await fs.mkdir(iconDirectory, { recursive: true });
  await fs.mkdir(desktopDirectory, { recursive: true });
  for (const file of ['super-mario-kart.png', '.DirIcon']) {
    await fs.writeFile(path.join(appDir, file), icon);
  }
  await fs.writeFile(path.join(iconDirectory, 'super-mario-kart.png'), icon);
  for (const destination of [appDir, desktopDirectory]) {
    await fs.copyFile(path.join(__dirname, 'linux/super-mario-kart.desktop'),
      path.join(destination, 'super-mario-kart.desktop'));
  }
  await smoke(path.join(appDir, 'AppRun'));
  await createAppImage(appDir, staging, appImage, run);
  const extractedImage = path.join(staging, 'appimage extracted smoke');
  await fs.mkdir(extractedImage);
  await run(appImage, ['--appimage-extract'], { cwd: extractedImage });
  await smoke(path.join(extractedImage, 'squashfs-root/AppRun'));
  await createDebianPackage(context, appDir, libraries.bundled, privatePackages, deb);
  return [appImage, deb];
}

module.exports = {
  copyRuntimeLibraries,
  debianControl,
  debianVersion,
  extractPngIcon,
  packagePlatform,
  parseLdd,
  shouldBundleLibrary,
  verifyChecksum,
};
