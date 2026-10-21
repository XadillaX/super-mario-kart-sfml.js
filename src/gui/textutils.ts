import * as sf from "sfml.js";

/** Original menu palette, applied to the font's alpha-mask layer. */
export const Color = {
    Default: new sf.Color(81, 142, 225),
    MenuPrimary: new sf.Color(40, 71, 112),
    MenuPrimaryOnFocus: new sf.Color(0, 105, 255),
    MenuSecondary: new sf.Color(214, 0, 214),
    MenuActive: sf.Color.Green,
} as const;

/** Resolve a supported lowercase glyph; unsupported characters use the question mark. */
export function getCharIndex(character: string): number {
    // Atlas order is 26 letters, ten digits, then the punctuation cells below.
    const code = character.charCodeAt(0);
    if (character >= "a" && character <= "z") {
        return code - "a".charCodeAt(0);
    }
    if (character >= "0" && character <= "9") {
        return 26 + code - "0".charCodeAt(0);
    }

    switch (character) {
        case ".": return 36;
        case "(": return 37;
        case ")": return 38;
        case "?": return 39;
        case "!": return 40;
        case "'": return 41;
        case '"': return 42;
        case "-": return 43;
        case ">": return 44;
        case "<": return 45;
        default: return 39;
    }
}

/** Two-layer bitmap text renderer; loadAssets must resolve before write is called. */
export class TextUtils {
    /** Original glyph size, without the one-pixel spacing. */
    static readonly CHAR_SIZE = 8;
    private static readonly NUM_CHARS = 46;
    private static singleton: TextUtils | undefined;
    private readonly charactersFlat = Array.from(
        { length: TextUtils.NUM_CHARS }, () => new sf.Texture(),
    );
    private readonly charactersShadow = Array.from(
        { length: TextUtils.NUM_CHARS }, () => new sf.Texture(),
    );
    private readonly charactersFlatAlpha = Array.from(
        { length: TextUtils.NUM_CHARS }, () => new sf.Texture(),
    );
    private readonly charactersShadowAlpha = Array.from(
        { length: TextUtils.NUM_CHARS }, () => new sf.Texture(),
    );
    private assetsLoaded = false;

    private constructor() {}

    private static get instance(): TextUtils {
        return this.singleton ??= new TextUtils();
    }

    /** Load both font sheets and extract every flat/shadow glyph and tint mask. */
    static async loadAssets(
        assetName: string,
        alphaName: string,
        startFlat: sf.Vector2i,
        startShadow: sf.Vector2i,
    ): Promise<void> {
        const instance = this.instance;
        const raw = new sf.Image();
        const alpha = new sf.Image();
        if (!await raw.loadFromFile(assetName)) {
            throw new Error(`Unable to load font image: ${assetName}`);
        }
        if (!await alpha.loadFromFile(alphaName)) {
            throw new Error(`Unable to load font alpha image: ${alphaName}`);
        }

        const size = new sf.Vector2i(8, 8);
        let posFlat = new sf.Vector2i(startFlat);
        let posShadow = new sf.Vector2i(startShadow);
        for (let i = 1; i <= this.NUM_CHARS; i++) {
            const flatRoi = new sf.IntRect(posFlat, size);
            const shadowRoi = new sf.IntRect(posShadow, size);

            // Base artwork and tint masks share coordinates in their respective sheets.
            const cells: readonly (readonly [sf.Texture, sf.Image, sf.IntRect])[] = [
                [instance.charactersFlat[i - 1], raw, flatRoi],
                [instance.charactersFlatAlpha[i - 1], alpha, flatRoi],
                [instance.charactersShadow[i - 1], raw, shadowRoi],
                [instance.charactersShadowAlpha[i - 1], alpha, shadowRoi],
            ];
            for (const [texture, image, roi] of cells) {
                if (!await texture.loadFromImage(image, false, roi)) {
                    throw new Error(`Unable to extract font glyph ${i - 1}: ${assetName}`);
                }
            }

            // Letters fill two rows of 13; digits and punctuation continue on the third.
            // The one-based loop count makes row breaks fall just after glyphs 13 and 26.
            posFlat.x += size.x + 1;
            posShadow.x += size.x + 1;
            if (i % 13 === 0 && i < 27) {
                const movement = (size.y + 1) * i / 13;
                posFlat = new sf.Vector2i(startFlat.x, startFlat.y + movement);
                posShadow = new sf.Vector2i(startShadow.x, startShadow.y + movement);
            }
        }

        instance.assetsLoaded = true;
    }

    private static getChar(character: string, useFlatFont: boolean): sf.Texture {
        const instance = this.instance;
        const index = getCharIndex(character);
        return useFlatFont ? instance.charactersFlat[index] : instance.charactersShadow[index];
    }

    private static getCharAlpha(character: string, useFlatFont: boolean): sf.Texture {
        const instance = this.instance;
        const index = getCharIndex(character);
        return useFlatFont ? instance.charactersFlatAlpha[index] : instance.charactersShadowAlpha[index];
    }

    /**
     * Draw lowercase bitmap text in pixel coordinates using the original alignment rules.
     * Each non-space character draws its base first, then the colored alpha layer.
     */
    static write(
        window: sf.RenderTarget,
        text: string,
        position: sf.Vector2f,
        scale: number,
        color: sf.ReadonlyValue<sf.Color> = Color.Default,
        useFlatFont = true,
        align: TextUtils.TextAlign = TextUtils.TextAlign.LEFT,
        alignV: TextUtils.TextVerticalAlign = TextUtils.TextVerticalAlign.TOP,
    ): void {
        const instance = this.instance;
        if (!instance.assetsLoaded) {
            throw new Error("Await TextUtils.loadAssets() before drawing text.");
        }

        // Alignment includes spaces and trailing glyph spacing, not just visible ink.
        const cursor = new sf.Vector2f(position);
        const glyphSize = instance.charactersFlat[0].getSize();
        const advance = glyphSize.x + 1;
        const textWidth = advance * scale * text.length;
        const textHeight = glyphSize.y * scale;

        if (align === TextUtils.TextAlign.CENTER) {
            cursor.x -= textWidth / 2;
        } else if (align === TextUtils.TextAlign.RIGHT) {
            cursor.x -= textWidth;
        }

        if (alignV === TextUtils.TextVerticalAlign.MIDDLE) {
            cursor.y -= textHeight / 2;
        } else if (alignV === TextUtils.TextVerticalAlign.BOTTOM) {
            cursor.y -= textHeight;
        }

        for (const character of text) {
            if (character !== " ") {
                const sprite = new sf.Sprite(this.getChar(character, useFlatFont));
                sprite.setPosition(cursor);
                sprite.setScale(new sf.Vector2f(scale, scale));
                window.draw(sprite);

                // Tint only the mask, preserving the base artwork and any shadow beneath it.
                sprite.setTexture(this.getCharAlpha(character, useFlatFont));
                sprite.setColor(color);
                window.draw(sprite);
            }
            cursor.x += advance * scale;
        }
    }
}

/** Original nested alignment enums, usable both as values and parameter types. */
export namespace TextUtils {
    /** Horizontal alignment of the full string, including its trailing spacing. */
    export enum TextAlign {
        CENTER,
        LEFT,
        RIGHT,
    }

    /** Vertical alignment of an eight-pixel font cell. */
    export enum TextVerticalAlign {
        TOP,
        MIDDLE,
        BOTTOM,
    }
}
