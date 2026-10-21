'use strict';

const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { retainSfmlNotices } = require('./licenses.cjs');

/** Refuse targets for which sfml.js does not provide native SFML libraries. */
function validateTarget(platform, arch, version) {
    const supported = ['darwin-x64', 'darwin-arm64', 'win32-x64', 'linux-x64'];
    if (!supported.includes(`${platform}-${arch}`)) {
        throw new Error(`Unsupported packaging target: ${platform}-${arch}`);
    }
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
        throw new Error(`Invalid release version: ${version}`);
    }
}

/** Execute argument arrays directly, never through an interpolated shell. */
function run(command, args, options = {}) {
    return execFileSync(command, args, { stdio: 'inherit', ...options });
}

/** The embedded SEA entry resolves external modules from the executable location. */
function bootstrapSource(relativeAppPath) {
    return `'use strict';
const path = require('node:path');
const { createRequire } = require('node:module');
const appRoot = path.resolve(path.dirname(process.execPath), ${JSON.stringify(relativeAppPath)});
const appRequire = createRequire(path.join(appRoot, 'package.json'));
if (process.platform === 'win32') {
    process.env.PATH = path.dirname(process.execPath) + path.delimiter + (process.env.PATH || '');
}
process.chdir(appRoot);
(async () => {
    if (process.argv.includes('--smoke-test')) {
        await appRequire('./_diagnostics/smoke.cjs').run(appRoot);
    } else {
        await appRequire('./dist/main.js').main();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
`;
}

/** Copy a tree without turning relative dylib links into build-machine paths. */
async function copy(source, destination, options = {}) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(source, destination, {
        recursive: true,
        verbatimSymlinks: true,
        ...options,
    });
}

/** Find a package root even when its exports hide package.json. */
async function packageRoot(name, from) {
    const requireFrom = createRequire(path.join(from, 'package.json'));
    let directory = path.dirname(requireFrom.resolve(name));
    while (directory !== path.dirname(directory)) {
        const manifest = path.join(directory, 'package.json');
        if (existsSync(manifest)) {
            const metadata = JSON.parse(await fs.readFile(manifest, 'utf8'));
            if (metadata.name === name) {
                return directory;
            }
        }
        directory = path.dirname(directory);
    }
    throw new Error(`Cannot find runtime dependency ${name}`);
}

/** Package only sfml.js's runtime JS graph, retaining each package's license. */
async function copyRuntimePackages(root, appRoot) {
    const seen = new Map();
    async function visit(name, from) {
        const source = await packageRoot(name, from);
        const metadata = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
        if (seen.has(name)) {
            if (seen.get(name) !== metadata.version) {
                throw new Error(`Conflicting runtime versions for ${name}`);
            }
            return;
        }
        seen.set(name, metadata.version);
        await copy(source, path.join(appRoot, 'node_modules', name), {
            filter(file) {
                const parts = path.relative(source, file).split(path.sep);
                return !parts.some(part => [
                    'node_modules', 'test', 'tests', 'examples', '.github', '.git',
                ].includes(part)) && !file.endsWith('.map');
            },
        });
        for (const dependency of Object.keys(metadata.dependencies || {})) {
            await visit(dependency, source);
        }
    }
    // download, nan and node-gyp are build-time dependencies, not game runtime.
    for (const name of ['basic-ftp', 'ipaddr.js', 'ssh2']) {
        await visit(name, path.join(root, 'node_modules/sfml.js'));
    }
}

