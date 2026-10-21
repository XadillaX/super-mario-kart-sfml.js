import * as sf from 'sfml.js';
import { Item } from './item';
import type { CollisionData } from './collisiondata';
import { MAP_ASSETS_HEIGHT, MAP_ASSETS_WIDTH } from '../map/enums';

/** A four-frame sparkle effect drawn just ahead of the driver's billboard. */
export class EffectSparkles extends Item {
    private static readonly NUM_TEXTURES = 4;
    private static assetTextures = Array.from({ length: EffectSparkles.NUM_TEXTURES }, () => new sf.Texture());
    private static readonly TIME_BETWEEN_FRAMES = sf.seconds(0.04);
    private currentTime = sf.seconds(0);
    private currentFrame = 0;

    /** Preload all four sparkle regions. */
    static override async loadAssets(
        assetName: string, roi0: sf.IntRect, roi1: sf.IntRect, roi2: sf.IntRect, roi3: sf.IntRect,
    ): Promise<void> {
        const regions = [roi0, roi1, roi2, roi3];
        for (let i = 0; i < regions.length; i++) {
            if (!await EffectSparkles.assetTextures[i].loadFromFile(assetName, false, regions[i])) {
                throw new Error(`Unable to load sparkle-effect frame ${i}: ${assetName}`);
            }
        }
    }

    /** Place sparkles at normalized map coordinates. */
    constructor(position: sf.Vector2f) {
        super(new sf.Vector2f(
            position.x * MAP_ASSETS_WIDTH,
            position.y * MAP_ASSETS_HEIGHT,
        ), 1.05, 0, 0);
        this.setTexture(0);
    }

    private setTexture(frame: number): void {
        this.sprite = new sf.Sprite(EffectSparkles.assetTextures[frame]);
        const size = EffectSparkles.assetTextures[frame].getSize();
        this.sprite.setOrigin(new sf.Vector2f(size.x / 2, size.y / 1.5));
    }

    /** Advance one frame only when accumulated time exceeds 0.04 seconds. */
    override update(deltaTime: sf.Time): void {
        this.currentTime = sf.add(this.currentTime, deltaTime);
        if (sf.greater(this.currentTime, EffectSparkles.TIME_BETWEEN_FRAMES)) {
            this.currentFrame++;
            this.currentTime = sf.seconds(0);
            if (this.currentFrame >= EffectSparkles.NUM_TEXTURES) {
                this.used = true;
            } else {
                this.setTexture(this.currentFrame);
            }
        }
    }

    /** Sparkles never collide with drivers. */
    override solveCollision(
        _data: CollisionData, _otherSpeed: sf.Vector2f, _otherPos: sf.Vector2f,
        _otherWeight: number, _otherHeight: number, _otherIsImmune: boolean, _distance2: number,
    ): boolean {
        return false;
    }

    /** Original debug name. */
    name(): string {
        return 'EffectSparkles';
    }
}
