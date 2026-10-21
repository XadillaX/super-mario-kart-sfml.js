import * as sf from "sfml.js";
import type { Game } from "../game";
import { Audio, SFX } from "../audio/audio";
import { TextUtils } from "../gui/textutils";
import { Input, Key } from "../input/input";
import { State } from "./statebase";

enum MenuState {
    YES,
    NO,
    FADE_OUT,
}

/** Frozen race view with resume and animated give-up confirmation. */
export class StateRacePause extends State {
    private static readonly FADE_TIME = sf.seconds(1.5);
    private readonly backgroundTexture: sf.Texture;
    private hasPopped = false;
    private once = true;
    private currentState = MenuState.NO;
    private fadeTime = sf.Time.Zero;

    /** Copy the rendered frame so it survives the caller's render target. */
    constructor(game: Game, backgroundRender: sf.RenderTexture) {
        super(game);
        this.backgroundTexture = new sf.Texture(backgroundRender.getTexture());
    }

    /** Handle confirmation and the two original vertical menu choices. */
    handleEvent(event: sf.Event): void {
        if (this.currentState === MenuState.FADE_OUT) {
            return;
        }

        if (Input.pressed(Key.ACCEPT, event) && !this.hasPopped) {
            if (this.currentState === MenuState.NO) {
                Audio.play(SFX.MENU_SELECTION_ACCEPT);
                this.hasPopped = true;
                Audio.resumeMusic();
                Audio.resumeSFX();
                Audio.resumeEngines();
                // Only the overlay is removed; the underlying race phase resumes intact.
                this.game.popState();
            } else if (this.currentState === MenuState.YES) {
                Audio.play(SFX.MENU_SELECTION_ACCEPT);
                this.currentState = MenuState.FADE_OUT;
                this.fadeTime = sf.Time.Zero;
            }
        }

        if (Input.pressed(Key.MENU_DOWN, event)) {
            Audio.play(SFX.MENU_SELECTION_MOVE);
            this.currentState = MenuState.NO;
        }
        if (Input.pressed(Key.MENU_UP, event)) {
            Audio.play(SFX.MENU_SELECTION_MOVE);
            this.currentState = MenuState.YES;
        }
    }

    /** Pause audio on entry and return to the loading state after give-up. */
    fixedUpdate(deltaTime: sf.Time): boolean {
        this.fadeTime = sf.add(this.fadeTime, deltaTime);
        if (this.currentState === MenuState.FADE_OUT &&
            this.fadeTime.asSeconds() > StateRacePause.FADE_TIME.asSeconds() &&
            !this.hasPopped) {
            this.hasPopped = true;
            Audio.stopEngines();
            Audio.stopMusic();
            Audio.stopSFX();
            // Discard the whole race stack only after black covers the captured frame.
            this.game.popStatesUntil(1);
        }

        // Pause on the first fixed tick, after the caller has finished capturing its frame.
        if (this.once) {
            this.once = false;
            Audio.pauseMusic();
            Audio.pauseSFX();
            Audio.pauseEngines();
            Audio.play(SFX.MENU_SELECTION_MOVE);
        }
        return true;
    }

    /** Render the captured frame, choices, and optional black fade. */
    draw(window: sf.RenderTarget): void {
        const size = window.getSize();
        const scale = size.x / 256;
        window.clear(sf.Color.Black);

        const background = new sf.Sprite(this.backgroundTexture);
        // SFML 3 display() and the texture copy already preserve the upright image.
        window.draw(background);

        const bigFontScale = scale * 1.5;
        TextUtils.write(window, "give up?", new sf.Vector2f(
            size.x / 2,
            size.y / 4 - TextUtils.CHAR_SIZE / 2 * bigFontScale -
                TextUtils.CHAR_SIZE * 2 * bigFontScale,
        ), bigFontScale, sf.Color.Black, true, TextUtils.TextAlign.CENTER);
        const yes = this.currentState === MenuState.YES ||
            this.currentState === MenuState.FADE_OUT ? "> yes  " : "  yes  ";
        TextUtils.write(window, yes, new sf.Vector2f(
            size.x / 2,
            size.y / 4 - TextUtils.CHAR_SIZE / 2 * scale -
                TextUtils.CHAR_SIZE * 0.75 * scale,
        ), scale, sf.Color.Black, true, TextUtils.TextAlign.CENTER);
        TextUtils.write(window, this.currentState === MenuState.NO ? "> no  " : "  no  ",
            new sf.Vector2f(
                size.x / 2,
                size.y / 4 - TextUtils.CHAR_SIZE / 2 * scale + TextUtils.CHAR_SIZE * scale,
            ), scale, sf.Color.Black, true, TextUtils.TextAlign.CENTER);

        if (this.currentState === MenuState.FADE_OUT) {
            const alpha = Math.min(
                this.fadeTime.asSeconds() / StateRacePause.FADE_TIME.asSeconds() * 255, 255,
            );
            const fade = new sf.RectangleShape(new sf.Vector2f(size));
            fade.setFillColor(new sf.Color(0, 0, 0, Math.trunc(alpha)));
            window.draw(fade);
        }
    }

    /** State stack diagnostic name. */
    string(): string {
        return "RacePause";
    }
}
