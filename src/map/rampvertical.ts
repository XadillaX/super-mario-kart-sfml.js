import * as sf from "sfml.js";
import type { Driver } from "../entities/driver";
import {
    FloorObjectOrientation, FloorObjectState, MapLand,
    MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT,
} from "./enums";
import { FloorObject } from "./floorobject";

/** Vertical ramp assembled from top, repeated middle, and bottom tiles. */
export class RampVertical extends FloorObject {
    private static assets: sf.Image[] = [];
    private readonly completeAsset: sf.Image;

    protected getInitialState(): FloorObjectState {
        return FloorObjectState.ACTIVE;
    }

    /** Loads the three eight-pixel ramp segments. */
    static async loadAssets(assetName: string, roi: sf.IntRect): Promise<void> {
        RampVertical.assets = await this.loadFrames(assetName, roi, 3);
    }

    /** Composes a ramp at the requested pixel position and size. */
    constructor(
        topLeftPixels: sf.Vector2f,
        orientation: FloorObjectOrientation,
        size: sf.Vector2f,
    ) {
        super(topLeftPixels, size, MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT, orientation);
        this.completeAsset = new sf.Image(new sf.Vector2u(size));
        this.completeAsset.copy(RampVertical.assets[0], new sf.Vector2u(0, 0));
        for (let i = 8; i < size.y - 8; i += 8) {
            this.completeAsset.copy(RampVertical.assets[1], new sf.Vector2u(0, i));
        }
        this.completeAsset.copy(RampVertical.assets[2], new sf.Vector2u(0, size.y - 8));
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

    /** Vertical ramps produce jumps along the X axis. */
    getCurrentLand(): MapLand {
        return MapLand.RAMP_VERTICAL;
    }
}
