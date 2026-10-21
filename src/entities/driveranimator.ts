import * as sf from 'sfml.js';
import { Audio, SFX } from '../audio/audio';
import { LandMaterial } from '../map/enums';
import { Map } from '../map/map';
import { BASIC_WIDTH, DriverControlType } from './enums';

const COLOR_CHANGE_RATE = 6;

enum PlayerState {
    GO_RIGHT,
    GO_LEFT,
    GO_FORWARD,
    GO_BACK,
    FALLING,
    HIT,
}

/**
 * Convert the star animation's HSV colour to an opaque, byte-valued SFML colour.
 * Hue wraps in degrees; saturation and value are clamped to [0, 1].
 */
export function hsv(hue: number, sat: number, val: number): sf.Color {
    hue %= 360;
    while (hue < 0) {
        hue += 360;
    }
    sat = Math.max(0, Math.min(sat, 1));
    val = Math.max(0, Math.min(val, 1));

    // Interpolate within a 60-degree hue sector before converting channels to bytes.
    const h = Math.trunc(hue / 60);
    const f = hue / 60 - h;
    const p = val * (1 - sat);
    const q = val * (1 - sat * f);
    const t = val * (1 - sat * (1 - f));
    const color = (r: number, g: number, b: number): sf.Color =>
        new sf.Color(Math.trunc(r * 255), Math.trunc(g * 255), Math.trunc(b * 255));
    switch (h) {
        default:
        case 0:
        case 6:
            return color(val, t, p);
        case 1:
            return color(q, val, p);
        case 2:
            return color(p, val, t);
        case 3:
            return color(p, q, val);
        case 4:
            return color(t, p, val);
        case 5:
            return color(val, p, q);
    }
}

/** Driver sprite animation, status effects and ground particles. */
export class DriverAnimator {
    private readonly spriteMap = new sf.Image();
    private readonly control: DriverControlType | (() => DriverControlType);
    private state = PlayerState.GO_FORWARD;
    private starTime = sf.seconds(0);
    private starColor = 0;
    private sScale = 2;
    private fallScale = 1;
    private hitPos = 0;
    private static readonly NUM_HIT_TEXTURES = 32;
    private readonly hitTextuIdx = [
        0, 1, 2, 3, 4, 5, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11,
        11, 10, 10, 9, 9, 8, 8, 7, 7, 6, 5, 4, 3, 2, 1, 0,
    ];
    private driftIndex = 0;
    private grassIndex = 0;
    private updateColor = false;
    private colorFrec = 0;
    private lastColor = new sf.Color(255, 255, 255, 190);
    private static readonly MOVEMENT_DRIFT_AMPLITUDE = 2.5;
    private static readonly MOVEMENT_SPEED_AMPLITUDE = 0.4;
    private static readonly MOVEMENT_DRIFT_PERIOD = 20.0;
    private static readonly MOVEMENT_SPEED_PERIOD = 0.015;
    private spriteMovementDriftTime = 0;
    private spriteMovementSpeedTime = 0;

    /** Twelve 32-pixel kart views from the sprite sheet's second row, mirrored for full rotation. */
    readonly driving = Array.from({ length: 12 }, () => new sf.Texture());
    /** Five auxiliary character frames from the sprite sheet's first row. */
    readonly others = Array.from({ length: 5 }, () => new sf.Texture());
    /** Drift particle textures for dirt, stone and tintable terrain debris. */
    readonly driftTxtParticles = Array.from({ length: 3 }, () => new sf.Texture());
    /** Original four grass texture slots; only the first two are loaded and animated. */
    readonly grassTxtParticles = Array.from({ length: 4 }, () => new sf.Texture());
    /** Shared kart billboard, with its origin at the bottom centre after loading. */
    readonly sprite = new sf.Sprite(this.driving[0]);
    /** Five growing drift-particle templates copied into left/right wheel trails when drawn. */
    readonly driftParticles = Array.from(
        { length: 5 }, () => new sf.Sprite(this.driftTxtParticles[0]),
    );
    /** Grass-debris template copied to both wheels while driving straight on grass. */
    readonly grassParticle = new sf.Sprite(this.grassTxtParticles[0]);
    /** Remaining flattening-animation duration, decremented by update. */
    smashTime = sf.seconds(0);
    /** Remaining lightning-shrink animation duration, decremented by update. */
    smallTime = sf.seconds(0);
    /** Whether steering currently requests drift frames, particles and lateral movement. */
    drifting = false;
    /** Lateral drift wobble in reference-screen pixels, before render scaling. */
    spriteMovementDrift = 0;
    /** Vertical driving bob in reference-screen pixels, before render scaling. */
    spriteMovementSpeed = 0;
    /** Resolves after texture loading and sprite setup; rejects if an asset cannot load. */
    readonly ready: Promise<void>;

