import { describe, expect, it } from "vitest";
import { detectCsvToParquetTask, detectLostGitRecoveryTask } from "../src/cli/oneshot-fastpath.js";

describe("one-shot fast paths", () => {
  it("detects explicit csv to parquet conversions", () => {
    expect(
      detectCsvToParquetTask("Convert the file '/app/data.csv' into a Parquet file named '/app/data.parquet'. The CSV file contains sample data with headers."),
    ).toEqual({
      source: "/app/data.csv",
      destination: "/app/data.parquet",
    });
  });

  it("ignores unrelated prompts", () => {
    expect(detectCsvToParquetTask("Summarize this file and explain the schema.")).toBeNull();
  });

  it("detects lost-change recovery tasks on master", () => {
    expect(
      detectLostGitRecoveryTask("I just made some changes to my personal site and checked out master, but now I can't find those changes. Please help me find them and merge them into master."),
    ).toEqual({
      targetBranch: "master",
    });
  });
});
