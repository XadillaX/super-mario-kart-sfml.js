import type * as sf from 'sfml.js';
import type { Game } from '../game';

/** Original polymorphic game state; resources finish loading before its first frame. */
export abstract class State {
    /** Completion of the state's asynchronous image, texture and audio loading. */
    ready: Promise<void> = Promise.resolve();

    /** Creates a state associated with the existing game's state stack. */
    constructor(protected readonly game: Game) {}

    /** Receives each sf::Event polled by Game. */
    handleEvent(_event: sf.Event): void {}

    /** Runs once per rendered frame and reports whether the canvas needs drawing. */
    update(_deltaTime: sf.Time): boolean {
        return false;
    }

    /** Runs at the original fixed physics interval, independent of drawing. */
    fixedUpdate(_deltaTime: sf.Time): boolean {
        return false;
    }

    /** Draws the state into the SFML render target. */
    draw(_window: sf.RenderTarget): void {}

    /** Returns the original state name used for state-stack diagnostics. */
    abstract string(): string;
}

/** Shared state references are ordinary JavaScript object references. */
export type StatePtr = State;
