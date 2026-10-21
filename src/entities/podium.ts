import * as sf from 'sfml.js';
import { Item } from './item';

/** The stationary award podium shown in the congratulations scene. */
export class Podium extends Item {
    private static assetPodium = new sf.Texture();

    /** Preload the podium region before constructing the scene. */
    static override async loadAssets(assetName: string, roi: sf.IntRect): Promise<void> {
        if (!await Podium.assetPodium.loadFromFile(assetName, false, roi)) {
            throw new Error(`Unable to load podium: ${assetName}`);
        }
    }

    /** Place the podium using the original pixel-coordinate constructor. */
    constructor(position: sf.Vector2f) {
        super(position, 0, 0, 0);
        this.sprite = new sf.Sprite(Podium.assetPodium);
        const size = this.sprite.getTexture().getSize();
        this.sprite.setOrigin(new sf.Vector2f(size.x / 2, size.y * 0.9));
    }

    /** The source podium is stationary and has no update behavior. */
    override update(_deltaTime: sf.Time): void {}

    /** Original debug name. */
    name(): string {
        return 'Podium';
    }
}
