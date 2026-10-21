import * as sf from "sfml.js";
import type { Game } from "../game";
import { AIGradientDescent } from "../ai/gradientdescent";
import { CollisionData, CollisionType } from "../entities/collisiondata";
import { CollisionHashMap } from "../entities/collisionhashmap";
import { Driver } from "../entities/driver";
import { DRIVER_ASSET_NAMES, DRIVER_PROPERTIES, DriverControlType, MenuPlayer, PowerUps } from "../entities/enums";
import { Item } from "../entities/item";
import { VehicleProperties } from "../entities/vehicleproperties";
import { Color, TextUtils } from "../gui/textutils";
import { MAP_ASSETS_HEIGHT, MAP_ASSETS_WIDTH } from "../map/enums";
import { FloorObject } from "../map/floorobject";
import { Map } from "../map/map";
import { StateRace } from "./race";
import { State } from "./statebase";

/** Attract-mode race, credits, and the original interactive camera/item controls. */
export class StateRaceDemo extends State {
    private readonly drivers: Driver[] = [];
    private readonly miniDrivers: Driver[] = [];
    private readonly positions: Driver[] = [];

    /** Invisible driver used as a camera, separate from the racer being followed. */
    private pseudoPlayer!: Driver;
    private currentTarget = 0;
    private targetDirection = 0;
    private nextSwitchTime = sf.Time.Zero;
    private nextQPTime = sf.Time.Zero;
    private nextItemCheck = sf.Time.Zero;

    private autoUseItems = true;
    private fixCamera = false;
    private firstPersonCamera = false;
    private showMessageTime = sf.Time.Zero;
    private showMessage = "";
    private raceFinished = false;
    private fadeFinished = false;
    private fadeTime = sf.Time.Zero;

    /** Use the Start state's already-loaded random course and await all drivers. */
    constructor(game: Game) {
        super(game);
        this.ready = this.init();
    }

    private selectRandomTarget(): void {
        this.targetDirection = (this.nextSwitchTime.asMilliseconds() % 360) * Math.PI / 180;
        const lastTarget = this.currentTarget;
        while (this.currentTarget === lastTarget) {
            this.currentTarget = Math.floor(Math.random() * this.drivers.length);
        }
        this.nextSwitchTime = sf.add(StateRace.currentTime, sf.seconds(8));
    }

    /** Distribute all eight AI characters along the original gradient path. */
    async init(): Promise<void> {
        StateRace.currentTime = sf.seconds(0);
        this.nextItemCheck = sf.Time.Zero;
        this.fadeTime = sf.Time.Zero;
        this.autoUseItems = true;
        this.fixCamera = false;
        this.firstPersonCamera = false;
        this.showMessageTime = sf.Time.Zero;
        VehicleProperties.setScaleFactor(2, 1);

        this.pseudoPlayer = new Driver(
            "assets/drivers/invisible.png", new sf.Vector2f(), -Math.PI / 2,
            MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT, DriverControlType.DISABLED,
            VehicleProperties.GODMODE, MenuPlayer.MARIO,
        );

        // Space racers along the gradient route rather than using the starting grid.
        const start = Map.getPlayerInitialPosition(1);
        const position = new sf.Vector2f(start.x / MAP_ASSETS_WIDTH, start.y / MAP_ASSETS_HEIGHT);
        for (let i = 0; i < MenuPlayer.__COUNT; i++) {
            while (Math.floor(Math.random() * 7) !== 0) {
                const direction = AIGradientDescent.getNextDirection(position);
                position.x += direction.x;
                position.y += direction.y;
            }
            const direction = AIGradientDescent.getNextDirection(position);
            const driver = new Driver(
                DRIVER_ASSET_NAMES[i], new sf.Vector2f(), 0,
                MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT, DriverControlType.AI_GRADIENT,
                DRIVER_PROPERTIES[i], i, this.positions,
            );
            driver.setPositionAndReset(new sf.Vector2f(position), Math.atan2(direction.y, direction.x));
            this.drivers.push(driver);
            this.miniDrivers.push(driver);
            this.positions.push(driver);
        }
        await Promise.all([this.pseudoPlayer.ready, ...this.drivers.map(driver => driver.ready)]);
    }

