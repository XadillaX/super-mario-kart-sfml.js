import * as sf from "sfml.js";
import type { Driver } from "../entities/driver";
import {
    FloorObjectOrientation, FloorObjectState, MapLand,
    MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT,
} from "./enums";
import { FloorObject } from "./floorobject";

/** Collectible course coin with a single shared inactive frame. */
export class Coin extends FloorObject {
    private static assetsActive: sf.Image[] = [];
    private static assetInactive: sf.Image;

    protected getInitialState(): FloorObjectState {
        return FloorObjectState.ACTIVE;
    }

    /** Loads the four oriented coin frames followed by the inactive frame. */
    static async loadAssets(assetName: string, roi: sf.IntRect): Promise<void> {
        const frames = await this.loadFrames(assetName, roi, FloorObjectOrientation.__COUNT + 1);
        Coin.assetsActive = frames.slice(0, FloorObjectOrientation.__COUNT);
        Coin.assetInactive = frames[FloorObjectOrientation.__COUNT];
    }

    /** Places a coin using raw map pixels. */
    constructor(topLeftPixels: sf.Vector2f, orientation: FloorObjectOrientation) {
        super(
            topLeftPixels, new sf.Vector2f(Coin.assetsActive[orientation].getSize()),
            MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT, orientation,
        );
    }

    /** Collects an active coin exactly once. */
    interactWith(driver: Driver): void {
        if (this.getState() === FloorObjectState.ACTIVE) {
            this.setState(FloorObjectState.INACTIVE);
            driver.addCoin();
        }
    }

    /** Updates the composited course and terrain grid. */
    applyChanges(): void {
        FloorObject.defaultApplyChanges(this);
    }

    /** Selects the active orientation or shared inactive frame. */
    getCurrentImage(): sf.Image {
        return this.getState() === FloorObjectState.ACTIVE
            ? Coin.assetsActive[this.orientation]
            : Coin.assetInactive;
    }

    /** Collected coins become ordinary track. */
    getCurrentLand(): MapLand {
        return this.getState() === FloorObjectState.ACTIVE ? MapLand.OTHER : MapLand.TRACK;
    }
}
