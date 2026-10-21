import * as sf from 'sfml.js';
import { AIGradientDescent } from '../ai/gradientdescent';
import { Audio, Music, SFX } from '../audio/audio';
import { Gui } from '../gui/gui';
import { Input, Key } from '../input/input';
import {
    MAP_ASSETS_HEIGHT, MAP_ASSETS_WIDTH, MAP_TILE_SIZE,
    MAP_TILES_HEIGHT, MAP_TILES_WIDTH, MapLand,
} from '../map/enums';
import { Map } from '../map/map';
import { StateRace } from '../states/race';
import { CollisionData, CollisionType } from './collisiondata';
import { CollisionHashMap } from './collisionhashmap';
import { DriverAnimator } from './driveranimator';
import { DriverControlType, MenuPlayer, PowerUps, type RaceRankingArray } from './enums';
import { Lakitu } from './lakitu';
import { VehicleProperties } from './vehicleproperties';
import { WallObject } from './wallobject';

/** Object reference replacing the original shared driver pointer. */
export type DriverPtr = Driver;

/** Combinable timed kart effects; NORMAL and _COUNT are not effect bits. */
export enum DriverState {
    /** No timed effects are active. */
    NORMAL = 0,
    /** Mushroom or zipper boost using the boosted speed cap. */
    SPEED_UP = 1,
    /** Extra AI zipper boost above the normal boosted speed cap. */
    MORE_SPEED_UP = 2,
    /** Lightning slowdown using the reduced speed cap. */
    SPEED_DOWN = 4,
    /** Star immunity with increased acceleration and speed. */
    STAR = 8,
    /** Spin-out that temporarily prevents steering and throttle input. */
    UNCONTROLLED = 16,
    /** Suspend control input while friction, gravity and collision motion still apply. */
    STOPPED = 32,
    /** Hide a kart temporarily during off-course recovery. */
    INVISIBLE = 64,
    /** Original timer-array length; not an effect flag despite sharing STAR's value. */
    _COUNT = 8,
}

/** Wrap a finite heading in radians into [0, 2 * PI). */
export function normalize(angle: number): number {
    let normalizedAngle = angle;
    while (normalizedAngle >= 2 * Math.PI) {
        normalizedAngle -= 2 * Math.PI;
    }
    while (normalizedAngle < 0) {
        normalizedAngle += 2 * Math.PI;
    }
    return normalizedAngle;
}

/** Add the original piecewise engine curve to acceleration in map units per second squared. */
export function simulateSpeedGraph(self: Driver, accelerationLinear: number): number {
    const speedPercentage = self.speedForward / self.vehicle.maxNormalLinearSpeed;

    // Preset-specific curves taper engine output near the normal cap, even during boosts.
    if (self.vehicle.convex) {
        if (speedPercentage < 0.25) {
            accelerationLinear += self.vehicle.motorAcceleration / 2;
        } else if (speedPercentage < 0.45) {
            accelerationLinear += self.vehicle.motorAcceleration * (speedPercentage + 0.075);
        } else if (speedPercentage < 0.95) {
            accelerationLinear += self.vehicle.motorAcceleration / 2;
        } else {
            accelerationLinear += 0.05 * self.vehicle.maxNormalLinearSpeed / 4;
        }
    } else {
        if (speedPercentage < 0.45) {
            accelerationLinear += self.vehicle.motorAcceleration / 2;
        } else if (speedPercentage < 0.95) {
            accelerationLinear += self.vehicle.motorAcceleration * (1 - speedPercentage);
        } else {
            accelerationLinear += 0.05 * self.vehicle.maxNormalLinearSpeed / 4;
        }
    }
    return accelerationLinear;
}

/**
 * Consume a pending drift hop and select the per-update steering increment.
 * Writes accelerationAngular.value as the C++ output reference did; returns whether drifting.
 */
export function incrisingAngularAceleration(
    self: Driver, accelerationAngular: { value: number },
): boolean {
    if (self.pressedToDrift) {
        if (Input.held(Key.TURN_RIGHT)) {
            self.speedTurn = self.vehicle.maxTurningAngularSpeed * 0.41;
        } else if (Input.held(Key.TURN_LEFT)) {
            self.speedTurn = -self.vehicle.maxTurningAngularSpeed * 0.41;
        }
        self.pressedToDrift = false;
    }

    // The landing kick (0.41) just clears this steering threshold; speed must qualify too.
    if (Math.abs(self.speedTurn) > self.vehicle.maxTurningAngularSpeed * 0.4 &&
        Math.abs(self.speedForward) > self.vehicle.maxNormalLinearSpeed * 0.4) {
        accelerationAngular.value = self.vehicle.turningAcceleration * 1.0;
        return true;
    }

    accelerationAngular.value = self.vehicle.turningAcceleration * 0.15;
    return false;
}

/** Return turning drag instead of the supplied acceleration when above 90% of normal top speed. */
export function reduceLinearSpeedWhileTurning(
    self: Driver, accelerationLinear: number, speedTurn: number,
): number {
    const speedTurnPercentage = Math.abs(speedTurn / self.vehicle.maxTurningAngularSpeed);
    if (self.speedForward > self.vehicle.maxNormalLinearSpeed * 0.9) {
        accelerationLinear = -self.vehicle.motorAcceleration * speedTurnPercentage;
    }
    return accelerationLinear;
}

/** Infer the wall axis at a normalized map position and replace the kart's rebound velocity. */
export function handlerHitBlock(self: Driver, nextPosition: sf.Vector2f): void {
    const moveWidth = new sf.Vector2f(1 / MAP_TILES_WIDTH, 0);
    const moveHeight = new sf.Vector2f(0, 1 / MAP_TILES_HEIGHT);

    // Estimate the wall's dominant axis from contiguous tiles on either side of contact.
    let widthSize = 0;
    for (let j = -1; j <= 1; j += 2) {
        for (let i = 1; i <= 4; i++) {
            if (Map.getLand(sf.add(nextPosition, sf.multiply(moveWidth, i * j))) === MapLand.BLOCK) {
                widthSize++;
            } else {
                break;
            }
        }
    }

    let heightSize = 0;
    for (let j = -1; j <= 1; j += 2) {
        for (let i = 1; i <= 4; i++) {
            if (Map.getLand(sf.add(nextPosition, sf.multiply(moveHeight, i * j))) === MapLand.BLOCK) {
                heightSize++;
            } else {
                break;
            }
        }
    }

    // An existing contact impulse supplies the rebound direction instead of the kart heading.
    const momentumSpeed = Math.sqrt(self.collisionMomentum.x ** 2 + self.collisionMomentum.y ** 2);
    let factor: number;
    let angle: number;
    if (momentumSpeed === 0) {
        factor = self.speedForward;
        angle = self.posAngle;
    } else {
        factor = momentumSpeed;
        angle = Math.atan2(self.collisionMomentum.y, self.collisionMomentum.x);
    }
    self.collisionMomentum = new sf.Vector2f();

    if (self.isImmune()) {
        factor = Math.max(factor, self.vehicle.maxNormalLinearSpeed * 0.97);
    } else {
        factor = Math.max(factor, self.vehicle.maxNormalLinearSpeed * 0.5);
    }
    const momentum = sf.multiply(
        new sf.Vector2f(Math.cos(angle), Math.sin(angle)), Math.max(0.01, factor),
    );

    // Reflect across the inferred wall; ambiguous corners reverse both components.
    if (widthSize > 4 && heightSize < 4) {
        self.vectorialSpeed = new sf.Vector2f(momentum.x, -momentum.y);
    } else if (widthSize < 4 && heightSize > 4) {
        self.vectorialSpeed = new sf.Vector2f(-momentum.x, momentum.y);
    } else {
        self.vectorialSpeed = new sf.Vector2f(-momentum.x, -momentum.y);
    }
}

