import * as sf from "sfml.js";
import { BASIC_WIDTH } from "../entities/enums";
import { TextUtils } from "./textutils";

/** Coin counter and animated placement number. Await ready before sprite use. */
export class Others {
    /** Coin artwork and display sprite. */
    readonly coinTx = new sf.Texture();
    coin!: sf.Sprite;

    /** Rank artwork, including all four blue cells written by the original loader. */
    readonly ranks = Array.from({ length: 8 }, () => new sf.Texture());
    readonly ranksBlue = Array.from({ length: 4 }, () => new sf.Texture());
    readonly ranksBlue2 = Array.from({ length: 4 }, () => new sf.Texture());
    rankSprite!: sf.Sprite;

    /** Cached layout coordinates and viewport size. */
    rightDownCorner = new sf.Vector2f(0, 0);
    winSize = new sf.Vector2u(0, 0);
    txtPos = new sf.Vector2f(0, 0);

    /** White, blue and cyan cycle for top-four rankings. */
    colours = [[255, 255, 255], [0, 0, 255], [0, 255, 255]];
    colorIndex = 0;

    /** Coin total, formatted text and original zero-initialized singleton rank. */
    coins = 0;
    strCoins = "00";
    rank = 0;

    /** Color countdown in seconds and original artwork scales. */
    updateTime = 0.1;
    coinScale = 1.5;
    rankScale = 3;
    simbolScale = 2;
    factor = 1;

    /** Completion of all constructor texture loads. */
    readonly ready: Promise<void>;

    /** Begin loading the coin and all rank cells. */
    constructor() {
        this.ready = this.initAssets();
    }

    private async initAssets(): Promise<void> {
        const coinRoi = new sf.IntRect(new sf.Vector2i(90, 62), new sf.Vector2i(10, 14));
        if (!await this.coinTx.loadFromFile("assets/gui/letters.png", false, coinRoi)) {
            throw new Error("Unable to load coin texture: assets/gui/letters.png");
        }

        const spriteFile = "assets/gui/ranks.png";
        const groups: readonly (readonly [sf.Texture[], number, number])[] = [
            [this.ranks, 0, 0], [this.ranksBlue, 0, 21], [this.ranksBlue2, 68, 21],
        ];
        for (const [textures, x, y] of groups) {
            for (let i = 0; i < textures.length; i++) {
                const roi = new sf.IntRect(
                    new sf.Vector2i(x + i * 17, y), new sf.Vector2i(16, 20),
                );
                if (!await textures[i].loadFromFile(spriteFile, false, roi)) {
                    throw new Error(`Unable to load rank texture: ${spriteFile}`);
                }
            }
        }

        // Bottom-right origins let the HUD pack these sprites from right to left.
        this.coin = new sf.Sprite(this.coinTx);
        this.coin.scale(new sf.Vector2f(this.coinScale, this.coinScale));
        this.coin.setOrigin(this.coin.getLocalBounds().size);
        this.rankSprite = new sf.Sprite(this.ranks[7]);
        this.rankSprite.setScale(new sf.Vector2f(this.rankScale, this.rankScale));
        this.rankSprite.setColor(new sf.Color(255, 255, 255, 180));
        this.rankSprite.setOrigin(this.rankSprite.getLocalBounds().size);
    }

    /** Clamp the updated coin total to the original inclusive range [0, 10]. */
    addCoin(amount = 1): void {
        this.coins = Math.max(0, Math.min(10, this.coins + amount));
    }

    /** Select rank 1-8 and enlarge it when improving or explicitly requested. */
    setRanking(rank: number, scale = false): void {
        rank = Math.max(1, Math.min(8, rank));
        this.rankSprite.setTexture(this.ranks[rank - 1]);
        if (rank < this.rank || scale) {
            const enlarged = 2.5 * this.rankScale * this.factor;
            this.rankSprite.setScale(new sf.Vector2f(enlarged, enlarged));
        }
        this.rank = rank;
    }

    /** Lay out the counter and rank using the original integer pixel assignments. */
    setWindowSize(size: sf.Vector2u): void {
        this.winSize = new sf.Vector2u(size);
        this.factor = this.winSize.x / BASIC_WIDTH;

        this.rankSprite.setScale(new sf.Vector2f(
            this.rankScale * this.factor, this.rankScale * this.factor,
        ));
        this.coin.setScale(new sf.Vector2f(
            this.coinScale * this.factor, this.coinScale * this.factor,
        ));
        this.simbolScale = 2 * this.factor;

        // Place the rank first, then reserve space to its left for the count and coin.
        // Truncate each step to preserve the original integer-pixel layout.
        this.rightDownCorner = new sf.Vector2f(
            Math.trunc(size.x * 95 / 100), Math.trunc(size.y * 45 / 100),
        );
        let x = Math.trunc(this.rightDownCorner.x);
        const y = Math.trunc(this.rightDownCorner.y);
        this.rankSprite.setPosition(new sf.Vector2f(x, y));

        x = Math.trunc(x - this.rankSprite.getGlobalBounds().size.x - 6 * this.factor);
        this.txtPos = new sf.Vector2f(x, y);

        x = Math.trunc(x - 17 * 3 * this.factor);
        this.coin.setPosition(new sf.Vector2f(x - this.coin.getGlobalBounds().size.x / 2, y));
    }

    /** Format coins, shrink an enlarged rank by 5% per frame and cycle its color. */
    update(deltaTime: sf.Time): void {
        this.updateTime = Math.fround(this.updateTime - deltaTime.asSeconds());
        this.strCoins = String(this.coins).padStart(2, "0");

        // Rank emphasis decays per update, independently of the timed color cycle below.
        const baseScale = this.rankScale * this.factor;
        if (this.rankSprite.getScale().x > baseScale) {
            this.rankSprite.scale(new sf.Vector2f(0.95, 0.95));
            if (this.rankSprite.getScale().x < baseScale) {
                this.rankSprite.setScale(new sf.Vector2f(baseScale, baseScale));
            }
        }

        if (this.updateTime <= 0) {
            let index = 0;
            if (this.rank <= 4) {
                this.colorIndex = (this.colorIndex + 1) % 3;
                index = this.colorIndex;
            }
            const [r, g, b] = this.colours[index];
            this.rankSprite.setColor(new sf.Color(r, g, b, 180));
            this.updateTime = 0.1;
        }
    }

    /** Draw the placement, coin icon and right/bottom-aligned count. */
    draw(window: sf.RenderTarget): void {
        window.draw(this.rankSprite);
        window.draw(this.coin);
        TextUtils.write(
            window, `x${this.strCoins}`, this.txtPos, this.simbolScale,
            sf.Color.Black, true, TextUtils.TextAlign.RIGHT, TextUtils.TextVerticalAlign.BOTTOM,
        );
    }

    /** Reset coins/color/scale, optionally restoring the displayed eighth-place cell. */
    reset(rankReset: boolean): void {
        this.coins = 0;
        this.strCoins = "00";

        const [r, g, b] = this.colours[0];
        this.rankSprite.setColor(new sf.Color(r, g, b, 180));
        const scale = this.rankScale * this.factor;
        this.rankSprite.setScale(new sf.Vector2f(scale, scale));
        if (rankReset) {
            this.rankSprite.setTexture(this.ranks[7]);
        }
    }
}
