import * as sf from "sfml.js";
import { BASIC_WIDTH } from "../entities/enums";

/** Six-digit race clock. Await ready before updating or drawing. */
export class Timer {
    /** Individual digit, apostrophe and custom punctuation textures. */
    readonly digits = Array.from({ length: 10 }, () => new sf.Texture());
    readonly comas = Array.from({ length: 2 }, () => new sf.Texture());
    readonly custom = Array.from({ length: 3 }, () => new sf.Texture());

    /** Sprites are populated only after their textures finish loading. */
    readonly timerDigits: sf.Sprite[] = [];
    readonly timerCommas: sf.Sprite[] = [];

    /** Clock origin, viewport and accumulated race duration. */
    leftUpCorner = new sf.Vector2f(0, 0);
    winSize = new sf.Vector2u(0, 0);
    time = new sf.Time();

    /** Horizontal-resolution multiplier and original sprite scale. */
    factor = 0;
    scaleFactor = new sf.Vector2f(2, 2);

    /** Completion of constructor asset loading. */
    readonly ready: Promise<void>;
    private assetsLoaded = false;
    private hasWindowSize = false;

    /** Begin asynchronous loading of the original clock sprite sheet. */
    constructor() {
        this.ready = this.initAssets();
    }

    private async initAssets(): Promise<void> {
        const spriteFile = "assets/gui/digits.png";

        // Every crop is eight pixels wide, but the custom symbols have a wider atlas stride.
        const groups: readonly (readonly [sf.Texture[], number, number])[] = [
            [this.digits, 0, 9], [this.comas, 90, 9], [this.custom, 137, 11],
        ];
        for (const [textures, start, step] of groups) {
            for (let i = 0; i < textures.length; i++) {
                const roi = new sf.IntRect(
                    new sf.Vector2i(start + i * step, 0), new sf.Vector2i(8, 14),
                );
                if (!await textures[i].loadFromFile(spriteFile, false, roi)) {
                    throw new Error(`Unable to load timer texture: ${spriteFile}`);
                }
            }
        }

        for (let i = 0; i < 6; i++) {
            const sprite = new sf.Sprite(this.digits[0]);
            sprite.scale(this.scaleFactor);
            this.timerDigits.push(sprite);
        }
        for (const texture of this.comas) {
            const sprite = new sf.Sprite(texture);
            sprite.scale(this.scaleFactor);
            this.timerCommas.push(sprite);
        }

        this.assetsLoaded = true;
        if (this.hasWindowSize) {
            this.setWindowSize(this.winSize);
        }
    }

    /** Return the item-indicator anchor beside the clock. */
    getItemPos(): sf.Vector2f {
        return new sf.Vector2f(
            this.leftUpCorner.x,
            this.leftUpCorner.y + this.timerDigits[0].getGlobalBounds().size.y / 2,
        );
    }

    /** Resize the clock, retaining C++ integer truncation in pixel placement. */
    setWindowSize(size: sf.Vector2u): void {
        this.winSize = new sf.Vector2u(size);
        this.hasWindowSize = true;
        if (!this.assetsLoaded) {
            return;
        }

        // Scale first so measurements below reflect the requested resolution.
        this.factor = this.winSize.x / BASIC_WIDTH;
        const scale = new sf.Vector2f(
            this.scaleFactor.x * this.factor, this.scaleFactor.y * this.factor,
        );
        for (const sprite of [...this.timerDigits, ...this.timerCommas]) {
            sprite.setScale(scale);
        }

        // Reserve eight cells from the right margin, retaining integer pixel spacing.
        const separationPixels = Math.trunc(2 * this.factor);
        const spriteWidth = Math.trunc(this.timerDigits[0].getGlobalBounds().size.x);
        this.leftUpCorner = new sf.Vector2f(
            Math.trunc(size.x * 98 / 100), Math.trunc(size.y * 2 / 100),
        );
        let x = Math.trunc(this.leftUpCorner.x - 8 * (spriteWidth + separationPixels));
        this.leftUpCorner.x = x;

        // Punctuation occupies slots 2 and 5; only the other slots consume digit sprites.
        let digitIndex = 0;
        for (let i = 0; i < 8; i++) {
            const position = new sf.Vector2f(x, this.leftUpCorner.y);
            if (i === 2) {
                this.timerCommas[0].setPosition(position);
            } else if (i === 5) {
                this.timerCommas[1].setPosition(position);
            } else {
                this.timerDigits[digitIndex++].setPosition(position);
            }
            x += spriteWidth + separationPixels;
        }
    }

    /** Accumulate sf.Time and display minutes, seconds and hundredths. */
    update(deltaTime: sf.Time): void {
        this.time = sf.add(this.time, deltaTime);
        let milliseconds = this.time.asMilliseconds();
        const minutes = Math.trunc(milliseconds / 60000);
        milliseconds -= minutes * 60000;
        const seconds = Math.trunc(milliseconds / 1000);
        milliseconds -= seconds * 1000;
        const hundredths = Math.trunc(milliseconds / 10);

        const values = [
            Math.trunc(minutes / 10), minutes % 10,
            Math.trunc(seconds / 10), seconds % 10,
            Math.trunc(hundredths / 10), hundredths % 10,
        ];
        for (let i = 0; i < values.length; i++) {
            this.timerDigits[i].setTexture(this.digits[values[i]]);
        }
    }

    /** Draw all clock glyphs with the requested tint. */
    draw(window: sf.RenderTarget, color: sf.ReadonlyValue<sf.Color>): void {
        for (const sprite of [...this.timerDigits, ...this.timerCommas]) {
            sprite.setColor(color);
            window.draw(sprite);
        }
    }

    /** Zero the elapsed time and all displayed digits. */
    reset(): void {
        this.time = new sf.Time();
        for (const sprite of this.timerDigits) {
            sprite.setTexture(this.digits[0]);
        }
    }
}