/**
 * Probe five points around the proposed normalized map position for walls or off-course terrain.
 * Updates collision/fall state and effects, and zeroes deltaPosition in place on a wall hit.
 */
export function improvedCheckOfMapLands(
    self: Driver, position: sf.Vector2f, deltaPosition: sf.Vector2f,
): void {
    const nextPosition = sf.add(position, deltaPosition);
    const halfTileWidthInMapCoord = MAP_TILE_SIZE / MAP_ASSETS_WIDTH / 3.5;
    const halfTileHeightInMapCoord = MAP_TILE_SIZE / MAP_ASSETS_HEIGHT / 3.5;
    const deltaAngle = [0, Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4];

    // Front, sides, then diagonals: the first wall or outer-terrain probe wins.
    for (let i = 0; i < 5; i++) {
        const shifting = new sf.Vector2f(
            Math.cos(self.posAngle + deltaAngle[i]) * halfTileWidthInMapCoord,
            Math.sin(self.posAngle + deltaAngle[i]) * halfTileHeightInMapCoord,
        );
        switch (Map.getLand(sf.add(nextPosition, shifting))) {
            case MapLand.BLOCK:
                handlerHitBlock(self, sf.add(nextPosition, shifting));
                self.popStateEnd(DriverState.SPEED_UP);
                self.popStateEnd(DriverState.MORE_SPEED_UP);
                if (self.controlType === DriverControlType.PLAYER) {
                    Audio.play(SFX.CIRCUIT_COLLISION);
                }
                Map.addEffectSparkles(position);
                Gui.stopEffects();

                // Cancel this move after computing the rebound from the incoming motion.
                self.speedForward = 0;
                self.collisionMomentum = new sf.Vector2f();
                deltaPosition.x = 0;
                deltaPosition.y = 0;
                return;
            case MapLand.OUTER:
                Audio.stop(SFX.CIRCUIT_ITEM_STAR);
                Audio.stop(SFX.CIRCUIT_PLAYER_DRIFT);
                self.falling = true;
                return;
            default:
                break;
        }
    }
}

/** Advance a normalized position along the AI gradient, counting steps from a detected finish tile. */
export function updatePosition(position: sf.Vector2f, stepsFromGoal: { value: number }): void {
    const direction = AIGradientDescent.getNextDirection(position);
    position.x += direction.x;
    position.y += direction.y;
    if (stepsFromGoal.value === 0) {
        if (AIGradientDescent.getPositionValue(position) === 0) {
            stepsFromGoal.value = 1;
        }
    } else {
        stepsFromGoal.value++;
    }
}

/** Complete kart physics, controls, race progress, item effects and rendering. */
export class Driver extends WallObject {
    /** Source-map collision radius in pixels, normalized by map width in WallObject. */
    static readonly HITBOX_RADIUS = 1.5;
    private static readonly SPEED_UP_DURATION = sf.seconds(1.5);
    private static readonly MORE_SPEED_UP_DURATION = sf.seconds(0.75);
    private static readonly SPEED_DOWN_DURATION = sf.seconds(10);
    private static readonly STAR_DURATION = sf.seconds(10);
    private static readonly UNCONTROLLED_DURATION = sf.seconds(1);
    private static readonly COIN_SPEED = 0.002;
    private static readonly ITEM_USE_WAIT = sf.seconds(2);
    private static readonly FOLLOWED_PATH_UPDATE_INTERVAL = sf.seconds(0.25);
    private static readonly STEPS_BACK_FOR_RELOCATION = 4;
    private static readonly STEPS_STILL_FOR_RELOCATION = 12;
    private static isBrake = false;

    private readonly pj: MenuPlayer;
    private laps = 0;
    private maxLapSoFar = 0;
    private lastGradient = -1;
    private consecutiveGradientIncrements = 0;
    private coins = 0;
    private powerUp = PowerUps.NONE;
    private canUseItemAt = sf.seconds(0);
    private readonly followedPath: sf.Vector2f[] = [];
    private readonly prevLap: number[] = [];
    private readonly indexOfLap: number[] = [];
    private pathLastUpdatedAt = sf.seconds(0);
    private state = DriverState.NORMAL;
    private readonly stateEnd = Array.from({ length: DriverState._COUNT }, () => sf.seconds(0));

    /** Character billboard animation, status visuals and wheel particles. */
    readonly animator: DriverAnimator;
    /** Ground heading in radians; zero points right and PI / 2 points down the map. */
    posAngle: number;
    /** Travel heading in radians captured on takeoff, independent of airborne steering. */
    flightAngle = 0;
    /** Forward speed in normalized map units per second. */
    speedForward = 0;
    /** Steering rate in radians per second; positive turns clockwise on the map. */
    speedTurn = 0;
    /** Vertical speed in the original height units per second. */
    speedUpwards = 0;
    /** Whether Lakitu is carrying the kart, suspending normal gravity integration. */
    onLakitu = false;
    /** Whether off-course fall and relocation handling is active. */
    falling = false;
    /** Pending steering kick set when a short hop lands while a turn key is held. */
    pressedToDrift = false;
    /** Whether the current jump came from a ramp, bypassing the near-ground terrain probes. */
    heightByRamp = false;
    /** Direction inferred from recent gradient changes, rather than the kart's heading. */
    goingForwards = true;
    /** Decaying wall-rebound velocity in normalized map units per second. */
    vectorialSpeed = new sf.Vector2f();
    /** Decaying contact displacement added each update without multiplying by delta time. */
    collisionMomentum = new sf.Vector2f();
    /** Current input source, also read live by the animator for player-only audio. */
    controlType: DriverControlType;
    /** Shared kart preset used for acceleration, steering, speed caps and collision mass. */
    vehicle: VehicleProperties;
    /** Live race-order references shared with the race manager; index zero is the leader. */
    readonly positions: RaceRankingArray;
    /** Enable race AI rubber-banding against realPlayer; does not identify the human driver. */
    isRealPlayer: boolean;
    /** Human-controlled race driver used as the reference for AI rubber-banding. */
    static realPlayer: Driver | undefined;
    /** Cached zero-based place for items and AI; positions is the authoritative race order. */
    rank = 0;
    /** Tile offset added to the course's AI look-ahead distance. */
    farVisionModifier: number;
    /** Divisor of the AI's item-use probability; larger values mean less frequent use. */
    itemProbModifier: number;
    /** Divisor of steering toward the following racer; lower values strengthen blocking. */
    impedimentModifier: number;
    /** Original ownership marker for a locally created ranking array; JS needs no deletion. */
    deletePositions: boolean;

