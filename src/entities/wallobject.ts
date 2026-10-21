import * as sf from 'sfml.js';
import { CollisionType } from './collisiondata';
import type { CollisionData } from './collisiondata';

/** Shared ownership of a world object is represented by its object reference. */
export type WallObjectPtr = WallObject;

/** Billboard object with normalized map coordinates and driver collisions. */
export abstract class WallObject {
    /** Shared ground-shadow texture, loaded before constructing world objects. */
    static assetShadow = new sf.Texture();
    /** Ground-shadow sprite for this object. */
    spriteShadow: sf.Sprite;
    /** Normalized map position. */
    position: sf.Vector2f;
    /** Visual sorting radius, normalized by the map width. */
    visualRadius: number;
    /** Collision radius, normalized by the map width. */
    hitboxRadius: number;
    /** Height above the track in the original simulation units. */
    height: number;

    /** Load the common shadow; subclasses use region arguments for their assets. */
    static async loadAssets(assetName: string, ..._regions: sf.IntRect[]): Promise<void> {
        if (!await WallObject.assetShadow.loadFromFile(assetName)) {
            throw new Error(`Unable to load wall-object shadow: ${assetName}`);
        }
    }

    /** Convert source pixel coordinates and radii into normalized map units. */
    constructor(
        position: sf.Vector2f,
        visualRadius: number,
        hitboxRadius: number,
        height: number,
        mapWidth: number,
        mapHeight: number,
    ) {
        this.position = new sf.Vector2f(position.x / mapWidth, position.y / mapHeight);
        this.visualRadius = visualRadius / mapWidth;
        this.hitboxRadius = hitboxRadius / mapWidth;
        this.height = height;

        this.spriteShadow = new sf.Sprite(WallObject.assetShadow);
        const size = WallObject.assetShadow.getSize();
        this.spriteShadow.setOrigin(new sf.Vector2f(size.x / 2, size.y));
    }

    /** Static obstacles have no per-frame simulation. */
    update(_deltaTime: sf.Time): void {}

    /** Return the billboard used by the map renderer. */
    abstract getSprite(): sf.Sprite;

    /** Objects more than 2.5 height units apart cannot collide. */
    static collisionHasHeightDifference(myHeight: number, otherHeight: number): boolean {
        return Math.abs(myHeight - otherHeight) > 2.5;
    }

    /** Write the source fixed-obstacle impulse into the caller's collision result. */
    static defaultSolveCollision(
        data: CollisionData,
        otherSpeed: sf.Vector2f,
        otherPos: sf.Vector2f,
        myPos: sf.Vector2f,
        distance2: number,
    ): boolean {
        // Normalize the outward separation and scale the shove by incoming speed.
        // The 0.05 bias separates slow contacts too; 35 tunes per-update displacement, not force.
        const speedModule = Math.sqrt(otherSpeed.x ** 2 + otherSpeed.y ** 2) + 0.05;
        const factor = speedModule / (35 * Math.sqrt(distance2));
        data.momentum = new sf.Vector2f(
            (otherPos.x - myPos.x) * factor,
            (otherPos.y - myPos.y) * factor,
        );

        data.speedFactor = 0.4;
        data.type = CollisionType.NO_HIT;
        return true;
    }

    /** Resolve a driver collision against a fixed obstacle at matching height. */
    solveCollision(
        data: CollisionData,
        otherSpeed: sf.Vector2f,
        otherPos: sf.Vector2f,
        _otherWeight: number,
        otherHeight: number,
        _otherIsImmune: boolean,
        distance2: number,
    ): boolean {
        if (WallObject.collisionHasHeightDifference(this.height, otherHeight)) {
            return false;
        }
        return WallObject.defaultSolveCollision(
            data, otherSpeed, otherPos, this.position, distance2,
        );
    }
}
