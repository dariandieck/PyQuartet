# PyQuartet

A Top Trumps style card game about the Python libraries behind machine learning.

**Play:** https://dariandieck.github.io/PyQuartet/

**All cards:** https://dariandieck.github.io/PyQuartet/cards.html

## Motivation

Students in computer science, data science and AI should know the libraries their work is built on. PyQuartet turns 50 (as of now) of them into a quartet game: compare GitHub stars, downloads, dependents and more, and flip a card to read what the library actually does. Play against a bot or with friends via a room code.

## Run it locally

Needs Node.js 22.18 or newer.

```sh
git clone https://github.com/dariandieck/PyQuartet.git
cd PyQuartet
npm ci
```

| Command | |
|---|---|
| `npm run dev` | Start the game locally |
| `npm run editor` | Open the card editor (local only) |
| `npm run stats` | Fetch fresh stats for all cards |

`npm run stats` works without keys, but GitHub allows only 60 requests per hour without a token, and downloads come out rounded without a pepy.tech key. Both are optional and go into `.env.local`:

```sh
GITHUB_TOKEN=...
PEPY_API_KEY=...
```

## Add or change cards

Start `npm run editor` and type a library name or homepage. The editor looks up the package, repo, stats, logo and color for you. Check the values, add keywords and a summary, save.

New cards are welcome! Open a pull request, only commit `data/cards.json`.

## Data sources

Stats are fetched automatically:

| Category | Source |
|---|---|
| GitHub stars, Forks, Contributors | GitHub REST API |
| Downloads | pepy.tech, total since the first release |
| Dependents | deps.dev, packages that depend on the library |
| Age | PyPI, years since the first upload |
| Wheel size | PyPI, the latest Linux wheel |

Libraries without a PyPI package get 0 for the PyPI values. `data/cards.json` stores exact numbers; the game rounds them so ties happen more often.

Logos come from the first image in the PyPI or GitHub README, the card color from the logo. Keywords and summaries were written by Claude Sonnet agents from each library's PyPI page, README and homepage.

The libraries are my own pick: what I know and inspiration from [best-of-ml-python](https://github.com/lukasmasuch/best-of-ml-python). In case nobody noticed: that repo is a card in the game too, just like my own small repo [ml-shuffling-regularization](https://github.com/dariandieck/ml-shuffling-regularization).

Have fun!