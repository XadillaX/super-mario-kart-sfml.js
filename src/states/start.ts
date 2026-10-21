import * as sf from "sfml.js";
import type { Game } from "../game";
import { Audio, Music, SFX } from "../audio/audio";
import { Driver } from "../entities/driver";
import { DriverAnimator } from "../entities/driveranimator";
import { DRIVER_ASSET_NAMES, DriverControlType, MenuPlayer } from "../entities/enums";
import { VehicleProperties } from "../entities/vehicleproperties";
import { Color, TextUtils } from "../gui/textutils";
import { Input, Key } from "../input/input";
import { CCOption, MAP_ASSETS_HEIGHT, MAP_ASSETS_WIDTH } from "../map/enums";
import { Map } from "../map/map";
import { Settings } from "../settings";
import { StateRaceDemo } from "./racedemo";
import { CIRCUIT_ASSET_NAMES, CIRCUIT_DISPLAY_NAMES, RaceCircuit, RaceMode, StateRaceManager } from "./racemanager";
import { State } from "./statebase";

enum MenuState {
    INTRO_FADE_IN,
    NO_MENUS,
    DEMO_FADE,
    MENU_FADE_IN,
    MENU,
    CC_FADE_IN,
    CC,
    CC_FADE_OUT,
    CIRCUIT_FADE_IN,
    CIRCUIT,
    CIRCUIT_FADE_OUT,
    CONTROLS_FADE_IN,
    CONTROLS,
    CONTROLS_FADE_OUT,
    SETTINGS_FADE_IN,
    SETTINGS,
    SETTINGS_FADE_OUT,
    MENU_FADE_OUT,
    GAME_FADE,
    EXIT_CONFIRM,
}

enum MenuOption {
    GRAND_PRIX,
    VERSUS,
    CONTROLS,
    SETTINGS,
    __COUNT,
}

enum SettingsOption {
    VOLUME_MUSIC,
    VOLUME_SFX,
    RESOLUTION,
    __COUNT,
}

/** Animated title screen, every original selection/configuration menu, and demo entry. */
export class StateStart extends State {
    private static readonly assetBackground = new sf.Texture();
    private static readonly assetLogo = new sf.Texture();
    private static readonly TIME_FADE_TOTAL = 0.5;
    private static readonly TIME_DEMO_WAIT = 10;
    private static readonly TIME_MENU_TWEEN = 0.25;
    private static readonly TIME_CC_TWEEN = 0.25;
    private static readonly TIME_CIRCUIT_TWEEN = 0.25;
    private static readonly TIME_CONTROLS_TWEEN = 0.5;
    private static readonly TIME_SETTINGS_TWEEN = 0.25;

    private readonly driverMovementPercent: sf.Vector2f[] = [];
    private readonly driverSpeed: number[] = [];
    private readonly driverAnimators: DriverAnimator[] = [];

    private readonly assetLoadedMap = new sf.Texture();
    private randomMapLoaded = false;
    /** A preview replaces the shared course without rebuilding the demo's AI cache. */
    private randomMapOverwritten = false;

    private currentState = MenuState.INTRO_FADE_IN;
    private timeSinceStateChange = sf.Time.Zero;
    private selectedOption = 0;
    // Rebinding is armed during update, after the event that requested it has finished.
    private keyChangeRequested = false;
    private waitingForKeyPress = false;

    private backgroundPosition = 0;
    private selectedMode = MenuOption.GRAND_PRIX;
    private selectedCircuit = RaceCircuit.DONUT_PLAINS_1;
    private selectedCC = CCOption.CC50;

    /** Load the scrolling title background and logo from their original atlas regions. */
    static async loadBackgroundAssets(
        assetName: string, roiBackground: sf.IntRect, roiLogo: sf.IntRect,
    ): Promise<void> {
        if (!await this.assetBackground.loadFromFile(assetName, false, roiBackground)) {
            throw new Error(`Unable to load title background: ${assetName}`);
        }
        this.assetBackground.setRepeated(true);
        if (!await this.assetLogo.loadFromFile(assetName, false, roiLogo)) {
            throw new Error(`Unable to load title logo: ${assetName}`);
        }
    }

    /** Await title animators and the attract-mode course before displaying the menu. */
    constructor(game: Game) {
        super(game);
        this.ready = this.init();
    }

