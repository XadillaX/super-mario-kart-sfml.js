import * as sf from 'sfml.js';
import { CollisionData } from './collisiondata';
import { Driver } from './driver';
import { Item } from './item';
import type { WallObject } from './wallobject';

/** Eight-by-eight broad-phase grid for drivers, items and fixed obstacles. */
export class CollisionHashMap {
    private static readonly NUM_DIVISIONS = 8;
    private static singleton: CollisionHashMap | undefined;

    private static get instance(): CollisionHashMap {
        return this.singleton ??= new CollisionHashMap();
    }

    private readonly staticMap = Array.from(
        { length: CollisionHashMap.NUM_DIVISIONS ** 2 }, () => new Set<WallObject>(),
    );
    private readonly dynamicMap = Array.from(
        { length: CollisionHashMap.NUM_DIVISIONS ** 2 }, () => new Set<WallObject>(),
    );

    private constructor() {}

    private static hash(pos: sf.Vector2f): number {
        const divisions = this.NUM_DIVISIONS;
        // Preserve the source's unsigned conversion before clamping to an edge bucket.
        const hashX = Math.min(Math.trunc(pos.x * divisions) >>> 0, divisions - 1);
        const hashY = Math.min(Math.trunc(pos.y * divisions) >>> 0, divisions - 1);
        return hashY * divisions + hashX;
    }

    private static insertStatic(pos: sf.Vector2f, object: WallObject): void {
        this.instance.staticMap[this.hash(pos)].add(object);
    }

    private static insertDynamic(pos: sf.Vector2f, object: WallObject): void {
        this.instance.dynamicMap[this.hash(pos)].add(object);
    }

    /** Index a persistent obstacle at all eight hitbox offsets until resetStatic. */
    static registerStatic(object: WallObject): void {
        this.registerNeighbours(object, true, true);
    }

    /** Index a moving object for this update: four hitbox offsets for drivers, eight otherwise. */
    static registerDynamic(object: WallObject): void {
        this.registerNeighbours(object, false, !(object instanceof Driver));
    }

    private static registerNeighbours(
        object: WallObject, isStatic: boolean, diagonals: boolean,
    ): void {
        const { position, hitboxRadius: radius } = object;
        const offsets: [number, number][] = [
            [radius, 0], [-radius, 0], [0, radius], [0, -radius],
        ];
        if (diagonals) {
            offsets.push(
                [radius, radius], [-radius, radius],
                [-radius, -radius], [radius, -radius],
            );
        }

        // Querying uses only the driver's centre cell, so insert objects at their hitbox edges.
        // Sets deduplicate offsets that land in the same bucket.
        for (const [x, y] of offsets) {
            const pos = new sf.Vector2f(position.x + x, position.y + y);
            if (isStatic) {
                this.insertStatic(pos, object);
            } else {
                this.insertDynamic(pos, object);
            }
        }
    }

    /**
     * Resolve the first accepted contact in the driver's grid cell, dynamic objects first.
     * Writes the response into data and returns true when a candidate's solver accepts it.
     */
    static collide(object: Driver, data: CollisionData): boolean {
        const objPos = new sf.Vector2f(object.position);
        const objRadius = object.hitboxRadius;
        const objSpeed = new sf.Vector2f(
            object.speedForward * Math.cos(object.posAngle),
            object.speedForward * Math.sin(object.posAngle),
        );
        const dist2 = (candidate: WallObject): number => {
            const dx = objPos.x - candidate.position.x;
            const dy = objPos.y - candidate.position.y;
            return dx * dx + dy * dy;
        };

        // Stop at the first accepted dynamic contact; later candidates cannot replace its response.
        for (const candidate of this.instance.dynamicMap[this.hash(objPos)]) {
            if (candidate === object) {
                continue;
            }
            const sum = objRadius + candidate.hitboxRadius;
            const d2 = dist2(candidate);
            if (d2 > sum * sum) {
                continue;
            }

            if (candidate.solveCollision(
                data, objSpeed, objPos, object.vehicle.weight,
                object.height, object.isImmune(), d2,
            )) {
                return true;
            }
        }

        // Fixed obstacles are considered only afterward and require strict overlap, not tangency.
        for (const candidate of this.instance.staticMap[this.hash(objPos)]) {
            if (candidate === object) {
                continue;
            }
            const sum = objRadius + candidate.hitboxRadius;
            const d2 = dist2(candidate);
            if (d2 < sum * sum && candidate.solveCollision(
                data, objSpeed, objPos, object.vehicle.weight,
                object.height, object.isImmune(), d2,
            )) {
                return true;
            }
        }
        return false;
    }

    /**
     * Probe an AI look-ahead circle in normalized map units, ignoring self and inert effects.
     * On overlap, write the unnormalized obstacle-to-probe vector into evadeVector and return true.
     */
    static evade(
        self: Driver, position: sf.Vector2f, hitboxRadius: number,
        evadeVector: sf.Vector2f,
    ): boolean {
        const dist2 = (candidate: WallObject): number => {
            const dx = position.x - candidate.position.x;
            const dy = position.y - candidate.position.y;
            return dx * dx + dy * dy;
        };

        // Return separation without normalizing: AI steering also uses its magnitude for proximity.
        for (const candidate of this.instance.dynamicMap[this.hash(position)]) {
            if (candidate === self) {
                continue;
            }
            const sum = hitboxRadius + candidate.hitboxRadius;
            if (dist2(candidate) > sum * sum) {
                continue;
            }
            if (candidate instanceof Item && !candidate.registersCollisions()) {
                continue;
            }
            evadeVector.x = position.x - candidate.position.x;
            evadeVector.y = position.y - candidate.position.y;
            return true;
        }

        for (const candidate of this.instance.staticMap[this.hash(position)]) {
            if (candidate === self) {
                continue;
            }
            const sum = hitboxRadius + candidate.hitboxRadius;
            if (dist2(candidate) > sum * sum) {
                continue;
            }
            evadeVector.x = position.x - candidate.position.x;
            evadeVector.y = position.y - candidate.position.y;
            return true;
        }
        return false;
    }

    /** Clear persistent obstacle registrations before rebuilding the course grid. */
    static resetStatic(): void {
        for (const bucket of this.instance.staticMap) {
            bucket.clear();
        }
    }

    /** Clear moving-object registrations before indexing the next simulation update. */
    static resetDynamic(): void {
        for (const bucket of this.instance.dynamicMap) {
            bucket.clear();
        }
    }
}
