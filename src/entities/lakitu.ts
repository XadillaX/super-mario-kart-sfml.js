import * as sf from 'sfml.js';
import type { Driver } from './driver';
import { BASIC_WIDTH } from './enums';
import { Audio, SFX } from '../audio/audio';

/** Original Lakitu animation states and their numeric order. */
export enum LakituState {
    START,
    WRONG_DIR,
    LAP,
    FINISH,
    SLEEP,
    PICKUP,
    _COUNT,
}

/** Screen-space race marshal, semaphore, warning sign, and driver rescue. */
export class Lakitu {
    private static singleton: Lakitu | undefined;
    private static assetsReady: Promise<void> | undefined;

    private static get instance(): Lakitu {
        return this.singleton ??= new Lakitu();
    }

    /** Original nested-enum access for consumers. */
    static readonly LakituState = LakituState;
    /** Finish-flag animation textures. */
    finish = Array.from({ length: 3 }, () => new sf.Texture());
    /** Wrong-direction warning textures. */
    wrongDir = Array.from({ length: 2 }, () => new sf.Texture());
    /** Marshal holding a lap sign. */
    lakituLaps = new sf.Texture();
    /** Marshal holding the rescue fishing rod. */
    lakituCatchPlayer = new sf.Texture();
    /** Lap-sign textures; five slots preserve all source loader regions safely. */
    laps = Array.from({ length: 5 }, () => new sf.Texture());
    /** Countdown and start-release textures. */
    start = Array.from({ length: 2 }, () => new sf.Texture());
    /** Four traffic-light textures. */
    lights = Array.from({ length: 4 }, () => new sf.Texture());
    /** Main marshal sprite. */
    sprite: sf.Sprite;
    /** Lap-sign sprite. */
    signSprite = new sf.Sprite(new sf.Texture());
    /** Traffic-light sprite. */
    lightSprite = new sf.Sprite(new sf.Texture());
    /** Shared shadow appearance for this singleton. */
    assetShadow = new sf.Texture();
    /** Screen-space ground shadow. */
    spriteShadow: sf.Sprite;
    /** Driver currently attached to the rescue rod. */
    ptrDriver: Driver | null = null;
    /** Texture order of the four-frame flag animation. */
    readonly finishAnim = [0, 1, 2, 1];
    /** Current animation frame index. */
    textIndex = 0;
    /** Scale derived from the window's basic-width ratio. */
    sScale = 2;
    /** Animation arbitration priorities in state order. */
    animationPriorities = [8, 0, 5, 10, 0, 9];
    /** Active animation. */
    state = LakituState.SLEEP;
    /** Lap currently displayed. */
    lap = 2;
    /** Initial semaphore light index. */
    light = 0;
    /** Time spent in the current on-screen presentation. */
    screenTime = 0;
    /** Time accumulated in the wrong-direction sweep. */
    wrongTime = 0;
    /** Duration of the current animation frame. */
    nextFrameTime = 0.5;
    /** Accumulated animation-frame time. */
    frameTime = 0;
    /** Whether the countdown has released the racers. */
    started = false;
    /** Whether countdown audio has started. */
    soundStarted = false;
    /** Enable the projected ground shadow. */
    drawShadows = true;
    /** Priority retained by the currently active animation. */
    currentAnimationPriority = 0;
    /** Current rendering dimensions. */
    winSize = new sf.Vector2u(0, 0);

    private constructor() {
        this.sprite = new sf.Sprite(this.start[0]);
        this.spriteShadow = new sf.Sprite(this.assetShadow);
        this.sprite.setPosition(new sf.Vector2f(this.winSize.x / 4, -20));
        this.sprite.setScale(new sf.Vector2f(this.sScale, this.sScale));
        this.lightSprite.setPosition(new sf.Vector2f(-20, -20));
        this.signSprite.setPosition(new sf.Vector2f(-20, -20));
    }

    /** Await the original constructor's texture work during global asset initialization. */
    static async loadAssets(): Promise<void> {
        Lakitu.assetsReady ??= Lakitu.instance.loadTextures();
        await Lakitu.assetsReady;
    }

