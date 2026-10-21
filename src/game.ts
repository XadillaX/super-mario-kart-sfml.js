import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import * as sf from 'sfml.js';
import { Audio } from './audio/audio';
import { Lakitu } from './entities/lakitu';
import { Gui } from './gui/gui';
import { Input } from './input/input';
import { Map } from './map/map';
import { Settings } from './settings';
import { StateInitLoad } from './states/initload';
import type { State } from './states/statebase';

/** Original SFML game window, deferred state stack and fixed-step game loop. */
export class Game {
    private static readonly WINDOW_STYLE = sf.Style.Titlebar | sf.Style.Close;
    private readonly window = new sf.RenderWindow();
    private gameEnded = false;
    private tryPop = 0;
    private readonly stateStack: State[] = [];

    /** Creates the original game window and pushes the initial resource loader. */
    constructor(
        private readonly baseWidth: number,
        private readonly baseHeight: number,
        private readonly framerate = 60,
    ) {
        // Settings determine the window size before HUD and input are bound to it.
        Settings.tryLoadSettings();
        this.updateResolution();
        Map.setGameWindow(this);
        Input.setGameWindow(this.window);
        this.pushState(new StateInitLoad(this));
    }

    private getCurrentState(): State {
        return this.stateStack[this.stateStack.length - 1];
    }

    private handleEvents(currentState: State): void {
        for (let event = this.window.pollEvent(); event; event = this.window.pollEvent()) {
            currentState.handleEvent(event);
            if (event.is('Closed')) {
                this.gameEnded = true;
            }
        }
    }

    private handleTryPop(): void {
        // States request removals during callbacks; the current frame finishes first.
        while (this.tryPop > 0) {
            this.tryPop--;
            if (this.stateStack.length === 0) {
                console.error('Error: Popped too many states');
                this.gameEnded = true;
            } else {
                this.stateStack.pop();
                if (this.stateStack.length === 0) {
                    this.gameEnded = true;
                }
            }
        }
    }

    /** Runs the original 60 Hz physics loop, yielding for Node's async resources. */
    async run(): Promise<void> {
        try {
            // C++ completes initial asset loading before starting its game clock.
            await this.getCurrentState()?.ready;
            const timer = new sf.Clock();
            let lastTime = 0n;
            const fixedUpdateStep = sf.seconds(1 / this.framerate);
            const stepMicroseconds = fixedUpdateStep.asMicroseconds();
            let fixedUpdateTime = 0n;

            while (this.window.isOpen() && !this.gameEnded) {
                // Retain this state for the entire frame even if a callback pushes a child.
                const currentState = this.getCurrentState();
                if (!currentState) {
                    break;
                }
                await currentState.ready;

                const time = timer.getElapsedTime().asMicroseconds();
                const elapsed = time - lastTime;
                lastTime = time;

                // Preserve the original stall guard instead of simulating a long backlog.
                if (elapsed > 1_000_000n) {
                    await yieldToEventLoop();
                    continue;
                }
                const deltaTime = sf.microseconds(elapsed);

                // Events can load previews; update can prepare the next course.
                // Each can replace ready, so resolve it before the following phase.
                this.handleEvents(currentState);
                await currentState.ready;
                let updated = currentState.update(deltaTime);
                await currentState.ready;

                // Integer microseconds keep fixed steps stable during long play sessions.
                fixedUpdateTime += elapsed;
                while (fixedUpdateTime >= stepMicroseconds) {
                    fixedUpdateTime -= stepMicroseconds;
                    updated = currentState.fixedUpdate(fixedUpdateStep) || updated;
                }

                if (updated) {
                    currentState.draw(this.window);
                }
                this.window.display();

                this.handleTryPop();
                // Native async resource work needs Node's event loop to run between frames.
                await yieldToEventLoop();
            }
        } finally {
            // Music streams must close even if a state fails while loading assets.
            this.window.close();
            Audio.stopMusic();
            Audio.stopSFX();
            Audio.stopEngines();
            Settings.saveSettings();
            this.stateStack.length = 0;
            await Audio.close();
        }
    }

    /** Pushes immediately while the current frame retains its original state. */
    pushState(state: State): void {
        this.stateStack.push(state);
    }

    /** Defers removing states until the stack contains at most i entries. */
    popStatesUntil(i: number): void {
        this.tryPop = Math.max(0, this.stateStack.length - i);
    }

    /** Defers one pop until all of the current frame's callbacks have finished. */
    popState(): void {
        this.tryPop++;
    }

    /** Returns the shared sf::RenderWindow used for drawing and focus checks. */
    getWindow(): sf.RenderWindow {
        return this.window;
    }

    /** Returns resolution as width/height instead of C++ scalar output references. */
    getCurrentResolution(): { width: number; height: number } {
        const multiplier = Settings.getResolutionMultiplier();
        return {
            width: this.baseWidth * multiplier,
            height: this.baseHeight * multiplier,
        };
    }

    /** Recreates the original fixed-aspect window and updates HUD layout sizes. */
    updateResolution(): void {
        if (this.window.isOpen()) {
            this.window.close();
        }

        const { width, height } = this.getCurrentResolution();
        this.window.create(new sf.VideoMode(new sf.Vector2u(width, height)), 'Super Mario Kart', {
            style: Game.WINDOW_STYLE,
        });
        this.window.setFramerateLimit(this.framerate);

        Gui.setWindowSize(this.window.getSize());
        Lakitu.setWindowSize(this.window.getSize());
    }
}
