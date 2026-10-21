import * as sf from "sfml.js";
import type { Game } from "../game";
import { Audio, Music } from "../audio/audio";
import { Driver } from "../entities/driver";
import {
    DRIVER_ASSET_NAMES, DRIVER_PROPERTIES, DriverControlType, FAR_VISIONS,
    IMPEDIMENTS, ITEM_PROB_MODS, MenuPlayer,
} from "../entities/enums";
import { Lakitu } from "../entities/lakitu";
import { VehicleProperties } from "../entities/vehicleproperties";
import { EndRanks } from "../gui/endranks";
import { Gui } from "../gui/gui";
import { CCOption, MAP_ASSETS_HEIGHT, MAP_ASSETS_WIDTH } from "../map/enums";
import { Map } from "../map/map";
import { StateCongratulations } from "./congratulations";
import { StateGPStandings } from "./gpstandings";
import { StatePlayerSelection, type PlayerSelection } from "./playerselection";
import { StateRace } from "./race";
import { StateRaceEnd } from "./raceend";
import { StateRaceStart } from "./racestart";
import { State } from "./statebase";

/** Original supported race formats. */
export enum RaceMode {
    GRAND_PRIX_1,
    VERSUS,
}

/** Course order used by Grand Prix, versus selection, and result screens. */
export enum RaceCircuit {
    DONUT_PLAINS_1,
    MARIO_CIRCUIT_2,
    GHOST_VALLEY_1,
    BOWSER_CASTLE_1,
    RAINBOW_ROAD,
    __COUNT,
}

/** Lowercase display names supported by the original bitmap font. */
export const CIRCUIT_DISPLAY_NAMES: readonly string[] = [
    "donut plains 1", "mario circuit 2", "ghost valley 1", "bowser castle 1", "rainbow road",
];

/** Asset directory for each RaceCircuit value. */
export const CIRCUIT_ASSET_NAMES: readonly string[] = [
    "assets/circuit/donut_plains_1",
    "assets/circuit/mario_circuit_2",
    "assets/circuit/ghost_valley_1",
    "assets/circuit/bowser_castle_1",
    "assets/circuit/rainbow_road",
];

enum RaceState {
    NO_PLAYER,
    YES_PLAYER,
    RACING,
    STANDINGS,
    CONGRATULATIONS,
    DONE,
}

/** Owns the drivers and shared rankings for a full Grand Prix or versus race. */
export class StateRaceManager extends State {
    private currentCircuit = RaceCircuit.DONUT_PLAINS_1;
    private readonly drivers: Driver[] = [];
    private readonly selectedPlayer: PlayerSelection = { value: MenuPlayer.MARIO };
    private readonly positions: Driver[] = [];
    private readonly grandPrixRanking: [Driver, number][] = [];
    private currentState = RaceState.NO_PLAYER;
    private preparedRaceEnd: StateRaceEnd | undefined;

    /** Apply the chosen engine class and await every driver animator. */
    constructor(
        game: Game,
        private readonly mode: RaceMode,
        speedMultiplier: number,
        playerCharacterMultiplier: number,
        private readonly ccOption: CCOption,
        circuit: RaceCircuit = RaceCircuit.DONUT_PLAINS_1,
    ) {
        super(game);
        this.ready = this.init(speedMultiplier, playerCharacterMultiplier, circuit);
    }

    private resetBeforeRace(): void {
        Lakitu.reset();
        Gui.reset(false);
        EndRanks.reset(this.positions);
        StateRace.currentTime = sf.seconds(0);

        // The previous finish order becomes the next race's starting grid.
        for (let i = 0; i < this.positions.length; i++) {
            const position = Map.getPlayerInitialPosition(i + 1);
            this.positions[i].setPositionAndReset(new sf.Vector2f(
                position.x / MAP_ASSETS_WIDTH, position.y / MAP_ASSETS_HEIGHT,
            ));
        }
    }

    private setPlayer(): void {
        const selected = this.selectedPlayer.value;
        this.drivers[selected].vehicle = this.drivers[selected].vehicle.makePlayer();
        for (const driver of this.drivers) {
            driver.controlType = DriverControlType.AI_GRADIENT;
        }

        const last = MenuPlayer.__COUNT - 1;
        [this.positions[selected], this.positions[last]] = [this.positions[last], this.positions[selected]];
        // The player starts last; only the seven AI grid places are shuffled.
        for (let i = last - 1; i > 0; i--) {
            const other = Math.floor(Math.random() * (i + 1));
            [this.positions[i], this.positions[other]] = [this.positions[other], this.positions[i]];
        }
    }