    /** Preserve number-key powerups, Tab targeting, modifiers, and any-key exit. */
    handleEvent(event: sf.Event): void {
        const key = event.getIf("KeyPressed");
        if (!key) {
            return;
        }

        // Demo controls consume their keys; any other key starts the exit fade.
        if (key.code >= sf.KeyboardKey.Num1 && key.code <= sf.KeyboardKey.Num7) {
            const item = (key.code - sf.KeyboardKey.Num0) as PowerUps;
            for (const driver of this.drivers) {
                driver.pickUpPowerUp(item);
                if (this.autoUseItems) {
                    Item.useItem(driver, this.positions, true, true);
                }
            }
        } else if (key.code === sf.KeyboardKey.Tab) {
            this.selectRandomTarget();
        } else if (key.code === sf.KeyboardKey.LAlt) {
            this.autoUseItems = !this.autoUseItems;
            this.showMessage = `auto use items > ${this.autoUseItems ? "on" : "off"}`;
            this.showMessageTime = sf.add(StateRace.currentTime, sf.seconds(2));
        } else if (key.code === sf.KeyboardKey.LControl) {
            this.fixCamera = !this.fixCamera;
            this.showMessage = `fix camera > ${this.fixCamera ? "on" : "off"}`;
            this.showMessageTime = sf.add(StateRace.currentTime, sf.seconds(2));
        } else if (key.code === sf.KeyboardKey.Space) {
            this.firstPersonCamera = !this.firstPersonCamera;
            this.showMessage = `first person camera > ${this.firstPersonCamera ? "on" : "off"}`;
            this.showMessageTime = sf.add(StateRace.currentTime, sf.seconds(2));
        } else if (!this.raceFinished) {
            this.raceFinished = true;
            this.fadeTime = sf.Time.Zero;
        }
    }

