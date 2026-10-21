import * as sf from "sfml.js";
import { MenuPlayer } from "../entities/enums";
import { MAP_TILES_WIDTH } from "../map/enums";

/** Original music indices; deliberately independent of the overlapping SFX indices. */
export enum Music {
    MENU_TITLE_SCREEN,
    MENU_PLAYER_CIRCUIT,
    CIRCUIT_ANIMATION_START,
    CIRCUIT_NORMAL,
    CIRCUIT_LAST_LAP,
    CONGRATULATIONS_SCREEN,
    CIRCUIT_PLAYER_WIN,
    CIRCUIT_PLAYER_LOSE,
    __COUNT,
}

/** Original effect indices, including entries not assigned a file by the C++ loader. */
export enum SFX {
    MENU_INTRO_SCREEN_DING,
    MENU_SELECTION_ACCEPT,
    MENU_SELECTION_CANCEL,
    MENU_SELECTION_MOVE,
    CIRCUIT_LAKITU_SEMAPHORE,
    CIRCUIT_LAKITU_WARNING,
    CIRCUIT_COLLISION,
    CIRCUIT_COLLISION_PIPE,
    CIRCUIT_PASS_MOTOR,
    CIRCUIT_OVERTAKE_UP,
    CIRCUIT_OVERTAKE_DOWN,
    CIRCUIT_LAST_LAP_NOTICE,
    CIRCUIT_GOAL_END,
    CIRCUIT_END_VICTORY,
    CIRCUIT_END_DEFEAT,
    CIRCUIT_PLAYER_MOTOR,
    CIRCUIT_PLAYER_MOTOR_SPOOK,
    CIRCUIT_PLAYER_BRAKE,
    CIRCUIT_PLAYER_DRIFT,
    CIRCUIT_PLAYER_DRIFT_SPOOK,
    CIRCUIT_MATERIAL_GRASS,
    CIRCUIT_MATERIAL_WOOD,
    CIRCUIT_MATERIAL_SPOOK,
    CIRCUIT_PLAYER_JUMP,
    CIRCUIT_PLAYER_LANDING,
    CIRCUIT_PLAYER_FALL,
    CIRCUIT_PLAYER_FALL_WATER,
    CIRCUIT_PLAYER_FALL_LAVA,
    CIRCUIT_PLAYER_HIT,
    CIRCUIT_PLAYER_SMASH,
    CIRCUIT_PLAYER_GROW,
    CIRCUIT_PLAYER_SHRINK,
    CIRCUIT_COIN,
    CIRCUIT_ITEM_RANDOMIZING,
    CIRCUIT_ITEM_GET,
    CIRCUIT_ITEM_USE_LAUNCH,
    CIRCUIT_ITEM_USE_UP,
    CIRCUIT_ITEM_USE_DOWN,
    CIRCUIT_ITEM_COIN,
    CIRCUIT_ITEM_STAR,
    CIRCUIT_ITEM_MUSHROOM,
    CIRCUIT_ITEM_THUNDER,
    CIRCUIT_ITEM_RED_SHELL,
    RESULTS_POINTS_UPDATE,
    __COUNT,
}

/**
 * Music, pooled effects and eight spatial engine streams.
 * StateInitLoad must await loadDing/loadAll; course changes await loadCircuit.
 * Playback remains synchronous once those loading barriers have completed.
 */
export class Audio {
    private static readonly VOLUME_MULTIPLIER = 0.8;
    private static readonly VOLUME_LOG_EXP = 1;
    private static readonly MAX_SOUNDS = 32;
    private static singleton: Audio | undefined;

    private readonly musicList = Array.from({ length: Music.__COUNT }, () => new sf.Music());
    private readonly sfxList = Array.from({ length: SFX.__COUNT }, () => new sf.SoundBuffer());
    // C++ aggregate {-1} initializes its first element to -1 and the rest to zero.
    private readonly sfxLastIndex: number[] = Array.from(
        { length: SFX.__COUNT }, (_, i) => i === 0 ? -1 : 0,
    );

    // Streams own their decoders; pooled sounds below share the singleton's effect buffers.
    private readonly sfxEngines = Array.from({ length: MenuPlayer.__COUNT }, () => new sf.Music());
    private readonly playingSounds = Array.from(
        { length: Audio.MAX_SOUNDS }, () => new sf.Sound(this.sfxList[0]),
    );

