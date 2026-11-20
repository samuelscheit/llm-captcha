import { describe, expect, it } from "vitest";
import { BUILTIN_ADAPTERS } from "../../src/core/adapters";
import { coverage, mergeReport, methodOf, renderCoverage, tagsOf, verificationLabel, type VitestReport } from "../../src/tools/benchmark/coverage";

const report = (startTime: number, tests: [string, "passed" | "failed" | "skipped"][]): VitestReport => ({
  startTime,
  testResults: [{ assertionResults: tests.map(([fullName, status]) => ({ fullName, title: fullName, status })) }],
});
const DAY1 = Date.UTC(2026, 10, 20, 10);
const DAY2 = Date.UTC(2026, 10, 21, 10);

describe("verification from test reports", () => {
  it("reads adapter tags from test titles", () => {
    expect(tagsOf("slides the real slider [aliyun-nc] [aliyun-slide]")).toEqual(["aliyun-nc", "aliyun-slide"]);
    expect(tagsOf("no tags here")).toEqual([]);
  });

  it("records passes and failures per adapter, newest first wins, skipped tests count for nothing", () => {
    let v = mergeReport({}, report(DAY1, [["live solves [tencent-slider]", "passed"], ["live [gname-slider]", "failed"], ["live [turnstile]", "skipped"]]));
    expect(v["tencent-slider"]).toEqual({ passedAt: "2026-11-20T10:00:00.000Z", passedBy: "live solves [tencent-slider]" });
    expect(v["gname-slider"]).toEqual({ failedAt: "2026-11-20T10:00:00.000Z", failedBy: "live [gname-slider]" });
    expect(v.turnstile).toBeUndefined();

    v = mergeReport(v, report(DAY2, [["live solves [tencent-slider]", "failed"], ["live [gname-slider]", "passed"]]));
    // A newer failure shows next to the last pass; a newer pass clears the failure.
    expect(verificationLabel(v["tencent-slider"]!)).toBe("❌ 2026-11-21 (last pass 2026-11-20)");
    expect(verificationLabel(v["gname-slider"]!)).toBe("✅ 2026-11-21");
    expect(verificationLabel({})).toBe("not yet");
  });
});

describe("coverage table", () => {
  it("says how each kind of challenge is solved", () => {
    const byId = (id: string) => BUILTIN_ADAPTERS.find((a) => a.id === id)!;
    expect(methodOf(byId("turnstile"))).toBe("checkbox click");
    expect(methodOf(byId("tencent-slider"))).toBe("image analysis + drag");
    expect(methodOf(byId("gname-slider"))).toBe("slide to end");
    expect(methodOf(byId("recaptcha-images"))).toBe("vision model: pick tiles");
    expect(methodOf(byId("datadome-blocked"))).toBe("recognized: a refusal");
  });

  it("has a row per built-in adapter, with its provider and verification", () => {
    const rows = coverage(BUILTIN_ADAPTERS, { "tencent-slider": { passedAt: "2026-11-20T10:00:00.000Z" } });
    expect(rows).toHaveLength(BUILTIN_ADAPTERS.length);
    const md = renderCoverage(rows);
    expect(md).toContain("| tencent | `tencent-slider` | image analysis + drag | ✅ 2026-11-20 |");
    expect(md).toContain("| gname | `gname-slider` | slide to end | not yet |");
  });
});
