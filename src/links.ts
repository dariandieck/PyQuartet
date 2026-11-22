export const REPO_URL = "https://github.com/dariandieck/PyQuartet";
/** The card gallery, a second page next to index.html (relative, so it works under /PyQuartet/ too). */
export const CARDS_PAGE = "./cards.html";

export function openUrl(url: string): void {
  window.open(url, "_blank", "noopener");
}
