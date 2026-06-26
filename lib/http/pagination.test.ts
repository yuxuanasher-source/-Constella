import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  parseListPagination,
  resolveListRange,
} from "./pagination";

describe("resolveListRange", () => {
  it("defaults to the safety cap when no pagination is given", () => {
    expect(resolveListRange()).toEqual({
      limit: DEFAULT_LIST_LIMIT,
      offset: 0,
      from: 0,
      to: DEFAULT_LIST_LIMIT - 1,
    });
  });

  it("honors an explicit limit and offset", () => {
    expect(resolveListRange({ limit: 20, offset: 40 })).toEqual({
      limit: 20,
      offset: 40,
      from: 40,
      to: 59,
    });
  });

  it("clamps limit to the maximum", () => {
    expect(resolveListRange({ limit: 99999 }).limit).toBe(MAX_LIST_LIMIT);
  });

  it("falls back to the default for non-positive or invalid limits", () => {
    expect(resolveListRange({ limit: 0 }).limit).toBe(DEFAULT_LIST_LIMIT);
    expect(resolveListRange({ limit: -5 }).limit).toBe(DEFAULT_LIST_LIMIT);
    expect(resolveListRange({ limit: Number.NaN }).limit).toBe(
      DEFAULT_LIST_LIMIT,
    );
  });

  it("ignores negative offsets", () => {
    expect(resolveListRange({ offset: -10 }).offset).toBe(0);
  });
});

describe("parseListPagination", () => {
  it("reads limit and offset from the query string", () => {
    expect(
      parseListPagination("http://localhost/api/projects?limit=25&offset=50"),
    ).toEqual({ limit: 25, offset: 50 });
  });

  it("omits absent or invalid params", () => {
    expect(parseListPagination("http://localhost/api/projects")).toEqual({});
    expect(
      parseListPagination("http://localhost/api/projects?limit=abc&offset=-1"),
    ).toEqual({});
  });
});
