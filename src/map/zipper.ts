import * as sf from "sfml.js";
import type { Driver } from "../entities/driver";
import {
    FloorObjectOrientation, FloorObjectState, MapLand,
    MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT,
} from "./enums";
import { FloorObject } from "./floorobject";

/** Permanent speed-boost tile. */
export class Zipper extends FloorObject {
    private static assets: sf.Image[] = [];

    protected getInitialState(): FloorObjectState {
        return FloorObjectState.NONE;
    }

    /** Loads four adjacent oriented zipper frames. */
    static async loadAssets(assetName: string, roi: sf.IntRect): Promise<void> {
        Zipper.assets = await this.loadFrames(assetName, roi, FloorObjectOrientation.__COUNT);
    }

    /** Places a zipper using raw map pixels. */
    constructor(topLeftPixels: sf.Vector2f, orientation: FloorObjectOrientation) {
        super(
            topLeftPixels, new sf.Vector2f(Zipper.assets[orientation].getSize()),
            MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT, orientation,
        );
    }

    /** Updates the composited course and terrain grid. */
    applyChanges(): void {
        FloorObject.defaultApplyChanges(this);
    }

    /** Retains the original deprecated direct displacement interaction. */
    interactWith(driver: Driver): void {
        driver.position.x += driver.speedForward * Math.cos(driver.posAngle) * 0.2;
        driver.position.y += driver.speedForward * Math.sin(driver.posAngle) * 0.2;
    }

    /** Returns the oriented boost frame. */
    getCurrentImage(): sf.Image {
        return Zipper.assets[this.orientation];
    }

    /** Zippers always occupy boost terrain. */
    getCurrentLand(): MapLand {
        return MapLand.ZIPPER;
    }
}
