import * as sf from 'sfml.js';
import { Item } from './item';
import { WallObject } from './wallobject';
import { CollisionType } from './collisiondata';
import type { CollisionData } from './collisiondata';
import type { Driver } from './driver';
import { DriverControlType } from './enums';
import { Audio, SFX } from '../audio/audio';
import { AIGradientDescent } from '../ai/gradientdescent';
import { MAP_ASSETS_WIDTH, MapLand } from '../map/enums';
import { Map } from '../map/map';

/** A gradient-following shell that homes directly onto nearby targets. */
export class RedShell extends Item {
    private static readonly SPEED = 75;
    private static readonly HITBOX_RADIUS = 4;
    private static readonly MAX_HEIGHT = 8;
    private static readonly TIME_OF_FLIGHT = sf.seconds(0.5);
    private static assetShell = new sf.Texture();
    private static numRedShellsFollowingPlayer = 0;
    private followingPlayer: boolean;
    private target: Driver | null;
    private inactiveFrames = 10;
    private speed: sf.Vector2f;
    private flightRemainingTime: sf.Time;
    private lastDirection: sf.Vector2f;
    private gradientWhenRamp: number;
    private disposed = false;

    /** Preload the red-shell region. */
    static override async loadAssets(assetName: string, roi: sf.IntRect): Promise<void> {
        if (!await RedShell.assetShell.loadFromFile(assetName, false, roi)) {
            throw new Error(`Unable to load red shell: ${assetName}`);
        }
    }

    /** Spawn a targeted forward shell or an untargeted backward shell. */
    constructor(
        position: sf.Vector2f,
        target: Driver | null,
        forwardAngle: number,
        forwardThrow: boolean,
        playerHeight: number,
    ) {
        super(new sf.Vector2f(0, 0), 0.05, RedShell.HITBOX_RADIUS, playerHeight);
        const { Driver } = require('./driver') as typeof import('./driver');
        const angle = forwardThrow ? forwardAngle : forwardAngle + Math.PI;
        const factor = (RedShell.HITBOX_RADIUS + Driver.HITBOX_RADIUS + 0.1) / MAP_ASSETS_WIDTH;
        const forward = new sf.Vector2f(Math.cos(angle) * factor, Math.sin(angle) * factor);
        this.position = sf.add(position, forward);
        this.speed = sf.multiply(forward, RedShell.SPEED);
        this.target = forwardThrow ? target : null;

        if (playerHeight === 0) {
            this.flightRemainingTime = sf.seconds(0);
            this.lastDirection = new sf.Vector2f(0, 0);
            this.gradientWhenRamp = -1;
        } else {
            this.flightRemainingTime = new sf.Time(RedShell.TIME_OF_FLIGHT);
            this.lastDirection = new sf.Vector2f(Math.cos(angle) * 0.3, Math.sin(angle) * 0.3);
            this.gradientWhenRamp = AIGradientDescent.getPositionValue(this.position);
        }

        this.followingPlayer = this.target !== null &&
            this.target.controlType === DriverControlType.PLAYER;

        // The looping warning is shared by every shell targeting the player.
        if (this.followingPlayer) {
            RedShell.numRedShellsFollowingPlayer++;
            Audio.play(SFX.CIRCUIT_ITEM_RED_SHELL, true);
        }

        this.sprite = new sf.Sprite(RedShell.assetShell);
        const size = RedShell.assetShell.getSize();
        this.sprite.setOrigin(new sf.Vector2f(size.x / 2, size.y));
    }

    /** Perform deterministic destructor cleanup when the map releases this shell. */
    override dispose(): void {
        if (this.disposed) {
            return;
        }

        // Balance the constructor's registration exactly once, even if cleanup is repeated.
        this.disposed = true;
        if (this.followingPlayer && --RedShell.numRedShellsFollowingPlayer === 0) {
            Audio.stop(SFX.CIRCUIT_ITEM_RED_SHELL);
        }
    }