    private async loadTextures(): Promise<void> {
        const spriteFile = 'assets/misc/lakitu.png';
        const load = async (texture: sf.Texture, x: number, y: number, w: number, h: number): Promise<void> => {
            const roi = new sf.IntRect(new sf.Vector2i(x, y), new sf.Vector2i(w, h));
            if (!await texture.loadFromFile(spriteFile, false, roi)) {
                throw new Error(`Unable to load Lakitu region ${x},${y}: ${spriteFile}`);
            }
        };
        for (let i = 0; i < 3; i++) {
            await load(this.finish[i], 1 + i * 41, 1, 40, 32);
        }
        for (let i = 3; i < 5; i++) {
            await load(this.wrongDir[i - 3], 1 + i * 41, 1, 40, 32);
        }
        for (let i = 0; i < 5; i++) {
            await load(this.laps[i], 43 + i * 31, 76, 30, 16);
        }
        for (let i = 0; i < 2; i++) {
            await load(this.start[i], 1 + i * 42, 34, 40, 32);
        }
        for (let i = 0; i < 4; i++) {
            await load(this.lights[i], 168 + i * 9, 69, 8, 24);
        }
        await load(this.lakituLaps, 3, 68, 40, 32);
        await load(this.lakituCatchPlayer, 89, 34, 40, 32);
        if (!await this.assetShadow.loadFromFile('assets/misc/shadow.png')) {
            throw new Error('Unable to load Lakitu shadow');
        }

        this.spriteShadow.setTexture(this.assetShadow, true);
        const shadowSize = this.assetShadow.getSize();
        this.spriteShadow.setOrigin(new sf.Vector2f(shadowSize.x / 2, shadowSize.y));
        this.sprite.setTexture(this.start[0], true);
    }

    /** Set the screen dimensions and recompute the marshal's scale. */
    static setWindowSize(size: sf.Vector2u): void {
        const instance = Lakitu.instance;
        instance.winSize = new sf.Vector2u(size);
        instance.sprite.setPosition(new sf.Vector2f(instance.winSize.x / 4, -20));
        instance.sScale = 2 * size.x / BASIC_WIDTH;
    }

    /** Begin the semaphore presentation and reset its countdown. */
    static showStart(): void {
        const instance = Lakitu.instance;
        instance.frameTime = 0;
        instance.screenTime = 0;
        instance.textIndex = 0;
        instance.started = false;
        instance.state = LakituState.START;

        instance.sprite.setTexture(instance.start[0]);
        const size = instance.start[0].getSize();
        instance.sprite.setOrigin(new sf.Vector2f(Math.trunc(size.x / 2), Math.trunc(size.y / 2)));
        instance.sprite.setScale(new sf.Vector2f(-instance.sScale, instance.sScale));
        instance.sprite.setPosition(new sf.Vector2f(instance.winSize.x / 4, -20));

        instance.light = 0;
        instance.lightSprite.setTexture(instance.lights[instance.light], true);
        instance.lightSprite.setOrigin(new sf.Vector2f(
            Math.trunc(instance.lights[instance.light].getSize().x / 2), 0,
        ));
        instance.lightSprite.setScale(new sf.Vector2f(instance.sScale, instance.sScale));
        instance.nextFrameTime = 1;
        instance.currentAnimationPriority = instance.animationPriorities[LakituState.START];
    }

    /** Display a lap sign for original lap numbers two through five. */
    static showLap(numLap: number): void {
        const instance = Lakitu.instance;
        if (numLap <= 5 && numLap >= 2 && instance.animationPriorities[LakituState.LAP]) {
            instance.frameTime = 0;
            instance.screenTime = 0;
            instance.textIndex = 0;
            instance.state = LakituState.LAP;

            const bounds = instance.sprite.getLocalBounds();
            instance.sprite.setOrigin(new sf.Vector2f(bounds.size.x / 2, bounds.size.y / 2));
            instance.signSprite.setTexture(instance.laps[numLap - 2], true);
            const signBounds = instance.signSprite.getLocalBounds();
            instance.signSprite.setOrigin(new sf.Vector2f(signBounds.size.x / 2, signBounds.size.y / 2));
            instance.signSprite.setScale(new sf.Vector2f(instance.sScale, instance.sScale));

            instance.lap = numLap;
            instance.nextFrameTime = 0.5;
            instance.currentAnimationPriority = instance.animationPriorities[LakituState.LAP];
        }
    }

