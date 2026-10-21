import * as sf from "sfml.js";
import type { Game } from "../game";
import { Audio, Music } from "../audio/audio";
import { Driver } from "../entities/driver";
import { DriverControlType, MenuPlayer } from "../entities/enums";
import { Lakitu } from "../entities/lakitu";
import { VehicleProperties } from "../entities/vehicleproperties";
import { Gui } from "../gui/gui";
import { Color, TextUtils } from "../gui/textutils";
import { Input, Key } from "../input/input";
import { CCOption, MAP_ASSETS_HEIGHT, MAP_ASSETS_WIDTH, MAP_TILES_HEIGHT, MAP_TILES_WIDTH } from "../map/enums";
import { Map } from "../map/map";
import { CIRCUIT_DISPLAY_NAMES, RaceCircuit } from "./racemanager";
import { StateRacePause } from "./racepause";
import { State } from "./statebase";

/** Course flyover, Lakitu countdown, and original launch/burnout timing. */
export class StateRaceStart extends State {
    private static readonly ANIMATION_FORWARD_TIME = sf.seconds(8.75);
    private static readonly ANIMATION_TURN_TIME = sf.seconds(10);
    private static readonly ANIMATION_FORWARD_DISTANCE = 0.2;
    private static readonly PROB_HIT_BY_CC = [0.95, 0.975, 1];
    private currentTime = sf.Time.Zero;
    private accTime = sf.Time.Zero;
    private playerPosition = new sf.Vector2f();
    private pseudoPlayer!: Driver;
    private readonly drivers: Driver[];
    private asyncLoadFinished = false;
    private fadingMusic = false;
    private pushedPauseThisFrame = false;

    /** Await the invisible camera and course AI before the flyover's first frame. */
    constructor(
        game: Game,
        private readonly player: Driver,
        drivers: Driver[],
        playerPosition: sf.Vector2f,
        private readonly selectedCircuit: RaceCircuit,
        private readonly ccOption: CCOption,
    ) {
        super(game);
        this.drivers = [...drivers];
        this.ready = this.init(playerPosition);
    }

    private async asyncLoad(): Promise<void> {
        await Map.loadAI();
        this.asyncLoadFinished = true;
    }

    /** Initialize normalized camera coordinates and the original countdown state. */
    async init(position: sf.Vector2f): Promise<void> {
        this.currentTime = sf.Time.Zero;
        this.accTime = sf.Time.Zero;
        this.playerPosition = new sf.Vector2f(position.x / MAP_ASSETS_WIDTH, position.y / MAP_ASSETS_HEIGHT);

        // The flyover moves an invisible camera driver, leaving the starting grid untouched.
        this.pseudoPlayer = new Driver("assets/drivers/invisible.png",
            new sf.Vector2f(this.playerPosition.x, this.playerPosition.y - StateRaceStart.ANIMATION_FORWARD_DISTANCE),
            -Math.PI / 2, MAP_TILES_WIDTH, MAP_TILES_HEIGHT,
            DriverControlType.DISABLED, VehicleProperties.ACCELERATION, MenuPlayer.PEACH);
        this.pseudoPlayer.setPositionAndReset(this.playerPosition);
        this.asyncLoadFinished = false;
        this.fadingMusic = false;

        await Promise.all([
            this.pseudoPlayer.ready,
            ...this.drivers.map(driver => driver.ready),
            this.asyncLoad(),
        ]);
    }

    /** Skip the flyover or pause without skipping the starting semaphore. */
    handleEvent(event: sf.Event): void {
        // Skipping lands at the countdown boundary, not at the start of the race.
        if (Input.pressed(Key.ACCEPT, event) && this.currentTime.asSeconds() < 10) {
            this.currentTime = sf.seconds(10);
        }

        if (Input.pressed(Key.PAUSE, event) && !this.pushedPauseThisFrame) {
            this.pushedPauseThisFrame = true;
            const render = new sf.RenderTexture(this.game.getWindow().getSize());
            this.fixedUpdate(sf.seconds(0));
            this.draw(render);
            render.display();
            this.game.pushState(new StateRacePause(this.game, render));
        }
    }