    private async loadRandomMap(): Promise<void> {
        this.randomMapLoaded = false;
        this.randomMapOverwritten = false;
        const course = CIRCUIT_ASSET_NAMES[Math.floor(Math.random() * CIRCUIT_ASSET_NAMES.length)];
        if (!await Map.loadCourse(course)) {
            throw new Error(`Unable to load demo course: ${course}`);
        }
        Map.loadAI();
        this.randomMapLoaded = true;
    }

    private async loadPreview(circuit: RaceCircuit): Promise<void> {
        this.randomMapOverwritten = true;
        const course = CIRCUIT_ASSET_NAMES[circuit];
        if (!await Map.loadCourse(course)) {
            throw new Error(`Unable to load circuit preview: ${course}`);
        }

        // Center the preview camera behind the eight-player grid.
        const ninth = Map.getPlayerInitialPosition(9);
        const tenth = Map.getPlayerInitialPosition(10);
        const pseudoPlayer = new Driver(
            "assets/drivers/invisible.png",
            new sf.Vector2f((ninth.x + tenth.x) / 2, (ninth.y + tenth.y) / 2),
            -Math.PI / 2, MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT,
            DriverControlType.DISABLED, VehicleProperties.GODMODE, MenuPlayer.MARIO,
        );
        await pseudoPlayer.ready;

        // Expand the normal road slice to fill the menu background vertically.
        const size = this.game.getWindow().getSize();
        Map.circuitTexture(pseudoPlayer, this.assetLoadedMap, new sf.Vector2u(
            Math.trunc(size.x / Map.CIRCUIT_HEIGHT_PCT), Math.trunc(size.y / Map.CIRCUIT_HEIGHT_PCT),
        ));
    }

    private requestPreview(circuit: RaceCircuit): void {
        // Events may queue several selections before Game reaches its ready barrier.
        this.ready = this.ready.then(() => this.loadPreview(circuit));
    }

    /** Initialize title music, passing drivers, and the fully tracked random-map load. */
    async init(): Promise<void> {
        Audio.playMusic(Music.MENU_TITLE_SCREEN);
        this.currentState = MenuState.INTRO_FADE_IN;
        this.backgroundPosition = 0;
        this.timeSinceStateChange = sf.Time.Zero;
        this.selectedOption = 0;
        this.waitingForKeyPress = false;
        this.keyChangeRequested = false;

        for (let i = 0; i < MenuPlayer.__COUNT; i++) {
            this.driverAnimators.push(new DriverAnimator(DRIVER_ASSET_NAMES[i]));
            this.driverMovementPercent.push(new sf.Vector2f(-1, 0));
            this.driverSpeed.push(0);
        }
        await Promise.all([
            this.loadRandomMap(),
            ...this.driverAnimators.map(animator => animator.ready),
        ]);
    }

    private changeState(state: MenuState): void {
        this.currentState = state;
        this.timeSinceStateChange = sf.Time.Zero;
    }

    private moveSelection(direction: number, count: number): void {
        Audio.play(SFX.MENU_SELECTION_MOVE);
        this.selectedOption = (this.selectedOption + direction + count) % count;
    }