    /**
     * Create a kart from source-map pixel coordinates and a heading in radians.
     * Map dimensions normalize position/radius; vehicle and optional rankings remain shared.
     * Without positions, allocate an empty ranking array; await ready before rendering.
     */
    constructor(
        spriteFile: string, initialPosition: sf.Vector2f, initialAngle: number,
        mapWidth: number, mapHeight: number, controlType: DriverControlType,
        vehicle: VehicleProperties, pj: MenuPlayer, positions?: RaceRankingArray,
        isRealPlayer = false, farVisionMod = 0, itemProbMod = 1,
        impedimentMod = positions === undefined ? 0 : 8,
    ) {
        super(initialPosition, 1.0, Driver.HITBOX_RADIUS, 0, mapWidth, mapHeight);
        this.pj = pj;
        this.posAngle = initialAngle;
        this.controlType = controlType;
        this.vehicle = vehicle;
        this.positions = positions ?? [];
        this.isRealPlayer = isRealPlayer;
        this.farVisionModifier = farVisionMod;
        this.itemProbModifier = itemProbMod;
        this.impedimentModifier = impedimentMod;
        this.deletePositions = positions === undefined;

        // C++ retains a reference to controlType, which can change after construction.
        this.animator = new DriverAnimator(spriteFile, () => this.controlType);
    }

    /** Resolves when the animator's textures and sprites are ready, or rejects on load failure. */
    get ready(): Promise<void> {
        return this.animator.ready;
    }

    private usePlayerControls(accelerationLinear: number): number {
        if (this.height === 0) {
            if (Input.held(Key.ACCELERATE)) {
                accelerationLinear = simulateSpeedGraph(this, accelerationLinear);
            }
            if (Input.held(Key.BRAKE)) {
                if (this.speedForward > 0.2 * this.vehicle.maxNormalLinearSpeed && !Driver.isBrake) {
                    Driver.isBrake = true;
                    Audio.play(SFX.CIRCUIT_PLAYER_BRAKE);
                }
                accelerationLinear += VehicleProperties.BREAK_ACELERATION;
            } else {
                Driver.isBrake = false;
            }
        }

        // Steering increments are per control update, unlike time-integrated linear acceleration.
        let drift = false;
        if (Input.held(Key.TURN_LEFT) && !Input.held(Key.TURN_RIGHT)) {
            const accelerationAngular = { value: 0 };
            drift = incrisingAngularAceleration(this, accelerationAngular);
            this.speedTurn = Math.max(
                this.speedTurn - accelerationAngular.value, -this.vehicle.maxTurningAngularSpeed,
            );
            accelerationLinear = reduceLinearSpeedWhileTurning(this, accelerationLinear, this.speedTurn);
            this.animator.goLeft(drift);
        } else if (Input.held(Key.TURN_RIGHT) && !Input.held(Key.TURN_LEFT)) {
            const accelerationAngular = { value: 0 };
            drift = incrisingAngularAceleration(this, accelerationAngular);
            this.speedTurn = Math.min(
                this.speedTurn + accelerationAngular.value, this.vehicle.maxTurningAngularSpeed,
            );
            accelerationLinear = reduceLinearSpeedWhileTurning(this, accelerationLinear, this.speedTurn);
            this.animator.goRight(drift);
        }

        if (this.controlType === DriverControlType.PLAYER) {
            if (drift && this.height === 0 && !this.falling) {
                if (!Audio.isPlaying(SFX.CIRCUIT_PLAYER_DRIFT)) {
                    Audio.play(SFX.CIRCUIT_PLAYER_DRIFT, true);
                }
            } else {
                Audio.stop(SFX.CIRCUIT_PLAYER_DRIFT);
            }
        }
        return accelerationLinear;
    }

