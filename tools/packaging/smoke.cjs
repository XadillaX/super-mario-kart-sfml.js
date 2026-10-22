const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isSea } = require('node:sea');
const { setImmediate: yieldToEventLoop } = require('node:timers/promises');

/** Validates all course cache pairs and snapshots their bytes and modification times. */
function readCaches(appRoot, courses, cells) {
    assert.equal(courses.length, 5, 'The release must contain all five courses');
    return courses.flatMap(course => ['gradient.txt', 'position.txt'].map(name => {
        const filename = path.join(appRoot, course, name);
        const contents = fs.readFileSync(filename);
        const values = contents.toString('utf8').trim().split(/\s+/).map(Number);
        assert.equal(values.length, cells + (name === 'position.txt' ? 1 : 0), filename);
        assert.ok(values.every(Number.isSafeInteger), `Invalid AI cache: ${filename}`);
        if (name === 'position.txt') {
            assert.ok(values[cells] > 0, `Invalid lap threshold: ${filename}`);
        }
        return { filename, contents, modified: fs.statSync(filename).mtimeMs };
    }));
}

/** Recursively decodes bundled PNGs through SFML and returns the verified image count. */
async function checkImages(sf, directory) {
    let count = 0;
    const image = new sf.Image();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            count += await checkImages(sf, filename);
        } else if (entry.name.endsWith('.png')) {
            assert.ok(await image.loadFromFile(filename), `Cannot decode image: ${filename}`);
            const size = image.getSize();
            assert.ok(size.x > 0 && size.y > 0, `Empty image: ${filename}`);
            count++;
        }
    }
    return count;
}

