import * as sf from "sfml.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
    MAP_TILES_HEIGHT, MAP_TILES_WIDTH, MapLand,
    type MapLandMatrix,
} from "../map/enums";
import { Map } from "../map/map";

type IntMapMatrix = Int32Array[];
/** Frontier entry: tile coordinates, weighted travel cost, and unweighted step count. */
type WeightTuple = [col: number, row: number, gradient: number, position: number];

/** Ordered eight-neighbor gradient descent, including course cache files. */
export class AIGradientDescent {
    private static readonly WALL_PENALTY_MAX = 4096;
    private static readonly WALL_PENALTY_FACTOR = 2;
    private static readonly WALL_PENALTY_ITERS = 3;

    /** Steering costs: -2 is unvisited, -1 is blocked, and 0 is the finish line. */
    private static gradientMatrix: IntMapMatrix = Array.from(
        { length: MAP_TILES_HEIGHT }, () => new Int32Array(MAP_TILES_WIDTH),
    );
    /** Steps along the chosen route, used for ranking and detecting lap crossings. */
    private static positionMatrix: IntMapMatrix = Array.from(
        { length: MAP_TILES_HEIGHT }, () => new Int32Array(MAP_TILES_WIDTH),
    );

    // Equal-cost candidates keep the first match, so this order also breaks ties.
    private static readonly eightNeighbours: readonly (readonly [number, number])[] = [
        [0, -1], [-1, 0], [0, 1], [1, 0],
        [1, -1], [1, 1], [-1, 1], [-1, -1],
    ];

    /** Position threshold immediately preceding the finish line. */
    static GRADIENT_LAP_CHECK = 0;
    /** Position value at the cell used to detect completion of a lap. */
    static MAX_POSITION_MATRIX = 0;
    /** Rubber-band distances behind the player, indexed by engine class. */
    static readonly MAX_DISTANCE_BEHIND = [100, 100, 75] as const;
    /** Minimum acceleration probabilities behind the player. */
    static readonly MIN_PROB_BEHIND = [0.6, 0.7, 0.75] as const;
    /** Rubber-band distances ahead of the player, indexed by engine class. */
    static readonly MAX_DISTANCE_AHEAD = [100, 200, 300] as const;
    /** Minimum acceleration probabilities ahead of the player. */
    static readonly MIN_PROB_AHEAD = [0.45, 0.45, 0.45] as const;

    /** Makes shortcuts over slow terrain expensive while favoring boost/item tiles. */
    private static weightLand(landType: MapLand): number {
        switch (landType) {
            case MapLand.ZIPPER:
            case MapLand.OTHER:
                return 1;
            case MapLand.TRACK:
            case MapLand.SPECIAL_13H:
                return 10;
            case MapLand.RAMP:
            case MapLand.RAMP_HORIZONTAL:
            case MapLand.RAMP_VERTICAL:
                return 50;
            case MapLand.OIL_SLICK:
            case MapLand.SLOW:
                return 100;
            case MapLand.OUTER:
            case MapLand.BLOCK:
                return 500000;
            default:
                console.error(`AIGradientDescent::weightLand: Invalid landType (${landType})`);
                return 0;
        }
    }