    /** Advance all four flyover shots, camera turnaround, and launch outcomes. */
    update(deltaTime: sf.Time): boolean {
        this.currentTime = sf.add(this.currentTime, deltaTime);
        this.pushedPauseThisFrame = false;
        Lakitu.update(deltaTime);

        // Three course shots lead into the approach to the player's grid position.
        const time = this.currentTime.asSeconds();
        if (time < 2) {
            const angle = -Math.PI / 2 * time / 2;
            this.pseudoPlayer.position = new sf.Vector2f(
                0.8 - Math.sin(angle) * 0.1, 0.8 + Math.cos(angle) * 0.1,
            );
            this.pseudoPlayer.posAngle = angle;
        } else if (time < 4) {
            const progress = (time - 2) / 2;
            this.pseudoPlayer.position = new sf.Vector2f(0.225, 0.475 + 0.1 * (1 - progress));
            this.pseudoPlayer.posAngle = Math.PI + Math.PI / 8 - Math.PI / 4 * progress;
        } else if (time < 6) {
            const progress = (time - 4) / 2;
            this.pseudoPlayer.position = new sf.Vector2f(0.3 + 0.05 * progress, 0.4 + 0.05 * progress);
            this.pseudoPlayer.posAngle = Math.PI / 4 * (1 - progress);
        } else if (time < 8.75) {
            const progress = (time - 6) / 2.75;
            this.pseudoPlayer.position = new sf.Vector2f(
                this.playerPosition.x,
                this.playerPosition.y - StateRaceStart.ANIMATION_FORWARD_DISTANCE * (1 - progress),
            );
            this.pseudoPlayer.posAngle = Math.PI / 2;
        } else {
            // Turn into the racing view, then let Lakitu's semaphore own the start timing.
            this.pseudoPlayer.position = new sf.Vector2f(this.playerPosition);
            this.pseudoPlayer.posAngle = -Math.PI / 2;
            if (time < 10) {
                const progress = (time - StateRaceStart.ANIMATION_FORWARD_TIME.asSeconds()) /
                    (StateRaceStart.ANIMATION_TURN_TIME.asSeconds() -
                        StateRaceStart.ANIMATION_FORWARD_TIME.asSeconds());
                this.pseudoPlayer.posAngle = Math.PI * (0.5 - progress);
            } else if (Lakitu.isSleeping() && this.asyncLoadFinished) {
                Lakitu.showStart();
                this.fadingMusic = true;
            }

            if (this.fadingMusic) {
                Audio.fadeOut(Music.CIRCUIT_ANIMATION_START, deltaTime);
            }

            // Both the countdown and AI loading must finish before Race is uncovered.
            if (Lakitu.hasStarted() && this.asyncLoadFinished) {
                Audio.playEngines(true);
                Audio.playMusic(Music.CIRCUIT_NORMAL);
                for (const driver of this.drivers) {
                    if (driver === this.player) {
                        // A long uninterrupted accelerator hold causes a burnout instead of a launch.
                        if (this.accTime.asSeconds() < 1.5) {
                            driver.speedForward = this.pseudoPlayer.speedForward;
                        } else {
                            driver.applyHit();
                        }
                    } else {
                        const speedPercent = (75 + Math.floor(Math.random() * 25)) / 100;
                        const turnPercent = Math.floor(Math.random() * 15) / 100;
                        if (speedPercent <= StateRaceStart.PROB_HIT_BY_CC[this.ccOption]) {
                            driver.speedForward = speedPercent * driver.vehicle.maxNormalLinearSpeed;
                            driver.speedTurn = turnPercent * driver.vehicle.maxTurningAngularSpeed;
                        } else {
                            driver.applyHit();
                        }
                    }
                }
                this.game.popState();
            }
        }

        // Rev the camera's speed model during the intro; release resets the burnout timer.
        this.pseudoPlayer.updateSpeed(deltaTime);
        Audio.updateListener(this.pseudoPlayer.position, this.pseudoPlayer.posAngle, this.pseudoPlayer.height);
        Audio.updateEngine(this.player.position, this.player.height, this.pseudoPlayer.speedForward, 0);
        this.accTime = Input.held(Key.ACCELERATE) ? sf.add(this.accTime, deltaTime) : sf.Time.Zero;
        return true;
    }