    /** Preserve menu navigation, configurable controls, volume/resolution changes, and exit confirmation. */
    handleEvent(event: sf.Event): void {
        // A transition resets the clock; ignore more events until the new menu has updated.
        if (this.timeSinceStateChange.asMicroseconds() === 0n) {
            return;
        }

        const accept = Input.pressed(Key.ACCEPT, event) || Input.pressed(Key.ACCELERATE, event);
        switch (this.currentState) {
            case MenuState.EXIT_CONFIRM:
                if (accept) {
                    if (this.selectedOption === 0) {
                        this.game.popState();
                        this.game.popState();
                    } else {
                        Audio.play(SFX.MENU_SELECTION_CANCEL);
                        this.changeState(MenuState.NO_MENUS);
                    }
                } else if (Input.pressed(Key.CANCEL, event)) {
                    Audio.play(SFX.MENU_SELECTION_CANCEL);
                    this.changeState(MenuState.NO_MENUS);
                    this.selectedOption = 0;
                } else if (Input.pressed(Key.MENU_RIGHT, event)) {
                    Audio.play(SFX.MENU_SELECTION_MOVE);
                    this.selectedOption = 1;
                } else if (Input.pressed(Key.MENU_LEFT, event)) {
                    Audio.play(SFX.MENU_SELECTION_MOVE);
                    this.selectedOption = 0;
                }
                break;
            case MenuState.NO_MENUS:
                if (Input.pressed(Key.MENU_UP, event) || Input.pressed(Key.MENU_DOWN, event) ||
                    Input.pressed(Key.MENU_LEFT, event) || Input.pressed(Key.MENU_RIGHT, event) || accept) {
                    Audio.play(SFX.MENU_SELECTION_MOVE);
                    this.changeState(MenuState.MENU_FADE_IN);
                } else if (Input.pressed(Key.CANCEL, event)) {
                    Audio.play(SFX.MENU_SELECTION_CANCEL);
                    this.changeState(MenuState.EXIT_CONFIRM);
                    this.selectedOption = 1;
                }
                break;
            case MenuState.MENU:
                if (accept) {
                    Audio.play(SFX.MENU_SELECTION_ACCEPT);
                    switch (this.selectedOption) {
                        case MenuOption.GRAND_PRIX:
                            this.selectedMode = MenuOption.GRAND_PRIX;
                            this.currentState = MenuState.CC_FADE_IN;
                            break;
                        case MenuOption.VERSUS:
                            this.selectedMode = MenuOption.VERSUS;
                            this.currentState = MenuState.CC_FADE_IN;
                            break;
                        case MenuOption.CONTROLS:
                            this.currentState = MenuState.CONTROLS_FADE_IN;
                            break;
                        case MenuOption.SETTINGS:
                            this.currentState = MenuState.SETTINGS_FADE_IN;
                            break;
                    }
                    this.timeSinceStateChange = sf.Time.Zero;
                } else if (Input.pressed(Key.CANCEL, event)) {
                    Audio.play(SFX.MENU_SELECTION_CANCEL);
                    this.changeState(MenuState.MENU_FADE_OUT);
                } else if (Input.pressed(Key.MENU_DOWN, event)) {
                    this.moveSelection(1, MenuOption.__COUNT);
                } else if (Input.pressed(Key.MENU_UP, event)) {
                    this.moveSelection(-1, MenuOption.__COUNT);
                }
                break;
            case MenuState.CC:
                if (accept) {
                    Audio.play(SFX.MENU_SELECTION_ACCEPT);
                    // Grand Prix fixes the course order; Versus asks for a circuit first.
                    switch (this.selectedMode) {
                        case MenuOption.GRAND_PRIX:
                            this.currentState = MenuState.GAME_FADE;
                            break;
                        case MenuOption.VERSUS:
                            this.requestPreview(RaceCircuit.DONUT_PLAINS_1);
                            this.currentState = MenuState.CIRCUIT_FADE_IN;
                            break;
                    }
                    this.selectedCC = this.selectedOption;
                    this.timeSinceStateChange = sf.Time.Zero;
                } else if (Input.pressed(Key.CANCEL, event)) {
                    Audio.play(SFX.MENU_SELECTION_CANCEL);
                    this.changeState(MenuState.CC_FADE_OUT);
                } else if (Input.pressed(Key.MENU_DOWN, event)) {
                    this.moveSelection(1, CCOption.__COUNT);
                } else if (Input.pressed(Key.MENU_UP, event)) {
                    this.moveSelection(-1, CCOption.__COUNT);
                }
                break;
            case MenuState.CIRCUIT:
                if (accept) {
                    Audio.play(SFX.MENU_SELECTION_ACCEPT);
                    this.selectedCircuit = this.selectedOption;
                    this.changeState(MenuState.GAME_FADE);
                } else if (Input.pressed(Key.CANCEL, event)) {
                    Audio.play(SFX.MENU_SELECTION_CANCEL);
                    this.changeState(MenuState.CIRCUIT_FADE_OUT);
                } else if (Input.pressed(Key.MENU_DOWN, event)) {
                    this.moveSelection(1, RaceCircuit.__COUNT);
                    this.requestPreview(this.selectedOption);
                } else if (Input.pressed(Key.MENU_UP, event)) {
                    this.moveSelection(-1, RaceCircuit.__COUNT);
                    this.requestPreview(this.selectedOption);
                }
                break;
            case MenuState.CONTROLS: {
                const key = event.getIf("KeyPressed");
                // Capture a binding before interpreting the same key as menu navigation.
                if (this.waitingForKeyPress && key && Input.getKeyCodeName(key.code) !== "?") {
                    Audio.play(SFX.MENU_SELECTION_ACCEPT);
                    this.waitingForKeyPress = false;
                    Input.set(this.selectedOption, key.code);
                } else if (accept) {
                    Audio.play(SFX.MENU_SELECTION_MOVE);
                    this.keyChangeRequested = true;
                } else if (Input.pressed(Key.CANCEL, event)) {
                    Audio.play(SFX.MENU_SELECTION_CANCEL);
                    this.changeState(MenuState.CONTROLS_FADE_OUT);
                } else if (Input.pressed(Key.MENU_UP, event)) {
                    this.moveSelection(-1, Key.__COUNT);
                } else if (Input.pressed(Key.MENU_DOWN, event)) {
                    this.moveSelection(1, Key.__COUNT);
                }
                break;
            }
            case MenuState.SETTINGS:
                if (Input.pressed(Key.MENU_LEFT, event)) {
                    this.adjustSetting(-1);
                } else if (Input.pressed(Key.MENU_RIGHT, event)) {
                    this.adjustSetting(1);
                } else if (Input.pressed(Key.CANCEL, event)) {
                    Audio.play(SFX.MENU_SELECTION_CANCEL);
                    this.changeState(MenuState.SETTINGS_FADE_OUT);
                } else if (Input.pressed(Key.MENU_UP, event)) {
                    this.moveSelection(-1, SettingsOption.__COUNT);
                } else if (Input.pressed(Key.MENU_DOWN, event)) {
                    this.moveSelection(1, SettingsOption.__COUNT);
                }
                break;
        }
    }

