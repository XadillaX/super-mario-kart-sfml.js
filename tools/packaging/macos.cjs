'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/** Convert the upstream game icon into all sizes required by a macOS app. */
async function createIcon(root, staging, destination, run) {
    const sharp = require('sharp');
    const { extractPngIcon } = require('./linux.cjs');
    const png = extractPngIcon(await fs.readFile(path.join(root, 'assets/icon.ico')));
    const iconset = path.join(staging, 'GameIcon.iconset');
    await fs.mkdir(iconset, { recursive: true });
    for (const size of [16, 32, 128, 256, 512]) {
        for (const scale of [1, 2]) {
            const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
            await sharp(png).resize(size * scale, size * scale, {
                kernel: 'nearest',
            }).toFile(path.join(iconset, name));
        }
    }
    run('iconutil', ['--convert', 'icns', '--output', destination, iconset]);
}

/** Draw a static Finder backdrop; the two draggable icons belong to Finder. */
async function createBackground(staging) {
    const sharp = require('sharp');
    const background = path.join(staging, 'dmg-background.png');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420">
<rect width="640" height="420" fill="#edf3e6"/>
<path d="M0 0H640V104H0Z" fill="#153d2b"/>
<text x="36" y="50" font-family="Helvetica, Arial, sans-serif" font-size="28"
 font-weight="700" fill="#ffffff">SUPER MARIO KART</text>
<text x="37" y="78" font-family="Helvetica, Arial, sans-serif" font-size="14"
 fill="#c2dcb6">TypeScript · sfml.js</text>
<path d="M282 214H354M338 198L354 214L338 230" fill="none"
 stroke="#52704b" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
<text x="320" y="330" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
 font-size="17" fill="#26432c">Drag the game into Applications to install.</text>
<text x="320" y="357" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
 font-size="13" fill="#60715b">Then eject this disk and start your engines.</text>
<path d="M0 401H640V420H0Z" fill="#153d2b"/>
</svg>`;
    for (const scale of [1, 2]) {
        const destination = scale === 1 ? background : background.replace('.png', '@2x.png');
        await sharp(Buffer.from(svg), { density: 72 * scale }).png().toFile(destination);
    }
    return background;
}

/** Sign native files inside-out using ad-hoc signatures, without Apple credentials. */
async function signBundle(app, run) {
    async function visit(directory) {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(file);
            } else if (entry.isFile() && /\.(node|dylib)$/.test(entry.name)) {
                run('codesign', ['--force', '--sign', '-', '--timestamp=none', file]);
            }
        }
    }
    await visit(app);
    run('codesign', ['--force', '--sign', '-', '--timestamp=none', app]);
    run('codesign', ['--verify', '--deep', '--strict', app]);
}

/** Build a relocatable .app, a Finder-configured drag-install DMG and a ZIP. */
async function packagePlatform(context) {
    if (process.platform !== 'darwin') {
        throw new Error('macOS packaging requires a macOS host');
    }
    const { root, staging, output, version, arch, prepareApp, createExecutable, smoke, run } = context;
    const app = path.join(staging, 'Super Mario Kart.app');
    const contents = path.join(app, 'Contents');
    const resources = path.join(contents, 'Resources');
    await fs.mkdir(resources, { recursive: true });
    await prepareApp(path.join(resources, 'app'));
    await createExecutable(path.join(contents, 'MacOS/SuperMarioKart'), '../Resources/app');
    const icon = path.join(resources, 'GameIcon.icns');
    await createIcon(root, staging, icon, run);

    await fs.writeFile(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
    <key>CFBundleName</key><string>Super Mario Kart</string>
    <key>CFBundleDisplayName</key><string>Super Mario Kart</string>
    <key>CFBundleIdentifier</key><string>org.xadillax.super-mario-kart</string>
    <key>CFBundleExecutable</key><string>SuperMarioKart</string>
    <key>CFBundleIconFile</key><string>GameIcon</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>${version.split('-')[0]}</string>
    <key>CFBundleVersion</key><string>${version.split('-')[0]}</string>
    <key>LSMinimumSystemVersion</key><string>13.0</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>LSApplicationCategoryType</key><string>public.app-category.racing-games</string>
</dict></plist>
`);
    await fs.writeFile(path.join(contents, 'PkgInfo'), 'APPL????');
    await signBundle(app, run);

    const basename = `super-mario-kart-${version}-macos-${arch}`;
    const zip = path.join(output, `${basename}.zip`);
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
    const relocated = path.join(staging, 'relocated installation');
    run('ditto', ['-x', '-k', zip, relocated]);
    await smoke(path.join(relocated, 'Super Mario Kart.app/Contents/MacOS/SuperMarioKart'));
    await fs.rm(relocated, { recursive: true, force: true });

    const dmg = path.join(output, `${basename}.dmg`);
    const background = await createBackground(staging);
    const appdmg = require('appdmg');
    await new Promise((resolve, reject) => {
        const job = appdmg({
            target: dmg,
            basepath: staging,
            specification: {
                title: 'Super Mario Kart',
                icon,
                background,
                'icon-size': 96,
                format: 'ULFO',
                filesystem: 'HFS+',
                window: {
                    position: { x: 200, y: 120 },
                    size: { width: 640, height: 420 },
                },
                contents: [
                    { x: 164, y: 214, type: 'file', path: app },
                    { x: 476, y: 214, type: 'link', path: '/Applications' },
                ],
            },
        });
        job.on('error', reject);
        job.on('finish', resolve);
    });

    // A read-only mount catches accidental writes into installed game resources.
    const mount = path.join(staging, 'mounted dmg');
    await fs.mkdir(mount, { recursive: true });
    run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg]);
    try {
        await fs.access(path.join(mount, '.DS_Store'));
        if (await fs.readlink(path.join(mount, 'Applications')) !== '/Applications') {
            throw new Error('DMG is missing the Applications drag-install link');
        }
        await smoke(path.join(mount, 'Super Mario Kart.app/Contents/MacOS/SuperMarioKart'));
    } finally {
        run('hdiutil', ['detach', mount]);
    }
    return [dmg, zip];
}

module.exports = { createBackground, packagePlatform };
