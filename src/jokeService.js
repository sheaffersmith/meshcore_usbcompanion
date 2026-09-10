const JOKE_API_URL =
    'https://v2.jokeapi.dev/joke/Any?safe-mode&type=single';

const MAX_ATTEMPTS = 8;

export async function getCleanJoke(maxBytes) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const response =
            await fetch(JOKE_API_URL);

        if (!response.ok) {
            throw new Error(
                `Joke API returned HTTP ${response.status}`
            );
        }

        const data =
            await response.json();

        if (
            data.error ||
            data.type !== 'single' ||
            !data.joke
        ) {
            continue;
        }

        const joke =
            data.joke.trim();

        const byteLength =
            Buffer.byteLength(
                joke,
                'utf8'
            );

        if (byteLength <= maxBytes) {
            console.log(
                `Joke accepted: ${byteLength}/${maxBytes} bytes`
            );

            return joke;
        }

        console.log(
            `Joke too long: ${byteLength}/${maxBytes} bytes — requesting another`
        );
    }

    throw new Error(
        `Could not find a joke under ${maxBytes} bytes after ${MAX_ATTEMPTS} attempts`
    );
}