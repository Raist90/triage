import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { ErrorState } from "./ErrorState";

describe("ErrorState", () => {
  test("announces the failure and retries", () => {
    let retried = 0;
    render(
      <ErrorState
        message="Server unavailable"
        onRetry={() => {
          retried += 1;
        }}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Can’t reach the Triage server");
    expect(alert.textContent).toContain("Server unavailable");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retried).toBe(1);
  });
});
