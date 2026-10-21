import * as sf from "sfml.js";
import type { Game } from "../game";
import { Driver } from "../entities/driver";
import { DRIVER_DISPLAY_NAMES, DriverControlType, MenuPlayer } from "../entities/enums";
import { FloatingFish } from "../entities/floatingfish";
import { Podium } from "../entities/podium";
import { VehicleProperties } from "../entities/vehicleproperties";
import { Color, TextUtils } from "../gui/textutils";
import { CCOption, MAP_ASSETS_HEIGHT, MAP_ASSETS_WIDTH } from "../map/enums";
import { Map } from "../map/map";
import { CIRCUIT_ASSET_NAMES, RaceCircuit, RaceMode } from "./racemanager";
import { State } from "./statebase";

/** Podium presentation and engine-class-specific trophies after a completed event. */
export class StateCongratulations extends State {
    private static readonly NUM_GRATS = 8;
    private static readonly assetCongratulations = Array.from({ length: 8 }, () => new sf.Texture());
    private static readonly assetOne = Array.from({ length: 8 }, () => new sf.Texture());
    private static readonly assetTwo = Array.from({ length: 8 }, () => new sf.Texture());
    private static readonly assetThree = Array.from({ length: 8 }, () => new sf.Texture());
    private static readonly assetSmallTrohpies = Array.from({ length: 3 }, () => new sf.Texture());
    private static readonly assetBigTrophies = Array.from({ length: 3 }, () => new sf.Texture());
    private static readonly assetMarioTrophies = Array.from({ length: 3 }, () => new sf.Texture());
    private static readonly assetRibbon = new sf.Texture();

    /** Podium offsets: normalized map x/y and driver height. */
    static readonly PODIUM_DISPLACEMENTS = [
        new sf.Vector3f(-0.05e-2, 1e-5, 9),
        new sf.Vector3f(-0.62e-2, 1e-5, 6),
        new sf.Vector3f(0.5e-2, 1e-5, 3),
    ];
    /** Fade-in duration from the original presentation. */
    static readonly TIME_FADE = sf.seconds(2);
    /** Duration of the camera's approach to the podium. */
    static readonly TIME_ANIMATION = sf.seconds(2.5);
    /** Total duration before returning to the race manager. */
    static readonly TIME_WAIT = sf.seconds(15);
    /** Delay before splitting the foreground trophy. */
    static readonly TIME_TROPHY_INITIAL = sf.seconds(4);
    /** Duration of the trophy halves opening. */
    static readonly TIME_TROPHY_MOVEMENT = sf.seconds(3);
    /** Duration of the background trophy fade. */
    static readonly TIME_TROPHY_FADE = sf.seconds(3);
    /** Initial camera displacement from the podium in normalized map coordinates. */
    static readonly CAMERA_DISPLACEMENT = new sf.Vector2f(0, 0.35);

    private readonly orderedDrivers: Driver[] = [];
    private framesSinceOrigin = 0;
    private hasPopped = false;
    /** Invisible driver controlling the podium camera. */
    pseudoPlayer!: Driver;
    /** One-based finishing position of the selected player. */
    playerRankedPosition = 0;
    /** Normalized podium location approached by the camera. */
    targetCameraPosition = new sf.Vector2f();
    /** Elapsed podium presentation time. */
    currentTime: sf.Time = sf.seconds(0);

    /** Load each congratulations, placement, trophy, and ribbon sprite-sheet region. */
    static async loadAssets(
        assetName: string,
        roiCongrats0: sf.IntRect,
        congratulationsDY: number,
        roiOnes0: sf.IntRect,
        roiTwos0: sf.IntRect,
        roiThrees0: sf.IntRect,
        numbersDY: number,
        roiSmallTrophy0: sf.IntRect,
        roiBigTrophy0: sf.IntRect,
        roiMarioTrophy0: sf.IntRect,
        trohpiesDX: number,
        roiRibbon: sf.IntRect,
    ): Promise<void> {
        const load = async (texture: sf.Texture, roi: sf.IntRect): Promise<void> => {
            if (!await texture.loadFromFile(assetName, false, roi)) {
                throw new Error(`Unable to load congratulations asset: ${assetName}`);
            }
        };
        const rows: readonly [sf.Texture[], sf.IntRect, number, number][] = [
            [this.assetCongratulations, roiCongrats0, 0, congratulationsDY],
            [this.assetOne, roiOnes0, 0, numbersDY],
            [this.assetTwo, roiTwos0, 0, numbersDY],
            [this.assetThree, roiThrees0, 0, numbersDY],
            [this.assetSmallTrohpies, roiSmallTrophy0, trohpiesDX, 0],
            [this.assetBigTrophies, roiBigTrophy0, trohpiesDX, 0],
            [this.assetMarioTrophies, roiMarioTrophy0, trohpiesDX, 0],
        ];
        for (const [textures, first, dx, dy] of rows) {
            for (let i = 0; i < textures.length; i++) {
                const roi = new sf.IntRect(
                    new sf.Vector2i(first.position.x + i * dx, first.position.y + i * dy),
                    new sf.Vector2i(first.size),
                );
                await load(textures[i], roi);
            }
        }
        await load(this.assetRibbon, roiRibbon);
    }

