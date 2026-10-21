import * as sf from 'sfml.js';

/** Original driving and menu action indices, also used in smk_settings.cfg. */
export enum Key {
    ACCELERATE,
    BRAKE,
    DRIFT,
    TURN_LEFT,
    TURN_RIGHT,
    ITEM_FRONT,
    ITEM_BACK,
    PAUSE,
    ACCEPT,
    CANCEL,
    MENU_UP,
    MENU_DOWN,
    MENU_LEFT,
    MENU_RIGHT,
    __COUNT,
}

/** Configurable keyboard mapping shared by gameplay, menus, and saved preferences. */
export class Input {
    // Array order is the Key enum's persisted action order, not SFML's key order.
    private static readonly map: sf.KeyboardKey[] = [
        sf.KeyboardKey.X,
        sf.KeyboardKey.Z,
        sf.KeyboardKey.C,
        sf.KeyboardKey.Left,
        sf.KeyboardKey.Right,
        sf.KeyboardKey.Up,
        sf.KeyboardKey.Down,
        sf.KeyboardKey.Escape,
        sf.KeyboardKey.Enter,
        sf.KeyboardKey.Escape,
        sf.KeyboardKey.Up,
        sf.KeyboardKey.Down,
        sf.KeyboardKey.Left,
        sf.KeyboardKey.Right,
    ];

    private static gameWindow?: sf.RenderWindow;

    /** Sets the window used by sf::Keyboard polling to check keyboard focus. */
    static setGameWindow(window: sf.RenderWindow): void {
        Input.gameWindow = window;
    }

    /** Assigns a physical SFML key to an action. */
    static set(action: Key, code: sf.KeyboardKey): void {
        Input.map[action] = code;
    }

    /** Returns the physical key currently assigned to an action. */
    static get(action: Key): sf.KeyboardKey {
        return Input.map[action];
    }

    /** Tests an SFML KeyPressed event against the configured action. */
    static pressed(action: Key, event: sf.Event): boolean {
        return event.getIf('KeyPressed')?.code === Input.get(action);
    }

    /** Tests an SFML KeyReleased event against the configured action. */
    static released(action: Key, event: sf.Event): boolean {
        return event.getIf('KeyReleased')?.code === Input.get(action);
    }

    /** Polls sf::Keyboard only while the game window has focus. */
    static held(action: Key): boolean {
        return Boolean(Input.gameWindow?.hasFocus()) &&
            sf.Keyboard.isKeyPressed(Input.get(action));
    }

    /** Returns the original bitmap-font label for an action. */
    static getActionName(action: Key): string {
        const names = [
            'accelerate', 'brake', 'drift', 'turn left', 'turn right',
            'item front', 'item back', 'pause', 'accept', 'cancel',
            'menu up', 'menu down', 'menu left', 'menu right',
        ];
        return names[action] ?? '?';
    }

    /** Returns the original supported key labels; unsupported keys are "?". */
    static getKeyCodeName(code: sf.KeyboardKey): string {
        // These SFML key ranges are contiguous; the bitmap font uses lowercase labels.
        if (code >= sf.KeyboardKey.A && code <= sf.KeyboardKey.Z) {
            return String.fromCharCode(97 + code - sf.KeyboardKey.A);
        }
        if (code >= sf.KeyboardKey.Num0 && code <= sf.KeyboardKey.Num9) {
            return String(code - sf.KeyboardKey.Num0);
        }
        if (code >= sf.KeyboardKey.Numpad0 && code <= sf.KeyboardKey.Numpad9) {
            return `numpad ${code - sf.KeyboardKey.Numpad0}`;
        }
        if (code >= sf.KeyboardKey.F1 && code <= sf.KeyboardKey.F12) {
            return `f${code - sf.KeyboardKey.F1 + 1}`;
        }

        switch (code) {
            case sf.KeyboardKey.Escape: return 'escape';
            case sf.KeyboardKey.LControl: return 'l ctrl';
            case sf.KeyboardKey.LShift: return 'l shift';
            case sf.KeyboardKey.LAlt: return 'l alt';
            case sf.KeyboardKey.LSystem: return 'l system';
            case sf.KeyboardKey.RControl: return 'r ctrl';
            case sf.KeyboardKey.RShift: return 'r shift';
            case sf.KeyboardKey.RAlt: return 'r alt';
            case sf.KeyboardKey.RSystem: return 'r system';
            case sf.KeyboardKey.Hyphen: return 'dash';
            case sf.KeyboardKey.Space: return 'space';
            case sf.KeyboardKey.Enter: return 'enter';
            case sf.KeyboardKey.Backspace: return 'delete';
            case sf.KeyboardKey.Tab: return 'tab';
            case sf.KeyboardKey.PageUp: return 'pg up';
            case sf.KeyboardKey.PageDown: return 'pg down';
            case sf.KeyboardKey.End: return 'end';
            case sf.KeyboardKey.Home: return 'home';
            case sf.KeyboardKey.Insert: return 'insert';
            case sf.KeyboardKey.Delete: return 'delete';
            case sf.KeyboardKey.Left: return 'left';
            case sf.KeyboardKey.Right: return 'right';
            case sf.KeyboardKey.Up: return 'up';
            case sf.KeyboardKey.Down: return 'down';
            default: return '?';
        }
    }
}