    /**
     * Begin loading a character sheet and the shared particle sheet; await ready before drawing.
     * A control getter preserves the original reference to a driver's changeable control mode.
     */
    constructor(
        spriteFile: string,
        control: DriverControlType | (() => DriverControlType) = DriverControlType.DISABLED,
    ) {
        this.control = control;
        this.ready = this.load(spriteFile);
    }

    private get controlType(): DriverControlType {
        return typeof this.control === 'function' ? this.control() : this.control;
    }

    private async load(spriteFile: string): Promise<void> {
        const loadTexture = async (
            texture: sf.Texture, file: string, x: number, y: number, width: number, height: number,
        ): Promise<void> => {
            const area = new sf.IntRect(new sf.Vector2i(x, y), new sf.Vector2i(width, height));
            if (!await texture.loadFromFile(file, false, area)) {
                throw new Error(`Failed to load driver texture: ${file}`);
            }
        };
        for (let i = 0; i < 12; i++) {
            await loadTexture(this.driving[i], spriteFile, 32 * i, 32, 32, 32);
        }
        for (let i = 0; i < 5; i++) {
            await loadTexture(this.others[i], spriteFile, 32 * i, 0, 32, 32);
        }

        const particleFile = 'assets/misc/particles.png';
        for (let i = 0; i < 3; i++) {
            await loadTexture(this.driftTxtParticles[i], particleFile, 1 + 26 * i, 1, 16, 16);
        }
        for (let i = 0; i < 2; i++) {
            await loadTexture(this.grassTxtParticles[i], particleFile, 1, 26 + 9 * i, 16, 8);
        }

        // Refresh texture rectangles before deriving origins from the now-loaded sprite bounds.
        this.sprite.setTexture(this.driving[0], true);
        for (const particle of this.driftParticles) {
            particle.setTexture(this.driftTxtParticles[0], true);
            particle.setColor(new sf.Color(255, 255, 255, 190));
            particle.setOrigin(new sf.Vector2f(0, particle.getLocalBounds().size.y * 1.3));
        }

        this.grassParticle.setTexture(this.grassTxtParticles[0], true);
        const grassBounds = this.grassParticle.getLocalBounds();
        this.grassParticle.setOrigin(new sf.Vector2f(grassBounds.size.x / 2, grassBounds.size.y / 2));
        this.grassParticle.scale(new sf.Vector2f(1.5, 1.5));

        const bounds = this.sprite.getLocalBounds();
        this.sprite.setOrigin(new sf.Vector2f(bounds.size.x / 2, bounds.size.y));
        this.sprite.setScale(new sf.Vector2f(this.sScale, this.sScale));
    }

    /** Select the straight-driving pose and stop drift animation. */
    goForward(): void {
        this.drifting = false;
        this.state = PlayerState.GO_FORWARD;
    }

    /** Select right-turn frames, optionally enabling drift particles and wobble. */
    goRight(drift = false): void {
        this.drifting = drift;
        this.state = PlayerState.GO_RIGHT;
    }

    /** Select mirrored left-turn frames, optionally enabling drift particles and wobble. */
    goLeft(drift = false): void {
        this.drifting = drift;
        this.state = PlayerState.GO_LEFT;
    }

    /** Enter the rotating spin-out animation and stop drifting. */
    hit(): void {
        this.drifting = false;
        this.state = PlayerState.HIT;
    }

    /** Enter the shrinking off-course fall animation and stop drifting. */
    fall(): void {
        this.drifting = false;
        this.state = PlayerState.FALLING;
    }

