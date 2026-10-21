import * as sf from 'sfml.js';
import { Item } from './item';
import { WallObject } from './wallobject';
import { CollisionType } from './collisiondata';
import type { CollisionData } from './collisiondata';
import { MAP_ASSETS_WIDTH, MapLand } from '../map/enums';
import { Map } from '../map/map';

/** A thrown or dropped banana with ballistic motion until landing. */
export class Banana extends Item {
    private static readonly SPEED = 60;
    private static readonly HITBOX_RADIUS = 0.8;
    private static readonly GRAVITY = -9.8 * Banana.SPEED * 1.5;
    private static assetBanana = new sf.Texture();
    private speed: sf.Vector3f;

    /** Preload the banana region before creating items. */
    static override async loadAssets(assetName: string, roi: sf.IntRect): Promise<void> {
        if (!await Banana.assetBanana.loadFromFile(assetName, false, roi)) {
            throw new Error(`Unable to load banana: ${assetName}`);
        }
    }

    /** Spawn beyond the driver's hitbox, either launching ahead or dropping behind. */
    constructor(position: sf.Vector2f, forwardAngle: number, forwardThrow: boolean, playerHeight: number) {
        super(new sf.Vector2f(0, 0), 0.05, Banana.HITBOX_RADIUS, playerHeight + 1);
        const { Driver } = require('./driver') as typeof import('./driver');
        // Input position is already normalized; convert only the hitbox clearance from pixels.
        const factor = (Banana.HITBOX_RADIUS + Driver.HITBOX_RADIUS + 0.1) / MAP_ASSETS_WIDTH *
            (forwardThrow ? 1 : -1);
        const forward = new sf.Vector2f(Math.cos(forwardAngle) * factor, Math.sin(forwardAngle) * factor);
        this.position = sf.add(position, forward);
        this.speed = forwardThrow
            ? new sf.Vector3f(forward.x * Banana.SPEED * 2.5, forward.y * Banana.SPEED * 2.5, Banana.SPEED * 4)
            : new sf.Vector3f(forward.x, forward.y, 0);

        this.sprite = new sf.Sprite(Banana.assetBanana);
        const size = Banana.assetBanana.getSize();
        this.sprite.setOrigin(new sf.Vector2f(size.x / 2, size.y));
    }

    /** Integrate horizontal motion, height, gravity, and terrain expiration. */
    override update(deltaTime: sf.Time): void {
        // Grounded bananas remain hazards, but no longer integrate motion or gravity.
        if (this.height === 0) {
            this.speed = new sf.Vector3f(0, 0, 0);
            return;
        }

        const dt = deltaTime.asSeconds();
        this.position = sf.add(this.position, new sf.Vector2f(this.speed.x * dt, this.speed.y * dt));
        this.height = Math.max(this.height + this.speed.z * dt, 0);
        this.speed.z += Banana.GRAVITY * dt;

        // Outer terrain consumes the banana on landing; crossing the map bounds consumes it in flight.
        if (this.height === 0 && Map.getLand(this.position) === MapLand.OUTER) {
            this.used = true;
            Map.addEffectDrown(this.position);
        } else if (this.position.x < 0 || this.position.x > 1 ||
            this.position.y < 0 || this.position.y > 1) {
            this.used = true;
        }
    }

    /** Break on a matching-height driver, applying a hit unless the driver is immune. */
    override solveCollision(
        data: CollisionData,
        _otherSpeed: sf.Vector2f,
        _otherPos: sf.Vector2f,
        _otherWeight: number,
        otherHeight: number,
        otherIsImmune: boolean,
        _distance2: number,
    ): boolean {
        if (WallObject.collisionHasHeightDifference(this.height, otherHeight) || this.used) {
            return false;
        }

        // Immunity removes the hazard without slowing the driver; used prevents a second hit.
        if (otherIsImmune) {
            this.used = true;
            Map.addEffectBreak(this);
            data.momentum = new sf.Vector2f(0, 0);
            data.speedFactor = 1;
            data.type = CollisionType.NO_HIT;
            return true;
        }

        data.momentum = new sf.Vector2f(0, 0);
        data.speedFactor = 0.4;
        data.type = CollisionType.HIT;
        this.used = true;
        Map.addEffectBreak(this);
        return true;
    }

    /** Bananas participate in the driver's collision grid. */
    override registersCollisions(): boolean {
        return true;
    }

    /** Original debug name. */
    name(): string {
        return 'Banana';
    }
}