    private adjustSetting(direction: number): void {
        let musicVolume = Audio.getMusicVolume();
        let sfxVolume = Audio.getSfxVolume();
        switch (this.selectedOption) {
            case SettingsOption.VOLUME_MUSIC:
                Audio.play(SFX.MENU_SELECTION_MOVE);
                musicVolume = Math.max(0, Math.min(1, musicVolume + direction * 0.05));
                break;
            case SettingsOption.VOLUME_SFX:
                Audio.play(SFX.MENU_SELECTION_MOVE);
                sfxVolume = Math.max(0, Math.min(1, sfxVolume + direction * 0.05));
                break;
            case SettingsOption.RESOLUTION: {
                const changed = direction < 0
                    ? Settings.decrementResolutionMultiplier() : Settings.incrementResolutionMultiplier();
                if (changed) {
                    Audio.play(direction < 0 ? SFX.CIRCUIT_PLAYER_SHRINK : SFX.CIRCUIT_PLAYER_GROW);
                    this.game.updateResolution();
                }
                break;
            }
        }
        Audio.setVolume(musicVolume, sfxVolume);
    }

    /** Advance exact menu timings, animated title drivers, and selected race entry. */
    update(deltaTime: sf.Time): boolean {
        this.timeSinceStateChange = sf.add(this.timeSinceStateChange, deltaTime);

        // Defer capture so Enter is not immediately stored as the requested binding.
        if (this.keyChangeRequested) {
            this.keyChangeRequested = false;
            this.waitingForKeyPress = true;
        }

        const time = this.timeSinceStateChange.asSeconds();
        if (this.currentState === MenuState.INTRO_FADE_IN && time > StateStart.TIME_FADE_TOTAL) {
            this.changeState(MenuState.NO_MENUS);
        } else if (this.currentState === MenuState.NO_MENUS || this.currentState === MenuState.INTRO_FADE_IN) {
            this.backgroundPosition -= -22 * deltaTime.asSeconds();
            for (let i = 0; i < this.driverMovementPercent.length; i++) {
                if (this.driverMovementPercent[i].x !== -1) {
                    this.driverMovementPercent[i].x += this.driverSpeed[i] * deltaTime.asSeconds();
                }
            }

            // Reuse an off-screen driver for each randomly timed background pass.
            if (Math.random() < deltaTime.asSeconds() / 2) {
                const id = Math.floor(Math.random() * this.driverAnimators.length);
                const movement = this.driverMovementPercent[id];
                if (movement.x === -1 || movement.x > 1) {
                    movement.x = -0.25;
                    movement.y = 0.6 + Math.floor(Math.random() * 5) * 0.03;
                    this.driverSpeed[id] = 1 / 6 + Math.random() / 6;
                }
            }

            // Course previews invalidate the demo setup until a fresh title state is created.
            if (this.currentState === MenuState.NO_MENUS && time > StateStart.TIME_DEMO_WAIT &&
                this.randomMapLoaded && !this.randomMapOverwritten) {
                this.changeState(MenuState.DEMO_FADE);
            }
        } else if (this.currentState === MenuState.DEMO_FADE && time > StateStart.TIME_FADE_TOTAL) {
            this.game.pushState(new StateRaceDemo(this.game));
        } else if (this.currentState === MenuState.MENU_FADE_IN && time > StateStart.TIME_MENU_TWEEN) {
            this.changeState(MenuState.MENU);
            this.selectedOption = 0;
        } else if (this.currentState === MenuState.MENU_FADE_OUT && time > StateStart.TIME_MENU_TWEEN) {
            this.changeState(MenuState.NO_MENUS);
            this.selectedOption = 0;
        } else if (this.currentState === MenuState.CC_FADE_IN &&
            time > StateStart.TIME_MENU_TWEEN + StateStart.TIME_CC_TWEEN) {
            // Submenus open only after the old panel closes and the new panel expands.
            this.changeState(MenuState.CC);
            this.selectedOption = 0;
        } else if (this.currentState === MenuState.CIRCUIT_FADE_IN &&
            time > StateStart.TIME_CC_TWEEN + StateStart.TIME_CIRCUIT_TWEEN) {
            this.changeState(MenuState.CIRCUIT);
            this.selectedOption = 0;
        } else if (this.currentState === MenuState.CONTROLS_FADE_IN &&
            time > StateStart.TIME_MENU_TWEEN + StateStart.TIME_CONTROLS_TWEEN) {
            this.changeState(MenuState.CONTROLS);
            this.selectedOption = 0;
            this.keyChangeRequested = false;
            this.waitingForKeyPress = false;
        } else if (this.currentState === MenuState.SETTINGS_FADE_IN &&
            time > StateStart.TIME_MENU_TWEEN + StateStart.TIME_SETTINGS_TWEEN) {
            this.changeState(MenuState.SETTINGS);
            this.selectedOption = 0;
        } else if (this.currentState === MenuState.CC_FADE_OUT &&
            time > StateStart.TIME_CIRCUIT_TWEEN + StateStart.TIME_CC_TWEEN) {
            this.changeState(MenuState.MENU);
            this.selectedOption = 0;
        } else if (this.currentState === MenuState.CIRCUIT_FADE_OUT &&
            time > StateStart.TIME_MENU_TWEEN + StateStart.TIME_CIRCUIT_TWEEN) {
            this.changeState(MenuState.CC);
            this.selectedOption = 0;
        } else if (this.currentState === MenuState.CONTROLS_FADE_OUT &&
            time > StateStart.TIME_MENU_TWEEN + StateStart.TIME_CONTROLS_TWEEN) {
            this.changeState(MenuState.MENU);
            this.selectedOption = 0;
        } else if (this.currentState === MenuState.SETTINGS_FADE_OUT &&
            time > StateStart.TIME_MENU_TWEEN + StateStart.TIME_SETTINGS_TWEEN) {
            this.changeState(MenuState.MENU);
            this.selectedOption = 0;
        } else if (this.currentState === MenuState.GAME_FADE && time > StateStart.TIME_FADE_TOTAL &&
            this.randomMapLoaded) {
            // CC scales every kart; the separate player factor preserves the original balance.
            let speedMultiplier = 1;
            let playerCharacterMultiplier = 1;
            switch (this.selectedCC) {
                case CCOption.CC50:
                    speedMultiplier = 1.75;
                    playerCharacterMultiplier = 1.15;
                    break;
                case CCOption.CC100:
                    speedMultiplier = 2.1;
                    playerCharacterMultiplier = 1.09;
                    break;
                case CCOption.CC150:
                    speedMultiplier = 2.7;
                    playerCharacterMultiplier = 1.055;
                    break;
                default:
                    console.error("Error: Invalid CC option");
                    break;
            }

            if (this.selectedMode === MenuOption.GRAND_PRIX) {
                this.game.pushState(new StateRaceManager(
                    this.game, RaceMode.GRAND_PRIX_1, speedMultiplier, playerCharacterMultiplier, this.selectedCC,
                ));
            } else if (this.selectedMode === MenuOption.VERSUS) {
                this.game.pushState(new StateRaceManager(
                    this.game, RaceMode.VERSUS, speedMultiplier, playerCharacterMultiplier,
                    this.selectedCC, this.selectedCircuit,
                ));
            } else {
                console.error("Error: wrong gamemode selected");
            }
        }
        return true;
    }