    /**
     * Advance poses, status timers and movement offsets using the original frame-stepped animation.
     * Speeds are map units/second and radians/second; height uses the driver's simulation units.
     */
    update(speedForward: number, speedTurn: number, height: number, deltaTime: sf.Time): void {
        switch (this.state) {
            case PlayerState.GO_FORWARD:
                this.sprite.setTexture(this.driving[0]);
                this.sprite.setScale(new sf.Vector2f(this.sScale, this.sScale));
                break;
            case PlayerState.GO_RIGHT:
                if (speedTurn < 1 / 4) {
                    this.sprite.setTexture(this.driving[1]);
                } else if (speedTurn < 1 / 2) {
                    this.sprite.setTexture(this.driving[2]);
                } else if (this.drifting) {
                    this.sprite.setTexture(this.driving[4]);
                } else {
                    this.sprite.setTexture(this.driving[3]);
                }
                this.sprite.setScale(new sf.Vector2f(this.sScale, this.sScale));
                break;
            case PlayerState.GO_LEFT:
                if (speedTurn > -1 / 4) {
                    this.sprite.setTexture(this.driving[1]);
                } else if (speedTurn > -1 / 2) {
                    this.sprite.setTexture(this.driving[2]);
                } else if (this.drifting) {
                    this.sprite.setTexture(this.driving[4]);
                } else {
                    this.sprite.setTexture(this.driving[3]);
                }
                this.sprite.setScale(new sf.Vector2f(-this.sScale, this.sScale));
                break;
            case PlayerState.GO_BACK:
                break;
            case PlayerState.FALLING:
                this.fallScale *= 0.9;
                this.sprite.setScale(new sf.Vector2f(
                    this.sScale * this.fallScale, this.sScale * this.fallScale,
                ));
                break;
            case PlayerState.HIT:
                // The lookup sweeps the available views; mirroring completes the second half-turn.
                this.hitPos = (this.hitPos + 2) % DriverAnimator.NUM_HIT_TEXTURES;
                this.sprite.setTexture(this.driving[this.hitTextuIdx[this.hitPos]]);
                this.sprite.setScale(new sf.Vector2f(
                    this.hitPos > DriverAnimator.NUM_HIT_TEXTURES / 2 ? -this.sScale : this.sScale,
                    this.sScale,
                ));
                break;
            default:
                this.sprite.setTexture(this.driving[0]);
                this.sprite.setScale(new sf.Vector2f(this.sScale, this.sScale));
                break;
        }

        // Cycle one particle template per update so the trail retains staggered sizes.
        if (this.drifting) {
            this.driftIndex = (this.driftIndex + 1) % 5;
            const particle = this.driftParticles[this.driftIndex];
            if (particle.getScale().x > 2) {
                particle.setScale(new sf.Vector2f(0.1, 0.1));
            } else {
                particle.scale(new sf.Vector2f(1.3, 1.3));
            }
        } else {
            this.driftIndex = 0;
        }

        // Apply status scales after the pose scale; shrink and flattening can compose.
        if (this.smallTime.asSeconds() > 0) {
            this.smallTime = sf.subtract(this.smallTime, deltaTime);
            this.sprite.scale(new sf.Vector2f(0.5, 0.5));
            if (this.controlType === DriverControlType.PLAYER && this.smallTime.asSeconds() <= 0) {
                Audio.play(SFX.CIRCUIT_PLAYER_GROW);
            }
        }
        if (this.smashTime.asSeconds() > 0) {
            this.smashTime = sf.subtract(this.smashTime, deltaTime);
            this.sprite.scale(new sf.Vector2f(1, 0.5));
        }

        if (this.starTime.asSeconds() > 0) {
            this.starTime = sf.subtract(this.starTime, deltaTime);
            this.sprite.setColor(hsv(this.starColor, 1, 1));
            this.starColor += 7;
            if (this.controlType === DriverControlType.PLAYER && this.starTime.asSeconds() <= 0) {
                Audio.stop(SFX.CIRCUIT_ITEM_STAR);
            }
        } else {
            this.sprite.setColor(sf.Color.White);
            this.starColor = 0;
        }

        // Drift phase is frame-stepped, while the vertical bob phase tracks distance travelled.
        if (height === 0 && this.drifting) {
            this.spriteMovementDriftTime =
                (this.spriteMovementDriftTime + 1) % DriverAnimator.MOVEMENT_DRIFT_PERIOD;
        } else {
            this.spriteMovementDriftTime /= 1.5;
        }
        if (height === 0 && speedForward > 0) {
            this.spriteMovementSpeedTime =
                (this.spriteMovementSpeedTime + speedForward * deltaTime.asSeconds()) %
                DriverAnimator.MOVEMENT_SPEED_PERIOD;
        } else {
            this.spriteMovementSpeedTime /= 1.5;
        }

        this.spriteMovementDrift = Math.sin(
            this.spriteMovementDriftTime * 2 * Math.PI / DriverAnimator.MOVEMENT_DRIFT_PERIOD,
        ) * DriverAnimator.MOVEMENT_DRIFT_AMPLITUDE;
        this.spriteMovementSpeed = Math.sin(
            this.spriteMovementSpeedTime * 2 * Math.PI / DriverAnimator.MOVEMENT_SPEED_PERIOD,
        ) * DriverAnimator.MOVEMENT_SPEED_AMPLITUDE;
    }

