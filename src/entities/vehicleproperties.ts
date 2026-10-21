/** Acceleration, steering, speed and mass for each original kart archetype. */
export class VehicleProperties {
    /** Mario/Luigi preset with balanced acceleration, handling and top speed. */
    static readonly BALANCED = new VehicleProperties(0.11, 0.14, 0.10200, 1.0, false);
    /** Peach/Yoshi preset with faster acceleration and weaker steering. */
    static readonly ACCELERATION = new VehicleProperties(0.15, 0.13, 0.10175, 1.0, false);
    /** Bowser/Donkey Kong Jr. preset with high mass, top speed and a convex speed curve. */
    static readonly HEAVY = new VehicleProperties(0.10, 0.13, 0.10250, 2.0, true);
    /** Koopa/Toad preset with strong steering, low mass and lower top speed. */
    static readonly HANDLING = new VehicleProperties(0.12, 0.15, 0.10150, 0.5, false);
    /** Original debug preset with exaggerated acceleration, speed and mass. */
    static readonly GODMODE = new VehicleProperties(0.2, 0.3, 0.2, 10.0, false);

    /** Extra acceleration, steering and speed multiplier applied by makePlayer. */
    static PLAYER_CHARACTER_MULTIPLIER = 1.0;
    /** Grounded coasting deceleration in normalized map units per second squared. */
    static readonly FRICTION_LINEAR_ACELERATION = -0.04;
    /** Brake deceleration added to the forward acceleration, in map units per second squared. */
    static readonly BREAK_ACELERATION = -0.2;
    /** Extra off-road deceleration above the slow-land speed cap, in map units per second squared. */
    static readonly SLOW_LAND_LINEAR_ACELERATION = -0.20;
    /** Acceleration multiplier increment per zero-based race rank (0.0085 = 0.85%). */
    static readonly POSITION_ACCELERATION_BONUS_PCT = 0.0085;

    private static readonly PLAYER = new VehicleProperties(0.11, 0.14, 0.10200, 1.0, false);

    /** Mushroom/star speed cap before coin bonuses, twice the normal top speed. */
    maxSpeedUpLinearSpeed: number;
    /** Shrink-effect speed cap before coin bonuses, 85% of normal top speed. */
    maxSpeedDownLinearSpeed: number;
    /** Normal steering-rate limit in radians per second. */
    maxTurningAngularSpeed: number;
    /** Off-road speed threshold for extra drag, 45% of normal top speed. */
    slowLandMaxLinearSpeed: number;

    /** Build a preset and derive its boost, shrink, steering and off-road limits. */
    private constructor(
        /** Engine acceleration scale in normalized map units per second squared. */
        public motorAcceleration: number,
        /** Steering-rate increment scale applied per control update. */
        public turningAcceleration: number,
        /** Unboosted top speed in normalized map units per second, before coin bonuses. */
        public maxNormalLinearSpeed: number,
        /** Relative kart mass used to weight driver-to-driver collision impulses. */
        public weight: number,
        /** Select the heavy kart's convex, piecewise engine acceleration curve. */
        public convex: boolean,
    ) {
        this.maxSpeedUpLinearSpeed = maxNormalLinearSpeed * 2.0;
        this.maxSpeedDownLinearSpeed = maxNormalLinearSpeed * 0.85;
        this.maxTurningAngularSpeed = turningAcceleration * 10.0;
        this.slowLandMaxLinearSpeed = maxNormalLinearSpeed * 0.45;
    }

    /**
     * Apply the 50/100/150cc scale to the four racing presets without replacing them.
     * Steering uses scaleFactor / 1.5; playerCharacterMultiplier is saved for makePlayer.
     */
    static setScaleFactor(scaleFactor: number, playerCharacterMultiplier: number): void {
        Object.assign(this.BALANCED, new VehicleProperties(
            0.11 * scaleFactor, 0.14 * scaleFactor / 1.5, 0.10200 * scaleFactor, 1.0, false,
        ));
        Object.assign(this.ACCELERATION, new VehicleProperties(
            0.15 * scaleFactor, 0.13 * scaleFactor / 1.5, 0.10175 * scaleFactor, 1.0, false,
        ));
        Object.assign(this.HEAVY, new VehicleProperties(
            0.10 * scaleFactor, 0.13 * scaleFactor / 1.5, 0.10250 * scaleFactor, 2.0, true,
        ));
        Object.assign(this.HANDLING, new VehicleProperties(
            0.12 * scaleFactor, 0.15 * scaleFactor / 1.5, 0.10150 * scaleFactor, 0.5, false,
        ));
        this.PLAYER_CHARACTER_MULTIPLIER = playerCharacterMultiplier;
    }

    /**
     * Apply the player multiplier without changing weight or curve type.
     * Returns the shared PLAYER preset, overwritten by each call as in the C++ version.
     */
    makePlayer(): VehicleProperties {
        const multiplier = VehicleProperties.PLAYER_CHARACTER_MULTIPLIER;
        Object.assign(VehicleProperties.PLAYER, new VehicleProperties(
            this.motorAcceleration * multiplier,
            this.turningAcceleration * multiplier,
            this.maxNormalLinearSpeed * multiplier,
            this.weight,
            this.convex,
        ));
        return VehicleProperties.PLAYER;
    }
}
