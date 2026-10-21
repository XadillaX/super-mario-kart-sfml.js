import { resolve } from 'node:path';
import { BASIC_WIDTH, BASIC_HEIGHT } from './entities/enums';
import { Game } from './game';

/** Starts the same 60 Hz game at half the original basic dimensions. */
export async function main(): Promise<void> {
    // Asset paths in the original sources are relative to the project root.
    process.chdir(resolve(__dirname, '..'));
    const game = new Game(BASIC_WIDTH / 2, BASIC_HEIGHT / 2, 60);
    await game.run();
}

if (require.main === module) {
    main().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
