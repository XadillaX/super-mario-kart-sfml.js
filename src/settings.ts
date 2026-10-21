import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import * as sf from 'sfml.js';
import { Audio } from './audio/audio';
import { BASIC_HEIGHT } from './entities/enums';
import { Input, Key } from './input/input';

/** Original settings file, volume steps, resolution choices and key bindings. */
export class Settings {
    private static readonly FILE_NAME = 'smk_settings.cfg';
    private static readonly MUSIC_VOLUME = 'music_volume';
    private static readonly SFX_VOLUME = 'sfx_volume';
    private static readonly RESOLUTION = 'resolution';

    private static readonly DEFAULT_RESOLUTION_INDEX = 2;
    private static readonly ALLOWED_MULTIPLIERS = [1, 2, 3, 4, 5, 6, 8];
    // Retain both the menu index and actual multiplier saved in the configuration.
    private static resolutionIndex = Settings.DEFAULT_RESOLUTION_INDEX;
    private static resolutionMultiplier =
        Settings.ALLOWED_MULTIPLIERS[Settings.DEFAULT_RESOLUTION_INDEX];

    /** Resolves writable user settings without creating files or directories. */
    static getFilePath(): string {
        let directory = process.env.SMK_CONFIG_DIR;
        if (!directory) {
            switch (process.platform) {
                case 'darwin':
                    directory = join(homedir(), 'Library', 'Application Support', 'super-mario-kart-sfml.js');
                    break;
                case 'win32':
                    directory = join(process.env.APPDATA || homedir(), 'super-mario-kart-sfml.js');
                    break;
                default:
                    directory = join(
                        process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
                        'super-mario-kart-sfml.js',
                    );
                    break;
            }
        }
        return join(directory, Settings.FILE_NAME);
    }

    /** Import the original project-root cfg once, preserving an existing user cfg. */
    private static migrateLegacySettings(filePath: string): void {
        const legacyPath = join(__dirname, '..', Settings.FILE_NAME);
        if (existsSync(filePath) || !existsSync(legacyPath)) {
            return;
        }

        try {
            const contents = readFileSync(legacyPath);
            mkdirSync(dirname(filePath), { recursive: true });
            // Preserve bytes, not read-only bundle permissions; never replace another user's save.
            writeFileSync(filePath, contents, { flag: 'wx' });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                console.error('Error while migrating settings:', error);
            }
        }
    }

    /** Returns the multiplier of the original 256 × 224 base resolution. */
    static getResolutionMultiplier(): number {
        return Settings.resolutionMultiplier;
    }

    /** Selects the next resolution if it fits the desktop height, as in SFML 2. */
    static incrementResolutionMultiplier(): boolean {
        if (Settings.resolutionIndex === Settings.ALLOWED_MULTIPLIERS.length - 1 ||
            sf.VideoMode.getDesktopMode().size.y <
                BASIC_HEIGHT * Settings.ALLOWED_MULTIPLIERS[Settings.resolutionIndex + 1] / 2) {
            return false;
        }

        Settings.resolutionIndex++;
        Settings.resolutionMultiplier =
            Settings.ALLOWED_MULTIPLIERS[Settings.resolutionIndex];
        return true;
    }

    /** Selects the previous allowed resolution, returning false at the minimum. */
    static decrementResolutionMultiplier(): boolean {
        if (Settings.resolutionIndex === 0) {
            return false;
        }

        Settings.resolutionIndex--;
        Settings.resolutionMultiplier =
            Settings.ALLOWED_MULTIPLIERS[Settings.resolutionIndex];
        return true;
    }

    /** Parses one named preference or numeric action binding from the shared cfg format. */
    private static applySetting(key: string, value: string): boolean {
        const number = Number.parseInt(value, 10);
        if (!Number.isFinite(number)) {
            console.error(`Error when reading setting ${key}.`);
            return false;
        }

        // Volume is stored as an integer percentage but Audio accepts a 0–1 value.
        if (key === Settings.MUSIC_VOLUME || key === Settings.SFX_VOLUME) {
            if (number % 5 !== 0 || number < 0 || number > 100) {
                return false;
            }
            if (key === Settings.MUSIC_VOLUME) {
                Audio.setVolume(number * 0.01, Audio.getSfxVolume());
            } else {
                Audio.setVolume(Audio.getMusicVolume(), number * 0.01);
            }
        } else if (key === Settings.RESOLUTION) {
            const index = Settings.ALLOWED_MULTIPLIERS.indexOf(number);
            if (index === -1) {
                return false;
            }
            Settings.resolutionIndex = index;
            Settings.resolutionMultiplier = number;
        } else {
            // Numeric keys are action IDs; their values are SFML keyboard codes.
            const action = Number.parseInt(key, 10);
            if (!Number.isFinite(action) || action < 0 || action >= Key.__COUNT) {
                return false;
            }
            Input.set(action, number);
        }
        return true;
    }

    private static writeDefaultSettings(): void {
        Settings.resolutionIndex = Settings.DEFAULT_RESOLUTION_INDEX;
        Settings.resolutionMultiplier =
            Settings.ALLOWED_MULTIPLIERS[Settings.resolutionIndex];
        Settings.saveSettings();
    }

    /** Reads the original .cfg format, creating defaults when absent or invalid. */
    static tryLoadSettings(): void {
        const filePath = Settings.getFilePath();
        Settings.migrateLegacySettings(filePath);
        if (!existsSync(filePath)) {
            Settings.writeDefaultSettings();
            return;
        }

        try {
            const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
            // The first line is the human-readable header, not a key/value setting.
            for (let index = 1; index < lines.length; index++) {
                const line = lines[index];
                if (index === lines.length - 1 && line === '') {
                    break;
                }

                const equals = line.indexOf('=');
                if (equals === -1 ||
                    !Settings.applySetting(line.slice(0, equals), line.slice(equals + 1))) {
                    console.error('Error while loading settings');
                    Settings.writeDefaultSettings();
                    return;
                }
            }
        } catch (error) {
            console.error('Error while loading settings:', error);
            Settings.writeDefaultSettings();
        }
    }

    /** Saves volumes, resolution and all original action indices to the .cfg file. */
    static saveSettings(): void {
        // The half-percent bias compensates for float rounding when restoring menu steps.
        const lines = [
            'SUPER MARIO KART SETTINGS. DO NOT EDIT THIS FILE.',
            `${Settings.MUSIC_VOLUME}=${Math.trunc((Audio.getMusicVolume() + 0.005) * 100)}`,
            `${Settings.SFX_VOLUME}=${Math.trunc((Audio.getSfxVolume() + 0.005) * 100)}`,
            `${Settings.RESOLUTION}=${Settings.resolutionMultiplier}`,
        ];
        for (let index = 0; index < Key.__COUNT; index++) {
            lines.push(`${index}=${Input.get(index)}`);
        }

        const filePath = Settings.getFilePath();
        try {
            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, `${lines.join('\n')}\n`);
        } catch (error) {
            console.error(`Error: cannot create ${filePath} configuration file`, error);
        }
    }
}
