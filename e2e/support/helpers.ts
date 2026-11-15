import { expect, type Page, type TestInfo } from "@playwright/test";

export const CUSTOMER = { email: "boom@omkoi.coffee", password: () => process.env.E2E_CUSTOMER_PASSWORD! };
export const STAFF_PASSWORD = () => process.env.E2E_STAFF_PASSWORD!;


export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function expectNoHorizontalScroll(page: Page) {
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits, "page must not scroll horizontally (NFR-05)").toBe(true);
}

export const shot = (page: Page, info: TestInfo, name: string) =>
  page.screenshot({ path: info.outputPath(`${info.project.name}-${name}.png`), fullPage: true });
