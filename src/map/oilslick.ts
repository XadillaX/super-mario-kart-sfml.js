import * as sf from "sfml.js";
import type { Driver } from "../entities/driver";
import {
    FloorObjectOrientation, FloorObjectState, MapLand,
    MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT,
} from "./enums";
import { FloorObject } from "./floorobject";

/** Permanent oil-slick terrain and its legacy direct interaction. */
export class OilSlick extends FloorObject {
    private static assets: sf.Image[] = [];

    protected getInitialState(): FloorObjectState {
        return FloorObjectState.NONE;
    }

    /** Loads the four oriented oil-slick images. */
    static async loadAssets(assetName: string, roi: sf.IntRect): Promise<void> {
        OilSlick.assets = await this.loadFrames(assetName, roi, FloorObjectOrientation.__COUNT);
    }

    /** Places an oil slick using raw map pixels. */
    constructor(topLeftPixels: sf.Vector2f, orientation: FloorObjectOrientation) {
        super(
            topLeftPixels, new sf.Vector2f(OilSlick.assets[orientation].getSize()),
            MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT, orientation,
        );
    }

    /** Updates the composited course and terrain grid. */
    applyChanges(): void {
        FloorObject.defaultApplyChanges(this);
    }

    /** Retains the original direct-interaction spin behavior. */
    interactWith(driver: Driver): void {
        driver.animator.hit();
        driver.posAngle += Math.PI / 32;
    }

    /** Returns the oriented oil-slick frame. */
    getCurrentImage(): sf.Image {
        return OilSlick.assets[this.orientation];
    }

    /** Oil slicks remain active terrain regardless of object state. */
    getCurrentLand(): MapLand {
        return MapLand.OIL_SLICK;
    }
}