    /** Advance the demo race, target camera, question panels, and collision grid. */
    fixedUpdate(deltaTime: sf.Time): boolean {
        StateRace.currentTime = sf.add(StateRace.currentTime, deltaTime);
        this.fadeTime = sf.add(this.fadeTime, deltaTime);

        // Pop both demo and old title once; InitLoad then creates a fresh title setup.
        if (this.raceFinished && this.fadeTime.asSeconds() >= 0.5) {
            if (!this.fadeFinished) {
                this.fadeFinished = true;
                CollisionHashMap.resetStatic();
                CollisionHashMap.resetDynamic();
                this.game.popState();
                this.game.popState();
            }
            return true;
        }

        for (const driver of this.drivers) {
            driver.update(deltaTime);
        }

        // Automatic item use follows only the current camera target in attract mode.
        const now = StateRace.currentTime.asSeconds();
        if (now > this.nextItemCheck.asSeconds()) {
            this.nextItemCheck = sf.add(StateRace.currentTime, sf.seconds(1 / Item.UPDATES_PER_SECOND));
            for (let i = 0; i < this.drivers.length; i++) {
                const driver = this.drivers[i];
                if (i === this.currentTarget && driver.getPowerUp() !== PowerUps.NONE) {
                    const random = Math.random();
                    const [probability, forward] = Item.getUseProbability(driver, this.positions);
                    if (random < probability) {
                        Item.useItem(driver, this.positions, forward);
                    }
                }
            }
        }

        Map.updateObjects(deltaTime);
        if (now > this.nextQPTime.asSeconds()) {
            this.nextQPTime = sf.add(StateRace.currentTime, sf.seconds(2));
            Map.reactivateQuestionPanels();
        }
        if (!this.fixCamera && now > this.nextSwitchTime.asSeconds()) {
            this.selectRandomTarget();
        }

        const target = this.drivers[this.currentTarget];
        if (this.firstPersonCamera) {
            // Copy coordinates so camera changes cannot move the actual racer.
            this.pseudoPlayer.position = new sf.Vector2f(target.position);
            this.pseudoPlayer.posAngle = target.posAngle;
        } else {
            const targetPosition = new sf.Vector2f(
                target.position.x + Math.cos(this.targetDirection) * 0.05,
                target.position.y + Math.sin(this.targetDirection) * 0.05,
            );
            this.pseudoPlayer.position.x += (targetPosition.x - this.pseudoPlayer.position.x) * 0.03;
            this.pseudoPlayer.position.y += (targetPosition.y - this.pseudoPlayer.position.y) * 0.03;

            // Unwrap the desired angle before easing, avoiding a full turn across ±π.
            let targetAngle = Math.atan2(
                target.position.y - this.pseudoPlayer.position.y,
                target.position.x - this.pseudoPlayer.position.x,
            );
            const angle = this.pseudoPlayer.posAngle;
            while (Math.abs(targetAngle - angle) > Math.abs(targetAngle + 2 * Math.PI - angle)) {
                targetAngle += 2 * Math.PI;
            }
            while (Math.abs(targetAngle - angle) > Math.abs(targetAngle - angle - 2 * Math.PI)) {
                targetAngle -= 2 * Math.PI;
            }
            this.pseudoPlayer.posAngle += (targetAngle - angle) * 0.1;
        }

        // Rankings remain shared with drivers and item targeting.
        this.positions.sort((left, right) => left.getLaps() === right.getLaps()
            ? left.getLastGradient() - right.getLastGradient()
            : right.getLaps() - left.getLaps());
        for (let i = 0; i < this.positions.length; i++) {
            this.positions[i].rank = i;
        }

        // Register positions after movement, then resolve collisions against that snapshot.
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
                        Map.addEffectSparkles(driver.position);
                        break;
                }
            }
        }

        if (FloorObject.applyAllChanges()) {
            Map.updateMinimap();
        }
        return true;
    }

    /** Render the letterboxed demo with original credits and fade overlays. */
    draw(window: sf.RenderTarget): void {
        const scale = window.getSize().x / 512;
        const size = this.game.getWindow().getSize();
        const padTop = Map.SKY_HEIGHT_PCT * 1.5 * size.y;
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

        // World sprites receive the same letterbox offset as the sky and road.
        const drawables: [number, sf.Sprite][] = [];
        Map.getWallDrawables(window, this.pseudoPlayer, scale, drawables);
        Map.getItemDrawables(window, this.pseudoPlayer, scale, drawables);
        Map.getDriverDrawables(window,
            this.firstPersonCamera ? this.drivers[this.currentTarget] : this.pseudoPlayer,
            this.drivers, scale, drawables);
        if (this.firstPersonCamera) {
            this.drivers[this.currentTarget].getDrawables(window, scale, drawables);
        }
        drawables.sort((left, right) => right[0] - left[0]);
        for (const [, sprite] of drawables) {
            sprite.move(new sf.Vector2f(0, padTop));
            window.draw(sprite);
        }

        // Mask world overflow before adding credits and transient camera-control messages.
        const black = new sf.RectangleShape(new sf.Vector2f(size.x, size.y));
        black.setFillColor(sf.Color.Black);
        black.setPosition(new sf.Vector2f(0, currentHeight));
        window.draw(black);
        black.setSize(new sf.Vector2f(size.x, padTop));
        black.setPosition(new sf.Vector2f());
        window.draw(black);

        const credits: readonly [string, number, number][] = [
            ["super mario kart", 58, 12],
            ["javier gimenez", 52, 156],
            ["victor martinez", 52, 168],
            ["diego royo", 52, 180],
            ["unizar      2020", 48, 204],
        ];
        for (const [text, x, y] of credits) {
            TextUtils.write(window, text, new sf.Vector2f(x / 256 * size.x, y / 224 * size.y), scale * 2);
        }

        let messagePct = 0;
        const now = StateRace.currentTime.asSeconds();
        if (this.showMessageTime.asSeconds() > now) {
            messagePct = 1;
        } else if (this.showMessageTime.asSeconds() > now + 2) {
            messagePct = 1 - (now - this.showMessageTime.asSeconds()) / 2;
        }
        if (messagePct > 0) {
            const color = new sf.Color(Color.MenuPrimary);
            color.a = Math.trunc(Math.min(messagePct * 255, 255));
            TextUtils.write(window, this.showMessage, new sf.Vector2f(size.x * 0.5, size.y * 0.25),
                scale * 2, color, true, TextUtils.TextAlign.CENTER, TextUtils.TextVerticalAlign.MIDDLE);
        }

        if (this.fadeTime.asSeconds() < 0.5 || this.fadeFinished) {
            let pct = this.fadeTime.asSeconds() / 0.5;
            if (!this.raceFinished) {
                pct = 1 - pct;
            }
            if (this.fadeFinished) {
                pct = 1;
            }
            black.setSize(new sf.Vector2f(size.x, size.y));
            black.setFillColor(new sf.Color(0, 0, 0, Math.trunc(Math.min(pct * 255, 255))));
            window.draw(black);
        }
    }

    /** State stack diagnostic name. */
    string(): string {
        return "RaceDemo";
    }
}
