import * as sf from "sfml.js";
import type { Driver } from "../entities/driver";
import { PowerUps } from "../entities/enums";
import {
    FloorObjectOrientation, FloorObjectState, MapLand,
    MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT,
} from "./enums";
import { FloorObject } from "./floorobject";

/** Item panel with the original sixteen-entry rank-dependent item buckets. */
export class QuestionPanel extends FloorObject {
    // Uniformly sampling sixteen slots gives repeated items their intended probability.
    // Table suffixes are displayed places; Driver.rank is zero-based.
    private static readonly NUM_ITEMS_ARRAY = 16;
    private static readonly ITEMS_1 = [
        PowerUps.BANANA, PowerUps.BANANA, PowerUps.BANANA, PowerUps.BANANA,
        PowerUps.BANANA, PowerUps.BANANA, PowerUps.COIN, PowerUps.COIN,
        PowerUps.COIN, PowerUps.COIN, PowerUps.COIN, PowerUps.COIN,
        PowerUps.GREEN_SHELL, PowerUps.GREEN_SHELL, PowerUps.RED_SHELL, PowerUps.MUSHROOM,
    ];
    private static readonly ITEMS_23 = [
        PowerUps.BANANA, PowerUps.RED_SHELL, PowerUps.RED_SHELL, PowerUps.RED_SHELL,
        PowerUps.GREEN_SHELL, PowerUps.RED_SHELL, PowerUps.BANANA, PowerUps.BANANA,
        PowerUps.BANANA, PowerUps.MUSHROOM, PowerUps.MUSHROOM, PowerUps.GREEN_SHELL,
        PowerUps.COIN, PowerUps.COIN, PowerUps.COIN, PowerUps.GREEN_SHELL,
    ];
    private static readonly ITEMS_45 = [
        PowerUps.RED_SHELL, PowerUps.RED_SHELL, PowerUps.RED_SHELL, PowerUps.STAR,
        PowerUps.GREEN_SHELL, PowerUps.COIN, PowerUps.BANANA, PowerUps.BANANA,
        PowerUps.BANANA, PowerUps.MUSHROOM, PowerUps.MUSHROOM, PowerUps.MUSHROOM,
        PowerUps.COIN, PowerUps.GREEN_SHELL, PowerUps.GREEN_SHELL, PowerUps.COIN,
    ];
    private static readonly ITEMS_67 = [
        PowerUps.MUSHROOM, PowerUps.MUSHROOM, PowerUps.MUSHROOM, PowerUps.MUSHROOM,
        PowerUps.COIN, PowerUps.BANANA, PowerUps.RED_SHELL, PowerUps.RED_SHELL,
        PowerUps.RED_SHELL, PowerUps.STAR, PowerUps.GREEN_SHELL, PowerUps.STAR,
        PowerUps.THUNDER, PowerUps.GREEN_SHELL, PowerUps.BANANA, PowerUps.COIN,
    ];
    private static readonly ITEMS_8 = [
        PowerUps.MUSHROOM, PowerUps.MUSHROOM, PowerUps.MUSHROOM, PowerUps.MUSHROOM,
        PowerUps.MUSHROOM, PowerUps.RED_SHELL, PowerUps.RED_SHELL, PowerUps.RED_SHELL,
        PowerUps.RED_SHELL, PowerUps.STAR, PowerUps.STAR, PowerUps.STAR,
        PowerUps.THUNDER, PowerUps.THUNDER, PowerUps.GREEN_SHELL, PowerUps.COIN,
    ];

    private static assetsActive: sf.Image[] = [];
    private static assetsInactive: sf.Image[] = [];

    protected getInitialState(): FloorObjectState {
        return FloorObjectState.ACTIVE;
    }

    /** Loads each orientation's active and inactive image from the same sheet. */
    static async loadAssets(
        assetName: string,
        activeRect: sf.IntRect,
        inactiveRect: sf.IntRect,
    ): Promise<void> {
        const rawImage = new sf.Image();
        if (!await rawImage.loadFromFile(assetName)) {
            throw new Error(`Unable to load question-panel image '${assetName}'`);
        }

        const active = new sf.IntRect(activeRect);
        const inactive = new sf.IntRect(inactiveRect);
        QuestionPanel.assetsActive = [];
        QuestionPanel.assetsInactive = [];
        for (let i = 0; i < FloorObjectOrientation.__COUNT; i++) {
            const activeImage = new sf.Image(new sf.Vector2u(active.size));
            const inactiveImage = new sf.Image(new sf.Vector2u(inactive.size));
            activeImage.copy(rawImage, new sf.Vector2u(0, 0), active);
            inactiveImage.copy(rawImage, new sf.Vector2u(0, 0), inactive);
            QuestionPanel.assetsActive.push(activeImage);
            QuestionPanel.assetsInactive.push(inactiveImage);
            active.position.x += active.size.x;
            inactive.position.x += inactive.size.x;
        }
    }

    /** Places an item panel using raw map pixels. */
    constructor(topLeftPixels: sf.Vector2f, orientation: FloorObjectOrientation) {
        super(
            topLeftPixels, new sf.Vector2f(QuestionPanel.assetsActive[orientation].getSize()),
            MAP_ASSETS_WIDTH, MAP_ASSETS_HEIGHT, orientation,
        );
    }

    /** Updates the composited course and terrain grid. */
    applyChanges(): void {
        FloorObject.defaultApplyChanges(this);
    }

    /** Awards an item only to an empty-handed driver touching an active panel. */
    interactWith(driver: Driver): void {
        if (this.getState() !== FloorObjectState.ACTIVE || driver.getPowerUp() !== PowerUps.NONE) {
            return;
        }

        this.setState(FloorObjectState.INACTIVE);
        const id = Math.floor(Math.random() * QuestionPanel.NUM_ITEMS_ARRAY);
        let items: readonly PowerUps[];
        switch (driver.rank) {
            case 0:
                items = QuestionPanel.ITEMS_1;
                break;
            case 1:
            case 2:
                items = QuestionPanel.ITEMS_23;
                break;
            case 3:
            case 4:
                items = QuestionPanel.ITEMS_45;
                break;
            case 6:
            case 5:
                items = QuestionPanel.ITEMS_67;
                break;
            default:
                items = QuestionPanel.ITEMS_8;
                break;
        }

        driver.pickUpPowerUp(items[id]);
    }

    /** Returns the frame for the current orientation and activation state. */
    getCurrentImage(): sf.Image {
        return this.getState() === FloorObjectState.ACTIVE
            ? QuestionPanel.assetsActive[this.orientation]
            : QuestionPanel.assetsInactive[this.orientation];
    }

    /** Used panels become ordinary track until reactivated. */
    getCurrentLand(): MapLand {
        return this.getState() === FloorObjectState.ACTIVE ? MapLand.OTHER : MapLand.TRACK;
    }
}
