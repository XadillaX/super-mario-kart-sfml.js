import * as sf from 'sfml.js';

/** Gameplay response to a resolved contact, separate from whether a collision occurred. */
export enum CollisionType {
    /** Apply only the physical response, without triggering a hit or crush effect. */
    NO_HIT,
    /** Trigger the driver's spin-out and coin-loss response. */
    HIT,
    /** Trigger the driver's flattening and coin-loss response. */
    SMASH,
}

/** Mutable collision output. Solvers update this object rather than replacing it. */
export class CollisionData {
    /** Displacement impulse added to the struck driver's movement in normalized map units. */
    momentum: sf.Vector2f;

    /** Copy the SFML vector by value and initialize the speed and gameplay response. */
    constructor(
        momentum = new sf.Vector2f(),
        /** Multiplier for the struck driver's forward and turning speeds; 0.5 retains half. */
        public speedFactor = 0,
        /** Additional gameplay effect to apply after resolving the physical contact. */
        public type = CollisionType.NO_HIT,
    ) {
        this.momentum = new sf.Vector2f(momentum);
    }
}
