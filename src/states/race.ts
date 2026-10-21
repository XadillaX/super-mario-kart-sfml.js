import * as sf from "sfml.js";
import type { Game } from "../game";
import { Audio, Music, SFX } from "../audio/audio";
import { CollisionData, CollisionType } from "../entities/collisiondata";
import { CollisionHashMap } from "../entities/collisionhashmap";
import type { Driver } from "../entities/driver";
import { DriverControlType, PowerUps } from "../entities/enums";
import { Item } from "../entities/item";
import { Lakitu } from "../entities/lakitu";
import { EndRanks } from "../gui/endranks";
import { Gui } from "../gui/gui";
import { Input, Key } from "../input/input";
import { CCOption, NUM_LAPS_IN_CIRCUIT } from "../map/enums";
import { FloorObject } from "../map/floorobject";
import { Map } from "../map/map";
import { StateRacePause } from "./racepause";
import { State } from "./statebase";

/** Fixed-step race simulation, collision/ranking updates, and race HUD. */
export class StateRace extends State {
    private static readonly WAIT_FOR_PC_LAST_PLACE = sf.seconds(5);
    /** Shared race clock consumed by drivers, items, and the demo. */
    static currentTime: sf.Time = sf.seconds(0);
    /** Selected engine class, also consumed by race entities. */
    static ccOption = CCOption.CC50;

    private nextItemCheck = sf.Time.Zero;
    private readonly drivers: Driver[];
    private readonly miniDrivers: Driver[];
    private pushedPauseThisFrame = false;
    private raceFinished = false;
    private driftPressed = false;
    private waitForPCTime = sf.Time.Zero;

    /** Copy driver order but retain the manager's live ranking array. */
    constructor(
        game: Game,
        private readonly player: Driver,
        drivers: Driver[],
        private readonly positions: Driver[],
    ) {
        super(game);
        this.drivers = [...drivers];
        this.miniDrivers = [...drivers];
        this.init();
    }

    /** Reset the race clock, item scheduler, and last-place grace period. */
    init(): void {
        this.pushedPauseThisFrame = false;
        StateRace.currentTime = sf.seconds(0);
        this.nextItemCheck = sf.Time.Zero;
        this.waitForPCTime = sf.Time.Zero;
    }

    /** Use items, edge-trigger drift jumps, and capture the pause screen. */
    handleEvent(event: sf.Event): void {
        if (Input.pressed(Key.ITEM_FRONT, event) && this.player.canDrive()) {
            Item.useItem(this.player, this.positions, true);
        }
        if (Input.pressed(Key.ITEM_BACK, event) && this.player.canDrive()) {
            Item.useItem(this.player, this.positions, false);
        }

        if (Input.pressed(Key.DRIFT, event) && this.player.canDrive() && !this.driftPressed) {
            this.driftPressed = true;
            this.player.shortJump();
        }
        if (Input.released(Key.DRIFT, event)) {
            this.driftPressed = false;
        }

        // Capture a synchronized frame without advancing the race clock.
        if (Input.pressed(Key.PAUSE, event) && !this.pushedPauseThisFrame) {
            this.pushedPauseThisFrame = true;
            const render = new sf.RenderTexture(this.game.getWindow().getSize());
            this.fixedUpdate(sf.seconds(0));
            this.draw(render);
            render.display();
            this.game.pushState(new StateRacePause(this.game, render));
        }
    }

