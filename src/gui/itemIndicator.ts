import * as sf from "sfml.js";
import { Audio, SFX } from "../audio/audio";
import { BASIC_WIDTH, PowerUps } from "../entities/enums";

/** Item roulette and held-item display. Await ready before using its sprite. */
export class ItemIndicator {
    /** All eight original item cells; index zero is empty. */
    readonly items = Array.from({ length: 8 }, () => new sf.Texture());
    /** The display sprite, initialized when ready resolves. */
    indicator!: sf.Sprite;

    /** Original public layout fields. */
    rightUpCorner = new sf.Vector2u(0, 0);
    winSize = new sf.Vector2u(0, 0);

    /** Roulette state and target, using the original PowerUps indices. */
    selectedItem = 0;
    selectedFinalItem = 0;
    timeAcc = 0;
    spinning = false;

    /** Original two-times artwork scale. */
    scaleFactor = new sf.Vector2f(2, 2);

    /** Completion of constructor texture and sprite initialization. */
    readonly ready: Promise<void>;

    /** Begin loading all cells of the original item sprite sheet. */
    constructor() {
        this.ready = this.initAssets();
    }

    private async initAssets(): Promise<void> {
        const spriteFile = "assets/gui/items.png";

        // The 26-pixel cells are separated by a one-pixel gutter in the atlas.
        for (let i = 0; i < 8; i++) {
            const roi = new sf.IntRect(new sf.Vector2i(i * 27, 0), new sf.Vector2i(26, 18));
            if (!await this.items[i].loadFromFile(spriteFile, false, roi)) {
                throw new Error(`Unable to load item indicator: ${spriteFile}`);
            }
        }

        this.indicator = new sf.Sprite(this.items[this.selectedItem]);
        this.indicator.setPosition(new sf.Vector2f(0, 0));
        this.indicator.scale(this.scaleFactor);
        const size = this.indicator.getLocalBounds().size;
        this.indicator.setOrigin(new sf.Vector2f(size.x / 2, size.y / 2));
    }

    /** Position left of the supplied clock anchor without mutating the caller's vector. */
    setPosition(winSize: sf.Vector2u, position: sf.Vector2f): void {
        const factor = winSize.x / BASIC_WIDTH;
        this.indicator.setScale(new sf.Vector2f(
            this.scaleFactor.x * factor, this.scaleFactor.y * factor,
        ));

        // Measure after scaling: the centered sprite must clear the clock by the scaled gap.
        this.indicator.setPosition(new sf.Vector2f(
            position.x - this.indicator.getGlobalBounds().size.x / 2 -
                5 * this.scaleFactor.y * factor,
            position.y,
        ));
    }

    /** Start the original roulette, or immediately display the empty cell. */
    setItem(id: PowerUps): void {
        if (id !== PowerUps.NONE) {
            this.spinning = true;
            this.selectedItem = 0;
            this.selectedFinalItem = id % 8;
        } else {
            this.selectedItem = 0;
            this.selectedFinalItem = 0;
            this.indicator.setTexture(this.items[this.selectedFinalItem]);
        }
    }

    /** Advance once per frame and finish strictly after two accumulated seconds. */
    update(deltaTime: sf.Time): void {
        if (this.spinning) {
            // Cycling is frame-driven; elapsed seconds only decide when to reveal the prize.
            this.timeAcc = Math.fround(this.timeAcc + deltaTime.asSeconds());
            this.selectedItem = ((this.selectedItem + 1) % 7) + 1;
            this.indicator.setTexture(this.items[this.selectedItem]);

            if (this.timeAcc > 2) {
                this.spinning = false;
                Audio.play(SFX.CIRCUIT_ITEM_GET);
                this.indicator.setTexture(this.items[this.selectedFinalItem]);

                this.selectedFinalItem = 0;
                this.selectedItem = 0;
                this.timeAcc = 0;
            }
        }
    }

    /** Draw the currently selected item cell. */
    draw(window: sf.RenderTarget): void {
        window.draw(this.indicator);
    }

    /** Clear the selection, preserving the original spinning/timeAcc reset semantics. */
    reset(): void {
        this.selectedFinalItem = 0;
        this.selectedItem = 0;
        this.indicator.setTexture(this.items[this.selectedFinalItem]);
    }
}