    private useGradientControls(accelerationLinear: number): number {
        // Look farther down the course at speed; a slow kart follows just the next tile.
        let dirSum = new sf.Vector2f();
        const tilesForward = this.speedForward < this.vehicle.maxNormalLinearSpeed / 4
            ? 1 : Map.getCurrentMapAIFarVision() + this.farVisionModifier;
        for (let i = 0; i < tilesForward; i++) {
            dirSum = sf.add(dirSum, AIGradientDescent.getNextDirection(sf.add(this.position, dirSum)));
        }

        // Probe along the predicted heading, with spacing proportional to forward speed.
        const evadeVector = new sf.Vector2f();
        let evadeFound = false;
        const scaledForward = new sf.Vector2f(
            Math.cos(this.posAngle + this.speedTurn * 0.15) * this.speedForward * 0.06,
            Math.sin(this.posAngle + this.speedTurn * 0.15) * this.speedForward * 0.06,
        );
        if (this.speedForward / this.vehicle.maxNormalLinearSpeed > 0.3) {
            for (let i = 1; i < 12; i++) {
                if (CollisionHashMap.evade(
                    this, sf.add(this.position, sf.multiply(scaledForward, i)),
                    this.hitboxRadius * 2, evadeVector,
                )) {
                    evadeFound = true;
                    break;
                }
            }
        }

        let evadeAngle = 0;
        if (evadeFound) {
            const MAX_EVADE_ANGLE = Math.PI / 3;
            const MAX_EVADE_DISTANCE = 1.5 / MAP_TILES_WIDTH;
            const perpDirection = new sf.Vector2f(scaledForward.y, -scaledForward.x);
            const dotProduct = perpDirection.x * evadeVector.x + perpDirection.y * evadeVector.y;
            const evadeModule = Math.sqrt(Math.abs(evadeVector.x ** 2 + evadeVector.y ** 2));
            if (evadeModule < MAX_EVADE_DISTANCE) {
                // The perpendicular dot product chooses a side; proximity sets the deflection.
                const evadePct = 1 - evadeModule / MAX_EVADE_DISTANCE;
                evadeAngle = evadePct * MAX_EVADE_ANGLE * (dotProduct > 0 ? -1 : 1);
            }
        }

        const goingToFall = (
            Map.getLand(sf.add(this.position, sf.multiply(scaledForward, 16))) === MapLand.OUTER ||
            Map.getLand(sf.add(this.position, sf.multiply(scaledForward, 8))) === MapLand.OUTER
        ) && this.speedForward / this.vehicle.maxNormalLinearSpeed > 0.3;
        const targetAngle = Math.atan2(dirSum.y, dirSum.x);

        // Bias steering against the next-ranked racer, more strongly for the human opponent.
        let angleP2P = 0;
        let goHitBackMultiplier = 1;
        if (this.rank >= 0 && this.rank < MenuPlayer.__COUNT - 1) {
            const backPlayer = this.positions[this.rank + 1];
            goHitBackMultiplier = backPlayer.controlType === DriverControlType.PLAYER ? 1 : 8;
            const vecP2P = sf.subtract(this.position, backPlayer.position);
            const dP2P_2 = vecP2P.x ** 2 + vecP2P.y ** 2;
            const NUM_TILES_FOR_OCCLUSION = 6;
            const DIST_FOR_OCCLUSION = (NUM_TILES_FOR_OCCLUSION / MAP_TILES_WIDTH) ** 2;
            if (dP2P_2 < DIST_FOR_OCCLUSION) {
                angleP2P = Math.atan2(vecP2P.y, vecP2P.x);
                angleP2P -= this.posAngle;
                angleP2P = normalize(angleP2P);
                if (angleP2P > Math.PI / 2 && angleP2P < 3 * Math.PI / 2) {
                    angleP2P = 0;
                }
                if (backPlayer.isImmune()) {
                    angleP2P = normalize(-angleP2P);
                }
            }
        }
        const goHitBackPlayer =
            (angleP2P < Math.PI ? -1 : 1) * angleP2P / this.impedimentModifier;

        // Combine route, obstacle and opponent steering in a wrapped angular error.
        let diff = targetAngle + evadeAngle - this.posAngle - this.speedTurn * 0.15 +
            goHitBackPlayer / goHitBackMultiplier;
        diff %= 2 * Math.PI;
        if (diff < 0) {
            diff += 2 * Math.PI;
        }

        // Accelerate only near the target heading; rubber-banding changes throttle probability.
        if (this.height === 0 && Math.abs(Math.PI - diff) > 0.85 * Math.PI) {
            if (this.isRealPlayer && this.speedForward >= 0.4 * this.vehicle.maxNormalLinearSpeed) {
                const realPlayer = Driver.realPlayer;
                if (realPlayer === undefined) {
                    throw new Error('Driver.realPlayer must be set before rubber-band AI updates');
                }
                const playerPositionValue = AIGradientDescent.getPositionValue(realPlayer.position) +
                    AIGradientDescent.MAX_POSITION_MATRIX * realPlayer.laps;
                const currentPositionValue = AIGradientDescent.getPositionValue(this.position) +
                    AIGradientDescent.MAX_POSITION_MATRIX * this.laps;
                const ccIndex = Number(StateRace.ccOption);
                const maxBehind = AIGradientDescent.MAX_DISTANCE_BEHIND[ccIndex];
                const minProbBehind = AIGradientDescent.MIN_PROB_BEHIND[ccIndex];
                const maxAhead = AIGradientDescent.MAX_DISTANCE_AHEAD[ccIndex];
                const minProbAhead = AIGradientDescent.MIN_PROB_AHEAD[ccIndex];
                const distance = Math.abs(playerPositionValue - currentPositionValue);

                if (this.rank > realPlayer.rank) {
                    const variance = 1 - minProbBehind;
                    let prob = distance / maxBehind * variance + minProbBehind;
                    prob = Math.max(0.5, Math.min(prob, 1));
                    if (Math.random() <= prob) {
                        accelerationLinear = simulateSpeedGraph(this, accelerationLinear);
                        this.animator.goForward();
                    }
                } else {
                    const variance = minProbBehind - minProbAhead;
                    let prob = (1 - distance / maxAhead) * variance + minProbAhead;
                    prob = Math.max(0.40, Math.min(prob, 0.5));
                    if (Math.random() <= prob) {
                        accelerationLinear = simulateSpeedGraph(this, accelerationLinear);
                        this.animator.goForward();
                    }
                }
            } else {
                accelerationLinear = simulateSpeedGraph(this, accelerationLinear);
                this.animator.goForward();
            }
        }

        // Outside the steering dead zone, use stronger correction when outer terrain is ahead.
        if (diff >= 0.05 * Math.PI && diff <= 1.95 * Math.PI) {
            const accelerationAngular = this.vehicle.turningAcceleration;
            const turnMultiplier = goingToFall ? 5 : 2;
            const totalMultiplier = goingToFall ? 1.5 : 1;
            if (diff > Math.PI) {
                this.speedTurn = Math.max(
                    this.speedTurn - accelerationAngular * turnMultiplier,
                    this.vehicle.maxTurningAngularSpeed * -totalMultiplier,
                );
                accelerationLinear = reduceLinearSpeedWhileTurning(this, accelerationLinear, this.speedTurn);
                this.animator.goLeft(this.speedTurn < this.vehicle.maxTurningAngularSpeed * -0.4);
            } else {
                this.speedTurn = Math.min(
                    this.speedTurn + accelerationAngular * turnMultiplier,
                    this.vehicle.maxTurningAngularSpeed * totalMultiplier,
                );
                accelerationLinear = reduceLinearSpeedWhileTurning(this, accelerationLinear, this.speedTurn);
                this.animator.goRight(this.speedTurn > this.vehicle.maxTurningAngularSpeed * 0.4);
            }
        }
        return accelerationLinear;
    }

    private updateGradientPosition(): void {
        const CONSECUTIVE_INCREMENTS_FOR_BACKWARDS = 5;
        if (this.position.x < 1e-4 || this.position.x > 1 - 1e-4 ||
            this.position.y < 1e-4 || this.position.y > 1 - 1e-4) {
            return;
        }
        const gradient = AIGradientDescent.getPositionValue(
            Math.trunc(this.position.x * MAP_TILES_WIDTH),
            Math.trunc(this.position.y * MAP_TILES_HEIGHT),
        );
        if (gradient === -1 || gradient === this.lastGradient) {
            return;
        }
        if (this.lastGradient === -1) {
            this.lastGradient = gradient;
            return;
        }

        // Accumulate a directional bias so small gradient fluctuations do not flip the warning.
        if (gradient > this.lastGradient) {
            this.consecutiveGradientIncrements = Math.min(
                this.consecutiveGradientIncrements + 1, CONSECUTIVE_INCREMENTS_FOR_BACKWARDS,
            );
            if (this.consecutiveGradientIncrements === CONSECUTIVE_INCREMENTS_FOR_BACKWARDS) {
                this.goingForwards = false;
            }
        } else {
            this.consecutiveGradientIncrements = Math.max(
                this.consecutiveGradientIncrements - 1, -CONSECUTIVE_INCREMENTS_FOR_BACKWARDS,
            );
            if (this.consecutiveGradientIncrements === -CONSECUTIVE_INCREMENTS_FOR_BACKWARDS) {
                this.goingForwards = true;
            }
        }

        // Large gradient jumps mark finish-line crossings in either direction.
        const diff = gradient - this.lastGradient;
        if (diff > AIGradientDescent.GRADIENT_LAP_CHECK) {
            this.laps++;
            if (this.laps === 5 && this.maxLapSoFar === 4 &&
                this.controlType === DriverControlType.PLAYER) {
                Audio.stopMusic();
                Audio.play(SFX.CIRCUIT_LAST_LAP_NOTICE);
                Audio.playMusic(Music.CIRCUIT_LAST_LAP);
            }
            if (this.laps > this.maxLapSoFar) {
                if (this.controlType === DriverControlType.PLAYER && this.laps < 6) {
                    Map.reactivateQuestionPanels();
                    Lakitu.showLap(this.laps);
                }
                if (this.laps > 1) {
                    this.indexOfLap.push(this.followedPath.length - 1);
                }
                this.maxLapSoFar = this.laps;
            }
        } else if (diff < -AIGradientDescent.GRADIENT_LAP_CHECK && this.laps > 0) {
            this.laps--;
        }

        this.lastGradient = gradient;
        if (this.controlType === DriverControlType.PLAYER) {
            Lakitu.setWrongDir(this.isGoingBackwards());
        }
    }

