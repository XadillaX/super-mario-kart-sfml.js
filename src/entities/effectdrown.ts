import * as sf from 'sfml.js';
import { Item } from './item';
import type { CollisionData } from './collisiondata';
import { MAP_ASSETS_HEIGHT, MAP_ASSETS_WIDTH } from '../map/enums';

/** A five-frame tinted water or lava splash. */
export class EffectDrown extends Item {
    private static readonly NUM_TEXTURES = 5;
    private static assetTextures = Array.from({ length: EffectDrown.NUM_TEXTURES }, () => new sf.Texture());
    private static readonly TIME_BETWEEN_FRAMES = sf.seconds(0.2);
    private readonly tint: sf.Color;
    private currentTime = sf.seconds(0);
    private currentFrame = 0;

    /** Preload all five splash regions. */
    static override async loadAssets(
        assetName: string, roi0: sf.IntRect, roi1: sf.IntRect, roi2: sf.IntRect,
        roi3: sf.IntRect, roi4: sf.IntRect,
    ): Promise<void> {
        const regions = [roi0, roi1, roi2, roi3, roi4];
        for (let i = 0; i < regions.length; i++) {
            if (!await EffectDrown.assetTextures[i].loadFromFile(assetName, false, regions[i])) {
                throw new Error(`Unable to load drowning-effect frame ${i}: ${assetName}`);
            }
        }
    }

    /** Place the splash in normalized map coordinates with its material tint. */
    constructor(position: sf.Vector2f, tint: sf.Color) {
        super(new sf.Vector2f(
            position.x * MAP_ASSETS_WIDTH,
            position.y * MAP_ASSETS_HEIGHT,
        ), 1.05, 0, 0);
        this.tint = new sf.Color(tint);
        this.setTexture(0);
    }

    private setTexture(frame: number): void {
        this.sprite = new sf.Sprite(EffectDrown.assetTextures[frame]);
        const size = EffectDrown.assetTextures[frame].getSize();
        this.sprite.setOrigin(new sf.Vector2f(size.x / 2, frame < 3 ? size.y : size.y / 2));
        this.sprite.setColor(this.tint);
    }

    /** Advance at most one frame after the strict 0.2-second threshold. */
    override update(deltaTime: sf.Time): void {
        this.currentTime = sf.add(this.currentTime, deltaTime);
        if (sf.greater(this.currentTime, EffectDrown.TIME_BETWEEN_FRAMES)) {
            this.currentFrame++;
            this.currentTime = sf.seconds(0);
            if (this.currentFrame >= EffectDrown.NUM_TEXTURES) {
                this.used = true;
            } else {
                this.setTexture(this.currentFrame);
            }
        }
    }

    /** Splashes never collide with drivers. */
    override solveCollision(
        _data: CollisionData, _otherSpeed: sf.Vector2f, _otherPos: sf.Vector2f,
        _otherWeight: number, _otherHeight: number, _otherIsImmune: boolean, _distance2: number,
    ): boolean {
        return false;
    }

    /** Retain the original source's debug label, including its naming quirk. */
    name(): string {
        return 'EffectBreak';
    }
}
