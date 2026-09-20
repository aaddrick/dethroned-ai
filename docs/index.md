# Dethrone docs

The front door is the repo [README](../README.md): what the game is and what it tests. These pages
are the detail behind it. Each one opens with a diagram that reads like a snake: the top row left to
right, down the last column, the next row back right to left.

## The game

- [Gameplay](gameplay.md): a reign from coronation to death, the kings, the deck, how score works
  and how the balance was chosen.
- [A turn](turn.md): the two model calls, the blend, the roll, and why a turn is two calls and not one.

## The system

- [Architecture](architecture.md): what runs where, and which file does what.
- [Integrity](integrity.md): signed state, the limits, and everything a turn must pass before the
  model is called.
- [The chronicle](chronicle.md): the record of every turn, the public numbers, and how to query it.
- [Operations](operations.md): releasing, Terraform, and what to check when something looks wrong.

## Reading the diagrams

| Box | Means |
| --- | --- |
| Grey | An ordinary step |
| Gold | A call to Jev |
| Amber | A gate: a check that can refuse or turn the flow |
| Purple | Something stored |
| Blue | A person: the player, a reader, or whoever is releasing |
| Green | Where the flow ends |
| Dashed amber arrow | The flow going back round |

The diagrams are [D2](https://d2lang.com) sources in [`diagrams/`](diagrams/), rendered to a light
and a dark SVG each. [`diagrams/CLAUDE.md`](diagrams/CLAUDE.md) has the rules for changing them.