/** Fetch a required upstream notice; packaging must not silently omit licenses. */
async function download(url, destination) {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
        throw new Error(`Download failed (${response.status}): ${url}`);
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

/** Assemble an installed application's immutable code, resources and native binding. */
async function prepareApp(root, appRoot) {
    for (const name of ['dist', 'assets', 'LICENSE', 'README.md']) {
        await copy(path.join(root, name), path.join(appRoot, name), {
            filter: file => !file.endsWith('.map'),
        });
    }
    await fs.writeFile(path.join(appRoot, 'package.json'), JSON.stringify({
        name: 'super-mario-kart-sfml.js',
        version: require(path.join(root, 'package.json')).version,
        type: 'commonjs',
        main: 'dist/main.js',
        license: 'GPL-3.0-only',
    }, null, 2) + '\n');
    await copy(path.join(root, 'tools/packaging/smoke.cjs'),
        path.join(appRoot, '_diagnostics/smoke.cjs'));

    const nativeSource = path.join(root, 'node_modules/sfml.js');
    const nativeTarget = path.join(appRoot, 'node_modules/sfml.js');
    for (const name of ['dist', 'package.json', 'LICENSE', 'third_party/sfml/license.md']) {
        await copy(path.join(nativeSource, name), path.join(nativeTarget, name), {
            filter: file => !file.endsWith('.map') && !file.endsWith('.d.ts'),
        });
    }
    await copy(path.join(nativeSource, 'build/Release/sfml.node'),
        path.join(nativeTarget, 'build/Release/sfml.node'));

    if (process.platform !== 'win32') {
        const libraryDirectory = path.join(nativeSource, 'third_party/sfml/lib');
        for (const entry of await fs.readdir(libraryDirectory)) {
            if (/^libsfml-(graphics|audio|window|system)[.].*\b(dylib|so)\b/.test(entry)) {
                await copy(path.join(libraryDirectory, entry),
                    path.join(nativeTarget, 'third_party/sfml/lib', entry));
            }
        }
    }
    await copyRuntimePackages(root, appRoot);
    await retainSfmlNotices(appRoot);
    await download(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`,
        path.join(appRoot, 'licenses/Node.js.txt'));
    await fs.writeFile(path.join(appRoot, 'licenses/SOURCES.txt'),
        'Game source: https://github.com/XadillaX/super-mario-kart-sfml.js\n' +
        'SFML 3.1.0: https://github.com/SFML/SFML/tree/3.1.0\n' +
        'sfml.js 1.0.0: https://www.npmjs.com/package/sfml.js/v/1.0.0\n' +
        `Node.js ${process.version}: https://nodejs.org/download/release/${process.version}/\n` +
        'Portions of this software are copyright The FreeType Project (www.freetype.org).\n' +
        'Dependency license notices are retained alongside their installed packages.\n');
}

/** Embed a bootstrap in this exact Node binary, preserving the native addon ABI. */
async function createExecutable(root, staging, executable, relativeAppPath, version) {
    const sea = path.join(staging, 'sea');
    await fs.mkdir(sea, { recursive: true });
    const main = path.join(sea, 'bootstrap.cjs');
    const blob = path.join(sea, 'bootstrap.blob');
    const config = path.join(sea, 'sea-config.json');
    await fs.writeFile(main, bootstrapSource(relativeAppPath));
    await fs.writeFile(config, JSON.stringify({
        main,
        output: blob,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
    }, null, 2) + '\n');
    run(process.execPath, ['--experimental-sea-config', config]);
    await copy(process.execPath, executable);
    await fs.chmod(executable, 0o755);

    if (process.platform === 'darwin') {
        run('codesign', ['--remove-signature', executable]);
    } else if (process.platform === 'win32') {
        const { rcedit } = await import('rcedit');
        await rcedit(executable, {
            icon: path.join(root, 'assets/icon.ico'),
            'file-version': version.split('-')[0],
            'product-version': version,
            'version-string': {
                ProductName: 'Super Mario Kart',
                FileDescription: 'Super Mario Kart — sfml.js',
                CompanyName: 'Super Mario Kart contributors',
            },
        });
        // A GUI subsystem avoids a console window when launching from Explorer.
        const binary = await fs.readFile(executable);
        const pe = binary.readUInt32LE(0x3c);
        if (binary.toString('ascii', pe, pe + 4) !== 'PE\0\0') {
            throw new Error('Expected a Windows PE executable');
        }
        binary.writeUInt16LE(2, pe + 24 + 68);
        await fs.writeFile(executable, binary);
    }
    const { inject } = require('postject');
    await inject(executable, 'NODE_SEA_BLOB', await fs.readFile(blob), {
        sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
        ...(process.platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
    });
    if (process.platform === 'darwin') {
        run('codesign', ['--force', '--sign', '-', executable]);
    }
}

/** Run a packaged executable from an unrelated cwd with disposable preferences. */
async function smoke(executable, extraEnv = {}) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smk smoke '));
    try {
        const result = path.join(directory, 'result.json');
        run(executable, ['--smoke-test'], {
            cwd: directory,
            timeout: 180_000,
            env: {
                ...process.env,
                SMK_CONFIG_DIR: path.join(directory, 'preferences'),
                SMK_SMOKE_RESULT: result,
                ...extraEnv,
            },
        });
        const report = JSON.parse(await fs.readFile(result, 'utf8'));
        if (report.ok !== true) {
            throw new Error(`Packaged smoke failed: ${JSON.stringify(report)}`);
        }
        console.log('Packaged smoke passed:', JSON.stringify(report));
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
}

module.exports = {
    bootstrapSource, copy, createExecutable, download, prepareApp, run, smoke,
    validateTarget,
};
