import * as sf from 'sfml.js';
import { Item } from './item';
import type { Driver } from './driver';
import type { CollisionData } from './collisiondata';
import { DriverControlType } from './enums';
import { Audio, SFX } from '../audio/audio';
import { MAP_ASSETS_HEIGHT, MAP_ASSETS_WIDTH } from '../map/enums';

/** A delayed spinning coin that follows a gain or flies away on a loss. */
export class EffectCoin extends Item {
    private static readonly JUMP_SPEED = 110;
    private static readonly GRAVITY = -9.8 * 35;
    private static readonly NUM_TEXTURES = 4;
    private static assetTextures = Array.from({ length: EffectCoin.NUM_TEXTURES }, () => new sf.Texture());
    private static readonly TIME_BETWEEN_FRAMES = sf.seconds(0.05);

    private readonly driver: Driver;
    private relativeHeight = 2;
    private delay: sf.Time;
    private readonly positive: boolean;
    private verticalSpeed = EffectCoin.JUMP_SPEED;
    private speedForward: number;
    private posAngle: number;
    private currentTime = sf.seconds(0);
    private currentFrame = 0;
    private once = true;

    /** Preload the three source frames and the flipped fourth frame. */
    static override async loadAssets(
        assetName: string, roi0: sf.IntRect, roi1: sf.IntRect, roi2: sf.IntRect,
    ): Promise<void> {
        const regions = [roi0, roi1, roi2];
        for (let i = 0; i < regions.length; i++) {
            if (!await EffectCoin.assetTextures[i].loadFromFile(assetName, false, regions[i])) {
                throw new Error(`Unable to load coin-effect frame ${i}: ${assetName}`);
            }
        }

        const image = new sf.Image();
        if (!await image.loadFromFile(assetName)) {
            throw new Error(`Unable to load flipped coin-effect image: ${assetName}`);
        }
        image.flipHorizontally();
        if (!EffectCoin.assetTextures[3].loadFromImage(image, false, roi1)) {
            throw new Error(`Unable to load flipped coin-effect frame: ${assetName}`);
        }
    }

    /** Capture the source velocity and heading; keep the driver for height and follow motion. */
    constructor(driver: Driver, delay: sf.Time, positive: boolean) {
        super(new sf.Vector2f(
            driver.position.x * MAP_ASSETS_WIDTH,
            driver.position.y * MAP_ASSETS_HEIGHT,
        ), -0.5, 0, driver.height);
        this.driver = driver;
        this.delay = new sf.Time(delay);
        this.positive = positive;
        this.speedForward = 0.05 + driver.speedForward * 2;
        this.posAngle = driver.posAngle;
    }

    private setTexture(frame: number): void {
        this.sprite = new sf.Sprite(EffectCoin.assetTextures[frame]);
        const size = EffectCoin.assetTextures[frame].getSize();
        this.sprite.setOrigin(new sf.Vector2f(size.x / 2, size.y));
    }

    /** Advance the original delay, jump, single-step animation, and one-shot sound. */
    override update(deltaTime: sf.Time): void {
        this.currentTime = sf.add(this.currentTime, deltaTime);
        if (sf.less(this.currentTime, this.delay)) {
            return;
        } else if (this.delay.asMicroseconds() > 0n) {
            // The stagger delay and spin animation share a clock; discard delay overshoot at activation.
            this.currentTime = sf.seconds(0);
            this.delay = sf.seconds(0);
            this.setTexture(0);
        }

        let mult = 1;
        if (this.positive) {
            this.position = new sf.Vector2f(this.driver.position);
        } else {
            const factor = this.speedForward * deltaTime.asSeconds();
            this.position = sf.add(this.position, new sf.Vector2f(
                Math.cos(this.posAngle) * factor, Math.sin(this.posAngle) * factor,
            ));
            mult += 0.5;
        }

        // Both effects remain height-relative to the driver; lost coins fall faster and drift away.
        this.verticalSpeed += EffectCoin.GRAVITY * deltaTime.asSeconds() * mult;
        this.relativeHeight += this.verticalSpeed * deltaTime.asSeconds();
        this.height = this.driver.height + this.relativeHeight;
        if (this.relativeHeight < 0) {
            this.used = true;
        }

        if (sf.greater(this.currentTime, EffectCoin.TIME_BETWEEN_FRAMES)) {
            this.currentFrame = (this.currentFrame + 1) % EffectCoin.NUM_TEXTURES;
            this.currentTime = sf.seconds(0);
            if (this.currentFrame >= EffectCoin.NUM_TEXTURES) {
                this.used = true;
            } else {
                this.setTexture(this.currentFrame);
            }
        }

        // Play once after activation, not while waiting for a staggered coin's delay.
        if (this.once) {
            this.once = false;
            if (this.driver.controlType === DriverControlType.PLAYER) {
                Audio.play(SFX.CIRCUIT_COIN);
            }
        }
    }

    /** Coin effects never collide with drivers. */
    override solveCollision(
        _data: CollisionData, _otherSpeed: sf.Vector2f, _otherPos: sf.Vector2f,
        _otherWeight: number, _otherHeight: number, _otherIsImmune: boolean, _distance2: number,
    ): boolean {
        return false;
    }

    /** Original debug name. */
    name(): string {
        return 'EffectCoin';
    }
}
