# Dethrone

A small card game built to test [Jev](https://typesafe.ai), TypeSafe's decision model. Jev plays the king. You play the court, and your job is to get him off the throne as fast as you can.

Play it at [dethroned.ai](https://dethroned.ai). Every turn anyone plays is public at [dethroned.ai/eval](https://dethroned.ai/eval).

## The game

Each year you pick one petition from a hand of five, or write your own. The king chooses between its two options. His choice moves four meters: church, people, army and treasury. If any meter reaches 0 or 100, the reign ends. Fewer years is a better score.

Each king has a temperament (a flaw such as vanity or greed) and a wisdom level. Gold-edged cards are aimed at his flaw. A reckless king tends to take the bait; a shrewd one usually listens to his advisor.

## What it tests

Jev is not a chatbot. It takes a situation and a list of typed questions, and returns answers with probabilities in well under a second. It writes none of the text in the game; every word on screen is authored. The game exists to put those answers in front of people and record them.

Each turn is two calls to the model:

1. **Forecast.** In character, which option does the king want? Is this petition a trap? What will each option do to each of the four factions?
2. **Advisor.** Given those forecasts as numbers, which option is safer?

The decision is a dice roll between the two answers, weighted by the king's wisdom. The roll is shown next to the odds, so a surprising result is visibly the dice and not the model. The forecasts the model made for the chosen option are what move the meters, so the king lives or dies by his own predictions.

The questions this is meant to answer:

- **Consistency.** Does the same king answer the same petition the same way on different plays?
- **Character.** Does a vain king fall for flattery more often than for petitions that are not aimed at him?
- **Judgment.** When a meter is near an edge, does the advisor pick the option the model's own forecasts say is safer?
- **Trap reading.** Can it tell a manipulative petition from an honest one?

## The chronicle

[/eval](https://dethroned.ai/eval) is a ledger of every turn, with running answers to the questions above. Each entry opens into the exact request and response of both calls, the odds, the roll and what happened to the meters. Nothing is rounded, so any analysis can be redone from the log.

- `/eval?turn=<id>` links to one turn
- `/api/eval` is the summary as JSON
- `/api/eval/export` is every record as JSONL

Petitions that players write themselves are counted, but their text is never shown or exported, and reigns that heard one are kept out of the headline numbers.

The game state (king, meters, year) is signed by the server, so a record in the chronicle is a turn that was really played from a state the server produced, once.

## Run it locally

```sh
npm install
npm run mock    # fake answers, no key needed: http://localhost:3000
```

For the real model, copy `.env.example` to `.env`, put a TypeSafe API key in it and run `npm start`.

Node 20 or newer. The only dependency is `pg`. Without a database, turns are logged to a local file; set `DATABASE_URL` to use Postgres.

## More

- [`docs/`](docs/index.md): gameplay, the anatomy of a turn, architecture, integrity, the chronicle and operations, each with a diagram
- `CLAUDE.md`: how the code is laid out, how the game is balanced, and the design rules
- `terraform/README.md`: the Google Cloud deployment
- `scripts/`: the simulations and experiments behind the tuning, including the one that showed why a turn needs two calls

## License

MIT. See [`LICENSE`](LICENSE).
