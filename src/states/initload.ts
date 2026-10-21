import * as sf from "sfml.js";
import type { Game } from "../game";
import { Audio, SFX } from "../audio/audio";
import { Banana } from "../entities/banana";
import { EffectCoin } from "../entities/effectcoin";
import { EffectDrown } from "../entities/effectdrown";
import { EffectSparkles } from "../entities/effectsparkles";
import { FloatingFish } from "../entities/floatingfish";
import { GreenShell } from "../entities/greenshell";
import { Lakitu } from "../entities/lakitu";
import { Pipe } from "../entities/pipe";
import { Podium } from "../entities/podium";
import { RedShell } from "../entities/redshell";
import { Thwomp } from "../entities/thwomp";
import { WallObject } from "../entities/wallobject";
import { EndRanks } from "../gui/endranks";
import { Gui } from "../gui/gui";
import { TextUtils } from "../gui/textutils";
import { Coin } from "../map/coin";
import { OilSlick } from "../map/oilslick";
import { QuestionPanel } from "../map/questionpanel";
import { RampHorizontal } from "../map/ramphorizontal";
import { RampVertical } from "../map/rampvertical";
import { Zipper } from "../map/zipper";
import { StateCongratulations } from "./congratulations";
import { StateGPStandings } from "./gpstandings";
import { StatePlayerSelection } from "./playerselection";
import { StateStart } from "./start";
import { State } from "./statebase";

/** Nintendo splash and the shared game asset readiness barrier. */
export class StateInitLoad extends State {
    private static readonly DING_TIME = sf.seconds(0.75);
    private static readonly END_TIME = sf.seconds(2);
    private readonly nintendoLogoTexture = new sf.Texture();
    private currentTime = sf.Time.Zero;
    private audioDingId = SFX.MENU_INTRO_SCREEN_DING;
    private dingPlayed = false;

    /** Load assets asynchronously before the first splash update. */
    constructor(game: Game) {
        super(game);
        this.ready = this.init();
    }

    private async loadAllGameTextures(): Promise<void> {
        const rect = (x: number, y: number, width: number, height: number): sf.IntRect =>
            new sf.IntRect(new sf.Vector2i(x, y), new sf.Vector2i(width, height));

        await Zipper.loadAssets("assets/objects/floor/misc.png", rect(0, 0, 16, 16));
        await QuestionPanel.loadAssets("assets/objects/floor/question_panel.png",
            rect(0, 0, 16, 16), rect(0, 16, 16, 16));
        await OilSlick.loadAssets("assets/objects/floor/misc.png", rect(0, 16, 16, 16));
        await Coin.loadAssets("assets/objects/floor/misc.png", rect(0, 32, 8, 8));
        await RampHorizontal.loadAssets("assets/objects/floor/misc.png", rect(0, 40, 8, 8));
        await RampVertical.loadAssets("assets/objects/floor/misc.png", rect(32, 40, 8, 8));

        await WallObject.loadAssets("assets/misc/shadow.png");
        await Podium.loadAssets("assets/misc/congratulations.png", rect(417, 153, 104, 30));
        await FloatingFish.loadAssets("assets/misc/congratulations.png",
            rect(2, 51, 90, 95), rect(2, 148, 93, 95),
            rect(508, 51, 90, 95), rect(505, 148, 93, 95));
        await Pipe.loadAssets("assets/objects/wall/misc.png",
            rect(2, 53, 24, 32), rect(158, 53, 24, 32));
        await Thwomp.loadAssets("assets/objects/wall/misc.png",
            rect(2, 20, 24, 32), rect(158, 20, 24, 32));
        await Banana.loadAssets("assets/objects/wall/misc.png", rect(2, 129, 16, 16));
        await GreenShell.loadAssets("assets/objects/wall/misc.png", rect(83, 129, 16, 16));
        await RedShell.loadAssets("assets/objects/wall/misc.png", rect(172, 129, 16, 16));

        await EffectCoin.loadAssets("assets/misc/coin.png",
            rect(0, 0, 16, 16), rect(16, 0, 16, 16), rect(32, 0, 16, 16));
        await EffectDrown.loadAssets("assets/misc/particles.png",
            rect(96, 61, 8, 16), rect(105, 53, 24, 24), rect(130, 61, 8, 16),
            rect(79, 61, 16, 8), rect(79, 52, 16, 8));
        await EffectSparkles.loadAssets("assets/misc/particles.png",
            rect(1, 85, 24, 16), rect(26, 85, 24, 16),
            rect(51, 85, 24, 16), rect(76, 85, 24, 16));

        await Audio.loadAll();
        await Gui.loadAssets();
        await Lakitu.loadAssets();
        await EndRanks.loadAssets("assets/gui/ranking.png",
            rect(1, 1, 14, 16), rect(18, 1, 14, 16), rect(35, 1, 14, 16), 17,
            rect(52, 1, 8, 16), rect(52, 18, 8, 16), rect(52, 35, 8, 16), 9);
        await TextUtils.loadAssets("assets/gui/letters.png", "assets/gui/letters_alpha.png",
            new sf.Vector2i(1, 1), new sf.Vector2i(1, 32));

        await StateStart.loadBackgroundAssets("assets/menu/start/background.png",
            rect(246, 16, 512, 224), rect(6, 16, 234, 76));
        await StatePlayerSelection.loadAssets("assets/gui/player_selection.png",
            rect(0, 0, 256, 224), rect(281, 146, 38, 35), rect(272, 24, 256, 16),
            rect(352, 57, 16, 8), rect(376, 48, 34, 10), rect(376, 59, 34, 10));
        await StateGPStandings.loadAssets("assets/menu/start/background.png",
            rect(764, 16, 512, 256), rect(887, 301, 256, 224));
        await StateCongratulations.loadAssets("assets/misc/congratulations.png",
            rect(410, 2, 141, 14), 15, rect(553, 2, 10, 15), rect(564, 2, 12, 15),
            rect(577, 2, 12, 15), 16, rect(418, 192, 16, 16),
            rect(418, 209, 16, 16), rect(418, 227, 16, 16), 20, rect(65, 2, 62, 22));
    }

