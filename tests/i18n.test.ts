import { describe, expect, it } from "vitest";
import { resolveLocale, t } from "../packages/i18n/src";

describe("i18n", () => {
  it("defaults to Simplified Chinese", () => {
    expect(resolveLocale(undefined)).toBe("zh-CN");
    expect(t("dashboard")).toBe("仪表盘");
  });

  it("normalizes supported language aliases", () => {
    expect(resolveLocale("en")).toBe("en-US");
  });
});