    private playerIndex = 0;
    private raceMode = false;
    private enginesPlaying = false;
    private currentSoundIndex = 0;

    private musicVolumePct = Audio.logFunc(0.5) * 100;
    private sfxVolumePct = Audio.logFunc(0.5) * 100;
    private getMusicValue = 0.5;
    private getSFXValue = 0.5;

    private assetsReady: Promise<void> | undefined;
    private enginesLoaded = false;

    private constructor() {}

    private static get instance(): Audio {
        return this.singleton ??= new Audio();
    }

    /** Load the introduction sound before the remaining assets. */
    static async loadDing(): Promise<SFX> {
        await this.instance.loadSFX(SFX.MENU_INTRO_SCREEN_DING, "assets/sfx/nintendologo.ogg");
        return SFX.MENU_INTRO_SCREEN_DING;
    }

    /** Load the original global asset list and preload engines for synchronous playback. */
    static loadAll(): Promise<void> {
        const instance = this.instance;
        return instance.assetsReady ??= instance.initAssets();
    }

    private async initAssets(): Promise<void> {
        const musicFiles: readonly (readonly [Music, string])[] = [
            [Music.MENU_TITLE_SCREEN, "assets/music/menu_title_screen.ogg"],
            [Music.MENU_PLAYER_CIRCUIT, "assets/music/menu_player_circuit.ogg"],
            [Music.CIRCUIT_ANIMATION_START, "assets/music/circuit_opening.ogg"],
            [Music.CIRCUIT_PLAYER_WIN, "assets/music/tournament_win.ogg"],
            [Music.CIRCUIT_PLAYER_LOSE, "assets/music/tournament_lose.ogg"],
        ];
        const soundFiles: readonly (readonly [SFX, string])[] = [
            [SFX.MENU_SELECTION_ACCEPT, "assets/sfx/menuselect.ogg"],
            [SFX.MENU_SELECTION_CANCEL, "assets/sfx/menuback.ogg"],
            [SFX.MENU_SELECTION_MOVE, "assets/sfx/menumove.ogg"],
            [SFX.CIRCUIT_LAKITU_SEMAPHORE, "assets/sfx/racestart.ogg"],
            [SFX.CIRCUIT_LAKITU_WARNING, "assets/sfx/lakituwarning.ogg"],
            [SFX.CIRCUIT_COLLISION, "assets/sfx/thud.ogg"],
            [SFX.CIRCUIT_COLLISION_PIPE, "assets/sfx/thudpipe.ogg"],
            [SFX.CIRCUIT_LAST_LAP_NOTICE, "assets/sfx/finallap.ogg"],
            [SFX.CIRCUIT_GOAL_END, "assets/sfx/goal.ogg"],
            [SFX.CIRCUIT_END_VICTORY, "assets/sfx/win.ogg"],
            [SFX.CIRCUIT_END_DEFEAT, "assets/sfx/lose.ogg"],
            [SFX.CIRCUIT_PLAYER_MOTOR, "assets/sfx/engine.ogg"],
            [SFX.CIRCUIT_PLAYER_BRAKE, "assets/sfx/brake.ogg"],
            [SFX.CIRCUIT_PLAYER_DRIFT, "assets/sfx/skid.ogg"],
            [SFX.CIRCUIT_PLAYER_JUMP, "assets/sfx/jump.ogg"],
            [SFX.CIRCUIT_PLAYER_LANDING, "assets/sfx/landing.ogg"],
            [SFX.CIRCUIT_PLAYER_FALL, "assets/sfx/fall.ogg"],
            [SFX.CIRCUIT_PLAYER_FALL_WATER, "assets/sfx/water.ogg"],
            [SFX.CIRCUIT_PLAYER_FALL_LAVA, "assets/sfx/lava.ogg"],
            [SFX.CIRCUIT_PLAYER_HIT, "assets/sfx/spinout.ogg"],
            [SFX.CIRCUIT_PLAYER_SMASH, "assets/sfx/hit.ogg"],
            [SFX.CIRCUIT_PLAYER_GROW, "assets/sfx/grow.ogg"],
            [SFX.CIRCUIT_PLAYER_SHRINK, "assets/sfx/shrink.ogg"],
            [SFX.CIRCUIT_COIN, "assets/sfx/coin.ogg"],
            [SFX.CIRCUIT_ITEM_RANDOMIZING, "assets/sfx/itemreel.ogg"],
            [SFX.CIRCUIT_ITEM_GET, "assets/sfx/item.ogg"],
            [SFX.CIRCUIT_ITEM_USE_LAUNCH, "assets/sfx/throw.ogg"],
            [SFX.CIRCUIT_ITEM_USE_UP, "assets/sfx/itemdestroy.ogg"],
            [SFX.CIRCUIT_ITEM_USE_DOWN, "assets/sfx/itemdestroy.ogg"],
            [SFX.CIRCUIT_ITEM_STAR, "assets/sfx/star.ogg"],
            [SFX.CIRCUIT_ITEM_MUSHROOM, "assets/sfx/boost.ogg"],
            [SFX.CIRCUIT_ITEM_THUNDER, "assets/sfx/lightning.ogg"],
            [SFX.CIRCUIT_ITEM_RED_SHELL, "assets/sfx/redshell.ogg"],
        ];

        for (const [music, filename] of musicFiles) {
            await this.loadMusic(music, filename);
        }
        for (const [sfx, filename] of soundFiles) {
            await this.loadSFX(sfx, filename);
        }

        // Pre-open every engine stream so race-time play calls never need to await I/O.
        for (const engine of this.sfxEngines) {
            if (!await engine.openFromFile("assets/sfx/engine.ogg")) {
                throw new Error("Unable to load engine audio: assets/sfx/engine.ogg");
            }
        }
        this.enginesLoaded = true;
    }