    /** Immediately reach boosted speed and start the timed mushroom effect and player speed HUD. */
    applyMushroom(): void {
        if (this.controlType === DriverControlType.PLAYER) {
            Gui.speed(Driver.SPEED_UP_DURATION.asSeconds());
        }
        this.speedForward = this.vehicle.maxSpeedUpLinearSpeed;
        this.pushStateEnd(DriverState.SPEED_UP, sf.add(StateRace.currentTime, Driver.SPEED_UP_DURATION));
    }

    /** Start timed star immunity, boosted driving, rainbow animation and player star audio. */
    applyStar(): void {
        if (this.controlType === DriverControlType.PLAYER) {
            Audio.play(SFX.CIRCUIT_ITEM_STAR, true);
        }
        this.pushStateEnd(DriverState.STAR, sf.add(StateRace.currentTime, Driver.STAR_DURATION));
        this.animator.star(Driver.STAR_DURATION);
    }

    /** Apply a brief spin-out plus shrink/slowdown for duration; callers must check immunity. */
    applyThunder(duration: sf.Time): void {
        this.speedTurn = 0;
        this.speedForward = Math.min(this.speedForward, this.vehicle.maxNormalLinearSpeed * 0.3);
        this.pushStateEnd(
            DriverState.UNCONTROLLED, sf.add(StateRace.currentTime, Driver.UNCONTROLLED_DURATION),
        );
        if (this.controlType === DriverControlType.PLAYER) {
            Audio.play(SFX.CIRCUIT_PLAYER_SHRINK);
        }
        this.animator.small(duration);
        this.pushStateEnd(DriverState.SPEED_DOWN, sf.add(StateRace.currentTime, duration));
    }

    /** Begin a small hop only when grounded, retaining the current heading for airborne travel. */
    shortJump(): void {
        if (this.height === 0) {
            this.flightAngle = this.posAngle;
            this.height = 3;
            if (this.controlType === DriverControlType.PLAYER) {
                Audio.play(SFX.CIRCUIT_PLAYER_JUMP);
            }
        }
    }

    /** Unless star-immune, lose two coins, cancel boosts and briefly spin out at reduced speed. */
    applyHit(): void {
        if (!this.isImmune()) {
            this.addCoin(-2);
            this.popStateEnd(DriverState.SPEED_UP);
            this.popStateEnd(DriverState.MORE_SPEED_UP);
            Gui.stopEffects();

            this.speedTurn = 0;
            this.speedForward = Math.min(this.speedForward, this.vehicle.maxNormalLinearSpeed * 0.6);
            if (this.controlType === DriverControlType.PLAYER && this.canDrive()) {
                Audio.play(SFX.CIRCUIT_PLAYER_HIT);
            }
            this.pushStateEnd(
                DriverState.UNCONTROLLED, sf.add(StateRace.currentTime, Driver.UNCONTROLLED_DURATION),
            );
        }
    }

    /** Unless star-immune, lose three coins, stop movement and start flattening and loss of control. */
    applySmash(): void {
        if (!this.isImmune()) {
            this.addCoin(-3);
            this.speedTurn = 0;
            this.speedForward = 0;
            this.animator.smash(sf.add(Driver.SPEED_DOWN_DURATION, Driver.UNCONTROLLED_DURATION));
            if (this.controlType === DriverControlType.PLAYER && this.canDrive()) {
                Audio.play(SFX.CIRCUIT_PLAYER_SMASH);
            }
            this.pushStateEnd(
                DriverState.UNCONTROLLED, sf.add(StateRace.currentTime, Driver.UNCONTROLLED_DURATION),
            );
        }
    }

    /** Add or remove coins within [0, 10], spawning the coin effect and updating the player's HUD. */
    addCoin(amount = 1): void {
        if (this.coins + amount > 10) {
            amount = 10 - this.coins;
        } else if (this.coins + amount < 0) {
            amount = -this.coins;
        }

        // Effects and HUD receive the clamped change, not the originally requested amount.
        this.coins += amount;
        if (amount !== 0) {
            Map.addEffectCoin(this, Math.abs(amount), amount > 0);
        }
        if (this.coins < 11 && this.controlType === DriverControlType.PLAYER) {
            Gui.addCoin(amount);
        }
    }

    /** Return the held coin count, which also increases the kart's speed cap. */
    getCoins(): number {
        return this.coins;
    }

    /** Return the lap counter: zero before starting, one through five while racing, six at finish. */
    getLaps(): number {
        return this.laps;
    }

    /** Return the last sampled course-progress gradient, or -1 before the first valid sample. */
    getLastGradient(): number {
        return this.lastGradient;
    }

    /** Return the character index used by asset, preset and display-name tables. */
    getPj(): MenuPlayer {
        return this.pj;
    }

    /** Whether recent gradient changes indicate progress in the course's intended direction. */
    isGoingForward(): boolean {
        return this.goingForwards;
    }

    /** Whether the gradient-based wrong-way detector currently considers this kart reversed. */
    isGoingBackwards(): boolean {
        return !this.isGoingForward();
    }

    /** Check only whether the pickup cooldown has elapsed, not item availability or driving state. */
    canUsePowerUp(): boolean {
        return sf.less(this.canUseItemAt, StateRace.currentTime);
    }

    /** Replace the held item and restart its cooldown, even for NONE; update the player's item HUD. */
    pickUpPowerUp(power: PowerUps): void {
        this.powerUp = power;
        this.canUseItemAt = sf.add(StateRace.currentTime, Driver.ITEM_USE_WAIT);
        if (this.controlType === DriverControlType.PLAYER) {
            if (power !== PowerUps.NONE) {
                Audio.play(SFX.CIRCUIT_ITEM_RANDOMIZING);
            }
            Gui.setPowerUp(power);
        }
    }

    /** Return the held item identifier, or NONE for an empty slot. */
    getPowerUp(): PowerUps {
        return this.powerUp;
    }

    /** Return the cached zero-based race place used by item and AI logic. */
    getRank(): number {
        return this.rank;
    }

    /** Clear recovery flags, timed states and animation without resetting speed, position or race progress. */
    reset(): void {
        this.onLakitu = false;
        this.falling = false;
        this.pressedToDrift = false;
        this.heightByRamp = false;
        this.state = DriverState.NORMAL;
        for (let i = 0; i < DriverState._COUNT; i++) {
            this.stateEnd[i] = sf.seconds(0);
        }
        this.animator.reset();
    }

    /** Apply the lightweight state/animation reset at race end, retaining the race results. */
    endRaceAndReset(): void {
        this.reset();
    }

