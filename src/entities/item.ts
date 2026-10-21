import * as sf from 'sfml.js';
import type { Driver } from './driver';
import { DriverControlType, PowerUps } from './enums';
import type { RaceRankingArray } from './enums';
import { WallObject } from './wallobject';
import {
    MAP_ASSETS_HEIGHT, MAP_ASSETS_WIDTH, MAP_TILES_HEIGHT, MAP_TILES_WIDTH,
    NUM_LAPS_IN_CIRCUIT,
} from '../map/enums';
import { Audio, SFX } from '../audio/audio';

/** Shared item references retain the original pointer-style ownership. */
export type ItemPtr = Item;
/** Probability of using an item and whether it should be thrown forward. */
export type AIItemProb = [number, boolean];

/** Common lifetime, rendering, and AI strategy for items and transient effects. */
export abstract class Item extends WallObject {
    private static readonly THUNDER_INITIAL_DURATION = sf.seconds(5);
    private static readonly THUNDER_INCREMENT_DURATION = sf.seconds(1.5);

    protected sprite = new sf.Sprite(new sf.Texture());

    /** Number of item-use AI decisions per second. */
    static readonly UPDATES_PER_SECOND = 15;
    /** True when the map should remove and dispose this item. */
    used = false;

    /** Initialize an item from source pixel coordinates. */
    constructor(position: sf.Vector2f, visualRadius: number, hitboxRadius: number, height: number) {
        super(position, visualRadius, hitboxRadius, height, MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT);
    }