    /** Simulate drivers and collisions, preserve finish order, and finish the race. */
    fixedUpdate(deltaTime: sf.Time): boolean {
        if (this.raceFinished) {
            return true;
        }

        StateRace.currentTime = sf.add(StateRace.currentTime, deltaTime);
        this.pushedPauseThisFrame = false;
        for (let i = 0; i < this.drivers.length; i++) {
            const driver = this.drivers[i];
            driver.update(deltaTime);
            Audio.updateEngine(i, driver.position, driver.height, driver.speedForward, driver.speedTurn);
        }

        // AI item decisions run on their own cadence, not on every physics tick.
        if (StateRace.currentTime.asSeconds() > this.nextItemCheck.asSeconds()) {
            this.nextItemCheck = sf.add(StateRace.currentTime, sf.seconds(1 / Item.UPDATES_PER_SECOND));
            for (const driver of this.drivers) {
                if (driver !== this.player && driver.getPowerUp() !== PowerUps.NONE) {
                    const random = Math.random();
                    const [probability, forward] = Item.getUseProbability(driver, this.positions);
                    if (random < probability / driver.itemProbModifier) {
                        Item.useItem(driver, this.positions, forward);
                    }
                }
            }
        }

        Map.updateObjects(deltaTime);
        Audio.updateListener(this.player.position, this.player.posAngle, this.player.height);

        // Rebuild the dynamic grid after movement and item creation, before resolving hits.
        CollisionHashMap.resetDynamic();
        Map.registerItemObjects();
        for (const driver of this.drivers) {
            CollisionHashMap.registerDynamic(driver);
        }

        const data = new CollisionData();
        for (const driver of this.drivers) {
            if (CollisionHashMap.collide(driver, data)) {
                driver.collisionMomentum = new sf.Vector2f(data.momentum);
                driver.speedForward *= data.speedFactor;
                driver.speedTurn *= data.speedFactor;
                switch (data.type) {
                    case CollisionType.HIT:
                        driver.applyHit();
                        break;
                    case CollisionType.SMASH:
                        driver.applySmash();
                        break;
                    default:
                        if (!driver.isImmune()) {
                            driver.addCoin(-1);
                        }
                        if (driver === this.player && driver.canDrive() && driver.speedForward !== 0) {
                            Audio.play(SFX.CIRCUIT_COLLISION_PIPE);
                        }
                        Map.addEffectSparkles(driver.position);
                        break;
                }
            }
        }

        // Lock the finished prefix and reorder only racers still competing.
        // Splice preserves the array shared with the manager, drivers, and finish overlay.
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
        for (let i = 0; i < this.positions.length; i++) {
            this.positions[i].rank = i;
            if (this.positions[i] === this.player) {
                Gui.setRanking(i + 1);
            }
        }

        Lakitu.update(deltaTime);
        if (FloorObject.applyAllChanges()) {
            Map.updateMinimap();
        }
        EndRanks.update(deltaTime);
        Gui.update(deltaTime);

        // Once seven drivers finish, allow a short grace period for the last racer.
        // A forced finish still waits for the player to be drivable and on the ground.
        if (this.waitForPCTime.asSeconds() === 0 &&
            this.positions[this.positions.length - 2].getLaps() > NUM_LAPS_IN_CIRCUIT) {
            this.waitForPCTime = sf.add(StateRace.currentTime, StateRace.WAIT_FOR_PC_LAST_PLACE);
        }
        if ((this.player.getLaps() > NUM_LAPS_IN_CIRCUIT ||
            (this.waitForPCTime.asSeconds() !== 0 &&
                StateRace.currentTime.asSeconds() > this.waitForPCTime.asSeconds() &&
                this.player.canDrive() && this.player.height === 0)) && !this.raceFinished) {
            this.raceFinished = true;
            CollisionHashMap.resetStatic();
            CollisionHashMap.resetDynamic();
            Audio.stopSFX();
            Audio.play(SFX.CIRCUIT_GOAL_END);
            Audio.setEnginesVolume(75);
            Gui.stopEffects();

            if (this.player.getRank() <= 3) {
                Audio.play(SFX.CIRCUIT_END_VICTORY);
                Audio.playMusic(Music.CIRCUIT_PLAYER_WIN);
            } else {
                Audio.play(SFX.CIRCUIT_END_DEFEAT);
                Audio.playMusic(Music.CIRCUIT_PLAYER_LOSE);
            }

            // Hand control to AI before revealing the preloaded RaceEnd state below us.
            for (const driver of this.drivers) {
                driver.endRaceAndReset();
            }
            Lakitu.showFinish();
            Gui.endRace();
            this.player.controlType = DriverControlType.AI_GRADIENT;
            this.game.popState();
        }
        return true;
    }

    /** Render Mode 7, depth-sorted entities, particles, minimap, and race overlays. */
    draw(window: sf.RenderTarget): void {
        const scale = window.getSize().x / 512;
        const size = this.game.getWindow().getSize();
        const skyBackTexture = new sf.Texture();
        const skyFrontTexture = new sf.Texture();
        const circuitTexture = new sf.Texture();
        const mapTexture = new sf.Texture();
        Map.skyTextures(this.player, skyBackTexture, skyFrontTexture);
        Map.circuitTexture(this.player, circuitTexture);
        Map.mapTexture(mapTexture);

        // The sky and projected road form the world backdrop; shadows sit on the road.
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

        // All world sprites share one back-to-front order, including the player's kart.
        const drawables: [number, sf.Sprite][] = [];
        Map.getWallDrawables(window, this.player, scale, drawables);
        Map.getItemDrawables(window, this.player, scale, drawables);
        Map.getDriverDrawables(window, this.player, this.drivers, scale, drawables);
        this.player.getDrawables(window, scale, drawables);
        drawables.sort((left, right) => right[0] - left[0]);
        for (const [, sprite] of drawables) {
            window.draw(sprite);
        }

        if (this.player.height === 0 &&
            this.player.speedForward > this.player.vehicle.maxNormalLinearSpeed / 4) {
            const small = this.player.animator.smallTime.asSeconds() > 0 ||
                this.player.animator.smashTime.asSeconds() > 0;
            this.player.animator.drawParticles(window, this.player.getSprite(), small, this.player.position);
        }

        // The lower minimap has its own screen-space order, independent of race rank.
        currentHeight += size.y * Map.CIRCUIT_HEIGHT_PCT;
        map.setPosition(new sf.Vector2f(0, currentHeight));
        window.draw(map);
        this.miniDrivers.sort((left, right) => left.position.y - right.position.y);
        for (const driver of this.miniDrivers) {
            if (!driver.isVisible() && driver !== this.player) {
                continue;
            }
            const sprite = driver.animator.getMinimapSprite(driver.posAngle + driver.speedTurn * 0.2, scale);
            const mapPosition = Map.mapCoordinates(driver.position);
            const bounds = sprite.getLocalBounds();
            sprite.setOrigin(new sf.Vector2f(bounds.size.x / 2, bounds.size.y * 0.9));
            sprite.setPosition(new sf.Vector2f(mapPosition.x * size.x, mapPosition.y * size.y));
            sprite.scale(new sf.Vector2f(0.5, 0.5));
            window.draw(sprite);
        }

        // Screen-space overlays stay above both views; the grace timer tints the HUD red.
        Lakitu.draw(window);
        const pctGB = Math.max(0, (this.waitForPCTime.asSeconds() - StateRace.currentTime.asSeconds()) *
            255 / StateRace.WAIT_FOR_PC_LAST_PLACE.asSeconds());
        Gui.draw(window, this.waitForPCTime.asSeconds() === 0
            ? sf.Color.White : new sf.Color(255, Math.trunc(pctGB), Math.trunc(pctGB)));
        EndRanks.draw(window);
    }

    /** State stack diagnostic name. */
    string(): string {
        return "Race";
    }
}