    /** Start a fresh race at normalized map coordinates and a heading in radians, clearing motion and history. */
    setPositionAndReset(newPosition: sf.Vector2f, newAngle = -Math.PI / 2): void {
        this.position = new sf.Vector2f(newPosition);
        this.posAngle = newAngle;
        this.height = 0;
        this.flightAngle = 0;

        // Seed recovery history before any update can request relocation.
        this.followedPath.length = 0;
        this.prevLap.length = 0;
        this.indexOfLap.length = 0;
        this.followedPath.push(new sf.Vector2f(this.position));
        this.prevLap.push(0);
        this.indexOfLap.push(0);
        this.pathLastUpdatedAt = new sf.Time(StateRace.currentTime);

        this.laps = 0;
        this.maxLapSoFar = 0;
        this.powerUp = PowerUps.NONE;
        this.canUseItemAt = sf.seconds(0);
        this.coins = 0;
        this.rank = 0;
        this.goingForwards = true;
        this.lastGradient = -1;
        this.consecutiveGradientIncrements = 0;

        this.speedForward = 0;
        this.speedTurn = 0;
        this.speedUpwards = 0;
        this.collisionMomentum = new sf.Vector2f();
        this.vectorialSpeed = new sf.Vector2f();
        this.reset();
        this.animator.reset();
    }

    /** Convert forward speed into a jump, choosing a cardinal flight direction from the ramp orientation. */
    jumpRamp(land: MapLand): void {
        // This tuned speed split converts map speed to height units, not a trigonometric launch.
        const RAMP_INCLINATION = 22.5 / 90;
        this.speedUpwards = RAMP_INCLINATION * this.speedForward * 384 * 8;
        this.speedUpwards = Math.max(this.speedUpwards, 20);
        this.speedUpwards = Math.min(this.speedUpwards, 40);
        this.speedForward = (1 - RAMP_INCLINATION) * this.speedForward;
        this.speedForward = Math.max(this.speedForward, 0.1);
        this.heightByRamp = true;

        // Airborne travel follows the ramp normal even if the kart approached at an angle.
        const normalizedAngle = normalize(this.posAngle);
        if (land === MapLand.RAMP_HORIZONTAL) {
            if (normalizedAngle >= 0 && normalizedAngle <= Math.PI) {
                this.flightAngle = Math.PI / 2;
            } else {
                this.flightAngle = 3 * Math.PI / 2;
            }
        } else if (land === MapLand.RAMP_VERTICAL) {
            if (normalizedAngle > Math.PI / 2 && normalizedAngle < 3 * Math.PI / 2) {
                this.flightAngle = Math.PI;
            } else {
                this.flightAngle = 0;
            }
        }
        if (this.controlType === DriverControlType.PLAYER) {
            Audio.play(SFX.CIRCUIT_PLAYER_JUMP);
        }
    }

    /** Race-start revving uses the same speed graph without moving the kart. */
    updateSpeed(deltaTime: sf.Time): void {
        let accelerationLinear = 0;
        if (Input.held(Key.ACCELERATE)) {
            accelerationLinear = simulateSpeedGraph(this, accelerationLinear);
        } else {
            accelerationLinear += VehicleProperties.FRICTION_LINEAR_ACELERATION * 6;
        }

        accelerationLinear *= 1 + VehicleProperties.POSITION_ACCELERATION_BONUS_PCT * this.rank;
        this.speedForward += accelerationLinear * deltaTime.asSeconds();
        this.speedForward = Math.min(this.speedForward, this.vehicle.maxSpeedUpLinearSpeed);
        this.speedForward = Math.max(this.speedForward, 0);
    }

