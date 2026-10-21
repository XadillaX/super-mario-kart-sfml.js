import * as sf from 'sfml.js';
import { Item } from './item';

/** The drifting, vertically bobbing character in the congratulations scene. */
export class FloatingFish extends Item {
    private static assetFishImage = new sf.Image();
    private static roi1L = new sf.IntRect();
    private static roi2L = new sf.IntRect();
    private static roi1R = new sf.IntRect();
    private static roi2R = new sf.IntRect();
    private static leftTextures: [sf.Texture, sf.Texture] = [new sf.Texture(), new sf.Texture()];
    private static rightTextures: [sf.Texture, sf.Texture] = [new sf.Texture(), new sf.Texture()];
    private assetFishTextures: [sf.Texture, sf.Texture];
    private totalTime = sf.seconds(0);
    private speed: sf.Vector2f;
    private usingFirstTexture = true;
    private flipped: boolean;

    /** Preload both mirrored appearances so scene constructors remain synchronous. */
    static override async loadAssets(
        assetName: string,
        roi1L: sf.IntRect,
        roi2L: sf.IntRect,
        roi1R: sf.IntRect,
        roi2R: sf.IntRect,
    ): Promise<void> {
        if (!await FloatingFish.assetFishImage.loadFromFile(assetName)) {
            throw new Error(`Unable to load floating animation: ${assetName}`);
        }
        FloatingFish.roi1L = new sf.IntRect(roi1L);
        FloatingFish.roi2L = new sf.IntRect(roi2L);
        FloatingFish.roi1R = new sf.IntRect(roi1R);
        FloatingFish.roi2R = new sf.IntRect(roi2R);
        const image = FloatingFish.assetFishImage;
        const leftRegions = [FloatingFish.roi1L, FloatingFish.roi2L];
        for (let i = 0; i < leftRegions.length; i++) {
            if (!FloatingFish.leftTextures[i].loadFromImage(image, false, leftRegions[i])) {
                throw new Error(`Unable to load floating-animation left frame ${i}: ${assetName}`);
            }
        }

        // Restore the shared image orientation even if loading a mirrored frame fails.
        image.flipHorizontally();
        try {
            const rightRegions = [FloatingFish.roi1R, FloatingFish.roi2R];
            for (let i = 0; i < rightRegions.length; i++) {
                if (!FloatingFish.rightTextures[i].loadFromImage(image, false, rightRegions[i])) {
                    throw new Error(`Unable to load floating-animation right frame ${i}: ${assetName}`);
                }
            }
        } finally {
            image.flipHorizontally();
        }
    }

    /** Capture velocity by value and select the preloaded orientation. */
    constructor(position: sf.Vector2f, speed: sf.Vector2f, flipped: boolean) {
        super(position, 0, 0, 0);
        this.speed = new sf.Vector2f(speed);
        this.flipped = flipped;
        this.assetFishTextures = this.flipped ? FloatingFish.rightTextures : FloatingFish.leftTextures;
        this.sprite = new sf.Sprite(this.assetFishTextures[0]);
        const size = this.sprite.getTexture().getSize();
        this.sprite.setOrigin(new sf.Vector2f(size.x / 2, size.y));
    }

    /** Preserve the source's delta-time frame toggle and accumulated sine motion. */
    override update(deltaTime: sf.Time): void {
        this.totalTime = sf.add(this.totalTime, deltaTime);
        this.position = sf.add(this.position, sf.multiply(this.speed, deltaTime.asSeconds()));
        this.height = Math.sin(this.totalTime.asSeconds()) * 6;

        if (sf.greater(deltaTime, sf.seconds(0.4))) {
            this.usingFirstTexture = !this.usingFirstTexture;
            this.sprite.setTexture(this.assetFishTextures[this.usingFirstTexture ? 0 : 1]);
            const size = this.sprite.getTexture().getSize();
            this.sprite.setOrigin(new sf.Vector2f(size.x / 2, size.y));
        }
    }

    /** Original debug name. */
    name(): string {
        return 'FloatingFish';
    }
}
