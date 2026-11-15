import { expect, test } from "@playwright/test";
import { CUSTOMER, expectNoHorizontalScroll, shot, signIn } from "./support/helpers.js";

// F-04 in a real browser, run by the desktop-1280 project only (playwright.config.ts).
test("TEST-25 (browser) / AC-18, F-04: the admin resumes and pauses a counter; the customer sees it", async ({ page, browser }, info) => {
  await signIn(page, "admin@omkoi.coffee", process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("link", { name: "Counters" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const rc = page.getByRole("article", { name: "Counter RC" });
  await expect(rc).toContainText("PAUSED");
  await rc.getByRole("button", { name: "Resume" }).click();
  await expect(rc).toContainText("OPEN");
  await expectNoHorizontalScroll(page);
  await shot(page, info, "6-admin-resumed");

  const guestContext = await browser.newContext({ viewport: info.project.use.viewport, baseURL: info.project.use.baseURL });
  const guest = await guestContext.newPage();
  await signIn(guest, "hongtae@omkoi.coffee", CUSTOMER.password());
  await expect(guest.getByRole("button", { name: "Join RC queue" })).toBeVisible();

  await rc.getByRole("button", { name: "Pause" }).click();
  await expect(rc).toContainText("PAUSED");
  await guest.reload();
  await expect(guest.getByRole("button", { name: "Join RC queue" })).toHaveCount(0);
  await expect(guest.getByText("Paused - not taking new guests right now.")).toBeVisible();
  await guestContext.close();
});