    /** Start the finish-flag sweep. */
    static showFinish(): void {
        const instance = Lakitu.instance;
        instance.frameTime = 0;
        instance.screenTime = 0;
        instance.textIndex = 0;
        instance.started = false;
        instance.state = LakituState.FINISH;

        const size = instance.finish[0].getSize();
        instance.sprite.setOrigin(new sf.Vector2f(size.x / 1.5, Math.trunc(size.y / 2)));
        instance.sprite.setPosition(new sf.Vector2f(0, 0));
        instance.nextFrameTime = 0.5;
        instance.currentAnimationPriority = instance.animationPriorities[LakituState.FINISH];
    }

    /** Start or stop wrong-direction warnings according to the original priority gate. */
    static setWrongDir(wrongDir: boolean): void {
        const instance = Lakitu.instance;
        if (wrongDir && instance.currentAnimationPriority <= instance.animationPriorities[LakituState.WRONG_DIR]) {
            if (instance.state !== LakituState.WRONG_DIR) {
                instance.currentAnimationPriority = instance.animationPriorities[LakituState.WRONG_DIR];
                Audio.play(SFX.CIRCUIT_LAKITU_WARNING, true);
                instance.state = LakituState.WRONG_DIR;
                const size = instance.wrongDir[0].getSize();
                instance.sprite.setOrigin(new sf.Vector2f(size.x / 1.5, Math.trunc(size.y / 2)));
                instance.sprite.setPosition(new sf.Vector2f(0, 0));
                instance.nextFrameTime = 0.5;
            }
        } else if (instance.state === LakituState.WRONG_DIR) {
            Audio.stop(SFX.CIRCUIT_LAKITU_WARNING);
            Lakitu.sleep();
        }
    }

    /** Attach an eligible driver to the rescue rod and begin lowering it. */
    static pickUpDriver(driver: Driver): void {
        const instance = Lakitu.instance;
        if (instance.currentAnimationPriority <= instance.animationPriorities[LakituState.PICKUP]) {
            Lakitu.sleep();
            instance.frameTime = 0;
            instance.screenTime = 0;
            instance.textIndex = 0;
            instance.state = LakituState.PICKUP;

            instance.sprite.setTexture(instance.lakituCatchPlayer);
            instance.sprite.setPosition(new sf.Vector2f(
                instance.winSize.x / 2 - instance.sprite.getGlobalBounds().size.x / 2.25, -40,
            ));

            // Attachment transfers height control from Driver's gravity to this screen-space animation.
            instance.ptrDriver = driver;
            driver.onLakitu = true;
            instance.nextFrameTime = 0.5;
            instance.currentAnimationPriority = instance.animationPriorities[LakituState.PICKUP];
        }
    }

    /** Report whether the starting lights have released racers. */
    static hasStarted(): boolean {
        return Lakitu.instance.started;
    }

    /** Report whether no animation is currently shown. */
    static isSleeping(): boolean {
        return Lakitu.instance.state === LakituState.SLEEP;
    }

    /** Hide the marshal and stop warning audio, retaining the original priority behavior. */
    static sleep(): void {
        const instance = Lakitu.instance;
        Audio.stop(SFX.CIRCUIT_LAKITU_WARNING);
        const size = instance.start[0].getSize();
        instance.sprite.setOrigin(new sf.Vector2f(Math.trunc(size.x / 2), Math.trunc(size.y / 2)));
        instance.state = LakituState.SLEEP;
        instance.sprite.setPosition(new sf.Vector2f(-20, -20));
        instance.screenTime = 0;
        instance.textIndex = 0;
        instance.started = false;
    }