    /** Loads both cached matrices, or computes and persists them in course order. */
    static updateGradient(mapMatrix: MapLandMatrix, goalLineFloat: sf.FloatRect): void {
        const gradientFile = `${Map.getCourse()}/gradient.txt`;
        const positionFile = `${Map.getCourse()}/position.txt`;
        const numRows = mapMatrix.length;
        const numCols = mapMatrix[0].length;

        // The pair is one cache: position.txt appends the lap threshold after its grid.
        if (existsSync(gradientFile) && existsSync(positionFile)) {
            const gradient = readFileSync(gradientFile, "utf8").trim().split(/\s+/).map(Number);
            const position = readFileSync(positionFile, "utf8").trim().split(/\s+/).map(Number);
            for (let row = 0; row < numRows; row++) {
                for (let col = 0; col < numCols; col++) {
                    AIGradientDescent.gradientMatrix[row][col] = gradient[row * numCols + col];
                    AIGradientDescent.positionMatrix[row][col] = position[row * numCols + col];
                }
            }

            AIGradientDescent.GRADIENT_LAP_CHECK = position[numRows * numCols];
            AIGradientDescent.MAX_POSITION_MATRIX = AIGradientDescent.GRADIENT_LAP_CHECK + 10;
            return;
        }

        for (const row of AIGradientDescent.gradientMatrix) {
            row.fill(-2);
        }
        for (const row of AIGradientDescent.positionMatrix) {
            row.fill(-1);
        }

        // Block the perimeter and walls. Slow/outer cells remain traversable at a cost.
        const wallPenalty: IntMapMatrix = Array.from(
            { length: numRows }, () => new Int32Array(numCols),
        );
        let wallPenaltyFrontier: [number, number][] = [];
        for (let row = 0; row < numRows; row++) {
            for (let col = 0; col < numCols; col++) {
                if (mapMatrix[row][col] === MapLand.BLOCK ||
                    row === 0 || row === numRows - 1 || col === 0 || col === numCols - 1) {
                    AIGradientDescent.gradientMatrix[row][col] = -1;
                    wallPenalty[row][col] = AIGradientDescent.WALL_PENALTY_MAX;
                    wallPenaltyFrontier.push([col, row]);
                } else if (mapMatrix[row][col] === MapLand.SLOW || mapMatrix[row][col] === MapLand.OUTER) {
                    wallPenalty[row][col] = AIGradientDescent.WALL_PENALTY_MAX;
                    wallPenaltyFrontier.push([col, row]);
                }
            }
        }

        // Spread a decaying penalty three cells out from hazards to discourage clipping them.
        let currentPenalty = AIGradientDescent.WALL_PENALTY_MAX;
        for (let pen = 0; pen < AIGradientDescent.WALL_PENALTY_ITERS; pen++) {
            const nextWallPenaltyFrontier: [number, number][] = [];
            for (const [col, row] of wallPenaltyFrontier) {
                const penalty = wallPenalty[row][col];
                if (penalty !== currentPenalty) {
                    continue;
                }

                for (const [dx, dy] of AIGradientDescent.eightNeighbours) {
                    const prow = row + dy;
                    const pcol = col + dx;
                    if (prow >= 0 && prow < numRows && pcol >= 0 && pcol < numCols &&
                        wallPenalty[prow][pcol] === 0) {
                        wallPenalty[prow][pcol] = Math.trunc(penalty / AIGradientDescent.WALL_PENALTY_FACTOR);
                        nextWallPenaltyFrontier.push([pcol, prow]);
                    }
                }
            }

            wallPenaltyFrontier = nextWallPenaltyFrontier;
            currentPenalty = Math.trunc(currentPenalty / AIGradientDescent.WALL_PENALTY_FACTOR);
        }

        // Seed only below the finish line: descending the field then runs the lap
        // in the intended direction instead of immediately crossing it backwards.
        const goalLineInt = new sf.IntRect(
            new sf.Vector2i(
                goalLineFloat.position.x * MAP_TILES_WIDTH,
                goalLineFloat.position.y * MAP_TILES_HEIGHT,
            ),
            new sf.Vector2i(
                goalLineFloat.size.x * MAP_TILES_WIDTH,
                goalLineFloat.size.y * MAP_TILES_HEIGHT,
            ),
        );

        let frontier: WeightTuple[] = [];
        let lapCheckCol = 0;
        let lapCheckRow = 0;
        for (let irow = 0; irow < goalLineInt.size.y; irow++) {
            for (let icol = 0; icol < goalLineInt.size.x; icol++) {
                const row = goalLineInt.position.y + irow;
                const col = goalLineInt.position.x + icol;
                AIGradientDescent.gradientMatrix[row][col] = 0;
                AIGradientDescent.positionMatrix[row][col] = 0;

                if (mapMatrix[row + 1][col] === MapLand.TRACK) {
                    const initialWeight = AIGradientDescent.weightLand(MapLand.TRACK) + wallPenalty[row + 1][col];
                    AIGradientDescent.gradientMatrix[row + 1][col] = initialWeight;
                    AIGradientDescent.positionMatrix[row + 1][col] = 1;
                    frontier.push([col, row + 1, initialWeight, 1]);
                }

                // The opposite side is reached near the end of a complete lap.
                if (mapMatrix[row - 1][col] === MapLand.TRACK) {
                    lapCheckCol = col;
                    lapCheckRow = row - 1;
                }
            }
        }

        // Preserve first insertion order and last relaxation for each frontier cell.
        // An index replaces only the original linear search, not its traversal order.
        const nextIndices = new Int32Array(numRows * numCols);
        while (frontier.length > 0) {
            const nextFrontier: WeightTuple[] = [];
            nextIndices.fill(-1);
            for (const point of frontier) {
                for (const [dx, dy] of AIGradientDescent.eightNeighbours) {
                    let col = point[0];
                    let row = point[1];

                    // This special terrain connects a jump landing 13 columns to the left.
                    if (mapMatrix[row][col] === MapLand.SPECIAL_13H) {
                        col -= 13;
                    }
                    row += dy;
                    col += dx;

                    const weight = point[2] +
                        AIGradientDescent.weightLand(mapMatrix[row][col]) + wallPenalty[row][col];
                    const position = point[3] + 1;
                    if (AIGradientDescent.gradientMatrix[row][col] === -2 ||
                        AIGradientDescent.gradientMatrix[row][col] > weight) {
                        AIGradientDescent.gradientMatrix[row][col] = weight;
                        AIGradientDescent.positionMatrix[row][col] = position;

                        // A cheaper path updates an existing entry without changing queue order.
                        const key = row * numCols + col;
                        const index = nextIndices[key];
                        if (index !== -1) {
                            nextFrontier[index][2] = weight;
                            nextFrontier[index][3] = position;
                        } else {
                            nextIndices[key] = nextFrontier.length;
                            nextFrontier.push([col, row, weight, position]);
                        }
                    }
                }
            }

            frontier = nextFrontier;
        }

        // Reserve the original ten-step margin for detecting the wrap across the finish line.
        AIGradientDescent.GRADIENT_LAP_CHECK =
            AIGradientDescent.positionMatrix[lapCheckRow][lapCheckCol] - 10;
        AIGradientDescent.MAX_POSITION_MATRIX = AIGradientDescent.GRADIENT_LAP_CHECK + 10;

        const serialize = (matrix: IntMapMatrix): string =>
            matrix.map(row => `${row.join(" ")} \n`).join("");
        writeFileSync(gradientFile, serialize(AIGradientDescent.gradientMatrix));
        writeFileSync(
            positionFile,
            serialize(AIGradientDescent.positionMatrix) + `${AIGradientDescent.GRADIENT_LAP_CHECK}\n`,
        );
    }

