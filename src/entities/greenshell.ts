import * as sf from 'sfml.js';
import { Item } from './item';
import { WallObject } from './wallobject';
import { CollisionType } from './collisiondata';
import type { CollisionData } from './collisiondata';
import { MAP_ASSETS_WIDTH, MAP_TILES_HEIGHT, MAP_TILES_WIDTH, MapLand } from '../map/enums';
import { Map } from '../map/map';

/** A straight-moving shell with six wall reflections and ramp jumps. */
export class GreenShell extends Item {
    private static readonly NUM_LIVES = 6;
    private static readonly NUM_MARCHES_UPDATE = 3;
    private static readonly NUM_MARCHES_HIT = 20;
    private static readonly SPEED = 80;
    private static readonly HITBOX_RADIUS = 5;
    private static readonly JUMP_SPEED = 150;
    private static readonly GRAVITY = -9.8 * 100;
    private static readonly TIME_OF_FLIGHT = sf.seconds(1);
    private static assetShell = new sf.Texture();
    private speed: sf.Vector2f;
    private verticalSpeed = 0;
    private lives = GreenShell.NUM_LIVES;

    /** Preload the green-shell region. */
    static override async loadAssets(assetName: string, roi: sf.IntRect): Promise<void> {
        if (!await GreenShell.assetShell.loadFromFile(assetName, false, roi)) {
            throw new Error(`Unable to load green shell: ${assetName}`);
        }
    }

    /** Spawn ahead or behind the driver using the original hitbox-based velocity. */
    constructor(position: sf.Vector2f, forwardAngle: number, forwardThrow: boolean, playerHeight: number) {
        super(new sf.Vector2f(0, 0), 0.05, GreenShell.HITBOX_RADIUS, playerHeight);
        const { Driver } = require('./driver') as typeof import('./driver');
        const angle = forwardThrow ? forwardAngle : forwardAngle + Math.PI;
        // The pixel hitbox clearance becomes both a normalized spawn offset and the speed scale.
        const factor = (GreenShell.HITBOX_RADIUS + Driver.HITBOX_RADIUS + 0.1) / MAP_ASSETS_WIDTH;
        const forward = new sf.Vector2f(Math.cos(angle) * factor, Math.sin(angle) * factor);
        this.position = sf.add(position, forward);
        this.speed = sf.multiply(forward, GreenShell.SPEED);

        this.sprite = new sf.Sprite(GreenShell.assetShell);
        const size = GreenShell.assetShell.getSize();
        this.sprite.setOrigin(new sf.Vector2f(size.x / 2, size.y));
    }

    /** Split each update into the original three terrain marches. */
    override update(deltaTime: sf.Time): void {
        for (let i = 0; i < GreenShell.NUM_MARCHES_UPDATE; i++) {
            this.marchingUpdate(sf.divide(deltaTime, GreenShell.NUM_MARCHES_UPDATE));
        }
    }

    /** Advance one march, resolving wall reflection, ramps, and outer terrain. */
    marchingUpdate(deltaTime: sf.Time): void {
        const oldPosition = new sf.Vector2f(this.position);
        const dt = deltaTime.asSeconds();
        this.position = sf.add(this.position, sf.multiply(this.speed, dt));
        this.verticalSpeed += GreenShell.GRAVITY * dt;
        this.height = Math.max(0, this.height + this.verticalSpeed * dt);

        if (this.position.x < 0 || this.position.x > 1 ||
            this.position.y < 0 || this.position.y > 1) {
            this.used = true;
        } else if (this.height > 0) {
            // In-bounds airborne shells pass over terrain until they land.
            return;
        }

        const land = Map.getLand(this.position);
        if (land === MapLand.BLOCK && this.lives <= 0) {
            this.used = true;
            Map.addEffectBreak(this);
        } else if (land === MapLand.BLOCK) {
            // Refine the blocked march to locate the first wall tile along the travelled segment.
            const delta = sf.divide(sf.subtract(this.position, oldPosition), GreenShell.NUM_MARCHES_HIT);
            let block = sf.add(oldPosition, delta);
            while (Map.getLand(block) !== MapLand.BLOCK) {
                block = sf.add(block, delta);
            }

            // Use the tile centre to choose a reflection axis, then restore the pre-contact position.
            const blockCenter = new sf.Vector2f(
                (Math.trunc(block.x * MAP_TILES_WIDTH) + 0.5) / MAP_TILES_WIDTH,
                (Math.trunc(block.y * MAP_TILES_HEIGHT) + 0.5) / MAP_TILES_HEIGHT,
            );
            if (Math.abs(blockCenter.x - oldPosition.x) > Math.abs(blockCenter.y - oldPosition.y)) {
                this.speed.x *= -1;
            } else {
                this.speed.y *= -1;
            }
            this.position = oldPosition;
            this.lives--;
        } else if (land === MapLand.RAMP_HORIZONTAL || land === MapLand.RAMP_VERTICAL) {
            this.verticalSpeed = GreenShell.JUMP_SPEED;
        } else if (land === MapLand.OUTER) {
            this.used = true;
            Map.addEffectDrown(this.position);
        }
    }

    /** Break against a driver at matching height, preserving immune-driver behavior. */
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

    /** Green shells enter the dynamic collision grid. */
    override registersCollisions(): boolean {
        return true;
    }

    /** Original debug name. */
    name(): string {
        return 'GreenShell';
    }
}