    /** Advance controls, timed effects, physics, terrain response, recovery, lap tracking and animation. */
    override update(deltaTime: sf.Time): void {
        const dt = deltaTime.asSeconds();
        let accelerationLinear = 0;
        if (this.height === 0) {
            accelerationLinear += VehicleProperties.FRICTION_LINEAR_ACELERATION;
        }
        if ((!Input.held(Key.TURN_LEFT) && !Input.held(Key.TURN_RIGHT)) ||
            (Input.held(Key.TURN_LEFT) && this.speedTurn > 0) ||
            (Input.held(Key.TURN_RIGHT) && this.speedTurn < 0)) {
            this.speedTurn /= 1.2;
        }

        // Expire input-blocking states before choosing controls for this update.
        this.popStateEnd(StateRace.currentTime);
        if (this.state & DriverState.UNCONTROLLED) {
            this.animator.hit();
        } else if (this.state & DriverState.STOPPED) {
            // Stopped karts still undergo friction, gravity and collision response.
        } else {
            if (this.height === 0) {
                this.animator.goForward();
            }
            switch (this.controlType) {
                case DriverControlType.PLAYER:
                    accelerationLinear = this.usePlayerControls(accelerationLinear);
                    break;
                case DriverControlType.AI_GRADIENT:
                    accelerationLinear = this.useGradientControls(accelerationLinear);
                    break;
                default:
                    break;
            }
        }

        accelerationLinear *= 1 + VehicleProperties.POSITION_ACCELERATION_BONUS_PCT * this.rank;
        if (this.isImmune()) {
            accelerationLinear *= 2;
        }

        // Terrain under the current position may change speed or initiate a jump before integration.
        const land = Map.getLand(this.position);
        if (land === MapLand.SLOW && (~this.state & DriverState.STAR) &&
            (~this.state & DriverState.SPEED_UP)) {
            if (this.speedForward > this.vehicle.slowLandMaxLinearSpeed) {
                accelerationLinear += VehicleProperties.SLOW_LAND_LINEAR_ACELERATION;
            }
        }
        if (this.height === 0) {
            if (land === MapLand.OIL_SLICK) {
                this.applyHit();
                this.speedForward = Math.max(this.speedForward, 0.01);
            } else if (land === MapLand.RAMP) {
                console.error('ERROR: MapLand::RAMP is deprecated');
            } else if (land === MapLand.RAMP_HORIZONTAL || land === MapLand.RAMP_VERTICAL) {
                this.jumpRamp(land);
            } else if (land === MapLand.ZIPPER) {
                if ((~this.state & DriverState.SPEED_UP) && this.controlType === DriverControlType.PLAYER) {
                    Audio.play(SFX.CIRCUIT_ITEM_MUSHROOM);
                }
                if ((this.state & DriverState.SPEED_UP) && this.controlType !== DriverControlType.PLAYER) {
                    this.pushStateEnd(
                        DriverState.MORE_SPEED_UP, sf.add(StateRace.currentTime, Driver.MORE_SPEED_UP_DURATION),
                    );
                    this.speedForward = this.vehicle.maxSpeedUpLinearSpeed * 1.2;
                } else {
                    this.speedForward = this.vehicle.maxSpeedUpLinearSpeed;
                }
                this.pushStateEnd(
                    DriverState.SPEED_UP, sf.add(StateRace.currentTime, Driver.SPEED_UP_DURATION),
                );
            } else if (land === MapLand.OTHER) {
                Map.collideWithSpecialFloorObject(this);
            }
        }

        // Lakitu owns height during rescue; otherwise integrate in the original vertical units.
        if ((this.height > 0 || this.speedUpwards > 0) && !this.onLakitu) {
            const gravityAceleration = -9.8 * 16;
            this.height = this.height + this.speedUpwards * dt + 0.5 * gravityAceleration * dt * dt;
            if (this.height < 0) {
                if (this.controlType === DriverControlType.PLAYER) {
                    Audio.play(SFX.CIRCUIT_PLAYER_LANDING);
                }
                if (!this.heightByRamp && (Input.held(Key.TURN_LEFT) || Input.held(Key.TURN_RIGHT))) {
                    this.pressedToDrift = true;
                }
                this.heightByRamp = false;
            }
            this.height = Math.max(this.height, 0);
            this.speedUpwards += gravityAceleration * dt;
            if (this.height === 0) {
                this.speedUpwards = 0;
            }
        }

        // Boosts take precedence over shrink; coins raise whichever cap is selected.
        let maxLinearSpeed: number;
        if (this.state & DriverState.MORE_SPEED_UP) {
            maxLinearSpeed = this.vehicle.maxSpeedUpLinearSpeed * 1.2;
        } else if ((this.state & DriverState.SPEED_UP) || (this.state & DriverState.STAR)) {
            maxLinearSpeed = this.vehicle.maxSpeedUpLinearSpeed;
            accelerationLinear *= 2;
        } else if (this.state & DriverState.SPEED_DOWN) {
            maxLinearSpeed = this.vehicle.maxSpeedDownLinearSpeed;
        } else {
            maxLinearSpeed = this.vehicle.maxNormalLinearSpeed;
        }
        maxLinearSpeed += Driver.COIN_SPEED * this.coins;

        // Compute displacement from the incoming speed before advancing velocity.
        const deltaAngle = this.speedTurn * dt;
        let deltaSpace = this.speedForward * dt + accelerationLinear * (dt * dt) / 2;
        deltaSpace = Math.min(deltaSpace, maxLinearSpeed * dt);
        deltaSpace = Math.max(deltaSpace, 0);
        this.speedForward += accelerationLinear * dt;
        this.speedForward = Math.min(this.speedForward, maxLinearSpeed);
        this.speedForward = Math.max(this.speedForward, 0);

        const movementAngle = this.height === 0 ? this.posAngle : this.flightAngle;
        let deltaPosition = sf.multiply(
            new sf.Vector2f(Math.cos(movementAngle), Math.sin(movementAngle)), deltaSpace,
        );

        // Contact momentum is a per-update displacement; wall rebound is a velocity.
        deltaPosition = sf.add(deltaPosition, this.collisionMomentum);
        this.collisionMomentum = sf.divide(this.collisionMomentum, 1.2);
        deltaPosition = sf.add(deltaPosition, sf.multiply(this.vectorialSpeed, dt));
        this.vectorialSpeed = sf.divide(this.vectorialSpeed, 1.3);

        // Validate proposed movement before committing it; ramp flight bypasses terrain probes.
        const nextPosition = sf.add(this.position, deltaPosition);
        if (nextPosition.x < 0 || nextPosition.x > 1 || nextPosition.y < 0 || nextPosition.y > 1) {
            this.falling = true;
            deltaPosition = new sf.Vector2f();
        }
        if (!this.heightByRamp && Map.getLand(this.position) !== MapLand.BLOCK) {
            improvedCheckOfMapLands(this, this.position, deltaPosition);
        }

        // Player recovery waits for the fade; AI recovery relocates immediately and hides the kart.
        if (this.falling) {
            this.speedTurn = 0;
            this.speedForward /= 1.1;
            if (this.controlType === DriverControlType.PLAYER) {
                this.animator.fall();
                if (!Gui.isBlackScreen()) {
                    Map.addEffectDrown(
                        sf.add(this.position, sf.divide(sf.multiply(
                            new sf.Vector2f(Math.cos(this.posAngle), Math.sin(this.posAngle)), 1.5,
                        ), MAP_TILES_WIDTH)),
                        this.controlType === DriverControlType.PLAYER,
                    );
                    this.pushStateEnd(DriverState.STOPPED, sf.add(StateRace.currentTime, sf.seconds(10)));
                    Gui.fade(1.5, false);
                }
                Gui.stopEffects();
                if (Gui.isBlackScreen(true)) {
                    this.speedTurn = 0;
                    this.speedForward = 0;
                    this.relocateToNearestGoodPosition();
                    this.reset();
                    Gui.fade(1, true);
                    Lakitu.pickUpDriver(this);
                    this.falling = false;
                }
            } else {
                this.speedTurn = 0;
                this.speedForward = 0;
                this.reset();
                this.addCoin(-2);
                this.relocateToNearestGoodPosition();
                this.pushStateEnd(DriverState.STOPPED, sf.add(StateRace.currentTime, sf.seconds(2.5)));
                this.pushStateEnd(DriverState.INVISIBLE, sf.add(StateRace.currentTime, sf.seconds(2.5)));
                this.falling = false;
            }
        }

        this.position = sf.add(this.position, deltaPosition);
        if (this.position.x < 0 || this.position.x > 1 || this.position.y < 0 || this.position.y > 1) {
            this.falling = true;
        }
        if (this.height === 0) {
            this.posAngle += deltaAngle;
            this.posAngle %= 2 * Math.PI;
        }
        this.updateGradientPosition();
        this.animator.update(this.speedForward, this.speedTurn, this.height, deltaTime);

        // Sample recovery history at a slower cadence; repeated nearby samples identify stuck AI.
        if (!this.falling && sf.greater(
            sf.subtract(StateRace.currentTime, this.pathLastUpdatedAt),
            Driver.FOLLOWED_PATH_UPDATE_INTERVAL,
        )) {
            let numOfUpdatesWithoutMoving = 0;
            if (this.controlType !== DriverControlType.PLAYER) {
                for (let index = this.followedPath.length - 1; index >= 0; index--) {
                    const previous = this.followedPath[index];
                    if (Math.abs(this.position.x - previous.x) > 1 / MAP_TILES_WIDTH) {
                        break;
                    }
                    if (Math.abs(this.position.y - previous.y) > 1 / MAP_TILES_HEIGHT) {
                        break;
                    }
                    if (++numOfUpdatesWithoutMoving >= Driver.STEPS_STILL_FOR_RELOCATION) {
                        const size = this.followedPath.length;
                        for (let i = Math.max(size - Driver.STEPS_STILL_FOR_RELOCATION - 5, 1); i < size; i++) {
                            this.followedPath.pop();
                        }
                        this.relocateToNearestGoodPosition();
                        break;
                    }
                }
            }

            this.followedPath.push(new sf.Vector2f(this.position));
            this.prevLap.push(this.laps);
            this.pathLastUpdatedAt = new sf.Time(StateRace.currentTime);
        }
    }

    /** Whether neither UNCONTROLLED nor STOPPED blocks input; independent of controlType. */
    canDrive(): boolean {
        return !(this.state & DriverState.UNCONTROLLED) && !(this.state & DriverState.STOPPED);
    }

    /** Whether the STAR bit currently grants immunity to ordinary hit and crush responses. */
    isImmune(): boolean {
        return Boolean(this.state & DriverState.STAR);
    }

    /** Whether the temporary off-course INVISIBLE flag is absent. */
    isVisible(): boolean {
        return Boolean(~this.state & DriverState.INVISIBLE);
    }

    /** Return the animator's shared billboard by reference, not a sprite copy. */
    override getSprite(): sf.Sprite {
        return this.animator.sprite;
    }

