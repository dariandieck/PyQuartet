# Category statistics

Mean and standard deviation of every category over the cards in `data/cards.json`.

- Computed on 2026-11-20 from 48 of 50 cards, using the exact stored values (not the in-game rounding of `roundStat`).
- Left out: best-of-ml-python and ml-shuffling-regularization. Neither is a PyPI library, so their PyPI-based values are placeholders (best-of-ml-python stores 10^18 downloads, which alone dominated mean and std).
- Standard deviation is the population one (divided by n), since the cards are the whole set, not a sample.
- Not updated automatically: recompute after `npm run stats` or larger card edits.

| Category | Unit | Mean | Std | Median | Min (card) | Max (card) |
|---|---|---:|---:|---:|---:|---:|
| GitHub stars | | 43,286 | 44,543 | 28,954 | 204 (openpyxl) | 201,656 (TensorFlow) |
| Forks | | 11,199 | 15,023 | 4,429 | 46 (openpyxl) | 77,970 (TensorFlow) |
| Contributors | | 1,295 | 1,611 | 622 | 13 (lms) | 7,351 (PyTorch) |
| Downloads | | 4,843,455,107 | 12,242,034,962 | 934,780,980 | 4,715 (comfyui) | 77,156,313,125 (boto3) |
| Dependents | | 18,934 | 40,353 | 2,865 | 0 (comfyui) | 177,482 (NumPy) |
| Age | years | 9.5 | 4.7 | 9.2 | 2.4 (comfyui) | 20.9 (Matplotlib) |
| Wheel size | MB | 49.7 | 124.2 | 3.4 | 0.02 (ollama) | 546 (TensorFlow) |

## Notes

- All count categories are heavily right skewed (std above the mean, median far below the mean): a few libraries such as TensorFlow, NumPy or boto3 dominate. The median describes a typical card better than the mean.
- Age is the only roughly symmetric category (mean close to the median, std about half the mean).