    /** Test only whether the animator is outside HIT; this is not the driver's physics-state check. */
    canDrive(): boolean {
        return this.state !== PlayerState.HIT;
    }

    /** Replace the visual shrink timer with a value copy; does not change driving physics. */
    small(duration: sf.Time): void {
        this.smallTime = new sf.Time(duration);
    }

    /** Replace the visual flattening timer with a value copy of duration. */
    smash(duration: sf.Time): void {
        this.smashTime = new sf.Time(duration);
    }

    /** Replace the rainbow-colour timer; collision immunity is managed by Driver. */
    star(duration: sf.Time): void {
        this.starTime = new sf.Time(duration);
    }

    /** Return a separate sprite for the kart's map heading in radians, scaled for the minimap. */
    getMinimapSprite(angle: number, screenScale: number): sf.Sprite {
        const minimapSprite = new sf.Sprite(this.sprite);
        minimapSprite.setScale(new sf.Vector2f(this.sScale * screenScale, this.sScale * screenScale));

        // The sheet's zero view faces up, so map headings need a quarter-turn offset.
        angle = (angle + Math.PI / 2) % (2 * Math.PI);
        if (angle < 0) {
            angle += 2 * Math.PI;
        }
        if (this.state !== PlayerState.HIT) {
            for (let i = 1; i <= DriverAnimator.NUM_HIT_TEXTURES + 1; i++) {
                if (angle <= (i - 0.5) * 2 * Math.PI / DriverAnimator.NUM_HIT_TEXTURES) {
                    // The C++ loop reaches 32 at the wraparound seam; that is texture zero.
                    minimapSprite.setTexture(
                        this.driving[this.hitTextuIdx[(i - 1) % DriverAnimator.NUM_HIT_TEXTURES]],
                    );
                    if (angle > Math.PI) {
                        minimapSprite.scale(new sf.Vector2f(-1, 1));
                    }
                    break;
                }
            }
        } else if (this.hitPos > DriverAnimator.NUM_HIT_TEXTURES / 2) {
            minimapSprite.scale(new sf.Vector2f(-1, 1));
        }

        if (this.smallTime.asSeconds() > 0) {
            minimapSprite.scale(new sf.Vector2f(0.5, 0.5));
        }
        if (this.smashTime.asSeconds() > 0) {
            minimapSprite.scale(new sf.Vector2f(1, 0.5));
        }
        return minimapSprite;
    }

    /** Orient the shared billboard to the camera-relative angle in radians, retaining status effects. */
    setViewSprite(angle: number): void {
        angle %= 2 * Math.PI;
        if (angle < 0) {
            angle += 2 * Math.PI;
        }

        this.sprite.setScale(new sf.Vector2f(Map.CIRCUIT_HEIGHT_PCT, Map.CIRCUIT_HEIGHT_PCT));
        if (this.state !== PlayerState.HIT) {
            for (let i = 1; i <= DriverAnimator.NUM_HIT_TEXTURES + 1; i++) {
                if (angle <= (i - 0.5) * 2 * Math.PI / DriverAnimator.NUM_HIT_TEXTURES) {
                    this.sprite.setTexture(
                        this.driving[this.hitTextuIdx[(i - 1) % DriverAnimator.NUM_HIT_TEXTURES]],
                    );
                    if (angle < Math.PI) {
                        this.sprite.scale(new sf.Vector2f(-1, 1));
                    }
                    break;
                }
            }
        } else if (this.hitPos > DriverAnimator.NUM_HIT_TEXTURES / 2) {
            this.sprite.scale(new sf.Vector2f(-1, 1));
        }

        if (this.smallTime.asSeconds() > 0) {
            this.sprite.scale(new sf.Vector2f(0.5, 0.5));
        }
        if (this.smashTime.asSeconds() > 0) {
            this.sprite.scale(new sf.Vector2f(1, 0.5));
        }
    }

