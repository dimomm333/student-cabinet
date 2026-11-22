import assert from "node:assert/strict";
import { expect } from "@playwright/test";

export async function touchSwipe(cdp, page, box, direction = 1) {
  const x = Math.round(box.x + box.width * 0.55);
  // Keep the gesture inside the calendar even with a short visual viewport.
  const top = Math.round(box.y + 30);
  const bottom = Math.round(box.y + box.height - 28);
  const send = (type, y) => cdp.send("Input.dispatchTouchEvent", {
    type, touchPoints: type === "touchEnd" ? [] : [{ x, y }],
  });
  await send("touchStart", direction > 0 ? bottom : top);
  for (let step = 1; step <= 8; step++) {
    const fraction = step / 8;
    await send("touchMove", Math.round(direction > 0 ? bottom - (bottom - top) * fraction : top + (bottom - top) * fraction));
    await page.waitForTimeout(24);
  }
  await send("touchEnd");
}

export async function verifyTouchCalendar(page, picker, { short = false } = {}) {
  const trigger = picker.getByRole("button", { name: "Открыть календарь", exact: true });
  const month = picker.locator(".schedule-calendar strong");
  const calendar = picker.locator(".schedule-calendar");
  await trigger.scrollIntoViewIfNeeded();
  const scrollPosition = () => picker.evaluate(el => [scrollY, el.closest("dialog")?.scrollTop ?? 0]);
  const before = await scrollPosition();
  async function assertStableScroll(message) {
    const after = await scrollPosition();
    assert(after.every((value, index) => Math.abs(value - before[index]) < 2), message);
  }
  await trigger.tap();
  await expect(calendar).toBeVisible();
  const initial = await month.innerText();
  const size = await calendar.evaluate(element => {
    const box = element.getBoundingClientRect();
    const viewport = visualViewport;
    const day = element.querySelector(".schedule-calendar-grid button").getBoundingClientRect();
    return {
      scroll: element.scrollHeight - element.clientHeight,
      fits: box.left >= 0 && box.right <= viewport.width + 1 && box.top >= 0 && box.bottom <= viewport.height + 1
        && element.scrollWidth <= element.clientWidth && document.documentElement.scrollWidth <= innerWidth,
      placement: element.dataset.placement,
      dayWidth: day.width,
    };
  });
  assert(size.fits, "Calendar or page overflows the viewport");
  if (page.viewportSize().width <= 390) {
    assert.equal(size.placement, "bottom");
    assert(size.dayWidth >= 36, "Calendar touch target is too narrow");
  }
  assert(short ? size.scroll > 20 : size.scroll <= 1, "Unexpected amount of internal scrolling");
  const cdp = await page.context().newCDPSession(page);
  try {
    const box = await calendar.boundingBox();
    for (let attempt = 0; attempt < 3; attempt++) await touchSwipe(cdp, page, box);
    if (short) {
      const remaining = () => calendar.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop);
      await expect.poll(remaining).toBeLessThanOrEqual(1);
      // Cover the delayed reset from native momentum and capture-phase scroll handlers.
      await page.waitForTimeout(250);
      assert((await remaining()) <= 1, "Touch scroll jumped back from the bottom");
      await touchSwipe(cdp, page, box, -1);
      await expect.poll(() => calendar.evaluate(el => el.scrollTop)).toBeLessThanOrEqual(1);
    }
    await expect(calendar).toBeVisible();
    await expect(month).toHaveText(initial);
    await assertStableScroll("A gesture in the calendar scrolled its page or parent dialog");
    for (const label of ["Следующий месяц", "Следующий год"]) {
      const previous = await month.innerText();
      await calendar.getByRole("button", { name: label, exact: true }).tap();
      await expect(month).not.toHaveText(previous);
    }
    await calendar.getByRole("button", { name: "Закрыть", exact: true }).tap();
    await expect(calendar).toBeHidden();
    await expect(trigger).toBeFocused();
    await assertStableScroll("Closing calendar scrolled its page or parent dialog");
  } finally {
    await cdp.detach();
  }
}
