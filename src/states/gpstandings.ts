import * as sf from "sfml.js";
import type { Game } from "../game";
import { Audio, SFX } from "../audio/audio";
import type { Driver } from "../entities/driver";
import { DRIVER_DISPLAY_NAMES, MenuPlayer } from "../entities/enums";
import { Color, TextUtils } from "../gui/textutils";
import { Input, Key } from "../input/input";
import { CIRCUIT_DISPLAY_NAMES, RaceCircuit } from "./racemanager";
import { State } from "./statebase";

enum AnimationState {
    FADE_IN,
    INITIAL_RESULTS,
    ANIMATING_DOWN,
    ANIMATING_UP,
    FINAL_RESULTS,
    FADE_OUT,
}

/** Grand Prix point allocation and the animated, shared cumulative scoreboard. */
export class StateGPStandings extends State {
    private static readonly assetBackground = new sf.Texture();
    private static readonly assetStandings = new sf.Texture();
    private static readonly TIME_PER_PLAYER = sf.seconds(0.1);
    private static readonly TIME_FADE = sf.seconds(1);
    private static readonly POINTS_PER_POSITION = [10, 8, 6, 4, 3, 2, 1, 0];

    private currentState = AnimationState.FADE_IN;
    private backgroundPosition = 0;
    private currentTime = sf.Time.Zero;
    private timeSinceStateChange = sf.Time.Zero;
    private framesSinceOrigin = 0;
    private playersShown = 8;

    /** Keep both arrays shared with the manager; score updates are in place. */
    constructor(
        game: Game,
        private readonly positions: Driver[],
        private readonly standings: [Driver, number][],
        private readonly circuit: RaceCircuit,
        private readonly player: MenuPlayer,
    ) {
        super(game);
        this.init();
    }

    /** Load the scrolling background and scoreboard frame. */
    static async loadAssets(
        assetName: string, roiBackground: sf.IntRect, roiStandings: sf.IntRect,
    ): Promise<void> {
        await this.assetBackground.loadFromFile(assetName, false, roiBackground);
        this.assetBackground.setRepeated(true);
        await this.assetStandings.loadFromFile(assetName, false, roiStandings);
    }

    /** Reset display animation without changing cumulative scores. */
    init(): void {
        this.currentTime = sf.Time.Zero;
        this.timeSinceStateChange = sf.Time.Zero;
        this.playersShown = 8;
        this.framesSinceOrigin = 0;
        this.backgroundPosition = 0;
        this.currentState = AnimationState.FADE_IN;
    }

    private setState(state: AnimationState): void {
        this.currentState = state;
        this.timeSinceStateChange = sf.Time.Zero;
    }

    private findIndexInRanking(driver: Driver): number {
        const index = this.positions.indexOf(driver);
        if (index < 0) {
            throw new Error("Unable to find player in race ranking array");
        }
        return index;
    }

    private addPointsToPlayers(): void {
        // Match by driver identity: cumulative standings and this race may have different orders.
        for (const standing of this.standings) {
            standing[1] += StateGPStandings.POINTS_PER_POSITION[this.findIndexInRanking(standing[0])];
        }
        this.standings.sort((left, right) => right[1] - left[1]);
    }

    /** Accept the same navigation/confirmation keys for both results screens. */
    handleEvent(event: sf.Event): void {
        if (this.timeSinceStateChange.asMicroseconds() === 0n) {
            return;
        }
        const advance = [Key.MENU_UP, Key.MENU_DOWN, Key.MENU_LEFT, Key.MENU_RIGHT, Key.ACCEPT, Key.CANCEL]
            .some(key => Input.pressed(key, event));
        if (!advance) {
            return;
        }

        if (this.currentState === AnimationState.INITIAL_RESULTS) {
            this.setState(AnimationState.ANIMATING_DOWN);
            Audio.play(SFX.MENU_SELECTION_ACCEPT);
        } else if (this.currentState === AnimationState.FINAL_RESULTS) {
            this.setState(AnimationState.FADE_OUT);
            Audio.play(SFX.MENU_SELECTION_ACCEPT);
        }
    }