    /** Load the splash, ding, and every shared texture/audio resource. */
    async init(): Promise<void> {
        this.currentTime = sf.Time.Zero;
        await this.nintendoLogoTexture.loadFromFile("assets/gui/nintendo_logo.png");
        this.audioDingId = await Audio.loadDing();

        // Game awaits this entire load before starting the splash clock.
        await this.loadAllGameTextures();
    }

    /** Start the title screen after the two-second splash interval. */
    update(deltaTime: sf.Time): boolean {
        this.currentTime = sf.add(this.currentTime, deltaTime);

        if (!this.dingPlayed) {
            Audio.play(this.audioDingId);
            this.dingPlayed = true;
        } else if (this.currentTime.asSeconds() >= StateInitLoad.END_TIME.asSeconds()) {
            // Keep InitLoad at the bottom of the stack so later exits recreate the title.
            this.game.pushState(new StateStart(this.game));
        }
        return true;
    }

    /** Draw the width-scaled splash with its original 0.75-second fade delay. */
    draw(window: sf.RenderTarget): void {
        window.clear(sf.Color.Black);
        if (this.currentTime.asSeconds() < StateInitLoad.END_TIME.asSeconds()) {
            const logo = new sf.Sprite(this.nintendoLogoTexture);
            const scale = window.getSize().x / this.nintendoLogoTexture.getSize().x;
            logo.scale(new sf.Vector2f(scale, scale));
            if (this.currentTime.asSeconds() >= StateInitLoad.DING_TIME.asSeconds()) {
                const pct = (this.currentTime.asSeconds() - StateInitLoad.DING_TIME.asSeconds()) /
                    (StateInitLoad.END_TIME.asSeconds() - StateInitLoad.DING_TIME.asSeconds());
                logo.setColor(new sf.Color(255, 255, 255, Math.trunc(Math.max(255 * (1 - pct), 0))));
            }
            window.draw(logo);
        }
    }

    /** State stack diagnostic name. */
    string(): string {
        return "InitLoad";
    }
}