    /** End a timed presentation only after its original strict expiration threshold. */
    static showUntil(seconds: number, _deltaTime: sf.Time): void {
        const instance = Lakitu.instance;
        if (instance.screenTime > seconds) {
            instance.state = LakituState.SLEEP;
            instance.screenTime = 0;
            instance.textIndex = 0;
            instance.currentAnimationPriority = 0;
            instance.started = false;
        }
    }

    /** Advance the current presentation, retaining fixed-update pixel motion. */
    static update(deltaTime: sf.Time): void {
        const instance = Lakitu.instance;
        switch (instance.state) {
            case LakituState.START: {
                // Descent is pixel-stepped; the timed light sequence begins only after arrival.
                if (instance.sprite.getPosition().y < Math.trunc(instance.winSize.y / 2 / 3) && !instance.started) {
                    instance.textIndex = 0;
                    instance.sprite.move(new sf.Vector2f(0, 2));
                } else {
                    if (!instance.soundStarted) {
                        Audio.play(SFX.CIRCUIT_LAKITU_SEMAPHORE);
                        instance.soundStarted = true;
                    }

                    instance.frameTime += deltaTime.asSeconds();
                    if (instance.frameTime >= instance.nextFrameTime) {
                        instance.textIndex++;
                        instance.frameTime = 0;
                    }
                    if (instance.textIndex > 1 && instance.textIndex < 5) {
                        instance.lightSprite.setTexture(instance.lights[instance.textIndex - 1]);
                    }
                    if (instance.textIndex >= 4) {
                        instance.sprite.setTexture(instance.start[1]);
                        instance.started = true;
                    }
                    instance.screenTime += deltaTime.asSeconds();
                    Lakitu.showUntil(10, deltaTime);
                }

                // Release the racers at frame four, then retreat one frame later.
                if (instance.started && instance.textIndex >= 5) {
                    instance.sprite.move(new sf.Vector2f(0, -2));
                }
                const pos = instance.sprite.getPosition();
                const bounds = instance.sprite.getGlobalBounds();
                instance.lightSprite.setPosition(new sf.Vector2f(
                    pos.x + bounds.size.x / 2 * (instance.textIndex >= 4 ? 1 : 0.95), pos.y,
                ));
                break;
            }
            case LakituState.PICKUP: {
                const driver = instance.ptrDriver;
                if (driver === null) {
                    throw new Error('Lakitu pickup state requires an attached driver');
                }

                if (instance.sprite.getPosition().y < Math.trunc(instance.winSize.y / 2 / 5) && driver.onLakitu) {
                    instance.textIndex = 0;
                    instance.sprite.move(new sf.Vector2f(0, 2));
                } else {
                    instance.frameTime += deltaTime.asSeconds();
                    if (instance.frameTime >= instance.nextFrameTime) {
                        instance.textIndex++;
                        instance.frameTime = 0;
                    }

                    // Advance past the release frame immediately so the coin penalty runs only once.
                    if (instance.textIndex === 1) {
                        const { DriverState } = require('./driver') as typeof import('./driver');
                        instance.textIndex++;
                        driver.onLakitu = false;
                        driver.addCoin(-2);
                        driver.popStateEnd(DriverState.STOPPED);
                    }
                    instance.screenTime += deltaTime.asSeconds();
                    Lakitu.showUntil(8, deltaTime);
                }

                if (!driver.onLakitu) {
                    instance.sprite.move(new sf.Vector2f(0, -1));
                }
                const pos = instance.sprite.getPosition();
                const bounds = instance.sprite.getGlobalBounds();
                if (driver.onLakitu) {
                    // Undo render scaling and the eight-pixel height factor to keep the kart on the rod.
                    const scaleFactor = instance.winSize.x / BASIC_WIDTH;
                    const driverY = driver.animator.sprite.getLocalBounds().size.y * 1.6 * scaleFactor;
                    driver.height = ((instance.winSize.y / 2 - pos.y - bounds.size.y - driverY) / 8) / scaleFactor;
                }
                break;
            }
            case LakituState.FINISH: {
                instance.sprite.setTexture(instance.finish[instance.finishAnim[instance.textIndex % 4]]);
                instance.frameTime += deltaTime.asSeconds();
                if (instance.frameTime >= instance.nextFrameTime) {
                    instance.textIndex++;
                    instance.frameTime = 0;
                }

                // Normalize the six-second sweep, then bend its vertical path with a parabola.
                const x = instance.screenTime / 6;
                const y = -(x * x) / 4 - 0.1;
                instance.sprite.setPosition(new sf.Vector2f(
                    x * instance.winSize.x, y * instance.winSize.y + Math.trunc(instance.winSize.y / 3),
                ));
                instance.screenTime += deltaTime.asSeconds();
                Lakitu.showUntil(6, deltaTime);
                break;
            }
            case LakituState.WRONG_DIR: {
                instance.sprite.setTexture(instance.wrongDir[instance.textIndex % 2]);
                instance.frameTime += deltaTime.asSeconds();
                if (instance.frameTime >= instance.nextFrameTime) {
                    instance.textIndex++;
                    instance.frameTime = 0;
                }

                // Fold the second five-second leg back over the first for a left-right sweep.
                let time = instance.wrongTime;
                if (instance.wrongTime > 5 && instance.wrongTime < 10) {
                    time = 5 - (instance.wrongTime - 5);
                } else if (instance.wrongTime >= 10) {
                    instance.wrongTime = 0;
                }

                let x = time / 5;
                const y = instance.winSize.y * 0.2;
                instance.screenTime += deltaTime.asSeconds();
                instance.wrongTime += deltaTime.asSeconds();
                if (x > 1) {
                    x = 0;
                }
                instance.sprite.setPosition(new sf.Vector2f(
                    x * instance.winSize.x / 3 + Math.trunc(instance.winSize.x / 3), y,
                ));
                break;
            }
            case LakituState.LAP: {
                instance.sprite.setTexture(instance.lakituLaps);
                const x = instance.screenTime / 5;
                const y = -(x * x) / 4 - 0.1;
                instance.sprite.setPosition(new sf.Vector2f(
                    x * instance.winSize.x, y * instance.winSize.y + Math.trunc(instance.winSize.y / 3),
                ));

                const pos = instance.sprite.getPosition();
                instance.signSprite.setPosition(new sf.Vector2f(pos.x + 5, pos.y - 17));
                instance.screenTime += deltaTime.asSeconds();
                Lakitu.showUntil(5, deltaTime);
                break;
            }
            case LakituState.SLEEP:
            default:
                break;
        }
    }

