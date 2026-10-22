'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { retainSfmlNotices } = require('./licenses.cjs');
const { createGameCodeCache, GAME_PARAMETERS, GAME_FILENAME } = require('./code-cache.cjs');

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

/** Execute embedded JavaScript in memory with relocatable native and asset paths. */
function bootstrapSource(relativeAppPath) {
    return `'use strict';
const path = require('node:path');
const { createRequire } = require('node:module');
const { getAsset, getRawAsset } = require('node:sea');
const { compileFunction } = require('node:vm');
const { performance } = require('node:perf_hooks');
const appRoot = path.resolve(path.dirname(process.execPath), ${JSON.stringify(relativeAppPath)});
// This filename is virtual: __dirname-based game and native paths remain stable.
const filename = path.join(appRoot, 'dist/main.js');
const appRequire = createRequire(filename);
if (process.platform === 'win32') {
    process.env.PATH = path.dirname(process.execPath) + path.delimiter + (process.env.PATH || '');
}
process.chdir(appRoot);
(async () => {
    const gameModule = { exports: {} };
    const source = getAsset('game.js', 'utf8');
    const cachedData = Buffer.from(getRawAsset('game.cachedData'));
    const started = performance.now();
    const load = compileFunction(source, ${JSON.stringify(GAME_PARAMETERS)}, {
        filename: ${JSON.stringify(GAME_FILENAME)},
        cachedData,
    });
    if (process.argv.includes('--smoke-test')) {
        if (load.cachedDataRejected !== false) {
            throw new Error('V8 rejected the embedded game code cache');
        }
        console.log('Game code cache:', JSON.stringify({
            accepted: true,
            bytes: cachedData.length,
            compileMs: performance.now() - started,
        }));
    }
    // V8 recompiles from source if cachedData is rejected during normal startup.
    load(gameModule.exports, appRequire, gameModule, filename, path.dirname(filename));
    const game = gameModule.exports;
    if (process.argv.includes('--smoke-test')) {
        await game.smokeTest(appRoot);
    } else {
        await game.main();
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

/** Fetch a required upstream notice; packaging must not silently omit licenses. */
async function download(url, destination) {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
        throw new Error(`Download failed (${response.status}): ${url}`);
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

/** Assemble external resources and native libraries; JavaScript lives in the SEA. */
async function prepareApp(root, appRoot) {
    const distFiles = await fs.readdir(path.join(root, 'dist'));
    if (distFiles.length !== 1 || distFiles[0] !== 'main.js') {
        throw new Error('Run npm run build:release before packaging: dist must contain only main.js');
    }
    for (const name of ['assets', 'LICENSE', 'README.md']) {
        await copy(path.join(root, name), path.join(appRoot, name), {
            filter: file => !file.endsWith('.map'),
        });
    }
    await fs.writeFile(path.join(appRoot, 'package.json'), JSON.stringify({
        name: 'super-mario-kart-sfml.js',
        version: require(path.join(root, 'package.json')).version,
        type: 'commonjs',
        license: 'GPL-3.0-only',
    }, null, 2) + '\n');
    const nativeSource = path.join(root, 'node_modules/sfml.js');
    const nativeTarget = path.join(appRoot, 'native');
    await copy(path.join(nativeSource, 'LICENSE'), path.join(appRoot, 'licenses/sfml.js.txt'));
    // SFML's numeric operators also import IpAddress and its bundled JS parser.
    await copy(path.join(root, 'node_modules/ipaddr.js/LICENSE'),
        path.join(appRoot, 'licenses/ipaddr.js.txt'));
    await copy(path.join(nativeSource, 'third_party/sfml/license.md'),
        path.join(appRoot, 'licenses/SFML.txt'));
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
    await retainSfmlNotices(appRoot);
    await download(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`,
        path.join(appRoot, 'licenses/Node.js.txt'));
    await fs.writeFile(path.join(appRoot, 'licenses/SOURCES.txt'),
        'Game source: https://github.com/XadillaX/super-mario-kart-sfml.js\n' +
        'SFML 3.1.0: https://github.com/SFML/SFML/tree/3.1.0\n' +
        'sfml.js 1.0.0: https://www.npmjs.com/package/sfml.js/v/1.0.0\n' +
        `Node.js ${process.version}: https://nodejs.org/download/release/${process.version}/\n` +
        'Portions of this software are copyright The FreeType Project (www.freetype.org).\n' +
        'Dependency license notices are retained in the licenses directory.\n');
}

/** Embed the bootstrap and complete JS bundle in the exact Node binary used to build. */
async function createExecutable(root, staging, executable, relativeAppPath, version) {
    const sea = path.join(staging, 'sea');
    await fs.mkdir(sea, { recursive: true });
    const main = path.join(sea, 'bootstrap.cjs');
    const blob = path.join(sea, 'bootstrap.blob');
    const config = path.join(sea, 'sea-config.json');
    const gameSource = path.join(root, 'dist/main.js');
    const cacheFile = path.join(sea, 'game.cachedData');
    const cachedData = createGameCodeCache(await fs.readFile(gameSource, 'utf8'));
    await fs.writeFile(cacheFile, cachedData);
    console.log(`Embedded game code cache: ${cachedData.length} bytes`);
    await fs.writeFile(main, bootstrapSource(relativeAppPath));
    await fs.writeFile(config, JSON.stringify({
        main,
        output: blob,
        assets: {
            'game.js': gameSource,
            'game.cachedData': cacheFile,
        },
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
