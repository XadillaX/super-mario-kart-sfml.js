import * as sf from 'sfml.js';
import { WallObject } from './wallobject';
import { MAP_ASSETS_HEIGHT, MAP_ASSETS_WIDTH } from '../map/enums';

/** A fixed pipe using the shared obstacle collision response. */
export class Pipe extends WallObject {
    private static assetGreenTexture = new sf.Texture();
    private static assetOrangeTexture = new sf.Texture();
    private sprite: sf.Sprite;

    /** Preload both pipe colors from the object sheet. */
    static override async loadAssets(
        assetName: string, roiGreen: sf.IntRect, roiOrange: sf.IntRect,
    ): Promise<void> {
        if (!await Pipe.assetGreenTexture.loadFromFile(assetName, false, roiGreen) ||
            !await Pipe.assetOrangeTexture.loadFromFile(assetName, false, roiOrange)) {
            throw new Error(`Unable to load pipe textures: ${assetName}`);
        }
    }

    /** Place a green or orange pipe at source map pixel coordinates. */
    constructor(position: sf.Vector2f, greenNotOrange: boolean) {
        super(position, 2.5, 2, 0, MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT);
        this.sprite = new sf.Sprite(greenNotOrange ? Pipe.assetGreenTexture : Pipe.assetOrangeTexture);
        const size = this.sprite.getTexture().getSize();
        this.sprite.setOrigin(new sf.Vector2f(size.x / 2, size.y));
    }

    /** Return the pipe billboard. */
    getSprite(): sf.Sprite {
        return this.sprite;
    }
}