    /** Reads a grid position, retaining the original unsigned-coordinate clamping. */
    static getPositionValue(col: number, row: number): number;
    /** Reads the position matrix at normalized map coordinates. */
    static getPositionValue(position: sf.Vector2f): number;
    static getPositionValue(positionOrCol: sf.Vector2f | number, row?: number): number {
        const col = typeof positionOrCol === "number"
            ? positionOrCol
            : positionOrCol.x * MAP_TILES_WIDTH;
        const actualRow = typeof positionOrCol === "number"
            ? row!
            : positionOrCol.y * MAP_TILES_HEIGHT;

        return AIGradientDescent.positionMatrix[
            Math.min(Math.trunc(actualRow) >>> 0, MAP_TILES_WIDTH - 1)
        ][Math.min(Math.trunc(col) >>> 0, MAP_TILES_WIDTH - 1)];
    }

    /** Chooses the original first minimum neighbor; finish-line cells always go up. */
    static getNextDirection(position: sf.Vector2f): sf.Vector2f {
        const row = Math.trunc(position.y * MAP_TILES_HEIGHT);
        const col = Math.trunc(position.x * MAP_TILES_WIDTH);
        if (AIGradientDescent.gradientMatrix[row][col] === 0) {
            return new sf.Vector2f(0, -1 / MAP_TILES_HEIGHT);
        }

        // Find a valid baseline before comparing costs; blocked neighbors use -1.
        let bestIndex = 0;
        let bestValue = -1;
        while (bestIndex < AIGradientDescent.eightNeighbours.length) {
            const [dx, dy] = AIGradientDescent.eightNeighbours[bestIndex];
            bestValue = AIGradientDescent.gradientMatrix[row + dy]?.[col + dx] ?? -1;
            if (bestValue !== -1) {
                break;
            }
            bestIndex++;
        }

        if (bestIndex === AIGradientDescent.eightNeighbours.length) {
            return new sf.Vector2f(0, 0);
        }

        // Reject approaching the finish from above, which would reverse the lap.
        // Strict comparison keeps the earlier neighbor when costs are equal.
        for (let i = bestIndex; i < AIGradientDescent.eightNeighbours.length; i++) {
            const [dx, dy] = AIGradientDescent.eightNeighbours[i];
            const candidate = AIGradientDescent.gradientMatrix[row + dy]?.[col + dx] ?? -1;
            if (bestValue > candidate && candidate !== -1 && (candidate !== 0 || dy !== 1)) {
                bestValue = candidate;
                bestIndex = i;
            }
        }

        const [dx, dy] = AIGradientDescent.eightNeighbours[bestIndex];
        return new sf.Vector2f(dx / MAP_TILES_WIDTH, dy / MAP_TILES_HEIGHT);
    }
}