    /** Create all eight characters with the shuffled, CC-specific AI modifiers. */
    async init(speedMultiplier: number, playerCharacterMultiplier: number, circuit: RaceCircuit): Promise<void> {
        VehicleProperties.setScaleFactor(speedMultiplier, playerCharacterMultiplier);
        Lakitu.reset();
        Gui.reset(true);
        this.currentCircuit = circuit;

        const modifiers = Array.from({ length: MenuPlayer.__COUNT }, (_, index) => index);
        for (let i = modifiers.length - 1; i > 0; i--) {
            const other = Math.floor(Math.random() * (i + 1));
            [modifiers[i], modifiers[other]] = [modifiers[other], modifiers[i]];
        }

        // Character lookup stays fixed; the other arrays track race order and cup scores.
        // Drivers retain this same positions array as it is populated and later reordered.
        for (let i = 0; i < MenuPlayer.__COUNT; i++) {
            const modifier = modifiers[i];
            const driver = new Driver(DRIVER_ASSET_NAMES[i], new sf.Vector2f(),
                -Math.PI / 2, MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT,
                DriverControlType.DISABLED, DRIVER_PROPERTIES[i], i, this.positions, true,
                FAR_VISIONS[this.ccOption][modifier], ITEM_PROB_MODS[this.ccOption][modifier],
                IMPEDIMENTS[this.ccOption][modifier]);
            this.drivers.push(driver);
            this.positions.push(driver);
            this.grandPrixRanking.push([driver, 0]);
        }

        this.currentState = RaceState.NO_PLAYER;
        await Promise.all(this.drivers.map(driver => driver.ready));
    }

    private async prepareRace(circuit: RaceCircuit): Promise<void> {
        const player = this.drivers[this.selectedPlayer.value];
        player.controlType = DriverControlType.PLAYER;
        await Map.loadCourse(CIRCUIT_ASSET_NAMES[circuit]);
        await Audio.loadCircuit(CIRCUIT_ASSET_NAMES[circuit]);
        this.resetBeforeRace();

        // Prepare the finish camera now so revealing RaceEnd needs no asset load.
        const raceEnd = new StateRaceEnd(this.game, player, this.drivers, this.selectedPlayer.value, this.positions);
        await raceEnd.ready;
        this.preparedRaceEnd = raceEnd;
    }

    private startRace(circuit: RaceCircuit, raceEnd: StateRaceEnd): void {
        const player = this.drivers[this.selectedPlayer.value];
        const playerPosition = this.positions.findIndex(driver => driver.getPj() === this.selectedPlayer.value);

        // Push bottom to top: RaceStart reveals Race, then Race reveals RaceEnd.
        this.game.pushState(raceEnd);
        StateRace.ccOption = this.ccOption;
        Driver.realPlayer = player;
        this.game.pushState(new StateRace(this.game, player, this.drivers, this.positions));

        Audio.playMusic(Music.CIRCUIT_ANIMATION_START, false);
        const cameraPosition = Map.getPlayerInitialPosition(playerPosition + 1);
        Audio.updateListener(cameraPosition, -Math.PI / 2, 0);
        for (let i = 0; i < this.drivers.length; i++) {
            const driver = this.drivers[i];
            Audio.updateEngine(i, driver.position, driver.height, 0, 0);
        }
        Audio.playEngines(this.selectedPlayer.value, false);

        this.game.pushState(new StateRaceStart(
            this.game, player, this.drivers, cameraPosition, circuit, this.ccOption,
        ));
    }

    /** Advance the original stack workflow, using ready for async course changes. */
    update(_deltaTime: sf.Time): boolean {
        switch (this.currentState) {
            case RaceState.NO_PLAYER:
                Audio.playMusic(Music.MENU_PLAYER_CIRCUIT);
                this.game.pushState(new StatePlayerSelection(this.game, this.selectedPlayer));
                this.currentState = RaceState.YES_PLAYER;
                break;
            case RaceState.YES_PLAYER:
                this.setPlayer();
                this.currentState = RaceState.RACING;
                break;
            case RaceState.RACING: {
                if (!this.preparedRaceEnd) {
                    // Game awaits ready after update; the next update installs the stack.
                    this.ready = this.prepareRace(this.currentCircuit);
                } else {
                    this.startRace(this.currentCircuit, this.preparedRaceEnd);
                    this.preparedRaceEnd = undefined;
                    this.currentCircuit++;
                    this.currentState = RaceState.STANDINGS;
                }
                break;
            }
            case RaceState.STANDINGS: {
                // The manager resumes here only after both Race and RaceEnd have popped.
                Audio.stopEngines();
                const lastCircuit = this.currentCircuit - 1;

                if ((this.mode === RaceMode.GRAND_PRIX_1 && this.currentCircuit === RaceCircuit.__COUNT) ||
                    this.mode === RaceMode.VERSUS) {
                    if (this.mode === RaceMode.VERSUS) {
                        // Versus has no points screen; podium order comes directly from this race.
                        for (let i = 0; i < this.grandPrixRanking.length; i++) {
                            this.grandPrixRanking[i][0] = this.positions[i];
                        }
                    }
                    this.currentState = RaceState.CONGRATULATIONS;
                }

                if (this.mode === RaceMode.GRAND_PRIX_1) {
                    this.game.pushState(new StateGPStandings(
                        this.game, this.positions, this.grandPrixRanking, lastCircuit, this.selectedPlayer.value,
                    ));
                    if (this.currentCircuit !== RaceCircuit.__COUNT) {
                        this.currentState = RaceState.RACING;
                    }
                }
                break;
            }
            case RaceState.CONGRATULATIONS:
                this.game.pushState(new StateCongratulations(
                    this.game, this.currentCircuit - 1, this.mode, this.ccOption,
                    this.selectedPlayer.value, this.grandPrixRanking,
                ));
                this.currentState = RaceState.DONE;
                break;
            case RaceState.DONE:
                // Remove the manager and old title; InitLoad creates a fresh title state.
                this.game.popState();
                this.game.popState();
                break;
        }
        return true;
    }

    /** State stack diagnostic name. */
    string(): string {
        return "RaceManager";
    }
}