    /**
     * Position and scale the camera-followed kart, appending depth/sprite pairs to drawables.
     * Mutates the shared sprites and optionally adds an airborne ground shadow.
     */
    getDrawables(
        window: sf.RenderTarget, scale: number, drawables: [number, sf.Sprite][], withShadow = true,
    ): void {
        const width = window.getSize().x;
        const y = window.getSize().y * 45 / 100;
        this.animator.sprite.setPosition(new sf.Vector2f(width / 2, y));
        const moveX = this.animator.spriteMovementDrift;
        const moveY = this.animator.spriteMovementSpeed - this.height * 8;
        this.animator.sprite.move(new sf.Vector2f(moveX * scale, moveY * scale));
        this.animator.sprite.scale(new sf.Vector2f(scale, scale));
        const z = Map.CAM_2_PLAYER_DST / MAP_ASSETS_WIDTH;
        drawables.push([z, this.animator.sprite]);

        // Keep the shadow on the ground while the kart billboard rises with height.
        if (this.height > 0 && withShadow) {
            this.spriteShadow.setScale(sf.multiply(
                this.animator.sprite.getScale(), Map.CIRCUIT_HEIGHT_PCT * 2,
            ));
            this.spriteShadow.setPosition(new sf.Vector2f(width / 2, y));
            this.spriteShadow.move(new sf.Vector2f(moveX * scale, this.animator.spriteMovementSpeed * scale));
            const zShadow = z + 10000;
            const alpha = Math.trunc(Math.max((50 - this.height) * 5, 0));
            this.spriteShadow.setColor(new sf.Color(255, 255, 255, alpha));
            drawables.push([zShadow, this.spriteShadow]);
        }
    }

    /** Enable one nonzero effect bit and replace its expiry with an absolute StateRace time. */
    pushStateEnd(state: DriverState, endTime: sf.Time): void {
        this.state |= state;
        this.stateEnd[Math.trunc(Math.log2(state))] = new sf.Time(endTime);
    }

    /** Immediately clear one nonzero effect bit and its expiry timer. */
    popStateEnd(state: DriverState): void;
    /** Remove effects whose expiry is strictly before currentTime and return their combined bit mask. */
    popStateEnd(currentTime: sf.Time): number;
    /** Dispatch explicit effect removal or expiry processing, matching the original C++ overloads. */
    popStateEnd(stateOrTime: DriverState | sf.Time): void | number {
        if (typeof stateOrTime === 'number') {
            this.state &= ~stateOrTime;
            this.stateEnd[Math.trunc(Math.log2(stateOrTime))] = sf.seconds(0);
            return;
        }

        // Timer slot i belongs to bit 2^i; timer values are absolute race times.
        let finishedEstates = 0;
        if (this.state !== 0) {
            let state = 1;
            for (let i = 0; i < DriverState._COUNT; i++) {
                if (this.state & state) {
                    if (sf.less(this.stateEnd[i], stateOrTime)) {
                        finishedEstates |= state;
                        this.state &= ~state;
                    }
                }
                state *= 2;
            }
        }
        return finishedEstates;
    }

    /**
     * Write the response for the other driver, respecting height separation and star immunity.
     * otherSpeed/otherPos use normalized map units; distance2 is squared separation.
     * Returns false for ignored contacts, otherwise applying mass-weighted momentum or a star hit.
     */
    override solveCollision(
        data: CollisionData, otherSpeed: sf.Vector2f, otherPos: sf.Vector2f,
        otherWeight: number, otherHeight: number, isOtherImmune: boolean, distance2: number,
    ): boolean {
        if (WallObject.collisionHasHeightDifference(this.height, otherHeight)) {
            return false;
        }

        // This result affects the other kart: star asymmetry must precede the ordinary shove.
        if (this.isImmune() && !isOtherImmune) {
            data.momentum.x = 0;
            data.momentum.y = 0;
            data.speedFactor = 0.4;
            data.type = CollisionType.HIT;
            return true;
        } else if (!this.isImmune() && isOtherImmune) {
            return false;
        }

        // The arcade impulse uses speed share and square-root mass share, not elastic conservation.
        const mySpeedMod = Math.sqrt(Math.max(this.speedForward ** 2, 1e-12));
        const otherSpeedMod = Math.sqrt(Math.max(otherSpeed.x ** 2 + otherSpeed.y ** 2, 1e-12));
        const speedFactor = mySpeedMod / (mySpeedMod + otherSpeedMod);
        const weightFactor = Math.sqrt(Math.max(this.vehicle.weight / (this.vehicle.weight + otherWeight), 1e-12));
        const dir = sf.divide(sf.subtract(otherPos, this.position), Math.sqrt(Math.max(1e-12, distance2)));
        const myMomentum = sf.multiply(dir, mySpeedMod);
        const relativeMomentum = sf.multiply(myMomentum, speedFactor);
        const weightedMomentum = sf.multiply(relativeMomentum, weightFactor);
        const momentum = sf.multiply(weightedMomentum, 0.1);

        data.momentum.x = momentum.x;
        data.momentum.y = momentum.y;
        data.speedFactor = weightFactor * 0.95;
        data.type = CollisionType.NO_HIT;
        return true;
    }

    /** Return value-copied normalized positions for the original one-indexed lap range, or [] if unavailable. */
    getLapTrajectory(lap: number): sf.Vector2f[] {
        if (lap >= 1 && lap < this.indexOfLap.length) {
            const begin = this.indexOfLap[lap - 1];
            const end = lap + 1 < this.indexOfLap.length
                ? this.indexOfLap[lap] : this.followedPath.length;
            return this.followedPath.slice(begin, end).map(position => new sf.Vector2f(position));
        }
        return [];
    }

    /** Recover position/lap from stored history, then find safe ground while correcting finish-line crossings. */
    relocateToNearestGoodPosition(): void {
        let index = 0;
        if (this.followedPath.length > Driver.STEPS_BACK_FOR_RELOCATION) {
            index = this.followedPath.length - 1 - Driver.STEPS_BACK_FOR_RELOCATION;
        }
        this.position = new sf.Vector2f(this.followedPath[index]);
        this.laps = this.prevLap[index];

        // Seek safe terrain along the route, then spread recoveries over a few additional steps.
        const stepsFromGoal = {
            value: AIGradientDescent.getPositionValue(this.position) === 0 ? 1 : 0,
        };
        while (Map.getLand(this.position) === MapLand.OUTER) {
            updatePosition(this.position, stepsFromGoal);
        }

        const times = Math.floor(Math.random() * 6) + 2;
        for (let i = 0; i < times; i++) {
            updatePosition(this.position, stepsFromGoal);
        }
        while (Map.getLand(this.position) === MapLand.OUTER) {
            updatePosition(this.position, stepsFromGoal);
        }

        // Pull back before the finish if the search crossed it; recovery must not award a lap.
        const next = AIGradientDescent.getNextDirection(this.position);
        if (stepsFromGoal.value > 0) {
            this.position = sf.subtract(this.position, sf.multiply(next, stepsFromGoal.value + 2));
        }
        this.posAngle = Math.atan2(next.y, next.x);
    }
}
