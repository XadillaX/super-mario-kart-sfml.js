import * as sf from "sfml.js";
import type { Driver } from "../entities/driver";
import {
    FloorObjectOrientation, FloorObjectState, MapLand,
    MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT,
} from "./enums";
import { FloorObject } from "./floorobject";

/** Horizontal ramp assembled from left, repeated middle, and right tiles. */
export class RampHorizontal extends FloorObject {
    private static assets: sf.Image[] = [];
    private readonly completeAsset: sf.Image;

    protected getInitialState(): FloorObjectState {
        return FloorObjectState.ACTIVE;
    }

    /** Loads the three eight-pixel ramp segments. */
    static async loadAssets(assetName: string, roi: sf.IntRect): Promise<void> {
        RampHorizontal.assets = await this.loadFrames(assetName, roi, 3);
    }

    /** Composes a ramp at the requested pixel position and size. */
    constructor(
        topLeftPixels: sf.Vector2f,
        orientation: FloorObjectOrientation,
        size: sf.Vector2f,
    ) {
        super(topLeftPixels, size, MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT, orientation);
        this.completeAsset = new sf.Image(new sf.Vector2u(size));
        this.completeAsset.copy(RampHorizontal.assets[0], new sf.Vector2u(0, 0));
        for (let i = 8; i < size.x - 8; i += 8) {
            this.completeAsset.copy(RampHorizontal.assets[1], new sf.Vector2u(i, 0));
        }
        this.completeAsset.copy(RampHorizontal.assets[2], new sf.Vector2u(size.x - 8, 0));
    }

    /** Updates the composited course and terrain grid. */
    applyChanges(): void {
        FloorObject.defaultApplyChanges(this);
    }

    /** Ramp jumps are handled through terrain sampling, not direct interaction. */
    interactWith(_driver: Driver): void {
        // The original direct-interaction hook intentionally has no effect.
    }

    /** Returns the full composed ramp image. */
    getCurrentImage(): sf.Image {
        return this.completeAsset;
    }

    /** Horizontal ramps produce jumps along the Y axis. */
    getCurrentLand(): MapLand {
        return MapLand.RAMP_HORIZONTAL;
    }
}
