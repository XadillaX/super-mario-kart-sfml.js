import * as sf from 'sfml.js';
import { Item } from './item';
import type { CollisionData } from './collisiondata';
import { MAP_ASSETS_HEIGHT, MAP_ASSETS_WIDTH } from '../map/enums';

/** A non-colliding ballistic fragment reusing the destroyed item's texture. */
export class EffectBreak extends Item {
    private static readonly JUMP_SPEED = 75;
    private static readonly GRAVITY = -9.8 * 35;
    private verticalSpeed = EffectBreak.JUMP_SPEED;

    /** Copy the source item's position and texture before the map releases it. */
    constructor(item: Item) {
        super(new sf.Vector2f(
            item.position.x * MAP_ASSETS_WIDTH,
            item.position.y * MAP_ASSETS_HEIGHT,
        ), 0.9, 0, 0.01);
        this.sprite = new sf.Sprite(item.getSprite().getTexture());
        const size = this.sprite.getTexture().getSize();
        this.sprite.setOrigin(new sf.Vector2f(size.x / 2, size.y));
    }

    /** Apply gravity before motion and expire below ground level. */
    override update(deltaTime: sf.Time): void {
        this.verticalSpeed += EffectBreak.GRAVITY * deltaTime.asSeconds();
        this.height += this.verticalSpeed * deltaTime.asSeconds();
        if (this.height < 0) {
            this.used = true;
        }
    }

    /** Fragments never collide with drivers. */
    override solveCollision(
        _data: CollisionData, _otherSpeed: sf.Vector2f, _otherPos: sf.Vector2f,
        _otherWeight: number, _otherHeight: number, _otherIsImmune: boolean, _distance2: number,
    ): boolean {
        return false;
    }

    /** Original debug name. */
    name(): string {
        return 'EffectBreak';
    }
}