    /** Replace both course-specific music streams, without starting playback. */
    static async loadCircuit(folder: string): Promise<void> {
        await this.instance.loadMusic(Music.CIRCUIT_NORMAL, `${folder}/music.ogg`);
        await this.instance.loadMusic(Music.CIRCUIT_LAST_LAP, `${folder}/final_lap.ogg`);
    }

    private async loadMusic(music: Music, filename: string): Promise<void> {
        if (!await this.musicList[music].openFromFile(filename)) {
            throw new Error(`Unable to load music: ${filename}`);
        }
    }

    private async loadSFX(sfx: SFX, filename: string): Promise<void> {
        if (!await this.sfxList[sfx].loadFromFile(filename)) {
            throw new Error(`Unable to load sound effect: ${filename}`);
        }
    }

    /** Stop other music and play this track; music loops by default. */
    static playMusic(music: Music, loop = true): void {
        const instance = this.instance;
        for (const track of instance.musicList) {
            track.stop();
        }

        const track = instance.musicList[music];
        track.play();
        track.setLooping(loop);
        track.setVolume(instance.musicVolumePct);
    }

    /** Play an effect through the original 32-channel round-robin pool. */
    static play(sfx: SFX, loop = false): void {
        if (loop) {
            this.stop(sfx);
        }

        // Search from the rolling cursor; if the pool is full, reuse the last checked channel.
        const instance = this.instance;
        let index = 0;
        for (let j = 0; j < this.MAX_SOUNDS; j++) {
            index = instance.currentSoundIndex++ % this.MAX_SOUNDS;
            if (instance.playingSounds[index].getStatus() === sf.SoundSource.Status.Stopped) {
                break;
            }
        }

        // Only loops retain a channel for stop/isPlaying/setPitch; one-shots are untracked.
        instance.sfxLastIndex[sfx] = loop ? index : -1;
        const sound = instance.playingSounds[index];
        sound.setBuffer(instance.sfxList[sfx]);
        sound.play();
        sound.setLooping(loop);
        sound.setRelativeToListener(true);
        sound.setVolume(instance.sfxVolumePct);
    }

    /** Query the channel retained for a looping effect, as in the original. */
    static isPlaying(sfx: SFX): boolean {
        const instance = this.instance;
        const index = instance.sfxLastIndex[sfx];
        return index >= 0 &&
            instance.playingSounds[index].getStatus() === sf.SoundSource.Status.Playing;
    }

    /** Stop the retained channel for an effect. */
    static stop(sfx: SFX): void {
        const instance = this.instance;
        const index = instance.sfxLastIndex[sfx];
        if (index >= 0) {
            instance.playingSounds[index].stop();
        }
    }

    /** Fade a music track using the original SFX-volume-based fade rate. */
    static fadeOut(music: Music, deltaTime: sf.Time, time: sf.Time = sf.seconds(2)): void {
        const instance = this.instance;
        const track = instance.musicList[music];

        // The seconds ratio removes a fraction of the configured SFX volume on each update.
        // Reaching silence does not stop or rewind the stream.
        const volume = track.getVolume() -
            instance.sfxVolumePct / time.asSeconds() * deltaTime.asSeconds();
        track.setVolume(Math.max(0, volume));
    }