    /** Hide rows, award points once, then reveal the newly ordered standings. */
    update(deltaTime: sf.Time): boolean {
        this.currentTime = sf.add(this.currentTime, deltaTime);
        this.backgroundPosition -= 30 * deltaTime.asSeconds();
        this.timeSinceStateChange = sf.add(this.timeSinceStateChange, deltaTime);
        this.framesSinceOrigin++;

        if (this.currentState === AnimationState.FADE_IN &&
            this.timeSinceStateChange.asSeconds() > StateGPStandings.TIME_FADE.asSeconds()) {
            this.setState(AnimationState.INITIAL_RESULTS);
        } else if (this.currentState === AnimationState.FADE_OUT &&
            this.timeSinceStateChange.asSeconds() > StateGPStandings.TIME_FADE.asSeconds()) {
            this.game.popState();
        }

        // Award points only when every row is hidden; the upward reveal shows the new order.
        if (this.currentState === AnimationState.ANIMATING_DOWN &&
            this.timeSinceStateChange.asSeconds() > StateGPStandings.TIME_PER_PLAYER.asSeconds()) {
            if (this.playersShown === 0) {
                this.setState(AnimationState.ANIMATING_UP);
                this.addPointsToPlayers();
            } else {
                this.playersShown--;
                Audio.play(SFX.MENU_SELECTION_MOVE);
                this.timeSinceStateChange = sf.Time.Zero;
            }
        } else if (this.currentState === AnimationState.ANIMATING_UP &&
            this.timeSinceStateChange.asSeconds() > StateGPStandings.TIME_PER_PLAYER.asSeconds()) {
            this.playersShown++;
            Audio.play(SFX.MENU_SELECTION_MOVE);
            this.timeSinceStateChange = sf.Time.Zero;
            if (this.playersShown === this.positions.length) {
                this.setState(AnimationState.FINAL_RESULTS);
            }
        }
        return true;
    }

    /** Draw per-race additions and cumulative scores with the player's blinking row. */
    draw(window: sf.RenderTarget): void {
        const size = window.getSize();
        const backgroundSize = StateGPStandings.assetBackground.getSize();
        const scale = size.y / backgroundSize.y;
        const background = new sf.Sprite(StateGPStandings.assetBackground);
        background.setTextureRect(new sf.IntRect(
            new sf.Vector2i(Math.trunc(this.backgroundPosition * scale), 0),
            new sf.Vector2i(backgroundSize),
        ));
        background.setScale(new sf.Vector2f(scale, scale));
        window.draw(background);

        const overlay = new sf.Sprite(StateGPStandings.assetStandings);
        const overlayScale = size.x / StateGPStandings.assetStandings.getSize().x;
        overlay.setScale(new sf.Vector2f(overlayScale, overlayScale));
        window.draw(overlay);
        TextUtils.write(window, `round ${this.circuit + 1}`,
            new sf.Vector2f(24 / 256 * size.x, 55 / 224 * size.y), scale);
        TextUtils.write(window, CIRCUIT_DISPLAY_NAMES[this.circuit],
            new sf.Vector2f(112 / 256 * size.x, 55 / 224 * size.y), scale);

        for (let i = 0; i < this.standings.length; i++) {
            if (this.standings.length - i > this.playersShown) {
                continue;
            }

            const [driver, score] = this.standings[i];
            const name = `${DRIVER_DISPLAY_NAMES[Number(driver.getPj())]} `.padEnd(15, ".");
            let points = String(score).padStart(2, "0");
            // Before the score update, show this race's pending addition in parentheses.
            if (this.currentState === AnimationState.FADE_IN ||
                this.currentState === AnimationState.INITIAL_RESULTS ||
                this.currentState === AnimationState.ANIMATING_DOWN) {
                points += ` (${StateGPStandings.POINTS_PER_POSITION[this.findIndexInRanking(driver)]})`;
            }

            const color = driver.getPj() === this.player &&
                Math.trunc(this.framesSinceOrigin / 30) % 2 === 0 ? sf.Color.Yellow : Color.Default;
            const y = (84 + i * 12) / 224 * size.y;
            TextUtils.write(window, String(i + 1), new sf.Vector2f(48 / 256 * size.x, y), scale, color);
            TextUtils.write(window, name, new sf.Vector2f(64 / 256 * size.x, y), scale, color);
            TextUtils.write(window, points, new sf.Vector2f(184 / 256 * size.x, y), scale, color);
        }

        let fadePct = 0;
        if (this.currentState === AnimationState.FADE_IN) {
            fadePct = 1 - this.timeSinceStateChange.asSeconds() / StateGPStandings.TIME_FADE.asSeconds();
        } else if (this.currentState === AnimationState.FADE_OUT) {
            fadePct = this.timeSinceStateChange.asSeconds() / StateGPStandings.TIME_FADE.asSeconds();
        }
        if (fadePct > 0) {
            const fade = new sf.RectangleShape(new sf.Vector2f(size));
            fade.setFillColor(new sf.Color(0, 0, 0, Math.trunc(Math.min(fadePct * 255, 255))));
            window.draw(fade);
        }
    }

    /** State stack diagnostic name. */
    string(): string {
        return "GPStandings";
    }
}
