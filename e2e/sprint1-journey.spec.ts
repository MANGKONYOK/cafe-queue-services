import { expect, test, type Page, type TestInfo } from "@playwright/test";

const CUSTOMER = { email: "boom@omkoi.coffee", password: () => process.env.E2E_CUSTOMER_PASSWORD! };
const STAFF_PASSWORD = () => process.env.E2E_STAFF_PASSWORD!;

// Each viewport serves a different counter with the staff member assigned to it (BR-09).
const PLAN: Record<string, { prefix: string; staff: string }> = {
  "mobile-375": { prefix: "SB", staff: "barista@omkoi.coffee" },
  "tablet-768": { prefix: "EB", staff: "barista@omkoi.coffee" },
  "desktop-1280": { prefix: "DL", staff: "dessert@omkoi.coffee" },
};

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function expectNoHorizontalScroll(page: Page) {
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits, "page must not scroll horizontally (NFR-05)").toBe(true);
}

const shot = (page: Page, info: TestInfo, name: string) =>
  page.screenshot({ path: info.outputPath(`${info.project.name}-${name}.png`), fullPage: true });

test("TEST-19 / AC-01, AC-04, AC-10, AC-13, NFR-05: join, serve, persisted result, sign out", async ({ page, browser }, info) => {
  const { prefix, staff } = PLAN[info.project.name];
  const code = `${prefix}-001`;

  // Customer signs in and joins (AC-01, AC-04).
  await signIn(page, CUSTOMER.email, CUSTOMER.password());
  await expect(page).toHaveURL(/\/queue$/);
  await expect(page.getByText("No active tickets - join a counter below")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, info, "1-queue-empty");

  const join = page.getByRole("button", { name: `Join ${prefix} queue` });
  await join.scrollIntoViewIfNeeded();
  await join.click();
  const card = page.getByRole("article", { name: `Ticket ${code}` });
  await expect(card).toContainText("WAITING");
  await expect(card).toContainText("0 ahead");
  await expectNoHorizontalScroll(page);
  await shot(page, info, "2-joined");

  // Staff on that counter calls, serves and completes (AC-10), in a separate browser session.
  const staffContext = await browser.newContext({ viewport: info.project.use.viewport, baseURL: info.project.use.baseURL });
  const console = await staffContext.newPage();
  await signIn(console, staff, STAFF_PASSWORD());
  await expect(console).toHaveURL(/\/staff$/);
  await console.getByRole("tab", { name: new RegExp(`^${prefix} `) }).click();
  await expect(console.getByLabel("Waiting count")).toHaveText("1");
  await expectNoHorizontalScroll(console);

  await console.getByPlaceholder("e.g. Slow Bar 1").fill(`${prefix} Station 1`);
  await console.getByRole("button", { name: "Call next" }).click();
  const row = console.getByRole("listitem", { name: `Ticket ${code}` });
  await expect(row).toContainText("CALLED");
  await shot(console, info, "3-staff-called");

  await row.getByRole("button", { name: "Start serving" }).click();
  await expect(row).toContainText("SERVING");
  await row.getByRole("button", { name: "Complete" }).click();
  await console.getByLabel("Completion summary").fill("Served 2x Omkoi Washed V60");
  await console.getByRole("dialog").getByRole("button", { name: "Complete" }).click();
  await expect(row).toHaveCount(0); // left the Active view
  await console.getByLabel("Show").selectOption("COMPLETED");
  await expect(console.getByRole("listitem", { name: `Ticket ${code}` })).toContainText("COMPLETED");
  await expectNoHorizontalScroll(console);
  await shot(console, info, "4-staff-completed");
  await staffContext.close();

  // The customer reloads and sees the persisted result.
  await page.reload();
  await expect(page.getByText("Earlier tickets")).toBeVisible();
  await expect(page.getByRole("article", { name: `Ticket ${code}` })).toContainText("COMPLETED");
  await expectNoHorizontalScroll(page);
  await shot(page, info, "5-customer-completed");

  // Sign out ends the session; the protected page then sends the visitor to sign-in (AC-13).
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await page.goto("/queue");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
