import { describe, it, expect } from "vitest";
import {
  REGISTRY_LIST_DEFAULT_LIMIT,
  REGISTRY_LIST_DEFAULT_START,
  REGISTRY_LIST_MAX_LIMIT,
} from "./registryPagination.js";
import { ToolValidationError, validateToolArgs } from "./validation.js";

describe("registry list pagination bounds", () => {
  it("exports contract-aligned defaults", () => {
    expect(REGISTRY_LIST_DEFAULT_START).toBe(0);
    expect(REGISTRY_LIST_DEFAULT_LIMIT).toBe(20);
    expect(REGISTRY_LIST_MAX_LIMIT).toBe(20);
  });

  it("accepts omitted start and limit", () => {
    expect(() => validateToolArgs("zentrixpay_registry_list", {})).not.toThrow();
  });

  it("rejects limit above the contract cap", () => {
    expect(() => validateToolArgs("zentrixpay_registry_list", { limit: 21 })).toThrow(
      ToolValidationError,
    );
  });

  it("rejects negative start", () => {
    expect(() => validateToolArgs("zentrixpay_registry_list", { start: -1 })).toThrow(
      ToolValidationError,
    );
  });
});
