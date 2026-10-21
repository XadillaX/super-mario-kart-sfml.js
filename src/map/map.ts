import * as sf from "sfml.js";
import { access, readFile } from "node:fs/promises";
import { AIGradientDescent } from "../ai/gradientdescent";
import { Audio, SFX } from "../audio/audio";
import { CollisionHashMap } from "../entities/collisionhashmap";
import type { Driver } from "../entities/driver";
import type { Item } from "../entities/item";
import type { WallObject } from "../entities/wallobject";
import { WallObjectType } from "../entities/enums";
import type { Game } from "../game";
import {
    FloorObjectOrientation, FloorObjectState, FloorObjectType, LandMaterial,
    MAP_ASSETS_HEIGHT, MAP_ASSETS_WIDTH, MAP_EDGES_SIZE,
    MAP_TILE_SIZE, MAP_TILES_HEIGHT, MAP_TILES_WIDTH, MapLand,
    type MapLandMatrix,
} from "./enums";
import { FloorObject } from "./floorobject";

/** Perspective projection result replacing the C++ scalar output parameters. */
export interface MapProjection {
    /** Whether the projected coordinates lie within the original visibility bounds. */
    visible: boolean;
    /** Normalized screen position within the circuit rectangle. */
    screenCoords: sf.Vector2f;
    /** Signed forward distance from the camera. */
    z: number;
}

/** Depth-sorted sprite reference, matching the original drawable pair. */
export type MapDrawable = [number, sf.Sprite];

/** Course resources, terrain interactions, and the original CPU Mode 7 renderer. */
export class Map {
    private static singleton: Map | undefined;

    private static get instance(): Map {
        return Map.singleton ??= new Map();
    }

    private static readonly MODE7_FOV_HALF = 0.5;
    private static readonly MODE7_CLIP_NEAR = 0.0005;
    private static readonly MODE7_CLIP_FAR = 0.045;

    // The lower-screen map uses a fixed camera and a trapezoidal screen footprint.
    private static readonly MINIMAP_POS_DISTANCE = 6.5;
    private static readonly MINIMAP_FOV_HALF = Math.PI / 32;
    private static readonly MINIMAP_BOTTOM_X = 20 / 512;
    private static readonly MINIMAP_BOTTOM_Y = 438 / 448;
    private static readonly MINIMAP_TOP_X = 57 / 512;
    private static readonly MINIMAP_TOP_Y = 252 / 448;

    /** Sky asset scale relative to the window. */
    static readonly SKY_SCALE = 2;
    /** Fraction of a sky strip kept after cutting its top. */
    static readonly SKY_CUT_PCT = 20 / 32;
    /** Fraction of window height occupied by the sky. */
    static readonly SKY_HEIGHT_PCT = 2 / 22.4;
    /** Fraction of window height occupied by the perspective circuit. */
    static readonly CIRCUIT_HEIGHT_PCT = 9.2 / 22.4;
    /** Fraction of window height occupied by the minimap. */
    static readonly MINIMAP_HEIGHT_PCT = 11.2 / 22.4;
    /** Camera offset behind the driver, in map pixels. */
    static readonly CAM_2_PLAYER_DST = 46;

    private course = "";
    private gameWindow: sf.RenderWindow | undefined;

    // Keep the base image intact so consumed floor objects can reveal the road again.
    private readonly assetCourse = new sf.Image();
    private readonly assetSkyBack = new sf.Image();
    private readonly assetSkyFront = new sf.Image();
    private readonly assetEdges = new sf.Image();
    private readonly assetObjects = new sf.Image();
    private assetMinimap = new sf.Image();

    private floorObjects: FloorObject[] = [];
    /** Coins and item panels require point collisions in addition to terrain sampling. */
    private specialFloorObjects: FloorObject[] = [];
    private wallObjects: WallObject[] = [];
    private itemObjects: Item[] = [];

    /** Physical terrain in tiles; visual sampling reads assetObjects in pixels. */
    private readonly landTiles: MapLandMatrix = Array.from(
        { length: MAP_TILES_HEIGHT }, () => Array<MapLand>(MAP_TILES_WIDTH).fill(MapLand.TRACK),
    );
    private materialNormal = LandMaterial.DIRT;
    private materialSlow = LandMaterial.DIRT;
    private materialOuter = LandMaterial.DIRT;

    // The wider rectangle detects crossings; the centered one anchors starting positions.
    private stretchedGoal = new sf.FloatRect();
    private centeredGoal = new sf.FloatRect();
    private aiFarVision = 0;

