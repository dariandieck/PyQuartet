import { describe, expect, it } from "vitest";
import { normalizeCard } from "./cardsFile.ts";
import { ageYears, bytesToMb, lastPage, mostLinkedRepo, parseBadge, pyprojectName, readmeImages, repoFromUrl, wheelSizeMb } from "./lookup.ts";

describe("lookup helpers", () => {
  it("reads owner/repo from GitHub URLs", () => {
    expect(repoFromUrl("https://github.com/tensorflow/tensorflow/tags")).toBe("tensorflow/tensorflow");
    expect(repoFromUrl("https://github.com/pandas-dev/pandas.git")).toBe("pandas-dev/pandas");
    expect(repoFromUrl("https://github.com/sponsors/numpy")).toBeNull();
    expect(repoFromUrl("https://pandas.pydata.org")).toBeNull();
  });

  it("picks the most linked repo", () => {
    const links = [
      "https://github.com/pytorch/tutorials",
      "https://github.com/pytorch/pytorch",
      "https://github.com/PyTorch/pytorch/issues",
    ];
    expect(mostLinkedRepo(links)).toBe("pytorch/pytorch");
    expect(mostLinkedRepo([])).toBeNull();
  });

  it("counts items via the last page link", () => {
    const link =
      '<https://api.github.com/repositories/1/contributors?per_page=1&page=2>; rel="next", ' +
      '<https://api.github.com/repositories/1/contributors?per_page=1&page=4402>; rel="last"';
    expect(lastPage(link)).toBe(4402);
    expect(lastPage(null)).toBeNull();
  });

  it("parses pepy badges", () => {
    const svg = (v: string) => `<svg><text>downloads</text><text x="1">${v}</text><text x="2">${v}</text></svg>`;
    expect(parseBadge(svg("18G"))).toBe(18_000_000_000);
    expect(parseBadge(svg("1.2M"))).toBe(1_200_000);
    expect(parseBadge(svg("523k"))).toBe(523_000);
    expect(parseBadge("<svg></svg>")).toBeNull();
  });

  it("converts sizes to MB with more decimals for small files", () => {
    expect(bytesToMb(539_000_000)).toBe(514);
    expect(bytesToMb(3_300_000)).toBe(3.1);
    expect(bytesToMb(25_000)).toBe(0.02);
  });

  it("takes the Linux x86-64 wheel, else the largest wheel, else the sdist", () => {
    const file = (filename: string, size: number, packagetype = "bdist_wheel") => ({ filename, size, packagetype });
    const torch = [
      file("torch-2.9.0-cp312-cp312-manylinux_2_28_x86_64.whl", 539_000_000),
      file("torch-2.9.0-cp312-cp312-manylinux_2_28_aarch64.whl", 104_000_000),
      file("torch-2.9.0-cp312-cp312-win_amd64.whl", 230_000_000),
    ];
    expect(wheelSizeMb(torch)).toBe(514);
    expect(wheelSizeMb([file("a-1.0-py3-none-any.whl", 2 * 1024 ** 2), file("a-1.0.tar.gz", 9 * 1024 ** 2, "sdist")])).toBe(2);
    expect(wheelSizeMb([file("a-1.0.tar.gz", 5 * 1024 ** 2, "sdist")])).toBe(5);
    expect(wheelSizeMb([])).toBe(0);
  });

  it("counts the age from the first upload", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    expect(ageYears(["2016-06-01T00:00:00Z", "2006-06-01T00:00:00Z"], now)).toBe(20);
    expect(ageYears([], now)).toBe(0);
  });

  it("orders card keys and drops empty fields", () => {
    const card = normalizeCard({ stats: { a: 1 }, color: null, library: "x", repo: "o/x", url: "" });
    expect(Object.keys(card)).toEqual(["library", "repo", "stats"]);
  });

  it("orders stats like the categories and drops removed ones", () => {
    const category = (label: string) => ({ label, unit: null, polarity: "positive" as const, source: null });
    const card = normalizeCard({ library: "x", stats: { b: 2, old: 9, a: 1 } }, [category("a"), category("b")]);
    expect(card.stats).toEqual({ a: 1, b: 2 });
    expect(Object.keys(card.stats)).toEqual(["a", "b"]);
  });
});

describe("repo and package matching", () => {
  it("prefers repos named like the library", () => {
    const links = ["https://github.com/a/tutorials", "https://github.com/a/tutorials", "https://github.com/a/py-torch"];
    expect(mostLinkedRepo(links, "pytorch")).toBe("a/py-torch");
    expect(mostLinkedRepo(links, "other")).toBe("a/tutorials");
  });

  it("reads the package name from pyproject.toml", () => {
    expect(pyprojectName('[build-system]\nname = "x"\n\n[project]\nname = "torch"\nversion = "1"\n')).toBe("torch");
    expect(pyprojectName('[project]\ndynamic = ["version"]\n[tool.x]\nname = "nope"\n')).toBeNull();
    expect(pyprojectName("[tool.poetry]\nname = 'x'\n")).toBeNull();
  });
});

describe("readmeImages", () => {
  it("finds images in document order and skips badges", () => {
    const markdown = [
      "[![PyPI](https://img.shields.io/pypi/v/x.svg)](https://pypi.org)",
      "[![CI](https://dev.azure.com/x/x/_apis/build/status/x?branchName=main)](https://x)",
      '<p align="center"><img alt="logo" src="docs/logo.svg" width="300"></p>',
      "![later](https://example.org/screenshot.png)",
    ].join("\n");
    expect(readmeImages(markdown, "o/x")).toEqual([
      "https://raw.githubusercontent.com/o/x/HEAD/docs/logo.svg",
      "https://example.org/screenshot.png",
    ]);
  });

  it("reads reStructuredText images and GitHub blob links", () => {
    const rst = ".. |logo| image:: https://github.com/o/x/blob/main/logo.png\n.. image:: https://codecov.io/x.svg";
    expect(readmeImages(rst, null)).toEqual(["https://github.com/o/x/raw/main/logo.png"]);
  });
});