    /**
     * Draw terrain-specific wheel particles around the supplied screen-space driver sprite.
     * mapPos is normalized for material/colour sampling; small halves the particle scale.
     */
    drawParticles(window: sf.RenderTarget, driver: sf.Sprite, small: boolean, mapPos: sf.Vector2f): void {
        const driverPos = driver.getPosition();
        const middlePosition = new sf.Vector2f(driverPos.x, driverPos.y);
        const driverSize = driver.getGlobalBounds();
        const groundType = Map.getMaterial(mapPos);
        const factor = window.getSize().x / BASIC_WIDTH;

        if (groundType === LandMaterial.GRASS && this.state === PlayerState.GO_FORWARD) {
            this.grassParticle.setTexture(this.grassTxtParticles[this.grassIndex > 5 ? 1 : 0]);
            this.grassIndex = (this.grassIndex + 1) % 10;
            const gpr = new sf.Sprite(this.grassParticle);
            if (small) {
                gpr.scale(new sf.Vector2f(0.5, 0.5));
            }
            gpr.scale(new sf.Vector2f(factor, factor));
            const gpl = new sf.Sprite(gpr);
            const posOffset = 0;
            gpr.setPosition(new sf.Vector2f(
                middlePosition.x + driverSize.size.x * 0.3 + posOffset,
                middlePosition.y - driverSize.size.y * 0.1,
            ));
            gpl.setPosition(new sf.Vector2f(
                middlePosition.x - driverSize.size.x * 0.3 + posOffset,
                middlePosition.y - driverSize.size.y * 0.1,
            ));
            window.draw(gpr);
            window.draw(gpl);
        }

        if (this.drifting) {
            // Reuse sampled terrain colour between refreshes instead of sampling for every particle.
            if (this.colorFrec > COLOR_CHANGE_RATE) {
                this.updateColor = true;
                this.colorFrec = 0;
            } else {
                this.colorFrec++;
            }

            let type = 0;
            let color = new sf.Color(this.lastColor);
            let scale = 1;
            switch (groundType) {
                case LandMaterial.DIRT:
                    type = 0;
                    break;
                case LandMaterial.STONE:
                    type = 1;
                    break;
                case LandMaterial.SPOOKY_WOOD:
                    type = 2;
                    color = new sf.Color(89, 54, 39, 190);
                    scale = 0.7;
                    break;
                case LandMaterial.RAINBOW:
                    type = 2;
                    if (this.updateColor) {
                        color = Map.sampleMapColor(mapPos);
                        this.updateColor = false;
                    }
                    scale = 0.7;
                    break;
                case LandMaterial.GRASS:
                    type = 2;
                    color = new sf.Color(69, 217, 24, 190);
                    scale = 0.7;
                    break;
                default:
                    type = 0;
                    break;
            }
            this.lastColor = new sf.Color(color);

            // Copy templates before applying screen scaling and wheel offsets; keep growth state intact.
            for (const particle of this.driftParticles) {
                const pr = new sf.Sprite(particle);
                pr.setTexture(this.driftTxtParticles[type]);
                if (type === 2) {
                    pr.setColor(color);
                }
                pr.scale(new sf.Vector2f(scale, scale));
                if (small) {
                    pr.scale(new sf.Vector2f(0.5, 0.5));
                }
                pr.scale(new sf.Vector2f(factor, factor));

                let posOffset = 0;
                if (this.state === PlayerState.GO_RIGHT) {
                    pr.scale(new sf.Vector2f(-1, 1));
                    posOffset = -driverSize.size.x * 0.25;
                } else if (this.state === PlayerState.GO_LEFT) {
                    posOffset = driverSize.size.x * 0.25;
                }

                const pl = new sf.Sprite(pr);
                pr.setPosition(new sf.Vector2f(
                    middlePosition.x + driverSize.size.x * 0.2 + posOffset, middlePosition.y,
                ));
                pl.setPosition(new sf.Vector2f(
                    middlePosition.x - driverSize.size.x * 0.2 + posOffset, middlePosition.y,
                ));
                window.draw(pr);
                window.draw(pl);
            }
        }
    }

    /** Clear status timers, spin/fall progress and drifting, restoring the normal forward sprite. */
    reset(): void {
        this.sprite.setTexture(this.driving[0]);
        this.smashTime = sf.seconds(0);
        this.starTime = sf.seconds(0);
        this.smallTime = sf.seconds(0);
        this.starColor = 0;
        this.sScale = 2;
        this.fallScale = 1;
        this.hitPos = 0;
        this.driftIndex = 0;
        this.drifting = false;
        this.state = PlayerState.GO_FORWARD;
        this.sprite.setScale(new sf.Vector2f(this.sScale, this.sScale));
        this.sprite.setColor(sf.Color.White);
    }
}