    /** Advance homing, ramp flight, terrain expiration, and collision grace frames. */
    override update(deltaTime: sf.Time): void {
        // Grace is counted in simulation updates, not elapsed seconds.
        if (this.inactiveFrames > 0) {
            this.inactiveFrames--;
        }

        if (this.target === null) {
            this.position = sf.add(this.position, sf.multiply(this.speed, deltaTime.asSeconds()));
        } else {
            let direction = sf.subtract(this.target.position, this.position);
            const distance = Math.sqrt(Math.max(1e-12, direction.x ** 2 + direction.y ** 2));
            if (distance < 0.08) {
                // Nearby homing closes half the gap per update, independent of travel speed.
                this.position = sf.add(this.position, sf.multiply(direction, 0.5));
            } else {
                direction = new sf.Vector2f(0, 0);
                if (this.flightRemainingTime.asMicroseconds() <= 0n) {
                    // Sum a short route preview; any non-track tile ends look-ahead after the first step.
                    for (let i = 0; i < 3; i++) {
                        const land = Map.getLand(sf.add(this.position, direction));
                        if (i > 0 && land !== MapLand.TRACK) {
                            break;
                        }
                        direction = sf.add(direction,
                            AIGradientDescent.getNextDirection(sf.add(this.position, direction)));
                    }

                    direction = sf.divide(direction,
                        Math.sqrt(Math.max(1e-12, direction.x ** 2 + direction.y ** 2)));
                    direction = sf.multiply(direction, 0.3);
                    this.lastDirection = new sf.Vector2f(direction);
                } else {
                    // Ramp flight retains its launch direction instead of following the ground route.
                    direction = new sf.Vector2f(this.lastDirection);
                }
                this.position = sf.add(this.position, sf.multiply(direction, 1.4 * deltaTime.asSeconds()));
            }
        }

        if (this.flightRemainingTime.asMicroseconds() > 0n) {
            // The first half always elapses; descent waits for a valid gradient at or past takeoff.
            const currentGradient = AIGradientDescent.getPositionValue(this.position);
            if ((currentGradient >= 0 && currentGradient <= this.gradientWhenRamp) ||
                this.flightRemainingTime.asSeconds() > RedShell.TIME_OF_FLIGHT.asSeconds() / 2) {
                this.flightRemainingTime = sf.subtract(this.flightRemainingTime, deltaTime);
            }
        }

        const land = Map.getLand(this.position);
        if (land === MapLand.BLOCK) {
            if (this.flightRemainingTime.asMicroseconds() <= 0n) {
                this.used = true;
                Map.addEffectBreak(this);
            }
        } else if (land === MapLand.RAMP_HORIZONTAL || land === MapLand.RAMP_VERTICAL) {
            if (this.flightRemainingTime.asMicroseconds() <= 0n) {
                this.flightRemainingTime = new sf.Time(RedShell.TIME_OF_FLIGHT);
                this.gradientWhenRamp = AIGradientDescent.getPositionValue(this.position);

                if (land === MapLand.RAMP_HORIZONTAL) {
                    this.lastDirection.x = 0;
                    this.lastDirection.y = this.lastDirection.y < 0 ? -0.3 : 0.3;
                } else {
                    this.lastDirection.x = this.lastDirection.x < 0 ? -0.3 : 0.3;
                    this.lastDirection.y = 0;
                }
            }
        } else if (land === MapLand.OUTER) {
            if (this.flightRemainingTime.asMicroseconds() <= 0n) {
                this.used = true;
                Map.addEffectDrown(this.position);
            }
        } else if (this.position.x < 0 || this.position.x > 1 ||
            this.position.y < 0 || this.position.y > 1) {
            this.used = true;
        }

        if (this.flightRemainingTime.asMicroseconds() > 0n) {
            // A triangular height profile, not ballistic gravity, follows the remaining flight time.
            this.height = RedShell.MAX_HEIGHT *
                (0.5 - Math.abs(this.flightRemainingTime.asSeconds() /
                    RedShell.TIME_OF_FLIGHT.asSeconds() - 0.5));
        }
    }

    /** Hit drivers only after the grace period and at matching height. */
    override solveCollision(
        data: CollisionData,
        _otherSpeed: sf.Vector2f,
        _otherPos: sf.Vector2f,
        _otherWeight: number,
        otherHeight: number,
        otherIsImmune: boolean,
        _distance2: number,
    ): boolean {
        if (WallObject.collisionHasHeightDifference(this.height, otherHeight)) {
            return false;
        }
        if (this.used || this.inactiveFrames > 0) {
            return false;
        }

        if (otherIsImmune) {
            this.used = true;
            Map.addEffectBreak(this);
            data.momentum = new sf.Vector2f(0, 0);
            data.speedFactor = 1;
            data.type = CollisionType.NO_HIT;
            return true;
        }

        data.momentum = new sf.Vector2f(0, 0);
        data.speedFactor = 0.4;
        data.type = CollisionType.HIT;
        this.used = true;
        Map.addEffectBreak(this);

        // A hit ends this warning immediately; map disposal still balances the shared shell count.
        if (this.target !== null && this.target.controlType === DriverControlType.PLAYER && this.used) {
            Audio.stop(SFX.CIRCUIT_ITEM_RED_SHELL);
        }
        return true;
    }

    /** Red shells enter the dynamic collision grid. */
    override registersCollisions(): boolean {
        return true;
    }

    /** Original debug name. */
    name(): string {
        return 'RedShell';
    }
}