    /** Render the original title composition, menu box tweens, labels, and overlays. */
    draw(window: sf.RenderTarget): void {
        const size = window.getSize();
        const backgroundSize = StateStart.assetBackground.getSize();
        const scale = size.y / backgroundSize.y;
        const time = this.timeSinceStateChange.asSeconds();
        const state = this.currentState;

        // Background traffic is depth-sorted before the logo and menu overlays are drawn.
        const background = new sf.Sprite(StateStart.assetBackground);
        background.setTextureRect(new sf.IntRect(
            new sf.Vector2i(Math.trunc(this.backgroundPosition * scale), 0),
            new sf.Vector2i(backgroundSize.x, backgroundSize.y),
        ));
        background.setScale(new sf.Vector2f(scale, scale));
        window.draw(background);

        const drivers: [sf.Sprite, number][] = [];
        for (let i = 0; i < this.driverAnimators.length; i++) {
            const sprite = this.driverAnimators[i].getMinimapSprite(0, scale / 1.9);
            const movement = this.driverMovementPercent[i];
            sprite.setOrigin(new sf.Vector2f());
            sprite.setPosition(new sf.Vector2f(
                movement.x * size.x,
                (movement.y + (Math.trunc(movement.x / 0.05) % 2 === 0 ? 0.0025 : 0)) * size.y,
            ));
            drivers.push([sprite, sprite.getPosition().y]);
        }
        drivers.sort((left, right) => left[1] - right[1]);
        for (const [sprite] of drivers) {
            window.draw(sprite);
        }

        // Course selection crossfades a rendered track preview over the title background.
        if (state === MenuState.CIRCUIT_FADE_IN || state === MenuState.CIRCUIT ||
            state === MenuState.CIRCUIT_FADE_OUT ||
            (state === MenuState.GAME_FADE && this.selectedMode === MenuOption.VERSUS)) {
            const preview = new sf.Sprite(this.assetLoadedMap);
            const circuitSize = this.assetLoadedMap.getSize();
            const circuitScale = size.y / circuitSize.y;
            preview.setScale(new sf.Vector2f(circuitScale, circuitScale));
            preview.setPosition(new sf.Vector2f((size.x - circuitSize.x * circuitScale) / 2, 0));
            let alpha = 255;
            const duration = StateStart.TIME_CIRCUIT_TWEEN + StateStart.TIME_CC_TWEEN;
            if (state === MenuState.CIRCUIT_FADE_IN) {
                alpha = Math.min(time / duration * 255, 255);
            } else if (state === MenuState.CIRCUIT_FADE_OUT) {
                alpha = Math.max((1 - time / duration) * 255, 0);
            }
            preview.setColor(new sf.Color(255, 255, 255, Math.trunc(alpha)));
            window.draw(preview);
        }

        const logo = new sf.Sprite(StateStart.assetLogo);
        logo.setOrigin(new sf.Vector2f(StateStart.assetLogo.getSize().x / 2, 0));
        logo.setScale(new sf.Vector2f(scale, scale));
        logo.setPosition(new sf.Vector2f(128 / 256 * size.x, 26 / 224 * size.y));
        window.draw(logo);

        // Layout stays in original 256x224 coordinates, scaled independently per axis.
        const position = (x: number, y: number): sf.Vector2f => new sf.Vector2f(x / 256 * size.x, y / 224 * size.y);
        const drawBox = (x: number, y: number, width: number, height: number, pct: number): void => {
            if (pct <= 0) {
                return;
            }
            const box = new sf.RectangleShape(new sf.Vector2f(width * pct / 256 * size.x, height * pct / 224 * size.y));
            box.setFillColor(sf.Color.Black);
            box.setPosition(position(x + width * (1 - pct) / 2, y + height * (1 - pct) / 2));
            window.draw(box);
        };
        const selectedColor = (index: number): sf.ReadonlyValue<sf.Color> =>
            index === this.selectedOption ? Color.MenuPrimaryOnFocus : Color.MenuPrimary;

        // Each panel owns its tween interval; labels appear only once that panel is open.
        let pctMenu = 0;
        if (state === MenuState.MENU) {
            pctMenu = 1;
        } else if (state === MenuState.MENU_FADE_IN) {
            pctMenu = Math.min(time / StateStart.TIME_MENU_TWEEN, 1);
        } else if (state === MenuState.MENU_FADE_OUT ||
            (state === MenuState.CC_FADE_IN && time < StateStart.TIME_MENU_TWEEN) ||
            (state === MenuState.CONTROLS_FADE_IN && time < StateStart.TIME_MENU_TWEEN) ||
            (state === MenuState.SETTINGS_FADE_IN && time < StateStart.TIME_MENU_TWEEN)) {
            pctMenu = Math.max(1 - time / StateStart.TIME_MENU_TWEEN, 0);
        } else if (state === MenuState.CC_FADE_OUT && time > StateStart.TIME_CC_TWEEN) {
            pctMenu = Math.min((time - StateStart.TIME_CC_TWEEN) / StateStart.TIME_MENU_TWEEN, 1);
        } else if (state === MenuState.CONTROLS_FADE_OUT && time > StateStart.TIME_CONTROLS_TWEEN) {
            pctMenu = Math.min((time - StateStart.TIME_CONTROLS_TWEEN) / StateStart.TIME_MENU_TWEEN, 1);
        } else if (state === MenuState.SETTINGS_FADE_OUT && time > StateStart.TIME_SETTINGS_TWEEN) {
            pctMenu = Math.min((time - StateStart.TIME_SETTINGS_TWEEN) / StateStart.TIME_MENU_TWEEN, 1);
        }
        drawBox(50, 120, 156, 80, pctMenu);
        if (state === MenuState.MENU) {
            const labels = ["grand prix", "versus", "controls", "settings"];
            for (let i = 0; i < labels.length; i++) {
                TextUtils.write(window, labels[i], position(70, 132 + i * 16), scale, selectedColor(i));
            }
        }

        let pctCC = 0;
        if (state === MenuState.CC) {
            pctCC = 1;
        } else if ((state === MenuState.CC_FADE_IN && time > StateStart.TIME_MENU_TWEEN) ||
            (state === MenuState.CIRCUIT_FADE_OUT && time > StateStart.TIME_CIRCUIT_TWEEN)) {
            pctCC = Math.min((time - StateStart.TIME_CIRCUIT_TWEEN) / StateStart.TIME_CC_TWEEN, 1);
        } else if ((state === MenuState.CC_FADE_OUT && time < StateStart.TIME_CC_TWEEN) ||
            (state === MenuState.CIRCUIT_FADE_IN && time < StateStart.TIME_CC_TWEEN)) {
            pctCC = Math.max(1 - time / StateStart.TIME_CC_TWEEN, 0);
        }
        drawBox(50, 128, 156, 48, pctCC);
        if (state === MenuState.CC) {
            const labels = ["easy......50 cc", "normal...100 cc", "hard.....150 cc"];
            for (let i = 0; i < labels.length; i++) {
                TextUtils.write(window, labels[i], position(58, 136 + i * 12), scale, selectedColor(i));
            }
        }

        // Circuit choices overlay the preview and share the CC panel's close/open sequence.
        let pctCircuit = 0;
        if (state === MenuState.CIRCUIT) {
            pctCircuit = 1;
        } else if (state === MenuState.CIRCUIT_FADE_IN && time > StateStart.TIME_CC_TWEEN) {
            pctCircuit = Math.min((time - StateStart.TIME_CC_TWEEN) / StateStart.TIME_CIRCUIT_TWEEN, 1);
        } else if (state === MenuState.CIRCUIT_FADE_OUT && time < StateStart.TIME_CIRCUIT_TWEEN) {
            pctCircuit = Math.max(1 - time / StateStart.TIME_CIRCUIT_TWEEN, 0);
        }
        drawBox(50, 116, 156, 72, pctCircuit);
        if (state === MenuState.CIRCUIT) {
            for (let i = 0; i < RaceCircuit.__COUNT; i++) {
                TextUtils.write(window, CIRCUIT_DISPLAY_NAMES[i], position(58, 124 + i * 12), scale, selectedColor(i));
            }
        }

        let pctControls = 0;
        if (state === MenuState.CONTROLS) {
            pctControls = 1;
        } else if (state === MenuState.CONTROLS_FADE_IN && time > StateStart.TIME_MENU_TWEEN) {
            pctControls = Math.min((time - StateStart.TIME_MENU_TWEEN) / StateStart.TIME_CONTROLS_TWEEN, 1);
        } else if (state === MenuState.CONTROLS_FADE_OUT && time < StateStart.TIME_CONTROLS_TWEEN) {
            pctControls = Math.max(1 - time / StateStart.TIME_CONTROLS_TWEEN, 0);
        }
        drawBox(28, 12, 200, 200, pctControls);
        if (state === MenuState.CONTROLS) {
            TextUtils.write(window, "action", position(36, 20), scale, Color.MenuSecondary);
            TextUtils.write(window, "key", position(146, 20), scale, Color.MenuSecondary);
            const focus = this.waitingForKeyPress ? Color.MenuActive : Color.MenuPrimaryOnFocus;
            for (let i = 0; i < Key.__COUNT; i++) {
                const color = i === this.selectedOption ? focus : Color.MenuPrimary;
                TextUtils.write(window, Input.getActionName(i), position(36, 40 + i * 10), scale, color);
                TextUtils.write(window, Input.getKeyCodeName(Input.get(i)), position(146, 40 + i * 10), scale, color);
            }
        }

        let pctSettings = 0;
        if (state === MenuState.SETTINGS) {
            pctSettings = 1;
        } else if (state === MenuState.SETTINGS_FADE_IN && time > StateStart.TIME_MENU_TWEEN) {
            pctSettings = Math.min((time - StateStart.TIME_MENU_TWEEN) / StateStart.TIME_SETTINGS_TWEEN, 1);
        } else if (state === MenuState.SETTINGS_FADE_OUT && time < StateStart.TIME_SETTINGS_TWEEN) {
            pctSettings = Math.max(1 - time / StateStart.TIME_SETTINGS_TWEEN, 0);
        }
        drawBox(18, 112, 220, 64, pctSettings);
        if (state === MenuState.SETTINGS) {
            TextUtils.write(window, "setting", position(26, 120), scale, Color.MenuSecondary);
            TextUtils.write(window, "value", position(144, 120), scale, Color.MenuSecondary);
            const { width, height } = this.game.getCurrentResolution();
            const labels = ["music volume", "sfx volume", "resolution"];
            const values = [
                String(Math.trunc((Audio.getMusicVolume() + 0.005) * 100)),
                String(Math.trunc((Audio.getSfxVolume() + 0.005) * 100)),
                `${width}x${height}`,
            ];
            for (let i = 0; i < labels.length; i++) {
                const color = selectedColor(i);
                TextUtils.write(window, labels[i], position(26, 140 + i * 10), scale, color);
                TextUtils.write(window, "<        >", position(189, 140 + i * 10), scale,
                    color, true, TextUtils.TextAlign.CENTER);
                TextUtils.write(window, values[i], position(189, 140 + i * 10), scale,
                    color, true, TextUtils.TextAlign.CENTER);
            }
        }

        // Exit confirmation replaces the whole scene instead of another expanding panel.
        if (state === MenuState.EXIT_CONFIRM) {
            const black = new sf.RectangleShape(new sf.Vector2f(size.x, size.y));
            black.setFillColor(sf.Color.Black);
            window.draw(black);
            TextUtils.write(window, "exit game?", new sf.Vector2f(size.x / 2, size.y * 0.35),
                scale * 2, Color.MenuSecondary, false, TextUtils.TextAlign.CENTER, TextUtils.TextVerticalAlign.MIDDLE);
            TextUtils.write(window, "yes", new sf.Vector2f(size.x * 0.35, size.y * 0.6),
                scale * 1.5, selectedColor(0), false, TextUtils.TextAlign.CENTER, TextUtils.TextVerticalAlign.MIDDLE);
            TextUtils.write(window, "no!", new sf.Vector2f(size.x * 0.65, size.y * 0.6),
                scale * 1.5, selectedColor(1), false, TextUtils.TextAlign.CENTER, TextUtils.TextVerticalAlign.MIDDLE);
        }

        // State transitions fade all preceding layers together.
        if (state === MenuState.INTRO_FADE_IN || state === MenuState.GAME_FADE || state === MenuState.DEMO_FADE) {
            let pct = time / StateStart.TIME_FADE_TOTAL;
            if (state === MenuState.INTRO_FADE_IN) {
                pct = 1 - pct;
            }
            const black = new sf.RectangleShape(new sf.Vector2f(size.x, size.y));
            black.setFillColor(new sf.Color(0, 0, 0, Math.trunc(Math.min(pct * 255, 255))));
            window.draw(black);
        }
    }

    /** State stack diagnostic name. */
    string(): string {
        return "Start";
    }
}