    /** Preserve the manager's standings and await the podium course and camera. */
    constructor(
        game: Game,
        private readonly circuit: RaceCircuit,
        private readonly mode: RaceMode,
        private readonly ccOption: CCOption,
        private readonly player: MenuPlayer,
        standings: [Driver, number][],
    ) {
        super(game);
        this.ready = this.init(standings);
    }

    /** Place the original podium, three fish, and top three drivers. */
    async init(standings: [Driver, number][]): Promise<void> {
        this.currentTime = sf.seconds(0);
        this.framesSinceOrigin = 0;
        if (!await Map.loadCourse(CIRCUIT_ASSET_NAMES[this.circuit])) {
            throw new Error(`Unable to load podium course: ${CIRCUIT_ASSET_NAMES[this.circuit]}`);
        }
        const first = Map.getPlayerInitialPosition(1);
        const second = Map.getPlayerInitialPosition(2);
        const podiumPosition = new sf.Vector2f((first.x + second.x) / 2, (first.y + second.y) / 2);
        Map.addItem(new Podium(new sf.Vector2f(podiumPosition)));
        Map.addItem(new FloatingFish(
            new sf.Vector2f(podiumPosition.x + 0.02 * MAP_ASSETS_WIDTH, podiumPosition.y + 0.15 * MAP_ASSETS_HEIGHT),
            new sf.Vector2f(-0.04, -0.03), false,
        ));
        Map.addItem(new FloatingFish(
            new sf.Vector2f(podiumPosition.x + 0.04 * MAP_ASSETS_WIDTH, podiumPosition.y - 0.06 * MAP_ASSETS_HEIGHT),
            new sf.Vector2f(-0.0015, 0), false,
        ));
        Map.addItem(new FloatingFish(
            new sf.Vector2f(podiumPosition.x - 0.04 * MAP_ASSETS_WIDTH, podiumPosition.y - 0.06 * MAP_ASSETS_HEIGHT),
            new sf.Vector2f(0.002, 0.0005), true,
        ));
        this.targetCameraPosition = new sf.Vector2f(
            podiumPosition.x / MAP_ASSETS_WIDTH, podiumPosition.y / MAP_ASSETS_HEIGHT,
        );
        this.pseudoPlayer = new Driver(
            "assets/drivers/invisible.png",
            new sf.Vector2f(
                this.targetCameraPosition.x + StateCongratulations.CAMERA_DISPLACEMENT.x,
                this.targetCameraPosition.y + StateCongratulations.CAMERA_DISPLACEMENT.y,
            ),
            -Math.PI / 2, MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT, DriverControlType.DISABLED,
            VehicleProperties.GODMODE, MenuPlayer.MARIO,
        );
        for (let i = 0; i < standings.length; i++) {
            const driver = standings[i][0];
            if (driver.getPj() === this.player) {
                this.playerRankedPosition = i + 1;
            }
            if (i < StateCongratulations.PODIUM_DISPLACEMENTS.length) {
                const displacement = StateCongratulations.PODIUM_DISPLACEMENTS[i];
                driver.position = new sf.Vector2f(
                    this.targetCameraPosition.x + displacement.x, this.targetCameraPosition.y + displacement.y,
                );
                driver.height = displacement.z;
                driver.posAngle = Math.PI / 2;
                driver.controlType = DriverControlType.DISABLED;
                this.orderedDrivers.push(driver);
            } else {
                this.orderedDrivers.push(this.pseudoPlayer);
            }
        }
        await Promise.all([this.pseudoPlayer.ready, ...this.orderedDrivers.map(driver => driver.ready)]);
    }

