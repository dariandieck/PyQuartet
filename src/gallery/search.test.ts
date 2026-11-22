import { describe, expect, it } from "vitest";
import { searchCards, sortEntries, type SearchEntry } from "./search.ts";

const entry = (library: string, extra: Partial<SearchEntry> = {}): SearchEntry => ({
  library,
  pypi: null,
  repo: null,
  url: null,
  keywords: [],
  summary: null,
  ...extra,
});

const deck = [
  entry("pandas", {
    pypi: "pandas",
    repo: "pandas-dev/pandas",
    keywords: ["data-analysis", "data-structures"],
    summary: "pandas abstracts in-memory table transformations on top of vectorized NumPy arrays.",
  }),
  entry("NumPy", { pypi: "numpy", repo: "numpy/numpy", keywords: ["numerical-computing", "n-dimensional-arrays"] }),
  entry("PyTorch", { pypi: "torch", repo: "pytorch/pytorch", keywords: ["deep-learning", "autograd"] }),
  entry("TorchVision", { pypi: "torchvision", repo: "pytorch/vision", keywords: ["computer-vision"] }),
  entry("Polars", { pypi: "polars", keywords: ["dataframes", "data-analysis"] }),
];
const names = (query: string) => searchCards(deck, query).map((e) => e.library);

describe("searchCards", () => {
  it("returns everything alphabetically for an empty query, ignoring case", () => {
    expect(names("  ")).toEqual(["NumPy", "pandas", "Polars", "PyTorch", "TorchVision"]);
  });

  it("ranks exact names first, then name prefixes and other fields", () => {
    expect(names("numpy")[0]).toBe("NumPy");
    // NumPy by name, pandas only through its summary.
    expect(names("numpy")).toEqual(["NumPy", "pandas"]);
    expect(names("torch")).toEqual(["PyTorch", "TorchVision"]);
  });

  it("searches keywords, packages and repos case-insensitively", () => {
    expect(names("Analysis")).toEqual(["pandas", "Polars"]);
    // Equal scores come alphabetically, not in deck order.
    const tied = [entry("seaborn", { keywords: ["plots"] }), entry("Matplotlib", { keywords: ["plots"] })];
    expect(searchCards(tied, "plots").map((e) => e.library)).toEqual(["Matplotlib", "seaborn"]);
    expect(names("pandas-dev")).toEqual(["pandas"]);
    expect(names("vision")).toEqual(["TorchVision"]);
  });

  it("needs every word to match", () => {
    expect(names("data analysis")).toEqual(["pandas", "Polars"]);
    expect(names("data deep")).toEqual([]);
  });
});

describe("sortEntries", () => {
  const stars: Record<string, number> = { NumPy: 30, pandas: 50, Polars: 40, PyTorch: 110, TorchVision: 30 };
  const byStars = (e: SearchEntry) => stars[e.library]!;
  const sorted = (value: ((e: SearchEntry) => number) | null, descending: boolean) =>
    sortEntries(deck, value, descending).map((e) => e.library);

  it("sorts by a value in both directions, equal values alphabetically", () => {
    expect(sorted(byStars, true)).toEqual(["PyTorch", "pandas", "Polars", "NumPy", "TorchVision"]);
    expect(sorted(byStars, false)).toEqual(["NumPy", "TorchVision", "Polars", "pandas", "PyTorch"]);
  });

  it("sorts by name without a value", () => {
    expect(sorted(null, false)).toEqual(["NumPy", "pandas", "Polars", "PyTorch", "TorchVision"]);
    expect(sorted(null, true)).toEqual(["TorchVision", "PyTorch", "Polars", "pandas", "NumPy"]);
  });
});
