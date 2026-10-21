import * as sf from "sfml.js";
import type { PowerUps } from "../entities/enums";
import { Effects } from "./effects";
import { ItemIndicator } from "./itemIndicator";
import { Others } from "./others";
import { Timer } from "./timer";

/**
 * Lazy HUD singleton. StateInitLoad must await loadAssets before gameplay.
 * Early resolution updates only cache dimensions and never construct asset users.
 */
export class Gui {
    private static singleton: Gui | undefined;
    private static pendingWindowSize = new sf.Vector2u(0, 0);
    private static hasWindowSize = false;

    /** Original HUD components, initialized only through loadAssets. */
    readonly timer = new Timer();
    readonly itemInd = new ItemIndicator();
    readonly others = new Others();
    readonly effects = new Effects();

    /** Latest requested window dimensions. */
    winSize = new sf.Vector2u(0, 0);

    /** All HUD constructor assets and deferred layout are ready. */
    readonly ready: Promise<void>;
    private assetsLoaded = false;

    private constructor() {
        this.ready = this.initAssets();
    }

    private async initAssets(): Promise<void> {
        await Promise.all([
            this.timer.ready, this.itemInd.ready, this.others.ready, this.effects.ready,
        ]);

        // Layout needs loaded sprite bounds; replay the latest size requested during preload.
        this.assetsLoaded = true;
        if (Gui.hasWindowSize) {
            this.applyWindowSize(Gui.pendingWindowSize);
        }
    }

    private static get instance(): Gui {
        if (!this.singleton?.assetsLoaded) {
            throw new Error("Await Gui.loadAssets() before accessing the HUD.");
        }
        return this.singleton;
    }

    /** Load constructor-owned HUD textures once; await this in StateInitLoad. */
    static loadAssets(): Promise<void> {
        return (this.singleton ??= new Gui()).ready;
    }

    /** Cache resolution before preload, or immediately resize an initialized HUD. */
    static setWindowSize(size: sf.Vector2u): void {
        this.pendingWindowSize = new sf.Vector2u(size);
        this.hasWindowSize = true;

        if (this.singleton?.assetsLoaded) {
            this.singleton.applyWindowSize(size);
        }
    }

    private applyWindowSize(size: sf.Vector2u): void {
        this.winSize = new sf.Vector2u(size);

        // The item anchor comes from the resized clock, so the timer must be laid out first.
        this.timer.setWindowSize(size);
        this.itemInd.setPosition(size, this.timer.getItemPos());

        this.others.setWindowSize(size);
        this.effects.setWindowSize(size);
    }

    /** Start the item roulette or clear the held item. */
    static setPowerUp(power: PowerUps): void {
        this.instance.itemInd.setItem(power);
    }

    /** Add/remove coins, clamped by the original counter. */
    static addCoin(amount = 1): void {
        this.instance.others.addCoin(amount);
    }

    /** Update the displayed race position. */
    static setRanking(rank: number): void {
        this.instance.others.setRanking(rank);
    }

    /** Start the original 0.2-second thunder flash. */
    static thunder(): void {
        this.instance.effects.thunder(0.2);
    }

    /** Start speed lines for the specified duration in seconds. */
    static speed(time: number): void {
        this.instance.effects.speed(time);
    }

    /** Fade the upper viewport from/toward black over the specified seconds. */
    static fade(time: number, fromBlack: boolean): void {
        this.instance.effects.blackFade(time, fromBlack);
    }

    /** Items become usable once the roulette has stopped. */
    static canUseItem(): boolean {
        return !this.instance.itemInd.spinning;
    }

    /** Test the original fade-alpha thresholds: >1 normally, >252 for total black. */
    static isBlackScreen(total = false): boolean {
        return this.instance.effects.blackScreen.getFillColor().a > (total ? 252 : 1);
    }

    /** Update clock, roulette, counters and effects in original order. */
    static update(deltaTime: sf.Time): void {
        const instance = this.instance;
        instance.timer.update(deltaTime);
        instance.itemInd.update(deltaTime);
        instance.others.update(deltaTime);
        instance.effects.update(deltaTime);
    }

    /** Draw effects behind the timer, item indicator and remaining HUD. */
    static draw(
        window: sf.RenderTarget, timerColor: sf.ReadonlyValue<sf.Color> = sf.Color.White,
    ): void {
        const instance = this.instance;
        instance.effects.draw(window);
        instance.timer.draw(window, timerColor);
        instance.itemInd.draw(window);
        instance.others.draw(window);
    }

    /** Emphasize the current rank at the end of a race. */
    static endRace(): void {
        const others = this.instance.others;
        others.setRanking(others.rank, true);
    }

    /** Reset a race HUD, optionally preserving its displayed rank. */
    static reset(rankReset = true): void {
        const instance = this.instance;
        instance.timer.reset();
        instance.others.reset(rankReset);
        instance.itemInd.reset();
        instance.effects.reset();
    }

    /** Stop thunder/speed effects without interrupting the current fade. */
    static stopEffects(): void {
        this.instance.effects.stop();
    }
}
