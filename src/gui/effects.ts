import * as sf from "sfml.js";

/** Thunder, speed lines and top-half black fades. Await ready before drawing. */
export class Effects {
    private static readonly SPEED_UPDATE_TIME = sf.seconds(0.07);

    /** Five original speed-line frames and the textured viewport rectangle. */
    readonly speeds = Array.from({ length: 5 }, () => new sf.Texture());
    readonly speedEffect = new sf.RectangleShape();

    /** Speed duration, frame index and sf.Time frame countdown. */
    speedTime = 0;
    speedTexture = 0;
    speedUpdateTime = new sf.Time(Effects.SPEED_UPDATE_TIME);

    /** Full-window lightning and half-window fade overlays. */
    readonly whiteScreen = new sf.RectangleShape();
    readonly blackScreen = new sf.RectangleShape();

    /** Lightning flash and fade state, with durations in seconds. */
    drawThunder = false;
    thunderTime = 0;
    fadeTime = 0;
    fadeInitialTime = 0;
    fromBlack = false;

    /** Original public viewport and update fields. */
    winSize = new sf.Vector2u(0, 0);
    updateTime = 0;

    /** Completion of all five speed texture loads. */
    readonly ready: Promise<void>;

    /** Initialize overlays and begin loading speed-line artwork. */
    constructor() {
        this.whiteScreen.setFillColor(new sf.Color(255, 255, 255, 175));
        this.blackScreen.setFillColor(new sf.Color(0, 0, 0, 0));
        this.ready = this.initAssets();
    }

    private async initAssets(): Promise<void> {
        for (let i = 0; i < 5; i++) {
            const spriteFile = `assets/speed/pixel/speed${i}.png`;
            if (!await this.speeds[i].loadFromFile(spriteFile)) {
                throw new Error(`Unable to load speed effect: ${spriteFile}`);
            }
        }

        this.speedEffect.setTexture(this.speeds[0]);
    }

    /** Size lightning to the whole window and speed/fade to its top half. */
    setWindowSize(size: sf.Vector2u): void {
        this.whiteScreen.setSize(new sf.Vector2f(size));
        const topHalf = new sf.Vector2f(size.x, Math.trunc(size.y / 2));
        this.speedEffect.setSize(topHalf);
        this.blackScreen.setSize(topHalf);
    }

    /** Start a frame-alternating lightning flash for the given number of seconds. */
    thunder(time: number): void {
        this.thunderTime = time;
    }

    /** Show speed lines for the given number of seconds. */
    speed(time: number): void {
        this.speedTime = time;
    }

    /** Begin a timed fade from black or toward black without changing alpha immediately. */
    blackFade(time: number, fromBlack: boolean): void {
        this.fadeTime = time;
        this.fadeInitialTime = time;
        this.fromBlack = fromBlack;
    }

    /** Advance the original per-frame lightning and 70 ms speed-frame countdown. */
    update(deltaTime: sf.Time): void {
        // Flash frequency follows update calls; only its duration uses elapsed time.
        if (this.thunderTime > 0) {
            this.drawThunder = !this.drawThunder;
            this.thunderTime = Math.fround(this.thunderTime - deltaTime.asSeconds());
        } else {
            this.drawThunder = false;
        }

        if (this.fadeTime > 0) {
            this.fadeTime = Math.max(0, Math.fround(this.fadeTime - deltaTime.asSeconds()));

            // Remaining-time alpha fades from black; its complement fades toward black.
            const toBlack = this.fromBlack ? 0 : 1;
            const alpha = Math.trunc(Math.abs(this.fadeTime / this.fadeInitialTime - toBlack) * 255);
            this.blackScreen.setFillColor(new sf.Color(0, 0, 0, alpha));
        }

        // An expired countdown advances one frame on the next update, without catch-up.
        if (this.speedTime > 0) {
            if (sf.lessEqual(this.speedUpdateTime, sf.Time.Zero)) {
                this.speedUpdateTime = new sf.Time(Effects.SPEED_UPDATE_TIME);
                this.speedTexture = (this.speedTexture + 1) % 5;
                this.speedEffect.setTexture(this.speeds[this.speedTexture]);
            } else {
                this.speedUpdateTime = sf.subtract(this.speedUpdateTime, deltaTime);
            }
            this.speedTime = Math.fround(this.speedTime - deltaTime.asSeconds());
        }
    }

    /** Draw lightning, speed lines and then the persistent fade overlay. */
    draw(window: sf.RenderTarget): void {
        if (this.drawThunder) {
            window.draw(this.whiteScreen);
        }
        if (this.speedTime > 0) {
            window.draw(this.speedEffect);
        }
        window.draw(this.blackScreen);
    }

    /** Stop lightning and speed durations, retaining the current fade. */
    stop(): void {
        this.thunderTime = 0;
        this.speedTime = 0;
    }

    /** Stop transient effects and clear the fade overlay. */
    reset(): void {
        this.stop();
        this.fadeTime = 0;
        this.blackScreen.setFillColor(new sf.Color(0, 0, 0, 0));
    }
}