    /** Apply the user's current power-up and clear it after successful use. */
    static useItem(
        user: Driver,
        ranking: RaceRankingArray,
        isFront: boolean,
        forceUse = false,
    ): void {
        // Resolve subclasses only after Item exists to avoid CommonJS inheritance cycles.
        const { Gui } = require('../gui/gui') as typeof import('../gui/gui');
        const { Map } = require('../map/map') as typeof import('../map/map');
        const powerup = user.getPowerUp();
        const isPlayer = user.controlType === DriverControlType.PLAYER;
        if (powerup === PowerUps.NONE ||
            (!forceUse && (!user.canUsePowerUp() ||
                (isPlayer && !Gui.canUseItem()) || !user.canDrive() || user.onLakitu))) {
            return;
        }

        switch (powerup) {
            case PowerUps.BANANA: {
                const { Banana } = require('./banana') as typeof import('./banana');
                if (isPlayer) {
                    Audio.play(isFront ? SFX.CIRCUIT_ITEM_USE_LAUNCH : SFX.CIRCUIT_ITEM_USE_DOWN);
                }
                Map.addItem(new Banana(user.position, user.posAngle, isFront, user.height));
                break;
            }
            case PowerUps.COIN:
                user.addCoin(2);
                break;
            case PowerUps.GREEN_SHELL: {
                const { GreenShell } = require('./greenshell') as typeof import('./greenshell');
                if (isPlayer) {
                    Audio.play(isFront ? SFX.CIRCUIT_ITEM_USE_UP : SFX.CIRCUIT_ITEM_USE_DOWN);
                }
                Map.addItem(new GreenShell(user.position, user.posAngle, isFront, user.height));
                break;
            }
            case PowerUps.RED_SHELL: {
                const { RedShell } = require('./redshell') as typeof import('./redshell');
                if (isPlayer) {
                    Audio.play(isFront ? SFX.CIRCUIT_ITEM_USE_UP : SFX.CIRCUIT_ITEM_USE_DOWN);
                }

                // Forward targeting uses race order, not spatial proximity; the leader has no target.
                let found = false;
                for (let i = 1; i < ranking.length; i++) {
                    if (ranking[i] === user) {
                        Map.addItem(new RedShell(
                            user.position, ranking[i - 1], user.posAngle, isFront, user.height,
                        ));
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    Map.addItem(new RedShell(
                        user.position, null, user.posAngle, isFront, user.height,
                    ));
                }
                break;
            }
            case PowerUps.MUSHROOM:
                if (isPlayer) {
                    Audio.play(SFX.CIRCUIT_ITEM_MUSHROOM);
                }
                user.applyMushroom();
                break;
            case PowerUps.STAR:
                user.applyStar();
                break;
            case PowerUps.THUNDER: {
                // Walk from the user toward the leader; only affected racers extend the duration.
                let currentDuration = sf.seconds(Item.THUNDER_INITIAL_DURATION.asSeconds());
                let apply = false;
                for (let i = ranking.length - 1; i >= 0; i--) {
                    const driver = ranking[i];
                    if (!apply && driver === user) {
                        apply = true;
                    } else if (apply && !driver.isImmune()) {
                        driver.applyThunder(currentDuration);
                        currentDuration = sf.add(currentDuration, Item.THUNDER_INCREMENT_DURATION);
                    }
                }
                Audio.play(SFX.CIRCUIT_ITEM_THUNDER);
                Gui.thunder();
                break;
            }
            default:
                console.error('Error: tried to use item without effect');
                break;
        }

        // Clearing the held item also restarts the driver's item-use cooldown.
        user.pickUpPowerUp(PowerUps.NONE);
        if (isPlayer) {
            Gui.setPowerUp(PowerUps.NONE);
        }
    }

    /** Evaluate the original per-power-up heuristic without sampling randomness. */
    static getUseProbability(user: Driver, ranking: RaceRankingArray): AIItemProb {
        switch (user.getPowerUp()) {
            case PowerUps.NONE:
                return [-1, false];
            case PowerUps.BANANA:
                return strategyBanana(user, ranking);
            case PowerUps.COIN:
                return [user.getCoins() > 8 ? strategyLowest() : strategyHighest(), true];
            case PowerUps.GREEN_SHELL:
                return strategyUserInFront(user, ranking);
            case PowerUps.MUSHROOM:
            case PowerUps.STAR:
                return strategySlowOrStraightLine(user);
            case PowerUps.RED_SHELL:
                return strategyUseWhenFarFromNextInRanking(user, ranking);
            case PowerUps.THUNDER:
                return [
                    strategyLowest() + strategyHighest() * scaleProbability(user.rank / 7),
                    true,
                ];
            default:
                console.error('Error: unrecognized item in Item::getUseProbability');
                return [1, true];
        }
    }

    /** Advance item motion and lifetime. */
    abstract override update(deltaTime: sf.Time): void;

    /** Return the current billboard sprite by reference. */
    getSprite(): sf.Sprite {
        return this.sprite;
    }

    /** Effects do not enter the collision grid unless a subclass opts in. */
    registersCollisions(): boolean {
        return false;
    }

    /** Release lifetime-bound resources when the map removes the item. */
    dispose(): void {}

    /** Return the original entity debug name. */
    abstract name(): string;

    /** Describe this item using a stable identity in place of a native address. */
    string(): string {
        return `${this.name()} (${this.identity}) at ${this.position.x.toFixed(6)}, ${this.position.y.toFixed(6)}`;
    }

    private static nextIdentity = 1;
    private readonly identity = Item.nextIdentity++;
}

function strategyHighest(): number {
    return 0.6;
}

function strategyLowest(): number {
    // Per-decision probability giving a 50% chance of use over 30 seconds at the AI cadence.
    return 1 - Math.pow(1 - 0.5, 1 / (30 * Item.UPDATES_PER_SECOND));
}

function scaleProbability(percent: number, factor = 0.45): number {
    // Thresholds approach one geometrically, reserving the highest chances for near-perfect scores.
    let base = factor;
    for (let i = 10; i >= 1; i--) {
        if (percent < base) {
            return 1 / i - 0.1;
        }
        base += (1 - base) * factor;
    }
    return 1;
}

function normalizeAngle(angle: number): number {
    angle %= 2 * Math.PI;
    if (angle < -Math.PI) {
        angle += 2 * Math.PI;
    }
    if (angle > Math.PI) {
        angle -= 2 * Math.PI;
    }
    return angle;
}

function strategySlowOrStraightLine(user: Driver): AIItemProb {
    if (user.speedForward / user.vehicle.maxNormalLinearSpeed < 0.3) {
        return [strategyHighest(), true];
    }

    // Alignment with a ten-step route preview estimates whether a boost is safe to spend.
    const { AIGradientDescent } = require('../ai/gradientdescent') as typeof import('../ai/gradientdescent');
    let delta = new sf.Vector2f(0, 0);
    for (let i = 0; i < 10; i++) {
        delta = sf.add(delta, AIGradientDescent.getNextDirection(sf.add(user.position, delta)));
    }
    const angleDiff = normalizeAngle(Math.atan2(delta.y, delta.x) - user.posAngle);
    return [
        strategyLowest() + strategyHighest() * scaleProbability(1 - Math.abs(angleDiff / Math.PI)),
        true,
    ];
}

function strategyBanana(user: Driver, ranking: RaceRankingArray): AIItemProb {
    // Try a nearby trailing racer before considering a forward throw.
    const userPos = user.rank;
    for (let i = userPos + 1, j = 0; i < ranking.length && j < 3; i++, j++) {
        const target = ranking[i];
        const distance: sf.Vector2f = sf.subtract(target.position, user.position);
        const module2 = distance.x ** 2 + distance.y ** 2;
        if (module2 > 0.01) {
            continue;
        }
        const angleDiff = normalizeAngle(Math.atan2(distance.y, distance.x) - target.posAngle * -1);
        if (Math.abs(angleDiff) * module2 < Math.PI / 4 * 0.004) {
            return [
                strategyHighest() * scaleProbability(1 - Math.abs(angleDiff / Math.PI), 0.25),
                false,
            ];
        }
    }

    const { AIGradientDescent } = require('../ai/gradientdescent') as typeof import('../ai/gradientdescent');
    // Fixed throw-range estimate in normalized map units, tested against predicted route tiles.
    const bananaTravelDistance = 0.20155464379;
    const bananaPos = new sf.Vector2f(
        user.position.x + Math.cos(user.posAngle) * bananaTravelDistance,
        user.position.y + Math.sin(user.posAngle) * bananaTravelDistance,
    );

    // The unsigned subtraction skips this search for ranks zero and one.
    for (let i = (userPos - 2) >>> 0, j = 0; i < ranking.length && j < 5; i++, j++) {
        if (i === userPos) {
            continue;
        }
        const target = ranking[i];
        const distance: sf.Vector2f = sf.subtract(target.position, user.position);
        if (distance.x ** 2 + distance.y ** 2 > 0.04) {
            continue;
        }

        let pos = new sf.Vector2f(target.position);
        for (let k = 0; k < 3; k++) {
            pos = sf.add(pos, AIGradientDescent.getNextDirection(pos));
        }
        for (let k = 0; k < 15; k++) {
            pos = sf.add(pos, AIGradientDescent.getNextDirection(pos));
            if (Math.abs(bananaPos.x - pos.x) < 1 / MAP_TILES_WIDTH &&
                Math.abs(bananaPos.y - pos.y) < 1 / MAP_TILES_HEIGHT) {
                return [strategyHighest(), true];
            }
        }
    }
    return [strategyLowest(), false];
}

function strategyUserInFront(user: Driver, ranking: RaceRankingArray): AIItemProb {
    const checkAngle = (target: Driver, maxDistance2: number, wantedAngle: number): number => {
        const distance: sf.Vector2f = sf.subtract(target.position, user.position);
        const module2 = distance.x ** 2 + distance.y ** 2;
        if (module2 > maxDistance2) {
            return 2 * Math.PI * module2;
        }

        // Lead farther for faster, more distant targets; this is a heuristic, not an intercept solve.
        const movementScale = target.speedForward * Math.sqrt(module2);
        const shellPos = new sf.Vector2f(
            target.position.x + Math.cos(target.posAngle) * movementScale,
            target.position.y + Math.sin(target.posAngle) * movementScale,
        );
        const throwDelta = sf.subtract(shellPos, user.position);
        return normalizeAngle(Math.atan2(throwDelta.y, throwDelta.x) - wantedAngle) * module2;
    };

    // Prefer a backward shot at the following racer before checking the racer ahead.
    const userPos = user.rank;
    if (userPos !== ranking.length - 1) {
        const angleBackwards = checkAngle(ranking[userPos + 1], 0.015, user.posAngle * -1);
        if (angleBackwards < Math.PI / 4 * 0.004) {
            return [
                strategyHighest() * scaleProbability(1 - Math.abs(angleBackwards / Math.PI), 0.3),
                false,
            ];
        }
    }

    if (userPos === 0) {
        return [strategyLowest(), false];
    }
    const angleForwards = checkAngle(ranking[userPos - 1], 0.025, user.posAngle);
    if (angleForwards > Math.PI) {
        return [strategyLowest(), false];
    }
    return [
        strategyHighest() * scaleProbability(1 - Math.abs(angleForwards / Math.PI), 0.55),
        true,
    ];
}

function strategyUseWhenFarFromNextInRanking(user: Driver, ranking: RaceRankingArray): AIItemProb {
    if (user.rank === 0) {
        return [strategyLowest(), false];
    }
    if (user.getLaps() === NUM_LAPS_IN_CIRCUIT) {
        return [strategyHighest(), true];
    }

    const target = ranking[user.rank - 1];
    const distance: sf.Vector2f = sf.subtract(target.position, user.position);
    const maxDiff = 0.1;
    const modDiff = Math.min(maxDiff, Math.sqrt(Math.max(1e-12, distance.x ** 2 + distance.y ** 2)));
    return [strategyHighest() * scaleProbability(modDiff / maxDiff), true];
}
