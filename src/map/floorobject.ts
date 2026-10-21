import * as sf from "sfml.js";
import type { Driver } from "../entities/driver";
import { FloorObjectOrientation, FloorObjectState, MapLand } from "./enums";
import { Map } from "./map";

/** Reference to a floor object, corresponding to the C++ shared pointer. */
export type FloorObjectPtr = FloorObject;

/** Common normalized hitbox and deferred terrain/image updates. */
export abstract class FloorObject {
    /** Image-compositing origin in source pixels, independent of window resolution. */
    protected readonly topLeftPixel: sf.Vector2f;
    /** Collision area in the same normalized coordinates used by drivers. */
    protected readonly hitbox: sf.FloatRect;
    protected readonly orientation: FloorObjectOrientation;
    protected state = FloorObjectState.INITIAL;

    /** Batch terrain and image changes so the race rebuilds its minimap once per update. */
    protected static changesQueue: FloorObject[] = [];

    /** Copies pixel coordinates and derives the normalized collision rectangle. */
    constructor(
        position: sf.Vector2f,
        size: sf.Vector2f,
        mapWidth: number,
        mapHeight: number,
        orientation: FloorObjectOrientation,
    ) {
        this.topLeftPixel = new sf.Vector2f(position);
        this.hitbox = new sf.FloatRect(
            new sf.Vector2f(position.x / mapWidth, position.y / mapHeight),
            new sf.Vector2f(size.x / mapWidth, size.y / mapHeight),
        );
        this.orientation = orientation;
    }

    protected abstract getInitialState(): FloorObjectState;

    /** Reads adjacent sprite-sheet frames without retaining the raw sheet. */
    protected static async loadFrames(
        assetName: string,
        roi: sf.IntRect,
        count: number,
    ): Promise<sf.Image[]> {
        const rawImage = new sf.Image();
        if (!await rawImage.loadFromFile(assetName)) {
            throw new Error(`Unable to load floor-object image '${assetName}'`);
        }

        const area = new sf.IntRect(roi);
        const images: sf.Image[] = [];
        for (let i = 0; i < count; i++) {
            const image = new sf.Image(new sf.Vector2u(area.size));
            image.copy(rawImage, new sf.Vector2u(0, 0), area);
            images.push(image);
            area.position.x += area.size.x;
        }
        return images;
    }

    /** Returns the current state without applying queued changes. */
    getState(): FloorObjectState {
        return this.state;
    }

    /** Changes state and queues the corresponding image and terrain updates. */
    setState(state: FloorObjectState): void {
        // Change state immediately: a second driver in this update cannot collect it again.
        this.state = state === FloorObjectState.INITIAL ? this.getInitialState() : state;
        FloorObject.changesQueue.push(this);
    }

    /** Applies this object's state to the map. */
    abstract applyChanges(): void;

    /** Copies the current sprite onto the course and updates its terrain cells. */
    static defaultApplyChanges(object: FloorObject): void {
        Map.updateAssetCourse(object.getCurrentImage(), object.topLeftPixel);
        Map.setLand(
            new sf.Vector2f(object.hitbox.position),
            new sf.Vector2f(object.getCurrentImage().getSize()),
            object.getCurrentLand(),
        );
    }

    /** Tests the driver's point position, excluding the rectangle's far edges. */
    collidesWith(driver: Driver): boolean {
        return this.hitbox.contains(driver.position);
    }

    /** Applies the object's gameplay interaction to the driver. */
    abstract interactWith(driver: Driver): void;

    /** Returns the image for the current orientation and state. */
    abstract getCurrentImage(): sf.Image;

    /** Returns the terrain value occupied by the current object state. */
    abstract getCurrentLand(): MapLand;

    /** Legacy point sampler; updates the caller's color object when inside. */
    sampleColor(mapCoordinates: sf.Vector2f, color: sf.Color): boolean {
        const image = this.getCurrentImage();
        const x = (mapCoordinates.x - this.hitbox.position.x) / this.hitbox.size.x;
        const y = (mapCoordinates.y - this.hitbox.position.y) / this.hitbox.size.y;
        if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
            const size = image.getSize();
            const sampled = image.getPixel(new sf.Vector2u(x * size.x, y * size.y));
            color.r = sampled.r;
            color.g = sampled.g;
            color.b = sampled.b;
            color.a = sampled.a;
            return true;
        }
        return false;
    }

    /** Applies every queued change and reports whether the map changed. */
    static applyAllChanges(): boolean {
        if (FloorObject.changesQueue.length === 0) {
            return false;
        }

        for (const object of FloorObject.changesQueue) {
            object.applyChanges();
        }
        FloorObject.changesQueue.length = 0;
        return true;
    }

    /** Discards queued objects when switching courses. */
    static resetChanges(): void {
        FloorObject.changesQueue.length = 0;
    }
}