    private constructor() {}

    private getWindowSize(): sf.Vector2u {
        if (!this.gameWindow) {
            throw new Error("Map.setGameWindow must be called before rendering or loading a course");
        }
        return this.gameWindow.getSize();
    }

    private static sampleAsset(asset: sf.Image, sample: sf.Vector2f): sf.Color {
        const size = asset.getSize();
        const px = Math.min(size.x - 1, Math.trunc(sample.x * size.x) >>> 0);
        const py = Math.min(size.y - 1, Math.trunc(sample.y * size.y) >>> 0);
        const index = (py * size.x + px) * 4;
        const pixels = asset.pixels;
        return new sf.Color(pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]);
    }

    private sampleMap(sample: sf.Vector2f): sf.Color {
        return Map.sampleAsset(this.assetObjects, sample);
    }

    /** Samples the original, unmodified course image at normalized coordinates. */
    static sampleMapColor(sample: sf.Vector2f): sf.Color {
        return Map.sampleAsset(Map.instance.assetCourse, sample);
    }

    private mode7(
        position: sf.Vector2f,
        angle: number,
        fovHalf: number,
        clipNear: number,
        clipFar: number,
        size: sf.Vector2u,
        perspective: boolean,
    ): sf.Image {
        // Float32 rounding preserves the C++ vector/interpolation sampling boundaries.
        // All pixel access uses native-backed arrays; there are no per-pixel native calls.
        const f = Math.fround;
        const fovMin = f(f(angle) - f(fovHalf));
        const fovMax = f(f(angle) + f(fovHalf));
        const cosMin = f(Math.cos(fovMin));
        const sinMin = f(Math.sin(fovMin));
        const cosMax = f(Math.cos(fovMax));
        const sinMax = f(Math.sin(fovMax));

        // The four ray endpoints define a horizontal slice of the ground at each depth.
        const nearX1 = f(position.x + f(cosMin * f(clipNear)));
        const nearY1 = f(position.y + f(sinMin * f(clipNear)));
        const nearX2 = f(position.x + f(cosMax * f(clipNear)));
        const nearY2 = f(position.y + f(sinMax * f(clipNear)));
        const farX1 = f(position.x + f(cosMin * f(clipFar)));
        const farY1 = f(position.y + f(sinMin * f(clipFar)));
        const farX2 = f(position.x + f(cosMax * f(clipFar)));
        const farY2 = f(position.y + f(sinMax * f(clipFar)));

        const width = size.x;
        const height = size.y;
        const image = new sf.Image(size);
        const output = image.pixels;
        const coursePixels = this.assetObjects.pixels;
        const edgePixels = this.assetEdges.pixels;
        const courseSize = this.assetObjects.getSize();
        const edgeSize = this.assetEdges.getSize();
        const edgeWidth = MAP_EDGES_SIZE / MAP_ASSETS_WIDTH;
        const edgeHeight = MAP_EDGES_SIZE / MAP_ASSETS_HEIGHT;

        // Skip the horizon at y=0: reciprocal depth would divide by zero there.
        // Its untouched row stays opaque black, matching the original renderer.
        for (let y = 1; y < height; y++) {
            const depth = f(y / height);
            // The race view uses reciprocal depth; the minimap interpolates linearly.
            const interpolate = (near: number, far: number): number => perspective
                ? f(near + f(f(far - near) / depth))
                : f(near + f(f(far - near) * f(1 - depth)));
            const startX = interpolate(nearX1, farX1);
            const startY = interpolate(nearY1, farY1);
            const endX = interpolate(nearX2, farX2);
            const endY = interpolate(nearY2, farY2);
            const deltaX = f(endX - startX);
            const deltaY = f(endY - startY);

            for (let x = 0; x < width; x++) {
                const sampleWidth = f(x / width);
                let sampleX = f(startX + f(deltaX * sampleWidth));
                let sampleY = f(startY + f(deltaY * sampleWidth));

                let pixels: Uint8Array;
                let assetWidth: number;
                let assetHeight: number;
                if (sampleX >= 0 && sampleX <= 1 && sampleY >= 0 && sampleY <= 1) {
                    pixels = coursePixels;
                    assetWidth = courseSize.x;
                    assetHeight = courseSize.y;
                } else {
                    // Repeat the edge tile beyond the course, including negative coordinates.
                    sampleX = f(sampleX % edgeWidth);
                    sampleY = f(sampleY % edgeHeight);
                    if (sampleX < 0) sampleX = f(sampleX + edgeWidth);
                    if (sampleY < 0) sampleY = f(sampleY + edgeHeight);
                    sampleX = f(sampleX * (MAP_ASSETS_WIDTH / MAP_EDGES_SIZE));
                    sampleY = f(sampleY * (MAP_ASSETS_HEIGHT / MAP_EDGES_SIZE));
                    pixels = edgePixels;
                    assetWidth = edgeSize.x;
                    assetHeight = edgeSize.y;
                }

                // Normalized 1 maps to the last pixel, never a pixel past the image.
                const px = Math.min(assetWidth - 1, Math.trunc(f(sampleX * assetWidth)));
                const py = Math.min(assetHeight - 1, Math.trunc(f(sampleY * assetHeight)));
                const source = (py * assetWidth + px) * 4;
                const target = (y * width + x) * 4;
                output[target] = pixels[source];
                output[target + 1] = pixels[source + 1];
                output[target + 2] = pixels[source + 2];
                output[target + 3] = pixels[source + 3];
            }
        }

        return image;
    }

    /** Binds the existing game window used for course and sky dimensions. */
    static setGameWindow(game: Game): void {
        Map.instance.gameWindow = game.getWindow();
    }

    /** Reads normalized terrain; AI lookahead beyond the course is outer ground. */
    static getLand(position: sf.Vector2f): MapLand {
        // Forward probes can leave the grid while the kart itself remains inside.
        // The C++ array access was undefined there; retain all valid tile samples.
        if (position.x < 0 || position.x >= 1 || position.y < 0 || position.y >= 1) {
            return MapLand.OUTER;
        }
        return Map.instance.landTiles[
            Math.trunc(position.y * MAP_TILES_HEIGHT)
        ][Math.trunc(position.x * MAP_TILES_WIDTH)];
    }

    /** Chooses the material for the terrain underneath a map point. */
    static getMaterial(position: sf.Vector2f): LandMaterial {
        switch (Map.getLand(position)) {
            case MapLand.SLOW:
            case MapLand.BLOCK:
                return Map.instance.materialSlow;
            case MapLand.OUTER:
                return Map.instance.materialOuter;
            default:
                return Map.instance.materialNormal;
        }
    }

    /** Writes terrain for a normalized origin and a size expressed in pixels. */
    static setLand(position: sf.Vector2f, size: sf.Vector2f, land: MapLand): void {
        for (let y = 0; y < size.y / MAP_TILE_SIZE; y++) {
            for (let x = 0; x < size.x / MAP_TILE_SIZE; x++) {
                Map.instance.landTiles[
                    Math.trunc(position.y * MAP_TILES_HEIGHT + y)
                ][Math.trunc(position.x * MAP_TILES_WIDTH + x)] = land;
            }
        }
    }

    /** Tests the stretched finish-line rectangle. */
    static inGoal(position: sf.Vector2f): boolean {
        return Map.instance.stretchedGoal.contains(position);
    }

    /** Awaits course assets, creates every object, and resets collision registration. */
    static async loadCourse(course: string): Promise<boolean> {
        const instance = Map.instance;
        instance.course = course;
        const files = ["base.png", "sky_back.png", "sky_front.png", "edge.png", "objects.txt", "base.txt"];
        try {
            await Promise.all(files.map(file => access(`${course}/${file}`)));
        } catch {
            console.error(`ERROR: Can't find files for '${course}'`);
            return false;
        }

        const loaded = await Promise.all([
            instance.assetCourse.loadFromFile(`${course}/base.png`),
            instance.assetObjects.loadFromFile(`${course}/base.png`),
            instance.assetSkyBack.loadFromFile(`${course}/sky_back.png`),
            instance.assetSkyFront.loadFromFile(`${course}/sky_front.png`),
            instance.assetEdges.loadFromFile(`${course}/edge.png`),
        ]);
        if (loaded.some(success => !success)) {
            return false;
        }

        // Terrain cells are character codes; objects.txt is an ordered numeric stream.
        const [grid, objectFile] = await Promise.all([
            readFile(`${course}/base.txt`, "utf8"),
            readFile(`${course}/objects.txt`, "utf8"),
        ]);
        const cells = grid.replace(/\s/g, "");
        for (let y = 0; y < MAP_TILES_HEIGHT; y++) {
            for (let x = 0; x < MAP_TILES_WIDTH; x++) {
                instance.landTiles[y][x] = cells.charCodeAt(y * MAP_TILES_WIDTH + x) - 48;
            }
        }

        const values = objectFile.trim().split(/\s+/).map(Number);
        let cursor = 0;
        const next = (): number => values[cursor++];

        // Header: three materials, two finish rectangles, then AI lookahead.
        instance.materialNormal = next();
        instance.materialSlow = next();
        instance.materialOuter = next();
        const readGoal = (): sf.FloatRect => new sf.FloatRect(
            new sf.Vector2f(next() / MAP_ASSETS_WIDTH, next() / MAP_ASSETS_HEIGHT),
            new sf.Vector2f(next() / MAP_ASSETS_WIDTH, next() / MAP_ASSETS_HEIGHT),
        );
        instance.stretchedGoal = readGoal();
        instance.centeredGoal = readGoal();
        instance.aiFarVision = next();

        // Resolve subclasses only after module initialization; entities also import Map.
        const { Zipper } = await import("./zipper.js");
        const { QuestionPanel } = await import("./questionpanel.js");
        const { OilSlick } = await import("./oilslick.js");
        const { Coin } = await import("./coin.js");
        const { RampHorizontal } = await import("./ramphorizontal.js");
        const { RampVertical } = await import("./rampvertical.js");
        const { Pipe } = await import("../entities/pipe.js");
        const { Thwomp } = await import("../entities/thwomp.js");

        // Each floor record has type, pixel position, orientation, and pixel size.
        FloorObject.resetChanges();
        instance.floorObjects = [];
        instance.specialFloorObjects = [];
        const floorCount = next();
        for (let i = 0; i < floorCount; i++) {
            const type: FloorObjectType = next();
            const position = new sf.Vector2f(next(), next());
            const orientation: FloorObjectOrientation = next();
            const size = new sf.Vector2f(next(), next());
            let object: FloorObject;
            switch (type) {
                case FloorObjectType.ZIPPER:
                    object = new Zipper(position, orientation);
                    break;
                case FloorObjectType.QUESTION_PANEL:
                    object = new QuestionPanel(position, orientation);
                    instance.specialFloorObjects.push(object);
                    break;
                case FloorObjectType.OIL_SLICK:
                    object = new OilSlick(position, orientation);
                    break;
                case FloorObjectType.COIN:
                    object = new Coin(position, orientation);
                    instance.specialFloorObjects.push(object);
                    break;
                case FloorObjectType.RAMP_HORIZONTAL:
                    object = new RampHorizontal(position, orientation, size);
                    break;
                case FloorObjectType.RAMP_VERTICAL:
                    object = new RampVertical(position, orientation, size);
                    break;
                default:
                    console.error(`ERROR: Invalid floor object type (${type})`);
                    return false;
            }
            instance.floorObjects.push(object);
        }

        // Apply both image and terrain changes before deriving the minimap.
        for (const object of instance.floorObjects) {
            object.setState(FloorObjectState.INITIAL);
        }
        FloorObject.applyAllChanges();
        Map.updateMinimap();

        // Disposal stops lifetime-bound effects such as a red shell's warning sound.
        for (const item of instance.itemObjects) {
            item.dispose();
        }
        instance.itemObjects = [];
        instance.wallObjects = [];

        // Wall records contain just a type and pixel position.
        const wallCount = next();
        for (let i = 0; i < wallCount; i++) {
            const type: WallObjectType = next();
            const position = new sf.Vector2f(next(), next());
            let object: WallObject;
            switch (type) {
                case WallObjectType.NORMAL_THWOMP:
                    object = new Thwomp(position, false);
                    break;
                case WallObjectType.SUPER_THWOMP:
                    object = new Thwomp(position, true);
                    break;
                case WallObjectType.GREEN_PIPE:
                    object = new Pipe(position, true);
                    break;
                case WallObjectType.ORANGE_PIPE:
                    object = new Pipe(position, false);
                    break;
                default:
                    console.error(`ERROR: Invalid wall object type (${type})`);
                    return false;
            }
            instance.wallObjects.push(object);
        }

        // Collision buckets must no longer retain objects from the previous course.
        CollisionHashMap.resetStatic();
        CollisionHashMap.resetDynamic();
        Map.registerWallObjects();
        return true;
    }

    /** Returns the folder of the selected course. */
    static getCourse(): string {
        return Map.instance.course;
    }

    /** Loads or computes the selected course's gradient and position matrices. */
    static loadAI(): void {
        AIGradientDescent.updateGradient(Map.instance.landTiles, Map.instance.stretchedGoal);
    }

    /** Returns the course-specific gradient lookahead distance. */
    static getCurrentMapAIFarVision(): number {
        return Map.instance.aiFarVision;
    }

    /** Registers a thrown item or visual effect for updates and drawing. */
    static addItem(item: Item): void {
        Map.instance.itemObjects.push(item);
    }

    /** Creates water/lava splashes and the original player fall sound. */
    static addEffectDrown(position: sf.Vector2f, isPlayer = false): void {
        const { EffectDrown } = require("../entities/effectdrown") as typeof import("../entities/effectdrown");
        if (Map.instance.materialOuter === LandMaterial.WATER) {
            if (isPlayer) Audio.play(SFX.CIRCUIT_PLAYER_FALL_WATER);
            Map.addItem(new EffectDrown(position, new sf.Color(sf.Color.White)));
        } else if (Map.instance.materialOuter === LandMaterial.LAVA) {
            if (isPlayer) Audio.play(SFX.CIRCUIT_PLAYER_FALL_LAVA);
            Map.addItem(new EffectDrown(position, new sf.Color(sf.Color.Red)));
        } else if (isPlayer) {
            Audio.play(SFX.CIRCUIT_PLAYER_FALL);
        }
    }

    /** Adds the broken-item ballistic effect. */
    static addEffectBreak(item: Item): void {
        const { EffectBreak } = require("../entities/effectbreak") as typeof import("../entities/effectbreak");
        Map.addItem(new EffectBreak(item));
    }

    /** Adds the original sparkle animation at normalized map coordinates. */
    static addEffectSparkles(position: sf.Vector2f): void {
        const { EffectSparkles } = require("../entities/effectsparkles") as typeof import("../entities/effectsparkles");
        Map.addItem(new EffectSparkles(position));
    }

    /** Adds staggered gained/lost-coin effects, preserving sf.Time delays. */
    static addEffectCoin(driver: Driver, number = 1, positive = true): void {
        const { EffectCoin } = require("../entities/effectcoin") as typeof import("../entities/effectcoin");
        let delay = sf.seconds(0);
        for (let i = 0; i < number; i++) {
            Map.addItem(new EffectCoin(driver, delay, positive));
            delay = sf.add(delay, sf.seconds(positive ? 0.3 : 0.1));
        }
    }

    /** Interacts with every colliding coin or question panel. */
    static collideWithSpecialFloorObject(driver: Driver): void {
        for (const object of Map.instance.specialFloorObjects) {
            if (object.collidesWith(driver)) {
                object.interactWith(driver);
            }
        }
    }

    /** Registers fixed collision objects for the selected course. */
    static registerWallObjects(): void {
        for (const object of Map.instance.wallObjects) {
            CollisionHashMap.registerStatic(object);
        }
    }

    /** Registers dynamic items with the collision hash. */
    static registerItemObjects(): void {
        for (const object of Map.instance.itemObjects) {
            CollisionHashMap.registerDynamic(object);
        }
    }

    /** Reactivates question panels without reactivating collected coins. */
    static reactivateQuestionPanels(): void {
        const { QuestionPanel } = require("./questionpanel") as typeof import("./questionpanel");
        for (const object of Map.instance.specialFloorObjects) {
            if (object instanceof QuestionPanel) {
                object.setState(FloorObjectState.ACTIVE);
            }
        }
    }

    /** Advances wall/item objects and removes expired items after their updates. */
    static updateObjects(deltaTime: sf.Time): void {
        for (const object of Map.instance.wallObjects) {
            object.update(deltaTime);
        }
        for (const item of Map.instance.itemObjects) {
            if (item) {
                item.update(deltaTime);
            }
        }

        // Defer removal until updates finish: an expiring item may spawn another effect.
        Map.instance.itemObjects = Map.instance.itemObjects.filter(item => {
            if (!item) {
                return false;
            }

            if (item.used) {
                item.dispose();
                return false;
            }
            return true;
        });
    }

    /** Rebuilds the non-perspective lower-screen course image. */
    static updateMinimap(): void {
        const instance = Map.instance;
        const windowSize = instance.getWindowSize();
        const f = Math.fround;
        const min = f(Map.MINIMAP_POS_DISTANCE - 1 - f(0.05));
        const max = f(Map.MINIMAP_POS_DISTANCE + f(0.15));
        const cosFov = f(Math.cos(f(Map.MINIMAP_FOV_HALF)));
        instance.assetMinimap = instance.mode7(
            new sf.Vector2f(0.5, Map.MINIMAP_POS_DISTANCE),
            3 * Math.PI / 2, Map.MINIMAP_FOV_HALF,
            f(min / cosFov), f(max / cosFov),
            new sf.Vector2u(windowSize.x, windowSize.y * Map.MINIMAP_HEIGHT_PCT),
            false,
        );
    }

    /** Restores the base region before alpha-compositing a floor object's image. */
    static updateAssetCourse(newAsset: sf.Image, topLeftPixels: sf.Vector2f): void {
        const size = newAsset.getSize();
        const destination = new sf.Vector2u(topLeftPixels);
        Map.instance.assetObjects.copy(
            Map.instance.assetCourse, destination,
            new sf.IntRect(new sf.Vector2i(topLeftPixels), new sf.Vector2i(size)), false,
        );
        // Composite onto the restored road, not the previous object's pixels.
        Map.instance.assetObjects.copy(
            newAsset, destination,
            new sf.IntRect(new sf.Vector2i(0, 0), new sf.Vector2i(size)), true,
        );
    }

    /** Uploads two cropped, horizontally tiled sky layers with original parallax. */
    static skyTextures(player: Driver, skyBack: sf.Texture, skyFront: sf.Texture): void {
        const instance = Map.instance;
        const windowSize = instance.getWindowSize();
        let textureWidth = windowSize.x / Map.SKY_SCALE;
        let textureHeight = windowSize.y * Map.SKY_HEIGHT_PCT / Map.SKY_SCALE;

        // Each source strip contains two copies, allowing a crop to wrap horizontally.
        const backSize = instance.assetSkyBack.getSize();
        const frontSize = instance.assetSkyFront.getSize();
        backSize.x /= 2;
        frontSize.x /= 2;

        // Convert the viewport size to source pixels while retaining the lower sky band.
        const textureScale = textureHeight / (Map.SKY_CUT_PCT * backSize.y);
        textureHeight /= textureScale;
        textureWidth /= textureScale;
        const backCutPixels = Math.trunc(backSize.y - textureHeight);
        const frontCutPixels = Math.trunc(frontSize.y - textureHeight);

        // The foreground cycles twice per full turn to create parallax.
        let modAngle = player.posAngle % (2 * Math.PI);
        if (modAngle < 0) modAngle += 2 * Math.PI;
        const sampleBackX = Math.trunc(modAngle * backSize.x / (2 * Math.PI));
        const angleFront = modAngle % Math.PI;
        const sampleFrontX = Math.trunc(angleFront * frontSize.x / Math.PI);

        skyBack.resize(new sf.Vector2u(textureWidth, backSize.y - backCutPixels));
        skyFront.resize(new sf.Vector2u(textureWidth, backSize.y - frontCutPixels));
        skyBack.loadFromImage(
            instance.assetSkyBack, false,
            new sf.IntRect(
                new sf.Vector2i(sampleBackX, backCutPixels),
                new sf.Vector2i(textureWidth, backSize.y - backCutPixels),
            ),
        );
        skyFront.loadFromImage(
            instance.assetSkyFront, false,
            new sf.IntRect(
                new sf.Vector2i(sampleFrontX, frontCutPixels),
                new sf.Vector2i(textureWidth, backSize.y - frontCutPixels),
            ),
        );
    }

    /** Offsets the camera behind the kart, converting the pixel distance to map units. */
    private static cameraPosition(player: Driver): sf.Vector2f {
        const f = Math.fround;
        return new sf.Vector2f(
            player.position.x - f(f(Math.cos(f(player.posAngle))) * (Map.CAM_2_PLAYER_DST / MAP_ASSETS_WIDTH)),
            player.position.y - f(f(Math.sin(f(player.posAngle))) * (Map.CAM_2_PLAYER_DST / MAP_ASSETS_HEIGHT)),
        );
    }

    /** Generates and uploads the original perspective circuit image. */
    static circuitTexture(
        player: Driver,
        circuitTexture: sf.Texture,
        windowSize = new sf.Vector2u(0, 0),
    ): void {
        if (windowSize.x === 0 || windowSize.y === 0) {
            windowSize = Map.instance.getWindowSize();
        }

        const circuitSize = new sf.Vector2u(
            windowSize.x, Math.fround(windowSize.y * Math.fround(Map.CIRCUIT_HEIGHT_PCT)),
        );
        const image = Map.instance.mode7(
            Map.cameraPosition(player), player.posAngle, Map.MODE7_FOV_HALF,
            Map.MODE7_CLIP_NEAR, Map.MODE7_CLIP_FAR, circuitSize, true,
        );

        circuitTexture.resize(circuitSize);
        circuitTexture.loadFromImage(image);
    }

    /** Uploads the precomputed minimap into the caller's texture. */
    static mapTexture(mapTexture: sf.Texture): void {
        mapTexture.loadFromImage(Map.instance.assetMinimap);
    }

    /** Maps normalized course coordinates onto the original minimap trapezoid. */
    static mapCoordinates(position: sf.Vector2f): sf.Vector2f {
        const left = new sf.Vector2f(
            Map.MINIMAP_TOP_X + (Map.MINIMAP_BOTTOM_X - Map.MINIMAP_TOP_X) * position.y,
            Map.MINIMAP_TOP_Y + (Map.MINIMAP_BOTTOM_Y - Map.MINIMAP_TOP_Y) * position.y,
        );
        return new sf.Vector2f(left.x + (1 - 2 * left.x) * position.x, left.y);
    }

    /** Projects a map point and returns visibility, normalized screen coordinates, and depth. */
    static mapToScreen(player: Driver, mapCoords: sf.Vector2f): MapProjection {
        const f = Math.fround;
        const camera = Map.cameraPosition(player);
        const relative = new sf.Vector2f(mapCoords.x - camera.x, mapCoords.y - camera.y);
        const relativeLength = f(Math.sqrt(f(f(relative.x * relative.x) + f(relative.y * relative.y))));
        const forward = new sf.Vector2f(Math.cos(f(player.posAngle)), Math.sin(f(player.posAngle)));

        // Dot and cross products resolve the point into forward depth and signed lateral angle.
        const cosFov = f(Math.cos(Map.MODE7_FOV_HALF));
        const sinFov = f(Math.sqrt(f(1 - f(cosFov * cosFov))));
        const z = f(f(forward.x * relative.x) + f(forward.y * relative.y));
        const cos = f(z / relativeLength);
        const sin = f(f(f(forward.x * relative.y) - f(forward.y * relative.x)) / relativeLength);

        // Use the same ground projection as mode7; height is applied later to each sprite.
        const y = f(f(f(Map.MODE7_CLIP_FAR) * cosFov) / f(relativeLength * cos));
        const x = f(f(sin + sinFov) / f(2 * sinFov));

        return {
            visible: x >= f(-0.1) && x < f(1.1) && y >= 0 && y <= 2,
            screenCoords: new sf.Vector2f(x, y),
            z,
        };
    }

    /** Appends projected wall sprites and elevated-object shadows. */
    static getWallDrawables(
        window: sf.RenderTarget, player: Driver, screenScale: number, drawables: MapDrawable[],
    ): void {
        const windowSize = window.getSize();
        for (const object of Map.instance.wallObjects) {
            const point = new sf.Vector2f(
                object.position.x - Math.cos(player.posAngle) * object.visualRadius,
                object.position.y - Math.sin(player.posAngle) * object.visualRadius,
            );
            const { visible, screenCoords: screen, z } = Map.mapToScreen(player, point);
            if (!visible) continue;

            // Sprites are shared references, so start from an absolute scale every frame.
            const sprite = object.getSprite();
            sprite.setScale(new sf.Vector2f(Map.CIRCUIT_HEIGHT_PCT, Map.CIRCUIT_HEIGHT_PCT));
            screen.x *= windowSize.x;
            screen.y *= windowSize.y * Map.CIRCUIT_HEIGHT_PCT;
            screen.y += windowSize.y * Map.SKY_HEIGHT_PCT;
            const scale = 1 / (3.6 * Math.log(1.02 + 0.8 * z));

            // The large depth offset sorts shadows behind all raised objects.
            if (object.height > 0) {
                const shadow = object.spriteShadow;
                shadow.setScale(new sf.Vector2f(Map.CIRCUIT_HEIGHT_PCT, Map.CIRCUIT_HEIGHT_PCT));
                shadow.scale(new sf.Vector2f(
                    scale * screenScale, scale * screenScale / Math.max(1, z * 5),
                ));
                shadow.setPosition(screen);
                shadow.setColor(new sf.Color(255, 255, 255, Math.max((40 - object.height) * 5.5, 0)));
                drawables.push([z + 10000, shadow]);
            }

            screen.y -= object.height * scale * screenScale;
            sprite.scale(new sf.Vector2f(scale * screenScale, scale * screenScale));
            sprite.setPosition(screen);
            drawables.push([z, sprite]);
        }
    }

    /** Appends projected item/effect sprites without shadows, as in the original. */
    static getItemDrawables(
        window: sf.RenderTarget, player: Driver, screenScale: number, drawables: MapDrawable[],
    ): void {
        const windowSize = window.getSize();
        for (const object of Map.instance.itemObjects) {
            const point = new sf.Vector2f(
                object.position.x - Math.cos(player.posAngle) * object.visualRadius,
                object.position.y - Math.sin(player.posAngle) * object.visualRadius,
            );
            const { visible, screenCoords: screen, z } = Map.mapToScreen(player, point);
            if (!visible) continue;

            const sprite = object.getSprite();
            sprite.setScale(new sf.Vector2f(Map.CIRCUIT_HEIGHT_PCT, Map.CIRCUIT_HEIGHT_PCT));
            screen.x *= windowSize.x;
            screen.y *= windowSize.y * Map.CIRCUIT_HEIGHT_PCT;
            screen.y += windowSize.y * Map.SKY_HEIGHT_PCT;
            const scale = 1 / (3.6 * Math.log(1.02 + 0.8 * z));
            screen.y -= object.height * scale * screenScale;
            sprite.scale(new sf.Vector2f(scale * screenScale, scale * screenScale));
            sprite.setPosition(screen);
            drawables.push([z, sprite]);
        }
    }

    /** Appends other visible drivers with directional frames, movement, and shadows. */
    static getDriverDrawables(
        window: sf.RenderTarget, player: Driver, drivers: readonly Driver[],
        screenScale: number, drawables: MapDrawable[],
    ): void {
        const windowSize = window.getSize();
        for (const object of drivers) {
            if (object === player || !object.isVisible()) continue;
            const point = new sf.Vector2f(
                object.position.x - Math.cos(player.posAngle) * object.visualRadius,
                object.position.y - Math.sin(player.posAngle) * object.visualRadius,
            );
            const { visible, screenCoords: screen, z } = Map.mapToScreen(player, point);
            if (!visible) continue;

            // Frame selection resets the driver sprite's base transform before projection.
            object.animator.setViewSprite(player.posAngle - object.posAngle);
            const sprite = object.getSprite();
            screen.x *= windowSize.x;
            screen.y *= windowSize.y * Map.CIRCUIT_HEIGHT_PCT;
            screen.y += windowSize.y * Map.SKY_HEIGHT_PCT;
            screen.y -= object.animator.spriteMovementSpeed;
            const scale = 1 / (3.6 * Math.log(1.02 + 0.8 * z));

            if (object.height > 0) {
                const shadow = object.spriteShadow;
                const spriteScale = object.getSprite().getScale();
                shadow.setScale(new sf.Vector2f(
                    spriteScale.x * Map.CIRCUIT_HEIGHT_PCT * 2,
                    spriteScale.y * Map.CIRCUIT_HEIGHT_PCT * 2,
                ));
                shadow.scale(new sf.Vector2f(
                    scale * screenScale, scale * screenScale / Math.max(1, z * 5),
                ));
                shadow.setPosition(screen);
                shadow.setColor(new sf.Color(255, 255, 255, Math.max((40 - object.height) * 5.5, 0)));
                drawables.push([z + 10000, shadow]);
            }

            screen.y -= object.height * scale * screenScale;
            sprite.scale(new sf.Vector2f(scale * screenScale, scale * screenScale));
            sprite.setPosition(screen);
            drawables.push([z, sprite]);
        }
    }

    /** Returns the one-based starting-grid slot in map pixels. */
    static getPlayerInitialPosition(position: number): sf.Vector2f {
        const goal = Map.instance.centeredGoal;
        const x = (goal.position.x + goal.size.x / 2) * MAP_ASSETS_WIDTH;
        const y = (goal.position.y + goal.size.y) * MAP_ASSETS_HEIGHT;

        // Stagger two columns behind the line; mirror them for starts on the right side.
        const deltaX = x < MAP_ASSETS_WIDTH / 2
            ? 16 * (2 * (position % 2) - 1)
            : 16 * (1 - 2 * (position % 2));
        const deltaY = 28 + 24 * (position - 1);
        return new sf.Vector2f(Math.floor((x + deltaX) / 8) * 8, y + deltaY);
    }
}