    /** Pause only currently playing music. */
    static pauseMusic(): void {
        for (const track of this.instance.musicList) {
            if (track.getStatus() === sf.SoundSource.Status.Playing) {
                track.pause();
            }
        }
    }

    /** Pause only currently playing pooled effects. */
    static pauseSFX(): void {
        for (const sound of this.instance.playingSounds) {
            if (sound.getStatus() === sf.SoundSource.Status.Playing) {
                sound.pause();
            }
        }
    }

    /** Resume paused music without starting stopped tracks. */
    static resumeMusic(): void {
        for (const track of this.instance.musicList) {
            if (track.getStatus() === sf.SoundSource.Status.Paused) {
                track.play();
            }
        }
    }

    /** Resume paused effects without starting stopped channels. */
    static resumeSFX(): void {
        for (const sound of this.instance.playingSounds) {
            if (sound.getStatus() === sf.SoundSource.Status.Paused) {
                sound.play();
            }
        }
    }

    /** Stop every effect channel. */
    static stopSFX(): void {
        for (const sound of this.instance.playingSounds) {
            sound.stop();
        }
    }

    /** Stop every music track. */
    static stopMusic(): void {
        for (const track of this.instance.musicList) {
            track.stop();
        }
    }

    private static logFunc(value: number): number {
        return Math.min(-Math.log10(Math.pow(1 - value * 0.9, this.VOLUME_LOG_EXP)), 1);
    }

    /** Set menu volumes in [0, 1], preserving the original logarithmic mapping. */
    static setVolume(musicVolumePct: number, sfxVolumePct: number): void {
        const instance = this.instance;

        // Keep menu values in [0, 1] separate from SFML's mapped [0, 100] volume scale.
        instance.getMusicValue = musicVolumePct;
        instance.getSFXValue = sfxVolumePct;

        instance.musicVolumePct = this.logFunc(musicVolumePct) * 100 * this.VOLUME_MULTIPLIER;
        instance.sfxVolumePct = this.logFunc(sfxVolumePct) * 100 * this.VOLUME_MULTIPLIER;

        // Apply music live; pooled effects receive the cached level on their next play().
        for (const track of instance.musicList) {
            track.setVolume(instance.musicVolumePct);
        }
    }

    /** Return the untransformed music volume selected in the menu. */
    static getMusicVolume(): number {
        return this.instance.getMusicValue;
    }

    /** Return the untransformed effect volume selected in the menu. */
    static getSfxVolume(): number {
        return this.instance.getSFXValue;
    }

    /** Adjust a retained effect's pitch; an untracked one-shot has no channel to adjust. */
    static setPitch(sfx: SFX, sfxPitch: number): void {
        const instance = this.instance;
        const index = instance.sfxLastIndex[sfx];
        if (index >= 0) {
            instance.playingSounds[index].setPitch(sfxPitch);
        }
    }

    /** Start/reconfigure all engines with an explicit player index and race mode. */
    static playEngines(playerIndex: number, raceMode?: boolean): void;
    /** Reconfigure the current player's engine; the boolean is the original race-mode flag. */
    static playEngines(playerOnly?: boolean): void;
    static playEngines(playerOrMode: number | boolean = false, raceMode = true): void {
        const instance = this.instance;

        // Despite the playerOnly overload name, a boolean supplies the race-mode flag.
        const playerIndex = typeof playerOrMode === "number" ? playerOrMode : instance.playerIndex;
        const mode = typeof playerOrMode === "number" ? raceMode : playerOrMode;
        if (!instance.enginesLoaded) {
            throw new Error("Await Audio.loadAll() before playing engines.");
        }

        instance.playerIndex = playerIndex;
        instance.raceMode = mode;

        // Start all streams once; later calls only reconfigure the selected player's stream.
        for (let i = 0; i < MenuPlayer.__COUNT; i++) {
            const engine = instance.sfxEngines[i];
            if (instance.enginesPlaying && i !== playerIndex) {
                continue;
            }
            if (!instance.enginesPlaying) {
                engine.play();
                engine.setLooping(true);
                this.setEngineVolume(i);
            }

            // Full-volume distances are in map units; divide tile counts by map width.
            if (mode || i === playerIndex) {
                engine.setAttenuation(0.60);
                engine.setMinDistance(1 / MAP_TILES_WIDTH * 3);
            } else {
                engine.setAttenuation(0.15);
                engine.setMinDistance(1 / MAP_TILES_WIDTH * 0.15);
            }
        }

        // In race mode, keep the player's engine at the listener rather than in world space.
        const playerEngine = instance.sfxEngines[playerIndex];
        playerEngine.setRelativeToListener(mode);
        if (mode) {
            playerEngine.setPosition(new sf.Vector3f(0, 0, 0));
        }
        instance.enginesPlaying = true;
    }