    /** Draw the projected shadow with the original height-derived alpha. */
    static drawShadow(window: sf.RenderTarget): void {
        const instance = Lakitu.instance;
        const pos = instance.sprite.getPosition();
        if (instance.drawShadows && pos.y > 0) {
            const y = instance.winSize.y * 0.45;
            const alpha = Math.trunc(255 * pos.y / y) & 0xff;
            instance.spriteShadow.setColor(new sf.Color(255, 255, 255, alpha));
            instance.spriteShadow.setPosition(new sf.Vector2f(pos.x, y));
            instance.spriteShadow.setScale(new sf.Vector2f(instance.sScale / 1.5, instance.sScale / 1.5));
            window.draw(instance.spriteShadow);
        }
    }

    /** Draw the active marshal and its traffic light or lap sign. */
    static draw(window: sf.RenderTarget): void {
        const instance = Lakitu.instance;
        if (instance.state !== LakituState.SLEEP) {
            window.draw(instance.sprite);
            if (instance.state === LakituState.START) {
                window.draw(instance.lightSprite);
            } else if (instance.state === LakituState.LAP) {
                window.draw(instance.signSprite);
            }
        }
    }

    /** Reset race-local animation and audio flags. */
    static reset(): void {
        const instance = Lakitu.instance;
        Lakitu.setWrongDir(false);
        Lakitu.sleep();
        instance.frameTime = 0;
        instance.lap = 2;
        instance.light = 0;
        instance.started = false;
        instance.soundStarted = false;
        instance.currentAnimationPriority = 0;
    }
}
