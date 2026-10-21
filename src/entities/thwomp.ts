import * as sf from 'sfml.js';
import { WallObject } from './wallobject';
import { CollisionType } from './collisiondata';
import type { CollisionData } from './collisiondata';
import { MAP_ASSETS_HEIGHT, MAP_ASSETS_WIDTH } from '../map/enums';

enum State {
    UP,
    DOWN,
    GOING_UP,
    GOING_DOWN,
}

/** A timed falling obstacle that can shove or crush passing drivers. */
export class Thwomp extends WallObject {
    private static readonly MAX_HEIGHT = 20;
    private static readonly STOMP_HEIGHT = 4;
    private static assetNormal = new sf.Texture();
    private static assetSuper = new sf.Texture();
    private sprite: sf.Sprite;
    private currentState = State.UP;
    private currentTime = 0;
    private isSuper: boolean;

    /** Preload the normal and super obstacle appearances. */
    static override async loadAssets(
        assetName: string, roiNormal: sf.IntRect, roiSuper: sf.IntRect,
    ): Promise<void> {
        if (!await Thwomp.assetNormal.loadFromFile(assetName, false, roiNormal) ||
            !await Thwomp.assetSuper.loadFromFile(assetName, false, roiSuper)) {
            throw new Error(`Unable to load Thwomp textures: ${assetName}`);
        }
    }

    /** Initialize a raised obstacle at source map pixel coordinates. */
    constructor(position: sf.Vector2f, isSuper: boolean) {
        super(position, 2.5, 1.5, Thwomp.MAX_HEIGHT, MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT);
        this.isSuper = isSuper;
        this.sprite = new sf.Sprite(isSuper ? Thwomp.assetSuper : Thwomp.assetNormal);
        const size = this.sprite.getTexture().getSize();
        this.sprite.setOrigin(new sf.Vector2f(size.x / 2, size.y));
    }

    /** Advance the four-state drop, rest, rise, and wait cycle. */
    override update(deltaTime: sf.Time): void {
        // Negative time is a dwell countdown; moving states reset it to elapsed seconds.
        this.currentTime += deltaTime.asSeconds();
        switch (this.currentState) {
            case State.UP:
                if (this.currentTime >= 0) {
                    this.currentState = State.GOING_DOWN;
                    this.currentTime = 0;
                }
                break;
            case State.GOING_DOWN:
                this.currentTime = Math.min(this.currentTime, 0.15);
                this.height = (0.15 - this.currentTime) * 4 * Thwomp.MAX_HEIGHT;
                if (this.currentTime === 0.15) {
                    this.currentState = State.DOWN;
                    this.currentTime = -(Math.floor(Math.random() * 3) + 2);
                }
                break;
            case State.DOWN:
                if (this.currentTime >= 0) {
                    this.currentState = State.GOING_UP;
                    this.currentTime = 0;
                }
                break;
            case State.GOING_UP:
                this.currentTime = Math.min(this.currentTime, 2);
                this.height = this.currentTime * Thwomp.MAX_HEIGHT / 2;
                if (this.currentTime === 2) {
                    this.currentState = State.UP;
                    this.currentTime = -(Math.floor(Math.random() * 5) + 2);
                    if (this.isSuper) {
                        this.currentTime *= 0.85;
                    }
                }
                break;
        }
    }

    /** Return the obstacle billboard. */
    getSprite(): sf.Sprite {
        return this.sprite;
    }

    /** Distinguish glancing impacts, immune passage, and inner-radius stomps. */
    override solveCollision(
        data: CollisionData,
        otherSpeed: sf.Vector2f,
        otherPos: sf.Vector2f,
        _otherWeight: number,
        otherHeight: number,
        otherIsImmune: boolean,
        distance2: number,
    ): boolean {
        if (WallObject.collisionHasHeightDifference(this.height, otherHeight)) {
            return false;
        }
        if (this.height > Thwomp.STOMP_HEIGHT) {
            return false;
        }

        // Edge contacts and fast crossings while grounded shove before immunity is considered.
        // Crushing is reserved for the inner radius during descent or a slow grounded overlap.
        const speedMod2 = otherSpeed.x ** 2 + otherSpeed.y ** 2;
        if (distance2 > this.hitboxRadius ** 2 ||
            (this.currentState !== State.GOING_DOWN &&
                (this.currentState !== State.DOWN || speedMod2 > 3e-3))) {
            return WallObject.defaultSolveCollision(data, otherSpeed, otherPos, this.position, distance2);
        }

        if (otherIsImmune) {
            data.momentum = new sf.Vector2f(0, 0);
            data.speedFactor = 1;
            data.type = CollisionType.NO_HIT;
            return true;
        }

        data.momentum = new sf.Vector2f(0, 0);
        data.speedFactor = 0;
        data.type = CollisionType.SMASH;
        return true;
    }
}
