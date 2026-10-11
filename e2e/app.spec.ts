import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Fictional sample cafes from supabase/seeds (is_sample = true).
const PLACE = "saffron-steam-coffee";
const OTHER_PLACE = "ravi-roast-house";

async function noHorizontalScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll, "page scrolls sideways").toBeLessThanOrEqual(width);
}

test("a new user gets a recommendation in 4 taps", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Up to Rs 800" }).click(); // 1
  await page.getByRole("button", { name: /^Cheapest/ }).click(); // 2
  await page.getByRole("button", { name: /^Surprise me/ }).click(); // 3
  await page.getByRole("button", { name: /^Anywhere/ }).click(); // 4
  await expect(page.getByRole("heading", { name: "Your pick" })).toBeVisible();
  await expect(page.getByText("TOP PICK", { exact: false })).toBeVisible();
  await expect(page.getByText("You pay").first()).toBeVisible();
});

test("comparing 3 places fits a 360 px screen", async ({ page }) => {
  await page.goto(`/compare?places=${PLACE},${OTHER_PLACE},bahria-bean-kiosk&drink=latte`);
  await expect(page.getByRole("table")).toBeVisible();
  await noHorizontalScroll(page);
});

test("places opened before still work offline; others show the offline page", async ({ page, context }) => {
  await page.goto(`/places/${PLACE}`);
  const name = (await page.getByRole("heading", { level: 1 }).innerText()).trim();
  // The worker caches this page and the scripts it loaded once it takes control.
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 20_000 });
  await page.waitForFunction(async () => !!(await caches.match(location.href)), null, { timeout: 20_000 });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await expect(page.getByText(/You.re offline/)).toBeVisible(); // banner

  await page.goto(`/places/${OTHER_PLACE}?never-opened=1`);
  await expect(page.getByRole("heading", { name: /You.re offline/ })).toBeVisible();
  await context.setOffline(false);
});

const PAGES = ["/", "/explore", `/places/${PLACE}`, `/compare?places=${PLACE},${OTHER_PLACE}&drink=latte`, "/deals", "/pick?b=800", "/profile", "/offline", "/login"];

for (const scheme of ["light", "dark"] as const) {
  test(`accessibility (WCAG 2.1 AA, ${scheme} mode)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const problems: string[] = [];
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await noHorizontalScroll(page);
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .exclude(".leaflet-container") // third-party map tiles and controls
        .analyze();
      for (const v of violations) problems.push(`${path} ${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")})`);
    }
    expect(problems).toEqual([]);
  });
}

test("keyboard: skip link first, then everything incl. the bottom navigation", async ({ page }) => {
  await page.goto("/explore");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  const seen: string[] = [];
  for (let i = 0; i < 60 && !seen.includes("Profile"); i++) {
    await page.keyboard.press("Tab");
    seen.push(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText?.trim() ?? ""));
  }
  expect(seen).toContain("Profile");
});