    /** Approach the podium, animate its objects, and pop once after fifteen seconds. */
    fixedUpdate(deltaTime: sf.Time): boolean {
        this.currentTime = sf.add(this.currentTime, deltaTime);
        this.framesSinceOrigin++;
        let displacementPct = 0.02;
        if (this.currentTime.asSeconds() < StateCongratulations.TIME_ANIMATION.asSeconds()) {
            displacementPct = 1.02 - this.currentTime.asSeconds() / StateCongratulations.TIME_ANIMATION.asSeconds();
        }
        this.pseudoPlayer.position = new sf.Vector2f(
            this.targetCameraPosition.x + StateCongratulations.CAMERA_DISPLACEMENT.x * displacementPct,
            this.targetCameraPosition.y + StateCongratulations.CAMERA_DISPLACEMENT.y * displacementPct,
        );
        if (this.currentTime.asSeconds() > StateCongratulations.TIME_WAIT.asSeconds() && !this.hasPopped) {
            this.hasPopped = true;
            this.game.popState();
        }
        Map.updateObjects(deltaTime);
        return true;
    }

    /** Draw the scene, rank ribbon, trophy reveal, result text, and entrance fade. */
    draw(window: sf.RenderTarget): void {
        const scale = window.getSize().x / 512;
        const size = this.game.getWindow().getSize();
        const padTop = Map.SKY_HEIGHT_PCT * 2.5 * size.y;
        const now = this.currentTime.asSeconds();
        window.clear(sf.Color.Black);
        const backTexture = new sf.Texture();
        const frontTexture = new sf.Texture();
        const circuitTexture = new sf.Texture();
        Map.skyTextures(this.pseudoPlayer, backTexture, frontTexture);
        Map.circuitTexture(this.pseudoPlayer, circuitTexture);
        const back = new sf.Sprite(backTexture);
        const front = new sf.Sprite(frontTexture);
        const circuit = new sf.Sprite(circuitTexture);
        back.setScale(new sf.Vector2f(size.x / backTexture.getSize().x, size.x / backTexture.getSize().x));
        front.setScale(new sf.Vector2f(size.x / frontTexture.getSize().x, size.x / frontTexture.getSize().x));
        back.setPosition(new sf.Vector2f(0, padTop));
        front.setPosition(new sf.Vector2f(0, padTop));
        window.draw(back);
        window.draw(front);
        let currentHeight = padTop + size.y * Map.SKY_HEIGHT_PCT;
        circuit.setPosition(new sf.Vector2f(0, currentHeight));
        window.draw(circuit);
        currentHeight += size.y * Map.CIRCUIT_HEIGHT_PCT;
        const drawables: [number, sf.Sprite][] = [];
        Map.getWallDrawables(window, this.pseudoPlayer, scale, drawables);
        Map.getItemDrawables(window, this.pseudoPlayer, scale, drawables);
        Map.getDriverDrawables(window, this.pseudoPlayer, this.orderedDrivers, scale, drawables);
        drawables.sort((left, right) => right[0] - left[0]);
        for (const [, sprite] of drawables) {
            sprite.move(new sf.Vector2f(0, padTop));
            window.draw(sprite);
        }
        const black = new sf.RectangleShape(new sf.Vector2f(size.x, size.y));
        black.setFillColor(sf.Color.Black);
        black.setPosition(new sf.Vector2f(0, currentHeight));
        window.draw(black);
        black.setSize(new sf.Vector2f(size.x, padTop));
        black.setPosition(new sf.Vector2f());
        window.draw(black);

        if (this.playerRankedPosition <= 3) {
            const frame = Math.floor(this.framesSinceOrigin / 3) % StateCongratulations.NUM_GRATS;
            const ribbon = new sf.Sprite(StateCongratulations.assetRibbon);
            const congrats = new sf.Sprite(StateCongratulations.assetCongratulations[frame]);
            const numbers = this.playerRankedPosition === 1 ? StateCongratulations.assetOne
                : this.playerRankedPosition === 2 ? StateCongratulations.assetTwo : StateCongratulations.assetThree;
            const number = new sf.Sprite(numbers[frame]);
            ribbon.setPosition(new sf.Vector2f(79.25 / 256 * size.x, 5 / 224 * size.y));
            congrats.setPosition(new sf.Vector2f(22.25 / 256 * size.x, 25 / 224 * size.y));
            number.setPosition(new sf.Vector2f(
                (this.playerRankedPosition === 1 ? 118.5 : 117) / 256 * size.x, 4 / 224 * size.y,
            ));
            for (const sprite of [ribbon, congrats, number]) {
                sprite.setScale(new sf.Vector2f(scale * 3, scale * 3));
                window.draw(sprite);
            }
        } else {
            const textScale = size.x / 256;
            TextUtils.write(window, "better luck next time!", new sf.Vector2f(128 * textScale, 20 * textScale),
                textScale, Color.MenuPrimaryOnFocus, true, TextUtils.TextAlign.CENTER);
        }
        let trophyTexture: sf.Texture | undefined;
        const trophyOpenTime = StateCongratulations.TIME_TROPHY_INITIAL.asSeconds() +
            StateCongratulations.TIME_TROPHY_MOVEMENT.asSeconds();
        if (this.playerRankedPosition <= 3) {
            const trophies = this.mode === RaceMode.GRAND_PRIX_1
                ? (this.ccOption === CCOption.CC150
                    ? StateCongratulations.assetMarioTrophies : StateCongratulations.assetBigTrophies)
                : StateCongratulations.assetSmallTrohpies;
            trophyTexture = trophies[this.playerRankedPosition - 1];
            if (now > trophyOpenTime) {
                const trophy = new sf.Sprite(trophyTexture);
                trophy.setPosition(new sf.Vector2f(104 / 256 * size.x, 167 / 224 * size.y));
                trophy.setScale(new sf.Vector2f(scale * 6, scale * 6));
                const pct = Math.max((now - trophyOpenTime) / StateCongratulations.TIME_TROPHY_FADE.asSeconds(), 0);
                trophy.setColor(new sf.Color(255, 255, 255, Math.trunc(Math.min(pct * 255, 255))));
                window.draw(trophy);
            }
        }
        let text1 = "";
        switch (this.ccOption) {
            case CCOption.CC50: text1 = "50cc"; break;
            case CCOption.CC100: text1 = "100cc"; break;
            case CCOption.CC150: text1 = "150cc"; break;
            default: console.error("Error: invalid CC option"); break;
        }
        switch (this.mode) {
            case RaceMode.GRAND_PRIX_1: text1 += " grand prix"; break;
            case RaceMode.VERSUS: text1 += " versus"; break;
            default: console.error("Error: invalid race mode"); break;
        }
        const positionNames = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];
        const text2 = `${DRIVER_DISPLAY_NAMES[Number(this.player)]} finished ${positionNames[this.playerRankedPosition - 1]}`;
        const texts = [text1, text2, "thank you for playing!"];
        for (let i = 0; i < texts.length; i++) {
            TextUtils.write(window, texts[i], new sf.Vector2f(128 / 256 * size.x, (176 + i * 12) / 224 * size.y),
                scale * 2, Color.MenuPrimaryOnFocus, true, TextUtils.TextAlign.CENTER);
        }
        if (trophyTexture && now < trophyOpenTime) {
            const pct = Math.max((now - StateCongratulations.TIME_TROPHY_INITIAL.asSeconds()) /
                StateCongratulations.TIME_TROPHY_MOVEMENT.asSeconds(), 0);
            for (let half = 0; half < 2; half++) {
                const movement = (half === 0 ? -0.5 : 0.5) * pct * size.x;
                black.setSize(new sf.Vector2f(size.x * 0.5, size.y - currentHeight));
                black.setPosition(new sf.Vector2f(half * size.x * 0.5 + movement, currentHeight));
                window.draw(black);
            }
            for (let half = 0; half < 2; half++) {
                const trophy = new sf.Sprite(trophyTexture);
                trophy.setTextureRect(new sf.IntRect(new sf.Vector2i(half * 8, 0), new sf.Vector2i(8, 16)));
                trophy.setPosition(new sf.Vector2f(
                    (104 + half * 24) / 256 * size.x + (half === 0 ? -0.5 : 0.5) * pct * size.x,
                    167 / 224 * size.y,
                ));
                trophy.setScale(new sf.Vector2f(scale * 6, scale * 6));
                window.draw(trophy);
            }
        }
        if (now < StateCongratulations.TIME_FADE.asSeconds()) {
            const pct = 1 - now / StateCongratulations.TIME_FADE.asSeconds();
            black.setSize(new sf.Vector2f(size.x, size.y));
            black.setPosition(new sf.Vector2f());
            black.setFillColor(new sf.Color(0, 0, 0, Math.trunc(Math.min(pct * 255, 255))));
            window.draw(black);
        }
    }

    /** State stack diagnostic name. */
    string(): string {
        return "Congratulations";
    }
}
