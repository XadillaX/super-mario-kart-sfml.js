import type { Driver } from './driver';
import { VehicleProperties } from './vehicleproperties';

/** Obstacle variants selected by the original course object data. */
export enum WallObjectType {
    /** Standard falling Thwomp obstacle. */
    NORMAL_THWOMP,
    /** Super Thwomp variant with a shorter wait before dropping again. */
    SUPER_THWOMP,
    /** Green pipe obstacle. */
    GREEN_PIPE,
    /** Orange pipe obstacle. */
    ORANGE_PIPE,
}

/** Character indices in selection-grid order, shared by the driver lookup tables. */
export enum MenuPlayer {
    /** Mario, using the balanced kart preset. */
    MARIO,
    /** Princess Peach, using the acceleration preset. */
    PEACH,
    /** Bowser, using the heavy kart preset. */
    BOWSER,
    /** Koopa Troopa, using the handling preset. */
    KOOPA,
    /** Luigi, using the balanced kart preset. */
    LUIGI,
    /** Yoshi, using the acceleration preset. */
    YOSHI,
    /** Donkey Kong Jr., using the heavy kart preset. */
    DK,
    /** Toad, using the handling preset. */
    TOAD,
    /** Number of selectable characters; not a character index. */
    __COUNT,
}

/** Object reference replacing the original shared driver pointer. */
export type DriverPtr = Driver;
/** Character-indexed roster; the original array held eight driver pointers. */
export type DriverArray = Driver[];
/** Shared driver references ordered by race position, with the leader first. */
export type RaceRankingArray = Driver[];
/** Grand Prix standings as driver references paired with accumulated points. */
export type GrandPrixRankingArray = [Driver, number][];

/** Original lowercase character labels, indexed by MenuPlayer. */
export const DRIVER_DISPLAY_NAMES: readonly string[] = [
    'mario', 'princess', 'bowser', 'koopa troopa',
    'luigi', 'yoshi', 'donkey kong jr', 'toad',
];

/** Character sprite-sheet paths, indexed by MenuPlayer. */
export const DRIVER_ASSET_NAMES: readonly string[] = [
    'assets/drivers/mario.png', 'assets/drivers/peach.png',
    'assets/drivers/bowser.png', 'assets/drivers/koopa.png',
    'assets/drivers/luigi.png', 'assets/drivers/yoshi.png',
    'assets/drivers/dk.png', 'assets/drivers/toad.png',
];

/** Shared kart presets for each MenuPlayer; engine-class scaling mutates them in place. */
export const DRIVER_PROPERTIES: readonly VehicleProperties[] = [
    VehicleProperties.BALANCED, VehicleProperties.ACCELERATION,
    VehicleProperties.HEAVY, VehicleProperties.HANDLING,
    VehicleProperties.BALANCED, VehicleProperties.ACCELERATION,
    VehicleProperties.HEAVY, VehicleProperties.HANDLING,
];

/** Reference screen width in pixels for the original UI and sprite scaling. */
export const BASIC_WIDTH = 512.0;
/** Reference screen height in pixels for the original UI and resolution settings. */
export const BASIC_HEIGHT = 448.0;

/** Source of steering and throttle commands; physics still runs when disabled. */
export enum DriverControlType {
    /** No player or AI input, as used by camera-only drivers and race transitions. */
    DISABLED,
    /** Follow the course gradient with obstacle avoidance and opponent steering. */
    AI_GRADIENT,
    /** Read the local player's input bindings. */
    PLAYER,
}

/** Held-item identifiers used by item panels, the HUD and item dispatch. */
export enum PowerUps {
    /** Empty item slot. */
    NONE,
    /** Temporary forward-speed boost. */
    MUSHROOM,
    /** Award two coins when used. */
    COIN,
    /** Temporary collision immunity and increased speed. */
    STAR,
    /** Throwable or droppable peel that spins out other drivers. */
    BANANA,
    /** Straight-moving shell that rebounds from walls. */
    GREEN_SHELL,
    /** Shell that targets the driver ahead when thrown forward. */
    RED_SHELL,
    /** Shrink and slow non-immune drivers ahead in the ranking. */
    THUNDER,
    /** Number of item identifiers, including NONE; not a usable item. */
    __COUNT,
}

/** AI look-ahead tile offsets indexed by CCOption and shuffled driver-tuning slot. */
export const FAR_VISIONS: readonly (readonly number[])[] = [
    [0, 0, 0, 0, -1, 1, 1, 1],
    [0, 0, 1, 1, -1, -2, 2, 2],
    [1, 1, 1, -1, -1, -2, 2, 2],
];

/** AI item-use probability divisors indexed by CCOption and shuffled tuning slot. */
export const ITEM_PROB_MODS: readonly (readonly number[])[] = [
    [7, 7, 6, 6, 6, 6, 2, 1],
    [4, 4, 4, 4, 3, 2, 2, 1],
    [2, 1, 1, 1, 1, 1, 1, 1],
];

/** Opponent-blocking steering divisors by CCOption and tuning slot; lower is stronger. */
export const IMPEDIMENTS: readonly (readonly number[])[] = [
    [128, 128, 96, 96, 96, 64, 64, 48],
    [96, 64, 64, 48, 48, 48, 32, 32],
    [64, 64, 64, 48, 48, 32, 32, 16],
];