/** Exercise embedded code and external resources without the build checkout. */
async function run(appRoot, runtime) {
    appRoot = fs.realpathSync(appRoot);
    if (isSea()) {
        const scripts = fs.readdirSync(appRoot, { recursive: true })
            .filter(name => /\.(?:js|cjs|mjs)$/.test(name));
        assert.deepEqual(scripts, [], 'A native package must not contain external JavaScript');
        if (process.platform === 'win32') {
            assert.equal(appRoot, fs.realpathSync(path.dirname(process.execPath)));
            fs.accessSync(path.join(appRoot, 'sfmljs.dll'));
            for (const component of ['graphics', 'audio', 'window', 'system']) {
                fs.accessSync(path.join(appRoot, `sfml-${component}-3.dll`));
            }
        } else if (process.platform === 'darwin') {
            assert.equal(path.basename(appRoot), 'Resources');
            fs.accessSync(path.resolve(appRoot, '../Frameworks/sfmljs.node'));
            assert.equal(fs.existsSync(path.join(appRoot, 'app')), false);
            assert.equal(fs.existsSync(path.join(appRoot, 'native')), false);
        }
    }
    const previousCwd = process.cwd();
    const resultPath = process.env.SMK_SMOKE_RESULT
        ? path.resolve(process.env.SMK_SMOKE_RESULT) : undefined;
    assert.ok(process.env.SMK_CONFIG_DIR, 'Smoke tests require a disposable SMK_CONFIG_DIR');
    if (resultPath) {
        fs.rmSync(resultPath, { force: true });
    }

    const {
        sf, Audio, Game, Settings, Input, Key, CourseMap, AIGradientDescent,
        MAP_TILES_WIDTH, MAP_TILES_HEIGHT, MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT,
        CIRCUIT_ASSET_NAMES,
    } = runtime;
    // Check the pairs before any title/race constructor could regenerate a missing cache.
    const caches = readCaches(appRoot, CIRCUIT_ASSET_NAMES, MAP_TILES_WIDTH * MAP_TILES_HEIGHT);
    const states = new Set();
    let game;
    let report;
    let frames = 0;

    try {
        process.chdir(appRoot);
        game = new Game(256, 224, 60);
        const window = game.getWindow();
        assert.ok(window.isOpen(), 'SFML did not create the game window');
        window.setVisible(false);
        window.setFramerateLimit(0);
        const size = window.getSize();
        const render = new sf.RenderTexture(size);
        const capture = new sf.Texture();
        assert.ok(capture.resize(size), 'Cannot allocate the window readback texture');

        // The diagnostic alone uses emitted TS-private methods to step the real stack.
        // Production Game/state code and its public API remain unchanged.
        const current = () => game.getCurrentState();
        const expectState = name => {
            assert.equal(current()?.string(), name, `Expected game state ${name}`);
            states.add(name);
            return current();
        };
        const draw = async name => {
            const state = expectState(name);
            await state.ready;
            render.clear(sf.Color.Black);
            state.draw(render);
            render.display();
            const pixels = render.getTexture().copyToImage().pixels;
            assert.equal(pixels.length, size.x * size.y * 4, `${name}: missing framebuffer`);
            let varied = false;
            for (let offset = 4; offset < pixels.length; offset += 4) {
                if (pixels[offset] !== pixels[0] || pixels[offset + 1] !== pixels[1] ||
                    pixels[offset + 2] !== pixels[2]) {
                    varied = true;
                    break;
                }
            }
            assert.ok(varied, `${name}: game rendered a uniform frame`);
            window.clear(sf.Color.Black);
            window.draw(new sf.Sprite(render.getTexture()));
            window.display();
            frames++;
        };
        const step = async (seconds = 1 / 60) => {
            const state = current();
            assert.ok(state, 'The game stack ended unexpectedly');
            await state.ready;
            game.handleEvents(state);
            assert.ok(window.isOpen(), 'The game window closed unexpectedly');
            await state.ready;
            const delta = sf.seconds(seconds);
            state.update(delta);
            await state.ready;
            state.fixedUpdate(delta);
            await state.ready;
            game.handleTryPop();
            await current()?.ready;
            await yieldToEventLoop();
        };
        const press = async action => {
            const state = current();
            await state.ready;
            state.handleEvent(new sf.Event({
                kind: 'KeyPressed',
                code: Input.get(action),
                scancode: sf.KeyboardScancode.Unknown,
                alt: false,
                control: false,
                shift: false,
                system: false,
            }));
            await state.ready;
            await step();
        };
        const finishMenuTransition = async seconds => {
            await step(seconds);
            // Menu events are intentionally ignored at the exact transition boundary.
            await step();
        };

        await current().ready;
        window.clear(new sf.Color(17, 41, 67));
        capture.update(window);
        const probe = capture.copyToImage().getPixel(new sf.Vector2u(0, 0));
        assert.deepEqual([probe.r, probe.g, probe.b], [17, 41, 67], 'SFML window readback failed');
        window.display();
        const images = await checkImages(sf, path.join(appRoot, 'assets'));
        assert.ok(images > 0, 'No game images found');
        await draw('InitLoad');

        for (const course of CIRCUIT_ASSET_NAMES) {
            assert.ok(await CourseMap.loadCourse(course), `Cannot load course: ${course}`);
            CourseMap.loadAI();
            await Audio.loadCircuit(course);
            const grid = CourseMap.getPlayerInitialPosition(1);
            const position = new sf.Vector2f(grid.x / MAP_ASSETS_WIDTH, grid.y / MAP_ASSETS_HEIGHT);
            assert.ok(AIGradientDescent.getPositionValue(position) >= 0, `${course}: invalid starting grid`);
            const direction = AIGradientDescent.getNextDirection(position);
            assert.ok(Number.isFinite(direction.x) && Number.isFinite(direction.y), `${course}: invalid AI`);
            assert.ok(direction.x !== 0 || direction.y !== 0, `${course}: AI cannot leave the grid`);
        }

        await step();
        await step(2.01);
        await finishMenuTransition(0.6);
        await draw('Start');
        await press(Key.ACCEPT);
        await finishMenuTransition(0.3);
        await press(Key.ACCEPT);
        await finishMenuTransition(0.6);
        await press(Key.ACCEPT);
        await step(0.6);
        expectState('RaceManager');
        await step();
        await step(1.1);
        await draw('PlayerSelection');
        await press(Key.ACCEPT);
        await press(Key.ACCEPT);
        await step(1.1);
        expectState('RaceManager');
        await step();
        await step();
        await step();
        await draw('RaceStart');
        await press(Key.ACCEPT);
        for (let tick = 0; tick < 900 && current()?.string() === 'RaceStart'; tick++) {
            await step();
        }
        const race = expectState('Race');
        const positions = race.drivers.map(driver => ({ x: driver.position.x, y: driver.position.y }));
        for (let tick = 0; tick < 60; tick++) {
            await step();
        }
        assert.ok(race.drivers.some((driver, index) =>
            Math.hypot(driver.position.x - positions[index].x, driver.position.y - positions[index].y) > 0.0001),
        'The race simulation did not move any drivers');
        assert.ok(race.drivers.every(driver =>
            Number.isFinite(driver.position.x) && Number.isFinite(driver.position.y)),
        'The race simulation produced invalid positions');
        await draw('Race');
        await press(Key.PAUSE);
        await draw('RacePause');
        await press(Key.ACCEPT);
        assert.equal(expectState('Race'), race, 'Resume replaced the active race');
        await step();
        await press(Key.PAUSE);
        expectState('RacePause');
        await press(Key.MENU_UP);
        await press(Key.ACCEPT);
        await step(1.6);
        expectState('InitLoad');
        await step();
        await finishMenuTransition(0.6);
        await draw('Start');
        await press(Key.CANCEL);
        await press(Key.MENU_LEFT);
        await press(Key.ACCEPT);
        assert.equal(game.stateStack.length, 0, 'Title exit did not empty the game stack');
        await game.run();
        assert.equal(window.isOpen(), false, 'Game shutdown did not close its window');
        assert.ok(fs.existsSync(Settings.getFilePath()), 'Game shutdown did not save settings');

        report = {
            ok: true,
            platform: process.platform,
            arch: process.arch,
            window: { width: size.x, height: size.y },
            images,
            cachedMaps: [...CIRCUIT_ASSET_NAMES],
            states: [...states],
            frames,
            settingsPath: Settings.getFilePath(),
        };
    } finally {
        try {
            if (game) {
                // An assertion can fail just after a state starts asynchronous loading.
                await Promise.allSettled(game.stateStack.map(state => state.ready));
                game.getWindow().close();
                game.stateStack.length = 0;
            }
        } finally {
            try {
                await Audio.close();
            } finally {
                process.chdir(previousCwd);
            }
        }
    }

    for (const cache of caches) {
        assert.deepEqual(fs.readFileSync(cache.filename), cache.contents, `AI cache changed: ${cache.filename}`);
        assert.equal(fs.statSync(cache.filename).mtimeMs, cache.modified, `AI cache rewritten: ${cache.filename}`);
    }
    if (resultPath) {
        fs.writeFileSync(resultPath, `${JSON.stringify(report, null, 2)}\n`);
    }
}

module.exports = { run };