    /** Scale an engine's volume, retaining the distinct player and opponent gains. */
    static setEngineVolume(i: number, volume = 100): void {
        const instance = this.instance;
        const gain = i === instance.playerIndex ? 0.75 : 1 / 1.75;
        instance.sfxEngines[i].setVolume(instance.sfxVolumePct * gain * volume / 100);
    }

    /** Apply a percentage gain to all engines. */
    static setEnginesVolume(volume = 100): void {
        for (let i = 0; i < MenuPlayer.__COUNT; i++) {
            this.setEngineVolume(i, volume);
        }
    }

    /** Update a specified engine's world position and speed-dependent pitch. */
    static updateEngine(
        i: number, position: sf.Vector2f, height: number, speedForward: number, speedTurn: number,
    ): void;
    /** Update the selected player's engine with the same motion inputs. */
    static updateEngine(
        position: sf.Vector2f, height: number, speedForward: number, speedTurn: number,
    ): void;
    static updateEngine(
        ...args: [number, sf.Vector2f, number, number, number] |
            [sf.Vector2f, number, number, number]
    ): void {
        const instance = this.instance;
        let i: number;
        let position: sf.Vector2f;
        let height: number;
        let speedForward: number;
        let speedTurn: number;

        if (args.length === 5) {
            [i, position, height, speedForward, speedTurn] = args;
        } else {
            i = instance.playerIndex;
            [position, height, speedForward, speedTurn] = args;
        }

        // Forward speed is in normalized map units/second; turning speed is in radians/second.
        const maxLinearSpeed = 0.4992 / 2;
        const maxSpeedTurn = 3.6;
        let pitch = 1 + speedForward / maxLinearSpeed;
        pitch -= Math.abs(speedTurn) / maxSpeedTurn * 0.65;
        if (height > 0) {
            pitch += 0.35;
        }
        pitch = Math.min(pitch, 2);

        // Use the same height conversion as the listener; race-mode player audio stays local.
        const engine = instance.sfxEngines[i];
        if (i !== instance.playerIndex || !instance.raceMode) {
            engine.setPosition(new sf.Vector3f(position.x, position.y, height / 80));
        }
        engine.setPitch(pitch);
    }

    /** Position/orient the listener in normalized map coordinates, with angle in radians. */
    static updateListener(position: sf.Vector2f, angle: number, height: number): void {
        // The map lies in XY with Z up; height uses the original 80:1 audio conversion.
        sf.Listener.setPosition(new sf.Vector3f(position.x, position.y, height / 80));
        sf.Listener.setDirection(new sf.Vector3f(-Math.cos(angle), -Math.sin(angle), 0));
        sf.Listener.setUpVector(new sf.Vector3f(0, 0, 1));
    }

    /** Pause all eight engine streams. */
    static pauseEngines(): void {
        for (const engine of this.instance.sfxEngines) {
            engine.pause();
        }
    }

    /** Resume all eight engine streams. */
    static resumeEngines(): void {
        for (const engine of this.instance.sfxEngines) {
            engine.play();
        }
    }

    /** Stop and rewind engines; the next playEngines call configures every engine again. */
    static stopEngines(): void {
        for (const engine of this.instance.sfxEngines) {
            engine.stop();
        }

        this.instance.enginesPlaying = false;
    }

    /** Release asynchronous streaming decoders at application/test shutdown. */
    static async close(): Promise<void> {
        const instance = this.singleton;
        if (!instance) {
            return;
        }

        // Stop playback before closing stream decoders; stop() alone keeps those resources open.
        this.stopSFX();
        this.stopMusic();
        this.stopEngines();

        await Promise.all([...instance.musicList, ...instance.sfxEngines].map(track => track.close()));
        this.singleton = undefined;
    }
}
