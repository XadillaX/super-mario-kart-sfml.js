import * as sf from "sfml.js";
import type { Game } from "../game";
import { Audio } from "../audio/audio";
import { Driver } from "../entities/driver";
import { DriverControlType, MenuPlayer } from "../entities/enums";
import { Lakitu } from "../entities/lakitu";
import { VehicleProperties } from "../entities/vehicleproperties";
import { EndRanks } from "../gui/endranks";
import { Gui } from "../gui/gui";
import { Input, Key } from "../input/input";
import { MAP_TILES_HEIGHT, MAP_TILES_WIDTH, NUM_LAPS_IN_CIRCUIT } from "../map/enums";
import { Map } from "../map/map";
import { StateRace } from "./race";
import { StateRacePause } from "./racepause";
import { State } from "./statebase";

/** Post-finish camera orbit while the remaining racers complete their laps. */
export class StateRaceEnd extends State {
    private static readonly ANIMATION_TURN_TIME = sf.seconds(3.5);
    private static readonly ANIMATION_ZOOM_OUT_TIME = sf.seconds(6);
    private static readonly ANIMATION_TOTAL_TIME = sf.seconds(10);
    private static readonly ZOOM_OUT_DISTANCE = 0.04;
    private timeExecutingState = sf.Time.Zero;
    private hasPopped = false;
    private pushedPauseThisFrame = false;
    private pseudoPlayer!: Driver;
    private readonly drivers: Driver[];

    /** Retain the shared ranking while keeping an independent render order. */
    constructor(
        game: Game,
        private readonly player: Driver,
        drivers: Driver[],
        private readonly selectedPlayer: MenuPlayer,
        private readonly positions: Driver[],
    ) {
        super(game);
        this.drivers = [...drivers];
        this.ready = this.init();
    }

    /** Create and await the invisible camera driver before drawing. */
    async init(): Promise<void> {
        this.timeExecutingState = sf.Time.Zero;
        this.pseudoPlayer = new Driver("assets/drivers/invisible.png", new sf.Vector2f(),
            0, MAP_TILES_WIDTH, MAP_TILES_HEIGHT, DriverControlType.DISABLED,
            VehicleProperties.GODMODE, MenuPlayer.PEACH);
        await this.pseudoPlayer.ready;
    }

    /** Skip the camera animation or open the pause menu over its current frame. */
    handleEvent(event: sf.Event): void {
        if (Input.pressed(Key.ACCEPT, event) &&
            this.timeExecutingState.asSeconds() < StateRaceEnd.ANIMATION_TOTAL_TIME.asSeconds()) {
            this.timeExecutingState = StateRaceEnd.ANIMATION_TOTAL_TIME;
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

    /** Continue AI movement without collisions and keep finished places locked. */
    fixedUpdate(deltaTime: sf.Time): boolean {
        this.timeExecutingState = sf.add(this.timeExecutingState, deltaTime);
        StateRace.currentTime = sf.add(StateRace.currentTime, deltaTime);
        this.pushedPauseThisFrame = false;

        // Race handed every driver to AI; keep them moving during the finish presentation.
        Map.updateObjects(deltaTime);
        for (let i = 0; i < this.drivers.length; i++) {
            const driver = this.drivers[i];
            driver.update(deltaTime);
            Audio.updateEngine(i, driver.position, driver.height, driver.speedForward, driver.speedTurn);
        }
        Audio.updateListener(this.player.position, this.player.posAngle, this.player.height);

        // Turn and zoom overlap, each clamping at its own animation deadline.
        const turnPct = Math.min(
            this.timeExecutingState.asSeconds() / StateRaceEnd.ANIMATION_TURN_TIME.asSeconds(), 1,
        );
        const zoomPct = Math.min(
            this.timeExecutingState.asSeconds() / StateRaceEnd.ANIMATION_ZOOM_OUT_TIME.asSeconds(), 1,
        );
        const distance = StateRaceEnd.ZOOM_OUT_DISTANCE * zoomPct;
        this.pseudoPlayer.position = new sf.Vector2f(
            this.player.position.x + Math.cos(this.player.posAngle) * distance,
            this.player.position.y + Math.sin(this.player.posAngle) * distance,
        );
        this.pseudoPlayer.posAngle = this.player.posAngle + turnPct * Math.PI;

        // Preserve the locked finishers and update only the tail of the shared ranking.
        let unfinished = 0;
        while (unfinished < this.positions.length &&
            this.positions[unfinished].getLaps() > NUM_LAPS_IN_CIRCUIT) {
            unfinished++;
        }
        const remaining = this.positions.slice(unfinished).sort((left, right) =>
            left.getLaps() === right.getLaps()
                ? left.getLastGradient() - right.getLastGradient()
                : right.getLaps() - left.getLaps());
        this.positions.splice(unfinished, remaining.length, ...remaining);

        Lakitu.update(deltaTime);
        EndRanks.update(deltaTime);

        // The presentation deadline, not all AI finishing, returns control to RaceManager.
        if (this.timeExecutingState.asSeconds() > StateRaceEnd.ANIMATION_TOTAL_TIME.asSeconds() &&
            !this.hasPopped) {
            this.hasPopped = true;
            Lakitu.showUntil(0, deltaTime);
            this.game.popState();
        }

        Audio.updateListener(this.player.position, this.player.posAngle, this.player.height);
        return true;
    }

    /** Draw the orbiting race view, minimap, finish flag, HUD, and final ranks. */
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

        // Use the orbiting camera for every world sprite, including the player's kart.
        const drawables: [number, sf.Sprite][] = [];
        Map.getWallDrawables(window, this.pseudoPlayer, scale, drawables);
        Map.getItemDrawables(window, this.pseudoPlayer, scale, drawables);
        Map.getDriverDrawables(window, this.pseudoPlayer, this.drivers, scale, drawables);
        drawables.sort((left, right) => right[0] - left[0]);
        for (const [, sprite] of drawables) {
            window.draw(sprite);
        }

        // Reordering the local render array must not change the shared finish order.
        currentHeight += size.y * Map.CIRCUIT_HEIGHT_PCT;
        map.setPosition(new sf.Vector2f(0, currentHeight));
        window.draw(map);
        this.drivers.sort((left, right) => left.position.y - right.position.y);
        for (const driver of this.drivers) {
            const sprite = driver.animator.getMinimapSprite(driver.posAngle + driver.speedTurn * 0.2, scale);
            const mapPosition = Map.mapCoordinates(driver.position);
            const bounds = sprite.getLocalBounds();
            sprite.setOrigin(new sf.Vector2f(bounds.size.x / 2, bounds.size.y * 0.9));
            sprite.setPosition(new sf.Vector2f(mapPosition.x * size.x, mapPosition.y * size.y));
            sprite.scale(new sf.Vector2f(0.5, 0.5));
            window.draw(sprite);
        }

        // Finish flag and results remain in screen space above the race and minimap.
        Lakitu.draw(window);
        Gui.draw(window);
        EndRanks.draw(window);
    }

    /** State stack diagnostic name. */
    string(): string {
        return "RaceEnd";
    }
}
