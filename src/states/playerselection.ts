import * as sf from "sfml.js";
import type { Game } from "../game";
import { Audio, SFX } from "../audio/audio";
import { DriverAnimator } from "../entities/driveranimator";
import { DRIVER_ASSET_NAMES, MenuPlayer } from "../entities/enums";
import { Input, Key } from "../input/input";
import { State } from "./statebase";

enum SelectionState {
    FADE_IN_INTRO,
    NO_SELECTION,
    FADE_OUT_CANCEL,
    AWAIT_CONFIRMATION,
    SELECTED,
}

/** Mutable selection shared with the race manager, replacing a C++ enum reference. */
export interface PlayerSelection {
    value: MenuPlayer;
}

/** Eight-character grid with rotating confirmation portraits and cancel fades. */
export class StatePlayerSelection extends State {
    private static readonly assetBackground = new sf.Texture();
    private static readonly assetPlayerBackground = new sf.Texture();
    private static readonly assetMarquee = new sf.Texture();
    private static readonly asset1P = new sf.Texture();
    private static readonly asset1POkQ = new sf.Texture();
    private static readonly asset1POk = new sf.Texture();
    private static readonly FADE_TOTAL_TIME = sf.seconds(1);
    private static readonly PLAYER_CELL_ORIGINS = [
        new sf.Vector2f(37 / 256, 64 / 224),
        new sf.Vector2f(85 / 256, 64 / 224),
        new sf.Vector2f(133 / 256, 64 / 224),
        new sf.Vector2f(181 / 256, 64 / 224),
        new sf.Vector2f(37 / 256, 128 / 224),
        new sf.Vector2f(85 / 256, 128 / 224),
        new sf.Vector2f(133 / 256, 128 / 224),
        new sf.Vector2f(181 / 256, 128 / 224),
    ];

    private hasPopped = false;
    private fadeCurrentTime = sf.Time.Zero;
    private currentState = SelectionState.FADE_IN_INTRO;
    private framesSinceOrigin = 0;
    private readonly angles: number[] = [];
    private readonly animators: DriverAnimator[] = [];

    /** Await all portrait textures before the grid can be rendered. */
    constructor(game: Game, private readonly selectedPlayer: PlayerSelection) {
        super(game);
        this.ready = this.init();
    }

    /** Load the original background, scrolling marquee, and confirmation labels. */
    static async loadAssets(
        assetName: string,
        roiBackground: sf.IntRect,
        roiPlayerBackground: sf.IntRect,
        roiMarquee: sf.IntRect,
        roi1P: sf.IntRect,
        roi1POkQ: sf.IntRect,
        roi1POk: sf.IntRect,
    ): Promise<void> {
        await Promise.all([
            this.assetBackground.loadFromFile(assetName, false, roiBackground),
            this.assetPlayerBackground.loadFromFile(assetName, false, roiPlayerBackground),
            this.assetMarquee.loadFromFile(assetName, false, roiMarquee),
            this.asset1P.loadFromFile(assetName, false, roi1P),
            this.asset1POkQ.loadFromFile(assetName, false, roi1POkQ),
            this.asset1POk.loadFromFile(assetName, false, roi1POk),
        ]);
    }

    /** Reset the grid and initialize all eight character animators. */
    async init(): Promise<void> {
        this.currentState = SelectionState.FADE_IN_INTRO;
        this.fadeCurrentTime = sf.Time.Zero;
        this.selectedPlayer.value = MenuPlayer.MARIO;
        this.framesSinceOrigin = 0;
        this.animators.length = 0;
        this.angles.length = 0;
        for (let i = 0; i < MenuPlayer.__COUNT; i++) {
            this.animators.push(new DriverAnimator(DRIVER_ASSET_NAMES[i]));
            this.angles.push(0);
        }
        await Promise.all(this.animators.map(animator => animator.ready));
    }

    /** Navigate both rows, confirm twice, or back out to the title screen. */
    handleEvent(event: sf.Event): void {
        const count = MenuPlayer.__COUNT;
        const halfCount = count / 2;
        switch (this.currentState) {
            case SelectionState.NO_SELECTION: {
                let id = this.selectedPlayer.value;
                if (Input.pressed(Key.MENU_LEFT, event)) {
                    Audio.play(SFX.MENU_SELECTION_MOVE);
                    id = (id - 1) % count;
                } else if (Input.pressed(Key.MENU_RIGHT, event)) {
                    Audio.play(SFX.MENU_SELECTION_MOVE);
                    id = (id + 1) % count;
                } else if (Input.pressed(Key.MENU_UP, event)) {
                    Audio.play(SFX.MENU_SELECTION_MOVE);
                    id = (id - halfCount) % count;
                } else if (Input.pressed(Key.MENU_DOWN, event)) {
                    Audio.play(SFX.MENU_SELECTION_MOVE);
                    id = (id + halfCount) % count;
                } else if (Input.pressed(Key.ACCEPT, event)) {
                    Audio.play(SFX.MENU_SELECTION_ACCEPT);
                    this.currentState = SelectionState.AWAIT_CONFIRMATION;
                } else if (Input.pressed(Key.CANCEL, event)) {
                    Audio.play(SFX.MENU_SELECTION_CANCEL);
                    this.currentState = SelectionState.FADE_OUT_CANCEL;
                    this.fadeCurrentTime = sf.Time.Zero;
                }
                this.selectedPlayer.value = id < 0 ? id + count : id;
                break;
            }
            case SelectionState.AWAIT_CONFIRMATION:
                // The first accept rotates the portrait; the second commits and fades out.
                if (Input.pressed(Key.ACCEPT, event)) {
                    Audio.play(SFX.MENU_SELECTION_ACCEPT);
                    this.currentState = SelectionState.SELECTED;
                    this.fadeCurrentTime = sf.Time.Zero;
                } else if (Input.pressed(Key.CANCEL, event)) {
                    Audio.play(SFX.MENU_SELECTION_CANCEL);
                    this.currentState = SelectionState.NO_SELECTION;
                }
                break;
            default:
                break;
        }
    }