    /** Draw the course flyover and its sliding course-name/skip instructions. */
    draw(window: sf.RenderTarget): void {
        const scale = window.getSize().x / 512;
        const size = this.game.getWindow().getSize();
        const skyBackTexture = new sf.Texture();
        const skyFrontTexture = new sf.Texture();
        const circuitTexture = new sf.Texture();
        const mapTexture = new sf.Texture();
        Map.skyTextures(this.pseudoPlayer, skyBackTexture, skyFrontTexture);
        Map.circuitTexture(this.pseudoPlayer, circuitTexture);
        Map.mapTexture(mapTexture);

        const skyBack = new sf.Sprite(skyBackTexture);
        const skyFront = new sf.Sprite(skyFrontTexture);
        const circuit = new sf.Sprite(circuitTexture);
        const map = new sf.Sprite(mapTexture);
        const backFactor = size.x / skyBackTexture.getSize().x;
        const frontFactor = size.x / skyFrontTexture.getSize().x;
        skyBack.setScale(new sf.Vector2f(backFactor, backFactor));
        skyFront.setScale(new sf.Vector2f(frontFactor, frontFactor));
        window.draw(skyBack);
        window.draw(skyFront);
        let currentHeight = size.y * Map.SKY_HEIGHT_PCT;
        circuit.setPosition(new sf.Vector2f(0, currentHeight));
        window.draw(circuit);
        Lakitu.drawShadow(window);

        // Project the stationary grid through the flyover camera and draw far to near.
        const drawables: [number, sf.Sprite][] = [];
        Map.getWallDrawables(window, this.pseudoPlayer, scale, drawables);
        Map.getDriverDrawables(window, this.pseudoPlayer, this.drivers, scale, drawables);
        drawables.sort((left, right) => right[0] - left[0]);
        for (const [, sprite] of drawables) {
            window.draw(sprite);
        }

        // The minimap keeps the grid view fixed while the main camera moves.
        currentHeight += size.y * Map.CIRCUIT_HEIGHT_PCT;
        map.setPosition(new sf.Vector2f(0, currentHeight));
        window.draw(map);
        this.drivers.sort((left, right) => left.position.y - right.position.y);
        for (const driver of this.drivers) {
            const sprite = driver.animator.getMinimapSprite(-Math.PI / 2, scale);
            const mapPosition = Map.mapCoordinates(driver.position);
            const bounds = sprite.getLocalBounds();
            sprite.setOrigin(new sf.Vector2f(bounds.size.x / 2, bounds.size.y * 0.9));
            sprite.setPosition(new sf.Vector2f(mapPosition.x * size.x, mapPosition.y * size.y));
            sprite.scale(new sf.Vector2f(0.5, 0.5));
            window.draw(sprite);
        }

        Lakitu.draw(window);
        Gui.draw(window);

        // Course labels slide away before the countdown takes over the foreground.
        if (this.currentTime.asSeconds() < 10) {
            const position = new sf.Vector2f(0.04, 0.41);
            if (this.currentTime.asSeconds() > 8) {
                position.x -= (this.currentTime.asSeconds() - 8) / 2;
            }
            TextUtils.write(window, CIRCUIT_DISPLAY_NAMES[this.selectedCircuit],
                new sf.Vector2f(position.x * size.x, position.y * size.y),
                size.x / 256, Color.MenuPrimaryOnFocus);
            TextUtils.write(window, `${Input.getKeyCodeName(Input.get(Key.ACCEPT))} to skip >>`,
                new sf.Vector2f(position.x * size.x, position.y * 1.12 * size.y),
                size.x / 256 * 0.5, Color.MenuPrimary);
        }
    }

    /** State stack diagnostic name. */
    string(): string {
        return "RaceStart";
    }
}
