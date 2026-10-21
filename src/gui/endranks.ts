import * as sf from "sfml.js";
import type { RaceRankingArray } from "../entities/enums";
import { NUM_LAPS_IN_CIRCUIT } from "../map/enums";

/** JavaScript reference equivalent of the original shared EndRanks pointer. */
export type EndRanksPtr = EndRanks;

/** Finished-driver ranking overlay with frame-counted number and face animation. */
export class EndRanks {
    private static readonly NUM_TEXTURES = 8;
    private static readonly NORMAL_WIDTH = 256;
    private static readonly NORMAL_HEIGHT = 224;
    private static readonly ABS_POSITION = new sf.Vector2f(16 / 256, 44.5 / 224);

    private static assetsHappy: sf.Texture[] = [];
    private static assetsSad: sf.Texture[] = [];
    private static assetsNormal: sf.Texture[] = [];
    private static numbersBlack: sf.Texture[] = [];
    private static numbersYellow: sf.Texture[] = [];
    private static numbersRed: sf.Texture[] = [];

    private static FACE_DY = 0;
    private static NUMBER_DX = 0;
    private static ranks: RaceRankingArray | null = null;
    private static framesSinceOrigin = 0;

    /** Load all eight faces and numbers from copied, independently stepped rectangles. */
    static async loadAssets(
        assetName: string,
        roiHappy0: sf.IntRect,
        roiSad0: sf.IntRect,
        roiNormal0: sf.IntRect,
        roiFaceDY: number,
        roiBlack0: sf.IntRect,
        roiYellow0: sf.IntRect,
        roiRed0: sf.IntRect,
        roiNumberDX: number,
    ): Promise<void> {
        const faces = [roiHappy0, roiSad0, roiNormal0].map(roi => new sf.IntRect(roi));
        const numbers = [roiBlack0, roiYellow0, roiRed0].map(roi => new sf.IntRect(roi));

        const makeTextures = (): sf.Texture[] =>
            Array.from({ length: this.NUM_TEXTURES }, () => new sf.Texture());
        this.assetsHappy = makeTextures();
        this.assetsSad = makeTextures();
        this.assetsNormal = makeTextures();
        this.numbersBlack = makeTextures();
        this.numbersYellow = makeTextures();
        this.numbersRed = makeTextures();

        // Reuse the atlas spacing as normalized offsets when laying out the overlay.
        this.FACE_DY = Math.fround(roiFaceDY / this.NORMAL_HEIGHT);
        this.NUMBER_DX = Math.fround(roiNumberDX / this.NORMAL_WIDTH);

        // Each expression runs down a column; each number color runs across a row.
        const faceTextures = [this.assetsHappy, this.assetsSad, this.assetsNormal];
        const numberTextures = [this.numbersBlack, this.numbersYellow, this.numbersRed];
        for (let i = 0; i < this.NUM_TEXTURES; i++) {
            for (let expression = 0; expression < faces.length; expression++) {
                if (!await faceTextures[expression][i].loadFromFile(assetName, false, faces[expression])) {
                    throw new Error(`Unable to load ranking face ${i}: ${assetName}`);
                }
                faces[expression].position.y += roiFaceDY;
            }

            for (let color = 0; color < numbers.length; color++) {
                if (!await numberTextures[color][i].loadFromFile(assetName, false, numbers[color])) {
                    throw new Error(`Unable to load ranking number ${i}: ${assetName}`);
                }
                numbers[color].position.x += roiNumberDX;
            }
        }
    }

    /** Count update frames only while a ranking array is attached. */
    static update(_deltaTime: sf.Time): void {
        if (this.ranks === null) {
            return;
        }
        this.framesSinceOrigin = (this.framesSinceOrigin + 1) >>> 0;
    }

    /** Draw consecutive finishers, stopping at the first driver still racing. */
    static draw(window: sf.RenderTarget): void {
        if (this.ranks === null) {
            return;
        }

        const windowSize = window.getSize();
        const scale = windowSize.x / this.NORMAL_WIDTH;
        const position = new sf.Vector2f(this.ABS_POSITION);

        for (let i = 0; i < this.ranks.length; i++) {
            const driver = this.ranks[i];
            if (driver.getLaps() <= NUM_LAPS_IN_CIRCUIT) {
                break;
            }

            // Top-four numbers change color every four updates, not elapsed seconds.
            const numberFrame = Math.trunc(this.framesSinceOrigin / 4) % 3;
            let numberTexture: sf.Texture;
            if (i >= 4 || numberFrame === 0) {
                numberTexture = this.numbersBlack[i];
            } else if (numberFrame === 1) {
                numberTexture = this.numbersYellow[i];
            } else {
                numberTexture = this.numbersRed[i];
            }

            const numberSprite = new sf.Sprite(numberTexture);
            numberSprite.setPosition(new sf.Vector2f(
                position.x * windowSize.x, position.y * windowSize.y,
            ));
            numberSprite.setScale(new sf.Vector2f(scale, scale));
            window.draw(numberSprite);

            // Faces use character IDs, while number textures use finishing places.
            const driverId = driver.getPj();
            let faceTexture: sf.Texture;
            if (i >= 4) {
                faceTexture = this.assetsSad[driverId];
            } else if (Math.trunc(this.framesSinceOrigin / 15) % 2 === 0) {
                faceTexture = this.assetsNormal[driverId];
            } else {
                faceTexture = this.assetsHappy[driverId];
            }

            const driverSprite = new sf.Sprite(faceTexture);
            driverSprite.setPosition(new sf.Vector2f(
                (position.x + this.NUMBER_DX) * windowSize.x, position.y * windowSize.y,
            ));
            driverSprite.setScale(new sf.Vector2f(scale, scale));
            window.draw(driverSprite);
            position.y += this.FACE_DY;
        }
    }

    /** Keep the live ranking reference, or detach it with null, and restart animation. */
    static reset(ranks: RaceRankingArray | null): void {
        this.ranks = ranks;
        this.framesSinceOrigin = 0;
    }
}