    /** Advance fixed-rate portrait rotation and entry/exit transitions. */
    fixedUpdate(deltaTime: sf.Time): boolean {
        this.framesSinceOrigin++;
        if (this.isFading()) {
            this.fadeCurrentTime = sf.add(this.fadeCurrentTime, deltaTime);
            const finished = this.fadeCurrentTime.asSeconds() >
                StatePlayerSelection.FADE_TOTAL_TIME.asSeconds();
            if (this.currentState === SelectionState.FADE_IN_INTRO && finished) {
                this.currentState = SelectionState.NO_SELECTION;
            } else if (finished && !this.hasPopped) {
                this.hasPopped = true;
                this.game.popState();
                if (this.currentState === SelectionState.FADE_OUT_CANCEL) {
                    // Also discard the manager and title so InitLoad can reopen the menu.
                    this.game.popState();
                    this.game.popState();
                }
            }
        }

        // Only the selected portrait turns forward; all others ease back toward their side view.
        for (let i = 0; i < MenuPlayer.__COUNT; i++) {
            if (this.isConfirming() && this.selectedPlayer.value === i) {
                this.angles[i] = Math.min(this.angles[i] + 2.5 * deltaTime.asSeconds(), Math.PI / 2);
            } else {
                this.angles[i] = Math.max(this.angles[i] - 4.5 * deltaTime.asSeconds(), 0);
            }
        }
        return true;
    }

    private isConfirming(): boolean {
        return this.currentState !== SelectionState.FADE_IN_INTRO &&
            this.currentState !== SelectionState.NO_SELECTION &&
            this.currentState !== SelectionState.FADE_OUT_CANCEL;
    }

    private isFading(): boolean {
        return this.currentState === SelectionState.FADE_IN_INTRO ||
            this.currentState === SelectionState.SELECTED ||
            this.currentState === SelectionState.FADE_OUT_CANCEL;
    }

    /** Draw the original layered grid, marquee, cursor, buttons, and fades. */
    draw(window: sf.RenderTarget): void {
        const assets = StatePlayerSelection;
        window.clear(sf.Color.Black);
        const size = window.getSize();
        const scale = size.x / assets.assetBackground.getSize().x;

        // Portraits are drawn beneath the frame so its transparent windows act as cutouts.
        for (let i = 0; i < MenuPlayer.__COUNT; i++) {
            const origin = assets.PLAYER_CELL_ORIGINS[i];
            const background = new sf.Sprite(assets.assetPlayerBackground);
            background.setScale(new sf.Vector2f(scale, scale));
            background.setPosition(new sf.Vector2f(origin.x * size.x, (origin.y + 14 / 224) * size.y));
            const player = this.animators[i].getMinimapSprite(this.angles[i], scale / 2);
            player.setPosition(new sf.Vector2f((origin.x + 19 / 256) * size.x, (origin.y + 49 / 224) * size.y));
            if (Math.trunc(this.framesSinceOrigin / 10) % 3 === (5 * i) % 3 &&
                i !== this.selectedPlayer.value) {
                player.move(new sf.Vector2f(0, -scale));
            }
            window.draw(background);
            window.draw(player);
        }

        // The same foreground frame clips the scrolling marquee to its display window.
        const marquee = new sf.Sprite(assets.assetMarquee);
        marquee.setScale(new sf.Vector2f(scale, scale));
        marquee.setPosition(new sf.Vector2f(80 / 256 * size.x, 24 / 224 * size.y));
        const pixelsRight = this.framesSinceOrigin % assets.assetMarquee.getSize().x;
        marquee.move(new sf.Vector2f((-pixelsRight + 80) * scale, 0));
        window.draw(marquee);
        const background = new sf.Sprite(assets.assetBackground);
        background.setScale(new sf.Vector2f(scale, scale));
        window.draw(background);

        // Cursor and confirmation buttons remain above the frame artwork.
        if ((this.currentState !== SelectionState.NO_SELECTION &&
            this.currentState !== SelectionState.FADE_OUT_CANCEL) ||
            this.framesSinceOrigin % 7 !== 0) {
            const origin = assets.PLAYER_CELL_ORIGINS[this.selectedPlayer.value];
            const tick = new sf.Sprite(assets.asset1P);
            tick.setScale(new sf.Vector2f(scale, scale));
            tick.setPosition(new sf.Vector2f((origin.x + 11 / 256) * size.x, origin.y * size.y));
            window.draw(tick);
        }
        if (this.isConfirming()) {
            const button = new sf.Sprite(this.currentState === SelectionState.AWAIT_CONFIRMATION
                ? assets.asset1POkQ : assets.asset1POk);
            button.setScale(new sf.Vector2f(scale, scale));
            button.setPosition(new sf.Vector2f(191 / 256 * size.x, 191 / 224 * size.y));
            window.draw(button);
        }

        if (this.isFading()) {
            let pct = this.fadeCurrentTime.asSeconds() / assets.FADE_TOTAL_TIME.asSeconds();
            if (this.currentState === SelectionState.FADE_IN_INTRO) {
                pct = 1 - pct;
            }
            const fade = new sf.RectangleShape(new sf.Vector2f(size));
            fade.setFillColor(new sf.Color(0, 0, 0, Math.trunc(Math.max(0, Math.min(pct * 255, 255)))));
            window.draw(fade);
        }
    }

    /** State stack diagnostic name. */
    string(): string {
        return "PlayerSelection";
    }
}
