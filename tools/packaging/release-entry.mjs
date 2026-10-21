import * as sf from 'sfml.js';
import { main } from '../../src/main.ts';
import { Audio } from '../../src/audio/audio.ts';
import { Game } from '../../src/game.ts';
import { Settings } from '../../src/settings.ts';
import { Input, Key } from '../../src/input/input.ts';
import { Map as CourseMap } from '../../src/map/map.ts';
import { AIGradientDescent } from '../../src/ai/gradientdescent.ts';
import {
    MAP_TILES_WIDTH, MAP_TILES_HEIGHT, MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT,
} from '../../src/map/enums.ts';
import { CIRCUIT_ASSET_NAMES } from '../../src/states/racemanager.ts';
import diagnostics from './smoke.cjs';

export { main };

/** Exercise the exact bundled classes, including their shared static state. */
export async function smokeTest(appRoot) {
    await diagnostics.run(appRoot, {
        sf, Audio, Game, Settings, Input, Key, CourseMap, AIGradientDescent,
        MAP_TILES_WIDTH, MAP_TILES_HEIGHT, MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT,
        CIRCUIT_ASSET_NAMES,
    });
}
