/** Width of every course asset, in pixels. */
export const MAP_ASSETS_WIDTH = 1024;
/** Height of every course asset, in pixels. */
export const MAP_ASSETS_HEIGHT = 1024;
/** Width and height of a terrain cell, in pixels. */
export const MAP_TILE_SIZE = 8;
/** Width and height of the repeating outside-map texture. */
export const MAP_EDGES_SIZE = 8;
/** Number of terrain columns. */
export const MAP_TILES_WIDTH = MAP_ASSETS_WIDTH / MAP_TILE_SIZE;
/** Number of terrain rows. */
export const MAP_TILES_HEIGHT = MAP_ASSETS_HEIGHT / MAP_TILE_SIZE;
/** Number of laps required to finish a race. */
export const NUM_LAPS_IN_CIRCUIT = 5;

/** Engine classes, in the original menu order. */
export enum CCOption {
    CC50,
    CC100,
    CC150,
    __COUNT,
}

/** Terrain IDs encoded as character offsets from '0' in base.txt. */
export enum MapLand {
    TRACK,
    BLOCK,
    SLOW,
    OUTER,
    RAMP,
    OIL_SLICK,
    RAMP_HORIZONTAL,
    RAMP_VERTICAL,
    ZIPPER,
    OTHER,
    SPECIAL_13H,
}

/** Row-major terrain matrix with MAP_TILES_HEIGHT by MAP_TILES_WIDTH cells. */
export type MapLandMatrix = MapLand[][];

/** Surface materials used by tire particles and falling effects. */
export enum LandMaterial {
    DIRT = 0,
    GRASS = 1,
    SPOOKY_WOOD = 2,
    STONE = 3,
    WATER = 4,
    LAVA = 5,
    VOID = 6,
    RAINBOW = 7,
}

/** Floor-object IDs stored in objects.txt. */
export enum FloorObjectType {
    ZIPPER,
    QUESTION_PANEL,
    OIL_SLICK,
    COIN,
    RAMP_HORIZONTAL,
    RAMP_VERTICAL,
}

/** Sprite-sheet orientation order. */
export enum FloorObjectOrientation {
    UP,
    RIGHT,
    DOWN,
    LEFT,
    __COUNT,
}

/** Floor-object lifecycle; INITIAL resolves to the object's initial state. */
export enum FloorObjectState {
    INITIAL,
    NONE,
    ACTIVE,
    INACTIVE,
    __COUNT,
}
